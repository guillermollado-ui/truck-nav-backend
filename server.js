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
// DÍA 12, 16 Y 17: MANEJO ROBUSTO Y REINTENTOS EXPONENCIALES PARA HERE API
// ==========================================
const fetchRouteFromHEREWithRetry = async (origin, destination, retries = 3, delay = 1000) => {
    const apiKey = process.env.HERE_API_KEY;
    if (!apiKey) {
        throw new Error('HERE_API_KEY no configurada en el servidor.');
    }

    // URL ultra-estable de HERE (v8)
    const url = `https://router.hereapi.com/v8/routes?transportMode=truck&origin=${origin}&destination=${destination}&return=polyline,summary&apikey=${apiKey}`;

    try {
        const response = await axios.get(url);
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
// DÍA 16 - 23: RIESGO PROGRESIVO, DETECCIÓN URBANA Y MULTAS ZBE
// ==========================================
app.post('/api/route', authenticateJWT, async (req, res, next) => {
    // DÍA 23: Extraemos el estándar Euro del motor y el país para la ZBE
    const { origin, destination, height_m, weight_t, euro_standard, country_code } = req.body;
    const truckHeight = height_m || 4.0; 
    const truckWeight = weight_t || 40.0; 
    const truckEuro = euro_standard || 6; // Por defecto asumimos el motor más limpio (Euro 6)
    const targetCountry = country_code || 'DEU'; // Para nuestra prueba en Berlín, asumimos DEU

    if (!origin || !destination) {
        return res.status(400).json({ success: false, error: 'Se requieren origen y destino.' });
    }

    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] Calculando ruta para camión (H: ${truckHeight}m, W: ${truckWeight}t, Euro: ${truckEuro})`);
        const routeData = await fetchRouteFromHEREWithRetry(origin, destination);
        
        const insertQuery = `
            INSERT INTO provider_responses (origin_coords, destination_coords, raw_data)
            VALUES ($1, $2, $3)
            RETURNING id
        `;
        const dbResult = await pool.query(insertQuery, [origin, destination, routeData]);
        const savedId = dbResult.rows[0].id;
        
        console.log(`[INFO] [TxID: ${req.correlationId}] Evaluando Zonas Ambientales (Día 23)...`);
        
        // --- DÍA 23: PRECARGA DE LEYES AMBIENTALES ---
        // Consultamos qué pide la ZBE más estricta de este país
        const zoneResult = await pool.query('SELECT * FROM environmental_zones WHERE country_code = $1', [targetCountry]);
        const activeZones = zoneResult.rows;
        let requiredEuro = 0;
        if (activeZones.length > 0) {
            // Buscamos la exigencia más alta para protegernos en el peor escenario
            requiredEuro = Math.max(...activeZones.map(z => z.min_euro_standard));
        }

        let segmentosGuardados = 0;
        let totalRiskWeighted = 0;
        let totalRouteLength = 0;
        let routeTouchesUrban = false; 
        let environmentalAlert = false;

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

                // --- RADAR DE ZONA URBANA DENSA (Día 22) ---
                const speedMps = durationSeconds > 0 ? (lengthMeters / durationSeconds) : 0;
                const isUrbanDense = (speedMps > 0 && speedMps < 13.88);
                if (isUrbanDense) routeTouchesUrban = true;

                // --- 1. RIESGO PROGRESIVO DE ALTURA ---
                let segmentHeightLimit = 5.0; 
                if (section.notices && section.notices.some(n => n.title.includes('height'))) {
                    segmentHeightLimit = truckHeight + 0.10; 
                }
                const heightMargin = segmentHeightLimit - truckHeight;
                let heightRiskScore = 0;
                if (heightMargin >= 0.50) heightRiskScore = 0;
                else if (heightMargin <= 0.05) heightRiskScore = 100;
                else heightRiskScore = Math.round(((0.50 - heightMargin) / (0.50 - 0.05)) * 100);

                // --- 2. RIESGO PROGRESIVO DE PESO ---
                let segmentWeightLimit = 44.0;
                if (section.notices && section.notices.some(n => n.title.includes('weight'))) {
                    segmentWeightLimit = truckWeight + 0.5;
                }
                const weightMargin = segmentWeightLimit - truckWeight;
                let weightRiskScore = 0;
                if (weightMargin >= 5.0) weightRiskScore = 0;
                else if (weightMargin <= 0.5) weightRiskScore = 100;
                else weightRiskScore = Math.round(((5.0 - weightMargin) / (5.0 - 0.5)) * 100);

                // --- 3. RIESGO AMBIENTAL Y MULTAS ZBE (DÍA 23) ---
                let environmentalRiskScore = 0;
                // Si estamos en la ciudad y hay una ley ambiental activa...
                if (isUrbanDense && requiredEuro > 0) {
                    if (truckEuro < requiredEuro) {
                        environmentalRiskScore = 100; // ¡Multa segura! El motor es demasiado viejo
                        environmentalAlert = true;
                    } else if (truckEuro === requiredEuro) {
                        environmentalRiskScore = 30;  // Pasa por los pelos
                    } else {
                        environmentalRiskScore = 0;   // Motor limpio y seguro
                    }
                }

                // --- 4. VEREDICTO FINAL: PRINCIPIO DE MÁXIMO PELIGRO ---
                const physicalRiskScore = Math.max(heightRiskScore, weightRiskScore);
                // El score total ahora tiene en cuenta tanto que no choques como que no te multen
                const totalSegmentScore = Math.max(physicalRiskScore, environmentalRiskScore);

                // --- 5. ACUMULACIÓN PARA LA PONDERACIÓN ---
                totalRouteLength += lengthMeters;
                totalRiskWeighted += (totalSegmentScore * lengthMeters);

                // Insertamos en la Bóveda con la nueva columna ambiental
                const segmentQuery = `
                    INSERT INTO route_segments (
                        response_id, segment_index, start_coords, end_coords, 
                        length_meters, duration_seconds, height_margin_m, 
                        physical_risk_score, weight_margin_t, total_segment_score,
                        is_urban_dense, environmental_risk_score
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
                    environmentalRiskScore // El dato fresco del Día 23
                ]);
                segmentosGuardados++;
            }
        }

        // --- CÁLCULO FINAL DE LA RUTA Y ACTUALIZACIÓN EN BÓVEDA ---
        const finalRouteRisk = totalRouteLength > 0 ? Math.round(totalRiskWeighted / totalRouteLength) : 0;

        const updateRouteQuery = `
            UPDATE provider_responses
            SET total_route_risk = $1
            WHERE id = $2
        `;
        await pool.query(updateRouteQuery, [finalRouteRisk, savedId]);
        
        res.json({
            success: true,
            message: 'Ruta calculada con análisis físico y ambiental (ZBE) completado (Día 23).',
            saved_response_id: savedId,
            segments_created: segmentosGuardados,
            final_route_risk: finalRouteRisk,
            urban_zone_detected: routeTouchesUrban,
            environmental_alert: environmentalAlert,
            applied_context: {
                euro_standard: truckEuro,
                required_euro: requiredEuro
            },
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
    res.status(statusCode).json({
        success: false,
        error: environment === 'production' ? 'Error interno.' : err.message,
        correlation_id: req.correlationId || 'N/A'
    });
});

app.listen(port, () => {
    console.log(`🚀 API Gateway B2B - Riesgo Ambiental Activo (Día 23) en puerto ${port}`);
});