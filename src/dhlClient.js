const axios = require('axios');

const asNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const roundPrice = (n) => Math.round(Number(n) * 100) / 100;

function generateMessageReference() {
    return `madd-demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildAddressDetails(addr) {
    return {
        postalCode: addr.postcode || '',
        cityName: addr.city || '',
        addressLine1: addr.address || '',
        countryCode: addr.country || ''
    };
}

/**
 * Build a DHL MyDHL API rate request from generic shipment fields.
 * Mirrors the real agent-service's dhlRateProvider (same field shape),
 * except this always asks for EVERY available product (no lowest-only filtering).
 */
function buildRateRequest(account, shipment) {
    const { from, to, packages, isDocument } = shipment;

    const expandedPackages = [];
    for (const pkg of packages) {
        const quantity = Number(pkg.quantity || 1);
        const perUnitWeight = Math.round((Number(pkg.weight || 0) / quantity) * 100) / 100;
        for (let i = 0; i < quantity; i++) {
            expandedPackages.push({
                typeCode: '3BX', // Customer supplied box (parcel), same default as agent-service
                weight: perUnitWeight,
                // DHL has no UPS-style "Letter/Document" packaging concept — omitting
                // dimensions here does NOT make DHL use just the actual weight, it silently
                // substitutes a generic ~2kg default parcel profile instead (verified against
                // the real API). So dimensions must ALWAYS be sent, document or not.
                dimensions: {
                    length: Number(pkg.length),
                    width: Number(pkg.width),
                    height: Number(pkg.height)
                }
            });
        }
    }

    return {
        customerDetails: {
            shipperDetails: buildAddressDetails(from),
            receiverDetails: buildAddressDetails(to)
        },
        accounts: [{ typeCode: 'shipper', number: account.username_acc }],
        valueAddedServices: [{ serviceCode: 'SF' }],
        payerCountryCode: from.country,
        plannedShippingDateAndTime: new Date().toISOString(),
        unitOfMeasurement: 'metric',
        // Documents never need a customs declaration, even cross-border.
        isCustomsDeclarable: !isDocument && from.country !== to.country,
        estimatedDeliveryDate: { isRequested: true, typeCode: 'QDDC' },
        getAdditionalInformation: [{ typeCode: 'allValueAddedServices', isRequested: true }],
        returnStandardProductsOnly: false,
        nextBusinessDay: true,
        productTypeCode: 'all',
        packages: expandedPackages
    };
}

function buildHeaders(account, messageRef) {
    const credentials = Buffer.from(
        `${account.basic_auth_username}:${account.basic_auth_password}`
    ).toString('base64');

    return {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-version': '3.2.0',
        'Message-Reference': messageRef,
        'Message-Reference-Date': new Date().toUTCString()
    };
}

async function getRate(apiUrl, account, shipment) {
    const request = buildRateRequest(account, shipment);
    const messageRef = generateMessageReference();
    const headers = buildHeaders(account, messageRef);

    const response = await axios.post(`${apiUrl}/rates`, request, {
        headers,
        timeout: 20000,
        validateStatus: () => true
    });

    if (response.status !== 200 && response.status !== 201) {
        const err = new Error(`DHL rate request failed (${response.status})`);
        err.detail = response.data;
        err.status = response.status;
        throw err;
    }

    return response.data;
}

/**
 * Known DHL charge codes translated to Thai — DHL's own "name" field is always
 * English, so without this the breakdown looks inconsistent next to UPS's Thai labels.
 */
const DHL_CHARGE_LABELS = {
    BASE: 'ค่าขนส่งพื้นฐาน (Base Freight)',
    SF: 'ค่าธรรมเนียมเซ็นรับโดยตรง (Direct Signature)',
    FF: 'ค่าธรรมเนียมน้ำมัน (Fuel Surcharge)',
    YK: 'ค่าธรรมเนียมพรีเมียมส่งก่อนเวลา (12:00 Premium)',
    OF: 'ค่าธรรมเนียมพื้นที่ห่างไกล (Remote Area Delivery)',
    FD: 'ค่าธรรมเนียมลดคาร์บอน (GoGreen Plus)'
};

function describeDhlCharge(item, code) {
    if (DHL_CHARGE_LABELS[code]) return DHL_CHARGE_LABELS[code];
    return item?.name ? `${item.name} (code ${code})` : `ค่าธรรมเนียมอื่นๆ (code ${code})`;
}

/**
 * Normalize EVERY product DHL returns (not just the cheapest) — so it can be
 * shown alongside UPS's multiple service codes in the same comparison table.
 */
function extractAllQuotes(rawResponse) {
    const products = rawResponse?.products;
    if (!Array.isArray(products) || products.length === 0) {
        throw new Error('No rates returned from DHL API');
    }

    return products.map((product) => {
        const totalPriceList = Array.isArray(product.totalPrice) ? product.totalPrice : [];
        const billed = totalPriceList.find((p) => p.currencyType === 'BILLC') || totalPriceList[0];
        const currency = billed?.priceCurrency || 'THB';
        const total = asNumber(billed?.price, null);

        const detailedBilling = (product.detailedPriceBreakdown || [])
            .find((entry) => entry.currencyType === 'BILLC') || product.detailedPriceBreakdown?.[0];

        const chargeBreakdown = (detailedBilling?.breakdown || [])
            .filter((item) => item?.price !== undefined)
            .map((item) => {
                const code = item.serviceCode || item.localServiceCode || item.typeCode || 'BASE';
                return {
                    code,
                    description: describeDhlCharge(item, code),
                    amount: roundPrice(asNumber(item.price)),
                    currency
                };
            });

        return {
            serviceCode: product.productCode || null,
            serviceLabel: product.productName || product.localProductCode || product.productCode || 'DHL Service',
            currency,
            total,
            billedWeight: product.weight?.provided ?? null,
            billedWeightUnit: product.weight?.unitOfMeasurement || 'metric',
            // Whether this specific product actually used the account's negotiated contract
            // rate — some products on the same account can still fall back to the standard
            // list rate, so this price isn't ALWAYS a real contract price.
            isCustomerAgreement: product.isCustomerAgreement === true,
            transitDays: product.deliveryCapabilities?.totalTransitDays ?? null,
            estimatedDelivery: product.deliveryCapabilities?.estimatedDeliveryDateAndTime ?? null,
            chargeBreakdown
        };
    }).filter((q) => q.total != null && q.total > 0); // DHL sometimes returns a product with total 0 and an
    // empty breakdown when the account isn't actually enabled/priced for it — not a real free rate.
}

module.exports = { getRate, extractAllQuotes };
