const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const apiRoutes = require('./src/routes/apiRoutes');
const environment = process.env.NODE_ENV || 'development';

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Logger & Correlation ID Global
app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    console.log(`[${new Date().toISOString()}] [INFO] [TxID: ${req.correlationId}] Recibida: ${req.method} ${req.url}`);
    next();
});

// Escudo Rate Limit Global para /api/
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    limit: 100, 
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        res.status(options.statusCode).json({ success: false, error: 'Rate Limit Excedido' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Truck Nav API Gateway B2B Modular', message: 'Arquitectura MVC Operativa' });
});

// Conectar todas las rutas
app.use('/api', apiLimiter, apiRoutes);

// Manejador Global de Errores
app.use((err, req, res, next) => {
    console.error(`❌ [ERROR] TxID: ${req.correlationId} |`, err.stack);
    res.status(err.statusCode || 500).json({ success: false, error: environment === 'production' ? 'Error interno.' : err.message });
});

app.listen(port, () => {
    console.log(`🚀 API Gateway B2B Modular activo en puerto ${port}`);
});