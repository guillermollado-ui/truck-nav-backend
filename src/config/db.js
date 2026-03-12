const { Pool } = require('pg');
require('dotenv').config();

const environment = process.env.NODE_ENV || 'development';

const poolConfig = { 
    connectionString: process.env.DATABASE_URL,
    max: 10, // Bajamos a 10 para no saturar el plan de Render
    idleTimeoutMillis: 30000,
    // 🔥 EL CAMBIO CLAVE: Subimos a 15 segundos de paciencia 🔥
    connectionTimeoutMillis: 15000 
};

if (environment === 'production' || environment === 'staging') {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

// Esta es la parte que daba el error FATAL. Ahora está blindada.
pool.connect()
    .then(client => {
        console.log('✅ [OK] Bóveda de datos conectada (PostgreSQL)');
        client.release();
    })
    .catch(err => {
        console.error('❌ [FATAL] Error de conexión en db.js:', err.message);
    });

module.exports = pool;