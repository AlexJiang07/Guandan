// Guan Dan game server: serves the page from /public and runs the tables over WebSocket (/ws).
// Every move is checked here with the rules engine, and each player only receives their own hand.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const GD = require('./public/engine.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_TABLES = 500;
const IDLE_TABLE_MS = 6 * 60 * 60 * 1000; // empty tables are removed after 6 hours
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

// ---------- static files ----------
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = '/'; }
  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// ---------- tables ----------
const tables = new Map(); // code -> { code, s, conns: Set, last }

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(''); } while (tables.has(c));
  return c;
}

const isOnline = (t, uid) => [...t.conns].some((c) => c.token === uid);

// what one player is allowed to see: their own hand, only card counts for the others,
// and no secret tokens
function viewFor(t, token) {
  const s = t.s;
  const seat = s.seats.findIndex((x) => x && x.uid === token);
  const v = JSON.parse(JSON.stringify(s));
  v.hands = s.hands.map((h, i) => (i === seat ? h.slice() : new Array(h.length).fill('??')));
  v.seats = s.seats.map((x, i) => (x ? { nick: x.nick, uid: i === seat ? 'me' : 'p' + i, online: isOnline(t, x.uid) } : null));
  return v;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(t) {
  for (const c of t.conns) send(c.ws, { type: 'state', table: t.code, state: viewFor(t, c.token) });
}

function handle(conn, m) {
  if (m.type === 'ping') return;

  if (m.type === 'hello' || m.type === 'create') {
    const token = typeof m.token === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(m.token) ? m.token : null;
    if (!token) return send(conn.ws, { type: 'error', msg: 'Invalid session. Reload the page.' });
    conn.token = token;
    let t;
    if (m.type === 'create') {
      if (tables.size >= MAX_TABLES) return send(conn.ws, { type: 'error', msg: 'The server is full. Try again later.' });
      t = { code: newCode(), s: GD.newState(), conns: new Set(), last: Date.now() };
      tables.set(t.code, t);
      console.log(`table ${t.code} created (${tables.size} open)`);
    } else {
      t = tables.get(String(m.table || '').toUpperCase());
      if (!t) return send(conn.ws, { type: 'notfound' });
    }
    if (conn.table && conn.table !== t) { conn.table.conns.delete(conn); broadcast(conn.table); }
    conn.table = t;
    t.conns.add(conn);
    t.last = Date.now();
    broadcast(t);
    return;
  }

  if (m.type === 'act') {
    const t = conn.table;
    if (!t) return send(conn.ws, { type: 'error', msg: 'Join a table first.' });
    const a = m.a && typeof m.a === 'object' ? m.a : {};
    if (a.type === 'kick') {
      const target = t.s.seats[Number(a.seat)];
      if (target && isOnline(t, target.uid)) return send(conn.ws, { type: 'error', msg: 'That player is still connected.' });
    }
    const seat = t.s.seats.findIndex((x) => x && x.uid === conn.token);
    const err = GD.applyAction(t.s, { uid: conn.token, seat }, a);
    if (err) return send(conn.ws, { type: 'error', msg: err });
    t.s.v = (t.s.v || 0) + 1;
    t.last = Date.now();
    broadcast(t);
  }
}

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws) => {
  const conn = { ws, token: null, table: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(conn, m); } catch (e) {
      console.error('error handling message', e);
      send(ws, { type: 'error', msg: 'Something went wrong on the server.' });
    }
  });
  ws.on('close', () => {
    if (conn.table) { conn.table.conns.delete(conn); broadcast(conn.table); }
  });
});

// drop dead connections and forgotten tables
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
setInterval(() => {
  const now = Date.now();
  for (const [code, t] of tables) if (!t.conns.size && now - t.last > IDLE_TABLE_MS) tables.delete(code);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Guan Dan server running on port ${PORT}`));
