'use strict';

const express = require('express');
const {
  db, getSettings, saveSettings, parseHours, findConflict, newCode, BOOKING_SELECT, priceFor,
} = require('../lib/db');
const auth = require('../lib/auth');
const U = require('../lib/util');
const TR = require('../lib/traducoes');
const { HttpError } = U;

const router = express.Router();
const STATUSES = ['pedido', 'confirmado', 'em_curso', 'concluido', 'cancelado'];

const withTimes = (r) => ({ ...r, start: U.fmtHM(r.start_min), end: U.fmtHM(r.end_min) });
const flag = (v) => (v === false || v === 0 || v === '0' ? 0 : 1);
const idParam = (req) => {
  const id = U.toInt(req.params.id);
  if (!id) throw new HttpError(400, 'Identificador inválido.');
  return id;
};

// ------------------------------------------------------------ Âmbito por estúdio
// Um agente está preso ao seu estúdio (req.user.studio_id); vê e mexe apenas no
// que lhe pertence. Proprietário e equipa sem estúdio devolvem null = veem tudo.
const scopeStudio = (req) => req.user.studio_id || null;
const roomStudio = (roomId) => {
  const r = db.prepare('SELECT studio_id FROM rooms WHERE id=?').get(U.toInt(roomId));
  return r ? r.studio_id : null;
};
// Recurso já existente fora do estúdio do agente: faz de conta que não existe.
function assertInScope(req, roomId) {
  const scope = scopeStudio(req);
  if (scope && roomStudio(roomId) !== scope) throw new HttpError(404, 'Não encontrado.');
}
// Sala escolhida num formulário fora do estúdio do agente: recusa com clareza.
function assertRoomInScope(req, roomId) {
  const scope = scopeStudio(req);
  if (scope && roomStudio(roomId) !== scope) throw new HttpError(403, 'Essa sala não pertence ao seu estúdio.');
}

// ------------------------------------------------------------ Marcações

function normalizeBooking(b) {
  const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(U.toInt(b.room_id));
  if (!room) throw new HttpError(400, 'Escolha uma sala.');
  const date = String(b.date || '');
  if (!U.isValidDate(date)) throw new HttpError(400, 'Data inválida.');
  const start = U.parseHM(String(b.start || ''));
  const end = U.parseHM(String(b.end || ''));
  if (start == null || end == null) throw new HttpError(400, 'Hora inválida.');
  if (end <= start) throw new HttpError(400, 'A hora de fim tem de ser depois da hora de início.');
  const client_name = U.clean(b.client_name, 80);
  if (!client_name) throw new HttpError(400, 'Indique o nome do cliente.');
  const client_email = U.clean(b.client_email, 120);
  if (client_email && !U.isEmail(client_email)) throw new HttpError(400, 'O email não parece válido.');
  const status = String(b.status || 'confirmado');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Estado inválido.');
  let service_id = null;
  if (b.service_id) {
    if (!db.prepare('SELECT 1 FROM services WHERE id=?').get(U.toInt(b.service_id))) throw new HttpError(400, 'Serviço inválido.');
    service_id = U.toInt(b.service_id);
  }
  // Só faz sentido dispensar a presença em serviços marcados para isso.
  let remote = 0;
  if (b.remote && service_id) {
    const sv = db.prepare('SELECT name, remote_ok FROM services WHERE id=?').get(service_id);
    if (!sv.remote_ok) throw new HttpError(400, `O serviço "${sv.name}" tem de ser feito no estúdio.`);
    remote = 1;
  }
  const blankPrice = b.price === '' || b.price == null;
  return {
    room, room_id: room.id, service_id, date, start, end, status, remote,
    title: U.clean(b.title, 120), style: U.clean(b.style, 60),
    client_name, client_phone: U.clean(b.client_phone, 30), client_email,
    notes: U.clean(b.notes, 1000), internal_notes: U.clean(b.internal_notes, 2000),
    price: blankPrice ? priceFor(room, start, end) : Math.max(0, U.toInt(b.price)),
    paid: Math.max(0, U.toInt(b.paid)),
  };
}

function assertNoConflict(n, excludeId = 0) {
  if (n.status === 'cancelado') return;
  const c = findConflict(n.room_id, n.date, n.start, n.end, excludeId);
  if (!c) return;
  if (c.type === 'booking') throw new HttpError(409, `Já existe a marcação ${c.code} nessa sala e horário.`);
  throw new HttpError(409, `A sala está bloqueada nesse horário${c.reason ? ' (' + c.reason + ')' : ''}.`);
}

router.get('/bookings', (req, res) => {
  const q = req.query;
  const where = [];
  const args = [];
  if (q.from && U.isValidDate(String(q.from))) { where.push('b.date>=?'); args.push(q.from); }
  if (q.to && U.isValidDate(String(q.to))) { where.push('b.date<=?'); args.push(q.to); }
  if (q.status) {
    const list = String(q.status).split(',').filter((s) => STATUSES.includes(s));
    if (list.length) { where.push(`b.status IN (${list.map(() => '?').join(',')})`); args.push(...list); }
  }
  if (q.studio_id) { where.push('r.studio_id=?'); args.push(U.toInt(q.studio_id)); }
  if (q.room_id) { where.push('b.room_id=?'); args.push(U.toInt(q.room_id)); }
  const scope = scopeStudio(req);
  if (scope) { where.push('r.studio_id=?'); args.push(scope); }
  if (q.q) {
    const like = '%' + U.clean(String(q.q), 60).replace(/[%_\\]/g, '\\$&') + '%';
    where.push("(b.client_name LIKE ? ESCAPE '\\' OR b.client_phone LIKE ? ESCAPE '\\' OR b.title LIKE ? ESCAPE '\\' OR b.code LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const order = q.order === 'desc' ? 'b.date DESC, b.start_min DESC' : 'b.date ASC, b.start_min ASC';
  const sql = `${BOOKING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`;
  res.json({ bookings: db.prepare(sql).all(...args).map(withTimes) });
});

router.get('/bookings/:id', (req, res) => {
  const row = db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(idParam(req));
  if (!row) throw new HttpError(404, 'Marcação não encontrada.');
  const scope = scopeStudio(req);
  if (scope && row.studio_id !== scope) throw new HttpError(404, 'Marcação não encontrada.');
  res.json({ booking: withTimes(row) });
});

router.post('/bookings', (req, res) => {
  const n = normalizeBooking(req.body || {});
  assertRoomInScope(req, n.room_id);
  const now = new Date().toISOString();
  const id = db.transaction(() => {
    assertNoConflict(n);
    return db.prepare(
      `INSERT INTO bookings(code,room_id,service_id,title,style,date,start_min,end_min,client_name,client_phone,
                            client_email,notes,internal_notes,status,remote,price,paid,source,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'admin',?,?)`
    ).run(newCode(), n.room_id, n.service_id, n.title, n.style, n.date, n.start, n.end, n.client_name, n.client_phone,
      n.client_email, n.notes, n.internal_notes, n.status, n.remote, n.price, n.paid, now, now).lastInsertRowid;
  })();
  res.status(201).json({ booking: withTimes(db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(id)) });
});

router.put('/bookings/:id', (req, res) => {
  const id = idParam(req);
  const existing = db.prepare('SELECT room_id FROM bookings WHERE id=?').get(id);
  if (!existing) throw new HttpError(404, 'Marcação não encontrada.');
  assertInScope(req, existing.room_id);        // tem de ser do estúdio do agente
  const n = normalizeBooking(req.body || {});
  assertRoomInScope(req, n.room_id);            // e não pode movê-la para fora dele
  db.transaction(() => {
    assertNoConflict(n, id);
    db.prepare(
      `UPDATE bookings SET room_id=?, service_id=?, title=?, style=?, date=?, start_min=?, end_min=?, client_name=?,
              client_phone=?, client_email=?, notes=?, internal_notes=?, status=?, remote=?, price=?, paid=?, updated_at=?
        WHERE id=?`
    ).run(n.room_id, n.service_id, n.title, n.style, n.date, n.start, n.end, n.client_name, n.client_phone,
      n.client_email, n.notes, n.internal_notes, n.status, n.remote, n.price, n.paid, new Date().toISOString(), id);
  })();
  res.json({ booking: withTimes(db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(id)) });
});

// Mudança rápida de estado (botões Confirmar / Recusar).
router.patch('/bookings/:id/status', (req, res) => {
  const id = idParam(req);
  const status = String((req.body || {}).status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Estado inválido.');
  const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Marcação não encontrada.');
  assertInScope(req, row.room_id);
  db.transaction(() => {
    assertNoConflict({ status, room_id: row.room_id, date: row.date, start: row.start_min, end: row.end_min }, id);
    db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
  })();
  res.json({ booking: withTimes(db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(id)) });
});

router.delete('/bookings/:id', (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT room_id FROM bookings WHERE id=?').get(id);
  if (row) assertInScope(req, row.room_id);
  db.prepare('DELETE FROM bookings WHERE id=?').run(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ Painel

router.get('/pending-count', (req, res) => {
  const scope = scopeStudio(req);
  const sql = "SELECT COUNT(*) n FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.status='pedido'"
    + (scope ? ' AND r.studio_id=' + scope : '');
  res.json({ pending: db.prepare(sql).get().n });
});

router.get('/dashboard', (req, res) => {
  const now = U.nowLocal();
  // O agente vê sempre só o seu estúdio; o filtro do painel não o liberta disso.
  const studioId = scopeStudio(req) || U.toInt(req.query.studio_id);
  const sf = studioId ? ' AND r.studio_id=' + studioId : '';
  const base = 'FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE 1=1' + sf;
  const monthStart = now.date.slice(0, 8) + '01';
  const monthEnd = now.date.slice(0, 8) + '31';
  const n = (sql, ...a) => db.prepare(sql).get(...a);

  const counts = {
    pending: n(`SELECT COUNT(*) v ${base} AND b.status='pedido'`).v,
    today: n(`SELECT COUNT(*) v ${base} AND b.date=? AND b.status!='cancelado'`, now.date).v,
    next7: n(`SELECT COUNT(*) v ${base} AND b.date>? AND b.date<=? AND b.status!='cancelado'`, now.date, U.addDays(now.date, 7)).v,
  };
  const money = {
    received_month: n(`SELECT COALESCE(SUM(b.paid),0) v ${base} AND b.date>=? AND b.date<=? AND b.status!='cancelado'`, monthStart, monthEnd).v,
    outstanding: n(`SELECT COALESCE(SUM(b.price-b.paid),0) v ${base} AND b.status IN ('confirmado','em_curso','concluido') AND b.price>b.paid`).v,
  };
  const pending = db.prepare(`${BOOKING_SELECT} WHERE b.status='pedido'${studioId ? ' AND r.studio_id=' + studioId : ''}
                              ORDER BY b.date, b.start_min LIMIT 12`).all().map(withTimes);
  const today = db.prepare(`${BOOKING_SELECT} WHERE b.date=? AND b.status!='cancelado'${studioId ? ' AND r.studio_id=' + studioId : ''}
                            ORDER BY b.start_min`).all(now.date).map(withTimes);
  res.json({ today: now.date, counts, money, pending, todayList: today });
});

// ------------------------------------------------------------ Calendário

router.get('/calendar', (req, res) => {
  const date = String(req.query.date || U.nowLocal().date);
  if (!U.isValidDate(date)) throw new HttpError(400, 'Data inválida.');
  const studioId = scopeStudio(req) || U.toInt(req.query.studio_id);
  const studios = db.prepare('SELECT * FROM studios WHERE active=1' + (studioId ? ' AND id=' + studioId : '') + ' ORDER BY sort, id').all();
  const rooms = db.prepare('SELECT * FROM rooms WHERE active=1 ORDER BY sort, id').all();
  const dow = U.weekday(date);
  const out = studios.map((st) => {
    const h = parseHours(st.hours)[dow];
    const open = h ? U.parseHM(h.open) : null;
    const close = h ? U.parseHM(h.close) : null;
    return {
      id: st.id, name: st.name,
      open: open != null && close != null && close > open ? open : null,
      close: open != null && close != null && close > open ? close : null,
      rooms: rooms.filter((r) => r.studio_id === st.id).map((r) => ({ id: r.id, name: r.name })),
    };
  }).filter((st) => st.rooms.length);
  const ids = new Set(out.flatMap((s) => s.rooms.map((r) => r.id)));
  const bookings = db.prepare(BOOKING_SELECT + " WHERE b.date=? AND b.status!='cancelado' ORDER BY b.start_min").all(date)
    .filter((b) => ids.has(b.room_id)).map(withTimes);
  const blocks = db.prepare('SELECT * FROM blocks WHERE date=?').all(date)
    .filter((k) => ids.has(k.room_id)).map((k) => ({ ...k, start: U.fmtHM(k.start_min), end: U.fmtHM(k.end_min) }));
  res.json({ date, studios: out, bookings, blocks });
});

router.post('/blocks', (req, res) => {
  const b = req.body || {};
  const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(U.toInt(b.room_id));
  if (!room) throw new HttpError(400, 'Escolha uma sala.');
  assertRoomInScope(req, room.id);
  const date = String(b.date || '');
  if (!U.isValidDate(date)) throw new HttpError(400, 'Data inválida.');
  const start = U.parseHM(String(b.start || ''));
  const end = U.parseHM(String(b.end || ''));
  if (start == null || end == null || end <= start) throw new HttpError(400, 'Indique um intervalo de horas válido.');
  const c = findConflict(room.id, date, start, end);
  if (c && c.type === 'booking') throw new HttpError(409, `Já existe a marcação ${c.code} nesse horário. Cancele-a primeiro.`);
  const id = db.prepare('INSERT INTO blocks(room_id,date,start_min,end_min,reason) VALUES(?,?,?,?,?)')
    .run(room.id, date, start, end, U.clean(b.reason, 120)).lastInsertRowid;
  res.status(201).json({ id });
});

router.delete('/blocks/:id', (req, res) => {
  const id = idParam(req);
  const blk = db.prepare('SELECT room_id FROM blocks WHERE id=?').get(id);
  if (blk) assertInScope(req, blk.room_id);
  db.prepare('DELETE FROM blocks WHERE id=?').run(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ Estúdios e salas

function normalizeHours(h) {
  if (!Array.isArray(h) || h.length !== 7) throw new HttpError(400, 'Horário inválido.');
  return h.map((d, i) => {
    if (!d) return null;
    const o = U.parseHM(String(d.open || '')), c = U.parseHM(String(d.close || ''));
    if (o == null || c == null || c <= o) {
      throw new HttpError(400, 'Horário inválido: a hora de fecho tem de ser depois da abertura.');
    }
    return { open: U.fmtHM(o), close: U.fmtHM(c) };
  });
}

// Coordenada do estúdio. Vazia, em branco ou fora do intervalo fica a null:
// sem coordenadas o globo do formulário não voa para lado nenhum, e é melhor
// isso do que apontar para o meio do oceano.
function coord(v, limite) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limite ? n : null;
}

// As traduções que chegam do painel, limpas e prontas a gravar. null quando o
// pedido não as traz, para o UPDATE deixar ficar as que já havia.
function traducoes(b, campos) {
  return b.traducoes === undefined ? null : JSON.stringify(TR.limpar(b.traducoes, campos));
}

function studioBody(b) {
  const name = U.clean(b.name, 80);
  if (!name) throw new HttpError(400, 'Indique o nome do estúdio.');
  return {
    name, city: U.clean(b.city, 60), address: U.clean(b.address, 160), phone: U.clean(b.phone, 30),
    lat: coord(b.lat, 90), lon: coord(b.lon, 180),
    description: U.clean(b.description, 400), hours: JSON.stringify(normalizeHours(b.hours)), active: flag(b.active),
    traducoes: traducoes(b, TR.CAMPOS.studios),
    sort: U.toInt(b.sort),
  };
}

router.get('/studios', (req, res) => {
  const scope = scopeStudio(req);
  const studios = db.prepare('SELECT * FROM studios' + (scope ? ' WHERE id=' + scope : '') + ' ORDER BY sort, id').all();
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all();
  const counts = Object.fromEntries(
    db.prepare('SELECT room_id, COUNT(*) n FROM bookings GROUP BY room_id').all().map((r) => [r.room_id, r.n])
  );
  res.json({
    studios: studios.map((s) => ({
      ...s, hours: parseHours(s.hours),
      rooms: rooms.filter((r) => r.studio_id === s.id).map((r) => ({ ...r, bookings: counts[r.id] || 0 })),
    })),
  });
});

router.post('/studios', auth.requireManager, (req, res) => {
  const b = studioBody(req.body || {});
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM studios').get().m;
  const id = db.prepare(`INSERT INTO studios(name,city,address,phone,description,hours,lat,lon,traducoes,active,sort) VALUES(?,?,?,?,?,?,?,?,COALESCE(?, '{}'),?,?)`)
    .run(b.name, b.city, b.address, b.phone, b.description, b.hours, b.lat, b.lon, b.traducoes, b.active, max + 1).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/studios/:id', auth.requireManager, (req, res) => {
  const id = idParam(req);
  const b = studioBody(req.body || {});
  const info = db.prepare('UPDATE studios SET name=?, city=?, address=?, phone=?, description=?, hours=?, lat=?, lon=?, traducoes=COALESCE(?, traducoes), active=? WHERE id=?')
    .run(b.name, b.city, b.address, b.phone, b.description, b.hours, b.lat, b.lon, b.traducoes, b.active, id);
  if (!info.changes) throw new HttpError(404, 'Estúdio não encontrado.');
  res.json({ ok: true });
});

router.delete('/studios/:id', auth.requireManager, (req, res) => {
  const id = idParam(req);
  const used = db.prepare('SELECT COUNT(*) n FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE r.studio_id=?').get(id).n;
  if (used) throw new HttpError(409, 'Este estúdio tem marcações. Desative-o em vez de o eliminar.');
  db.prepare('DELETE FROM studios WHERE id=?').run(id);
  res.json({ ok: true });
});

function roomBody(b) {
  const name = U.clean(b.name, 80);
  if (!name) throw new HttpError(400, 'Indique o nome da sala.');
  return {
    name, description: U.clean(b.description, 300), hourly_rate: Math.max(0, U.toInt(b.hourly_rate)), active: flag(b.active),
    traducoes: traducoes(b, TR.CAMPOS.rooms),
  };
}

router.post('/rooms', auth.requireManager, (req, res) => {
  const studioId = U.toInt((req.body || {}).studio_id);
  if (!db.prepare('SELECT 1 FROM studios WHERE id=?').get(studioId)) throw new HttpError(400, 'Estúdio inválido.');
  const b = roomBody(req.body || {});
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM rooms WHERE studio_id=?').get(studioId).m;
  const id = db.prepare(`INSERT INTO rooms(studio_id,name,description,hourly_rate,traducoes,active,sort) VALUES(?,?,?,?,COALESCE(?, '{}'),?,?)`)
    .run(studioId, b.name, b.description, b.hourly_rate, b.traducoes, b.active, max + 1).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/rooms/:id', auth.requireManager, (req, res) => {
  const b = roomBody(req.body || {});
  const info = db.prepare('UPDATE rooms SET name=?, description=?, hourly_rate=?, traducoes=COALESCE(?, traducoes), active=? WHERE id=?')
    .run(b.name, b.description, b.hourly_rate, b.traducoes, b.active, idParam(req));
  if (!info.changes) throw new HttpError(404, 'Sala não encontrada.');
  res.json({ ok: true });
});

router.delete('/rooms/:id', auth.requireManager, (req, res) => {
  const id = idParam(req);
  if (db.prepare('SELECT COUNT(*) n FROM bookings WHERE room_id=?').get(id).n) {
    throw new HttpError(409, 'Esta sala tem marcações. Desative-a em vez de a eliminar.');
  }
  db.prepare('DELETE FROM rooms WHERE id=?').run(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------ Serviços

function serviceBody(b) {
  const name = U.clean(b.name, 80);
  if (!name) throw new HttpError(400, 'Indique o nome do serviço.');
  return {
    name, description: U.clean(b.description, 300), remote_ok: flag(b.remote_ok), active: flag(b.active),
    traducoes: traducoes(b, TR.CAMPOS.services),
  };
}

router.get('/services', (_req, res) => {
  res.json({ services: db.prepare('SELECT * FROM services ORDER BY sort, id').all() });
});

router.post('/services', auth.requireManager, (req, res) => {
  const b = serviceBody(req.body || {});
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM services').get().m;
  const id = db.prepare(`INSERT INTO services(name,description,remote_ok,traducoes,active,sort) VALUES(?,?,?,COALESCE(?, '{}'),?,?)`)
    .run(b.name, b.description, b.remote_ok, b.traducoes, b.active, max + 1).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/services/:id', auth.requireManager, (req, res) => {
  const b = serviceBody(req.body || {});
  const info = db.prepare('UPDATE services SET name=?, description=?, remote_ok=?, traducoes=COALESCE(?, traducoes), active=? WHERE id=?')
    .run(b.name, b.description, b.remote_ok, b.traducoes, b.active, idParam(req));
  if (!info.changes) throw new HttpError(404, 'Serviço não encontrado.');
  res.json({ ok: true });
});

router.delete('/services/:id', auth.requireManager, (req, res) => {
  db.prepare('DELETE FROM services WHERE id=?').run(idParam(req));
  res.json({ ok: true });
});

// ------------------------------------------------------------ Clientes

router.get('/clients', (req, res) => {
  const scope = scopeStudio(req);
  const rows = db.prepare(
    'SELECT b.client_name, b.client_phone, b.client_email, b.date, b.paid, b.price FROM bookings b'
    + (scope ? ' JOIN rooms r ON r.id=b.room_id' : '')
    + " WHERE b.status!='cancelado'" + (scope ? ' AND r.studio_id=' + scope : '') + ' ORDER BY b.date'
  ).all();
  const map = new Map();
  for (const r of rows) {
    const key = U.digits(r.client_phone).slice(-7) || 'n:' + r.client_name.toLowerCase();
    const c = map.get(key) || { name: r.client_name, phone: r.client_phone, email: r.client_email, sessions: 0, paid: 0, price: 0, last: '' };
    c.name = r.client_name; // fica com o nome mais recente
    if (r.client_phone) c.phone = r.client_phone;
    if (r.client_email) c.email = r.client_email;
    c.sessions++; c.paid += r.paid; c.price += r.price;
    if (r.date > c.last) c.last = r.date;
    map.set(key, c);
  }
  res.json({ clients: [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1)) });
});

// ------------------------------------------------------------ Definições

router.get('/settings', (_req, res) => res.json({ settings: getSettings() }));

router.put('/settings', auth.requireOwner, (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.business_name, 80);
  if (!name) throw new HttpError(400, 'Indique o nome do negócio.');
  const slot = U.toInt(b.slot_minutes);
  if (![15, 30, 60, 90, 120].includes(slot)) throw new HttpError(400, 'Duração do bloco inválida.');
  const min = U.toInt(b.min_minutes), max = U.toInt(b.max_minutes);
  if (min < 15 || max < min || max > 1440) throw new HttpError(400, 'A duração máxima tem de ser maior ou igual à mínima.');
  const lead = U.toInt(b.lead_hours), adv = U.toInt(b.max_advance_days);
  if (lead < 0 || lead > 720) throw new HttpError(400, 'Antecedência mínima inválida.');
  if (adv < 1 || adv > 730) throw new HttpError(400, 'Antecedência máxima inválida.');
  // Os endereços das redes vão parar a um href no rodapé: só se aceita http(s).
  const rede = (v, nome) => {
    const s = U.clean(v, 200);
    if (!s) return '';
    let u;
    try { u = new URL(s); } catch (_) { throw new HttpError(400, 'Endereço de ' + nome + ' inválido.'); }
    if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'Endereço de ' + nome + ' inválido.');
    return u.href;
  };
  saveSettings({
    business_name: name, tagline: U.clean(b.tagline, 160),
    phone: U.clean(b.phone, 30), whatsapp: U.clean(b.whatsapp, 30), email: U.clean(b.email, 120),
    instagram: rede(b.instagram, 'Instagram'),
    spotify: rede(b.spotify, 'Spotify'), youtube: rede(b.youtube, 'YouTube'),
    currency: U.clean(b.currency, 8) || 'CVE', country_code: U.digits(b.country_code).slice(0, 4),
    slot_minutes: slot, min_minutes: min, max_minutes: max, lead_hours: lead, max_advance_days: adv,
    auto_confirm: !!b.auto_confirm, terms: U.clean(b.terms, 500),
    // Sem traduções no pedido (um cliente antigo do painel), ficam as que havia.
    ...(b.traducoes === undefined ? {} : { traducoes: TR.limpar(b.traducoes, TR.CAMPOS.settings) }),
  });
  res.json({ settings: getSettings() });
});

// ------------------------------------------------------------ Utilizadores (só proprietário)

const activeOwners = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1").get().n;

// O perfil que chega do painel pode ser 'owner', 'staff' ou 'agent'. Na base há
// só 'owner'/'staff'; o agente é equipa presa a um estúdio (studio_id). Daqui
// sai o que se grava: o papel e o estúdio (ou null).
function roleAndStudio(b) {
  if (b.role === 'owner') return { role: 'owner', studio_id: null };
  if (b.role === 'agent') {
    const sid = U.toInt(b.studio_id);
    if (!sid || !db.prepare('SELECT 1 FROM studios WHERE id=?').get(sid)) throw new HttpError(400, 'Escolha o estúdio do agente.');
    return { role: 'staff', studio_id: sid };
  }
  return { role: 'staff', studio_id: null };
}

// O que o painel mostra: 'agent' quando está preso a um estúdio.
const shownRole = (u) => (u.studio_id ? 'agent' : u.role);

router.get('/users', auth.requireOwner, (_req, res) => {
  const rows = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, u.studio_id, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON s.id = u.studio_id ORDER BY u.id`
  ).all();
  res.json({ users: rows.map((u) => ({ ...u, role: shownRole(u) })) });
});

router.post('/users', auth.requireOwner, (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.name, 80);
  const email = U.clean(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  const { role, studio_id } = roleAndStudio(b);
  if (!name) throw new HttpError(400, 'Indique o nome.');
  if (!U.isEmail(email)) throw new HttpError(400, 'Indique um email válido.');
  if (password.length < 8) throw new HttpError(400, 'A palavra-passe deve ter pelo menos 8 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Já existe um utilizador com esse email.');
  const id = db.prepare('INSERT INTO users(name,email,password_hash,role,studio_id,created_at) VALUES(?,?,?,?,?,?)')
    .run(name, email, auth.hashPassword(password), role, studio_id, new Date().toISOString()).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/users/:id', auth.requireOwner, (req, res) => {
  const id = idParam(req);
  const b = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) throw new HttpError(404, 'Utilizador não encontrado.');
  const { role, studio_id } = roleAndStudio(b);
  const active = flag(b.active);
  const losesOwner = user.role === 'owner' && user.active && (role !== 'owner' || !active);
  if (losesOwner && activeOwners() <= 1) throw new HttpError(400, 'Tem de existir pelo menos um proprietário ativo.');
  if (id === req.user.id && !active) throw new HttpError(400, 'Não pode desativar a sua própria conta.');
  const name = U.clean(b.name, 80) || user.name;
  db.prepare('UPDATE users SET name=?, role=?, studio_id=?, active=? WHERE id=?').run(name, role, studio_id, active, id);
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, 'A palavra-passe deve ter pelo menos 8 caracteres.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(String(b.password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.json({ ok: true });
});

router.delete('/users/:id', auth.requireOwner, (req, res) => {
  const id = idParam(req);
  if (id === req.user.id) throw new HttpError(400, 'Não pode eliminar a sua própria conta.');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (user && user.role === 'owner' && user.active && activeOwners() <= 1) {
    throw new HttpError(400, 'Tem de existir pelo menos um proprietário ativo.');
  }
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Coordenadas
// Procura um sítio pelo nome e devolve onde fica, para preencher a latitude e
// a longitude de um estúdio. Quem usa é o OpenStreetMap, que não pede chave
// nem cobra nada.
//
// A política de uso deles pede parcimónia: no máximo um pedido por segundo e
// que nos identifiquemos. Por isso isto só corre com sessão iniciada (está sob
// /api/admin) e só quando alguém carrega no botão — nunca sozinho.
//
// GEOCODER_URL aponta para outro servidor compatível (uma instância própria,
// por exemplo); GEOCODER=off desliga a procura, para quem não tenha saída
// para a internet. Nesses casos escrevem-se as coordenadas à mão, ou cola-se
// o link do Google Maps, que não precisa de rede nenhuma.
const GEOCODER = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
let ultimaProcura = 0;

router.post('/geocode', auth.requireManager, async (req, res) => {
  if (process.env.GEOCODER === 'off') {
    throw new HttpError(503, 'A procura automática está desligada. Escreva as coordenadas ou cole o link do Google Maps.');
  }
  const q = U.clean((req.body || {}).q, 200);
  if (q.length < 3) throw new HttpError(400, 'Escreva a morada ou a cidade a procurar.');

  // Um pedido por segundo, como a política do serviço pede.
  const esperar = 1100 - (Date.now() - ultimaProcura);
  if (esperar > 0) await new Promise((r) => setTimeout(r, esperar));
  ultimaProcura = Date.now();

  let lista;
  try {
    const url = `${GEOCODER}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        // Identificação, como o serviço pede a quem o usa.
        'User-Agent': `studio-booking (${getSettings().business_name || 'estudio'})`,
        'Accept-Language': 'pt,en',
      },
    });
    if (!resposta.ok) throw new Error('resposta ' + resposta.status);
    lista = await resposta.json();
  } catch (_) {
    throw new HttpError(502, 'Não foi possível falar com o serviço de mapas. Tente outra vez, ou escreva as coordenadas à mão.');
  }

  const sitio = Array.isArray(lista) ? lista[0] : null;
  const lat = sitio && Number(sitio.lat);
  const lon = sitio && Number(sitio.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(404, 'Não encontrámos esse sítio. Experimente escrever a cidade e o país.');
  }
  res.json({ lat, lon, nome: String(sitio.display_name || '').slice(0, 200) });
});

module.exports = router;
