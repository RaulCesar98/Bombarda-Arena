// Lógica da partida. Roda só no servidor: os navegadores mandam teclas e recebem o estado.
const W = 15, H = 13;
const EMPTY = 0, WALL = 1, CRATE = 2;
const FUSE = 2.6, FLAME = 0.55, ROUND_TIME = 180, COUNTDOWN = 3;
const SPAWNS = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2]];
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const BASE_SPEED = 3.3, SPEED_STEP = 0.45;
const idx = (x, y) => y * W + x;

let S = null; // estado da sala sendo processada no momento

function createRound(slotTypes, botLvl) {
  const grid = new Uint8Array(W * H), hidden = new Int8Array(W * H).fill(-1);
  const safe = new Set();
  SPAWNS.forEach(([x, y]) => {
    const dx = x === 1 ? 1 : -1, dy = y === 1 ? 1 : -1;
    [[x, y], [x + dx, y], [x, y + dy]].forEach(([a, b]) => safe.add(idx(a, b)));
  });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = idx(x, y);
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) { grid[k] = WALL; continue; }
    if (safe.has(k)) continue;
    if (Math.random() < 0.72) {
      grid[k] = CRATE;
      if (Math.random() < 0.4) { const r = Math.random(); hidden[k] = r < 0.4 ? 0 : r < 0.8 ? 1 : 2; }
    }
  }
  const players = slotTypes.map((t, i) => {
    const [sx, sy] = SPAWNS[i];
    return {
      id: i, on: t !== 'empty', bot: t === 'bot', alive: t !== 'empty',
      x: sx + 0.5, y: sy + 0.5, maxBombs: 1, active: 0, range: 2, speed: BASE_SPEED,
      inputDir: null, wantBomb: false, facing: [0, 1], walking: false, deathT: 0,
      bombCd: 0, ban: -1, banT: 0, think: 0, dir: null,
      noise: Array.from({ length: W * H }, () => Math.random() * 2),
      order: [...D4].sort(() => Math.random() - 0.5),
    };
  });
  return {
    grid, hidden, items: new Int8Array(W * H).fill(-1), flame: new Float32Array(W * H), burn: new Float32Array(W * H),
    bombs: [], players, phase: 'countdown', phaseT: COUNTDOWN, timer: ROUND_TIME, t: 0,
    botLvl, events: [], result: null,
  };
}

/* ---------- movimento ---------- */
function bombAt(x, y) { return S.bombs.find(b => b.x === x && b.y === y && !b.done); }
function blocked(tx, ty, p) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
  if (S.grid[idx(tx, ty)] !== EMPTY) return true;
  const b = bombAt(tx, ty);
  return !!(b && !(Math.floor(p.x) === tx && Math.floor(p.y) === ty));
}
function blockedA(a, pt, qt, p) { return a === 0 ? blocked(pt, qt, p) : blocked(qt, pt, p); }
function move(p, dir, dt) {
  const a = dir[0] !== 0 ? 0 : 1, s = a === 0 ? dir[0] : dir[1], pk = a === 0 ? 'x' : 'y', qk = a === 0 ? 'y' : 'x';
  let d = p.speed * dt, pt = Math.floor(p[pk]), qt = Math.floor(p[qk]);
  const off = p[qk] - (qt + 0.5);
  if (Math.abs(off) > 1e-4) {
    // desliza para o centro da linha/coluna mais próxima que tenha passagem (ajuda nas curvas)
    const sg = Math.sign(off);
    const cands = [{ q: qt, dist: Math.abs(off) }, { q: qt + sg, dist: 1 - Math.abs(off) }].sort((m, n) => m.dist - n.dist);
    let tgt = null;
    for (const c of cands) if (c.dist < 0.75 && !blockedA(a, pt + s, c.q, p)) { tgt = c; break; }
    if (!tgt) return;
    const tc = tgt.q + 0.5, delta = tc - p[qk], st = Math.min(Math.abs(delta), d);
    p[qk] += Math.sign(delta) * st; d -= st;
    if (Math.abs(tc - p[qk]) > 1e-4) return;
    p[qk] = tc; qt = tgt.q; pt = Math.floor(p[pk]);
  }
  const c = pt + 0.5; let n = p[pk] + s * d;
  if (blockedA(a, pt + s, qt, p)) n = s > 0 ? Math.min(n, Math.max(p[pk], c)) : Math.max(n, Math.min(p[pk], c));
  p[pk] = n;
}

/* ---------- bombas ---------- */
function placeBomb(p) {
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  if (p.active >= p.maxBombs || bombAt(tx, ty) || S.grid[idx(tx, ty)] !== EMPTY) return false;
  S.bombs.push({ x: tx, y: ty, owner: p.id, fuse: FUSE, range: p.range, done: false });
  p.active++; S.events.push('place');
  return true;
}
function explode(b0) {
  const q = [b0];
  while (q.length) {
    const b = q.shift(); if (b.done) continue;
    b.done = true; S.players[b.owner].active--;
    S.flame[idx(b.x, b.y)] = FLAME;
    for (const [dx, dy] of D4) {
      for (let i = 1; i <= b.range; i++) {
        const x = b.x + dx * i, y = b.y + dy * i, k = idx(x, y), c = S.grid[k];
        if (c === WALL) break;
        if (c === CRATE) {
          S.grid[k] = EMPTY; S.burn[k] = 0.5; S.flame[k] = FLAME;
          if (S.hidden[k] >= 0) { S.items[k] = S.hidden[k]; S.hidden[k] = -1; }
          break;
        }
        S.flame[k] = FLAME;
        const ob = S.bombs.find(o => o.x === x && o.y === y && !o.done);
        if (ob) { q.push(ob); break; }
        if (S.items[k] >= 0) S.items[k] = -1;
      }
    }
  }
  S.bombs = S.bombs.filter(b => !b.done);
  S.events.push('boom');
}

/* ---------- bots ---------- */
function blastTiles(x, y, r) {
  const out = [idx(x, y)];
  for (const [dx, dy] of D4) for (let i = 1; i <= r; i++) {
    const k = idx(x + dx * i, y + dy * i), c = S.grid[k];
    if (c === WALL) break; out.push(k); if (c === CRATE) break;
  }
  return out;
}
function dangerMap(extra) {
  const D = new Float32Array(W * H).fill(Infinity);
  const list = S.bombs.map(b => ({ x: b.x, y: b.y, r: b.range, t: b.fuse }));
  if (extra) list.push(extra);
  const bl = list.map(b => blastTiles(b.x, b.y, b.r));
  for (let it = 0, ch = true; ch && it < 8; it++) {
    ch = false;
    list.forEach((b, i) => list.forEach((o, j) => {
      if (j !== i && o.t > b.t && bl[i].includes(idx(o.x, o.y))) { o.t = b.t; ch = true; }
    }));
  }
  list.forEach((b, i) => bl[i].forEach(k => { if (b.t < D[k]) D[k] = b.t; }));
  for (let k = 0; k < W * H; k++) if (S.flame[k] > 0) D[k] = -1;
  return D;
}
function bfs(p, sx, sy, D, strict, extraBomb) {
  const dist = new Int16Array(W * H).fill(-1), prev = new Int16Array(W * H).fill(-1), s0 = idx(sx, sy);
  const bset = new Set(S.bombs.map(b => idx(b.x, b.y))); if (extraBomb != null) bset.add(extraBomb);
  const q = [s0]; dist[s0] = 0;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of p.order) {
      const n = idx(x + dx, y + dy);
      if (dist[n] >= 0 || S.grid[n] !== EMPTY || bset.has(n) || D[n] < 0) continue;
      const arr = (dist[k] + 1) / p.speed;
      if (D[n] !== Infinity) { if (strict) continue; const m = D[n] - arr; if (m < 1.0 && m > -(FLAME + 0.25)) continue; }
      dist[n] = dist[k] + 1; prev[n] = k; q.push(n);
    }
  }
  return { dist, prev, s0 };
}
function stepDir(r, target) {
  let k = target; if (k === r.s0) return null;
  while (r.prev[k] !== r.s0 && r.prev[k] >= 0) k = r.prev[k];
  return [k % W - r.s0 % W, ((k / W) | 0) - ((r.s0 / W) | 0)];
}
function nearestSafe(r, D) {
  let best = -1, bd = 1e9;
  for (let k = 0; k < W * H; k++) if (r.dist[k] >= 0 && D[k] === Infinity && r.dist[k] < bd) { bd = r.dist[k]; best = k; }
  return best;
}
function botThink(p, dt) {
  const tx = Math.floor(p.x), ty = Math.floor(p.y), k0 = idx(tx, ty), lvl = S.botLvl;
  p.think -= dt; if (p.think > 0) return p.dir;
  p.think = [0.18, 0.08, 0.03][lvl];
  const D = dangerMap();
  if (D[k0] !== Infinity) { // em perigo: foge
    const r = bfs(p, tx, ty, D, false), s = nearestSafe(r, D);
    return p.dir = s >= 0 ? stepDir(r, s) : null;
  }
  const centered = Math.abs(p.x - tx - 0.5) < 0.18 && Math.abs(p.y - ty - 0.5) < 0.18;
  const enemies = S.players.filter(o => o.alive && o.id !== p.id);
  if (centered && p.active < p.maxBombs && !bombAt(tx, ty) && p.bombCd <= 0 && p.ban !== k0) {
    const tiles = blastTiles(tx, ty, p.range);
    let crates = 0, hitE = false;
    for (const k of tiles) if (S.grid[k] === CRATE && D[k] === Infinity) crates++;
    for (const e of enemies) if (tiles.includes(idx(Math.floor(e.x), Math.floor(e.y)))) hitE = true;
    if (crates > 0 || hitE) {
      const D2 = dangerMap({ x: tx, y: ty, r: p.range, t: FUSE });
      const r2 = bfs(p, tx, ty, D2, false, k0), s = nearestSafe(r2, D2);
      if (s >= 0 && r2.dist[s] <= Math.floor(FUSE * p.speed * 0.7)) {
        placeBomb(p); p.bombCd = [1.1, 0.5, 0.25][lvl];
        return p.dir = stepDir(r2, s);
      }
      p.ban = k0; p.banT = 2;
    }
  }
  const r = bfs(p, tx, ty, D, true);
  let best = -1, bs = -1e9;
  for (let k = 0; k < W * H; k++) {
    if (r.dist[k] < 0 || k === p.ban) continue;
    let sc = -r.dist[k] * 1.1 + p.noise[k] * (lvl === 0 ? 2.5 : 1);
    if (S.items[k] >= 0) sc += 14;
    const x = k % W, y = (k / W) | 0, tiles = blastTiles(x, y, p.range);
    for (const t of tiles) if (S.grid[t] === CRATE && D[t] === Infinity) sc += 4;
    for (const e of enemies) {
      const ex = Math.floor(e.x), ey = Math.floor(e.y);
      if (tiles.includes(idx(ex, ey))) sc += lvl === 0 ? 3 : 8;
      sc += Math.max(0, 3 - (Math.abs(ex - x) + Math.abs(ey - y)) * 0.4) * lvl;
    }
    if (sc > bs) { bs = sc; best = k; }
  }
  if (best < 0) return p.dir = null;
  if (best === k0) { // melhor lugar é aqui: centraliza na casa para poder soltar a bomba
    const ox = tx + 0.5 - p.x, oy = ty + 0.5 - p.y;
    if (Math.abs(ox) > 0.08) return p.dir = [Math.sign(ox), 0];
    if (Math.abs(oy) > 0.08) return p.dir = [0, Math.sign(oy)];
    return p.dir = null;
  }
  return p.dir = stepDir(r, best);
}

/* ---------- passo de simulação ---------- */
function step(state, dt) {
  S = state;
  S.t += dt;
  for (let k = 0; k < W * H; k++) {
    if (S.flame[k] > 0) S.flame[k] = Math.max(0, S.flame[k] - dt);
    if (S.burn[k] > 0) S.burn[k] = Math.max(0, S.burn[k] - dt);
  }
  if (S.phase === 'countdown') {
    const before = Math.ceil(S.phaseT); S.phaseT -= dt; const after = Math.ceil(S.phaseT);
    if (after !== before && S.phaseT > 0) S.events.push('tick');
    if (S.phaseT <= 0) { S.phase = 'play'; S.events.push('go'); }
    for (const p of S.players) p.wantBomb = false;
    return;
  }
  if (S.phase === 'over') return;
  if (S.phase === 'play') S.timer -= dt;

  for (const p of S.players) {
    if (!p.on) continue;
    if (!p.alive) { p.deathT = Math.max(0, p.deathT - dt); continue; }
    p.bombCd -= dt;
    if (p.banT > 0) { p.banT -= dt; if (p.banT <= 0) p.ban = -1; }
    let dir = null;
    if (p.bot) dir = botThink(p, dt);
    else {
      if (p.inputDir && DIRS[p.inputDir]) dir = DIRS[p.inputDir];
      if (p.wantBomb) { placeBomb(p); p.wantBomb = false; }
    }
    if (dir && (dir[0] || dir[1])) { move(p, dir, dt); p.facing = dir; p.walking = true; } else p.walking = false;
  }
  for (const b of S.bombs) b.fuse -= dt;
  for (const b of S.bombs.filter(b => b.fuse <= 0 && !b.done)) explode(b);

  for (const p of S.players) {
    if (!p.alive) continue;
    const k = idx(Math.floor(p.x), Math.floor(p.y));
    if (S.flame[k] > 0) { p.alive = false; p.deathT = 1; S.events.push('die'); continue; }
    const it = S.items[k];
    if (it >= 0) {
      S.items[k] = -1;
      if (it === 0) p.maxBombs = Math.min(8, p.maxBombs + 1);
      else if (it === 1) p.range = Math.min(9, p.range + 1);
      else p.speed = Math.min(6, p.speed + SPEED_STEP);
      S.events.push('pick');
    }
  }
  const alive = S.players.filter(p => p.alive);
  if (S.phase === 'play' && (alive.length <= 1 || S.timer <= 0)) { S.phase = 'ending'; S.phaseT = 1.4; }
  if (S.phase === 'ending') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = 'over';
      const still = S.players.filter(p => p.alive);
      S.result = { winner: still.length === 1 ? still[0].id : null, timeUp: S.timer <= 0 };
    }
  }
}

/* ---------- estado enviado aos navegadores ---------- */
function snapshot(state, roundId) {
  const s = state;
  const flames = [], burns = [];
  for (let k = 0; k < W * H; k++) {
    if (s.flame[k] > 0) flames.push(k, Math.round(s.flame[k] * 100));
    if (s.burn[k] > 0) burns.push(k, Math.round(s.burn[k] * 100));
  }
  const snap = {
    r: roundId, ph: s.phase, pt: Math.round(s.phaseT * 100) / 100, tm: Math.max(0, Math.ceil(s.timer)),
    g: Array.from(s.grid).join(''),
    it: Array.from(s.items, v => (v < 0 ? '.' : v)).join(''),
    f: flames, bu: burns,
    b: s.bombs.map(b => [b.x, b.y, Math.round(b.fuse * 100)]),
    p: s.players.map(p => [
      Math.round(p.x * 100), Math.round(p.y * 100), p.on ? 1 : 0, p.alive ? 1 : 0,
      p.facing[0], p.facing[1], p.walking ? 1 : 0, Math.round(p.deathT * 100),
      p.maxBombs, p.range, Math.round((p.speed - BASE_SPEED) / SPEED_STEP) + 1, p.bot ? 1 : 0,
    ]),
    ev: s.events,
  };
  s.events = [];
  return snap;
}

module.exports = { createRound, step, snapshot, W, H };
