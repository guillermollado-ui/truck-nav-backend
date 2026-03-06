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
app.set('trust proxy', 1);

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
// DÍA 6: VALIDACIÓN ESTRICTA (FAIL-FAST)
// ==========================================
const validateVehicleProfile = (req, res, next) => {
    const { height_m, width_m, length_m, weight_t, axles } = req.body;
    const errors = [];

    if (height_m === undefined || height_m < 1.0 || height_m > 5.5) errors.push("Altura inválida (1.0m-5.5m)");
    if (width_m === undefined || width_m < 1.0 || width_m > 3.5) errors.push("Anchura inválida (1.0m-3.5m)");
    if (length_m === undefined || length_m < 2.0 || length_m > 30.0) errors.push("Longitud inválida (2.0m-30.0m)");
    if (weight_t === undefined || weight_t < 1.0 || weight_t > 70.0) errors.push("Peso inválido (1.0t-70.0t)");
    if (axles === undefined || axles < 2 || axles > 12) errors.push("Ejes inválidos (2-12)");

    if (errors.length > 0) {
        console.warn(`[${new Date().toISOString()}] [VALIDATION] Bloqueo físico: ${errors.join(' | ')}`);
        return res.status(400).json({ success: false, error: 'Violación de límites físicos', details: errors });
    }
    next();
};

// 5. RUTAS PROTEGIDAS B2B
app.get('/api/vehicles', authenticateJWT, async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        res.json(result.rows);
    } catch (error) {
        error.statusCode = 500;
        next(error); 
    }
});

// ==========================================
// DÍA 7: SNAPSHOT INMUTABLE (IMPLEMENTACIÓN REAL)
// ==========================================
app.post('/api/vehicles', authenticateJWT, validateVehicleProfile, async (req, res, next) => {
    const { height_m, width_m, length_m, weight_t, axles } = req.body;
    const timestamp = new Date().toISOString();
    
    try {
        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Generando Snapshot Inmutable...`);
        
        // Guardamos la "Foto Fija" del vehículo en la tabla inmutable
        const queryText = `
            INSERT INTO vehicle_snapshots(height_m, width_m, length_m, weight_t, axles) 
            VALUES($1, $2, $3, $4, $5) 
            RETURNING id, created_at
        `;
        const values = [height_m, width_m, length_m, weight_t, axles];
        
        const result = await pool.query(queryText, values);
        const snapshot = result.rows[0];

        console.log(`[${timestamp}] [INFO] [TxID: ${req.correlationId}] Snapshot guardado con ID: ${snapshot.id}`);

        res.status(201).json({
            success: true,
            message: 'Snapshot inmutable generado con éxito',
            snapshot_id: snapshot.id,
            timestamp: snapshot.created_at,
            data: req.body
        });
    } catch (error) {
        console.error(`[${timestamp}] [ERROR] Fallo al guardar snapshot:`, error.message);
        error.statusCode = 500;
        error.errorCode = 'SNAPSHOT_FAILED';
        next(error);
    }
});

// 6. MANEJO GLOBAL DE EXCEPCIONES
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    const correlationId = req.correlationId || 'N/A';
    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        error: environment === 'production' ? 'Error interno.' : err.message,
        correlation_id: correlationId 
    });
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err.message));

app.listen(port, () => {
    console.log(`🚀 API Gateway corriendo en puerto ${port}`);
});
