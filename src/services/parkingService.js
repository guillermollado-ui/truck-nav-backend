const pool = require('../config/db');
const axios = require('axios'); 

const findSafeParkings = async (coords, forceEmpty = false) => {
    if (!coords || forceEmpty) return []; 
    const parts = coords.split(',');
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return [];

    try {
        // --- PASO 1: BÚSQUEDA EN BASE DE DATOS LOCAL ---
        const query = `
            SELECT 
                id, name, CONCAT(lat, ',', lon) as location, 
                security_level, available_spots, amenities,
                ROUND((ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000.0)::numeric, 1) as distance_to_route_km
            FROM parkings
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, 50000)
            ORDER BY distance_to_route_km ASC
            LIMIT 3
        `;
        
        const result = await pool.query(query, [lat, lng]);
        
        if (result.rowCount > 0) {
            console.log(`[INFO] 🎯 ${result.rowCount} Parkings encontrados en DB Local.`);
            return result.rows.map(row => ({
                ...row,
                amenities: typeof row.amenities === 'string' ? JSON.parse(row.amenities) : (row.amenities || [])
            }));
        }

        // --- PASO 2: SI NO HAY NADA EN DB, MINERÍA EN MAPBOX ---
        console.log(`[INFO] 📡 Zona desconocida. Iniciando minería de datos en Mapbox para: ${lat},${lng}`);
        
        // Usamos tu variable exacta de Render
        const mapboxToken = process.env.MAPBOX_TOKEN; 
        
        if (!mapboxToken) {
            console.error("[ERROR] La variable MAPBOX_TOKEN no está definida en Render.");
            return [];
        }

        const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/truck%20parking.json?proximity=${lng},${lat}&limit=5&access_token=${mapboxToken}`;

        const response = await axios.get(mapboxUrl);
        const features = response.data.features || [];

        if (features.length === 0) {
            console.log("[INFO] Mapbox tampoco encontró parkings en esta zona.");
            return [];
        }

        const newParkings = [];

        for (const item of features) {
            const pLon = item.center[0];
            const pLat = item.center[1];
            const pName = item.text || "Parking Externo";
            
            // --- PASO 3: INYECTAR EN LA BASE DE DATOS PARA EL FUTURO ---
            const insertCmd = `
                INSERT INTO parkings (name, lat, lon, geom, security_level, available_spots, amenities)
                VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326), $4, $5, $6)
                ON CONFLICT (name, lat, lon) DO NOTHING
                RETURNING id
            `;
            
            const amenities = JSON.stringify(["Gasolinera", "Info Mapbox"]);
            const resInsert = await pool.query(insertCmd, [pName, pLat, pLon, 'Standard (Auto-detect)', 10, amenities]);

            // Calculamos distancia aproximada para la respuesta inmediata
            const dist = Math.sqrt(Math.pow(pLat - lat, 2) + Math.pow(pLon - lng, 2)) * 111;

            newParkings.push({
                id: resInsert.rowCount > 0 ? resInsert.rows[0].id : null,
                name: pName,
                location: `${pLat},${pLon}`,
                security_level: 'Standard (Auto-detect)',
                available_spots: 10,
                amenities: ["Gasolinera", "Info Mapbox"],
                distance_to_route_km: Math.round(dist * 10) / 10
            });
        }

        console.log(`[INFO] ✅ Minería completada. ${newParkings.length} parkings nuevos listos.`);
        return newParkings;

    } catch (error) {
        console.error(`[ERROR] Fallo en el radar híbrido de parkings:`, error.message);
        return []; 
    }
};

module.exports = { findSafeParkings };