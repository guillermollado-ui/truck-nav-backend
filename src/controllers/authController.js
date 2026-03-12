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
// ... (lo que ya teníamos de login)

exports.updateProfile = async (req, res) => {
    const { truck_height, truck_weight, is_adr } = req.body;
    const driverId = req.user.id; // Obtenido del token JWT por el middleware

    const txId = req.correlationId || 'N/A';
    console.log(`[INFO] [TxID: ${txId}] Actualizando perfil para ID: ${driverId}`);

    try {
        const query = `
            UPDATE drivers 
            SET truck_height = $1, truck_weight = $2, is_adr = $3 
            WHERE id = $4
            RETURNING id, truck_height, truck_weight, is_adr
        `;
        const values = [truck_height, truck_weight, is_adr, driverId];
        
        const result = await pool.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Conductor no encontrado' });
        }

        res.json({
            success: true,
            message: 'Perfil actualizado en la Bóveda',
            data: {
                truck_height: parseFloat(result.rows[0].truck_height),
                truck_weight: parseFloat(result.rows[0].truck_weight),
                is_adr: result.rows[0].is_adr
            }
        });

    } catch (err) {
        console.error(`❌ [ERROR] [TxID: ${txId}] Error al actualizar:`, err.message);
        res.status(500).json({ success: false, error: 'Error al guardar en la base de datos' });
    }
};