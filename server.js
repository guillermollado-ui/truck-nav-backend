const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto'); // NUEVO: Librería nativa de Node para generar IDs únicos
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Definimos el entorno (dev / staging / prod). Si no se especifica, asume 'development'
const environment = process.env.NODE_ENV || 'development';

// Middlewares: Para que el servidor entienda los datos que manda la app
app.use(cors());
app.use(express.json());

// NUEVO: Middleware de Logging Estructurado y Correlation ID (El Portero)
app.use((req, res, next) => {
    // Asignamos una "matrícula" única a esta petición (TxID)
    req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    
    // Devolvemos la matrícula en las cabeceras por si la App la necesita
    res.setHeader('x-correlation-id', req.correlationId);

    // Registramos la entrada con estructura: [TIEMPO] [NIVEL] [MATRÍCULA] [ACCIÓN]
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Recibida: ${req.method} ${req.url}`);
    
    next();
});

console.log(`[INFO] Iniciando TruckNav API Gateway... Entorno: ${environment.toUpperCase()}`);

// Configuración de la conexión a tu base de datos espacial local / nube
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
        environment: environment, 
        service: 'Truck Nav API Gateway',
        message: 'Servidor B2B operando al 100%'
    });
});

// Ruta de prueba para leer el núcleo B2B
app.get('/api/vehicles', async (req, res) => {
    const timestamp = new Date().toISOString();
    try {
        // NUEVO: Logging de seguimiento interno con el mismo TxID
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Consultando perfiles de vehículos en base de datos`);
        
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        
        // NUEVO: Confirmación de éxito estructurada
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Consulta exitosa. Devolviendo ${result.rowCount} registros`);
        res.json(result.rows);
    } catch (error) {
        // NUEVO: Logging de error detallado vinculando el TxID
        console.error(`[${timestamp}] [ERROR] [TxID: ${req.correlationId}] Error en la ruta /api/vehicles:`, error.message);
        
        // NUEVO: Le damos el correlation_id a la App para facilitar auditorías y soporte
        res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor',
            error_code: 'DB_QUERY_FAILED',
            correlation_id: req.correlationId 
        });
    }
});

// Encender el motor del servidor
app.listen(port, () => {
    console.log(`🚀 [INFO] API Gateway B2B corriendo en el puerto ${port}`);
    console.log(`📡 [INFO] Esperando conexiones de la flota en http://localhost:${port}`);
});
