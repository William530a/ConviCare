const mysql = require('mysql2/promise');
require('dotenv').config(); // Para usar variables de entorno

// Configurar el pool de conexiones a MySQL
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',      // Cambia esto si usaste otro usuario en MySQL
    password: 'root',  // Si configuraste una contraseña, agrégala aquí
    database: 'convicare',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


// Probar la conexión
(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ Conectado a la base de datos para usuarios de MySQL');
        connection.release(); // Liberar conexión de prueba
    } catch (err) {
        console.error('❌ Error conectando a MySQL:', err);
    }
})();

module.exports = db;
