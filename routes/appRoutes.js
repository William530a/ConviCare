//Importamos Express y creacion del router
const express = require('express');
const router = express.Router();

// Ruta principal
router.get('/', (req, res) => {
    res.render('index', { title: 'Bienvenido a ConviCare' });
});


module.exports = router;
