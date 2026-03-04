const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middlewares: Para que el servidor entienda los datos que manda la app
app.use(cors());
app.use(express.json());

// Configuración de la conexión a tu base de datos espacial local
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Probar la conexión a la base de datos al encender el servidor
pool.connect()
    .then(() => console.log('✅ Bóveda de datos conectada con éxito (PostgreSQL)'))
    .catch(err => console.error('❌ Error conectando a la base de datos', err.stack));

// Ruta Base (Healthcheck para saber que estamos vivos)
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Truck Nav API Gateway',
        message: 'Servidor B2B operando al 100%'
    });
});

// Ruta de prueba para leer el núcleo B2B
// MODIFICADO: Ahora devuelve la lista directamente para que Retrofit no falle
app.get('/api/vehicles', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        // Enviamos directamente las filas (rows), que es lo que espera la App en Kotlin
        res.json(result.rows);
    } catch (error) {
        console.error('Error en la ruta /api/vehicles:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Encender el motor del servidor
app.listen(port, () => {
    console.log(`🚀 API Gateway B2B corriendo en el puerto ${port}`);
    console.log(`📡 Esperando conexiones de la flota en http://localhost:${port}`);
});
