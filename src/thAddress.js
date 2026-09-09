const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
    if (pool) return pool;
    if (!process.env.DB_HOST || !process.env.CONSTANT_DB_NAME) return null;

    pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.CONSTANT_DB_NAME,
        connectionLimit: 3,
        connectTimeout: 5000
    });
    return pool;
}

/**
 * Optional reference data for Thai address autofill (province/amphur/postcode).
 * Returns { available, provinces, postcodeMap, amphurs } — gracefully degrades to
 * available:false if no DB is configured or reachable (tool still works without it).
 *
 * NOTE: `postcodeMap` is a postcode -> ONE amphur convenience lookup, but several
 * Bangkok postcodes are shared by more than one เขต (e.g. 10310 = ห้วยขวาง AND
 * วังทองหลาง, since the latter split off from the former but kept the postcode).
 * Prefer matching an amphur NAME directly against the pasted text first (`amphurs`)
 * — only fall back to `postcodeMap` when no name appears in the text at all.
 */
async function getThAddressData() {
    const p = getPool();
    if (!p) return { available: false, provinces: [], postcodeMap: {}, amphurs: [] };

    try {
        const [rows] = await p.query(
            `SELECT a.postcode, a.amphur_name, pr.province_id, pr.province_name
             FROM amphur a
             JOIN province pr ON pr.province_id = a.province_id
             WHERE a.status = 'ACTIVE' OR a.status IS NULL`
        );

        const provinceSet = new Map();
        const postcodeMap = {};
        const amphurs = [];

        for (const row of rows) {
            const amphurName = row.amphur_name.trim();
            const provinceName = row.province_name.trim();
            provinceSet.set(row.province_id, provinceName);
            amphurs.push({ name: amphurName, postcode: row.postcode, province: provinceName });

            if (!postcodeMap[row.postcode]) {
                postcodeMap[row.postcode] = {
                    amphur: amphurName,
                    province: provinceName
                };
            }
        }

        return {
            available: true,
            provinces: Array.from(provinceSet.values()).sort((a, b) => a.localeCompare(b, 'th')),
            postcodeMap,
            amphurs
        };
    } catch (err) {
        return { available: false, provinces: [], postcodeMap: {}, amphurs: [], error: err.message };
    }
}

module.exports = { getThAddressData };
