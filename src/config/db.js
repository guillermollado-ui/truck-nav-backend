const { Pool } = require('pg');
require('dotenv').config();

const environment = process.env.NODE_ENV || 'development';

const poolConfig = { 
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
};

if (environment === 'production' || environment === 'staging') {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.connect()
    .then(() => console.log('✅ [OK] Bóveda de datos conectada (PostgreSQL) - Estructura Modular'))
    .catch(err => console.error('❌ [FATAL] Error conectando a la base de datos', err.stack));

module.exports = pool;