const pool = require('../config/db');

const findSafeParkings = async (coords, forceEmpty = false) => {
    if (!coords || forceEmpty) return []; 
    const parts = coords.split(',');
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return [];

    try {
        // 🚀 BÚSQUEDA ESPACIAL REAL EN POSTGIS (Radio de 50km desde el punto de intercepción)
        const query = `
            SELECT 
                id, 
                name, 
                CONCAT(lat, ',', lon) as location, 
                security_level, 
                available_spots, 
                amenities,
                ROUND((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000.0)::numeric, 1) as distance_to_route_km
            FROM parkings
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 50000)
            ORDER BY distance_to_route_km ASC
            LIMIT 3
        `;
        
        const result = await pool.query(query, [lat, lng]);
        
        // Transformamos el resultado para asegurar que "amenities" sea un array (por si en PostgreSQL está como JSON/Texto)
        return result.rows.map(row => ({
            ...row,
            amenities: typeof row.amenities === 'string' ? JSON.parse(row.amenities) : (row.amenities || [])
        }));
        
    } catch (error) {
        console.error(`[ERROR] Fallo al buscar parkings reales en DB para coords ${coords}:`, error.message);
        // 🛑 MECANISMO DE SEGURIDAD: Si la tabla no existe o hay error, no tumbamos el servidor.
        return []; 
    }
};

module.exports = { findSafeParkings };