const jwt = require('jsonwebtoken');
require('dotenv').config();

// Se utiliza el secreto proporcionado como respaldo
const JWT_SECRET = process.env.JWT_SECRET || 'TrUcKnAv_s3cr3t0_m43str0_2026_super_seguro';
const API_KEY = process.env.API_KEY; 

const generateToken = (req, res) => {
    const { api_key } = req.body;
    
    if (!API_KEY) {
        return res.status(500).json({ success: false, error: 'Configuración de seguridad incompleta en el servidor' });
    }

    if (api_key === API_KEY) {
        const token = jwt.sign(
            { role: 'truck_client', access: 'fleet_data', user_id: 1 }, 
            JWT_SECRET,
            { expiresIn: '2h' } 
        );
        res.json({ success: true, token: token, expires_in: '2h' });
    } else {
        res.status(401).json({ success: false, error: 'API Key inválida' });
    }
};

const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]; 
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ success: false, error: 'Token inválido o expirado' });
            req.user = decoded;
            next();
        });
    } else {
        res.status(401).json({ success: false, error: 'Autenticación requerida' });
    }
};

module.exports = { generateToken, authenticateJWT };