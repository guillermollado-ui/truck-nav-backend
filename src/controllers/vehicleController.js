const pool = require('../config/db');

exports.getVehicles = async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM vehicle_profiles');
        res.json(result.rows);
    } catch (error) { next(error); }
};

exports.getCountryRules = async (req, res, next) => {
    const countryCode = req.params.country_code.toUpperCase();
    try {
        console.log(`[INFO] [TxID: ${req.correlationId}] Solicitando reglas para: ${countryCode}`);
        const result = await pool.query('SELECT * FROM country_rules WHERE country_code = $1', [countryCode]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: `País no registrado: ${countryCode}` });
        res.json({ success: true, country: countryCode, rules: result.rows[0] });
    } catch (error) { next(error); }
};

exports.getZones = async (req, res, next) => {
    const countryCode = req.params.country_code.toUpperCase();
    try {
        const result = await pool.query('SELECT * FROM environmental_zones WHERE country_code = $1', [countryCode]);
        res.json({ success: true, country: countryCode, total_zones: result.rowCount, zones: result.rows });
    } catch (error) { next(error); }
};

exports.createVehicleSnapshot = async (req, res, next) => {
    const { height_m, width_m, length_m, weight_t, axles } = req.body;
    try {
        const queryText = `INSERT INTO vehicle_snapshots(height_m, width_m, length_m, weight_t, axles) VALUES($1, $2, $3, $4, $5) RETURNING id, created_at`;
        const values = [height_m, width_m || 2.5, length_m || 12.0, weight_t, axles || 2];
        const result = await pool.query(queryText, values);
        res.status(201).json({
            success: true,
            message: `Snapshot validado según leyes de ${req.countryRules.country_name}`,
            snapshot_id: result.rows[0].id,
            applied_limits: { max_h: req.countryRules.max_height_m, max_w: req.countryRules.max_weight_t }
        });
    } catch (error) { next(error); }
};