const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto'); // Librería nativa de Node para generar IDs únicos
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Definimos el entorno (dev / staging / prod). Si no se especifica, asume 'development'
const environment = process.env.NODE_ENV || 'development';

// Middlewares: Para que el servidor entienda los datos que manda la app
app.use(cors());
app.use(express.json());

// Middleware de Logging Estructurado y Correlation ID (El Portero)
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
// MODIFICADO: Añadimos 'next' para delegar los errores al Hospital Central
app.get('/api/vehicles', async (req, res, next) => {
    const timestamp = new Date().toISOString();
    try {
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Consultando perfiles de vehículos en base de datos`);
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Consulta exitosa. Devolviendo ${result.rowCount} registros`);
        res.json(result.rows);
    } catch (error) {
        console.error(`[${timestamp}] [ERROR] [TxID: ${req.correlationId}] Error detectado en la BD`);
        
        // Etiquetamos el error con nuestro código interno y lo enviamos al manejador global
        error.statusCode = 500;
        error.errorCode = 'DB_QUERY_FAILED';
        next(error); 
    }
});

// =========================================================================
// NUEVO DÍA 4: MANEJO GLOBAL DE EXCEPCIONES Y ERRORES ESTANDARIZADOS
// =========================================================================

// 1. Manejador Global de Rutas (El "Hospital Central" - Debe ir siempre al final de las rutas)
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    const correlationId = req.correlationId || 'N/A';
    const statusCode = err.statusCode || 500;
    const errorCode = err.errorCode || 'INTERNAL_SERVER_ERROR';

    // Logeamos el error real en nuestra consola para poder investigarlo
    console.error(`[${timestamp}] [FATAL] [TxID: ${correlationId}] Error Global Capturado:`, err.message);

    // Devolvemos una respuesta ESTANDARIZADA a la App móvil
    res.status(statusCode).json({
        success: false,
        // En producción ocultamos detalles técnicos (como fallos de sintaxis SQL) por seguridad
        error: environment === 'production' ? 'Error interno del servidor. Contacte a soporte.' : err.message,
        error_code: errorCode,
        correlation_id: correlationId 
    });
});

// 2. Paracaídas de Nivel de Proceso (Evita que el servidor crashee silenciosamente)
process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${new Date().toISOString()}] [CRITICAL] Promesa rechazada no manejada:`, reason);
});

process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] [CRITICAL] Excepción no capturada:`, err.message);
});
// =========================================================================

// Encender el motor del servidor
app.listen(port, () => {
    console.log(`🚀 [INFO] API Gateway B2B corriendo en el puerto ${port}`);
    console.log(`📡 [INFO] Esperando conexiones de la flota en http://localhost:${port}`);
});
