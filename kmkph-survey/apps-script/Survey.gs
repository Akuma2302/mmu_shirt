/**
 * KMKPH ’26 — Design & price survey backend
 *
 * Receives survey answers from the survey page and writes one row per response to
 * "Responses". The "Results" tab keeps live vote counts, percentages and price answers.
 *
 * Setup: create a blank Google Sheet, put its ID in SHEET_ID (or open this script from
 * the Sheet via Extensions > Apps Script), run `setup` once, then Deploy > Web app
 * (Execute as: Me, Who has access: Anyone). Paste the /exec URL into SCRIPT_URL in index.html.
 */

const CONFIG = {
  // Only needed for a standalone script: the long ID in the Sheet's URL between /d/ and /edit
  SHEET_ID: '1jnoR2dK9LOiaL6LNhXeed9Xo4SHzRghWieXtLoQ5fx0',
  RESPONSES_SHEET: 'Responses',
  RESULTS_SHEET: 'Results',
  SURVEY_OPEN: true,          // set false to stop accepting answers
};

// Answer options. Keep in sync with OPTIONS in index.html. The server rejects anything else.
const OPTIONS = {
  design:   ['A', 'B', 'C', 'D', 'E'],
  reasons:  ['Warna', 'Logo / tulisan', 'Simple & minimal', 'Nampak premium', 'Boleh pakai hari-hari', 'Lain-lain'],
  sleeve:   ['Short sleeve', 'Long sleeve', 'Dua-dua pun okay'],
  size:     ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
  priceShort: ['Bawah RM40', 'RM40–49', 'RM50–59', 'RM60–69', 'RM70 ke atas'],
  priceLong:  ['Bawah RM50', 'RM50–59', 'RM60–69', 'RM70–79', 'RM80 ke atas'],
  tooExpensive: ['RM50', 'RM60', 'RM70', 'RM80', 'RM90 ke atas'],
  tooCheap:     ['RM20', 'RM30', 'RM40', 'RM50'],
  earlyBird: ['Ya, confirm', 'Mungkin', 'Tak, tunggu dulu'],
  notify:    ['Ya', 'Tak perlu'],
};
const DESIGN_LABELS = { A: 'Hitam + Ungu', B: 'Hitam + Putih', C: 'Cream + Navy', D: 'Cream + Ungu', E: 'Hitam + Emas' };

const HEADERS = [
  'Timestamp', 'Design Pilihan', 'Pilihan Kedua', 'Sebab Suka', 'Cadangan Design',
  'Jenis Lengan', 'Saiz', 'Niat Beli (1-5)', 'Harga Short Sleeve', 'Harga Long Sleeve',
  'Terlalu Mahal', 'Terlalu Murah', 'Early Bird', 'Program / Kuliah', 'Nak WhatsApp',
  'No WhatsApp', 'Response ID',
];

/* ---------- Web endpoints ---------- */

function doGet() {
  const sh = getOrCreateSheet_(ss_(), CONFIG.RESPONSES_SHEET, HEADERS);
  return json_({ ok: true, open: CONFIG.SURVEY_OPEN, total: Math.max(0, sh.getLastRow() - 1) });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return json_({ ok: false, error: 'Server sibuk, cuba lagi sekejap.' }); }
  try {
    if (!CONFIG.SURVEY_OPEN) return json_({ ok: false, error: 'Survey dah tutup. Terima kasih!' });
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, error: 'Empty request.' });
    const d = JSON.parse(e.postData.contents);
    if (d.website) return json_({ ok: true });       // honeypot: silently drop bots

    const v = validate_(d);
    if (v.error) return json_({ ok: false, error: v.error });

    const sh = getOrCreateSheet_(ss_(), CONFIG.RESPONSES_SHEET, HEADERS);
    sh.appendRow([
      new Date(), v.design, v.second, v.reasons.join(', '), safe_(v.suggestion),
      v.sleeve, v.size, v.intent, v.priceShort, v.priceLong,
      v.tooExpensive, v.tooCheap, v.earlyBird, safe_(v.program), v.notify,
      v.phone ? "'" + v.phone : '', safe_(v.responseId),
    ]);
    return json_({ ok: true, total: sh.getLastRow() - 1 });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error. Cuba lagi.' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Validation ---------- */

function pick_(value, list, required, label) {
  const s = String(value == null ? '' : value);
  if (!s) return required ? { error: 'Sila jawab: ' + label } : { value: '' };
  if (list.indexOf(s) < 0) return { error: 'Jawapan tak sah: ' + label };
  return { value: s };
}

function validate_(d) {
  const out = {};
  const req = [
    ['design', OPTIONS.design, true, 'design pilihan'],
    ['second', OPTIONS.design, false, 'pilihan kedua'],
    ['sleeve', OPTIONS.sleeve, true, 'jenis lengan'],
    ['size', OPTIONS.size, true, 'saiz'],
    ['priceShort', OPTIONS.priceShort, true, 'harga short sleeve'],
    ['priceLong', OPTIONS.priceLong, true, 'harga long sleeve'],
    ['tooExpensive', OPTIONS.tooExpensive, true, 'harga terlalu mahal'],
    ['tooCheap', OPTIONS.tooCheap, true, 'harga terlalu murah'],
    ['earlyBird', OPTIONS.earlyBird, true, 'early bird'],
    ['notify', OPTIONS.notify, true, 'WhatsApp'],
  ];
  for (const [key, list, required, label] of req) {
    const r = pick_(d[key], list, required, label);
    if (r.error) return r;
    out[key] = r.value;
  }
  if (out.second && out.second === out.design) out.second = '';

  const reasons = Array.isArray(d.reasons) ? d.reasons.map(String) : [];
  if (reasons.some(r => OPTIONS.reasons.indexOf(r) < 0)) return { error: 'Jawapan tak sah: sebab suka' };
  out.reasons = reasons.slice(0, OPTIONS.reasons.length);

  const intent = parseInt(d.intent, 10);
  if (!(intent >= 1 && intent <= 5)) return { error: 'Sila jawab: niat beli' };
  out.intent = intent;

  out.suggestion = String(d.suggestion || '').trim().slice(0, 300);
  out.program = String(d.program || '').trim().slice(0, 80);
  out.responseId = String(d.responseId || '').replace(/[^\w-]/g, '').slice(0, 40);

  out.phone = '';
  if (out.notify === 'Ya') {
    let p = String(d.phone || '').replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '6' + p;
    if (p && !/^60\d{8,10}$/.test(p)) return { error: 'No WhatsApp tak sah.' };
    out.phone = p;
  }
  return out;
}

/* ---------- Helpers ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#3b1661').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Stop spreadsheet formula injection (values starting with = + - @)
function safe_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function notify_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

/* ---------- One-time setup (run from the editor) ---------- */

function setup() {
  const ss = ss_();
  getOrCreateSheet_(ss, CONFIG.RESPONSES_SHEET, HEADERS);
  buildResults_(ss);
  const first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  notify_('Setup done. Now deploy: Deploy > New deployment > Web app.');
}

// Live results: counts and % for every multiple-choice question
function buildResults_(ss) {
  const sh = ss.getSheetByName(CONFIG.RESULTS_SHEET) || ss.insertSheet(CONFIG.RESULTS_SHEET);
  sh.clear();
  const R = CONFIG.RESPONSES_SHEET;
  const col = name => String.fromCharCode(65 + HEADERS.indexOf(name));   // header -> column letter
  let row = 1;

  sh.getRange(row, 1, 1, 2).setValues([['Jumlah responden', `=COUNTA(${R}!A2:A)`]]).setFontWeight('bold');
  row += 2;

  const block = (title, header, options, labels) => {
    const c = col(header);
    sh.getRange(row, 1, 1, 3).setValues([[title, 'Undi', '%']]).setFontWeight('bold').setBackground('#3b1661').setFontColor('#ffffff');
    row++;
    const start = row;
    options.forEach(o => {
      const label = labels ? `${o} · ${labels[o]}` : o;
      sh.getRange(row, 1, 1, 3).setValues([[label, `=COUNTIF(${R}!${c}2:${c}, "${o}")`, `=IFERROR(B${row}/SUM(B$${start}:B$${start + options.length - 1}), 0)`]]);
      sh.getRange(row, 3).setNumberFormat('0%');
      row++;
    });
    row++;
  };

  block('Design pilihan utama', 'Design Pilihan', OPTIONS.design, DESIGN_LABELS);
  block('Pilihan kedua', 'Pilihan Kedua', OPTIONS.design, DESIGN_LABELS);
  block('Jenis lengan', 'Jenis Lengan', OPTIONS.sleeve);
  block('Saiz', 'Saiz', OPTIONS.size);
  block('Sanggup bayar (short sleeve)', 'Harga Short Sleeve', OPTIONS.priceShort);
  block('Sanggup bayar (long sleeve)', 'Harga Long Sleeve', OPTIONS.priceLong);
  block('Terlalu mahal pada', 'Terlalu Mahal', OPTIONS.tooExpensive);
  block('Terlalu murah pada', 'Terlalu Murah', OPTIONS.tooCheap);
  block('Early bird', 'Early Bird', OPTIONS.earlyBird);

  // "Sebab suka" is multi-select, so count with wildcards
  const rc = col('Sebab Suka');
  sh.getRange(row, 1, 1, 2).setValues([['Sebab suka (boleh pilih banyak)', 'Undi']]).setFontWeight('bold').setBackground('#3b1661').setFontColor('#ffffff');
  row++;
  OPTIONS.reasons.forEach(o => { sh.getRange(row, 1, 1, 2).setValues([[o, `=COUNTIF(${R}!${rc}2:${rc}, "*${o}*")`]]); row++; });
  row++;

  const ic = col('Niat Beli (1-5)');
  sh.getRange(row, 1, 1, 2).setValues([['Purata niat beli (1-5)', `=IFERROR(AVERAGE(${R}!${ic}2:${ic}), 0)`]]).setFontWeight('bold');
  sh.getRange(row, 2).setNumberFormat('0.0');
  sh.getRange(row + 1, 1, 1, 2).setValues([['Confirm beli (4-5)', `=COUNTIF(${R}!${ic}2:${ic}, ">=4")`]]);
  sh.setColumnWidth(1, 260);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidth(3, 70);
}

/** Removes responses whose Program / Kuliah starts with "TEST" (for clearing your own tests). */
function removeTestResponses() {
  const sh = ss_().getSheetByName(CONFIG.RESPONSES_SHEET);
  const pc = HEADERS.indexOf('Program / Kuliah');
  const rows = sh.getDataRange().getValues();
  let n = 0;
  for (let r = rows.length - 1; r >= 1; r--) {
    if (String(rows[r][pc]).toUpperCase().startsWith('TEST')) { sh.deleteRow(r + 1); n++; }
  }
  notify_(`Removed ${n} test response(s).`);
}
