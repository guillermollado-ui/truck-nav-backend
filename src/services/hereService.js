const axios = require('axios');
require('dotenv').config();

const fetchRouteFromHEREWithRetry = async (origin, destination, vehicleData = {}, retries = 3, delay = 1000) => {
    const apiKey = process.env.HERE_API_KEY;
    let url = `https://router.hereapi.com/v8/routes?transportMode=truck&origin=${origin}&destination=${destination}&return=polyline,summary&apikey=${apiKey}`;

    if (vehicleData.height_m) url += `&vehicleHeight=${vehicleData.height_m}`;
    if (vehicleData.weight_t) url += `&vehicleWeight=${vehicleData.weight_t}`;
    if (vehicleData.width_m) url += `&vehicleWidth=${vehicleData.width_m}`;
    if (vehicleData.length_m) url += `&vehicleLength=${vehicleData.length_m}`;
    if (vehicleData.axleCount) url += `&axleCount=${vehicleData.axleCount}`;

    try {
        const response = await axios.get(url, { timeout: 5000 });
        return response.data;
    } catch (error) {
        const isNetworkError = !error.response; 
        const isServerError = error.response && error.response.status >= 500; 

        if ((isNetworkError || isServerError) && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return fetchRouteFromHEREWithRetry(origin, destination, vehicleData, retries - 1, delay * 2);
        } else {
            throw error;
        }
    }
};

module.exports = { fetchRouteFromHEREWithRetry };