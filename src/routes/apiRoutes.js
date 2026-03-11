const express = require('express');
const router = express.Router();

const { generateToken, authenticateJWT } = require('../middleware/auth');
const { validateVehicleByCountry } = require('../middleware/validation');

const routeController = require('../controllers/routeController');
const sessionController = require('../controllers/sessionController');
const vehicleController = require('../controllers/vehicleController');
const hazardController = require('../controllers/hazardController');

// Taquilla
router.post('/auth/token', generateToken);

// Vehículos & Reglas
router.get('/vehicles', authenticateJWT, vehicleController.getVehicles);
router.post('/vehicles', authenticateJWT, validateVehicleByCountry, vehicleController.createVehicleSnapshot);
router.get('/rules/:country_code', authenticateJWT, vehicleController.getCountryRules);
router.get('/zones/:country_code', authenticateJWT, vehicleController.getZones);

// Rutas & Auditoría
router.post('/route', authenticateJWT, routeController.calculateRoute);
router.get('/route/:id', authenticateJWT, routeController.getRouteMaster);
router.get('/legal/audit/:response_id', authenticateJWT, routeController.getAudit);

// Sesiones (Tacógrafo)
router.post('/sessions/start', authenticateJWT, sessionController.startSession);
router.post('/sessions/stop', authenticateJWT, sessionController.stopSession);
router.get('/sessions/status', authenticateJWT, sessionController.getStatus);
router.post('/sessions/telemetry', authenticateJWT, sessionController.telemetry);
router.post('/sessions/debug/time-jump', authenticateJWT, sessionController.timeJump);
router.get('/sessions/remaining', authenticateJWT, sessionController.getRemaining);
router.post('/sessions/rest/start', authenticateJWT, sessionController.startRest);
router.post('/sessions/rest/stop', authenticateJWT, sessionController.stopRest);
router.get('/sessions/hud', authenticateJWT, sessionController.getHud);

// Inteligencia de Carretera (Mente Colmena)
router.post('/hazards/report', authenticateJWT, hazardController.reportHazard);
router.get('/hazards/nearby', authenticateJWT, hazardController.getNearbyHazards);

module.exports = router;