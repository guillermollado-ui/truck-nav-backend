const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// 🔥 CONFIGURACIÓN BLINDADA PARA EVITAR EL TIMEOUT EN RENDER 🔥
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, // 10 segundos de margen
    idleTimeoutMillis: 30000,       // Cerrar conexiones inactivas
    max: 10                         // No saturar la base de datos
});

// Verificador de conexión al arrancar (para el Log de Render)
pool.on('error', (err) => {
    console.error('❌ [POSTGRES] Error inesperado en el pool:', err);
});

exports.login = async (req, res) => {
    const { email, password, fleetCode } = req.body;
    let driver = null;

    console.log(`[INFO] Intentando login para: ${email || fleetCode} [TxID: ${req.correlationId}]`);

    try {
        if (email && password) {
            // BUSQUEDA POR EMAIL (Autónomos)
            const result = await pool.query(
                'SELECT * FROM drivers WHERE email = $1 AND password = $2',
                [email, password]
            );
            driver = result.rows[0];
        } else if (fleetCode) {
            // BUSQUEDA POR CÓDIGO DE FLOTA (Empresas)
            const result = await pool.query(
                'SELECT * FROM drivers WHERE fleet_code = $1',
                [fleetCode]
            );
            driver = result.rows[0];
        }

        if (!driver) {
            console.warn(`[WARN] Credenciales fallidas para: ${email || fleetCode}`);
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }

        // Generamos el Token JWT de seguridad
        const token = jwt.sign(
            { id: driver.id, role: driver.fleet_code ? 'fleet' : 'individual' },
            process.env.JWT_SECRET || 'trucknav_secret_2026',
            { expiresIn: '2h' }
        );

        console.log(`[OK] Login exitoso para ID: ${driver.id}`);

        // Devolvemos la respuesta para Android (con limpieza de números)
        res.json({
            success: true,
            token: token,
            message: 'Login correcto',
            truck_height: driver.truck_height ? parseFloat(driver.truck_height) : 4.0,
            truck_weight: driver.truck_weight ? parseFloat(driver.truck_weight) : 40.0,
            is_adr: driver.is_adr || false
        });

    } catch (err) {
        console.error('❌ [ERROR FATAL] PostgreSQL:', err.message);
        res.status(500).json({ 
            success: false, 
            error: 'Error de conexión con la Central. Reinténtalo en unos segundos.' 
        });
    }
};