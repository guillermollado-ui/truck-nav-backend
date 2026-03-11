const pool = require('../config/db');

// DÍA 42, 44 Y 45: REPORTE MANUAL Y MOTOR DE CONSENSO B2B
exports.reportHazard = async (req, res, next) => {
    const { lat, lon, type, source } = req.body;
    
    if (!lat || !lon || !type) {
        return res.status(400).json({ success: false, error: 'Coordenadas y tipo requeridos.' });
    }

    const hazardSource = source || 'user_report';
    const confidenceAdded = hazardSource === 'user_report' ? 20 : 15;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Búsqueda espacial: ¿Hay un peligro del mismo tipo a menos de 100 metros en las últimas 24h?
        const searchCmd = `
            SELECT id, confidence_score, report_count
            FROM hazard_candidates
            WHERE type = $1
            AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 100)
            AND last_seen > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            FOR UPDATE
        `;
        const searchRes = await client.query(searchCmd, [type, lat, lon]);

        let finalHazard;

        if (searchRes.rowCount > 0) {
            // FUSIÓN: Ya existía. Sumamos puntuación y reportes.
            const existing = searchRes.rows[0];
            const newScore = existing.confidence_score + confidenceAdded;
            const newCount = existing.report_count + 1;
            let newStatus = 'unverified';

            if (newCount >= 3 || newScore >= 60) {
                newStatus = 'verified_hazard';
            } else if (newScore >= 30) {
                newStatus = 'probable';
            }

            const updateCmd = `
                UPDATE hazard_candidates
                SET confidence_score = $1, report_count = $2, status = $3, last_seen = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING id, type, status, confidence_score, report_count
            `;
            const updateRes = await client.query(updateCmd, [newScore, newCount, newStatus, existing.id]);
            finalHazard = updateRes.rows[0];
            console.log(`[INFO] [TxID: ${req.correlationId}] 🤝 Consenso de Enjambre: Peligro ${existing.id} sube a score ${newScore}. Status: ${newStatus}`);
        } else {
            // NUEVO PELIGRO
            const insertCmd = `
                INSERT INTO hazard_candidates (lat, lon, geom, type, source, confidence_score, status)
                VALUES ($1, $2, ST_SetSRID(ST_MakePoint($2, $1), 4326), $3, $4, $5, $6)
                RETURNING id, type, status, confidence_score, report_count
            `;
            const initialStatus = confidenceAdded >= 30 ? 'probable' : 'unverified';
            const insertRes = await client.query(insertCmd, [lat, lon, type, hazardSource, confidenceAdded, initialStatus]);
            finalHazard = insertRes.rows[0];
            console.log(`[INFO] [TxID: ${req.correlationId}] ⚠️ Nuevo peligro detectado en la red: ${type} en ${lat},${lon}`);
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Reporte procesado por la Mente Colmena.',
            hazard: finalHazard
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
};

// DÍA 41: Escáner espacial (Buscar peligros a X metros de mi camión)
exports.getNearbyHazards = async (req, res, next) => {
    const { lat, lon, radius_meters } = req.query;
    const radius = radius_meters || 5000; 

    if (!lat || !lon) {
        return res.status(400).json({ success: false, error: 'Latitud y longitud requeridas.' });
    }

    try {
        const query = `
            SELECT id, lat, lon, type, confidence_score, report_count, status 
            FROM hazard_candidates 
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
            ORDER BY confidence_score DESC
        `;
        
        const result = await pool.query(query, [lat, lon, radius]);
        
        res.json({
            success: true,
            center: `${lat},${lon}`,
            radius_meters: radius,
            total_hazards: result.rowCount,
            hazards: result.rows
        });
    } catch (error) {
        next(error);
    }
};