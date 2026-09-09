const axios = require('axios');

/**
 * Get an OAuth2 access token from UPS (client_credentials grant).
 */
async function getAccessToken(authUrl, clientId, clientSecret) {
    const response = await axios.post(
        authUrl,
        'grant_type=client_credentials',
        {
            auth: { username: clientId, password: clientSecret },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
            validateStatus: () => true
        }
    );

    if (response.status !== 200 && response.status !== 201) {
        const err = new Error('UPS OAuth failed');
        err.detail = response.data;
        err.status = response.status;
        throw err;
    }

    return response.data.access_token;
}

/**
 * Build a UPS RateRequest body from generic shipment fields.
 */
function buildRateRequest(shipment, negotiatedIndicator) {
    const { from, to, packages, serviceCode, shipperNumber, isDocument } = shipment;

    return {
        RateRequest: {
            Request: {
                TransactionReference: { CustomerContext: 'Rate Checker Demo' }
            },
            Shipment: {
                ShipmentRatingOptions: {
                    NegotiatedRatesIndicator: negotiatedIndicator
                },
                Shipper: {
                    ShipperNumber: shipperNumber || undefined,
                    Address: {
                        AddressLine: [from.address || ''],
                        City: from.city || '',
                        PostalCode: from.postcode || '',
                        CountryCode: from.country || ''
                    }
                },
                ShipTo: {
                    Address: {
                        AddressLine: [to.address || ''],
                        City: to.city || '',
                        ...(to.stateCode ? { StateProvinceCode: to.stateCode } : {}),
                        PostalCode: to.postcode || '',
                        CountryCode: to.country || ''
                    }
                },
                ShipFrom: {
                    Address: {
                        AddressLine: [from.address || ''],
                        City: from.city || '',
                        PostalCode: from.postcode || '',
                        CountryCode: from.country || ''
                    }
                },
                Service: { Code: serviceCode || '65' },
                // UPS Letter/Document (Code 01) has NO Dimensions and a different (much lower)
                // freight+fuel-surcharge base than a Customer Supplied Package (Code 02) —
                // without this branch documents were silently rated as packages.
                Package: (packages || []).map((pkg) => ({
                    PackagingType: { Code: isDocument ? '01' : '02' },
                    ...(isDocument ? {} : {
                        Dimensions: {
                            UnitOfMeasurement: { Code: pkg.dimensionUnit || 'CM' },
                            Length: String(pkg.length ?? ''),
                            Width: String(pkg.width ?? ''),
                            Height: String(pkg.height ?? '')
                        }
                    }),
                    PackageWeight: {
                        UnitOfMeasurement: { Code: pkg.weightUnit || 'KGS' },
                        Weight: String(pkg.weight ?? '')
                    }
                }))
            }
        }
    };
}

/**
 * Call the UPS Rating API once with a given NegotiatedRatesIndicator value.
 */
async function getRate(apiUrl, token, shipment, negotiatedIndicator) {
    const body = buildRateRequest(shipment, negotiatedIndicator);

    const response = await axios.post(apiUrl, body, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 15000,
        validateStatus: () => true
    });

    if (response.status !== 200) {
        const err = new Error('UPS rate request failed');
        err.detail = response.data;
        err.status = response.status;
        throw err;
    }

    return response.data;
}

// Known UPS ItemizedCharges codes that don't already come with a SubType/Description
// in the raw response, so the breakdown doesn't show a bare, meaningless number.
const CHARGE_CODE_LABELS = {
    '375': 'ค่าธรรมเนียมน้ำมัน (Fuel Surcharge)',
    '270': 'ค่าธรรมเนียมจัดการเพิ่มเติม (Additional Handling)',
    '440': 'ค่าธรรมเนียมพื้นที่ห่างไกล (Delivery Area Surcharge)'
};

function describeCharge(item) {
    if (item?.SubType) return item.SubType.replace(/_/g, ' ');
    if (item?.Description) return item.Description;
    if (item?.Code && CHARGE_CODE_LABELS[item.Code]) return CHARGE_CODE_LABELS[item.Code];
    return item?.Code ? `ค่าธรรมเนียมอื่นๆ (code ${item.Code})` : 'ค่าธรรมเนียมอื่นๆ';
}

/**
 * Builds an itemized breakdown that actually sums to the total it belongs to —
 * base freight PLUS each itemized surcharge, not just the surcharges alone.
 */
function buildBreakdown(baseCharge, itemizedCharges, currency) {
    const lines = [];
    if (baseCharge?.MonetaryValue != null) {
        lines.push({
            code: 'BASE',
            description: 'ค่าขนส่งพื้นฐาน (Base Freight)',
            amount: Number(baseCharge.MonetaryValue),
            currency: baseCharge.CurrencyCode || currency
        });
    }
    for (const item of itemizedCharges || []) {
        lines.push({
            code: item?.Code || null,
            description: describeCharge(item),
            amount: Number(item?.MonetaryValue ?? 0),
            currency: item?.CurrencyCode || currency
        });
    }
    return lines;
}

/**
 * Normalize a raw UPS RateResponse into { published, negotiated, serviceCode, currency, chargeBreakdown }.
 */
function extractQuote(rawResponse) {
    const ratedShipments = rawResponse?.RateResponse?.RatedShipment;
    const shipments = Array.isArray(ratedShipments)
        ? ratedShipments
        : ratedShipments ? [ratedShipments] : [];

    if (shipments.length === 0) {
        throw new Error('No RatedShipment returned by UPS');
    }

    const rs = shipments[0];
    const currency = rs.TotalCharges?.CurrencyCode || rs.TransportationCharges?.CurrencyCode || 'THB';
    const published = Number(rs.TotalCharges?.MonetaryValue ?? rs.TransportationCharges?.MonetaryValue ?? NaN);
    const negotiated = rs.NegotiatedRateCharges?.TotalCharge?.MonetaryValue != null
        ? Number(rs.NegotiatedRateCharges.TotalCharge.MonetaryValue)
        : null;

    // Published breakdown (base + surcharges) always sums to `published`.
    const chargeBreakdown = buildBreakdown(rs.BaseServiceCharge, rs.ItemizedCharges, currency);

    // Negotiated breakdown (base + surcharges, using the DISCOUNTED amounts) always
    // sums to `negotiated` — a different array from the published one, not just a
    // scaled-down version of it.
    const negotiatedChargeBreakdown = rs.NegotiatedRateCharges
        ? buildBreakdown(rs.NegotiatedRateCharges.BaseServiceCharge, rs.NegotiatedRateCharges.ItemizedCharges, currency)
        : null;

    // UPS almost always includes a caveat that the invoice may differ from this estimate —
    // worth surfacing since it's easy to miss buried in the raw JSON.
    const alerts = rawResponse?.RateResponse?.Response?.Alert;
    const alertList = Array.isArray(alerts) ? alerts : alerts ? [alerts] : [];
    const alert = alertList.map((a) => a?.Description).filter(Boolean).join('; ') || null;

    return {
        serviceCode: rs.Service?.Code || null,
        serviceDescription: rs.Service?.Description || null,
        currency,
        published: Number.isFinite(published) ? published : null,
        negotiated,
        billedWeight: rs.BillingWeight?.Weight || null,
        billedWeightUnit: rs.BillingWeight?.UnitOfMeasurement?.Code || null,
        alert,
        chargeBreakdown,
        negotiatedChargeBreakdown
    };
}

module.exports = { getAccessToken, getRate, extractQuote };
