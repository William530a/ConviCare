const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const session = require('express-session');
require('dotenv').config();
const db = require('./db'); // Importar conexión a MySQL

const app = express();
app.use(express.static('public'));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
const PORT = process.env.PORT || 3000;  

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware para leer datos de formularios
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos desde "public"
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'convicare_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Cambiar a true si se usa HTTPS en producción
}));

// Middleware para hacer la sesión accesible en las vistas
app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});

// Middleware para verificar autenticación
function verificarSesion(req, res, next) {
    if (!req.session.usuario) return res.redirect('/login');
    next();
}

// Middleware para verificar si es ADMIN
function esAdmin(req, res, next) {
    if (!req.session.usuario || req.session.usuario.rol !== 'admin') {
        return res.send('🚫 No tienes permiso para acceder a esta página.');
    }
    next();
}

// Middleware para verificar si es MÉDICO
function esMedico(req, res, next) {
    if (!req.session.usuario || req.session.usuario.rol !== 'medico' && req.session.usuario.rol !== 'admin') {
        return res.send('🚫 No tienes permiso para acceder a esta página.');
    }
    next();
}

// Rutas principales
app.get('/', (req, res) => res.render('index', { title: 'Bienvenido a ConviCare' }));


// Rutas de llamado a login y register
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));

// Ruta de Register
app.post('/register', async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    
    try {
        // Verificar si el usuario ya existe
        const [existingUser] = await db.query('SELECT email FROM usuarios WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.render('register', { error: '⚠️ Este correo ya está registrado.' });
        }

        // Encriptar contraseña y registrar usuario
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)', 
                       [nombre, email, hashedPassword, rol]);

        // Redirigir a la vista de éxito
        res.render('registro_exitoso');
    } catch (error) {
        console.error('❌ Error en el registro:', error);
        res.status(500).send('Error en el servidor.');
    }
});


//Ruta de login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const [user] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (user.length === 0) return res.send('⚠️ Usuario no encontrado.');

        const usuario = user[0];
        if (!(await bcrypt.compare(password, usuario.password))) return res.send('❌ Contraseña incorrecta.');

        req.session.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
        res.redirect('/dashboard');
    } catch (error) {
        console.error('❌ Error en el login:', error);
        res.status(500).send('Error en el servidor.');
    }
});

//Ruta para Reportes
app.get('/resumen_reportes', verificarSesion, esAdmin, async (req, res) => {
    res.render('resumen_reportes'); 
});

// Ruta para Reporte General (muestra todas las historias clínicas con servicios asignados)
app.get('/reporte/general', verificarSesion, esAdmin, async (req, res) => {
    try {
        // Obtener todos los pacientes que tengan algún servicio registrado
        const [pacientes] = await db.query("SELECT id, nombre, identificacion, fecha, servicios FROM historias_clinicas WHERE servicios IS NOT NULL AND servicios != ''");

        const [atendidos] = await db.query("SELECT id, nombre, identificacion, fecha, servicios FROM historias_clinicas_atendidas WHERE servicios IS NOT NULL AND servicios != ''");

        res.render('reporte_general', { 
            pacientes,
            atendidos,
            totalPacientes: pacientes.length,
            totalAtendidos: atendidos.length
        });

    } catch (error) {
        console.error('❌ Error cargando el reporte general:', error);
        res.status(500).send('Error cargando el reporte general');
    }
});

// Ruta para generar un reporte según el servicio seleccionado
app.get('/reporte/:servicio', async (req, res) => {
    const { servicio } = req.params; 
    try {

        const [pacientes] = await db.query(
            `SELECT id, nombre, identificacion, atencion, fecha 
             FROM historias_clinicas 
             WHERE LOWER(servicios) LIKE LOWER(?) 
             ORDER BY 
                CASE 
                    WHEN atencion = 'Prioritaria' THEN 1 
                    WHEN atencion = 'General' THEN 2 
                    ELSE 3 
                END, fecha DESC`,
            [`%${servicio}%`]
        );

        // Formatear fechas a español en la segunda tabla (con hora)
        pacientes.forEach(paciente => {
            paciente.fecha = new Intl.DateTimeFormat('es-ES', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(new Date(paciente.fecha));
        });

        // Obtener historias atendidas (puedes ajustar la consulta según tus necesidades)
        const [historiasAtendidas] = await db.query(`
            SELECT id, fecha, nombre, identificacion, atencion 
            FROM historias_clinicas_atendidas
            WHERE servicios LIKE ?
            ORDER BY fecha DESC
        `, [`%${servicio}%`]);

        // Formatear fechas a español en la segunda tabla (con hora)
        historiasAtendidas.forEach(historia => {
            historia.fecha = new Intl.DateTimeFormat('es-ES', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(new Date(historia.fecha));
        });
              
        const nombreServicios = {
            medicina_general: "Medicina General",
            odontologia: "Odontología",
            optometria: "Optometría",
            higiene_oral: "Higiene Oral",
            nutricion: "Nutrición",
            psicologia: "Psicología"
        };

        res.render('reporte', {
            servicio: nombreServicios[servicio] || servicio, 
            pacientes,
            historiasAtendidas,
            totalPacientes: pacientes.length,
            totalAtendidos: historiasAtendidas.length
        });

    } catch (error) {
        console.error('Error cargando el reporte:', error);
        res.status(500).send('Error cargando el reporte');
    }
});


// Ruta para mostrar el formulario simplificado
app.get('/registro_clinico_simple', (req, res) => {
    res.render('registro_clinico_simple');
});


// Ruta para guardar la historia clínica solo con los campos básicos
app.post('/registro_simple', async (req, res) => {
    const { fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono, 
        bano, responsable, parentesco, telefono_responsable, motivo_consulta } = req.body;

    try {
        await db.query(`
            INSERT INTO consultas_basicas
            (fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono,
            bano, responsable, parentesco, telefono_responsable, motivo_consulta) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono,
            bano, responsable, parentesco, telefono_responsable, motivo_consulta]
        );

        res.render('registro_exitoso_clinico');
    } catch (error) {
        console.error('❌ Error al guardar historia clínica simplificada:', error);
        res.status(500).send('Error en el servidor.');
    }

});


//Ruta para Registro clinico
app.get('/registro_clinico', verificarSesion, (req, res) => {
    res.render('registro_clinico', { usuario: req.session.usuario });
}); 

// Ruta para registrar las historias clínicas
app.post('/registro', async (req, res) => {
    const usuario = req.session.usuario;

    // Si el usuario es médico, registrar su firma como médico; si no, como enfermero
    const firma_ingreso = usuario.rol === "Médico" ? null : usuario.nombre;
    const firma_medico = usuario.rol === "Médico" ? usuario.nombre : null;

    const { fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono, 
            bano, responsable, parentesco, telefono_responsable, 
            motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla, ciclo1, ciclo2, fisico, 
            horas, dias, atencion } = req.body;

    // Convertimos las cadenas vacías en `null` para los campos numéricos y fechas
    const fum = req.body.fum ? req.body.fum : null;

    const g = req.body.g !== '' ? parseInt(req.body.g) : null;
    const a = req.body.a !== '' ? parseInt(req.body.a) : null;
    const p = req.body.p !== '' ? parseInt(req.body.p) : null;
    const v = req.body.v !== '' ? parseInt(req.body.v) : null;
    const c = req.body.c !== '' ? parseInt(req.body.c) : null;

    const ciclos = `${ciclo1}X${ciclo2}`;
    

    // Convertir los servicios seleccionados en un string separado por comas
    let servicios = req.body.servicios ? req.body.servicios.join(', ') : '';  

    try {
        await db.query(`
            INSERT INTO historias_clinicas 
            (fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono, 
            bano, responsable, parentesco, telefono_responsable, 
            motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla, firma_ingreso, firma_medico, fum, g, a, p, v, c, ciclos, fisico, servicios, atencion) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [fecha, tipo_identificacion, nombre, identificacion, fecha_nacimiento, edad, sexo, direccion, telefono, 
            bano, responsable, parentesco, telefono_responsable, 
            motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla, 
            firma_ingreso, firma_medico, fum, g, a, p, v, c, ciclos, fisico, servicios, atencion]
        );

        app.post('/historias/registrar', verificarSesion, esMedico, async (req, res) => {
            console.log('📌 Servicios seleccionados:', req.body.servicios);
        
            let servicios = req.body.servicios ? req.body.servicios.join(', ') : '';
        
            console.log('📌 Servicios procesados:', servicios);
        });

        res.render('registro_exitoso_clinico');
    } catch (error) {
        console.error('❌ Error al guardar historia clínica:', error);
        res.status(500).send('Error en el servidor.');
    }
});


//Ruta para el logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.send('❌ Error al cerrar sesión.');
        res.redirect('/');
    });
});


// Ruta para el Dashboard
app.get('/dashboard', verificarSesion, (req, res) => res.render('dashboard'));


// Gestión de usuarios (solo Admin)
app.get('/usuarios', verificarSesion, esAdmin, async (req, res) => {
    try {
        const [usuarios] = await db.query('SELECT id, nombre, email, rol FROM usuarios');
        res.render('usuarios', { usuarios });
    } catch (error) {
        console.error('❌ Error obteniendo usuarios:', error);
        res.status(500).send('Error en el servidor.');
    }
});


//Ruta para agregar nuevo usuario (solo Admin)
app.get('/usuarios/nuevo', verificarSesion, esAdmin, (req, res) => res.render('nuevo_usuario'));

app.get('/usuarios/usuario_registrado_exitosamente', verificarSesion, esAdmin, (req, res) => {
    res.render('usuario_registrado_exitosamente'); 
});

app.post('/usuarios/nuevo', verificarSesion, esAdmin, async (req, res) => {
    const { nombre, email, password, rol } = req.body;

    try {
        const [existingUser] = await db.query('SELECT email FROM usuarios WHERE email = ?', [email]);
        if (existingUser.length > 0) return res.send('⚠️ Este correo ya está registrado.');

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)', 
                       [nombre, email, hashedPassword, rol]);
        
        console.log(`✅ Datos guardados en historias_clinicas desde consultas_basicas.`);

        res.redirect('/usuarios/usuario_registrado_exitosamente');

    } catch (error) {
        console.error('❌ Error al registrar usuario:', error);
        res.status(500).send('Error en el servidor.');
    }
});


//Ruta para elminar usuario (solo Admin)
app.post('/usuarios/eliminar/:id', verificarSesion, esAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await db.query('DELETE FROM usuarios WHERE id = ?', [id]);
        res.redirect('/usuarios');
    } catch (error) {
        console.error('❌ Error al eliminar usuario:', error);
        res.status(500).send('Error en el servidor.');
    }
});


//Ruta para editar usuario (solo Admin)
app.get('/usuarios/editar/:id', verificarSesion, esAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const [usuario] = await db.query('SELECT id, nombre, email, rol FROM usuarios WHERE id = ?', [id]);
        if (usuario.length === 0) return res.send('⚠️ Usuario no encontrado.');

        res.render('editar_usuario', { usuario: usuario[0] });

    } catch (error) {
        console.error('❌ Error obteniendo usuario:', error);
        res.status(500).send('Error en el servidor.');
    }
});

app.get('/usuarios/edicion_exitosa', verificarSesion, esAdmin, (req, res) => {
    res.render('edicion_usuario_exitosa');
});

app.post('/usuarios/editar/:id', verificarSesion, esAdmin, async (req, res) => {
    const { id } = req.params;
    const { nombre, email, rol } = req.body;

    try {
        await db.query('UPDATE usuarios SET nombre = ?, email = ?, rol = ? WHERE id = ?', 
                       [nombre, email, rol, id]);
        res.redirect('/usuarios/edicion_exitosa');
    } catch (error) {
        console.error('❌ Error al actualizar usuario:', error);
        res.status(500).send('Error en el servidor.');
    }
});


// Ruta para mostrar las historias clínicas basicas
app.get('/historias_simples', verificarSesion, async (req, res) => {
    try {
        const [historias] = await db.query(`
            SELECT id, fecha, nombre, identificacion 
            FROM consultas_basicas 
            ORDER BY fecha DESC
        `);

        // Formatear fechas en español
        historias.forEach(historia => {
            historia.fecha = new Intl.DateTimeFormat('es-ES', {
                weekday: 'long', // Nombre del día (ej: martes)
                year: 'numeric',
                month: 'long', // Nombre del mes (ej: marzo)
                day: 'numeric'
            }).format(new Date(historia.fecha));
        });

        res.render('ver_historias_simples', { historias });
    } catch (error) {
        console.error('❌ Error obteniendo historias clínicas:', error);
        res.status(500).send('Error en el servidor.');
    }
});

// Ruta para obtener y editar una historia clínica basica específica
app.get('/historias_simples/editar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario; // Obtener el usuario logueado
    console.log('🔥 Ruta de consultas_basicas activada');

    try {
        const [historia] = await db.query('SELECT * FROM consultas_basicas WHERE id = ?', [id]);
        if (historia.length === 0) {
            return res.status(404).send('⚠️ Historia clínica no encontrada.');
        }

        res.render('editar_historias_simples', { 
            historia: historia[0], 
            usuario, // Pasar usuario a la vista
            serviciosSeleccionados: historia[0].servicios ? historia[0].servicios.split(', ') : []  
        });
        
    } catch (error) {
        console.error('❌ Error obteniendo historia clínica:', error);
        res.status(500).send('Error en el servidor.');
    }
});

app.post('/historias_basicas/editar/:id', async (req, res) => {
    const { id } = req.params;

    // Si el usuario es médico, registrar su firma como médico; si no, como enfermero
    const firma_ingreso = usuario.rol === "Médico" ? null : usuario.nombre;

    const { 
        fecha, nombre, tipo_identificacion, identificacion, edad, sexo, direccion, telefono, bano,
        motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla,
        fum, g, a, p, v, c, ciclo1, ciclo2, fisico, atencion 
    } = req.body;

    const ciclos = ciclo1 && ciclo2 ? `${ciclo1}X${ciclo2}` : null;

    let servicios = req.body.servicios ? req.body.servicios.join(', ') : '';

    try {
        // 📌 Inserta los datos en la tabla "historias_clinicas"
        await db.query(`
            INSERT INTO historias_clinicas 
            (fecha, tipo_identificacion, nombre, identificacion, edad, sexo, direccion, telefono,
            bano, motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla,
            firma_ingreso, fum, g, a, p, v, c, ciclos, fisico, servicios, atencion) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [fecha, tipo_identificacion, nombre, identificacion, edad, sexo, direccion, telefono,
            bano, motivo_consulta, antecedentes, fc, fr, ta, temperatura, peso, talla,
            firma_ingreso, fum, g, a, p, v, c, ciclos, fisico, servicios, atencion]);
        

        console.log(`✅ Datos guardados en historias_clinicas desde consultas_basicas.`);

        // Eliminar la historia de la tabla "consultas_basicas" una vez transferida (opcional)
        await db.query('DELETE FROM consultas_basicas WHERE id = ?', [id]);

        res.render('actualizacion_registro_clinico_exitoso');

    } catch (error) {
        console.error('❌ Error guardando en historias_clinicas:', error);
        res.status(500).send('Error en el servidor.');
    }
});


// Ruta para mostrar las historias clínicas (medicos)
app.get('/historias', verificarSesion, esMedico, async (req, res) => {
    try {
        const [historias] = await db.query(`
            SELECT id, fecha, nombre, identificacion, atencion 
            FROM historias_clinicas 
            ORDER BY 
                CASE 
                    WHEN atencion = 'Prioritaria' THEN 1 
                    WHEN atencion = 'General' THEN 2 
                    ELSE 3 
                END,
                fecha DESC
        `);

        // Obtener historias atendidas (puedes ajustar la consulta según tus necesidades)
        const [historiasAtendidas] = await db.query(`
            SELECT id, fecha, nombre, identificacion, atencion 
            FROM historias_clinicas_atendidas
            ORDER BY fecha DESC
        `);
        

        // Formatear fechas a español de la primera tabla (con hora)
        historias.forEach(historia => {
            historia.fecha = new Intl.DateTimeFormat('es-ES', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }).format(new Date(historia.fecha));
        });

        // Formatear fechas a español en la segunda tabla (con hora)
        historiasAtendidas.forEach(historia => {
            historia.fecha = new Intl.DateTimeFormat('es-ES', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }).format(new Date(historia.fecha));
        });



        // Pasar ambas variables a la vista
        res.render('ver_historias', { historias, historiasAtendidas });
    } catch (error) {
        console.error('❌ Error obteniendo historias clínicas:', error);
        res.status(500).send('Error cargando las historias clínicas.');
    }
});


// Ruta para obtener y editar una historia clínica specífica
app.get('/historias_clinicas/editar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario; // Obtener el usuario logueado

    try {
        const [historia] = await db.query('SELECT * FROM historias_clinicas WHERE id = ?', [id]);
        if (historia.length === 0) {
            return res.status(404).send('⚠️ Historia clínica no encontrada.');
        }

        const serviciosSeleccionados = historia[0].servicios
            ? historia[0].servicios.split(', ')
            : [];

        console.log("🔍 Servicios seleccionados:", serviciosSeleccionados);

        res.render('editar_historia', { 
            historia: historia[0], 
            serviciosSeleccionados, 
            usuario 
        });
        

    } catch (error) {
        console.error('❌ Error obteniendo historia clínica:', error);
        res.status(500).send('Error en el servidor.');
    }
});

app.post('/historias_clinicas/editar/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario; // Obtener usuario logueado

    const firma_medico = usuario.rol === "medico" ? usuario.nombre : null;

    // Obtener medicamentos, horas y días asegurándonos de que sean arrays
    const medicamentos = Array.isArray(req.body.medicamento) ? req.body.medicamento : [];
    const horas = Array.isArray(req.body.horas) ? req.body.horas : [];
    const dias = Array.isArray(req.body.dias) ? req.body.dias : [];

    // Construir la cadena de conducta
    const conducta = medicamentos.map((med, i) => (
        med && horas[i] && dias[i] ? `${med} cada ${horas[i]} horas por ${dias[i]} días.` : null
    )).filter(Boolean).join(' | ') || null;  // Si queda vacío, asignamos null

    // Log para depuración
    console.log("📝 Conducta generada:", conducta);


    let { fecha, nombre, identificacion, edad, sexo, direccion, telefono, 
        motivo_consulta, antecedentes, fc, fr, ta, temperatura, 
        peso, talla, diagnostico, bano, responsable, parentesco, telefono_responsable, 
        firma_ingreso, fum, g, a, p, v, c, ciclo1, ciclo2, fisico, tipo_identificacion,
        servicios, atencion = [], fecha_nacimiento } = req.body;

    // Ajustar ciclos correctamente
    const ciclos = `${ciclo1 || ''}X${ciclo2 || ''}`;

    // Manejar servicios y atención correctamente
    const serviciosTexto = Array.isArray(servicios) ? servicios.join(', ') : servicios;
    const atencionTexto = Array.isArray(atencion) ? atencion.join(', ') : atencion;

    // Validación de la fecha
    if (!fecha) {
        const [historia] = await db.query('SELECT * FROM historias_clinicas WHERE id = ?', [id]);
        return res.render('editar_historia', {
            historia: historia[0],
            error: '⚠️ La fecha es obligatoria. Por favor, ingrésela antes de continuar.'
        });
    }

    try {
        await db.query(`
            INSERT INTO historias_clinicas_atendidas 
            (fecha, nombre, identificacion, edad, sexo, direccion, telefono, 
            motivo_consulta, antecedentes, fc, fr, ta, temperatura, 
            peso, talla, diagnostico, conducta, bano, responsable, parentesco, telefono_responsable, 
            firma_ingreso, firma_medico, 
            fum, g, a, p, v, c, ciclos, fisico, tipo_identificacion, servicios, atencion, fecha_nacimiento)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            fecha, nombre, identificacion, edad, sexo, direccion, telefono, 
            motivo_consulta, antecedentes, fc, fr, ta, temperatura, 
            peso, talla, diagnostico, conducta, bano, responsable, parentesco, telefono_responsable, 
            firma_ingreso, firma_medico, 
            fum, g, a, p, v, c, ciclos, fisico, tipo_identificacion, serviciosTexto, atencionTexto, fecha_nacimiento
        ]);

        console.log(`✅ Historia clínica con ID ${id} actualizada correctamente.`);

        // Eliminar la historia clínica de la tabla de "Registradas"
        await db.query('DELETE FROM historias_clinicas WHERE id = ?', [id]);

        // Guardar copia en la tabla de farmacia
        await db.query(
            'INSERT INTO farmacia (nombre, identificacion, conducta, diagnostico, firma_medico) VALUES (?, ?, ?, ?, ?)',
            [nombre, identificacion, conducta, diagnostico, firma_medico]
        );

        res.render('actualizacion_registro_clinico_exitoso');
    } catch (error) {
        console.error('❌ Error al actualizar la historia clínica:', error);
        res.status(500).send('Error actualizando la historia clínica.');
    }
});


//Ruta para Ver las historias clínicas atendidas
app.get('/historias_clinicas_atendidas/ver/:id', verificarSesion, async (req, res) => {
    const { id } = req.params;
    const usuario = req.session.usuario; // Obtener el usuario logueado

    try {
        const [historia] = await db.query('SELECT * FROM historias_clinicas_atendidas WHERE id = ?', [id]);
        
        if (historia.length === 0) {
            return res.status(404).send('⚠️ Historia clínica no encontrada.');
        }

        console.log("📋 Datos obtenidos de la BD:", historia[0]); // <-- Añade este log

        const serviciosSeleccionados = historia[0].servicios
            ? historia[0].servicios.split(', ')
            : [];

        console.log("🔍 Servicios seleccionados:", serviciosSeleccionados);

        res.render('detalle_historia', { 
            historia: historia[0], 
            serviciosSeleccionados, 
            usuario 
        });
    } catch (error) {
        console.error('❌ Error obteniendo historia clínica atendida:', error);
        res.status(500).send('Error en el servidor.');
    }
});


// Ruta para farmacia
app.get('/farmacia', async (req, res) => {
    try {
        const [pedidosFarmacia] = await db.query('SELECT * FROM farmacia ORDER BY fecha DESC');
        res.render('farmacia', { pedidosFarmacia });
    } catch (err) {
        console.error('Error al obtener las recetas para farmacia:', err);
        res.status(500).send('Error al cargar las recetas para farmacia');
    }
});

//Ruta para ver la receta especifica en farmacia
app.get('/farmacia/ver/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [pedido] = await db.query('SELECT * FROM farmacia WHERE id = ?', [id]);

        if (pedido.length === 0) {
            return res.status(404).send('⚠️ Receta no encontrada.');
        }

        res.render('detalle_farmacia', { pedido: pedido[0] });
    } catch (error) {
        console.error('❌ Error obteniendo la receta:', error);
        res.status(500).send('Error en el servidor.');
    }
});

// Rutas protegidas para médicos
app.get('/pacientes', verificarSesion, esMedico, (req, res) => {
    res.send('🩺 Listado de pacientes (solo médicos pueden ver esto)');
});

// Iniciar servidor
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
