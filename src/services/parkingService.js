const crypto = require('crypto');

const findSafeParkings = async (coords, forceEmpty = false) => {
    if (!coords || forceEmpty) return []; 
    const parts = coords.split(',');
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return [];

    return [
        {
            id: crypto.randomUUID(),
            name: "TruckNav Premium SafeHaven",
            location: `${(lat + 0.015).toFixed(4)},${(lng + 0.010).toFixed(4)}`,
            security_level: "Gold (CCTV 24/7 + Vallado)",
            available_spots: 12,
            amenities: ["Duchas limpias", "Restaurante 24h", "Wifi Alta Velocidad"],
            distance_to_route_km: 1.2
        },
        {
            id: crypto.randomUUID(),
            name: "Logistics Rest Area B2B",
            location: `${(lat - 0.010).toFixed(4)},${(lng - 0.020).toFixed(4)}`,
            security_level: "Silver (Vigilancia nocturna)",
            available_spots: 4,
            amenities: ["Cafetería", "Aseos básicos"],
            distance_to_route_km: 2.5
        }
    ];
};

module.exports = { findSafeParkings };