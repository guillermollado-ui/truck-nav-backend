const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
// AÑADIDO: Axios para las peticiones a HERE
const axios = require('axios'); 
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
        res.json({ success: true, token: token, expires_in: '2h' });
    } else {
        res.status(401).json({ success: false, error: 'API Key inválida' });
    }
});

// 4. EL PORTERO (Middleware Validación JWT)
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]; 
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ success: false, error: 'Token inválido' });
            req.user = decoded;
            next();
        });
    } else {
        res.status(401).json({ success: false, error: 'Autenticación requerida' });
    }
};

// ==========================================
// DÍA 8: VALIDACIÓN DINÁMICA POR PAÍS
// ==========================================
const validateVehicleByCountry = async (req, res, next) => {
    const { height_m, weight_t, country_code } = req.body;
    const targetCountry = country_code || 'ESP'; // Por defecto España si no se envía

    try {
        // Consultamos las reglas vigentes para ese país en la DB
        const ruleResult = await pool.query(
            'SELECT * FROM country_rules WHERE country_code = $1', 
            [targetCountry]
        );

        if (ruleResult.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                error: `No hay reglas configuradas para el país: ${targetCountry}` 
            });
        }

        const rules = ruleResult.rows[0];
        const errors = [];

        // Validación dinámica contra la base de datos
        if (height_m > rules.max_height_m) {
            errors.push(`Altura excede el límite de ${rules.country_name} (${rules.max_height_m}m)`);
        }
        if (weight_t > rules.max_weight_t) {
            errors.push(`Peso excede el límite de ${rules.country_name} (${rules.max_weight_t}t)`);
        }

        if (errors.length > 0) {
            console.warn(`[VALIDATION] Bloqueo en ${targetCountry}: ${errors.join(' | ')}`);
            return res.status(400).json({ 
                success: false, 
                error: 'Violación de leyes de transporte locales', 
                details: errors,
                country: rules.country_name
            });
        }

        // Guardamos las reglas en el objeto request por si las necesitamos después
        req.countryRules = rules;
        next();
    } catch (error) {
        next(error);
    }
};

// ==========================================
// DÍA 12: MANEJO ROBUSTO Y REINTENTOS EXPONENCIALES PARA HERE API
// ==========================================
/**
 * Llama a la API de HERE con reintentos exponenciales en caso de fallos de red o errores 5xx.
 * No reintenta en errores de cliente (4xx) porque significa que la petición está mal formada.
 */
const fetchRouteFromHEREWithRetry = async (origin, destination, retries = 3, delay = 1000) => {
    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) {
        throw new Error('HERE_API_KEY no configurada en el servidor.');
    }

    const url = `https://router.hereapi.com/v8/routes?transportMode=truck&origin=${origin}&destination=${destination}&return=polyline,summary&apikey=${apiKey}`;

    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        const isNetworkError = !error.response; // Fallo de DNS, timeout, etc.
        const isServerError = error.response && error.response.status >= 500; // HERE está caído

        if ((isNetworkError || isServerError) && retries > 0) {
            console.warn(`⚠️ [HERE API] Fallo en la llamada. Reintentando en ${delay}ms... (Quedan ${retries} intentos)`);
            // Espera asíncrona (delay)
            await new Promise(resolve => setTimeout(resolve, delay));
            // Llamada recursiva multiplicando el delay (exponencial: 1s, 2s, 4s...)
            return fetchRouteFromHEREWithRetry(origin, destination, retries - 1, delay * 2);
        } else {
            // Si no quedan reintentos o es un error 400 (ej. parámetros inválidos), lanza el error definitivo
            console.error(`❌ [HERE API] Error definitivo tras reintentos o error de cliente:`, error.message);
            throw error;
        }
    }
};

// 5. RUTAS PROTEGIDAS
app.get('/api/vehicles', authenticateJWT, async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        res.json(result.rows);
    } catch (error) {
        next(error); 
    }
});

// ==========================================
// NUEVO DÍA 9: VENTANILLA DE INFORMACIÓN DE REGLAS (LOADER)
// ==========================================
app.get('/api/rules/:country_code', authenticateJWT, async (req, res, next) => {
    const countryCode = req.params.country_code.toUpperCase();
    
    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] App solicitando reglas para el país: ${countryCode}`);
        
        const result = await pool.query(
            'SELECT * FROM country_rules WHERE country_code = $1',
            [countryCode]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: `No tenemos registradas las leyes para el territorio: ${countryCode}`
            });
        }

        res.json({
            success: true,
            country: countryCode,
            rules: result.rows[0]
        });
    } catch (error) {
        error.statusCode = 500;
        next(error);
    }
});

// ACTUALIZADA DÍA 8: Crea Snapshot usando reglas dinámicas del país
app.post('/api/vehicles', authenticateJWT, validateVehicleByCountry, async (req, res, next) => {
    const { height_m, width_m, length_m, weight_t, axles, country_code } = req.body;
    
    try {
        const queryText = `
            INSERT INTO vehicle_snapshots(height_m, width_m, length_m, weight_t, axles) 
            VALUES($1, $2, $3, $4, $5) 
            RETURNING id, created_at
        `;
        const values = [height_m, width_m || 2.5, length_m || 12.0, weight_t, axles || 2];
        
        const result = await pool.query(queryText, values);
        const snapshot = result.rows[0];

        res.status(201).json({
            success: true,
            message: `Snapshot validado según leyes de ${req.countryRules.country_name}`,
            snapshot_id: snapshot.id,
            applied_limits: {
                max_h: req.countryRules.max_height_m,
                max_w: req.countryRules.max_weight_t
            }
        });
    } catch (error) {
        error.statusCode = 500;
        next(error);
    }
});

// ==========================================
// NUEVO ENDPOINT PARA ENRUTAMIENTO (Usa la lógica del Día 12)
// ==========================================
app.post('/api/route', authenticateJWT, async (req, res, next) => {
    const { origin, destination } = req.body;
    // Ejemplos esperados: origin="52.5308,13.3847" destination="52.5264,13.3686"

    if (!origin || !destination) {
        return res.status(400).json({ success: false, error: 'Se requieren origen y destino.' });
    }

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] Calculando ruta robusta de ${origin} a ${destination}`);
        const routeData = await fetchRouteFromHEREWithRetry(origin, destination);
        
        res.json({
            success: true,
            message: 'Ruta calculada con éxito desde HERE.',
            data: routeData
        });
    } catch (error) {
        // Si el error viene de axios, pasamos el status de la respuesta de HERE si existe
        error.statusCode = error.response ? error.response.status : 503; // 503 Service Unavailable si falló la red
        next(error);
    }
});

// 6. MANEJO GLOBAL DE EXCEPCIONES
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        error: environment === 'production' ? 'Error interno.' : err.message,
        correlation_id: req.correlationId || 'N/A'
    });
});

app.listen(port, () => {
    console.log(`🚀 API Gateway con Reglas Dinámicas y Rutas (Día 12) en puerto ${port}`);
});
