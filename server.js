// Vehicle Details - بدون أي مكتبات خارجية، يحتاج Node.js 16+ فقط
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now'; // غيّرها!
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const sessions = new Set();

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}

function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : null;
}
function isAdmin(req) { return sessions.has(getCookie(req, 'sid')); }

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// قائمة الحقول الـ 21 كاملة المطابقة للتصميم الجديد
const FIELDS = [
  'vccNo', 'vccStatus', 'vccGenerationDate', 'chassisNo', 'engineNumber',
  'yearOfBuilt', 'vehicleDrive', 'countryOfOrigin', 'engineCapacity',
  'carriageCapacity', 'passengerCapacity', 'vehicleModel', 'vehicleBrandName',
  'vehicleType', 'vehicleColor', 'specificationStandardName', 'declarationNumber',
  'declarationDate', 'ownerCode', 'ownerName', 'printRemarks'
];

function clean(input) {
  const o = {};
  FIELDS.forEach(f => { o[f] = String(input[f] ?? '').trim().slice(0, 200); });
  return o;
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // ---------- Public API ----------
    if (req.method === 'GET' && p === '/api/record') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) return send(res, 400, { error: 'اكتب رقم السجل أو رقم الشاسيه' });
      const r = loadData().find(x => (x.vccNo && x.vccNo.toLowerCase() === q) || (x.chassisNo && x.chassisNo.toLowerCase() === q));
      return r ? send(res, 200, r) : send(res, 404, { error: 'لا توجد بيانات مطابقة' });
    }

    // ---------- Admin API ----------
    if (req.method === 'POST' && p === '/api/admin/login') {
      const { password } = await readBody(req);
      if (!safeEqual(password, ADMIN_PASSWORD)) return send(res, 401, { error: 'كلمة السر غلط' });
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.add(sid);
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'غير مصرح' });

      if (req.method === 'POST' && p === '/api/admin/logout') {
        sessions.delete(getCookie(req, 'sid'));
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/admin/records') return send(res, 200, loadData());

      if (req.method === 'POST' && p === '/api/admin/records') {
        const rec = clean(await readBody(req));
        if (!rec.vccNo) return send(res, 400, { error: 'رقم السجل (VCC No) مطلوب' });
        const data = loadData();
        const i = data.findIndex(x => x.vccNo === rec.vccNo);
        if (i >= 0) data[i] = rec; else data.push(rec);   // نفس الرقم = تعديل
        saveData(data);
        return send(res, 200, rec);
      }
      if (req.method === 'DELETE' && p.startsWith('/api/admin/records/')) {
        const id = decodeURIComponent(p.split('/').pop());
        saveData(loadData().filter(x => x.vccNo !== id));
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---------- Static pages ----------
    let file = p === '/' ? '/index.html' : p === '/admin' ? '/admin.html' : p;
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory())
      return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(full, 'utf8'), MIME[path.extname(full)] || 'text/plain');
  } catch (e) {
    send(res, 500, { error: 'خطأ في السيرفر' });
  }
});

server.listen(PORT, () => console.log(`Public: http://localhost:${PORT}/  |  Admin: http://localhost:${PORT}/admin`));