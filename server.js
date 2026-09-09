require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getAccessToken, getRate, extractQuote } = require('./src/upsClient');
const { getRate: getDhlRate, extractAllQuotes: extractAllDhlQuotes } = require('./src/dhlClient');
const { getThAddressData } = require('./src/thAddress');
const { listUpsAccounts, listDhlAccounts } = require('./src/agentAccounts');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 4100);
const UPS_AUTH_URL = process.env.UPS_AUTH_URL || 'https://wwwcie.ups.com/security/v1/oauth/token';
const UPS_API_URL = process.env.UPS_API_URL || 'https://wwwcie.ups.com/api/rating/v2409/rate';
const DHL_API_URL = process.env.DHL_API_URL || 'https://express.api.dhl.com/mydhlapi';

const SERVICE_CODES = {
    '65': 'Worldwide Saver',
    '07': 'Worldwide Express',
    '08': 'Worldwide Expedited',
    '11': 'UPS Standard'
};

app.get('/api/service-codes', (req, res) => {
    res.json(Object.entries(SERVICE_CODES).map(([code, label]) => ({ code, label })));
});

// Lets the UI show a clear "Production" vs "Sandbox" badge — important when
// demoing real numbers to a customer, so nobody mistakes test data for real pricing.
app.get('/api/environment', (req, res) => {
    const isProduction = UPS_API_URL.includes('onlinetools.ups.com') && !DHL_API_URL.includes('/test');
    res.json({ isProduction, upsApiUrl: UPS_API_URL, dhlApiUrl: DHL_API_URL });
});

// Whether an emergency env-based fallback UPS account is configured — never expose
// the actual client secret to the browser, only a yes/no flag.
app.get('/api/defaults', (req, res) => {
    res.json({
        hasDefaults: Boolean(process.env.DEFAULT_UPS_CLIENT_ID && process.env.DEFAULT_UPS_CLIENT_SECRET)
    });
});

// Optional reference data (province/postcode) for TH address autofill.
// Degrades to { available: false } if no DB is configured/reachable — form still works either way.
app.get('/api/th-address-data', async (req, res) => {
    const data = await getThAddressData();
    res.json(data);
});

// All UPS accounts found in the DB (id + name only — never send secrets to the browser).
app.get('/api/ups-accounts', async (req, res) => {
    const accounts = await listUpsAccounts();
    res.json(accounts.map((a) => ({ id: a.id, username_acc: a.username_acc })));
});

// All DHL accounts found in the DB (id + name only — never send secrets to the browser).
app.get('/api/dhl-accounts', async (req, res) => {
    const accounts = await listDhlAccounts();
    res.json(accounts.map((a) => ({ id: a.id, username_acc: a.username_acc })));
});

/**
 * Quote every requested serviceCode for ONE account, reusing a single OAuth token
 * (fetched once per account instead of once per service code).
 */
async function quoteAccountAllServices(account, shipment, serviceCodes) {
    const token = await getAccessToken(UPS_AUTH_URL, account.client_id, account.client_secret);
    const shipperNumber = account.username_acc?.toUpperCase();

    const perService = await Promise.allSettled(
        serviceCodes.map(async (serviceCode) => {
            const shipmentForCall = { ...shipment, shipperNumber, serviceCode };

            // Ask UPS both ways — some accounts only return NegotiatedRateCharges when the flag is "Y".
            const [publishedRaw, negotiatedRaw] = await Promise.all([
                getRate(UPS_API_URL, token, shipmentForCall, ''),
                getRate(UPS_API_URL, token, shipmentForCall, 'Y')
            ]);

            const publishedQuote = extractQuote(publishedRaw);
            const negotiatedQuote = extractQuote(negotiatedRaw);

            return {
                carrier: 'UPS',
                accountId: account.id,
                username: account.username_acc,
                serviceCode,
                serviceLabel: SERVICE_CODES[serviceCode] || publishedQuote.serviceDescription || serviceCode,
                currency: publishedQuote.currency,
                billedWeight: publishedQuote.billedWeight,
                billedWeightUnit: publishedQuote.billedWeightUnit,
                published: publishedQuote.published ?? negotiatedQuote.published ?? null,
                negotiated: negotiatedQuote.negotiated ?? publishedQuote.negotiated ?? null,
                alert: negotiatedQuote.alert || publishedQuote.alert || null,
                // Breakdown must match whichever total is actually shown (negotiated,
                // when available) — the negotiated array has its own discounted amounts,
                // not just a scaled copy of the published one.
                chargeBreakdown: negotiatedQuote.negotiatedChargeBreakdown || publishedQuote.chargeBreakdown,
                // Raw UPS responses, untouched — so you can see exactly what UPS actually sent back.
                rawResponse: {
                    published: publishedRaw,
                    negotiated: negotiatedRaw
                }
            };
        })
    );

    return perService.map((r, i) => r.status === 'fulfilled'
        ? { ...r.value, error: null }
        : { carrier: 'UPS', accountId: account.id, username: account.username_acc, serviceCode: serviceCodes[i], serviceLabel: SERVICE_CODES[serviceCodes[i]], error: r.reason?.message || 'Unknown error' });
}

/**
 * Quote a DHL account — DHL returns EVERY available product/service in one call
 * (no per-service-code looping like UPS), and there's no separate published/negotiated
 * split: the returned price is already the account-specific contracted rate.
 */
async function quoteDhlAccount(account, shipment) {
    const rawResponse = await getDhlRate(DHL_API_URL, account, shipment);
    const quotes = extractAllDhlQuotes(rawResponse);

    return quotes.map((q) => ({
        carrier: 'DHL',
        accountId: account.id,
        username: account.username_acc,
        serviceCode: q.serviceCode,
        serviceLabel: q.serviceLabel,
        currency: q.currency,
        billedWeight: q.billedWeight,
        billedWeightUnit: q.billedWeightUnit,
        published: null, // DHL doesn't expose a separate published/list rate
        negotiated: q.total, // the account-contracted price DHL actually returned
        isCustomerAgreement: q.isCustomerAgreement,
        transitDays: q.transitDays,
        estimatedDelivery: q.estimatedDelivery,
        chargeBreakdown: q.chargeBreakdown,
        rawResponse: { negotiated: rawResponse }
    }));
}

function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

app.post('/api/check-rate', async (req, res) => {
    try {
        const { from, to, packages, serviceCodes, customAccount, customDhlAccount, accountIds, dhlAccountIds } = req.body;

        if (!from?.country || !to?.country) {
            return res.status(400).json({ error: 'from.country and to.country are required' });
        }
        if (!Array.isArray(packages) || packages.length === 0) {
            return res.status(400).json({ error: 'At least one package is required' });
        }

        const shipment = { from, to, packages };
        const codesToTest = Array.isArray(serviceCodes) && serviceCodes.length > 0
            ? serviceCodes
            : Object.keys(SERVICE_CODES);

        // Pull EVERY active UPS account from the DB — never rely on a single hardcoded account.
        let upsAccounts = await listUpsAccounts();
        if (Array.isArray(accountIds) && accountIds.length > 0) {
            const idSet = new Set(accountIds.map(String));
            upsAccounts = upsAccounts.filter((a) => idSet.has(String(a.id)));
        }
        if (upsAccounts.length === 0 && customAccount?.clientId && customAccount?.clientSecret) {
            upsAccounts = [{
                id: 'custom-ups',
                username_acc: customAccount.shipperNumber || 'CUSTOM',
                client_id: customAccount.clientId,
                client_secret: customAccount.clientSecret
            }];
        }
        // Last-resort emergency fallback — applied server-side only, so the real
        // client secret is never sent to the browser.
        if (upsAccounts.length === 0 && process.env.DEFAULT_UPS_CLIENT_ID && process.env.DEFAULT_UPS_CLIENT_SECRET) {
            upsAccounts = [{
                id: 'env-default-ups',
                username_acc: process.env.DEFAULT_UPS_SHIPPER_NUMBER || 'DEFAULT',
                client_id: process.env.DEFAULT_UPS_CLIENT_ID,
                client_secret: process.env.DEFAULT_UPS_CLIENT_SECRET
            }];
        }

        // Same idea for DHL — pull every active account from the DB.
        let dhlAccounts = await listDhlAccounts();
        if (Array.isArray(dhlAccountIds) && dhlAccountIds.length > 0) {
            const idSet = new Set(dhlAccountIds.map(String));
            dhlAccounts = dhlAccounts.filter((a) => idSet.has(String(a.id)));
        }
        if (dhlAccounts.length === 0 && customDhlAccount?.basicAuthUsername && customDhlAccount?.basicAuthPassword) {
            dhlAccounts = [{
                id: 'custom-dhl',
                username_acc: customDhlAccount.accountNumber || 'CUSTOM',
                basic_auth_username: customDhlAccount.basicAuthUsername,
                basic_auth_password: customDhlAccount.basicAuthPassword
            }];
        }

        if (upsAccounts.length === 0 && dhlAccounts.length === 0) {
            return res.status(400).json({
                error: 'No UPS or DHL accounts found in the DB, and no custom account was provided.'
            });
        }

        // Fire EVERYTHING at once: every UPS account × every service code, and every DHL account.
        const perUpsAccount = await Promise.allSettled(
            upsAccounts.map((account) => quoteAccountAllServices(account, shipment, codesToTest))
        );
        const perDhlAccount = await Promise.allSettled(
            dhlAccounts.map((account) => quoteDhlAccount(account, shipment))
        );

        const upsResults = perUpsAccount.flatMap((r, i) => r.status === 'fulfilled'
            ? r.value
            : codesToTest.map((serviceCode) => ({
                carrier: 'UPS',
                accountId: upsAccounts[i].id,
                username: upsAccounts[i].username_acc,
                serviceCode,
                serviceLabel: SERVICE_CODES[serviceCode],
                error: r.reason?.message || 'Unknown error'
            })));

        const dhlResults = perDhlAccount.flatMap((r, i) => r.status === 'fulfilled'
            ? r.value
            : [{
                carrier: 'DHL',
                accountId: dhlAccounts[i].id,
                username: dhlAccounts[i].username_acc,
                serviceCode: null,
                serviceLabel: 'DHL',
                error: r.reason?.message || 'Unknown error'
            }]);

        const results = [...upsResults, ...dhlResults];

        const diff = (a, b) => (a != null && b != null) ? Math.round((a - b) * 100) / 100 : null;
        const pct = (a, b) => (a != null && b != null && b !== 0) ? Math.round(((a - b) / b) * 10000) / 100 : null;

        // Anomaly detection: flag any published price that strays >15% from the group median
        // for the SAME carrier + service code — makes the "odd one out" jump out visually.
        const medianByService = {};
        for (const r of results) {
            const key = `${r.carrier}:${r.serviceCode}`;
            if (!(key in medianByService)) {
                const values = results
                    .filter((x) => x.carrier === r.carrier && x.serviceCode === r.serviceCode && !x.error && x.published != null)
                    .map((x) => x.published);
                medianByService[key] = median(values);
            }
        }

        const resultsWithComparison = results.map((r) => {
            if (r.error) return { ...r, comparison: null, anomaly: false };

            const med = medianByService[`${r.carrier}:${r.serviceCode}`];
            const anomaly = med != null && med !== 0 && r.published != null && Math.abs((r.published - med) / med) > 0.15;

            return {
                ...r,
                anomaly,
                comparison: {
                    published_vs_negotiated: { diff: diff(r.published, r.negotiated), pct: pct(r.published, r.negotiated) }
                }
            };
        });

        return res.json({
            accountCount: upsAccounts.length + dhlAccounts.length,
            serviceCodes: codesToTest,
            results: resultsWithComparison
        });
    } catch (err) {
        return res.status(err.status || 500).json({
            error: err.message,
            detail: err.detail || null
        });
    }
});

app.listen(PORT, () => {
    console.log(`Rate Checker Demo running standalone on http://localhost:${PORT}`);
});

