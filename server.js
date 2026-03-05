const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// NUEVO: Definimos el entorno (dev / staging / prod). Si no se especifica, asume 'development'
const environment = process.env.NODE_ENV || 'development';

// Middlewares: Para que el servidor entienda los datos que manda la app
app.use(cors());
app.use(express.json());

console.log(`[INFO] Iniciando TruckNav API Gateway... Entorno: ${environment.toUpperCase()}`);

// Configuración de la conexión a tu base de datos espacial local / nube
// NUEVO: Configuración de variables seguras. En producción y staging, exigimos SSL para Postgres.
const poolConfig = {
    connectionString: process.env.DATABASE_URL
};
if (environment === 'production' || environment === 'staging') {
    poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(poolConfig);

// Probar la conexión a la base de datos al encender el servidor
pool.connect()
    .then(() => console.log('✅ [OK] Bóveda de datos conectada con éxito (PostgreSQL)'))
    .catch(err => console.error('❌ [FATAL] Error conectando a la base de datos', err.stack));

// Ruta Base (Healthcheck para saber que estamos vivos)
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        environment: environment, // NUEVO: Exponemos el entorno en el healthcheck para auditoría
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
        console.error('[ERROR] Error en la ruta /api/vehicles:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Encender el motor del servidor
app.listen(port, () => {
    console.log(`🚀 [INFO] API Gateway B2B corriendo en el puerto ${port}`);
    console.log(`📡 [INFO] Esperando conexiones de la flota en http://localhost:${port}`);
});
