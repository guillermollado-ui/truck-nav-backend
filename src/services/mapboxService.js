const axios = require('axios');

exports.fetchRouteFromMapboxWithRetry = async (origin, destination, vData, retries = 3) => {
    const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN; // Asegúrate de tenerlo en tu .env
    
    // ⚠️ CRÍTICO: Tu app y DB usan 'lat,lon', pero Mapbox exige 'lon,lat'
    const [lat1, lon1] = origin.split(',');
    const [lat2, lon2] = destination.split(',');

    // Usamos 'driving-traffic' que es el perfil de Mapbox que admite restricciones de camión
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${lon1},${lat1};${lon2},${lat2}`;
    
    const params = {
        access_token: MAPBOX_TOKEN,
        geometries: 'polyline6',
        overview: 'full',
        steps: 'true', // Activa el turn-by-turn
        voice_instructions: 'true', // Activa la voz de Alice
        banner_instructions: 'true',
        language: 'es',
        // Inyección de parámetros de camión para seguridad
        max_height: vData.height_m,
        max_weight: vData.weight_t,
        max_width: vData.width_m || 2.5
    };

    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { params });
            return response.data;
        } catch (error) {
            console.warn(`[WARNING] Fallo en Mapbox API (Intento ${i + 1}/${retries}): ${error.message}`);
            if (i === retries - 1) throw new Error('Error crítico conectando con Mapbox Navigation API');
        }
    }
};