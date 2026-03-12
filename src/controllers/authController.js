// Archivo: src/controllers/authController.js
// 🔥 CAMBIO DE RUTA: Subimos a src (..) y entramos en config (/config/db)
const pool = require('../config/db'); 
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { email, password, fleetCode } = req.body;
    let driver = null;

    const txId = req.correlationId || 'N/A';
    console.log(`[INFO] [TxID: ${txId}] Intento de login para: ${email || fleetCode}`);

    try {
        if (email && password) {
            const result = await pool.query(
                'SELECT * FROM drivers WHERE email = $1 AND password = $2',
                [email, password]
            );
            driver = result.rows[0];
        } else if (fleetCode) {
            const result = await pool.query(
                'SELECT * FROM drivers WHERE fleet_code = $1',
                [fleetCode]
            );
            driver = result.rows[0];
        }

        if (!driver) {
            console.warn(`[WARN] [TxID: ${txId}] Credenciales incorrectas.`);
            return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        }

        const token = jwt.sign(
            { id: driver.id, role: driver.fleet_code ? 'fleet' : 'individual' },
            process.env.JWT_SECRET || 'TrUcKnAv_s3cr3t0_m43str0_2026_super_seguro',
            { expiresIn: '2h' }
        );

        console.log(`[OK] [TxID: ${txId}] Login exitoso para el conductor ID: ${driver.id}`);

        res.json({
            success: true,
            token: token,
            message: 'Login correcto',
            truck_height: driver.truck_height ? parseFloat(driver.truck_height) : 4.0,
            truck_weight: driver.truck_weight ? parseFloat(driver.truck_weight) : 40.0,
            is_adr: driver.is_adr || false
        });

    } catch (err) {
        console.error(`❌ [ERROR FATAL] [TxID: ${txId}] PostgreSQL:`, err.message);
        res.status(500).json({ 
            success: false, 
            error: 'La Central no responde. Reintenta en unos segundos.' 
        });
    }
};