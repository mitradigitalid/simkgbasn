/* ============================================================
   SIM KGB — Client (js/app.js) • dihosting di GitHub Pages
   • Backend: Google Apps Script REST API (fetch, tanpa google.script.run)
   • SPA murni: tanpa pindah halaman / ?page=
   • Navigasi 0 ms (semua halaman dirender dari state lokal)
   • Stale-while-revalidate: snapshot localStorage → tampil instan, sinkron di latar belakang
   • Optimistic UI untuk keputusan admin (+ urungkan), unggah berkas langsung saat dipilih
   ============================================================ */
(function () {
'use strict';

// ───────────────────────── Utilitas ─────────────────────────
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mem = {};
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
};
const jparse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
const digits = s => String(s || '').replace(/\D/g, '');
const fmtNum = s => digits(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const rp = n => 'Rp ' + fmtNum(n || 0);
const pad = n => ('0' + n).slice(-2);
const tgl = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : (s || '—'); };
const tglJam = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : (s || '—'); };
const nowStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const parseDT = s => new Date(String(s || '').replace(' ', 'T'));
const hariAntara = (a, b) => Math.max(0, Math.floor((b - a) / 864e5));
const namaLengkap = u => u ? ([u.GelarDepan, u.Nama].filter(Boolean).join(' ') + (u.GelarBelakang ? ', ' + u.GelarBelakang : '')) : '—';
const inisial = u => { const n = (u && u.Nama || '?').trim().split(/\s+/); return ((n[0] || '?')[0] + (n.length > 1 ? n[n.length - 1][0] : '')).toUpperCase(); };
const BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const SLUG = { 'Dikirim': 'dikirim', 'Diperiksa': 'diperiksa', 'Disetujui': 'disetujui', 'Ditolak': 'ditolak', 'Perlu Perbaikan': 'perbaikan' };
const STATUS_LIST = ['Dikirim', 'Diperiksa', 'Disetujui', 'Ditolak', 'Perlu Perbaikan'];
const AKSI = { dikirim: 'Dikirim', diperiksa: 'Diperiksa', setujui: 'Disetujui', tolak: 'Ditolak', perbaikan: 'Perlu Perbaikan' };
const STATUS_AKSI = { 'Dikirim': 'dikirim', 'Diperiksa': 'diperiksa', 'Disetujui': 'setujui', 'Ditolak': 'tolak', 'Perlu Perbaikan': 'perbaikan' };
const DOK = ['SK Pangkat Terakhir', 'SK KGB Terakhir', 'Surat Keterangan Lainnya'];
const MAKS_PDF = 2 * 1024 * 1024;
const badge = st => '<span class="badge s-' + (SLUG[st] || 'dikirim') + '">' + esc(st) + '</span>';
const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
const randId = n => { const a = new Uint8Array(n), c = 'abcdefghjkmnpqrstuvwxyz23456789'; (window.crypto || window.msCrypto).getRandomValues(a); return Array.from(a, x => c[x % c.length]).join(''); };
const KGB = [
  ['GajiPokokLama', 'Gaji pokok lama', 'gaji'], ['AtasDasarSurat', 'Atas dasar surat (oleh pejabat)', 'text', 'Contoh: Kepala BKPSDM'],
  ['TanggalBerkalaLama', 'Tanggal berkala lama', 'tgl'], ['NomorBerkalaLama', 'Nomor berkala lama', 'text', 'Contoh: 822.3/112/BKPSDM/2023'],
  ['TMTBerkalaLama', 'TMT berkala lama', 'tgl'], ['MasaKerjaBerkalaLama', 'Masa kerja berkala lama', 'masa'], ['MasaKerjaLama', 'Masa kerja lama', 'masa'],
  ['GajiPokokBaru', 'Gaji pokok baru', 'gaji'], ['MasaKerjaBaru', 'Masa kerja baru', 'masa'], ['TMTBerkalaBaru', 'TMT berkala baru', 'tgl']
];

// ───────────────────────── State ─────────────────────────
const S = {
  token: null, me: null, cfg: jparse(store.get('kgb_cfg')) || { appName: 'SIM KGB', thumbnailUrl: '' },
  users: [], usulan: [], dokumen: [], riwayat: [], uMap: {},
  page: null, pending: 0, mut: 0, lastSync: 0,
  f: { status: 'Semua', unit: '', q: '', pg: 1, per: 10 }, pf: { q: '', peran: '', pg: 1, per: 10 }, rf: { q: '', pg: 1, per: 10 },
  draft: null, up: {}, upQueue: Promise.resolve(), submitting: false, imp: { mode: 'csv', csv: '', ref: '' }, blobs: [], lastFocus: []
};
const userOf = nip => S.uMap[nip] || null;
const docsOf = id => S.dokumen.filter(d => d.IDUsulan === id);
const histOf = id => S.riwayat.filter(r => r.IDUsulan === id).sort((a, b) => String(a.Tanggal).localeCompare(String(b.Tanggal)));
const sorted = () => S.usulan.slice().sort((a, b) => String(b.TanggalKirim).localeCompare(String(a.TanggalKirim)));
const isAdmin = () => S.me && S.me.Peran === 'Admin';

function load(d) {
  S.me = d.me; S.users = d.users || []; S.usulan = d.usulan || []; S.dokumen = d.dokumen || []; S.riwayat = d.riwayat || [];
  if (d.config) S.cfg = d.config;
  S.uMap = {}; S.users.forEach(u => { if (u.NIP) S.uMap[u.NIP] = u; });
  S.lastSync = d.ts || Date.now();
}
const persist = debounce(() => {
  if (!S.token || !S.me) return;
  store.set('kgb_snap', JSON.stringify({ me: S.me, config: S.cfg, users: S.users, usulan: S.usulan, dokumen: S.dokumen, riwayat: S.riwayat, ts: S.lastSync }));
}, 300);

// ───────────────────────── API (fetch → GAS REST) ─────────────────────────
function setSync(st) {
  const dot = $('#syncDot'), txt = $('#syncTxt'), tag = $('#syncTag'); if (!dot) return;
  dot.className = st === 'off' ? 'off' : st === 'busy' ? 'busy' : '';
  txt.textContent = st === 'off' ? 'Offline — data lokal' : st === 'busy' ? 'Menyinkronkan…' : 'Tersinkron ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes());
  tag.textContent = st === 'off' ? 'OFFLINE' : 'ONLINE'; tag.className = st === 'off' ? 'off' : '';
}
const CFG = window.APP_CONFIG || {};
const gasOk = () => /^https:\/\/script\.google\.com\/macros\/s\/[^/\s]+\/exec$/.test(CFG.GAS_URL || '');
/** POST JSON ke GAS. WAJIB text/plain (tanpa preflight CORS). Token ikut di body, bukan di URL. */
async function kirim(fn, args) {
  if (!gasOk()) throw new Error('KONFIG: URL backend belum diisi di js/config.js.');
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), CFG.TIMEOUT_MS || 90000);
  try {
    const res = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: fn, args: args }), signal: ctl.signal, redirect: 'follow' });
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch (e) { const er = new Error('Server memberi respons tidak valid. Pastikan deployment Apps Script memakai versi terbaru dan akses "Anyone".'); er.fatal = true; throw er; }
  } finally { clearTimeout(to); }
}
function api(fn) {
  const args = Array.prototype.slice.call(arguments, 1), baca = fn === 'apiBoot' || fn === 'apiLogin';     // hanya operasi baca/login yang aman diulang
  S.pending++; setSync('busy');
  const run = n => kirim(fn, args).catch(e => { if (baca && n < 1 && !e.fatal && e.name !== 'AbortError') return run(n + 1); throw e; });
  return run(0).then(r => {
    S.pending--; setSync(S.pending ? 'busy' : 'ok');
    if (!r) throw new Error('Respons server kosong.');
    if (r.success === false) { if (r.code === 'SESI') forceLogout(r.message); const e = new Error(r.message); e.code = r.code; throw e; }
    return r;
  }, e => {
    S.pending--; setSync('off');
    throw new Error(e.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi.' : (e.fatal || /^KONFIG/.test(e.message)) ? e.message : 'Koneksi bermasalah. Periksa jaringan Anda lalu coba lagi. [' + (e.name || 'Error') + ': ' + (e.message || '?') + '] Ketuk “Uji koneksi ke server” di bawah untuk diagnosa.');
  });
}
/** Diagnosa koneksi ke backend: memeriksa GET dan POST secara terpisah dan menampilkan penyebab yang terlihat */
async function diagnosa() {
  const hasil = [], add = (ok, judul, det) => hasil.push({ ok: ok, judul: judul, det: det });
  const ov = openModal(mHead('Uji koneksi ke server', 'Memeriksa alamat backend dan metode pengiriman data') + '<div class="modal-body"><div id="dgBox" class="empty"><span class="spin"></span><p class="sm" style="margin-top:8px">Menguji…</p></div></div><div class="modal-foot"><button class="btn btn-secondary" data-act="closeModal">Tutup</button></div>', { size: 'sm' });
  const potong = t => String(t).replace(/\s+/g, ' ').slice(0, 140);
  if (!gasOk()) add(false, 'Alamat backend (GAS_URL)', 'Belum diisi / formatnya salah di js/config.js. Harus berbentuk https://script.google.com/macros/s/…/exec');
  else {
    add(true, 'Alamat backend (GAS_URL)', CFG.GAS_URL.replace(/(macros\/s\/.{6}).*(\/exec)/, '$1…$2'));
    try {
      const t0 = Date.now(), r = await fetch(CFG.GAS_URL + '?action=ping'), tx = await r.text(); let js = null; try { js = JSON.parse(tx); } catch (x) { /* bukan JSON */ }
      if (js && js.success) add(true, 'GET (baca identitas aplikasi)', 'OK • API v' + ((js.data || {}).versi || '?') + ' • ' + (Date.now() - t0) + ' ms'); else add(false, 'GET (baca identitas aplikasi)', 'HTTP ' + r.status + '. Respons bukan JSON API: “' + potong(tx) + '”');
    } catch (e) { add(false, 'GET (baca identitas aplikasi)', e.name + ': ' + e.message + ' — alamat salah, deployment bukan “Anyone”, atau diblokir peramban/ekstensi.'); }
    try {
      const t0 = Date.now(), r = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'apiUji', args: [] }) }), tx = await r.text(); let js = null; try { js = JSON.parse(tx); } catch (x) { /* bukan JSON */ }
      if (js) add(true, 'POST (kirim data / login)', 'OK • server menjawab JSON (' + (Date.now() - t0) + ' ms)'); else add(false, 'POST (kirim data / login)', 'HTTP ' + r.status + '. Server menjawab halaman, bukan JSON: “' + potong(tx) + '”');
    } catch (e) { add(false, 'POST (kirim data / login)', e.name + ': ' + e.message + ' — POST diblokir/ditolak.'); }
  }
  const g = hasil[1], p = hasil[2];
  const saran = !gasOk() ? 'Perbaiki js/config.js lalu push ulang.' :
    g && !g.ok ? 'Alamat /exec tidak dapat diakses dari peramban. Periksa: (1) URL disalin dari Deploy → Kelola deployment, berakhiran /exec (bukan /dev); (2) “Who has access” = Anyone; (3) matikan sementara ekstensi pemblokir iklan/privasi.' :
    p && !p.ok ? 'Alamat benar tetapi POST gagal. Penyebab tersering: (1) deployment belum diperbarui — Deploy → Kelola deployment → ✏️ → Versi: Versi baru → Deploy; (2) otorisasi ulang belum dilakukan — jalankan fungsi setupAppEnvironment di editor lalu setujui izin; (3) kode backend yang ditempel bukan Kode.gs versi 2.0 (harus ada fungsi doPost). Kirim hasil uji ini agar bisa dipastikan.' :
    'Koneksi ke server normal. Jika login tetap gagal, periksa nama pengguna/kata sandi atau coba lagi.';
  const box = $('#dgBox'); if (!box) return;
  box.className = ''; box.innerHTML = hasil.map(h => '<div class="alert ' + (h.ok ? 'ok-a' : 'err-a') + '" style="margin-bottom:10px"><i class="bi ' + (h.ok ? 'bi-check-circle' : 'bi-x-octagon') + '"></i><span><b>' + esc(h.judul) + '</b><br>' + esc(h.det) + '</span></div>').join('') +
    '<div class="note"><b>Saran:</b> ' + esc(saran) + '</div>';
}
function refresh(silent) {
  if (!S.token || S.mut > 0) return Promise.resolve();
  return api('apiBoot', S.token).then(r => { if (S.mut > 0) return; load(r.data); renderAll(); persist(); if (!silent) toast('Data diperbarui.', 'success'); })
    .catch(e => { if (!silent && e.code !== 'SESI') toast(e.message, 'error'); });
}

// ───────────────────────── UI primitif ─────────────────────────
function toast(msg, type, act) {
  const box = $('#toasts'), el = document.createElement('div');
  el.className = 'toast ' + (type || 'success'); el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ico = type === 'error' ? 'bi-x-octagon' : type === 'warn' ? 'bi-exclamation-triangle' : 'bi-check-circle';
  el.innerHTML = '<i class="bi ' + ico + '"></i><span class="grow">' + esc(msg) + '</span>' + (act ? '<button type="button">' + esc(act.label) + '</button>' : '');
  if (act) el.querySelector('button').onclick = () => { act.fn(); el.remove(); };
  box.appendChild(el);
  setTimeout(() => el.remove(), act ? 7000 : 4200);
}
function openModal(html, opt) {
  opt = opt || {};
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = '<div class="modal ' + (opt.size || '') + '" role="dialog" aria-modal="true" aria-labelledby="mdTitle" tabindex="-1">' + html + '</div>';
  S.lastFocus.push(document.activeElement);
  $('#modalRoot').appendChild(ov);
  fitModal(); setTimeout(fitModal, 60);
  const m = ov.firstChild, f = $('[autofocus]', m) || $('input,select,textarea,button.btn', m) || m; setTimeout(() => f.focus(), 30);
  return ov;
}
/** Hitung tinggi area isi modal dari tinggi layar agar SELALU bisa di-scroll (tidak bergantung pada CSS flex di iframe) */
function fitModal() {
  const wide = window.innerWidth >= 720, vh = window.innerHeight;
  $$('#modalRoot .overlay').forEach(ov => {
    const m = ov.firstElementChild, b = m && m.querySelector('.modal-body'); if (!b) return;
    const h = m.querySelector('.modal-head'), f = m.querySelector('.modal-foot');
    const used = (h ? h.offsetHeight : 0) + (f ? f.offsetHeight : 0), total = wide ? vh - 48 : vh * 0.94;
    b.style.maxHeight = Math.max(160, Math.floor(total - used)) + 'px'; b.style.overflowY = 'auto';
  });
}
function closeModal() {
  const all = $$('#modalRoot .overlay'); if (!all.length) return;
  all[all.length - 1].remove();
  const f = S.lastFocus.pop(); if (f && f.focus) { try { f.focus(); } catch (e) { /* abaikan */ } }
  if (!$$('#modalRoot .overlay').length) { S.blobs.forEach(u => URL.revokeObjectURL(u)); S.blobs = []; }
}
const mHead = (title, sub) => '<div class="modal-head"><div><h2 id="mdTitle">' + title + '</h2>' + (sub ? '<div class="sm muted" style="margin-top:2px">' + sub + '</div>' : '') +
  '</div><button class="icon-btn" data-act="closeModal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>';
function copyText(t) {
  const fb = () => { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* */ } ta.remove(); toast(ok ? 'Disalin.' : 'Salin manual dari kotak.', ok ? 'success' : 'warn'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast('Disalin.'), fb); else fb();
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const toCSV = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function pager(t, total, pg, per) {
  const pages = Math.max(1, Math.ceil(total / per)); pg = Math.min(pg, pages);
  const from = total ? (pg - 1) * per + 1 : 0, to = Math.min(total, pg * per), st = Math.max(1, Math.min(pg - 2, pages - 4)), en = Math.min(pages, st + 4); let nums = '';
  for (let i = st; i <= en; i++) nums += '<button class="pg" data-act="pg" data-t="' + t + '" data-pg="' + i + '"' + (i === pg ? ' aria-current="page"' : '') + '>' + i + '</button>';
  return '<div class="pager"><span class="muted">Menampilkan <b>' + from + '–' + to + '</b> dari <b>' + total + '</b></span><div class="pages">' +
    '<button class="pg" data-act="pg" data-t="' + t + '" data-pg="' + (pg - 1) + '"' + (pg <= 1 ? ' disabled' : '') + ' aria-label="Halaman sebelumnya"><i class="bi bi-chevron-left"></i></button>' + nums +
    '<button class="pg" data-act="pg" data-t="' + t + '" data-pg="' + (pg + 1) + '"' + (pg >= pages ? ' disabled' : '') + ' aria-label="Halaman berikutnya"><i class="bi bi-chevron-right"></i></button></div></div>';
}
const empty = (ico, judul, teks, cta) => '<div class="empty"><i class="bi ' + ico + '"></i><h3>' + judul + '</h3><p class="sm">' + teks + '</p>' + (cta || '') + '</div>';
function metric(cls, ico, title, val, unit, foot) {
  return '<div class="metric ' + cls + '"><div class="m-top"><span class="m-ico"><i class="bi ' + ico + '"></i></span><span class="m-title">' + title + '</span></div>' +
    '<div class="m-val">' + val + '<small>' + unit + '</small></div><div class="m-foot">' + foot + '</div></div>';
}
function setErr(id, msg) {
  const e = $('#e-' + id), inp = $('#f-' + id) || $('#f-' + id + '-th'); if (!e) return;
  if (msg) { e.hidden = false; e.innerHTML = '<i class="bi bi-exclamation-circle"></i><span>' + esc(msg) + '</span>'; if (inp) inp.setAttribute('aria-invalid', 'true'); }
  else { e.hidden = true; e.innerHTML = ''; if (inp) inp.removeAttribute('aria-invalid'); }
}

// ───────────────────────── Tema & brand ─────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t); store.set('kgb_theme', t);
  const i = $('#themeIco'); if (i) i.className = 'bi ' + (t === 'dark' ? 'bi-sun' : 'bi-moon-stars');
}
function applyBrand() {
  const nama = S.cfg.appName || 'SIM KGB', kata = nama.trim().split(/\s+/), ini = (kata[kata.length - 1] || 'KGB').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'KGB';
  document.title = nama; store.set('kgb_cfg', JSON.stringify(S.cfg));
  $$('.brand-name').forEach(e => e.textContent = nama);
  $$('.brand-mark').forEach(m => {
    m.textContent = '';
    if (S.cfg.thumbnailUrl) { const im = new Image(); im.alt = ''; im.src = S.cfg.thumbnailUrl; im.onerror = () => { m.textContent = ini; }; m.appendChild(im); } else m.textContent = ini;
  });
}

// ───────────────────────── Autentikasi ─────────────────────────
function showLogin() { $('#view-app').hidden = true; $('#view-login').hidden = false; $('#boot').hidden = true; }
function showApp() {
  $('#view-login').hidden = true; $('#view-app').hidden = false; $('#boot').hidden = true;
  const me = S.me, ad = isAdmin(); applyBrand();
  $('#sbName').textContent = $('#tbName').textContent = namaLengkap(me); $('#sbRole').textContent = $('#tbRole').textContent = ad ? 'Administrator' : 'ASN';
  $('#sbAvatar').textContent = $('#tbAvatar').textContent = inisial(me); $('#roleTag').textContent = ad ? 'Panel Admin' : 'Portal ASN';
  $('#gSearch').placeholder = ad ? 'Cari NIP, nama, nomor usulan…' : 'Cari riwayat usulan saya…';
}
function forceLogout(msg) {
  if (!S.token && $('#view-app').hidden) return;
  S.token = null; S.me = null; store.del('kgb_tok'); store.del('kgb_snap');
  $$('.page').forEach(p => { p.innerHTML = ''; p.hidden = true; delete p.dataset.ready; });
  S.usulan = []; S.users = []; S.dokumen = []; S.riwayat = []; S.uMap = {}; S.page = null; S.draft = null; S.up = {};
  $$('#modalRoot .overlay').forEach(o => o.remove());
  showLogin(); if (msg) toast(msg, 'warn');
}
function doLogin(ev) {
  ev.preventDefault();
  const u = $('#lg-user').value.trim(), p = $('#lg-pass').value, box = $('#loginErr'), btn = $('#lgBtn');
  box.hidden = true;
  if (!u || !p) { box.hidden = false; box.querySelector('span').textContent = 'Isi nama pengguna dan kata sandi.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span> Memproses…';
  api('apiLogin', u, p).then(r => {
    S.token = r.data.token; store.set('kgb_tok', S.token); load(r.data.boot); persist(); $('#lg-pass').value = '';
    showApp(); go(isAdmin() ? 'dashboard' : 'beranda'); toast('Selamat datang, ' + (S.me.Nama || '') + '.');
  }).catch(e => { box.hidden = false; box.querySelector('span').textContent = e.message; })
    .finally(() => { btn.disabled = false; btn.textContent = 'Masuk'; });
}

// ───────────────────────── Router SPA & chrome ─────────────────────────
const NAV = {
  Admin: [['dashboard', 'bi-grid-1x2', 'Dashboard'], ['usulan', 'bi-journal-check', 'Usulan KGB'], ['pegawai', 'bi-people', 'Data Pegawai'], ['pengaturan', 'bi-sliders', 'Pengaturan']],
  ASN: [['beranda', 'bi-house-door', 'Beranda'], ['ajukan', 'bi-file-earmark-plus', 'Ajukan Usulan'], ['riwayat', 'bi-clock-history', 'Riwayat Usulan']]
};
function renderNav() {
  const wait = S.usulan.filter(u => u.Status === 'Dikirim' || u.Status === 'Diperiksa').length;
  $('#nav').innerHTML = NAV[S.me.Peran].map(n => '<button class="nav-item' + (S.page === n[0] ? ' active' : '') + '" data-act="go" data-page="' + n[0] + '"' + (S.page === n[0] ? ' aria-current="page"' : '') + '><i class="bi ' + n[1] + '"></i><span>' + n[2] + '</span>' +
    (isAdmin() && n[0] === 'usulan' && wait ? '<span class="pill-count" aria-label="' + wait + ' menunggu">' + wait + '</span>' : '') + '</button>').join('');
}
function go(page, opt) {
  if (!S.me) return;
  if (!NAV[S.me.Peran].some(n => n[0] === page)) page = NAV[S.me.Peran][0][0];
  S.page = page; S.prefill = opt && opt.prefill || null;
  $$('.page').forEach(p => p.hidden = p.id !== 'p-' + page);
  renderNav(); renderPage(page); closeMenu(); closeProfile();
  window.scrollTo(0, 0); const m = $('#main'); if (m) m.focus({ preventScroll: true });
}
function renderPage(p) { ({ dashboard: rDashboard, usulan: rUsulan, pegawai: rPegawai, pengaturan: rPengaturan, beranda: rBeranda, ajukan: rAjukan, riwayat: rRiwayat })[p](); }
function renderAll() { if (!S.me) return; renderNav(); if (S.page) { if (S.page === 'ajukan' && $('#p-ajukan').dataset.ready) { /* jangan timpa formulir yang sedang diisi */ } else renderPage(S.page); } }
function openMenu() { $('#sidebar').classList.add('open'); $('#scrim').classList.add('on'); }
function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('on'); }
function closeProfile() { const m = $('#profileMenu'); if (m) { m.hidden = true; const b = $('[data-act="profileMenu"]'); if (b) b.setAttribute('aria-expanded', 'false'); } }

// ═════════════════════ HALAMAN ADMIN ═════════════════════
function rDashboard() {
  const U = S.usulan, c = st => U.filter(u => u.Status === st).length, total = U.length;
  const wait = c('Dikirim') + c('Diperiksa'), ok = c('Disetujui'), tolak = c('Ditolak'), fix = c('Perlu Perbaikan');
  const now = new Date(), ym = d => d.getFullYear() + '-' + pad(d.getMonth() + 1), bulanIni = U.filter(u => String(u.TanggalKirim).slice(0, 7) === ym(now)).length;
  const antre = U.filter(u => u.Status === 'Dikirim' || u.Status === 'Diperiksa').sort((a, b) => String(a.TanggalKirim).localeCompare(String(b.TanggalKirim)));
  const tertua = antre.length ? hariAntara(parseDT(antre[0].TanggalKirim), now) : 0;
  const months = []; for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ k: ym(d), l: BLN[d.getMonth()], n: 0 }); }
  U.forEach(u => { const m = months.find(x => x.k === String(u.TanggalKirim).slice(0, 7)); if (m) m.n++; });
  const mx = Math.max(1, ...months.map(m => m.n));
  const seg = [['Dikirim', '#3B82F6'], ['Diperiksa', '#F59E0B'], ['Disetujui', '#22C55E'], ['Ditolak', '#EF4444'], ['Perlu Perbaikan', '#F97316']];
  let acc = 0; const stops = total ? seg.map(s => { const n = c(s[0]), a = acc / total * 100; acc += n; return s[1] + ' ' + a + '% ' + (acc / total * 100) + '%'; }).join(',') : 'var(--border) 0 100%';
  const ins = [];
  ins.push(wait ? '<b>' + wait + '</b> usulan menunggu tindakan' + (tertua >= 3 ? '; yang tertua sudah <b>' + tertua + ' hari</b> menunggu.' : '.') : 'Tidak ada usulan yang menunggu. Semua sudah diproses.');
  if (ok + tolak) ins.push('Tingkat persetujuan <b>' + Math.round(ok / (ok + tolak) * 100) + '%</b> dari ' + (ok + tolak) + ' usulan yang telah diputuskan.');
  const byUnit = {}; U.forEach(u => { const un = (userOf(u.NIP) || {}).UnitKerja || '—'; byUnit[un] = (byUnit[un] || 0) + 1; });
  const top = Object.keys(byUnit).sort((a, b) => byUnit[b] - byUnit[a])[0]; if (top) ins.push('Unit kerja terbanyak mengusulkan: <b>' + esc(top) + '</b> (' + byUnit[top] + ' usulan).');
  const dec = U.filter(u => u.TanggalKeputusan && u.TanggalKirim); if (dec.length) ins.push('Rata-rata waktu pemrosesan <b>' + (dec.reduce((s, u) => s + hariAntara(parseDT(u.TanggalKirim), parseDT(u.TanggalKeputusan)), 0) / dec.length).toFixed(1) + ' hari</b>.');
  if (fix) ins.push('<b>' + fix + '</b> usulan menunggu perbaikan dari ASN.');
  const rows = antre.slice(0, 6).map(us => { const u = userOf(us.NIP) || {};
    return '<tr><td class="first cell-main" data-l="Pegawai"><strong>' + esc(namaLengkap(u)) + '</strong><span class="mono">' + esc(us.NIP) + '</span></td><td data-l="Unit kerja">' + esc(u.UnitKerja || '—') + '</td><td data-l="Tgl kirim" class="mono">' + tglJam(us.TanggalKirim) + '</td><td data-l="Status">' + badge(us.Status) + '</td><td class="cell-act"><button class="btn btn-primary btn-sm" data-act="detail" data-id="' + esc(us.IDUsulan) + '">Tinjau</button></td></tr>'; }).join('');
  $('#p-dashboard').innerHTML = '<div class="page-head"><div><h1>Dashboard</h1><p class="muted sm">Monitoring operasional pengusulan Kenaikan Gaji Berkala (KGB)</p></div>' +
    '<div class="head-actions"><button class="btn btn-secondary" data-act="export" data-scope="all"><i class="bi bi-download"></i> Unduh rekap Excel</button></div></div>' +
    '<div class="metrics">' + metric('v', 'bi-inbox', 'Usulan masuk', total, 'usulan', '<i class="bi bi-calendar3"></i> ' + bulanIni + ' usulan bulan ini') +
    metric('c', 'bi-hourglass-split', 'Menunggu verifikasi', wait, 'antrean', '<i class="bi bi-clock"></i> ' + (wait ? 'Tertua ' + tertua + ' hari' : 'Antrean kosong')) +
    metric('g', 'bi-patch-check', 'Disetujui', ok, 'usulan', '<i class="bi bi-graph-up-arrow"></i> ' + (ok + tolak ? Math.round(ok / (ok + tolak) * 100) + '% dari yang diputuskan' : 'Belum ada keputusan')) +
    metric('o', 'bi-x-octagon', 'Ditolak / perbaikan', tolak + fix, 'usulan', '<i class="bi bi-arrow-repeat"></i> ' + fix + ' menunggu perbaikan ASN') + '</div>' +
    '<div class="grid-2"><div class="card"><div class="card-head"><div><h2>Perlu tindakan</h2><p class="sm muted">Usulan terlama diprioritaskan</p></div><button class="btn btn-ghost" data-act="go" data-page="usulan">Lihat semua <i class="bi bi-arrow-right"></i></button></div>' +
    (antre.length ? '<div class="tbl-wrap"><table class="tbl stack-sm"><thead><tr><th>Pegawai</th><th>Unit kerja</th><th>Tgl kirim</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : empty('bi-check2-circle', 'Semua beres', 'Tidak ada usulan yang menunggu pemeriksaan.')) + '</div>' +
    '<div class="stack"><div class="card card-pad"><h2 style="margin-bottom:12px">Usulan 6 bulan terakhir</h2><div class="bars" role="img" aria-label="Grafik batang jumlah usulan per bulan">' +
    months.map(m => '<div class="bar"><b>' + m.n + '</b><i style="height:' + Math.max(3, m.n / mx * 100) + '%"></i><span>' + m.l + '</span></div>').join('') + '</div></div>' +
    '<div class="card card-pad"><h2 style="margin-bottom:12px">Komposisi status</h2><div class="donut-wrap"><div class="donut" style="background:conic-gradient(' + stops + ')"><div>' + total + '</div></div><div class="legend"><ul>' +
    seg.map(s => '<li><i style="background:' + s[1] + '"></i>' + s[0] + '<b>' + c(s[0]) + '</b></li>').join('') + '</ul></div></div></div>' +
    '<div class="insight"><h3><i class="bi bi-stars"></i> Insight otomatis</h3><ul>' + ins.map(i => '<li>' + i + '</li>').join('') + '</ul></div></div></div>';
}

// ── Usulan KGB (admin) ──
function filteredUsulan() {
  const f = S.f, q = f.q.toLowerCase();
  return sorted().filter(us => {
    if (f.status !== 'Semua' && us.Status !== f.status) return false;
    const u = userOf(us.NIP) || {};
    if (f.unit && u.UnitKerja !== f.unit) return false;
    return !q || (us.IDUsulan + ' ' + us.NIP + ' ' + namaLengkap(u) + ' ' + (u.UnitKerja || '')).toLowerCase().indexOf(q) > -1;
  });
}
function rUsulan() {
  const sec = $('#p-usulan');
  if (!sec.dataset.ready) {
    sec.dataset.ready = '1';
    sec.innerHTML = '<div class="page-head"><div><h1>Daftar Usulan Kenaikan Gaji Berkala</h1><p class="muted sm">Periksa berkas, lalu setujui, tolak, atau minta perbaikan.</p></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-act="export" data-scope="filter"><i class="bi bi-download"></i> Unduh rekap Excel (.xlsx)</button></div></div>' +
      '<div class="card"><div id="usTabs" class="tabs" role="tablist" aria-label="Filter status"></div><div class="toolbar"><div class="grow" style="max-width:360px"><input id="usQ" class="input" type="search" placeholder="Cari ID, NIP, nama, unit…" aria-label="Cari usulan"></div>' +
      '<select id="usUnit" class="select" aria-label="Filter unit kerja"></select></div><div id="usBody"></div></div>';
    $('#usQ').addEventListener('input', debounce(e => { S.f.q = e.target.value; S.f.pg = 1; rUsulanBody(); }, 200));
    $('#usUnit').addEventListener('change', e => { S.f.unit = e.target.value; S.f.pg = 1; rUsulanBody(); });
  }
  const units = Array.from(new Set(S.usulan.map(us => (userOf(us.NIP) || {}).UnitKerja).filter(Boolean))).sort();
  $('#usUnit').innerHTML = '<option value="">Semua unit kerja</option>' + units.map(u => '<option' + (S.f.unit === u ? ' selected' : '') + ' value="' + esc(u) + '">' + esc(u) + '</option>').join('');
  if ($('#usQ').value !== S.f.q) $('#usQ').value = S.f.q;
  $('#usTabs').innerHTML = ['Semua'].concat(STATUS_LIST).map(t => '<button class="tab" role="tab" aria-selected="' + (S.f.status === t) + '" data-act="tabStatus" data-s="' + t + '">' + t + '<em>' + (t === 'Semua' ? S.usulan.length : S.usulan.filter(u => u.Status === t).length) + '</em></button>').join('');
  rUsulanBody();
}
function rUsulanBody() {
  const list = filteredUsulan(), f = S.f, pages = Math.max(1, Math.ceil(list.length / f.per)); f.pg = Math.min(f.pg, pages);
  const part = list.slice((f.pg - 1) * f.per, f.pg * f.per);
  $('#usBody').innerHTML = part.length ? '<div class="tbl-wrap"><table class="tbl stack-sm"><thead><tr><th>Pegawai</th><th>ID usulan</th><th>Unit kerja</th><th>Gaji lama → baru</th><th>Tgl kirim</th><th>Status</th><th></th></tr></thead><tbody>' +
    part.map(us => { const u = userOf(us.NIP) || {}, sel = Number(us.GajiPokokBaru) - Number(us.GajiPokokLama);
      return '<tr><td class="first cell-main" data-l="Pegawai"><strong>' + esc(namaLengkap(u)) + '</strong><span class="mono">' + esc(us.NIP) + '</span></td>' +
        '<td data-l="ID usulan"><button class="link mono" data-act="detail" data-id="' + esc(us.IDUsulan) + '">' + esc(us.IDUsulan) + '</button></td><td data-l="Unit kerja">' + esc(u.UnitKerja || '—') + '</td>' +
        '<td data-l="Gaji lama → baru"><span class="old">' + rp(us.GajiPokokLama) + '</span> → <b>' + rp(us.GajiPokokBaru) + '</b><br><span class="up xs">' + (sel >= 0 ? '+' : '−') + rp(Math.abs(sel)) + '</span></td>' +
        '<td data-l="Tgl kirim" class="mono nowrap">' + tglJam(us.TanggalKirim) + '</td><td data-l="Status">' + badge(us.Status) + '</td><td class="cell-act"><button class="btn btn-outline btn-sm" data-act="detail" data-id="' + esc(us.IDUsulan) + '">Tinjau</button></td></tr>'; }).join('') +
    '</tbody></table></div>' + pager('usulan', list.length, f.pg, f.per) : empty('bi-inbox', 'Tidak ada usulan', 'Belum ada usulan yang cocok dengan filter saat ini.');
}

// ── Data Pegawai (admin) ──
function rPegawai() {
  const sec = $('#p-pegawai');
  if (!sec.dataset.ready) {
    sec.dataset.ready = '1';
    sec.innerHTML = '<div class="page-head"><div><h1>Data Pegawai</h1><p class="muted sm">Kelola akun ASN dan admin. Pendaftaran akun dilakukan oleh admin.</p></div>' +
      '<div class="head-actions"><button class="btn btn-secondary" data-act="goImport"><i class="bi bi-upload"></i> Impor data</button><button class="btn btn-primary" data-act="addUser"><i class="bi bi-person-plus"></i> Tambah akun</button></div></div>' +
      '<div class="card"><div class="toolbar" style="border-top:0"><div class="grow" style="max-width:360px"><input id="pgQ" class="input" type="search" placeholder="Cari nama, NIP, unit, username…" aria-label="Cari pegawai"></div>' +
      '<select id="pgPeran" class="select" aria-label="Filter peran"><option value="">Semua peran</option><option>ASN</option><option>Admin</option></select></div><div id="pgBody"></div></div>';
    $('#pgQ').addEventListener('input', debounce(e => { S.pf.q = e.target.value; S.pf.pg = 1; rPegawaiBody(); }, 200));
    $('#pgPeran').addEventListener('change', e => { S.pf.peran = e.target.value; S.pf.pg = 1; rPegawaiBody(); });
  }
  rPegawaiBody();
}
function rPegawaiBody() {
  const f = S.pf, q = f.q.toLowerCase();
  const list = S.users.filter(u => (!f.peran || u.Peran === f.peran) && (!q || (namaLengkap(u) + ' ' + u.NIP + ' ' + u.UnitKerja + ' ' + u.Username).toLowerCase().indexOf(q) > -1)).sort((a, b) => a.Nama.localeCompare(b.Nama));
  f.pg = Math.min(f.pg, Math.max(1, Math.ceil(list.length / f.per)));
  const part = list.slice((f.pg - 1) * f.per, f.pg * f.per);
  $('#pgBody').innerHTML = part.length ? '<div class="tbl-wrap"><table class="tbl stack-sm"><thead><tr><th>Nama &amp; NIP</th><th>Pangkat / Gol</th><th>Unit kerja</th><th>Peran</th><th>Status</th><th></th></tr></thead><tbody>' +
    part.map(u => '<tr><td class="first cell-main" data-l="Nama"><strong>' + esc(namaLengkap(u)) + '</strong><span class="mono">' + esc(u.NIP || '—') + ' • @' + esc(u.Username) + '</span></td>' +
      '<td data-l="Pangkat / Gol">' + esc(u.PangkatGol || '—') + (u.Gol ? ' <span class="chip">' + esc(u.Gol) + '</span>' : '') + '</td><td data-l="Unit kerja">' + esc(u.UnitKerja || '—') + '</td>' +
      '<td data-l="Peran"><span class="chip">' + esc(u.Peran) + '</span></td><td data-l="Status">' + (u.StatusAkun === 'Aktif' ? '<span class="badge s-disetujui">Aktif</span>' : '<span class="badge s-ditolak">Nonaktif</span>') + '</td>' +
      '<td class="cell-act nowrap"><button class="btn btn-outline btn-sm" data-act="editUser" data-u="' + esc(u.Username) + '">Ubah</button> <button class="btn btn-secondary btn-sm" data-act="resetPw" data-u="' + esc(u.Username) + '">Reset sandi</button></td></tr>').join('') +
    '</tbody></table></div>' + pager('pegawai', list.length, f.pg, f.per) : empty('bi-people', 'Akun tidak ditemukan', 'Coba kata kunci lain atau tambahkan akun baru.');
}
function userForm(u) {
  u = u || {}; const baru = !u.Username, v = k => esc(u[k] || '');
  const fl = (id, lbl, extra, req) => '<div class="field"><label for="u-' + id + '">' + lbl + (req ? '<span class="req">*</span>' : '') + '</label><input class="input" id="u-' + id + '" value="' + v(id) + '" ' + (extra || '') + '><div class="err" id="e-u-' + id + '" hidden></div></div>';
  const ov = openModal(mHead(baru ? 'Tambah akun' : 'Ubah akun', baru ? 'Kata sandi awal dibuat otomatis bila dikosongkan.' : esc(namaLengkap(u))) +
    '<form id="userForm" novalidate><div class="modal-body">' +
    '<div class="row2"><div class="field"><label for="u-Peran">Peran<span class="req">*</span></label><select class="select" id="u-Peran"><option' + (u.Peran !== 'Admin' ? ' selected' : '') + '>ASN</option><option' + (u.Peran === 'Admin' ? ' selected' : '') + '>Admin</option></select></div>' +
    '<div class="field"><label for="u-StatusAkun">Status akun</label><select class="select" id="u-StatusAkun"><option' + (u.StatusAkun !== 'Nonaktif' ? ' selected' : '') + '>Aktif</option><option' + (u.StatusAkun === 'Nonaktif' ? ' selected' : '') + '>Nonaktif</option></select></div></div>' +
    '<div class="row2">' + fl('NIP', 'NIP (18 digit)', 'inputmode="numeric" maxlength="18" autocomplete="off"') + fl('Username', 'Nama pengguna', 'autocapitalize="none" autocomplete="off"', 1) + '</div>' +
    '<div class="row3">' + fl('GelarDepan', 'Gelar depan') + fl('Nama', 'Nama', '', 1) + fl('GelarBelakang', 'Gelar belakang') + '</div>' +
    '<div class="row2">' + '<div class="field"><label for="u-TglLahir">Tanggal lahir</label><input class="input" type="date" id="u-TglLahir" value="' + v('TglLahir') + '"></div>' + fl('Email', 'Email (untuk konfirmasi)', 'type="email" autocomplete="off"') + '</div>' +
    '<div class="row3">' + fl('PangkatGol', 'Pangkat / golongan') + fl('Gol', 'Gol') + fl('Kecamatan', 'Kecamatan') + '</div>' + fl('UnitKerja', 'Unit kerja') +
    (baru ? '<div class="field"><label for="u-Password">Kata sandi awal (opsional)</label><input class="input" id="u-Password" autocomplete="off" placeholder="Kosongkan untuk dibuat otomatis"></div>' : '') +
    '<div id="userErr" class="alert err-a" role="alert" hidden><i class="bi bi-exclamation-circle"></i><span></span></div></div>' +
    '<div class="modal-foot"><button type="button" class="btn btn-secondary" data-act="closeModal">Batal</button><button type="submit" class="btn btn-primary" id="userSave">Simpan</button></div></form>', {});
  $('#u-NIP', ov).setAttribute('autofocus', '');
  $('#userForm', ov).addEventListener('submit', ev => {
    ev.preventDefault();
    const g = id => ($('#u-' + id) || { value: '' }).value.trim(), d = { _kunci: u.Username || '' };
    ['Peran', 'StatusAkun', 'NIP', 'Username', 'GelarDepan', 'Nama', 'GelarBelakang', 'TglLahir', 'Email', 'PangkatGol', 'Gol', 'Kecamatan', 'UnitKerja'].forEach(k => d[k] = g(k)); if (baru) d.Password = g('Password');
    const er = $('#userErr'), btn = $('#userSave'); er.hidden = true; btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span> Menyimpan…';
    api('apiSimpanPengguna', S.token, d).then(r => {
      const i = S.users.findIndex(x => x.Username === (u.Username || r.data.user.Username)); if (i > -1) S.users[i] = r.data.user; else S.users.push(r.data.user);
      S.uMap = {}; S.users.forEach(x => { if (x.NIP) S.uMap[x.NIP] = x; }); persist(); closeModal(); renderAll(); toast(r.message);
      if (r.data.passwordAwal) showCred(r.data.user, r.data.passwordAwal, 'Akun dibuat');
    }).catch(e => { er.hidden = false; er.querySelector('span').textContent = e.message; btn.disabled = false; btn.textContent = 'Simpan'; });
  });
}
function showCred(u, sandi, judul) {
  openModal(mHead(judul, 'Catat sekarang — kata sandi hanya ditampilkan sekali.') + '<div class="modal-body"><div class="cred"><span class="muted xs">NAMA PENGGUNA</span><code>' + esc(u.Username) + '</code><span class="muted xs" style="margin-top:6px">KATA SANDI</span><code id="credPw">' + esc(sandi) + '</code></div>' +
    '<div class="alert warn-a"><i class="bi bi-shield-exclamation"></i><span>Sampaikan ke pemilik akun lewat saluran aman dan minta mereka segera mengganti kata sandi.</span></div></div>' +
    '<div class="modal-foot"><button class="btn btn-secondary" data-act="copy" data-v="' + esc(u.Username + ' / ' + sandi) + '"><i class="bi bi-clipboard"></i> Salin</button><button class="btn btn-primary" data-act="closeModal">Selesai</button></div>', { size: 'sm' });
}
function resetPw(un) {
  const u = S.users.find(x => x.Username === un); if (!u) return;
  openModal(mHead('Reset kata sandi', esc(namaLengkap(u))) + '<div class="modal-body"><p>Kata sandi baru akan dibuat otomatis dan semua sesi login akun ini dikeluarkan.</p></div><div class="modal-foot"><button class="btn btn-secondary" data-act="closeModal">Batal</button><button class="btn btn-danger" id="rpGo">Reset sekarang</button></div>', { size: 'sm' });
  $('#rpGo').onclick = function () {
    this.disabled = true; this.innerHTML = '<span class="spin sm"></span>';
    api('apiResetSandi', S.token, un).then(r => { closeModal(); showCred(u, r.data.passwordBaru, 'Kata sandi baru'); }).catch(e => { closeModal(); toast(e.message, 'error'); });
  };
}

// ── Pengaturan (admin) ──
function rPengaturan() {
  $('#p-pengaturan').innerHTML = '<div class="page-head"><div><h1>Pengaturan</h1><p class="muted sm">Identitas aplikasi.</p></div></div><div class="grid-2 even">' +
    '<form class="card" id="cfgForm" novalidate><div class="card-head"><h2>Identitas aplikasi</h2></div><div class="card-pad">' +
    '<div class="field"><label for="cfgName">Nama aplikasi<span class="req">*</span></label><input class="input" id="cfgName" maxlength="60" value="' + esc(S.cfg.appName) + '"><div class="err" id="e-cfgName" hidden></div></div>' +
    '<div class="field"><span class="lbl">Thumbnail / logo</span><div style="display:flex;gap:14px;align-items:center"><div class="thumb-prev" id="cfgPrev">' + (S.cfg.thumbnailUrl ? '<img alt="" src="' + esc(S.cfg.thumbnailUrl) + '">' : '<i class="bi bi-image"></i>') + '</div>' +
    '<div><label class="btn btn-secondary btn-sm" for="cfgThumb">Pilih gambar</label><input id="cfgThumb" class="vh" type="file" accept="image/png,image/jpeg,image/webp"><p class="hint" style="margin-top:6px">PNG/JPG/WebP. Otomatis diperkecil ke 256 px.</p></div></div></div>' +
    '<button class="btn btn-primary" id="cfgSave" type="submit">Simpan pengaturan</button></div></form></div>';
  $('#cfgForm').addEventListener('submit', saveCfg);
  $('#cfgThumb').addEventListener('change', onThumb);
}
// ── Impor data pegawai: popup di halaman Data Pegawai ──
function impBodyHTML() {
  const keep = S.imp, csv = keep.mode === 'csv';
  return '<div class="field"><span class="lbl">Sumber data</span><div class="tabs" style="padding:0" role="radiogroup"><button type="button" class="tab" role="radio" aria-checked="' + csv + '" aria-selected="' + csv + '" data-act="impMode" data-m="csv">Berkas Excel</button><button type="button" class="tab" role="radio" aria-checked="' + !csv + '" aria-selected="' + !csv + '" data-act="impMode" data-m="sheet">Spreadsheet lama</button></div></div>' +
    (csv ? '<div class="field"><label for="impFile">Berkas Excel (.xlsx / .xls)</label><input class="input" type="file" id="impFile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><p class="hint" id="impFileInfo">' + (keep.csv ? 'Berkas siap dipindai.' : 'Gunakan Templat Excel (tombol di bawah). Format .xlsx atau .xls.') + '</p></div>' :
      '<div class="field"><label for="impRef">URL atau ID spreadsheet lama</label><input class="input" id="impRef" value="' + esc(keep.ref) + '" placeholder="https://docs.google.com/spreadsheets/d/…"><p class="hint">Hanya dibaca. Sheet bernama “Pengguna” (atau sheet pertama), akun Google pengelola harus punya akses.</p></div>') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline" id="impScan" data-act="impRun" data-dry="1">Pindai (tanpa menulis)</button><button class="btn btn-primary" id="impGo" data-act="impRun" data-dry="0">Jalankan impor</button></div><div id="impOut" style="margin-top:16px"></div>';
}
function bindImp() {
  const f = $('#impFile'); if (f) f.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return; const info = $('#impFileInfo'), r = new FileReader(), excel = /\.xlsx?$/i.test(file.name);
    if (!excel) { S.imp.csv = ''; info.textContent = 'Format tidak didukung. Gunakan Templat Excel (.xlsx atau .xls).'; e.target.value = ''; return; }
    r.onload = () => {
      try { S.imp.csv = excel ? xlsxKeCsv(r.result) : String(r.result); info.textContent = file.name + ' (' + Math.round(file.size / 1024) + ' KB) siap dipindai.'; }
      catch (x) { S.imp.csv = ''; info.textContent = x.ramah ? x.message : 'Berkas tidak dapat dibaca. Pastikan berkas Excel (.xlsx / .xls) yang valid.'; }
    };
    r.onerror = () => { S.imp.csv = ''; info.textContent = 'Gagal membaca berkas.'; };
    { if (!window.XLSX) { info.textContent = 'Pustaka Excel belum termuat. Coba lagi beberapa detik lagi.'; return; } r.readAsArrayBuffer(file); }
  });
  const rf = $('#impRef'); if (rf) rf.addEventListener('input', e => S.imp.ref = e.target.value);
}
function openImport() {
  openModal(mHead('Impor data pegawai', 'Aman diulang: kunci NIP, tanpa data ganda, sumber hanya dibaca.') + '<div class="modal-body"><div id="impCard">' + impBodyHTML() + '</div></div>' +
    '<div class="modal-foot"><button class="btn btn-ghost btn-sm" data-act="tplXlsx" style="margin-right:auto"><i class="bi bi-file-earmark-excel"></i> Templat Excel</button><button class="btn btn-secondary" data-act="closeModal">Tutup</button></div>', { size: 'lg' });
  bindImp();
}
let thumbData = '';
function onThumb(e) {
  const f = e.target.files[0]; if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('Format gambar harus PNG, JPG, atau WebP.', 'error'); return; }
  const img = new Image(), rd = new FileReader();
  rd.onload = () => { img.onload = () => { const s = Math.min(256 / img.width, 256 / img.height, 1), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png'); thumbData = url.split(',')[1]; $('#cfgPrev').innerHTML = '<img alt="" src="' + url + '">'; }; img.onerror = () => toast('Gambar tidak dapat dibaca.', 'error'); img.src = rd.result; };
  rd.readAsDataURL(f);
}
function saveCfg(ev) {
  ev.preventDefault();
  const nama = $('#cfgName').value.trim(); if (!nama) { setErr('cfgName', 'Nama aplikasi wajib diisi.'); return; } setErr('cfgName', '');
  const btn = $('#cfgSave'); btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span> Menyimpan…';
  api('apiSimpanPengaturan', S.token, { appName: nama, thumbBase64: thumbData }).then(r => { S.cfg = r.data; thumbData = ''; applyBrand(); persist(); toast('Pengaturan disimpan.'); })
    .catch(e => toast(e.message, 'error')).finally(() => { btn.disabled = false; btn.textContent = 'Simpan pengaturan'; });
}
/** Templat Excel impor pegawai: sheet "Data Pegawai" (kolom berformat TEKS agar NIP 18 digit utuh) + sheet "Petunjuk" */
const KOLOM_IMPOR = ['NIP', 'Gelar Depan', 'Nama', 'Gelar Belakang', 'Tgl Lahir', 'Pangkat/Gol', 'Gol', 'Unit Kerja', 'Kecamatan', 'Email', 'Username'];
function tplXlsx() {
  if (!window.XLSX) { toast('Pustaka Excel belum termuat. Coba lagi sebentar.', 'warn'); return; }
  const BARIS = 300, ws = {};
  KOLOM_IMPOR.forEach((h, c) => { ws[XLSX.utils.encode_cell({ r: 0, c: c })] = { t: 's', v: h }; for (let r = 1; r <= BARIS; r++) ws[XLSX.utils.encode_cell({ r: r, c: c })] = { t: 's', v: '', z: '@' }; });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: BARIS, c: KOLOM_IMPOR.length - 1 } });
  ws['!cols'] = [22, 12, 28, 14, 13, 22, 8, 28, 16, 26, 16].map(w => ({ wch: w })); ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  const ins = XLSX.utils.aoa_to_sheet([
    ['PETUNJUK PENGISIAN'], ['Isi data pada sheet "Data Pegawai" mulai baris 2. Jangan mengubah / menghapus judul kolom di baris 1.'], [],
    ['Kolom', 'Wajib?', 'Keterangan', 'Contoh'],
    ['NIP', 'Ya', '18 digit angka (kolom sudah berformat teks, jangan diubah)', '198501012010011001'],
    ['Gelar Depan', 'Tidak', '', 'Dr.'], ['Nama', 'Ya', 'Nama tanpa gelar', 'Contoh Nama'], ['Gelar Belakang', 'Tidak', '', 'M.Pd.'],
    ['Tgl Lahir', 'Tidak', 'Format yyyy-mm-dd atau dd/mm/yyyy', '1985-01-01'], ['Pangkat/Gol', 'Tidak', '', 'Penata Tingkat I'], ['Gol', 'Tidak', '', 'III/d'],
    ['Unit Kerja', 'Tidak', '', 'Dinas Pendidikan'], ['Kecamatan', 'Tidak', '', 'Bojonegoro'], ['Email', 'Disarankan', 'Untuk email konfirmasi usulan', 'contoh@email.go.id'],
    ['Username', 'Tidak', 'Kosong = otomatis memakai NIP', 'contoh.nama'], [],
    ['Catatan', '', 'Pegawai yang NIP-nya sudah terdaftar hanya diperbarui data dirinya (kata sandi, peran, dan status akun tidak berubah). Gunakan tombol "Pindai" dulu sebelum "Jalankan impor".']]);
  ins['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 60 }, { wch: 24 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data Pegawai'); XLSX.utils.book_append_sheet(wb, ins, 'Petunjuk');
  saveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'templat_impor_pegawai.xlsx');
  toast('Templat Excel diunduh.');
}
/** Excel (.xlsx/.xls) → teks di peramban, lalu memakai jalur impor yang sama (backend tidak berubah) */
function xlsxKeCsv(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellNF: true });          // tanpa cellDates: tanggal tetap berupa nomor seri (bebas masalah zona waktu)
  const nama = wb.SheetNames.filter(n => n.toLowerCase() !== 'petunjuk')[0] || wb.SheetNames[0], ws = wb.Sheets[nama];
  if (XLSX.SSF && XLSX.SSF.is_date) Object.keys(ws).forEach(k => {      // sel bertanggal → teks yyyy-mm-dd persis seperti yang tampil di Excel
    const c = ws[k]; if (k[0] === '!' || !c || c.t !== 'n' || !c.z || !XLSX.SSF.is_date(c.z)) return;
    const p = XLSX.SSF.parse_date_code(c.v); if (!p) return;
    c.t = 's'; c.v = p.y + '-' + pad(p.m) + '-' + pad(p.d); c.w = c.v; delete c.z;
  });
  const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false }).split(/\r?\n/).filter(l => /[^,\s"]/.test(l)).join('\n');   // buang baris kosong templat
  if (!/(^|,)"?nip"?(,|$)/i.test((csv.split('\n')[0] || '').trim())) { const er = new Error('Kolom "NIP" tidak ditemukan di baris pertama. Gunakan Templat Excel dan jangan ubah judul kolomnya.'); er.ramah = true; throw er; }
  return csv;
}
function impRun(dry) {
  const body = { sumber: S.imp.mode, csv: S.imp.csv, sheetRef: S.imp.ref, dryRun: dry }, out = $('#impOut');
  if (S.imp.mode === 'csv' && !S.imp.csv) { out.innerHTML = '<div class="alert err-a"><i class="bi bi-exclamation-circle"></i><span>Pilih berkas Excel terlebih dahulu.</span></div>'; return; }
  if (S.imp.mode === 'sheet' && !S.imp.ref.trim()) { out.innerHTML = '<div class="alert err-a"><i class="bi bi-exclamation-circle"></i><span>Isi URL atau ID spreadsheet.</span></div>'; return; }
  $$('#impCard .btn').forEach(b => b.disabled = true); out.innerHTML = '<span class="spin"></span> <span class="muted">' + (dry ? 'Memindai…' : 'Mengimpor — mohon tunggu, jangan tutup halaman…') + '</span>';
  api('apiImportPengguna', S.token, body).then(r => {
    const L = r.data.laporan, cred = r.data.kredensial || [];
    out.innerHTML = '<div class="alert ' + (dry ? 'info-a' : 'ok-a') + '"><i class="bi bi-info-circle"></i><span>' + (dry ? 'Hasil pindai — belum ada data yang ditulis.' : 'Impor selesai.') + ' Sumber: <b>' + esc(L.sumber) + '</b></span></div>' +
      '<div class="tbl-wrap"><table class="cmp"><tr><th>Baris sumber</th><th>Ditambah</th><th>Diperbarui</th><th>Dilewati</th></tr><tr><td>' + L.baris + '</td><td class="new">' + L.tambah + '</td><td>' + L.perbarui + '</td><td>' + L.lewati + '</td></tr></table></div>' +
      (r.data.peringatan.length ? '<div class="alert warn-a" style="margin-top:12px"><i class="bi bi-exclamation-triangle"></i><ul style="margin:0;padding-left:16px">' + r.data.peringatan.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') +
      (cred.length ? '<div class="alert warn-a" style="margin-top:12px"><i class="bi bi-key"></i><span><b>' + cred.length + ' akun baru</b> dibuat. Unduh kredensial sekarang — kata sandi tidak dapat dilihat lagi.</span></div><button class="btn btn-primary btn-sm" id="credDl">Unduh kredensial (CSV)</button>' : '');
    if (cred.length) $('#credDl').onclick = () => saveBlob(new Blob([toCSV([['NIP', 'Nama', 'Username', 'Kata Sandi Awal']].concat(cred.map(c => [c.NIP, c.Nama, c.Username, c.Sandi])))], { type: 'text/csv' }), 'kredensial_akun_baru.csv');
    if (!dry) { S.imp.csv = ''; refresh(true); }
  }).catch(e => { out.innerHTML = '<div class="alert err-a"><i class="bi bi-exclamation-circle"></i><span>' + esc(e.message) + '</span></div>'; })
    .finally(() => $$('#impCard .btn').forEach(b => b.disabled = false));
}

// ═════════════════════ HALAMAN ASN ═════════════════════
function stepper(us) {
  const st = us ? us.Status : null, fin = ['Disetujui', 'Ditolak', 'Perlu Perbaikan'].indexOf(st) > -1, rw = histOf(us ? us.IDUsulan : '');
  const when = s => { const r = rw.filter(x => x.StatusSesudah === s)[0]; return r ? tglJam(r.Tanggal) : '—'; };
  const kls = fin ? (st === 'Disetujui' ? 'done' : st === 'Ditolak' ? 'bad' : 'fix') : '';
  return '<div class="steps"><div class="step done"><small>Tahap 01</small><strong>Usulan dikirim</strong><span class="sm muted">' + tglJam(us.TanggalKirim) + '</span><i class="bi bi-check-circle-fill"></i></div>' +
    '<div class="step ' + (st === 'Diperiksa' ? 'now' : fin ? 'done' : 'now') + '"><small>Tahap 02' + (!fin ? ' • aktif' : '') + '</small><strong>Pemeriksaan admin</strong><span class="sm muted">' + (st === 'Dikirim' ? 'Menunggu diperiksa' : when('Diperiksa')) + '</span><i class="bi ' + (fin ? 'bi-check-circle-fill' : 'bi-hourglass-split') + '"></i></div>' +
    '<div class="step ' + kls + '"><small>Tahap 03</small><strong>' + (fin ? esc(st) : 'Keputusan') + '</strong><span class="sm muted">' + (fin ? tglJam(us.TanggalKeputusan) : 'Belum ada keputusan') + '</span><i class="bi ' + (st === 'Disetujui' ? 'bi-patch-check-fill' : st === 'Ditolak' ? 'bi-x-circle-fill' : st === 'Perlu Perbaikan' ? 'bi-pencil-square' : 'bi-circle') + '"></i></div></div>';
}
function rBeranda() {
  const me = S.me, list = sorted(), last = list[0], aktif = list.filter(u => u.Status === 'Dikirim' || u.Status === 'Diperiksa')[0];
  const kv = (k, v) => '<div><dt>' + k + '</dt><dd>' + (v ? esc(v) : '—') + '</dd></div>';
  const hero = aktif ? '<div class="hero"><span class="badge">' + esc(aktif.Status) + '</span><div class="big">' + esc(aktif.IDUsulan) + '</div><p>Usulan Anda sedang diproses. Dikirim ' + tglJam(aktif.TanggalKirim) + '.</p><div style="margin-top:14px"><button class="btn btn-secondary btn-sm" data-act="detail" data-id="' + esc(aktif.IDUsulan) + '">Lihat detail</button></div></div>' :
    last && last.Status === 'Perlu Perbaikan' ? '<div class="hero" style="background:linear-gradient(135deg,#EA580C,#F97316)"><span class="badge">Perlu perbaikan</span><div class="big">Ada catatan admin</div><p>' + esc(last.CatatanAdmin) + '</p><div style="margin-top:14px"><button class="btn btn-secondary btn-sm" data-act="redo" data-id="' + esc(last.IDUsulan) + '">Ajukan ulang</button></div></div>' :
    '<div class="hero"><span class="badge">Siap diajukan</span><div class="big">Ajukan KGB</div><p>Isi data berkala dan unggah berkas persyaratan dalam beberapa menit.</p><div style="margin-top:14px"><button class="btn btn-secondary btn-sm" data-act="go" data-page="ajukan">Mulai pengajuan <i class="bi bi-arrow-right"></i></button></div></div>';
  $('#p-beranda').innerHTML = '<div class="page-head"><div><h1>Halo, ' + esc(me.Nama) + '</h1><p class="muted sm">Pantau pengusulan Kenaikan Gaji Berkala Anda di sini.</p></div></div>' +
    '<div class="grid-2"><div class="card card-pad"><h2 style="margin-bottom:14px">Data diri</h2><dl class="kv" style="margin:0">' + kv('Nama lengkap', namaLengkap(me)) + kv('NIP', me.NIP) + kv('Tanggal lahir', me.TglLahir ? tgl(me.TglLahir) : '') + kv('Pangkat / golongan', (me.PangkatGol || '') + (me.Gol ? ' (' + me.Gol + ')' : '')) + kv('Unit kerja', me.UnitKerja) + kv('Kecamatan', me.Kecamatan) + '</dl></div>' + hero + '</div>' +
    '<div class="card" style="margin-top:16px"><div class="card-head"><h2>' + (last ? 'Status usulan terakhir' : 'Belum ada usulan') + '</h2>' + (last ? '<span class="mono muted">' + esc(last.IDUsulan) + '</span>' : '') + '</div><div class="card-pad">' +
    (last ? stepper(last) + (last.CatatanAdmin ? '<div class="note" style="margin-top:14px"><b>Catatan admin:</b> ' + esc(last.CatatanAdmin) + '</div>' : '') : empty('bi-file-earmark-plus', 'Anda belum mengajukan usulan', 'Mulai ajukan Kenaikan Gaji Berkala Anda sekarang.', '<button class="btn btn-primary" style="margin-top:14px" data-act="go" data-page="ajukan">Ajukan usulan</button>')) + '</div></div>';
}

// ── Form pengajuan ──
function draftKey() { return 'kgb_draft_' + (S.me ? S.me.Username : ''); }
function initDraft() {
  if (S.draft && S.draft.nip === S.me.NIP) return;
  const d = jparse(store.get(draftKey()));
  S.draft = d && d.id && d.nip === S.me.NIP ? d : { id: 'DRAFT-' + S.me.NIP + '-' + randId(14), nip: S.me.NIP, vals: {}, up: {} };
  S.up = {}; DOK.forEach(j => { if (S.draft.up && S.draft.up[j]) S.up[j] = { state: 'done', nama: S.draft.up[j] }; });
}
const saveDraft = debounce(() => { if (S.draft) store.set(draftKey(), JSON.stringify(S.draft)); }, 400);
function kgbField(k, lbl, type, ph, val) {
  const head = '<div class="field"><label for="f-' + k + (type === 'masa' ? '-th' : '') + '">' + lbl + '<span class="req">*</span></label>';
  const err = '<div class="err" id="e-' + k + '" hidden></div></div>';
  if (type === 'masa') { const m = String(val || '').match(/(\d+)\s*Tahun\s*(\d+)\s*Bulan/i) || [];
    return head + '<div class="pair"><span><input class="input" id="f-' + k + '-th" type="number" min="0" max="60" inputmode="numeric" value="' + esc(m[1] || '') + '" aria-label="' + lbl + ' (tahun)"><small>Tahun</small></span><span><input class="input" id="f-' + k + '-bl" type="number" min="0" max="11" inputmode="numeric" value="' + esc(m[2] || '') + '" aria-label="' + lbl + ' (bulan)"><small>Bulan</small></span></div>' + err; }
  if (type === 'gaji') return head + '<input class="input" id="f-' + k + '" inputmode="numeric" autocomplete="off" placeholder="0" value="' + fmtNum(val) + '">' + err;
  if (type === 'tgl') return head + '<input class="input" id="f-' + k + '" type="date" value="' + esc(val || '') + '">' + err;
  return head + '<input class="input" id="f-' + k + '" maxlength="200" placeholder="' + esc(ph || '') + '" value="' + esc(val || '') + '">' + err;
}
function dropHTML(j, i) {
  const st = S.up[j] || {}, cls = st.state === 'done' ? ' done' : st.state === 'error' ? ' bad' : '';
  return '<div class="drop' + cls + '" id="drop-' + i + '"><i class="bi ' + (st.state === 'done' ? 'bi-check-circle-fill' : 'bi-file-earmark-pdf') + ' big"></i><div class="grow"><strong>' + esc(j) + '<span class="req">*</span></strong><span>' +
    (st.state === 'uploading' ? '<span class="spin sm"></span> Mengunggah ' + esc(st.nama) + '…' : st.state === 'done' ? esc(st.nama) + ' • terunggah' : st.state === 'error' ? esc(st.msg) : 'PDF, maksimal 2 MB') + '</span><div class="err" id="e-dok-' + i + '" hidden></div></div>' +
    '<label class="btn btn-secondary btn-sm" for="fl-' + i + '">' + (st.state === 'done' ? 'Ganti' : 'Pilih berkas') + '</label><input id="fl-' + i + '" class="vh" type="file" accept="application/pdf,.pdf" data-i="' + i + '"></div>';
}
function updateDrop(i) { const e = $('#drop-' + i); if (e) e.outerHTML = dropHTML(DOK[i], i); }
function refreshSubmit() { const b = $('#btnKirim'); if (!b) return; const busy = DOK.some(j => (S.up[j] || {}).state === 'uploading'); b.disabled = busy || S.submitting; b.innerHTML = S.submitting ? '<span class="spin sm"></span> Mengirim…' : busy ? '<span class="spin sm"></span> Menunggu unggahan…' : '<i class="bi bi-send"></i> Kirim usulan'; }
function rAjukan() {
  const sec = $('#p-ajukan'), me = S.me, aktif = S.usulan.filter(u => u.Status === 'Dikirim' || u.Status === 'Diperiksa')[0];
  if (aktif) { sec.dataset.ready = ''; sec.innerHTML = '<div class="page-head"><div><h1>Form Pengusulan KGB</h1></div></div><div class="card card-pad">' + empty('bi-hourglass-split', 'Usulan Anda sedang diproses', 'Usulan ' + esc(aktif.IDUsulan) + ' berstatus “' + esc(aktif.Status) + '”. Anda dapat mengajukan lagi setelah ada keputusan admin.', '<button class="btn btn-primary" style="margin-top:14px" data-act="go" data-page="riwayat">Lihat riwayat</button>') + '</div>'; return; }
  initDraft();
  if (S.prefill) { S.draft.vals = {}; KGB.forEach(k => S.draft.vals[k[0]] = S.prefill[k[0]] || ''); S.prefill = null; saveDraft(); }
  const v = S.draft.vals || {}, kv = (k, x) => '<div class="field"><label>' + k + '</label><input class="input" readonly value="' + esc(x || '') + '"></div>';
  sec.dataset.ready = '1';
  sec.innerHTML = '<div class="page-head"><div><h1>Form Pengusulan KGB</h1><p class="muted sm">Draf tersimpan otomatis di perangkat ini. Berkas langsung diunggah saat dipilih.</p></div></div>' +
    '<form class="card" id="formKgb" novalidate><div class="sec"><h3>Data ASN</h3><p class="sm muted">Diambil dari akun Anda. Bila ada yang keliru, hubungi admin.</p><div class="row3">' + kv('Nama lengkap', namaLengkap(me)) + kv('NIP', me.NIP) + kv('Tanggal lahir', me.TglLahir ? tgl(me.TglLahir) : '') + '</div><div class="row3">' + kv('Pangkat / golongan', (me.PangkatGol || '') + (me.Gol ? ' (' + me.Gol + ')' : '')) + kv('Unit kerja', me.UnitKerja) + kv('Kecamatan', me.Kecamatan) + '</div></div>' +
    '<div class="sec"><h3>Data berkala lama</h3><p class="sm muted">Sesuai SK KGB terakhir Anda.</p><div class="row2">' + KGB.slice(0, 7).map(k => kgbField(k[0], k[1], k[2], k[3], v[k[0]])).join('') + '</div></div>' +
    '<div class="sec"><h3>Penetapan baru</h3><p class="sm muted">Gaji dan TMT berkala yang diusulkan.</p><div class="row3">' + KGB.slice(7).map(k => kgbField(k[0], k[1], k[2], k[3], v[k[0]])).join('') + '</div><div class="diff" id="diffBox" aria-live="polite"></div></div>' +
    '<div class="sec"><h3>Berkas persyaratan</h3><p class="sm muted">Format PDF, maksimal 2 MB per berkas. Semua berkas wajib diunggah.</p>' + DOK.map((j, i) => dropHTML(j, i)).join('') + '</div>' +
    '<div class="sticky-act"><span class="hint grow">Setelah dikirim, konfirmasi dikirim ke email Anda' + (me.Email ? ' (' + esc(me.Email) + ')' : ' — email belum terdaftar, hubungi admin') + '.</span><button type="button" class="btn btn-secondary" data-act="clearDraft">Kosongkan</button><button type="submit" class="btn btn-primary" id="btnKirim"><i class="bi bi-send"></i> Kirim usulan</button></div></form>';
  updateDiff(); refreshSubmit();
}
function updateDiff() {
  const a = Number(digits(($('#f-GajiPokokLama') || {}).value)), b = Number(digits(($('#f-GajiPokokBaru') || {}).value)), box = $('#diffBox'); if (!box) return;
  box.textContent = a && b ? 'Selisih kenaikan: ' + (b >= a ? '+' : '−') + rp(Math.abs(b - a)) + ' / bulan' : '';
}
function readForm() {
  const d = {};
  KGB.forEach(k => { const key = k[0];
    if (k[2] === 'masa') { const th = $('#f-' + key + '-th').value.trim(), bl = $('#f-' + key + '-bl').value.trim(); d[key] = th === '' || bl === '' ? '' : Number(th) + ' Tahun ' + pad(Number(bl)) + ' Bulan'; }
    else if (k[2] === 'gaji') d[key] = digits($('#f-' + key).value); else d[key] = $('#f-' + key).value.trim(); });
  return d;
}
function validateForm(d) {
  const er = {};
  KGB.forEach(k => { const key = k[0], v = d[key];
    if (!v) { er[key] = k[1] + ' wajib diisi.'; return; }
    if (k[2] === 'gaji' && Number(v) <= 0) er[key] = 'Isi dengan angka lebih dari 0.';
    if (k[2] === 'masa') { const m = v.match(/^(\d+) Tahun (\d+) Bulan$/); if (!m || Number(m[2]) > 11 || Number(m[1]) > 60) er[key] = 'Bulan 0–11 dan tahun 0–60.'; }
    if (k[2] === 'tgl' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) er[key] = 'Tanggal tidak valid.';
  });
  return er;
}
function onPickFile(inp) {
  const i = Number(inp.dataset.i), j = DOK[i], f = inp.files[0]; if (!f) return;
  const bad = !(/\.pdf$/i.test(f.name) || f.type === 'application/pdf') ? 'Berkas harus berformat PDF.' : f.size === 0 ? 'Berkas kosong.' : f.size > MAKS_PDF ? 'Ukuran ' + (f.size / 1048576).toFixed(1) + ' MB melebihi batas 2 MB.' : '';
  if (bad) { S.up[j] = { state: 'error', msg: bad }; updateDrop(i); return; }
  S.up[j] = { state: 'uploading', nama: f.name }; updateDrop(i); refreshSubmit();
  S.upQueue = S.upQueue.then(() => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Gagal membaca berkas.')); r.readAsDataURL(f); }))
    .then(b64 => api('apiUnggahBerkas', S.token, { draftId: S.draft.id, jenis: j, nama: f.name, base64: b64 }))
    .then(() => { S.up[j] = { state: 'done', nama: f.name }; S.draft.up[j] = f.name; saveDraft(); })
    .catch(e => { S.up[j] = { state: 'error', msg: e.message }; delete S.draft.up[j]; })
    .then(() => { updateDrop(i); refreshSubmit(); });
}
function submitUsulan(ev) {
  ev.preventDefault();
  if (S.submitting) return;
  const d = readForm(), er = validateForm(d); let first = null;
  KGB.forEach(k => { setErr(k[0], er[k[0]]); if (er[k[0]] && !first) first = $('#f-' + k[0]) || $('#f-' + k[0] + '-th'); });
  DOK.forEach((j, i) => { const ok = (S.up[j] || {}).state === 'done'; const e = $('#e-dok-' + i); if (e) { e.hidden = ok; e.innerHTML = ok ? '' : '<i class="bi bi-exclamation-circle"></i><span>Berkas ini wajib diunggah.</span>'; } if (!ok && !first) first = $('#fl-' + i); });
  if (first) { toast('Periksa kembali isian yang ditandai.', 'warn'); const t = first.classList.contains('vh') ? first.parentNode : first; t.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (!first.classList.contains('vh')) first.focus(); return; }
  S.submitting = true; S.mut++; refreshSubmit();
  api('apiKirimUsulan', S.token, d, S.draft.id).then(r => {
    S.usulan.unshift(r.data.usulan); r.data.dokumen.forEach(x => S.dokumen.push(x)); S.riwayat.push(r.data.riwayat);
    store.del(draftKey()); S.draft = null; S.up = {}; $('#p-ajukan').dataset.ready = ''; persist();
    toast(r.data.emailTerkirim ? 'Usulan ' + r.data.usulan.IDUsulan + ' terkirim. Email konfirmasi dikirim.' : 'Usulan ' + r.data.usulan.IDUsulan + ' terkirim. (Email konfirmasi tidak terkirim — pastikan email Anda terdaftar.)', r.data.emailTerkirim ? 'success' : 'warn');
    S.submitting = false; go('riwayat');
  }).catch(e => { S.submitting = false; toast(e.message, 'error'); refreshSubmit(); }).then(() => { S.mut--; });
}
function rRiwayat() {
  const sec = $('#p-riwayat');
  if (!sec.dataset.ready) {
    sec.dataset.ready = '1';
    sec.innerHTML = '<div class="page-head"><div><h1>Riwayat Usulan</h1><p class="muted sm">Seluruh usulan KGB milik Anda beserta statusnya.</p></div><div class="head-actions"><button class="btn btn-primary" data-act="go" data-page="ajukan"><i class="bi bi-plus-lg"></i> Ajukan usulan</button></div></div><div class="card"><div id="rwBody"></div></div>';
  }
  const q = S.rf.q.toLowerCase(), list = sorted().filter(u => !q || (u.IDUsulan + ' ' + u.Status + ' ' + tgl(u.TMTBerkalaBaru)).toLowerCase().indexOf(q) > -1), f = S.rf;
  f.pg = Math.min(f.pg, Math.max(1, Math.ceil(list.length / f.per))); const part = list.slice((f.pg - 1) * f.per, f.pg * f.per);
  $('#rwBody').innerHTML = part.length ? '<div class="tbl-wrap"><table class="tbl stack-sm"><thead><tr><th>ID usulan</th><th>Tgl kirim</th><th>Gaji pokok baru</th><th>TMT berkala baru</th><th>Status</th><th></th></tr></thead><tbody>' +
    part.map(us => '<tr><td class="first" data-l="ID usulan"><button class="link mono" data-act="detail" data-id="' + esc(us.IDUsulan) + '">' + esc(us.IDUsulan) + '</button></td><td data-l="Tgl kirim" class="mono">' + tglJam(us.TanggalKirim) + '</td><td data-l="Gaji pokok baru"><b>' + rp(us.GajiPokokBaru) + '</b></td><td data-l="TMT berkala baru" class="mono">' + tgl(us.TMTBerkalaBaru) + '</td><td data-l="Status">' + badge(us.Status) + '</td>' +
      '<td class="cell-act nowrap"><button class="btn btn-outline btn-sm" data-act="detail" data-id="' + esc(us.IDUsulan) + '">Detail</button>' + (us.Status === 'Perlu Perbaikan' || us.Status === 'Ditolak' ? ' <button class="btn btn-primary btn-sm" data-act="redo" data-id="' + esc(us.IDUsulan) + '">Ajukan ulang</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' + pager('riwayat', list.length, f.pg, f.per) :
    empty('bi-clock-history', 'Belum ada riwayat', q ? 'Tidak ada usulan yang cocok dengan pencarian.' : 'Usulan yang Anda kirim akan muncul di sini.', q ? '' : '<button class="btn btn-primary" style="margin-top:14px" data-act="go" data-page="ajukan">Ajukan usulan</button>');
}

// ═════════════════════ DETAIL USULAN, KEPUTUSAN, PRATINJAU ═════════════════════
function openDetail(id) {
  const us = S.usulan.find(x => x.IDUsulan === id); if (!us) return;
  const u = userOf(us.NIP) || {}, docs = docsOf(id), hist = histOf(id), ad = isAdmin();
  const row = (k, a, b) => '<tr><td>' + k + '</td><td>' + a + '</td><td class="new">' + b + '</td></tr>', sel = Number(us.GajiPokokBaru) - Number(us.GajiPokokLama);
  const fin = x => x === 'Disetujui' || x === 'Ditolak' || x === 'Perlu Perbaikan';
  openModal(mHead('Usulan <span class="mono">' + esc(id) + '</span>', esc(namaLengkap(u))) + '<div class="modal-body">' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + badge(us.Status) + '<span class="sm muted">Dikirim ' + tglJam(us.TanggalKirim) + (us.TanggalKeputusan ? ' • Keputusan ' + tglJam(us.TanggalKeputusan) : '') + '</span></div>' +
    '<div><h4>Pegawai</h4><dl class="kv" style="margin:0"><div><dt>NIP</dt><dd class="mono">' + esc(us.NIP) + '</dd></div><div><dt>Pangkat / Gol</dt><dd>' + esc((u.PangkatGol || '—') + (u.Gol ? ' (' + u.Gol + ')' : '')) + '</dd></div><div><dt>Unit kerja</dt><dd>' + esc(u.UnitKerja || '—') + '</dd></div><div><dt>Kecamatan</dt><dd>' + esc(u.Kecamatan || '—') + '</dd></div></dl></div>' +
    '<div><h4>Data KGB</h4><div class="tbl-wrap"><table class="cmp"><tr><th>Komponen</th><th>Lama</th><th>Baru</th></tr>' + row('Gaji pokok', rp(us.GajiPokokLama), rp(us.GajiPokokBaru) + ' <span class="up xs">(' + (sel >= 0 ? '+' : '−') + rp(Math.abs(sel)) + ')</span>') +
    row('Masa kerja', esc(us.MasaKerjaLama), esc(us.MasaKerjaBaru)) + row('TMT berkala', tgl(us.TMTBerkalaLama), tgl(us.TMTBerkalaBaru)) + '</table></div>' +
    '<dl class="kv" style="margin:12px 0 0"><div><dt>Atas dasar surat</dt><dd>' + esc(us.AtasDasarSurat) + '</dd></div><div><dt>Nomor berkala lama</dt><dd>' + esc(us.NomorBerkalaLama) + '</dd></div><div><dt>Tanggal berkala lama</dt><dd>' + tgl(us.TanggalBerkalaLama) + '</dd></div><div><dt>Masa kerja berkala lama</dt><dd>' + esc(us.MasaKerjaBerkalaLama) + '</dd></div></dl></div>' +
    '<div><h4>Berkas persyaratan</h4><div class="files">' + (docs.length ? docs.map(d => '<div class="file"><i class="bi bi-file-earmark-pdf-fill"></i><div class="grow"><button type="button" class="link" data-act="preview" data-f="' + esc(d.FileId) + '" data-n="' + esc(d.NamaFile) + '">' + esc(d.Jenis) + '</button><span style="display:block">' + esc(d.NamaFile) + '</span></div><button class="btn btn-outline btn-sm" data-act="preview" data-f="' + esc(d.FileId) + '" data-n="' + esc(d.NamaFile) + '">Pratinjau</button></div>').join('') : '<p class="sm muted">Tidak ada berkas.</p>') + '</div></div>' +
    (!ad && us.CatatanAdmin ? '<div class="note"><b>Catatan admin:</b> ' + esc(us.CatatanAdmin) + '</div>' : '') +
    (ad ? '<div class="field" style="margin:0"><label for="catatan">Catatan untuk ASN <span class="muted" style="font-weight:400">(wajib bila menolak / minta perbaikan)</span></label><textarea class="textarea" id="catatan" maxlength="500">' + esc(us.CatatanAdmin) + '</textarea><div class="err" id="e-catatan" hidden></div></div>' : '') +
    '<div><h4>Riwayat</h4><ul class="tl">' + (hist.length ? hist.map(h => '<li><b>' + esc(h.Aksi) + '</b><time>' + tglJam(h.Tanggal) + ' • ' + esc(h.Pengguna) + '</time></li>').join('') : '<li>Belum ada riwayat.</li>') + '</ul></div></div>' +
    '<div class="modal-foot">' + (ad ? ['diperiksa|Tandai diperiksa|btn-secondary', 'perbaikan|Minta perbaikan|btn-warn', 'tolak|Tolak|btn-danger', 'setujui|Setujui|btn-success'].map(a => { const p = a.split('|'); return '<button class="btn ' + p[2] + '" data-act="putusan" data-aksi="' + p[0] + '" data-id="' + esc(id) + '"' + (us.Status === AKSI[p[0]] ? ' disabled' : '') + '>' + p[1] + '</button>'; }).join('') :
      (us.Status === 'Perlu Perbaikan' || us.Status === 'Ditolak' ? '<button class="btn btn-primary" data-act="redo" data-id="' + esc(id) + '">Ajukan ulang</button>' : '') + '<button class="btn btn-secondary" data-act="closeModal">Tutup</button>') + '</div>', { size: 'lg' });
}
/** Optimistic: UI berubah seketika, server menyusul; gagal → dikembalikan otomatis. Ada tombol Urungkan. */
function putusan(id, aksi, undo) {
  const us = S.usulan.find(x => x.IDUsulan === id); if (!us) return;
  const ta = $('#catatan'), catatan = undo ? (undo.catatan || '') : (ta ? ta.value.trim() : '');
  if ((aksi === 'tolak' || aksi === 'perbaikan') && !catatan) { setErr('catatan', 'Catatan wajib diisi untuk menolak atau meminta perbaikan.'); const e = $('#catatan'); if (e) { e.setAttribute('aria-invalid', 'true'); e.focus(); } return; }
  const prev = { Status: us.Status, CatatanAdmin: us.CatatanAdmin, TanggalKeputusan: us.TanggalKeputusan }, status = AKSI[aksi], final = status !== 'Dikirim' && status !== 'Diperiksa';
  const tmp = { Tanggal: nowStr(), IDUsulan: id, Pengguna: S.me.Username, Aksi: 'Status: ' + status + (catatan ? ' — ' + catatan : ''), StatusSebelum: prev.Status, StatusSesudah: status };
  Object.assign(us, { Status: status, CatatanAdmin: catatan, TanggalKeputusan: final ? nowStr() : '' }); S.riwayat.push(tmp);
  if (!undo) closeModal(); renderAll(); persist(); S.mut++;
  api('apiPutusan', S.token, id, aksi, catatan).then(r => { Object.assign(us, r.data.usulan); const k = S.riwayat.indexOf(tmp); if (k > -1) S.riwayat[k] = r.data.riwayat; renderAll(); persist(); })
    .catch(e => { Object.assign(us, prev); const k = S.riwayat.indexOf(tmp); if (k > -1) S.riwayat.splice(k, 1); renderAll(); persist(); toast('Gagal menyimpan: ' + e.message, 'error'); })
    .then(() => { S.mut--; });
  if (!undo) toast('Usulan ' + id + ' → ' + status + '.', 'success', { label: 'Urungkan', fn: () => putusan(id, STATUS_AKSI[prev.Status], { catatan: prev.CatatanAdmin }) });
}
function preview(fileId, nama) {
  openModal(mHead('Pratinjau berkas', esc(nama)) + '<div class="modal-body"><div id="pvBox" class="empty"><span class="spin"></span><p class="sm" style="margin-top:8px">Memuat berkas…</p></div><p class="hint">Jika pratinjau tidak tampil di peramban Anda, gunakan tombol Unduh.</p></div><div class="modal-foot"><button class="btn btn-secondary" data-act="closeModal">Tutup</button><button type="button" id="pvDl" class="btn btn-primary" data-act="dlPdf" hidden><i class="bi bi-download"></i> Unduh</button></div>', { size: 'lg' });
  api('apiAmbilBerkas', S.token, fileId).then(r => {
    const bin = atob(r.data.base64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'application/pdf' }), url = URL.createObjectURL(blob); S.blobs.push(url);
    const box = $('#pvBox'); if (!box) { return; } box.outerHTML = '<iframe class="pdf-frame" src="' + url + '" title="Pratinjau ' + esc(nama) + '"></iframe>';
    S.pv = { blob: blob, name: r.data.nama || nama }; const a = $('#pvDl'); if (a) a.hidden = false;
  }).catch(e => { const b = $('#pvBox'); if (b) b.innerHTML = '<i class="bi bi-exclamation-triangle"></i><p class="sm">' + esc(e.message) + '</p>'; });
}

// ═════════════════════ EXPORT EXCEL (client-side, 0 RTT) ═════════════════════
const KOLOM = ['GELAR DEPAN', 'NAMA', 'GELAR BELAKANG', 'NIP', 'TGL LAHIR', 'PANGKAT/GOL', 'GOL', 'UNIT KERJA', 'KECAMATAN', 'GAJI POKOK LAMA', 'ATAS DASAR SURAT (OLEH PEJABAT)', 'TANGGAL BERKALA LAMA', 'NOMOR BERKALA LAMA', 'TMT BERKALA LAMA', 'MASA KERJA BERKALA LAMA', 'MASA KERJA LAMA', 'GAJI POKOK BARU', 'MASA KERJA BARU', 'TMT BERKALA BARU'];
function exportExcel(scope) {
  const list = (scope === 'filter' ? filteredUsulan() : sorted());
  if (!list.length) { toast('Tidak ada usulan untuk diunduh.', 'warn'); return; }
  const rows = list.map(us => { const u = userOf(us.NIP) || {};
    return [u.GelarDepan || '', u.Nama || '', u.GelarBelakang || '', String(us.NIP), u.TglLahir ? tgl(u.TglLahir) : '', u.PangkatGol || '', u.Gol || '', u.UnitKerja || '', u.Kecamatan || '', Number(us.GajiPokokLama), us.AtasDasarSurat, tgl(us.TanggalBerkalaLama), us.NomorBerkalaLama, tgl(us.TMTBerkalaLama), us.MasaKerjaBerkalaLama, us.MasaKerjaLama, Number(us.GajiPokokBaru), us.MasaKerjaBaru, tgl(us.TMTBerkalaBaru)]; });
  const nama = 'Rekap_KGB_' + nowStr().slice(0, 10) + '.xlsx';
  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet([KOLOM].concat(rows)); ws['!cols'] = KOLOM.map((k, i) => ({ wch: [8, 28, 12, 20, 12, 22, 7, 28, 16, 14, 32, 14, 28, 14, 14, 14, 14, 14, 14][i] }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Rekap KGB');
    saveBlob(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nama);
  } else { saveBlob(new Blob([toCSV([KOLOM].concat(rows))], { type: 'text/csv' }), nama.replace('.xlsx', '.csv')); toast('Pustaka Excel belum termuat — diunduh sebagai CSV.', 'warn'); return; }
  toast('Rekap ' + rows.length + ' usulan diunduh.');
}

// ═════════════════════ GANTI SANDI ═════════════════════
function gantiSandi() {
  const f = (id, l, ac) => '<div class="field"><label for="pw-' + id + '">' + l + '</label><input class="input" type="password" id="pw-' + id + '" autocomplete="' + ac + '"></div>';
  openModal(mHead('Ganti kata sandi') + '<form id="pwForm" novalidate><div class="modal-body">' + f('lama', 'Kata sandi lama', 'current-password') + f('baru', 'Kata sandi baru', 'new-password') + '<p class="hint" style="margin-top:-8px">Minimal 8 karakter, memuat huruf dan angka.</p>' + f('ulang', 'Ulangi kata sandi baru', 'new-password') +
    '<div id="pwErr" class="alert err-a" role="alert" hidden><i class="bi bi-exclamation-circle"></i><span></span></div></div><div class="modal-foot"><button type="button" class="btn btn-secondary" data-act="closeModal">Batal</button><button type="submit" class="btn btn-primary" id="pwSave">Simpan</button></div></form>', { size: 'sm' });
  $('#pwForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const a = $('#pw-lama').value, b = $('#pw-baru').value, c = $('#pw-ulang').value, er = $('#pwErr'); er.hidden = true;
    const msg = !a || !b ? 'Lengkapi semua isian.' : b.length < 8 || !/[A-Za-z]/.test(b) || !/\d/.test(b) ? 'Kata sandi baru minimal 8 karakter dengan huruf dan angka.' : b !== c ? 'Konfirmasi kata sandi tidak sama.' : '';
    if (msg) { er.hidden = false; er.querySelector('span').textContent = msg; return; }
    const btn = $('#pwSave'); btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span>';
    api('apiGantiSandi', S.token, a, b).then(() => { closeModal(); toast('Kata sandi berhasil diganti.'); }).catch(e => { er.hidden = false; er.querySelector('span').textContent = e.message; btn.disabled = false; btn.textContent = 'Simpan'; });
  });
}

// ═════════════════════ EVENT DELEGASI ═════════════════════
const ACT = {
  go: el => go(el.dataset.page), goImport: openImport,
  openMenu, closeMenu, closeModal,
  theme: () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
  refresh: () => refresh(false),
  diag: diagnosa,
  profileMenu: el => { const m = $('#profileMenu'); m.hidden = !m.hidden; el.setAttribute('aria-expanded', String(!m.hidden)); },
  gantiSandi: () => { closeProfile(); gantiSandi(); },
  logout: () => { closeProfile(); forceLogout('Anda telah keluar.'); },
  togglePw: el => { const i = $('#lg-pass'), s = i.type === 'password'; i.type = s ? 'text' : 'password'; el.innerHTML = '<i class="bi ' + (s ? 'bi-eye-slash' : 'bi-eye') + '"></i>'; el.setAttribute('aria-label', s ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'); },
  detail: el => openDetail(el.dataset.id),
  putusan: el => putusan(el.dataset.id, el.dataset.aksi),
  preview: el => preview(el.dataset.f, el.dataset.n),
  tabStatus: el => { S.f.status = el.dataset.s; S.f.pg = 1; rUsulan(); },
  pg: el => { const t = el.dataset.t, p = Number(el.dataset.pg); if (t === 'usulan') { S.f.pg = p; rUsulanBody(); } else if (t === 'pegawai') { S.pf.pg = p; rPegawaiBody(); } else { S.rf.pg = p; rRiwayat(); } },
  export: el => exportExcel(el.dataset.scope),
  addUser: () => userForm(null), editUser: el => userForm(S.users.find(u => u.Username === el.dataset.u)), resetPw: el => resetPw(el.dataset.u),
  copy: el => copyText(el.dataset.v),
  impMode: el => { S.imp.mode = el.dataset.m; $('#impCard').innerHTML = impBodyHTML(); bindImp(); }, impRun: el => impRun(el.dataset.dry === '1'),
  dlPdf: () => { if (S.pv) saveBlob(S.pv.blob, S.pv.name); },
  tplXlsx: tplXlsx,
  redo: el => { const us = S.usulan.find(x => x.IDUsulan === el.dataset.id); closeModal(); $('#p-ajukan').dataset.ready = ''; go('ajukan', { prefill: us }); if (us) toast('Data usulan sebelumnya disalin. Perbarui, unggah ulang berkas, lalu kirim.', 'success'); },
  clearDraft: () => { store.del(draftKey()); S.draft = null; S.up = {}; $('#p-ajukan').dataset.ready = ''; rAjukan(); toast('Formulir dikosongkan.'); }
};
document.addEventListener('click', e => {
  const lnk = e.target.closest && e.target.closest('a[href]');   // pengaman: tidak ada tautan yang boleh pindah tab/halaman
  if (lnk && !lnk.hasAttribute('download') && !/^#/.test(lnk.getAttribute('href'))) { e.preventDefault(); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el); return; }
  if (e.target.classList && e.target.classList.contains('overlay')) closeModal();
  if (!e.target.closest('#profileMenu') && !e.target.closest('[data-act="profileMenu"]')) closeProfile();
});
window.addEventListener('resize', debounce(fitModal, 100));
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($$('#modalRoot .overlay').length) closeModal(); else { closeMenu(); closeProfile(); } } });
document.addEventListener('change', e => { if (e.target.matches && e.target.matches('input[type="file"][data-i]')) onPickFile(e.target); });
document.addEventListener('input', e => {
  const t = e.target; if (!t.closest || !t.closest('#formKgb')) return;
  if (/^f-Gaji/.test(t.id)) { const p = t.selectionStart, n = t.value.length; t.value = fmtNum(t.value); const q = Math.max(0, p + t.value.length - n); try { t.setSelectionRange(q, q); } catch (x) { /* abaikan */ } updateDiff(); }
  const k = t.id.replace(/^f-/, '').replace(/-(th|bl)$/, ''); if (t.id && KGB.some(x => x[0] === k)) setErr(k, '');
  if (S.draft) { try { S.draft.vals = readForm(); } catch (x) { /* abaikan */ } saveDraft(); }
});
document.addEventListener('submit', e => { if (e.target.id === 'formKgb') submitUsulan(e); else if (e.target.id === 'loginForm') doLogin(e); });

// ═════════════════════ INIT ═════════════════════
function init() {
  applyTheme(store.get('kgb_theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  applyBrand();
  if (!gasOk()) { const b = $('#loginErr'); b.hidden = false; b.querySelector('span').textContent = 'Konfigurasi belum lengkap: isi GAS_URL di js/config.js lalu push ulang ke GitHub.'; }
  else fetch(CFG.GAS_URL + '?action=config').then(r => r.json()).then(r => { if (r && r.success && r.data && r.data.config) { S.cfg = r.data.config; applyBrand(); } }).catch(() => { /* memakai cache lokal */ });
  $('#gSearch').addEventListener('input', debounce(e => {
    const v = e.target.value; if (!S.me) return;
    if (isAdmin()) { S.f.q = v; S.f.pg = 1; if (S.page !== 'usulan') go('usulan'); else rUsulan(); }
    else { S.rf.q = v; S.rf.pg = 1; if (S.page !== 'riwayat') go('riwayat'); else rRiwayat(); }
  }, 250));
  const tok = store.get('kgb_tok'), snap = jparse(store.get('kgb_snap'));
  if (tok && snap && snap.me) {                         // stale-while-revalidate: tampil dari snapshot, sinkron di latar belakang
    S.token = tok; load(snap); showApp(); go(isAdmin() ? 'dashboard' : 'beranda'); setSync('busy'); refresh(true).then(() => setSync('ok'));
  } else if (tok) { S.token = tok; api('apiBoot', tok).then(r => { load(r.data); persist(); showApp(); go(isAdmin() ? 'dashboard' : 'beranda'); }).catch(() => { forceLogout(); showLogin(); }); }
  else showLogin();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && Date.now() - S.lastSync > 60000) refresh(true); });
  setInterval(() => { if (!document.hidden && S.token && Date.now() - S.lastSync > 120000) refresh(true); }, 30000);
  window.addEventListener('online', () => { setSync('ok'); refresh(true); }); window.addEventListener('offline', () => setSync('off'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
