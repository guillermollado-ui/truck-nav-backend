const pool = require('../config/db');

exports.startSession = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        await pool.query('UPDATE driver_sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = $1 AND end_time IS NULL', [userId]);
        const result = await pool.query('INSERT INTO driver_sessions (user_id, current_status) VALUES ($1, $2) RETURNING id, start_time', [userId, 'OFF']);
        res.status(201).json({ success: true, message: 'Jornada iniciada', session_id: result.rows[0].id });
    } catch (error) { next(error); }
};

exports.stopSession = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('UPDATE driver_sessions SET end_time = CURRENT_TIMESTAMP, current_status = $1 WHERE user_id = $2 AND end_time IS NULL RETURNING id, end_time', ['OFF', userId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'No hay jornada activa.' });
        res.json({ success: true, message: 'Jornada cerrada', session_id: result.rows[0].id });
    } catch (error) { next(error); }
};

exports.getStatus = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (result.rowCount === 0) return res.json({ success: true, active: false, status: 'OFF' });
        const s = result.rows[0];
        res.json({ success: true, active: true, session_id: s.id, status: s.current_status, continuous_driving_seconds: s.continuous_driving_seconds });
    } catch (error) { next(error); }
};

exports.timeJump = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    const { hours_to_jump } = req.body; 
    try {
        if (!hours_to_jump) return res.status(400).json({error: 'Faltan horas'});
        const result = await pool.query(
            `UPDATE driver_sessions SET last_status_change = last_status_change - INTERVAL '${hours_to_jump} hours' WHERE user_id = $1 AND end_time IS NULL RETURNING current_status`, [userId]
        );
        if (result.rowCount === 0) return res.status(404).json({error: 'Sin jornada activa'});
        res.json({ success: true, message: `Viaje de +${hours_to_jump}h completado.` });
    } catch (error) { next(error); }
};

// ==========================================
// DÍA 40 Y 43: TELEMETRÍA AVANZADA + AUTO-FRENADO PASIVO
// ==========================================
exports.telemetry = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    const currentSpeed = req.body.speed_kmh || 0;
    
    // DÍA 43: Parámetros nuevos para la Inteligencia Pasiva
    const prevSpeed = req.body.prev_speed_kmh;
    const lat = req.body.lat;
    const lon = req.body.lon;

    const client = await pool.connect(); 

    try {
        await client.query('BEGIN'); 
        const sessionResult = await client.query('SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL FOR UPDATE', [userId]);
        
        if (sessionResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Sin jornada activa.' });
        }

        const session = sessionResult.rows[0];
        const secondsElapsed = Math.floor((new Date() - new Date(session.last_status_change)) / 1000);
        let newStatus = session.current_status;
        let addedSeconds = 0;
        let totalDriving = session.accumulated_driving_seconds || 0;
        let contDriving = session.continuous_driving_seconds || 0;
        let isTunnel = false;
        
        // Túneles (Día 40)
        if (secondsElapsed > 120 && session.current_status === 'DRIVING' && currentSpeed > 10) isTunnel = true;

        if (currentSpeed > 10) {
            if (session.current_status === 'DRIVING') { addedSeconds = secondsElapsed; totalDriving += addedSeconds; contDriving += addedSeconds; }
            else { newStatus = 'DRIVING'; }
        } else {
            if (session.current_status === 'DRIVING') { addedSeconds = secondsElapsed; totalDriving += addedSeconds; contDriving += addedSeconds; newStatus = 'OTHER_WORK'; }
            else if (session.current_status !== 'RESTING' && session.current_status !== 'OFF') { newStatus = 'OTHER_WORK'; }
        }

        if (addedSeconds > 0 || newStatus !== session.current_status) {
            await client.query(
                'UPDATE driver_sessions SET current_status = $1, accumulated_driving_seconds = $2, continuous_driving_seconds = $3, last_status_change = CURRENT_TIMESTAMP WHERE id = $4',
                [newStatus, totalDriving, contDriving, session.id]
            );
        }

        // ==========================================
        // DÍA 43: DETECCIÓN AUTOMÁTICA DE FRENADO (MINERÍA PASIVA)
        // ==========================================
        let autoHazardCreated = false;
        if (prevSpeed !== undefined && lat && lon) {
            const speedDrop = prevSpeed - currentSpeed;
            // Si la caída de velocidad es de 20 km/h o más entre pings
            if (speedDrop >= 20) {
                console.log(`[INFO] [TxID: ${req.correlationId}] 🚨 AUTO-FRENADO DETECTADO: Caída de ${speedDrop} km/h en ${lat},${lon}. Generando inteligencia...`);
                
                const hazardQuery = `
                    INSERT INTO hazard_candidates (lat, lon, geom, type, source, confidence_score)
                    VALUES ($1, $2, ST_SetSRID(ST_MakePoint($2, $1), 4326), $3, $4, $5)
                `;
                // Fuente: auto_braking | Confianza Base: 15 (un poco menor que reporte humano)
                await client.query(hazardQuery, [lat, lon, 'brake_hotspot', 'auto_braking', 15]);
                autoHazardCreated = true;
            }
        }

        await client.query('COMMIT'); 
        res.json({ 
            success: true, 
            telemetry: { 
                current_speed_kmh: currentSpeed, 
                new_status: newStatus, 
                continuous_driving_seconds: contDriving, 
                tunnel_recovery_applied: isTunnel,
                passive_hazard_detected: autoHazardCreated // Avisamos a la app de que cazamos el frenazo
            } 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally { client.release(); }
};

exports.getRemaining = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('SELECT accumulated_driving_seconds, continuous_driving_seconds FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (result.rowCount === 0) return res.json({ success: false, error: 'Sin jornada.' });
        const s = result.rows[0];
        let daily = Math.max(0, (9 * 3600) - (s.accumulated_driving_seconds || 0));
        let cont = Math.max(0, (4.5 * 3600) - (s.continuous_driving_seconds || 0));
        const ft = (secs) => `${Math.floor(secs / 3600).toString().padStart(2, '0')}:${Math.floor((secs % 3600) / 60).toString().padStart(2, '0')}`;
        res.json({ success: true, daily_remaining: ft(daily), continuous_remaining: ft(cont) });
    } catch (error) { next(error); }
};

exports.startRest = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        await pool.query('UPDATE driver_sessions SET current_status = $1, last_status_change = CURRENT_TIMESTAMP WHERE user_id = $2 AND end_time IS NULL', ['RESTING', userId]);
        res.json({ success: true, message: 'Modo CAMA activado.' });
    } catch (error) { next(error); }
};

exports.stopRest = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (result.rowCount === 0) return res.status(404).json({ success: false });
        const session = result.rows[0];
        if (session.current_status !== 'RESTING') return res.status(400).json({ success: false, error: 'No estabas en CAMA.' });

        const restMinutes = Math.floor((new Date() - new Date(session.last_status_change)) / 60000); 
        let breaks = session.split_breaks || [];
        let contDriving = session.continuous_driving_seconds;
        let msg = '';

        if (restMinutes >= 45) { contDriving = 0; breaks = []; msg = `Descanso 45m validado.`; }
        else if (restMinutes >= 30 && breaks.includes(15)) { contDriving = 0; breaks = []; msg = `Segundo bloque 30m validado.`; }
        else if (restMinutes >= 15 && restMinutes < 45 && breaks.length === 0) { breaks.push(15); msg = `Primer bloque 15m registrado.`; }
        else { msg = `Pausa insuficiente.`; }

        await pool.query('UPDATE driver_sessions SET current_status = $1, continuous_driving_seconds = $2, split_breaks = $3, last_status_change = CURRENT_TIMESTAMP WHERE id = $4', ['OTHER_WORK', contDriving, JSON.stringify(breaks), session.id]);
        res.json({ success: true, rest_minutes_detected: restMinutes, legal_status: msg });
    } catch (error) { next(error); }
};

exports.getHud = async (req, res, next) => {
    const userId = req.user.user_id || 1;
    try {
        const result = await pool.query('SELECT * FROM driver_sessions WHERE user_id = $1 AND end_time IS NULL', [userId]);
        if (result.rowCount === 0) return res.json({ success: true, active: false });
        const s = result.rows[0];
        const secsElapsed = Math.floor((new Date() - new Date(s.last_status_change)) / 1000);
        let daily = s.accumulated_driving_seconds || 0;
        let cont = s.continuous_driving_seconds || 0;
        if (s.current_status === 'DRIVING') { daily += secsElapsed; cont += secsElapsed; }
        
        let remDaily = Math.max(0, (9*3600) - daily);
        let remCont = Math.max(0, (4.5*3600) - cont);
        const ft = (secs) => `${Math.floor(secs / 3600).toString().padStart(2, '0')}:${Math.floor((secs % 3600) / 60).toString().padStart(2, '0')}`;
        
        let level = 'OK';
        let alerts = [];
        if (remCont <= 1800) { level = 'CRITICAL'; alerts.push('¡PELIGRO! Parada de 45 min inminente.'); }
        else if (remCont <= 3600) { level = 'WARNING'; alerts.push('Busca parking en breve.'); }

        res.json({ success: true, active: true, hud_data: { status: s.current_status, daily_driving_accumulated: ft(daily), daily_remaining: ft(remDaily), continuous_remaining: ft(remCont), warning_level: level, alerts: alerts } });
    } catch (error) { next(error); }
};