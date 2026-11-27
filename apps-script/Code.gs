/**
 * MMU Collegiate Series ’26 — Pre-order backend
 *
 * Receives orders from the landing page, saves payment proofs to Google Drive,
 * writes one row per order to "Orders", one row per line item to "Items",
 * keeps a live production count in "Summary", and emails the buyer a confirmation.
 *
 * Setup: see README.md. Run `setup` once from the editor, then Deploy > Web app.
 */

const CONFIG = {
  ORDERS_SHEET: 'Orders',
  ITEMS_SHEET: 'Items',
  SUMMARY_SHEET: 'Summary',
  PROOF_FOLDER_NAME: 'MMU26 Payment Proofs',
  ORDER_PREFIX: 'MMU26-',

  // Server-side prices are the source of truth. Keep in sync with index.html.
  PRODUCTS: {
    short: { label: 'Short Sleeve', price: 69, earlyBird: 59 },
    long:  { label: 'Long Sleeve',  price: 75, earlyBird: 65 },
  },
  // Early bird: until this time OR the first N pieces (all sleeves combined), whichever comes first.
  // Cancelled orders give their early-bird pieces back.
  EARLY_BIRD_UNTIL: '2026-12-06T23:59:00+08:00',
  EARLY_BIRD_LIMIT: 30,
  SIZES: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  MAX_QTY_PER_LINE: 20,
  MAX_FILE_MB: 5,

  ORDERS_OPEN: true,          // set false to close pre-orders early
  // Pre-order period (Malaysia time). Orders outside it are rejected. Keep in sync with index.html
  OPENS_AT: '2026-11-24T00:00:00+08:00',
  CLOSES_AT: '2026-12-06T23:59:00+08:00',
  SEND_CONFIRMATION_EMAIL: true,
  ADMIN_EMAIL: '',            // optional: get a copy of every order, e.g. 'you@gmail.com'

  // The orders spreadsheet. Only needed when the script isn't opened from the Sheet itself
  // (the ID is the long part of the Sheet's URL between /d/ and /edit).
  SHEET_ID: '1q0tYRYuXnnbiEFVS8AjbsJuQoiR7YUbgVNR6JMCRcC0',
};

// The orders spreadsheet: the Sheet this script is attached to, or SHEET_ID for a standalone script
function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

const STATUSES = ['Pending verification', 'Paid', 'Payment issue', 'Ready for pickup', 'Collected', 'Cancelled'];

const ORDER_HEADERS = [
  'Order ID', 'Timestamp', 'Full Name', 'WhatsApp', 'Email', 'Student/Staff ID',
  'Items', 'Total Qty', 'Total (RM)', 'Payment Proof', 'Referral', 'Notes', 'Status', 'Admin Notes',
];
const ITEM_HEADERS = ['Order ID', 'Timestamp', 'Variant', 'Size', 'Qty', 'Unit Price (RM)', 'Line Total (RM)', 'Order Status', 'Price Type'];

/* ---------- Web endpoints ---------- */

function orderWindow_() {
  const now = Date.now();
  if (now < new Date(CONFIG.OPENS_AT).getTime()) return 'Pre-order opens on 24 Nov 2026.';
  if (now > new Date(CONFIG.CLOSES_AT).getTime()) return 'Pre-order has closed.';
  if (!CONFIG.ORDERS_OPEN) return 'Pre-orders are closed.';
  return '';
}

// Early-bird pieces still available (0 once the deadline passes or 30 are taken)
function earlyBirdLeft_(itemsSheet) {
  if (Date.now() > new Date(CONFIG.EARLY_BIRD_UNTIL).getTime()) return 0;
  const last = itemsSheet.getLastRow();
  let used = 0;
  if (last > 1) {
    itemsSheet.getRange(2, 5, last - 1, 5).getValues().forEach(r => {   // columns E..I
      const qty = Number(r[0]) || 0, status = r[3], type = r[4];
      if (type === 'Early bird' && status !== 'Cancelled') used += qty;
    });
  }
  return Math.max(0, CONFIG.EARLY_BIRD_LIMIT - used);
}

// Splits each item into early-bird and normal-price lines, using up the remaining early-bird pieces
function priceItems_(items, earlyLeft) {
  const lines = [];
  items.forEach(i => {
    const p = CONFIG.PRODUCTS[i.variant];
    const early = Math.min(i.qty, earlyLeft);
    earlyLeft -= early;
    if (early > 0) lines.push({ variant: i.variant, size: i.size, qty: early, unit: p.earlyBird, type: 'Early bird' });
    if (i.qty - early > 0) lines.push({ variant: i.variant, size: i.size, qty: i.qty - early, unit: p.price, type: 'Normal' });
  });
  return lines;
}

function doGet() {
  const ss = ss_();
  const itemsSheet = getOrCreateSheet_(ss, CONFIG.ITEMS_SHEET, ITEM_HEADERS);
  return json_({ ok: true, open: !orderWindow_(), opensAt: CONFIG.OPENS_AT, closesAt: CONFIG.CLOSES_AT,
    earlyBirdLeft: earlyBirdLeft_(itemsSheet), earlyBirdLimit: CONFIG.EARLY_BIRD_LIMIT });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ ok: false, error: 'Server is busy, please try again in a moment.' });
  }

  try {
    const closedMsg = orderWindow_();
    if (closedMsg) return json_({ ok: false, error: closedMsg });
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, error: 'Empty request.' });

    const d = JSON.parse(e.postData.contents);
    if (d.website) return json_({ ok: true, orderId: 'OK', total: 0 }); // honeypot: silently drop bots

    const v = validate_(d);
    if (v.error) return json_({ ok: false, error: v.error });

    const ss = ss_();
    const orders = getOrCreateSheet_(ss, CONFIG.ORDERS_SHEET, ORDER_HEADERS);
    const itemsSheet = getOrCreateSheet_(ss, CONFIG.ITEMS_SHEET, ITEM_HEADERS);

    const orderId = nextOrderId_(orders);
    const now = new Date();
    const proofUrl = saveProof_(d.proof, orderId, v.name);

    const lines = priceItems_(v.items, earlyBirdLeft_(itemsSheet));
    const itemsText = lines.map(l => `${l.qty}× ${CONFIG.PRODUCTS[l.variant].label} ${l.size} @RM${l.unit}${l.type === 'Early bird' ? ' (early bird)' : ''}`).join(', ');
    const totalQty = lines.reduce((a, l) => a + l.qty, 0);
    const total = lines.reduce((a, l) => a + l.qty * l.unit, 0);
    const earlyQty = lines.filter(l => l.type === 'Early bird').reduce((a, l) => a + l.qty, 0);

    orders.appendRow([
      orderId, now, safe_(v.name), safe_("'" + v.phone), safe_(v.email), safe_(v.studentId),
      itemsText, totalQty, total, proofUrl, safe_(v.referral), safe_(v.notes), STATUSES[0], '',
    ]);
    const orderRow = orders.getLastRow();

    lines.forEach(l => {
      itemsSheet.appendRow([orderId, now, CONFIG.PRODUCTS[l.variant].label, l.size, l.qty, l.unit, l.unit * l.qty, '', l.type]);
      const r = itemsSheet.getLastRow();
      // Item status mirrors the order status so the Summary can exclude cancelled orders
      itemsSheet.getRange(r, 8).setFormula(
        `=IFERROR(INDEX(${CONFIG.ORDERS_SHEET}!M:M, MATCH(A${r}, ${CONFIG.ORDERS_SHEET}!A:A, 0)), "")`
      );
    });

    SpreadsheetApp.flush();

    if (CONFIG.SEND_CONFIRMATION_EMAIL) {
      try { sendConfirmation_(v, orderId, itemsText, total); } catch (err) { console.warn('Email failed: ' + err); }
    }
    if (CONFIG.ADMIN_EMAIL) {
      try {
        MailApp.sendEmail(CONFIG.ADMIN_EMAIL, `[New order] ${orderId} — RM${total}`,
          `${v.name} (${v.phone}, ${v.email})\n${itemsText}\nTotal: RM${total}\nProof: ${proofUrl}\nRow: ${orderRow}`);
      } catch (err) { console.warn('Admin email failed: ' + err); }
    }

    return json_({ ok: true, orderId: orderId, total: total, earlyQty: earlyQty, totalQty: totalQty });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error. Please try again.' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Validation ---------- */

function validate_(d) {
  const name = String(d.name || '').trim().slice(0, 100);
  const email = String(d.email || '').trim().slice(0, 120);
  let phone = String(d.phone || '').replace(/[^\d]/g, '');
  if (phone.startsWith('0')) phone = '6' + phone;

  if (name.length < 3) return { error: 'Please enter your full name.' };
  if (!/^60\d{8,10}$/.test(phone)) return { error: 'Invalid WhatsApp number.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Invalid email.' };

  if (!Array.isArray(d.items) || !d.items.length || d.items.length > 10) return { error: 'Invalid items.' };
  const items = [];
  for (const it of d.items) {
    const variant = String(it.variant);
    const size = String(it.size);
    const qty = parseInt(it.qty, 10);
    if (!CONFIG.PRODUCTS[variant]) return { error: 'Invalid sleeve option.' };
    if (CONFIG.SIZES.indexOf(size) < 0) return { error: 'Invalid size.' };
    if (!(qty >= 1 && qty <= CONFIG.MAX_QTY_PER_LINE)) return { error: 'Invalid quantity.' };
    items.push({ variant, size, qty });
  }

  const p = d.proof || {};
  if (!p.data || !p.mime) return { error: 'Payment proof is required.' };
  if (!/^image\/|^application\/pdf$/.test(p.mime)) return { error: 'Payment proof must be an image or PDF.' };
  if (p.data.length * 0.75 > CONFIG.MAX_FILE_MB * 1024 * 1024) return { error: 'Payment proof is too large.' };

  return {
    name, email, phone, items,
    studentId: String(d.studentId || '').trim().slice(0, 30),
    referral: String(d.referral || '').trim().slice(0, 100),
    notes: String(d.notes || '').trim().slice(0, 300),
  };
}

/* ---------- Helpers ---------- */

function saveProof_(proof, orderId, name) {
  const folder = getProofFolder_();
  const ext = (proof.mime === 'application/pdf') ? 'pdf' : (proof.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const cleanName = name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 40);
  const blob = Utilities.newBlob(Utilities.base64Decode(proof.data), proof.mime, `${orderId}_${cleanName}.${ext}`);
  return folder.createFile(blob).getUrl(); // stays private to you (not shared publicly)
}

function getProofFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PROOF_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder(CONFIG.PROOF_FOLDER_NAME);
  props.setProperty('PROOF_FOLDER_ID', folder.getId());
  return folder;
}

function nextOrderId_(sheet) {
  const props = PropertiesService.getScriptProperties();
  const n = parseInt(props.getProperty('ORDER_SEQ') || '0', 10) + 1;
  props.setProperty('ORDER_SEQ', String(n));
  return CONFIG.ORDER_PREFIX + String(n).padStart(4, '0');
}

function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Stop spreadsheet formula injection (values starting with = + - @)
function safe_(v) {
  v = String(v == null ? '' : v);
  if (v.startsWith("'")) return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

// Pop-up when run from the Sheet's menu; falls back to the log when run from the script editor
function notify_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sendConfirmation_(v, orderId, itemsText, total) {
  const subject = `Your MMU Collegiate Series ’26 pre-order — ${orderId}`;
  const body =
`Hi ${v.name},

Thanks for your pre-order! We've received it and will verify your payment.

Order ID: ${orderId}
Items: ${itemsText}
Total: RM${total}

Collection: Self pickup at MMU. Pickup date, time and location will be announced once production is complete.
Please keep this email and your Order ID for pickup.

— MMU Collegiate Series ’26`;
  MailApp.sendEmail({ to: v.email, subject: subject, body: body, name: 'MMU Collegiate Series ’26' });
}

/* ---------- One-time setup (run from the editor) ---------- */

function setup() {
  const ss = ss_();
  const orders = getOrCreateSheet_(ss, CONFIG.ORDERS_SHEET, ORDER_HEADERS);
  getOrCreateSheet_(ss, CONFIG.ITEMS_SHEET, ITEM_HEADERS);

  // Status dropdown on the Orders sheet
  const statusCol = ORDER_HEADERS.indexOf('Status') + 1;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  orders.getRange(2, statusCol, orders.getMaxRows() - 1, 1).setDataValidation(rule);

  // Colour-code statuses
  const range = orders.getRange(2, 1, orders.getMaxRows() - 1, ORDER_HEADERS.length);
  const col = String.fromCharCode(64 + statusCol);
  const colors = { 'Paid': '#d9f2e3', 'Payment issue': '#fde2e1', 'Ready for pickup': '#dbe7fb', 'Collected': '#e5e5e5', 'Cancelled': '#f3f3f3' };
  orders.setConditionalFormatRules(Object.keys(colors).map(s =>
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${col}2="${s}"`).setBackground(colors[s]).setRanges([range]).build()
  ));

  buildSummary_(ss);
  getProofFolder_();
  notify_('Setup done. Now deploy: Deploy > New deployment > Web app.');
}

function buildSummary_(ss) {
  const sh = ss.getSheetByName(CONFIG.SUMMARY_SHEET) || ss.insertSheet(CONFIG.SUMMARY_SHEET);
  sh.clear();
  const variants = Object.keys(CONFIG.PRODUCTS).map(k => CONFIG.PRODUCTS[k].label);
  sh.getRange(1, 1).setValue('Production count (excludes Cancelled)').setFontWeight('bold');
  sh.getRange(2, 1, 1, variants.length + 2).setValues([['Size'].concat(variants, ['Total'])]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');

  const I = CONFIG.ITEMS_SHEET;
  CONFIG.SIZES.forEach((size, idx) => {
    const r = idx + 3;
    sh.getRange(r, 1).setValue(size);
    variants.forEach((label, j) => {
      sh.getRange(r, j + 2).setFormula(`=SUMIFS(${I}!E:E, ${I}!C:C, "${label}", ${I}!D:D, $A${r}, ${I}!H:H, "<>Cancelled")`);
    });
    const last = String.fromCharCode(65 + variants.length);
    sh.getRange(r, variants.length + 2).setFormula(`=SUM(B${r}:${last}${r})`);
  });
  const totalRow = CONFIG.SIZES.length + 3;
  sh.getRange(totalRow, 1).setValue('Total').setFontWeight('bold');
  for (let c = 2; c <= variants.length + 2; c++) {
    const L = String.fromCharCode(64 + c);
    sh.getRange(totalRow, c).setFormula(`=SUM(${L}3:${L}${totalRow - 1})`).setFontWeight('bold');
  }

  const O = CONFIG.ORDERS_SHEET;
  const k = totalRow + 2;
  sh.getRange(k, 1, 6, 2).setValues([
    ['Early bird pcs used (of ' + CONFIG.EARLY_BIRD_LIMIT + ')', `=SUMIFS(${I}!E:E, ${I}!I:I, "Early bird", ${I}!H:H, "<>Cancelled")`],
    ['Orders (all)', `=COUNTA(${O}!A2:A)`],
    ['Pending verification', `=COUNTIF(${O}!M:M, "Pending verification")`],
    ['Paid / ready / collected', `=COUNTIF(${O}!M:M, "Paid")+COUNTIF(${O}!M:M, "Ready for pickup")+COUNTIF(${O}!M:M, "Collected")`],
    ['Revenue (excl. cancelled, RM)', `=SUMIFS(${O}!I:I, ${O}!M:M, "<>Cancelled")`],
    ['Collected', `=COUNTIF(${O}!M:M, "Collected")`],
  ]);
  sh.getRange(k, 1, 6, 1).setFontWeight('bold');
  sh.autoResizeColumns(1, variants.length + 2);
}

/** Optional: email every "Ready for pickup" buyer. Run manually after setting the pickup details. */
function emailPickupNotice() {
  const PICKUP = 'Location: TBA\nDate: TBA\nTime: TBA'; // edit before running
  const sh = ss_().getSheetByName(CONFIG.ORDERS_SHEET);
  const rows = sh.getDataRange().getValues();
  let sent = 0;
  for (let i = 1; i < rows.length; i++) {
    const [orderId, , name, , email, , items, , , , , , status] = rows[i];
    if (status !== 'Ready for pickup' || !email) continue;
    MailApp.sendEmail(email, `Your MMU ’26 order ${orderId} is ready for pickup`,
      `Hi ${name},\n\nYour order (${items}) is ready!\n\n${PICKUP}\n\nPlease bring your Order ID: ${orderId}\n\n— MMU Collegiate Series ’26`);
    sent++;
  }
  notify_(`Sent ${sent} pickup emails.`);
}
