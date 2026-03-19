const pool = require('../config/db');
const crypto = require('crypto');
const { sortJSON } = require('../utils/helpers');
const { fetchRouteFromMapboxWithRetry } = require('../services/mapboxService');
const { findSafeParkings } = require('../services/parkingService');
const { getCache, setCache } = require('../services/cacheService'); 

exports.calculateRoute = async (req, res, next) => {
    const userId = req.user.user_id || 1; 
    const { origin, destination, height_m, weight_t, length_m, width_m, axles, euro_standard, country_code, departure_time, force_no_parking } = req.body;
    const txId = req.correlationId; // Identificador de transacción para seguimiento

    console.log(`[DEBUG] [TxID: ${txId}] 🚀 Iniciando calculateRoute para User: ${userId} de ${origin} a ${destination}`);

    const vData = { height_m: height_m || 4.0, weight_t: weight_t || 40.0, length_m, width_m, axleCount: axles, euro_standard: euro_standard || 6 };
    const targetCountry = country_code || 'DEU'; 
    const startTime = departure_time ? new Date(departure_time) : new Date();

    try {
        console.log(`[DEBUG] [TxID: ${txId}] ⏱️ Comprobando sesión del tacógrafo...`);
        let contRem = 4.5 * 3600;
        let dailyRem = 9 * 3600;
        const sessionResult = await pool.query('SELECT accumulated_driving_seconds, continuous_driving_seconds FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        
        if (sessionResult.rowCount > 0) {
            contRem = Math.max(0, (4.5 * 3600) - (sessionResult.rows[0].continuous_driving_seconds || 0));
            dailyRem = Math.max(0, (9 * 3600) - (sessionResult.rows[0].accumulated_driving_seconds || 0));
            console.log(`[DEBUG] [TxID: ${txId}] Sesión activa encontrada. Tiempo cont. restante: ${contRem}s`);
        }

        let timeLimit = Math.min(contRem, dailyRem);

        // ==========================================
        // 🔥 SOLUCIÓN AL FANTASMA DEL CACHE: REDONDEO DE SEGURIDAD 🔥
        // ==========================================
        const roundCoord = (coordStr) => {
            if (!coordStr || !coordStr.includes(',')) return coordStr;
            return coordStr.split(',').map(n => parseFloat(n).toFixed(4)).join(',');
        };

        const cleanOrigin = roundCoord(origin);
        const cleanDest = roundCoord(destination);

        // Generamos el Hash usando las coordenadas redondeadas
        const routeKey = crypto.createHash('sha256')
            .update(`${cleanOrigin}_${cleanDest}_${vData.height_m}_${vData.weight_t}_${vData.euro_standard}`)
            .digest('hex');
        
        let routeData;

        // TURBO REDIS CACHE
        const cachedRoute = await getCache(`route_mapbox_${routeKey}`);
        if (cachedRoute) {
            console.log(`[INFO] [TxID: ${txId}] ⚡ Ruta recuperada de la RAM (Cache Mapbox).`);
            routeData = cachedRoute;
        } else {
            console.log(`[DEBUG] [TxID: ${txId}] Buscando en DB o consultando Mapbox...`);
            const dbCacheResult = await pool.query('SELECT raw_response FROM route_cache WHERE route_key = $1', [routeKey]);
            if (dbCacheResult.rowCount > 0) { 
                routeData = dbCacheResult.rows[0].raw_response; 
                await setCache(`route_mapbox_${routeKey}`, routeData); 
            } else {
                console.log(`[INFO] [TxID: ${txId}] 📡 Llamando a Mapbox Navigation API con reintentos...`);
                routeData = await fetchRouteFromMapboxWithRetry(origin, destination, vData);
                await pool.query('INSERT INTO route_cache (route_key, raw_response) VALUES ($1, $2) ON CONFLICT DO NOTHING', [routeKey, routeData]);
                await setCache(`route_mapbox_${routeKey}`, routeData); 
            }
        }
        
        console.log(`[DEBUG] [TxID: ${txId}] Guardando respuesta bruta del proveedor en DB...`);
        const dbResult = await pool.query('INSERT INTO provider_responses (origin_coords, destination_coords, raw_data) VALUES ($1, $2, $3) RETURNING id', [origin, destination, routeData]);
        const savedId = dbResult.rows[0].id;
        
        let accDuration = 0; 
        let interceptCoords = null; 
        let isViable = true;
        let totalRisk = 0;
        let routePolylines = []; 

        if (routeData.routes && routeData.routes.length > 0) {
            const legs = routeData.routes[0].legs || [];
            console.log(`[DEBUG] [TxID: ${txId}] Procesando ${legs.length} tramos (legs) de la ruta de Mapbox.`);
            
            // Mapbox trae una geometría global por ruta
            if (routeData.routes[0].geometry) {
                routePolylines.push(routeData.routes[0].geometry);
            }

            for (let i = 0; i < legs.length; i++) {
                // Iteramos por los steps para mayor precisión en el punto de intercepción
                const steps = legs[i].steps || [];
                for (let j = 0; j < steps.length; j++) {
                    accDuration += steps[j].duration || 0;
                    if (timeLimit > 0 && accDuration >= timeLimit && !interceptCoords) {
                        // Mapbox usa [lon, lat] en maneuver.location
                        const loc = steps[j].maneuver.location; 
                        interceptCoords = `${loc[1]},${loc[0]}`; 
                        console.log(`[DEBUG] [TxID: ${txId}] Punto de intercepción legal detectado en: ${interceptCoords}`);
                    }
                }
            }
        }
        
        // ESCÁNER ESPACIAL DEL PASILLO (200 METROS)
        console.log(`[DEBUG] [TxID: ${txId}] Ejecutando Escáner Espacial PostGIS...`);
        let routeHazards = [];
        const [lat1, lon1] = origin.split(',');
        const [lat2, lon2] = destination.split(',');

        const pasilloQuery = `
            SELECT id, type, lat, lon, confidence_score 
            FROM hazard_candidates 
            WHERE status = 'verified_hazard'
            AND ST_DWithin(
                geom::geography, 
                ST_MakeLine(ST_SetSRID(ST_MakePoint($2, $1), 4326), ST_SetSRID(ST_MakePoint($4, $3), 4326))::geography, 
                200
            )
        `;
        const pasilloResult = await pool.query(pasilloQuery, [lat1, lon1, lat2, lon2]);
        if (pasilloResult.rowCount > 0) {
            routeHazards = pasilloResult.rows;
            console.log(`[INFO] [TxID: ${txId}] ⚠️ ${routeHazards.length} peligros encontrados a <200m.`);
            totalRisk += (routeHazards.length * 20); 
        }

        let warning = null;
        let parkings = [];
        const exceedsLimits = (accDuration > contRem || accDuration > dailyRem);

        if (exceedsLimits) {
            console.log(`[DEBUG] [TxID: ${txId}] 🛑 LÍMITE EXCEDIDO. Buscando parkings seguros...`);
            warning = `¡ALERTA LEGAL! Ruta supera tu límite. Parada obligatoria.`;
            if (interceptCoords) {
                parkings = await findSafeParkings(interceptCoords, force_no_parking === true);
                console.log(`[DEBUG] [TxID: ${txId}] Parkings encontrados: ${parkings.length}`);
            }
            if (parkings.length === 0) {
                isViable = false; 
                totalRisk = 100; 
                warning = `¡BLOQUEO! Riesgo de multa inminente. RUTA INVIABLE.`;
                console.log(`[DEBUG] [TxID: ${txId}] Ruta marcada como INVIABLE (No hay parkings).`);
            }
        }

        // Estructura para la Caja Negra Forense
        const alertsObj = { route_exceeds_limits: exceedsLimits, route_is_viable: isViable, no_safe_parking: !isViable, hazards_on_route: routeHazards.length };
        const contextObj = { euro_standard: vData.euro_standard, departure_time: startTime.toISOString() };
        const vehicleSnapshotObj = { height_m: vData.height_m, weight_t: vData.weight_t, euro_standard: vData.euro_standard };
        const rulesSnapshotObj = { country_code: targetCountry, required_euro_zone: 0, height_safety_buffer_m: 0.5, weight_safety_buffer_t: 5.0, night_restriction_start_hour: 22, night_restriction_end_hour: 6 };

        const payloadToHash = `${savedId}_${origin}_${destination}_${totalRisk}_${sortJSON(alertsObj)}_${sortJSON(contextObj)}_${sortJSON(vehicleSnapshotObj)}_${sortJSON(rulesSnapshotObj)}`;
        const decisionHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');
        
        console.log(`[DEBUG] [TxID: ${txId}] Guardando Log de Decisión (Caja Negra)...`);
        const logQuery = `
            INSERT INTO route_decision_logs (
                response_id, origin_coords, destination_coords, 
                final_risk_score, alerts_triggered, applied_context,
                vehicle_snapshot, rules_snapshot, decision_hash
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        
        await pool.query(logQuery, [
            savedId, origin, destination, totalRisk, 
            sortJSON(alertsObj), sortJSON(contextObj), sortJSON(vehicleSnapshotObj), sortJSON(rulesSnapshotObj), decisionHash 
        ]);
        
        console.log(`[DEBUG] [TxID: ${txId}] ✅ Cálculo finalizado. Enviando respuesta JSON a la App. Polilíneas: ${routePolylines.length}`);
        
        res.json({ 
            success: true, 
            message: isViable ? 'Ruta sellada.' : 'Ruta BLOQUEADA.', 
            legal_warning: warning, 
            intercept_point_coords: interceptCoords, 
            suggest_parkings: parkings, 
            hazards_on_route: routeHazards, 
            final_route_risk: totalRisk, 
            hash: decisionHash,
            route_polylines: routePolylines,
            raw_route_data: routeData.routes && routeData.routes.length > 0 ? routeData.routes[0] : null,
            full_mapbox_response: routeData // 🎁 Añadido extra para que el SDK de Android tenga todo el objeto JSON original por si lo necesita
        });

    } catch (error) { 
        console.error(`[ERROR] [TxID: ${txId}] Fallo crítico en calculateRoute:`, error.message);
        next(error); 
    }
};

exports.getRouteMaster = async (req, res, next) => {
    try {
        const route = await pool.query('SELECT * FROM provider_responses WHERE id = $1', [req.params.id]);
        if (route.rowCount === 0) return res.status(404).json({ success: false });
        res.json({ success: true, route: route.rows[0] });
    } catch (error) { next(error); }
};

exports.getAudit = async (req, res, next) => {
    try {
        const audit = await pool.query('SELECT * FROM route_decision_logs WHERE response_id = $1', [req.params.response_id]);
        if (audit.rowCount === 0) return res.status(404).json({ success: false });
        res.json({ success: true, audit_record: audit.rows[0] });
    } catch (error) { next(error); }
};