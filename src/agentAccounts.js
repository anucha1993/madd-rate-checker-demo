const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
    if (pool) return pool;
    if (!process.env.DB_HOST || !process.env.AGENT_DB_NAME) return null;

    pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.AGENT_DB_NAME,
        connectionLimit: 3,
        connectTimeout: 5000
    });
    return pool;
}

/**
 * All active UPS accounts (agent_id = 1) that have OAuth credentials configured.
 * Returns [] if no DB is configured/reachable — caller must handle the empty case.
 */
async function listUpsAccounts() {
    const p = getPool();
    if (!p) return [];

    try {
        const [rows] = await p.query(
            `SELECT id, username_acc, client_id, client_secret
             FROM agent_accounts
             WHERE agent_id = 1 AND status = 1 AND client_id IS NOT NULL AND client_secret IS NOT NULL`
        );
        return rows;
    } catch (err) {
        return [];
    }
}

/**
 * All active DHL accounts (agent_id = 2) that have basic-auth credentials configured.
 * Returns [] if no DB is configured/reachable — caller must handle the empty case.
 */
async function listDhlAccounts() {
    const p = getPool();
    if (!p) return [];

    try {
        const [rows] = await p.query(
            `SELECT id, username_acc, basic_auth_username, basic_auth_password
             FROM agent_accounts
             WHERE agent_id = 2 AND status = 1 AND basic_auth_username IS NOT NULL AND basic_auth_password IS NOT NULL`
        );
        return rows;
    } catch (err) {
        return [];
    }
}

module.exports = { listUpsAccounts, listDhlAccounts };
