const express = require('express');
const router = express.Router();

const { generateToken, authenticateJWT } = require('../middleware/auth');
const { validateVehicleByCountry } = require('../middleware/validation');

const routeController = require('../controllers/routeController');
const sessionController = require('../controllers/sessionController');
const vehicleController = require('../controllers/vehicleController');
const hazardController = require('../controllers/hazardController');
// 🔥 NUEVO: Importamos el cerebro de autenticación que conectamos a PostgreSQL
const authController = require('../controllers/authController');

// --- SECCIÓN: IDENTIDAD & ACCESO ---

// Taquilla (API Key para flotas externas)
router.post('/auth/token', generateToken);

// Puerta de entrada para el móvil (B2B Login)
router.post('/auth/login', authController.login);

// 🔥 DÍA 59: Actualizar perfil del camión (Altura, Peso, ADR)
// Nota: Usa 'authenticateJWT' para saber qué conductor está haciendo el cambio
router.put('/auth/profile', authenticateJWT, authController.updateProfile);


// --- SECCIÓN: VEHÍCULOS & REGLAS ---
router.get('/vehicles', authenticateJWT, vehicleController.getVehicles);
router.post('/vehicles', authenticateJWT, validateVehicleByCountry, vehicleController.createVehicleSnapshot);
router.get('/rules/:country_code', authenticateJWT, vehicleController.getCountryRules);
router.get('/zones/:country_code', authenticateJWT, vehicleController.getZones);


// --- SECCIÓN: RUTAS & AUDITORÍA ---
router.post('/route', authenticateJWT, routeController.calculateRoute);
router.get('/route/:id', authenticateJWT, routeController.getRouteMaster);
router.get('/legal/audit/:response_id', authenticateJWT, routeController.getAudit);


// --- SECCIÓN: SESIONES (TACÓGRAFO) ---
router.post('/sessions/start', authenticateJWT, sessionController.startSession);
router.post('/sessions/stop', authenticateJWT, sessionController.stopSession);
router.get('/sessions/status', authenticateJWT, sessionController.getStatus);
router.post('/sessions/telemetry', authenticateJWT, sessionController.telemetry);
router.post('/sessions/debug/time-jump', authenticateJWT, sessionController.timeJump);
router.get('/sessions/remaining', authenticateJWT, sessionController.getRemaining);
router.post('/sessions/rest/start', authenticateJWT, sessionController.startRest);
router.post('/sessions/rest/stop', authenticateJWT, sessionController.stopRest);
router.get('/sessions/hud', authenticateJWT, sessionController.getHud);


// --- SECCIÓN: INTELIGENCIA DE CARRETERA (MENTE COLMENA) ---
router.post('/hazards/report', authenticateJWT, hazardController.reportHazard);
router.get('/hazards/nearby', authenticateJWT, hazardController.getNearbyHazards);

module.exports = router;