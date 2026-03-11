const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const API_KEY = process.env.API_KEY;

if (!JWT_SECRET || !API_KEY) {
    throw new Error("❌ FATAL: Variables de entorno de seguridad no definidas.");
}

const generateToken = (req, res) => {
    const { api_key } = req.body;
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
            if (err) return res.status(403).json({ success: false, error: 'Token inválido' });
            req.user = decoded;
            next();
        });
    } else {
        res.status(401).json({ success: false, error: 'Autenticación requerida' });
    }
};

module.exports = { generateToken, authenticateJWT };