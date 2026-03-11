const pool = require('../config/db');
const crypto = require('crypto');
const { sortJSON } = require('../utils/helpers');
const { fetchRouteFromHEREWithRetry } = require('../services/hereService');
const { findSafeParkings } = require('../services/parkingService');

exports.calculateRoute = async (req, res, next) => {
    const userId = req.user.user_id || 1; 
    const { origin, destination, height_m, weight_t, length_m, width_m, axles, euro_standard, country_code, departure_time, force_no_parking } = req.body;
    
    const vData = { height_m: height_m || 4.0, weight_t: weight_t || 40.0, length_m, width_m, axleCount: axles, euro_standard: euro_standard || 6 };
    const targetCountry = country_code || 'DEU'; 

    try {
        let contRem = 4.5 * 3600;
        let dailyRem = 9 * 3600;
        const sessionResult = await pool.query('SELECT accumulated_driving_seconds, continuous_driving_seconds FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (sessionResult.rowCount > 0) {
            contRem = Math.max(0, (4.5 * 3600) - (sessionResult.rows[0].continuous_driving_seconds || 0));
            dailyRem = Math.max(0, (9 * 3600) - (sessionResult.rows[0].accumulated_driving_seconds || 0));
        }
        let timeLimit = Math.min(contRem, dailyRem);
        
        const routeKey = crypto.createHash('sha256').update(`${origin}_${destination}_${vData.height_m}_${vData.weight_t}_${vData.euro_standard}`).digest('hex');
        let routeData;
        const cacheResult = await pool.query('SELECT raw_response FROM route_cache WHERE route_key = $1', [routeKey]);
        
        if (cacheResult.rowCount > 0) { routeData = cacheResult.rows[0].raw_response; } 
        else {
            routeData = await fetchRouteFromHEREWithRetry(origin, destination, vData);
            await pool.query('INSERT INTO route_cache (route_key, raw_response) VALUES ($1, $2) ON CONFLICT DO NOTHING', [routeKey, routeData]);
        }
        
        const dbResult = await pool.query('INSERT INTO provider_responses (origin_coords, destination_coords, raw_data) VALUES ($1, $2, $3) RETURNING id', [origin, destination, routeData]);
        const savedId = dbResult.rows[0].id;
        
        let accDuration = 0; 
        let interceptCoords = null; 
        let isViable = true;
        let totalRisk = 0;

        if (routeData.routes && routeData.routes.length > 0) {
            const sections = routeData.routes[0].sections;
            for (let i = 0; i < sections.length; i++) {
                accDuration += sections[i].summary?.duration || 0;
                if (timeLimit > 0 && accDuration >= timeLimit && !interceptCoords) {
                    interceptCoords = `${sections[i].arrival?.place?.location?.lat},${sections[i].arrival?.place?.location?.lng}`; 
                }
            }
        }
        
        let warning = null;
        let parkings = [];
        if (accDuration > contRem || accDuration > dailyRem) {
            warning = `¡ALERTA LEGAL! Ruta supera tu límite. Parada obligatoria.`;
            if (interceptCoords) parkings = await findSafeParkings(interceptCoords, force_no_parking === true);
            if (parkings.length === 0) {
                isViable = false; totalRisk = 100; warning = `¡BLOQUEO! Riesgo de multa inminente. RUTA INVIABLE.`;
            }
        }

        const alertsObj = { route_exceeds_limits: true, route_is_viable: isViable, no_safe_parking: !isViable };
        const payloadToHash = `${savedId}_${origin}_${destination}_${totalRisk}_${sortJSON(alertsObj)}`;
        const decisionHash = crypto.createHash('sha256').update(payloadToHash).digest('hex');
        
        await pool.query('INSERT INTO route_decision_logs (response_id, origin_coords, destination_coords, final_risk_score, alerts_triggered, decision_hash) VALUES ($1, $2, $3, $4, $5, $6)', [savedId, origin, destination, totalRisk, sortJSON(alertsObj), decisionHash]);
        
        res.json({ success: true, message: isViable ? 'Ruta sellada.' : 'Ruta BLOQUEADA.', legal_warning: warning, intercept_point_coords: interceptCoords, suggested_parkings: parkings, final_route_risk: totalRisk, hash: decisionHash });
    } catch (error) { next(error); }
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