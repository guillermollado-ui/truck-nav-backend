const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const environment = process.env.NODE_ENV || 'development';

// ==========================================
// CONFIGURACIÓN DE PROXY (Solución Render)
// ==========================================
// Esto permite que express-rate-limit identifique 
// correctamente las IPs de los usuarios tras el proxy de Render.
app.set('trust proxy', 1);

// CORRECCIÓN ARQUITECTÓNICA: CORS y BodyParser deben ir antes del Limiter 
// para que los errores de Rate Limit incluyan las cabeceras de acceso correcto.
app.use(cors());
app.use(express.json());

// 1. ESCUDO RATE LIMITING
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    limit: 100, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        console.error(`[${new Date().toISOString()}] [SECURITY] [IP: ${req.ip}] Rate Limit Excedido`);
        res.status(options.statusCode).json({
            success: false,
            error: 'Demasiadas peticiones. Por favor, espere 15 minutos.',
            error_code: 'RATE_LIMIT_EXCEEDED'
        });
    }
});

app.use('/api/', apiLimiter);

// 2. LOGGING ESTRUCTURADO Y CORRELATION ID
app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    console.log(`[${new Date().toISOString()}] [INFO] [TxID: ${req.correlationId}] Recibida: ${req.method} ${req.url}`);
    next();
});

console.log(`[INFO] Iniciando TruckNav API Gateway... Entorno: ${environment.toUpperCase()}`);

const poolConfig = { connectionString: process.env.DATABASE_URL };
if (environment === 'production' || environment === 'staging') {
    poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(poolConfig);

pool.connect()
    .then(() => console.log('✅ [OK] Bóveda de datos conectada con éxito (PostgreSQL)'))
    .catch(err => console.error('❌ [FATAL] Error conectando a la base de datos', err.stack));

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        environment: environment, 
        service: 'Truck Nav API Gateway B2B',
        message: 'Fundación Sólida (Bloque 1) Operativa al 100%'
    });
});

// 3. LA TAQUILLA (Generación JWT)
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro_para_desarrollo_123';

app.post('/api/auth/token', (req, res) => {
    const { api_key } = req.body;
    if (api_key === (process.env.API_KEY || 'llave-maestra-trucknav-2026')) {
        const token = jwt.sign(
            { role: 'truck_client', access: 'fleet_data' },
            JWT_SECRET,
            { expiresIn: '2h' } 
        );
        console.log(`[${new Date().toISOString()}] [AUTH] [TxID: ${req.correlationId}] Token JWT generado con éxito`);
        res.json({ success: true, token: token, expires_in: '2h' });
    } else {
        console.warn(`[${new Date().toISOString()}] [AUTH] [TxID: ${req.correlationId}] Intento de acceso fallido`);
        res.status(401).json({ success: false, error: 'API Key inválida', error_code: 'INVALID_CREDENTIALS' });
    }
});

// 4. EL PORTERO (Middleware Validación JWT)
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]; 
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) {
                console.warn(`[${new Date().toISOString()}] [AUTH] [TxID: ${req.correlationId}] Token JWT expirado o inválido`);
                return res.status(403).json({ success: false, error: 'Token inválido o expirado', error_code: 'TOKEN_INVALID' });
            }
            req.user = decoded;
            next();
        });
    } else {
        console.warn(`[${new Date().toISOString()}] [AUTH] [TxID: ${req.correlationId}] Petición bloqueada (Sin token)`);
        res.status(401).json({ success: false, error: 'Autenticación requerida', error_code: 'UNAUTHORIZED' });
    }
};

// ==========================================
// NUEVO DÍA 6: VALIDACIÓN ESTRICTA (FAIL-FAST)
// ==========================================
const validateVehicleProfile = (req, res, next) => {
    const { height_m, width_m, length_m, weight_t, axles } = req.body;
    const errors = [];

    // Inspección quirúrgica de límites físicos
    if (height_m === undefined || height_m < 1.0 || height_m > 5.5) errors.push("Altura inválida (Límite: 1.0m a 5.5m)");
    if (width_m === undefined || width_m < 1.0 || width_m > 3.5) errors.push("Anchura inválida (Límite: 1.0m a 3.5m)");
    if (length_m === undefined || length_m < 2.0 || length_m > 30.0) errors.push("Longitud inválida (Límite: 2.0m a 30.0m)");
    if (weight_t === undefined || weight_t < 1.0 || weight_t > 70.0) errors.push("Peso inválido (Límite: 1.0t a 70.0t)");
    if (axles === undefined || axles < 2 || axles > 12) errors.push("Ejes inválidos (Límite: 2 a 12)");

    if (errors.length > 0) {
        console.warn(`[${new Date().toISOString()}] [VALIDATION] [TxID: ${req.correlationId}] Bloqueo de seguridad física: ${errors.join(' | ')}`);
        return res.status(400).json({ 
            success: false, 
            error: 'Los datos del camión violan los límites físicos de seguridad', 
            details: errors, 
            error_code: 'PHYSICS_VIOLATION' 
        });
    }
    
    // Si la física es correcta, pasamos al siguiente nivel
    next();
};

// 5. RUTAS PROTEGIDAS B2B (VehicleProfiles)
app.get('/api/vehicles', authenticateJWT, async (req, res, next) => {
    const timestamp = new Date().toISOString();
    try {
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Consultando perfiles (Usuario autenticado)`);
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        res.json(result.rows);
    } catch (error) {
        error.statusCode = 500;
        error.errorCode = 'DB_QUERY_FAILED';
        next(error); 
    }
});

// NUEVA RUTA DÍA 6: Crear o actualizar un vehículo con Validación Estricta
app.post('/api/vehicles', authenticateJWT, validateVehicleProfile, async (req, res, next) => {
    const timestamp = new Date().toISOString();
    try {
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Vehículo validado correctamente. Guardando en DB...`);
        // Aquí iría el INSERT a la base de datos (PostgreSQL)
        // Por ahora simulamos el éxito para validar el middleware
        res.status(201).json({
            success: true,
            message: 'Perfil de vehículo creado y validado con éxito',
            data: req.body
        });
    } catch (error) {
        error.statusCode = 500;
        error.errorCode = 'DB_INSERT_FAILED';
        next(error);
    }
});

// 6. MANEJO GLOBAL DE EXCEPCIONES
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    const correlationId = req.correlationId || 'N/A';
    const statusCode = err.statusCode || 500;
    const errorCode = err.errorCode || 'INTERNAL_SERVER_ERROR';

    console.error(`[${timestamp}] [FATAL] [TxID: ${correlationId}] Error Global Capturado:`, err.message);

    res.status(statusCode).json({
        success: false,
        error: environment === 'production' ? 'Error interno del servidor.' : err.message,
        error_code: errorCode,
        correlation_id: correlationId 
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${new Date().toISOString()}] [CRITICAL] Promesa rechazada no manejada:`, reason);
});
process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toISOString()}] [CRITICAL] Excepción no capturada:`, err.message);
});

app.listen(port, () => {
    console.log(`🚀 [INFO] API Gateway B2B corriendo en el puerto ${port}`);
    console.log(`📡 [INFO] Esperando conexiones en http://localhost:${port}`);
});
