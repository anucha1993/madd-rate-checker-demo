const form = document.getElementById('rate-form');
const resultEl = document.getElementById('result');
const errorEl = document.getElementById('error');
const submitBtn = document.getElementById('submit-btn');
const provinceListEl = document.getElementById('province-list');

let thAddressData = { available: false, provinces: [], postcodeMap: {}, amphurs: [] };

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ---------- Shipment wizard: Step 1 (route) → Step 2 (package), like DHL's "next step" flow ----------
const stepRouteEl = document.getElementById('step-route');
const stepRouteSummaryEl = document.getElementById('step-route-summary');
const stepPackageEl = document.getElementById('step-package');
const btnNextStep = document.getElementById('btn-next-step');

function goToPackageStep() {
  // Validate only the Step 1 (route) fields — calling form.reportValidity() here would
  // also try (and fail) to validate the still-hidden Step 2 package fields.
  const routeFields = stepRouteEl.querySelectorAll('input[required], select[required]');
  for (const field of routeFields) {
    if (!field.reportValidity()) return;
  }

  const fromLine = [form.from_city.value, form.from_country.value.toUpperCase()].filter(Boolean).join(', ');
  const toLine = [form.to_city.value, form.to_country.value.toUpperCase()].filter(Boolean).join(', ');
  stepRouteSummaryEl.innerHTML = `<span>📍 ${fromLine} → ${toLine}</span><span class="edit-hint">✏️ แก้ไขที่อยู่</span>`;

  stepRouteEl.classList.add('hidden');
  stepRouteSummaryEl.classList.remove('hidden');
  stepPackageEl.classList.remove('hidden');
}

function backToRouteStep() {
  stepPackageEl.classList.add('hidden');
  stepRouteSummaryEl.classList.add('hidden');
  stepRouteEl.classList.remove('hidden');
}

btnNextStep.addEventListener('click', goToPackageStep);
stepRouteSummaryEl.addEventListener('click', backToRouteStep);

// ---------- Shipment type (เอกสาร / พัสดุ) — document ships as a fixed small envelope ----------
const shipmentTypeDocument = document.getElementById('shipment-type-document');
const shipmentTypePackage = document.getElementById('shipment-type-package');
const sizeModeRow = document.getElementById('size-mode-row');
const boxPresetRow = document.getElementById('box-preset-row');

function applyShipmentType() {
  const isDocument = shipmentTypeDocument.checked;
  sizeModeRow.classList.toggle('hidden', isDocument);
  boxPresetRow.classList.toggle('hidden', isDocument || document.getElementById('size-mode-custom').checked);
  if (isDocument) {
    form.pkg_weight.value = '0.5';
    form.pkg_width.value = '22';
    form.pkg_length.value = '30';
    form.pkg_height.value = '2';
  }
}
shipmentTypeDocument.addEventListener('change', applyShipmentType);
shipmentTypePackage.addEventListener('change', applyShipmentType);

// ---------- Size mode (กำหนดขนาดเอง / ขนาดมาตรฐาน) ----------
const sizeModeCustom = document.getElementById('size-mode-custom');
const sizeModeStandard = document.getElementById('size-mode-standard');

function applySizeMode() {
  boxPresetRow.classList.toggle('hidden', sizeModeCustom.checked);
}
sizeModeCustom.addEventListener('change', applySizeMode);
sizeModeStandard.addEventListener('change', applySizeMode);

// ---------- Standard box size presets — pick one to auto-fill dimensions ----------
document.querySelectorAll('.box-preset-card input[name="boxPreset"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    form.pkg_length.value = radio.dataset.l;
    form.pkg_width.value = radio.dataset.w;
    form.pkg_height.value = radio.dataset.h;
  });
});

// ---------- Environment badge (Production vs Sandbox) ----------
fetch('/api/environment')
  .then((r) => r.json())
  .then((env) => {
    const badge = document.getElementById('env-badge');
    if (env.isProduction) {
      badge.textContent = '🟢 PRODUCTION — ราคาจริง';
      badge.classList.add('env-badge-prod');
    } else {
      badge.textContent = '🧪 SANDBOX — ข้อมูลทดสอบ ไม่ใช่ราคาจริง';
      badge.classList.add('env-badge-sandbox');
    }
  })
  .catch(() => {});

// ---------- Load ALL UPS accounts from the DB — every one gets tested, not just one ----------
const accountsStatusEl = document.getElementById('accounts-status');
const accountsListEl = document.getElementById('accounts-list');

fetch('/api/ups-accounts')
  .then((r) => r.json())
  .then((accounts) => {
    if (!accounts.length) {
      accountsStatusEl.textContent = '⚠️ ไม่พบบัญชีใน DB (หรือ DB ไม่ได้เชื่อมต่อ) — กรอกบัญชีเสริมด้านล่างแทน';
      return;
    }
    accountsStatusEl.textContent = `พบ ${accounts.length} บัญชี — จะทดสอบทุกบัญชีพร้อมกัน (เอาออกได้ถ้าไม่ต้องการ):`;
    accountsListEl.innerHTML = accounts.map((a) => `
      <label class="account-item">
        <input type="checkbox" class="account-checkbox" value="${a.id}" checked />
        ${a.username_acc}
      </label>
    `).join('');
  })
  .catch(() => {
    accountsStatusEl.textContent = '⚠️ โหลดรายชื่อบัญชีไม่สำเร็จ — กรอกบัญชีเสริมด้านล่างแทน';
  });

// ---------- Load ALL DHL accounts from the DB — every one gets tested, not just one ----------
const dhlAccountsStatusEl = document.getElementById('dhl-accounts-status');
const dhlAccountsListEl = document.getElementById('dhl-accounts-list');

fetch('/api/dhl-accounts')
  .then((r) => r.json())
  .then((accounts) => {
    if (!accounts.length) {
      dhlAccountsStatusEl.textContent = '⚠️ ไม่พบบัญชีใน DB (หรือ DB ไม่ได้เชื่อมต่อ) — กรอกบัญชีเสริมด้านล่างแทน';
      return;
    }
    dhlAccountsStatusEl.textContent = `พบ ${accounts.length} บัญชี — จะทดสอบทุกบัญชีพร้อมกัน (เอาออกได้ถ้าไม่ต้องการ):`;
    dhlAccountsListEl.innerHTML = accounts.map((a) => `
      <label class="account-item">
        <input type="checkbox" class="dhl-account-checkbox" value="${a.id}" checked />
        ${a.username_acc}
      </label>
    `).join('');
  })
  .catch(() => {
    dhlAccountsStatusEl.textContent = '⚠️ โหลดรายชื่อบัญชีไม่สำเร็จ — กรอกบัญชีเสริมด้านล่างแทน';
  });

// ---------- Load service codes — every one selected gets tested, so the "odd one out" stands out ----------
const serviceCodesListEl = document.getElementById('service-codes-list');

fetch('/api/service-codes')
  .then((r) => r.json())
  .then((codes) => {
    serviceCodesListEl.innerHTML = codes.map((c) => `
      <label class="account-item">
        <input type="checkbox" class="service-code-checkbox" value="${c.code}" checked />
        ${c.code} — ${c.label}
      </label>
    `).join('');
  })
  .catch(() => {});

// ---------- Optional TH province/postcode reference data (Ship From only — Ship To is always international) ----------
const amphurListEls = {
  from: document.getElementById('amphur-list-from')
};

fetch('/api/th-address-data')
  .then((r) => r.json())
  .then((data) => {
    thAddressData = data;
    if (data.available) {
      provinceListEl.innerHTML = data.provinces.map((p) => `<option value="${p}">`).join('');
      amphurListEls.from.innerHTML = data.amphurs.map((a) => `<option value="${a.name}">`).join('');
    }
  })
  .catch(() => {});

// ---------- Postcode auto-fill (TH only, Ship From only) — type a postcode, get จังหวัด/อำเภอ suggested ----------
['from'].forEach((target) => {
  const postcodeField = form[`${target}_postcode`];
  postcodeField.addEventListener('input', () => {
    if (!thAddressData.available) return;
    const postcode = postcodeField.value.trim();
    if (!/^\d{5}$/.test(postcode)) {
      // Incomplete/cleared postcode — restore the full district dropdown.
      amphurListEls[target].innerHTML = thAddressData.amphurs.map((a) => `<option value="${a.name}">`).join('');
      return;
    }

    const matches = thAddressData.amphurs.filter((a) => a.postcode === postcode);
    if (matches.length === 0) return;

    const provinceField = form[`${target}_province`] || form[`${target}_stateCode`];
    const cityField = form[`${target}_city`];

    if (provinceField && !provinceField.value) provinceField.value = matches[0].province;

    if (matches.length === 1) {
      // Unambiguous — safe to fill the district directly.
      if (!cityField.value) cityField.value = matches[0].name;
      amphurListEls[target].innerHTML = `<option value="${matches[0].name}">`;
    } else {
      // Same postcode, more than one เขต/อำเภอ (e.g. 10310) — narrow the dropdown
      // to just these options instead of guessing which one the user means.
      amphurListEls[target].innerHTML = matches.map((a) => `<option value="${a.name}">`).join('');
    }
  });
});

// ---------- Paste-address auto-parse (Thai addresses only) ----------
document.querySelectorAll('.btn-parse').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target; // 'from' | 'to'
    const textarea = document.querySelector(`.paste-address[data-target="${target}"]`);
    parseAndFillAddress(target, textarea.value);
  });
});

function parseAndFillAddress(target, text) {
  if (!text || !text.trim()) return;

  if (!thAddressData.available) {
    alert('ไม่พบข้อมูลอ้างอิงจังหวัด/รหัสไปรษณีย์ (DB ไม่ได้เชื่อมต่อ) — กรอกเองได้ตามปกติ');
    return;
  }

  let remaining = text.trim();
  const provinceField = form[`${target}_stateCode`] || form[`${target}_province`];
  const cityField = form[`${target}_city`];
  const postcodeField = form[`${target}_postcode`];
  const addressField = form[`${target}_address`];

  // 1. Prefer an EXACT amphur/เขต name found in the text — unambiguous, unlike postcode.
  //    (Several Bangkok postcodes are shared by more than one เขต, e.g. 10310 =
  //    ห้วยขวาง AND วังทองหลาง — a postcode-only lookup can silently pick the wrong one.)
  let matchedInfo = null;
  const amphurList = thAddressData.amphurs || [];
  const sortedByLength = [...amphurList].sort((a, b) => b.name.length - a.name.length);
  const foundAmphur = sortedByLength.find((a) => remaining.includes(a.name));

  if (foundAmphur) {
    matchedInfo = { amphur: foundAmphur.name, province: foundAmphur.province };
    cityField.value = foundAmphur.name;
    if (provinceField) provinceField.value = foundAmphur.province;
    // Only fill the postcode field if the user didn't already paste a (possibly more
    // precise) one of their own — otherwise use the amphur's postcode as a fallback.
    const postcodeInText = remaining.match(/\b(\d{5})\b/);
    postcodeField.value = postcodeInText ? postcodeInText[1] : foundAmphur.postcode;
    // Strip the "เขต"/"อำเภอ" prefix along with the name so it doesn't leave a stray word behind.
    remaining = remaining
      .replace(`เขต${foundAmphur.name}`, '')
      .replace(`อำเภอ${foundAmphur.name}`, '')
      .replace(foundAmphur.name, '')
      .replace(foundAmphur.province, '');
    if (postcodeInText) remaining = remaining.replace(postcodeInText[0], '');
  } else {
    // 2. No amphur name recognized — fall back to postcode reverse-lookup (ambiguous
    //    when a postcode is shared by more than one เขต, but better than nothing).
    const postcodeMatch = remaining.match(/\b(\d{5})\b/);
    if (postcodeMatch) {
      const postcode = postcodeMatch[1];
      matchedInfo = thAddressData.postcodeMap[postcode];
      if (matchedInfo) {
        postcodeField.value = postcode;
        cityField.value = matchedInfo.amphur;
        if (provinceField) provinceField.value = matchedInfo.province;
      }
      remaining = remaining.replace(postcodeMatch[0], '');
    }

    // 3. Still nothing — try to find a known province name directly in the text
    if (!matchedInfo) {
      const foundProvince = thAddressData.provinces.find((p) => remaining.includes(p));
      if (foundProvince && provinceField) {
        provinceField.value = foundProvince;
        remaining = remaining.replace(foundProvince, '');
      }
    } else {
      remaining = remaining.replace(matchedInfo.province, '').replace(matchedInfo.amphur, '');
    }
  }

  // 4. Whatever text is left becomes the address line (cleaned up)
  addressField.value = remaining.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim().replace(/,$/, '').trim();
}

// ---------- Submit ----------
function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังยิงไป UPS...';

  const fd = new FormData(form);
  const selectedAccountIds = Array.from(document.querySelectorAll('.account-checkbox:checked')).map((c) => c.value);
  const selectedDhlAccountIds = Array.from(document.querySelectorAll('.dhl-account-checkbox:checked')).map((c) => c.value);

  const payload = {
    accountIds: selectedAccountIds,
    customAccount: {
      clientId: fd.get('clientId') || undefined,
      clientSecret: fd.get('clientSecret') || undefined,
      shipperNumber: fd.get('shipperNumber') || undefined
    },
    dhlAccountIds: selectedDhlAccountIds,
    customDhlAccount: {
      accountNumber: fd.get('dhlAccountNumber') || undefined,
      basicAuthUsername: fd.get('dhlBasicAuthUsername') || undefined,
      basicAuthPassword: fd.get('dhlBasicAuthPassword') || undefined
    },
    serviceCodes: Array.from(document.querySelectorAll('.service-code-checkbox:checked')).map((c) => c.value),
    from: {
      address: fd.get('from_address'),
      city: fd.get('from_city'),
      postcode: fd.get('from_postcode'),
      country: fd.get('from_country').toUpperCase()
    },
    to: {
      address: fd.get('to_address'),
      city: fd.get('to_city'),
      stateCode: fd.get('to_stateCode') || undefined,
      postcode: fd.get('to_postcode'),
      country: fd.get('to_country').toUpperCase()
    },
    packages: [
      {
        quantity: 1,
        weight: Number(fd.get('pkg_weight')),
        weightUnit: fd.get('pkg_weightUnit'),
        length: Number(fd.get('pkg_length')),
        width: Number(fd.get('pkg_width')),
        height: Number(fd.get('pkg_height')),
        dimensionUnit: fd.get('pkg_dimensionUnit')
      }
    ]
  };

  try {
    const res = await fetch('/api/check-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error + (data.detail ? '\n' + JSON.stringify(data.detail, null, 2) : ''));
    }

    renderResult(data);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'ตรวจสอบราคา';
  }
});

function renderResult(data) {
  const allResults = data.results || [];
  const failedCount = allResults.filter((r) => r.error).length;

  // Hide failed rows entirely (unless a manual fallback price already replaced them
  // server-side), and show the cheapest option first.
  const shownResults = allResults
    .filter((r) => !r.error)
    .sort((a, b) => (a.negotiated ?? a.published ?? Infinity) - (b.negotiated ?? b.published ?? Infinity));

  // Group rows by account (carrier + username), each group sub-divided by service price.
  // shownResults is already sorted ascending by price overall, so the first appearance of
  // each group key lands the groups themselves in ascending order of their cheapest service.
  window.__rawResponses = {}; // stash raw UPS JSON per row so the "raw" button can find it without re-rendering huge strings inline
  window.__breakdowns = {}; // stash itemized charge breakdown per row for the "รายละเอียด" toggle

  const groups = new Map();
  shownResults.forEach((r) => {
    const key = `${r.carrier}::${r.username}`;
    if (!groups.has(key)) groups.set(key, { carrier: r.carrier, username: r.username, items: [] });
    groups.get(key).items.push(r);
  });

  let idx = 0;
  const rows = [...groups.values()].map((group) => {
    const cheapestInGroup = group.items[0];
    const groupHeader = `
      <tr class="account-group-header">
        <td colspan="7">
          <span class="badge carrier-${(group.carrier || '').toLowerCase()}">${group.carrier || ''}</span>
          บัญชี <strong>${group.username}</strong>
          — ถูกที่สุดในบัญชีนี้: ${fmt(cheapestInGroup.negotiated)} บาท (${group.items.length} service${group.items.length > 1 ? 's' : ''})
        </td>
      </tr>
    `;

    const serviceRows = group.items.map((r) => {
      const rowIdx = idx++;
      window.__rawResponses[rowIdx] = r.rawResponse;
      window.__breakdowns[rowIdx] = { lines: r.chargeBreakdown || [], total: r.negotiated, currency: r.currency };

      const isStandardRate = r.carrier === 'DHL' && r.isCustomerAgreement === false;
      const statusBadges = [
        rowIdx === 0 ? '<span class="badge cheapest">💰 ต่ำสุด</span>' : '',
        r.anomaly ? '<span class="badge anomaly">⚠️ แปลกจากกลุ่ม</span>' : '',
        isStandardRate ? '<span class="badge standard-rate" title="บัญชีนี้ยังไม่มีสัญญาราคาพิเศษสำหรับ service นี้ — ราคาที่เห็นคือราคามาตรฐาน ไม่ใช่ราคาสัญญา">⚠️ ราคามาตรฐาน (ไม่ใช่สัญญา)</span>' : ''
      ].filter(Boolean).join(' ');

      const transitNote = r.transitDays != null ? ` <span class="transit-note">(~${r.transitDays} วัน)</span>` : '';

      return `
        <tr class="service-row ${r.anomaly ? 'row-anomaly' : ''} ${rowIdx === 0 ? 'row-cheapest' : ''}">
          <td><span class="badge carrier-${(r.carrier || '').toLowerCase()}">${r.carrier || ''}</span></td>
          <td class="sub-cell">↳ ${r.username}</td>
          <td>${r.serviceCode ?? ''} — ${r.serviceLabel || ''}${transitNote}</td>
          <td>${r.billedWeight ? `${r.billedWeight} ${r.billedWeightUnit || ''}` : '—'}</td>
          <td>${fmt(r.negotiated)}</td>
          <td>${statusBadges}</td>
          <td>
            <button type="button" class="btn-breakdown" data-idx="${rowIdx}">💵 รายละเอียด</button>
            <button type="button" class="btn-raw" data-idx="${rowIdx}">🧾 Raw</button>
          </td>
        </tr>
        <tr class="breakdown-row hidden" id="breakdown-row-${rowIdx}">
          <td colspan="7"></td>
        </tr>
        <tr class="raw-row hidden" id="raw-row-${rowIdx}">
          <td colspan="7"><pre class="raw-json"></pre></td>
        </tr>
      `;
    }).join('');

    return groupHeader + serviceRows;
  }).join('');

  resultEl.innerHTML = `
    <h2>ผลลัพธ์ — ทดสอบทั้งหมด ${data.accountCount} บัญชี (UPS + DHL) (${shownResults.length} รายการ เรียงราคาต่ำสุดก่อน${failedCount ? `, ซ่อนรายการที่ผิดพลาด ${failedCount} รายการ` : ''})</h2>
    <table class="result-table">
      <thead>
        <tr>
          <th>Carrier</th>
          <th>บัญชี</th>
          <th>Service</th>
          <th>น้ำหนักที่คิดเงิน</th>
          <th>Negotiated / Rate</th>
          <th>สถานะ</th>
          <th>ตัวเลือก</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  resultEl.classList.remove('hidden');

  document.querySelectorAll('.btn-breakdown').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const row = document.getElementById(`breakdown-row-${idx}`);
      const cell = row.querySelector('td');
      if (row.classList.contains('hidden')) {
        const { lines, total, currency } = window.__breakdowns[idx];
        const lineRows = lines.length
          ? lines.map((l) => `<tr><td>${l.description || l.code || ''}</td><td>${fmt(l.amount)}</td></tr>`).join('')
          : '<tr><td colspan="2">ไม่มีข้อมูลรายละเอียดค่าบริการ</td></tr>';
        cell.innerHTML = `
          <table class="breakdown-table">
            <thead><tr><th>รายการ</th><th>จำนวนเงิน (${currency || 'THB'})</th></tr></thead>
            <tbody>${lineRows}</tbody>
            <tfoot><tr><td>รวม</td><td>${fmt(total)}</td></tr></tfoot>
          </table>
        `;
      }
      row.classList.toggle('hidden');
    });
  });

  document.querySelectorAll('.btn-raw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const rawRow = document.getElementById(`raw-row-${idx}`);
      const pre = rawRow.querySelector('.raw-json');
      if (rawRow.classList.contains('hidden')) {
        pre.textContent = JSON.stringify(window.__rawResponses[idx], null, 2);
      }
      rawRow.classList.toggle('hidden');
    });
  });
}
