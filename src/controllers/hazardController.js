const pool = require('../config/db');

// DÍA 42: Reporte de 1 toque (Rápido y ciego)
exports.reportHazard = async (req, res, next) => {
    const { lat, lon, type, source } = req.body;
    
    if (!lat || !lon || !type) {
        return res.status(400).json({ success: false, error: 'Coordenadas y tipo requeridos.' });
    }

    const hazardSource = source || 'user_report';
    const confidenceBase = hazardSource === 'user_report' ? 20 : 15;

    try {
        // Magia PostGIS: ST_SetSRID y ST_MakePoint convierten lat/lon en geometría pura
        const query = `
            INSERT INTO hazard_candidates (lat, lon, geom, type, source, confidence_score)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($2, $1), 4326), $3, $4, $5)
            RETURNING id, type, status, confidence_score
        `;
        
        const result = await pool.query(query, [lat, lon, type, hazardSource, confidenceBase]);
        
        console.log(`[INFO] [TxID: ${req.correlationId}] ⚠️ Peligro reportado: ${type} en ${lat},${lon}`);
        
        res.status(201).json({
            success: true,
            message: 'Peligro registrado en la Mente Colmena.',
            hazard: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
};

// DÍA 41: Escáner espacial (Buscar peligros a X metros de mi camión)
exports.getNearbyHazards = async (req, res, next) => {
    const { lat, lon, radius_meters } = req.query;
    const radius = radius_meters || 5000; // Por defecto 5km

    if (!lat || !lon) {
        return res.status(400).json({ success: false, error: 'Latitud y longitud requeridas.' });
    }

    try {
        // La consulta que justifica el uso de PostGIS (ST_DWithin usa el índice espacial idx_hazard_geom)
        // Usamos ::geography para calcular la distancia exacta en metros teniendo en cuenta la curvatura de la tierra
        const query = `
            SELECT id, lat, lon, type, confidence_score, status 
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