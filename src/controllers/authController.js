const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// Conexión a PostgreSQL (Render usa la variable DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.login = async (req, res) => {
    const { email, password, fleetCode } = req.body;
    let driver = null;

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
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }

        // Generamos el Token JWT de seguridad
        const token = jwt.sign(
            { id: driver.id, role: driver.fleet_code ? 'fleet' : 'individual' },
            process.env.JWT_SECRET || 'trucknav_secret_2026',
            { expiresIn: '2h' }
        );

        // Devolvemos la respuesta para Android
        res.json({
            success: true,
            token: token,
            message: 'Login correcto',
            truck_height: parseFloat(driver.truck_height),
            truck_weight: parseFloat(driver.truck_weight),
            is_adr: driver.is_adr
        });

    } catch (err) {
        console.error('❌ Error PostgreSQL:', err);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
};