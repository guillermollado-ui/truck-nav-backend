const axios = require('axios');

exports.fetchRouteFromMapboxWithRetry = async (origin, destination, vData, retries = 3) => {
    const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN; // Asegúrate de tenerlo en tu .env
    
    // ⚠️ CRÍTICO: Tu app y DB usan 'lat,lon', pero Mapbox exige 'lon,lat'
    const [lat1, lon1] = origin.split(',');
    const [lat2, lon2] = destination.split(',');

    // Usamos 'driving-traffic' que es el perfil de Mapbox que admite restricciones
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
            const mapboxData = response.data;

            // ==========================================
            // 🔥 EL FACTOR CAMIÓN: LIMITADOR A 90 KM/H 🔥
            // ==========================================
            // 90 km/h equivalen exactamente a 25 metros por segundo.
            const MAX_SPEED_MS = 25.0; 

            if (mapboxData.routes && mapboxData.routes.length > 0) {
                mapboxData.routes.forEach(route => {
                    let totalRouteDuration = 0;

                    if (route.legs) {
                        route.legs.forEach(leg => {
                            let totalLegDuration = 0;

                            if (leg.steps) {
                                leg.steps.forEach(step => {
                                    // Calculamos la velocidad que Mapbox estimó para este tramo
                                    // (Evitamos dividir por cero usando un mínimo de 1 segundo)
                                    const currentSpeedMs = step.distance / (step.duration || 1);

                                    // Si Mapbox asume que el vehículo irá a más de 90 km/h (ej. Autopista)...
                                    if (currentSpeedMs > MAX_SPEED_MS) {
                                        // Recalculamos el tiempo que tardaría un camión a máxima velocidad legal
                                        step.duration = step.distance / MAX_SPEED_MS;
                                    }

                                    // Sumamos el tiempo real al total del tramo
                                    totalLegDuration += step.duration;
                                });
                            }
                            
                            // Actualizamos el tiempo total del tramo (Leg)
                            leg.duration = totalLegDuration;
                            totalRouteDuration += totalLegDuration;
                        });
                    }

                    // Actualizamos el tiempo total del viaje completo
                    route.duration = totalRouteDuration;
                });
            }

            console.log(`[INFO] ⏱️ Factor Camión aplicado: Tiempos recalculados a max 90 km/h.`);
            return mapboxData;

        } catch (error) {
            console.warn(`[WARNING] Fallo en Mapbox API (Intento ${i + 1}/${retries}): ${error.message}`);
            if (i === retries - 1) throw new Error('Error crítico conectando con Mapbox Navigation API');
        }
    }
};