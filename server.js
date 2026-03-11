const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios'); 
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const environment = process.env.NODE_ENV || 'development';

// ==========================================
// OPERACIÓN ESCUDO: FAIL-FAST VARIABLES DE ENTORNO
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("❌ FATAL: JWT_SECRET no definido en el entorno. Abortando arranque por seguridad.");
}

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    throw new Error("❌ FATAL: API_KEY no definido en el entorno. Abortando arranque por seguridad.");
}

// ==========================================
// HERRAMIENTA CRIPTOGRÁFICA: JSON DETERMINISTA
// ==========================================
const sortJSON = (obj) => {
    if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj = {};
    sortedKeys.forEach(key => sortedObj[key] = obj[key]);
    return JSON.stringify(sortedObj);
};

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

// ==========================================
// OPERACIÓN ESCUDO: LIMITACIÓN DEL POOL DB
// ==========================================
const poolConfig = { 
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
};
if (environment === 'production' || environment === 'staging') {
    poolConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(poolConfig);

pool.connect()
    .then(() => console.log('✅ [OK] Bóveda de datos conectada con éxito (PostgreSQL) - Modo Optimizado'))
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
app.post('/api/auth/token', (req, res) => {
    const { api_key } = req.body;
    if (api_key === API_KEY) {
        const token = jwt.sign(
            { role: 'truck_client', access: 'fleet_data', user_id: 1 }, 
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
    const targetCountry = country_code || 'ESP'; 

    try {
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

        req.countryRules = rules;
        next();
    } catch (error) {
        next(error);
    }
};

// ==========================================
// DÍA 12, 16 Y 17: MANEJO ROBUSTO Y REINTENTOS EXPONENCIALES PARA HERE API
// ==========================================
const fetchRouteFromHEREWithRetry = async (origin, destination, retries = 3, delay = 1000) => {
    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) {
        throw new Error('HERE_API_KEY no configurada en el servidor.');
    }

    const url = `https://router.hereapi.com/v8/routes?transportMode=truck&origin=${origin}&destination=${destination}&return=polyline,summary&apikey=${apiKey}`;

    try {
        const response = await axios.get(url, { timeout: 5000 });
        return response.data;
    } catch (error) {
        const isNetworkError = !error.response; 
        const isServerError = error.response && error.response.status >= 500; 

        if ((isNetworkError || isServerError) && retries > 0) {
            console.warn(`⚠️ [HERE API] Fallo en la llamada. Reintentando en ${delay}ms... (Quedan ${retries} intentos)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchRouteFromHEREWithRetry(origin, destination, retries - 1, delay * 2);
        } else {
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

// ==========================================
// DÍA 21: LECTURA DE ZONAS AMBIENTALES (ZBE)
// ==========================================
app.get('/api/zones/:country_code', authenticateJWT, async (req, res, next) => {
    const countryCode = req.params.country_code.toUpperCase();
    
    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] App solicitando zonas ambientales para el país: ${countryCode}`);
        
        const result = await pool.query(
            'SELECT * FROM environmental_zones WHERE country_code = $1',
            [countryCode]
        );

        res.json({
            success: true,
            country: countryCode,
            total_zones: result.rowCount,
            zones: result.rows
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
// DÍA 25: LECTURA MAESTRA DE LA MATRIZ DE RIESGOS (ENDPOINT PARA LA APP MÓVIL)
// ==========================================
app.get('/api/route/:id', authenticateJWT, async (req, res, next) => {
    const routeId = req.params.id;

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] App solicitando desglose maestro de la ruta ID: ${routeId}`);

        const routeResult = await pool.query(
            'SELECT id, origin_coords, destination_coords, total_route_risk, created_at FROM provider_responses WHERE id = $1',
            [routeId]
        );

        if (routeResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Ruta no encontrada en la bóveda.' });
        }

        const routeSummary = routeResult.rows[0];

        const segmentsResult = await pool.query(
            'SELECT * FROM route_segments WHERE response_id = $1 ORDER BY segment_index ASC',
            [routeId]
        );

        res.json({
            success: true,
            route: {
                id: routeSummary.id,
                origin: routeSummary.origin_coords,
                destination: routeSummary.destination_coords,
                total_risk: routeSummary.total_route_risk,
                created_at: routeSummary.created_at
            },
            total_segments: segmentsResult.rowCount,
            segments: segmentsResult.rows
        });

    } catch (error) {
        error.statusCode = 500;
        next(error);
    }
});

// ==========================================
// DÍA 29: MÁQUINA DEL TIEMPO LEGAL (AUDITORÍA HISTÓRICA)
// ==========================================
app.get('/api/legal/audit/:response_id', authenticateJWT, async (req, res, next) => {
    const responseId = req.params.response_id;

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] 🔍 Solicitando auditoría legal para la ruta ID: ${responseId}`);

        const auditResult = await pool.query(
            'SELECT * FROM route_decision_logs WHERE response_id = $1',
            [responseId]
        );

        if (auditResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Registro de auditoría no encontrado en la Caja Negra.' });
        }

        const auditData = auditResult.rows[0];

        res.json({
            success: true,
            message: 'Registro forense recuperado con éxito.',
            audit_record: {
                id: auditData.id,
                response_id: auditData.response_id,
                origin: auditData.origin_coords,
                destination: auditData.destination_coords,
                final_risk_score: auditData.final_risk_score,
                alerts_triggered: auditData.alerts_triggered,
                applied_context: auditData.applied_context,
                vehicle_snapshot: auditData.vehicle_snapshot,
                rules_snapshot: auditData.rules_snapshot,
                decision_hash: auditData.decision_hash,
                decision_timestamp: auditData.decision_timestamp
            }
        });

    } catch (error) {
        error.statusCode = 500;
        next(error);
    }
});

// ==========================================
// DÍA 30: AUDITORÍA INTERNA DE COHERENCIA (DETECTOR DE MENTIRAS)
// ==========================================
app.get('/api/legal/verify/:response_id', authenticateJWT, async (req, res, next) => {
    const responseId = req.params.response_id;

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] 🚨 Ejecutando Auditoría de Coherencia para la ruta ID: ${responseId}`);

        const auditResult = await pool.query(
            'SELECT * FROM route_decision_logs WHERE response_id = $1',
            [responseId]
        );

        if (auditResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Registro de auditoría no encontrado.' });
        }

        const auditData = auditResult.rows[0];

        const strAlerts = sortJSON(auditData.alerts_triggered);
        const strContext = sortJSON(auditData.applied_context);
        const strVehicle = sortJSON(auditData.vehicle_snapshot);
        const strRules = sortJSON(auditData.rules_snapshot);

        const payloadToHash = `${auditData.response_id}_${auditData.origin_coords}_${auditData.destination_coords}_${auditData.final_risk_score}_${strAlerts}_${strContext}_${strVehicle}_${strRules}`;
        const currentHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');
        const isIntact = currentHash === auditData.decision_hash;

        res.json({
            success: true,
            audit_status: isIntact ? "Íntegro y válido" : "¡ALERTA ROJA! Registro manipulado",
            is_valid: isIntact,
            original_hash: auditData.decision_hash,
            recalculated_hash: currentHash,
            message: isIntact 
                ? 'El registro forense está intacto, no ha sido alterado y es legalmente vinculante ante un tribunal.' 
                : 'Peligro: El registro ha sido alterado manualmente en la base de datos tras su creación original.'
        });

    } catch (error) {
        error.statusCode = 500;
        next(error);
    }
});

// ==========================================
// DÍA 31: BLOQUE 3 - GESTIÓN DE SESIONES DEL CONDUCTOR (TACÓGRAFO)
// ==========================================
app.post('/api/sessions/start', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const checkActive = await pool.query(
            'SELECT id FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );

        if (checkActive.rowCount > 0) {
            return res.json({ 
                success: true, 
                message: 'Ya existe una sesión activa. Recuperando datos...', 
                session_id: checkActive.rows[0].id 
            });
        }

        const result = await pool.query(
            'INSERT INTO driver_sessions (user_id, current_status) VALUES ($1, $2) RETURNING id, start_time',
            [userId, 'OFF']
        );

        console.log(`[INFO] [TxID: ${req.correlationId}] 🚛 Sesión iniciada para conductor ${userId}`);
        
        res.status(201).json({
            success: true,
            message: 'Jornada iniciada con éxito.',
            session_id: result.rows[0].id,
            start_time: result.rows[0].start_time
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/sessions/stop', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query(
            'UPDATE driver_sessions SET end_time = CURRENT_TIMESTAMP, current_status = $1 WHERE user_id = $2 AND end_time IS NULL RETURNING id, end_time',
            ['OFF', userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'No hay ninguna sesión activa para cerrar.' });
        }

        console.log(`[INFO] [TxID: ${req.correlationId}] 🏁 Sesión finalizada para conductor ${userId}`);

        res.json({
            success: true,
            message: 'Jornada cerrada correctamente.',
            session_id: result.rows[0].id,
            end_time: result.rows[0].end_time
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/sessions/status', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query(
            'SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.json({ success: true, active: false, status: 'OFF', message: 'Sin jornada activa.' });
        }

        const session = result.rows[0];
        res.json({
            success: true,
            active: true,
            session_id: session.id,
            status: session.current_status,
            driving_time_seconds: session.accumulated_driving_seconds,
            continuous_driving_seconds: session.continuous_driving_seconds,
            last_change: session.last_status_change,
            split_breaks: session.split_breaks
        });
    } catch (error) {
        next(error);
    }
});

// ==========================================
// DÍA 32 MODIFICADO: RADAR CON DETECCIÓN DE MARTILLOS (OTHER_WORK)
// ==========================================
app.post('/api/sessions/telemetry', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    const { speed_kmh } = req.body;
    const currentSpeed = speed_kmh || 0;

    try {
        const sessionResult = await pool.query(
            'SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );

        if (sessionResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'No se encontró jornada activa para reportar telemetría.' });
        }

        const session = sessionResult.rows[0];
        const now = new Date();
        const lastChange = new Date(session.last_status_change);
        
        const secondsElapsed = Math.floor((now - lastChange) / 1000);

        let newStatus = session.current_status;
        let addedSeconds = 0;
        let totalDrivingSeconds = session.accumulated_driving_seconds || 0;
        let continuousDriving = session.continuous_driving_seconds || 0;

        if (currentSpeed > 10) {
            if (session.current_status === 'DRIVING') {
                addedSeconds = secondsElapsed;
                totalDrivingSeconds += addedSeconds;
                continuousDriving += addedSeconds;
            } else {
                newStatus = 'DRIVING'; 
            }
        } else {
            if (session.current_status === 'DRIVING') {
                addedSeconds = secondsElapsed;
                totalDrivingSeconds += addedSeconds;
                continuousDriving += addedSeconds;
                newStatus = 'OTHER_WORK';
            } else if (session.current_status !== 'RESTING' && session.current_status !== 'OFF') {
                newStatus = 'OTHER_WORK';
            }
        }

        if (addedSeconds > 0 || newStatus !== session.current_status) {
            await pool.query(
                'UPDATE driver_sessions SET current_status = $1, accumulated_driving_seconds = $2, continuous_driving_seconds = $3, last_status_change = CURRENT_TIMESTAMP WHERE id = $4',
                [newStatus, totalDrivingSeconds, continuousDriving, session.id]
            );
        }

        res.json({
            success: true,
            telemetry: {
                current_speed_kmh: currentSpeed,
                new_status: newStatus,
                total_driving_seconds: totalDrivingSeconds,
                continuous_driving_seconds: continuousDriving
            }
        });

    } catch (error) {
        next(error);
    }
});

// ==========================================
// DÍA 33: CÁLCULO CONDUCCIÓN RESTANTE DIARIA Y CONTINUA (4.5h)
// ==========================================
app.get('/api/sessions/remaining', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    const DAILY_LIMIT_SECONDS = 9 * 60 * 60; // 9 horas
    const CONTINUOUS_LIMIT_SECONDS = 4.5 * 60 * 60; // 4.5 horas

    try {
        const result = await pool.query(
            'SELECT accumulated_driving_seconds, continuous_driving_seconds FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.json({ success: false, error: 'Sin jornada activa.' });
        }

        const session = result.rows[0];
        let dailyRemaining = DAILY_LIMIT_SECONDS - (session.accumulated_driving_seconds || 0);
        let contRemaining = CONTINUOUS_LIMIT_SECONDS - (session.continuous_driving_seconds || 0);
        
        if (dailyRemaining < 0) dailyRemaining = 0;
        if (contRemaining < 0) contRemaining = 0;

        const formatTime = (secs) => `${Math.floor(secs / 3600).toString().padStart(2, '0')}:${Math.floor((secs % 3600) / 60).toString().padStart(2, '0')}`;

        let warningLevel = 'OK';
        if (contRemaining <= 1800) warningLevel = 'CRITICAL'; 
        else if (contRemaining <= 3600) warningLevel = 'WARNING';

        res.json({
            success: true,
            daily_remaining_formatted: formatTime(dailyRemaining),
            continuous_remaining_formatted: formatTime(contRemaining),
            must_rest_in: formatTime(contRemaining),
            warning_level: warningLevel
        });

    } catch (error) {
        next(error);
    }
});

// ==========================================
// DÍA 34: EL CEREBRO DE LAS PAUSAS (15+30 Y FILTRO ANTI-SEMÁFORO)
// ==========================================

app.get('/api/sessions/check-stop', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query(
            'SELECT current_status, last_status_change FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );
        if (result.rowCount === 0) return res.json({ prompt_rest_warning: false });

        const session = result.rows[0];
        if (session.current_status === 'OTHER_WORK') {
            const now = new Date();
            const lastChange = new Date(session.last_status_change);
            const secondsStopped = Math.floor((now - lastChange) / 1000);

            if (secondsStopped > 180) {
                return res.json({
                    prompt_rest_warning: true,
                    message: `[ATENCIÓN] Llevas ${Math.floor(secondsStopped / 60)} mins detenido. Si vas a hacer pausa, pon el tacógrafo del camión en CAMA y confírmalo en la App para no perder minutos.`
                });
            }
        }
        res.json({ prompt_rest_warning: false });
    } catch (error) { next(error); }
});

app.post('/api/sessions/rest/start', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        await pool.query(
            'UPDATE driver_sessions SET current_status = $1, last_status_change = CURRENT_TIMESTAMP WHERE user_id = $2 AND end_time IS NULL',
            ['RESTING', userId]
        );
        res.json({ success: true, message: 'Modo CAMA activado. Cronómetro de pausa legal iniciado.' });
    } catch (error) { next(error); }
});

app.post('/api/sessions/rest/stop', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Sin jornada activa.' });

        const session = result.rows[0];
        if (session.current_status !== 'RESTING') {
            return res.status(400).json({ success: false, error: 'El tacógrafo no estaba en modo CAMA.' });
        }

        const now = new Date();
        const restStart = new Date(session.last_status_change);
        const restMinutes = Math.floor((now - restStart) / 60000); 

        let breaks = session.split_breaks || [];
        let continuousDriving = session.continuous_driving_seconds;
        let auditMessage = '';

        if (restMinutes >= 45) {
            continuousDriving = 0;
            breaks = [];
            auditMessage = `Descanso completo de ${restMinutes}m validado. Reloj de conducción continua reseteado a 4.5h.`;
        } else if (restMinutes >= 30 && breaks.includes(15)) {
            continuousDriving = 0;
            breaks = [];
            auditMessage = `Segundo bloque de 30m validado (Fraccionado 15+30 completado). Reloj reseteado a 4.5h.`;
        } else if (restMinutes >= 15 && restMinutes < 45 && breaks.length === 0) {
            breaks.push(15);
            auditMessage = `Primer bloque de descanso (mínimo 15m) registrado. El reloj de 4.5h NO se resetea hasta que hagas el segundo bloque de 30m.`;
        } else {
            auditMessage = `Pausa de ${restMinutes}m insuficiente para la ley. No cuenta para el descanso de 45m ni fraccionado.`;
        }

        await pool.query(
            'UPDATE driver_sessions SET current_status = $1, continuous_driving_seconds = $2, split_breaks = $3, last_status_change = CURRENT_TIMESTAMP WHERE id = $4',
            ['OTHER_WORK', continuousDriving, JSON.stringify(breaks), session.id]
        );

        res.json({
            success: true,
            rest_minutes_detected: restMinutes,
            legal_status: auditMessage
        });

    } catch (error) { next(error); }
});

// ==========================================
// DÍA 35: EL MEGA-ENDPOINT DEL HUD (PANEL DE CONTROL)
// ==========================================
app.get('/api/sessions/hud', authenticateJWT, async (req, res, next) => {
    const userId = req.user.user_id || 1;
    const DAILY_LIMIT = 9 * 3600;
    const CONTINUOUS_LIMIT = 4.5 * 3600;

    try {
        const result = await pool.query(
            'SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL',
            [userId]
        );

        if (result.rowCount === 0) {
            return res.json({
                success: true,
                active: false,
                hud_data: {
                    status: 'OFF',
                    daily_remaining: '09:00',
                    continuous_remaining: '04:30',
                    warning_level: 'OK',
                    alerts: []
                }
            });
        }

        const session = result.rows[0];
        const now = new Date();
        const lastChange = new Date(session.last_status_change);
        const secondsElapsed = Math.floor((now - lastChange) / 1000);

        // 1. Calcular tiempos reales al milisegundo para la pantalla
        let currentDaily = session.accumulated_driving_seconds || 0;
        let currentCont = session.continuous_driving_seconds || 0;

        if (session.current_status === 'DRIVING') {
            currentDaily += secondsElapsed;
            currentCont += secondsElapsed;
        }

        let dailyRemaining = Math.max(0, DAILY_LIMIT - currentDaily);
        let contRemaining = Math.max(0, CONTINUOUS_LIMIT - currentCont);

        // 2. Formateador de tiempo bonito para el panel
        const formatTime = (secs) => `${Math.floor(secs / 3600).toString().padStart(2, '0')}:${Math.floor((secs % 3600) / 60).toString().padStart(2, '0')}`;

        // 3. Sistema inteligente de alertas para el HUD
        let warningLevel = 'OK';
        let alerts = [];

        if (contRemaining <= 1800) {
            warningLevel = 'CRITICAL';
            alerts.push('¡PELIGRO! Parada de 45 min obligatoria inminente.');
        } else if (contRemaining <= 3600) {
            warningLevel = 'WARNING';
            alerts.push('Aviso: Busca parking. Descanso requerido en menos de 1 hora.');
        }

        if (session.current_status === 'OTHER_WORK' && secondsElapsed > 180) {
            alerts.push('¿Detenido? Recuerda poner la CAMA si vas a hacer pausa legal.');
        }

        if (session.current_status === 'RESTING') {
            const restMinutes = Math.floor(secondsElapsed / 60);
            alerts.push(`En descanso. Llevas ${restMinutes} minutos de pausa.`);
        }

        // 4. Devolvemos TODO empaquetado para que la App solo tenga que pintar
        res.json({
            success: true,
            active: true,
            hud_data: {
                status: session.current_status,
                daily_driving_accumulated: formatTime(currentDaily),
                daily_remaining: formatTime(dailyRemaining),
                continuous_driving_accumulated: formatTime(currentCont),
                continuous_remaining: formatTime(contRemaining),
                split_breaks_done: session.split_breaks || [],
                warning_level: warningLevel,
                alerts: alerts,
                last_update: now.toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
});

// ==========================================
// DÍA 16 - 28: RIESGOS FÍSICOS Y CAJA NEGRA CON HASH INMUTABLE
// ==========================================
app.post('/api/route', authenticateJWT, async (req, res, next) => {
    const { origin, destination, height_m, weight_t, euro_standard, country_code, departure_time } = req.body;
    const truckHeight = height_m || 4.0; 
    const truckWeight = weight_t || 40.0; 
    const truckEuro = euro_standard || 6; 
    const targetCountry = country_code || 'DEU'; 
    const startTime = departure_time ? new Date(departure_time) : new Date();

    if (!origin || !destination) {
        return res.status(400).json({ success: false, error: 'Se requieren origen y destino.' });
    }

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] Calculando ruta con matriz 3D. Salida: ${startTime.toISOString()}`);
        
        const routeKey = crypto.createHash('sha256').update(`${origin}_${destination}_${truckHeight}_${truckWeight}_${truckEuro}`).digest('hex');
        let routeData;
        
        const cacheResult = await pool.query('SELECT raw_response FROM route_cache WHERE route_key = $1', [routeKey]);
        
        if (cacheResult.rowCount > 0) {
            console.log(`[INFO] [TxID: ${req.correlationId}] ⚡ Ruta recuperada de la caché (Costo HERE API evitado)`);
            routeData = cacheResult.rows[0].raw_response;
        } else {
            console.log(`[INFO] [TxID: ${req.correlationId}] 📡 Consultando HERE API (Nueva ruta)...`);
            routeData = await fetchRouteFromHEREWithRetry(origin, destination);
            
            await pool.query(
                'INSERT INTO route_cache (route_key, raw_response) VALUES ($1, $2) ON CONFLICT (route_key) DO NOTHING', 
                [routeKey, routeData]
            );
        }
        
        const insertQuery = `
            INSERT INTO provider_responses (origin_coords, destination_coords, raw_data)
            VALUES ($1, $2, $3)
            RETURNING id
        `;
        const dbResult = await pool.query(insertQuery, [origin, destination, routeData]);
        const savedId = dbResult.rows[0].id;
        
        console.log(`[INFO] [TxID: ${req.correlationId}] Evaluando Zonas Ambientales y Restricciones de Reloj...`);
        
        const zoneResult = await pool.query('SELECT * FROM environmental_zones WHERE country_code = $1', [targetCountry]);
        const activeZones = zoneResult.rows;
        let requiredEuro = 0;
        if (activeZones.length > 0) {
            requiredEuro = Math.max(...activeZones.map(z => z.min_euro_standard));
        }

        let segmentosGuardados = 0;
        let totalRiskWeighted = 0;
        let totalRouteLength = 0;
        let routeTouchesUrban = false; 
        let environmentalAlert = false;
        let timeAlert = false; 
        
        let accumulatedDurationSeconds = 0; 

        if (routeData.routes && routeData.routes.length > 0) {
            const sections = routeData.routes[0].sections;
            
            for (let i = 0; i < sections.length; i++) {
                const section = sections[i];
                
                const startCoords = section.departure?.place?.location 
                    ? `${section.departure.place.location.lat},${section.departure.place.location.lng}` 
                    : origin;
                const endCoords = section.arrival?.place?.location 
                    ? `${section.arrival.place.location.lat},${section.arrival.place.location.lng}` 
                    : destination;
                const lengthMeters = section.summary?.length || 0;
                const durationSeconds = section.summary?.duration || 0;

                accumulatedDurationSeconds += durationSeconds;
                const segmentTime = new Date(startTime.getTime() + (accumulatedDurationSeconds * 1000));
                const segmentHour = segmentTime.getHours();

                const speedMps = durationSeconds > 0 ? (lengthMeters / durationSeconds) : 0;
                const isUrbanDense = (speedMps > 0 && speedMps < 13.88);
                if (isUrbanDense) routeTouchesUrban = true;

                let segmentHeightLimit = 5.0; 
                if (section.notices && section.notices.some(n => n.title.includes('height'))) {
                    segmentHeightLimit = truckHeight + 0.10; 
                }
                const heightMargin = segmentHeightLimit - truckHeight;
                let heightRiskScore = 0;
                if (heightMargin >= 0.50) heightRiskScore = 0;
                else if (heightMargin <= 0.05) heightRiskScore = 100;
                else heightRiskScore = Math.round(((0.50 - heightMargin) / (0.50 - 0.05)) * 100);

                let segmentWeightLimit = 44.0;
                if (section.notices && section.notices.some(n => n.title.includes('weight'))) {
                    segmentWeightLimit = truckWeight + 0.5;
                }
                const weightMargin = segmentWeightLimit - truckWeight;
                let weightRiskScore = 0;
                if (weightMargin >= 5.0) weightRiskScore = 0;
                else if (weightMargin <= 0.5) weightRiskScore = 100;
                else weightRiskScore = Math.round(((5.0 - weightMargin) / (5.0 - 0.5)) * 100);

                let environmentalRiskScore = 0;
                if (isUrbanDense && requiredEuro > 0) {
                    if (truckEuro < requiredEuro) {
                        environmentalRiskScore = 100; 
                        environmentalAlert = true;
                    } else if (truckEuro === requiredEuro) {
                        environmentalRiskScore = 30;  
                    }
                }

                let timeRestrictionRiskScore = 0;
                if (isUrbanDense && (segmentHour >= 22 || segmentHour < 6)) {
                    timeRestrictionRiskScore = 100;
                    timeAlert = true;
                }

                const physicalRiskScore = Math.max(heightRiskScore, weightRiskScore);
                const contextualRiskScore = Math.max(environmentalRiskScore, timeRestrictionRiskScore);
                const totalSegmentScore = Math.max(physicalRiskScore, contextualRiskScore);

                totalRouteLength += lengthMeters;
                totalRiskWeighted += (totalSegmentScore * lengthMeters);

                const segmentQuery = `
                    INSERT INTO route_segments (
                        response_id, segment_index, start_coords, end_coords, 
                        length_meters, duration_seconds, height_margin_m, 
                        physical_risk_score, weight_margin_t, total_segment_score,
                        is_urban_dense, environmental_risk_score, time_restriction_risk_score
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `;
                await pool.query(segmentQuery, [
                    savedId, 
                    i + 1, 
                    startCoords, 
                    endCoords, 
                    lengthMeters, 
                    durationSeconds, 
                    heightMargin, 
                    physicalRiskScore,
                    weightMargin,
                    totalSegmentScore,
                    isUrbanDense,
                    environmentalRiskScore,
                    timeRestrictionRiskScore 
                ]);
                segmentosGuardados++;
            }
        }

        const finalRouteRisk = totalRouteLength > 0 ? Math.round(totalRiskWeighted / totalRouteLength) : 0;

        const updateRouteQuery = `
            UPDATE provider_responses
            SET total_route_risk = $1
            WHERE id = $2
        `;
        await pool.query(updateRouteQuery, [finalRouteRisk, savedId]);

        // ==========================================
        // DÍA 26, 27 y 28: LA CAJA NEGRA LEGAL CON HASH INMUTABLE
        // ==========================================
        console.log(`[INFO] [TxID: ${req.correlationId}] 🔐 Generando Hash Criptográfico Inmutable (Día 28)...`);
        
        const alertsObj = { 
            urban_zone: routeTouchesUrban, 
            environmental_multa: environmentalAlert, 
            time_restriction: timeAlert 
        };
        const contextObj = { 
            euro_standard: truckEuro, 
            departure_time: startTime.toISOString() 
        };

        const vehicleSnapshotObj = {
            height_m: truckHeight,
            weight_t: truckWeight,
            euro_standard: truckEuro
        };

        const rulesSnapshotObj = {
            country_code: targetCountry,
            required_euro_zone: requiredEuro,
            height_safety_buffer_m: 0.5,
            weight_safety_buffer_t: 5.0,
            night_restriction_start_hour: 22,
            night_restriction_end_hour: 6
        };
        
        // Usamos el JSON determinista ANTES de firmar para que nunca falle la auditoría
        const strAlerts = sortJSON(alertsObj);
        const strContext = sortJSON(contextObj);
        const strVehicle = sortJSON(vehicleSnapshotObj);
        const strRules = sortJSON(rulesSnapshotObj);

        // DÍA 28: El Motor Criptográfico.
        const payloadToHash = `${savedId}_${origin}_${destination}_${finalRouteRisk}_${strAlerts}_${strContext}_${strVehicle}_${strRules}`;
        const decisionHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');
        
        const logQuery = `
            INSERT INTO route_decision_logs (
                response_id, origin_coords, destination_coords, 
                final_risk_score, alerts_triggered, applied_context,
                vehicle_snapshot, rules_snapshot, decision_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        
        // Guardamos los strings ya ordenados en la base de datos
        await pool.query(logQuery, [
            savedId,
            origin,
            destination,
            finalRouteRisk,
            strAlerts,
            strContext,
            strVehicle,
            strRules,
            decisionHash 
        ]);
        // ==========================================
        
        res.json({
            success: true,
            message: 'Ruta calculada y sellada criptográficamente (Día 28).',
            saved_response_id: savedId,
            segments_created: segmentosGuardados,
            final_route_risk: finalRouteRisk,
            alerts: alertsObj,
            applied_context: contextObj,
            hash: decisionHash, // Se lo devolvemos a la App como acuse de recibo
            data: routeData
        });
    } catch (error) {
        error.statusCode = error.response ? error.response.status : 503;
        next(error);
    }
});

// 6. MANEJO GLOBAL DE EXCEPCIONES
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    
    console.error(`❌ [ERROR FATAL] TxID: ${req.correlationId || 'N/A'}`);
    console.error(err.stack);
    
    res.status(statusCode).json({
        success: false,
        error: environment === 'production' ? 'Error interno.' : err.message,
        correlation_id: req.correlationId || 'N/A'
    });
});

app.listen(port, () => {
    console.log(`🚀 API Gateway B2B - Mega-HUD (Día 35) activo en puerto ${port}`);
});