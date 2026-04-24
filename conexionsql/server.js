const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors()); // Permite que el HTML (Frontend) se comunique con esta API
app.use(express.json());

// 1. CREDENCIALES DE TU SQL SERVER
const dbConfig = {
    user: 'sa',
    password: '123',
    server: 'localhost', // o '127.0.0.1'
    database: 'AuxiliarCalificacionesDB', // El nombre de la BD que creaste
    options: {
        encrypt: false, 
        trustServerCertificate: true // Importante para conexiones locales
    }
};

// 2. CREAR LAS RUTAS DE LA API (Endpoints)
// Este endpoint dinámico leerá cualquier tabla que le pida el frontend
app.get('/api/:table', async (req, res) => {
    try {
        const tableName = req.params.table;
        
        // Tablas permitidas por seguridad
        const tablasPermitidas = ['Usuarios', 'RACarrera', 'Asignaturas', 'MapaCurricular', 'Estudiantes', 'Calificaciones'];
        if (!tablasPermitidas.includes(tableName)) {
            return res.status(400).json({ error: 'Tabla no válida' });
        }

        // Conectar y consultar
        await sql.connect(dbConfig);
        const result = await sql.query(`SELECT * FROM ${tableName}`);
        res.json(result.recordset); // Enviar datos al HTML

    } catch (err) {
        console.error("Error en BD:", err);
        res.status(500).send("Error interno del servidor");
    }
});

// 3. INICIAR EL SERVIDOR
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`¡API conectada a SQL Server corriendo en http://localhost:${PORT}!`);
});