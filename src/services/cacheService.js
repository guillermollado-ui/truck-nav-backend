const { createClient } = require('redis');

let redisClient;
let memoryFallback = new Map(); // El paracaídas de emergencia

// Inicializamos Redis si existe la variable de entorno en Producción
if (process.env.REDIS_URL) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    
    redisClient.on('error', (err) => {
        console.warn('⚠️ [CACHE] Redis no disponible. Usando Memoria Local (Fallback).');
    });

    redisClient.connect()
        .then(() => console.log('⚡ [OK] Motor Cache Redis conectado a hipervelocidad.'))
        .catch(() => {});
}

// Guardar en Caché (TTL por defecto: 30 minutos)
const setCache = async (key, value, ttlSeconds = 1800) => {
    try {
        if (redisClient && redisClient.isOpen) {
            await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
        } else {
            memoryFallback.set(key, value);
            setTimeout(() => memoryFallback.delete(key), ttlSeconds * 1000);
        }
    } catch (error) {
        console.error('❌ [CACHE ERROR] Al guardar:', error.message);
    }
};

// Leer de Caché
const getCache = async (key) => {
    try {
        if (redisClient && redisClient.isOpen) {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data) : null;
        }
        return memoryFallback.get(key) || null;
    } catch (error) {
        console.error('❌ [CACHE ERROR] Al leer:', error.message);
        return null;
    }
};

module.exports = { setCache, getCache };