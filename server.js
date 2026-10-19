// Servidor do Bombarda Arena: entrega a página e roda as partidas em tempo real via WebSocket.
const fs = require('fs');
const path = require('path');
const http = require('http');
const dns = require('dns');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const game = require('./game');

const PORT = process.env.PORT || 3000;
const TICK = 30; // simulações por segundo
const SLOTS = game.MAX_PLAYERS;
const NAMES = ['Sol', 'Mar', 'Brasa', 'Mata', 'Uva', 'Laranja', 'Rosa', 'Neve', 'Lagoa', 'Limão']; // um por lugar, combinando com a cor
const DIRS = new Set(['up', 'down', 'left', 'right']);
const INDEX = path.join(__dirname, 'public', 'index.html');
const INDEX_ROOT = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    // procura a página em public/index.html e, se não achar, em index.html na raiz
    return fs.readFile(INDEX, (e1, b1) => e1 ? fs.readFile(INDEX_ROOT, (e2, b2) => e2 ? done(e2) : done(null, b2)) : done(null, b1));
    function done(err, buf) {
      if (err) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Arquivo index.html não encontrado no servidor.'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(buf);
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Não encontrado');
});

// IP pelo qual os jogadores chegam ao servidor. No Render ele fica atrás de um proxy e o endereço local da conexão é
// interno, então resolve o endereço público do serviço (RENDER_EXTERNAL_HOSTNAME); nos outros casos usa o da conexão.
let publicIp = null;
const publicHost = process.env.RENDER_EXTERNAL_HOSTNAME;
function resolvePublicIp() { dns.lookup(publicHost, { family: 4 }, (err, addr) => { if (!err) publicIp = addr; }); }
if (publicHost) { resolvePublicIp(); setInterval(resolvePublicIp, 10 * 60 * 1000).unref(); }
function serverIp(req) {
  if (publicIp) return publicIp;
  if (req.headers['x-forwarded-for']) return null; // atrás de outro proxy: o endereço local seria interno
  return String(req.socket.localAddress || '').replace(/^::ffff:/, '') || null;
}

const wss = new WebSocketServer({ server, maxPayload: 2048 });
const clients = new Map(); // id -> ws
const rooms = new Map();

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
function broadcast(room, e, d) {
  const msg = JSON.stringify({ e, d });
  for (const s of room.slots) if (s.type === 'human') { const ws = clients.get(s.sid); if (ws && ws.readyState === 1) ws.send(msg); }
}

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function cleanName(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 14) || 'Jogador'; }
function roomInfo(room) {
  return {
    code: room.code, host: room.hostId, toWin: room.toWin, botLvl: room.botLvl, phase: room.phase, wins: room.wins, round: room.round,
    map: game.mapSize(room.slots.filter(s => s.type !== 'empty').length),
    slots: room.slots.map((s, i) => ({ type: s.type, name: s.type === 'bot' ? `Bot ${NAMES[i]}` : s.name, sid: s.sid || null })),
  };
}
const sendRoom = room => broadcast(room, 'room', roomInfo(room));

function startRound(room) {
  room.round++; room.resolved = false;
  room.S = game.createRound(room.slots.map(s => s.type), room.botLvl);
  room.phase = 'game';
  sendRoom(room);
  if (!room.loop) room.loop = setInterval(() => tick(room), 1000 / TICK);
}
function backToLobby(room) {
  clearInterval(room.loop); room.loop = null;
  room.S = null; room.phase = 'lobby';
  sendRoom(room);
}
function tick(room) {
  const S = room.S; if (!S) return;
  game.step(S, 1 / TICK);
  broadcast(room, 'state', game.snapshot(S, room.round));
  if (S.phase === 'over' && !room.resolved) {
    room.resolved = true;
    const { winner, timeUp } = S.result;
    if (winner != null) room.wins[winner]++;
    const champ = room.wins.findIndex(w => w >= room.toWin);
    broadcast(room, 'roundOver', { winner, timeUp, wins: room.wins, champ, toWin: room.toWin });
    room.next = setTimeout(() => {
      if (!rooms.has(room.code)) return;
      if (champ >= 0) backToLobby(room); else startRound(room);
    }, champ >= 0 ? room.endDelay * 1.5 : room.endDelay);
  }
}

function leaveRoom(ws) {
  const room = rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  const i = room.slots.findIndex(s => s.sid === ws.cid);
  if (i >= 0) {
    if (room.phase === 'game') { room.slots[i] = { type: 'bot' }; if (room.S) room.S.players[i].bot = true; } // quem cai vira bot
    else room.slots[i] = { type: 'empty' };
  }
  const humans = room.slots.filter(s => s.type === 'human');
  if (!humans.length) {
    clearInterval(room.loop); clearTimeout(room.next);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === ws.cid) room.hostId = humans[0].sid;
  sendRoom(room);
}

const handlers = {
  create(ws, { name } = {}) {
    leaveRoom(ws);
    const code = newCode();
    const room = {
      code, hostId: ws.cid, toWin: 3, botLvl: 1, phase: 'lobby', wins: new Array(SLOTS).fill(0), round: 0, endDelay: 4000,
      slots: [{ type: 'human', sid: ws.cid, name: cleanName(name) }, ...Array.from({ length: SLOTS - 1 }, () => ({ type: 'empty' }))],
      S: null, loop: null, next: null, resolved: false,
    };
    rooms.set(code, room); ws.room = code;
    sendRoom(room);
    return { ok: true, code };
  },
  join(ws, { code, name } = {}) {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { ok: false, error: 'Não achei essa sala. Confira o código.' };
    if (room.phase !== 'lobby') return { ok: false, error: 'Essa sala está no meio de uma partida. Tente quando ela voltar para a sala de espera.' };
    if (ws.room === room.code) return { ok: true, code: room.code };
    const i = room.slots.findIndex(s => s.type === 'empty');
    if (i < 0) return { ok: false, error: `A sala está cheia (${SLOTS} lugares). Peça ao anfitrião para tirar um bot.` };
    leaveRoom(ws);
    room.slots[i] = { type: 'human', sid: ws.cid, name: cleanName(name) };
    ws.room = room.code;
    sendRoom(room);
    return { ok: true, code: room.code };
  },
  ping() {}, // só devolve a confirmação: o cliente mede o tempo de ida e volta
  leave(ws) { leaveRoom(ws); },
  setSlot(ws, { i, type } = {}) {
    const room = hostRoom(ws); if (!room) return;
    if (!(i >= 0 && i < SLOTS) || room.slots[i].type === 'human' || !['bot', 'empty'].includes(type)) return;
    room.slots[i] = { type }; sendRoom(room);
  },
  options(ws, { toWin, botLvl } = {}) {
    const room = hostRoom(ws); if (!room) return;
    if ([1, 3, 5].includes(toWin)) room.toWin = toWin;
    if ([0, 1, 2].includes(botLvl)) room.botLvl = botLvl;
    sendRoom(room);
  },
  start(ws) {
    const room = hostRoom(ws); if (!room) return;
    if (room.slots.filter(s => s.type !== 'empty').length < 2) return { ok: false, error: 'Precisa de pelo menos dois participantes. Chame um amigo ou adicione um bot.' };
    room.wins = new Array(SLOTS).fill(0); room.round = 0;
    startRound(room);
    return { ok: true };
  },
  input(ws, { dir, bomb } = {}) {
    const room = rooms.get(ws.room);
    if (!room || !room.S) return;
    const i = room.slots.findIndex(s => s.sid === ws.cid);
    if (i < 0) return;
    const p = room.S.players[i];
    p.inputDir = DIRS.has(dir) ? dir : null;
    if (bomb && p.alive) p.wantBomb = true;
  },
};
function hostRoom(ws) {
  const room = rooms.get(ws.room);
  return room && room.hostId === ws.cid && room.phase === 'lobby' ? room : null;
}

wss.on('connection', (ws, req) => {
  ws.cid = crypto.randomBytes(6).toString('hex'); ws.room = null; ws.alive = true;
  clients.set(ws.cid, ws);
  send(ws, { e: 'hello', d: { id: ws.cid, ip: serverIp(req) } });
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const h = m && Object.prototype.hasOwnProperty.call(handlers, m.e) ? handlers[m.e] : null;
    if (!h) return;
    let out;
    try { out = h(ws, m.d); } catch (err) { console.error('erro em', m.e, err); out = { ok: false, error: 'Erro no servidor.' }; }
    if (m.id) send(ws, { a: m.id, d: out === undefined ? { ok: true } : out });
  });
  ws.on('close', () => { leaveRoom(ws); clients.delete(ws.cid); });
  ws.on('error', () => {});
});

// ping a cada 25s: mantém a conexão viva atrás dos proxies e derruba quem sumiu
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 25000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Bombarda Arena rodando em http://localhost:${PORT}`));
}
module.exports = { server, rooms };
