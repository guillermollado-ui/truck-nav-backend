const pool = require('../config/db');

const validateVehicleByCountry = async (req, res, next) => {
    const { height_m, weight_t, country_code } = req.body;
    const targetCountry = country_code || 'ESP'; 

    try {
        const ruleResult = await pool.query('SELECT * FROM country_rules WHERE country_code = $1', [targetCountry]);

        if (ruleResult.rowCount === 0) {
            return res.status(404).json({ success: false, error: `No hay reglas para el país: ${targetCountry}` });
        }

        const rules = ruleResult.rows[0];
        const errors = [];

        if (height_m > rules.max_height_m) errors.push(`Altura excede el límite (${rules.max_height_m}m)`);
        if (weight_t > rules.max_weight_t) errors.push(`Peso excede el límite (${rules.max_weight_t}t)`);

        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: 'Violación de leyes de transporte', details: errors });
        }

        req.countryRules = rules;
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = { validateVehicleByCountry };