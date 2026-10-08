'use strict';

const express = require('express');
const {
  db, getSettings, hoursFor, parseHours, findConflict, busyIntervals,
  newCode, BOOKING_SELECT, priceFor,
} = require('../lib/db');
const U = require('../lib/util');
const TR = require('../lib/traducoes');
const { HttpError } = U;
const { rateLimit } = require('../lib/ratelimit');
const { requireClient } = require('../lib/conta-auth');

const router = express.Router();

const bookingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12 });
const lookupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });

function businessInfo(s) {
  return {
    name: s.business_name, tagline: s.tagline, phone: s.phone, whatsapp: s.whatsapp,
    email: s.email, instagram: s.instagram, spotify: s.spotify, youtube: s.youtube,
    currency: s.currency, country_code: s.country_code, terms: s.terms, i18n: s.traducoes,
  };
}

function rulesInfo(s) {
  return {
    slot_minutes: s.slot_minutes, min_minutes: s.min_minutes, max_minutes: s.max_minutes,
    lead_hours: s.lead_hours, max_advance_days: s.max_advance_days, auto_confirm: s.auto_confirm,
  };
}

function publicBooking(b) {
  return {
    code: b.code, status: b.status, date: b.date,
    start: U.fmtHM(b.start_min), end: U.fmtHM(b.end_min),
    studio_name: b.studio_name, room_name: b.room_name, service_name: b.service_name || '',
    title: b.title, style: b.style || '', price: b.price, paid: b.paid, client_name: b.client_name, remote: !!b.remote,
    i18n: TR.juntar([
      [b.studio_tr, { name: 'studio_name' }], [b.room_tr, { name: 'room_name' }], [b.service_tr, { name: 'service_name' }],
    ]),
  };
}

// Disponibilidade de uma sala num dia, célula a célula.
function dayAvailability(room, studio, date, s) {
  const now = U.nowLocal();
  const base = { date, slot: s.slot_minutes, closed: false, cells: [], busy: [] };
  if (date < now.date) return { ...base, closed: true, reason: 'past' };
  const ahead = U.daysBetween(now.date, date);
  if (ahead > s.max_advance_days) return { ...base, closed: true, reason: 'too_far' };
  const hrs = hoursFor(studio, date);
  if (!hrs) return { ...base, closed: true, reason: 'closed' };

  const busy = busyIntervals(room.id, date);
  const cells = [];
  for (let start = hrs.open; start + s.slot_minutes <= hrs.close; start += s.slot_minutes) {
    const end = start + s.slot_minutes;
    const taken = busy.some((b) => b.s < end && b.e > start);
    const tooSoon = ahead * 1440 + start < now.minutes + s.lead_hours * 60;
    cells.push({ start, free: !taken && !tooSoon, reason: taken ? 'busy' : tooSoon ? 'soon' : null });
  }
  return { ...base, open: hrs.open, close: hrs.close, cells, busy: busy.map((b) => [b.s, b.e]) };
}

function getRoomWithStudio(roomId) {
  return db.prepare(
    `SELECT r.*, s.hours AS studio_hours, s.name AS studio_name, s.active AS studio_active
       FROM rooms r JOIN studios s ON s.id = r.studio_id WHERE r.id = ?`
  ).get(roomId);
}

router.get('/config', (_req, res) => {
  const s = getSettings();
  const studios = db.prepare('SELECT * FROM studios WHERE active=1 ORDER BY sort, id').all();
  const rooms = db.prepare('SELECT * FROM rooms WHERE active=1 ORDER BY sort, id').all();
  const out = studios
    .map((st) => ({
      id: st.id, name: st.name, city: st.city, address: st.address, phone: st.phone,
      description: st.description, hours: parseHours(st.hours),
      lat: st.lat, lon: st.lon, i18n: TR.ler(st.traducoes),
      rooms: rooms.filter((r) => r.studio_id === st.id)
        .map((r) => ({ id: r.id, name: r.name, description: r.description, hourly_rate: r.hourly_rate, i18n: TR.ler(r.traducoes) })),
    }))
    .filter((st) => st.rooms.length > 0);
  const services = db.prepare('SELECT id, name, description, remote_ok, traducoes FROM services WHERE active=1 ORDER BY sort, id').all()
    .map(({ traducoes, ...sv }) => ({ ...sv, i18n: TR.ler(traducoes) }));
  res.json({ business: businessInfo(s), rules: rulesInfo(s), studios: out, services, today: U.nowLocal().date });
});

router.get('/availability', (req, res) => {
  const roomId = U.toInt(req.query.room_id);
  const date = String(req.query.date || '');
  if (!U.isValidDate(date)) throw new HttpError(400, req.t('api.dataInvalida'));
  const room = getRoomWithStudio(roomId);
  if (!room || !room.active || !room.studio_active) throw new HttpError(404, req.t('api.salaNaoEncontrada'));
  const out = dayAvailability(room, { hours: room.studio_hours }, date, getSettings());
  res.json({ ...out, hourly_rate: room.hourly_rate });
});

// Quadro "Hoje": ocupação de todas as salas ativas no dia de hoje.
router.get('/today', (_req, res) => {
  const now = U.nowLocal();
  const rows = db.prepare(
    `SELECT r.id AS room_id, r.name AS room_name, s.id AS studio_id, s.name AS studio_name, s.hours,
            r.traducoes AS room_tr, s.traducoes AS studio_tr
       FROM rooms r JOIN studios s ON s.id = r.studio_id
      WHERE r.active=1 AND s.active=1 ORDER BY s.sort, s.id, r.sort, r.id`
  ).all().map((r) => {
    const hrs = hoursFor(r, now.date);
    return {
      room_id: r.room_id, room_name: r.room_name, studio_id: r.studio_id, studio_name: r.studio_name,
      closed: !hrs, open: hrs ? hrs.open : null, close: hrs ? hrs.close : null,
      busy: hrs ? busyIntervals(r.room_id, now.date).map((b) => [b.s, b.e]) : [],
      i18n: TR.juntar([[r.studio_tr, { name: 'studio_name' }], [r.room_tr, { name: 'room_name' }]]),
    };
  });
  res.json({ date: now.date, now: now.minutes, rows });
});

router.post('/bookings', requireClient, bookingLimiter, (req, res) => {
  const b = req.body || {};
  // Campo isco: os robôs preenchem, as pessoas não veem.
  if (b.website) return res.json({ ok: true, booking: { code: 'XXXXXX', status: 'pedido' } });

  const s = getSettings();
  const room = getRoomWithStudio(U.toInt(b.room_id));
  if (!room || !room.active || !room.studio_active) throw new HttpError(400, req.t('api.salaValida'));

  const date = String(b.date || '');
  if (!U.isValidDate(date)) throw new HttpError(400, req.t('api.dataValida'));
  const start = U.parseHM(String(b.start || ''));
  const duration = U.toInt(b.duration_minutes);
  if (start == null || duration <= 0) throw new HttpError(400, req.t('api.horaDuracao'));
  const end = start + duration;

  const minDur = Math.ceil(s.min_minutes / s.slot_minutes) * s.slot_minutes;
  if (duration % s.slot_minutes !== 0 || duration < minDur || duration > s.max_minutes) {
    throw new HttpError(400, req.t('api.duracaoInvalida'));
  }

  const avail = dayAvailability(room, { hours: room.studio_hours }, date, s);
  if (avail.closed) {
    const why = { past: 'api.dataPassada', too_far: 'api.dataLonge', closed: 'api.estudioFechado' };
    throw new HttpError(400, req.t(why[avail.reason] || 'api.dataIndisponivel'));
  }
  if ((start - avail.open) % s.slot_minutes !== 0 || start < avail.open || end > avail.close) {
    throw new HttpError(400, req.t('api.foraHorario'));
  }
  // Todas as células da sessão têm de estar livres (inclui antecedência mínima).
  for (let t = start; t < end; t += s.slot_minutes) {
    const cell = avail.cells.find((c) => c.start === t);
    if (!cell || !cell.free) throw new HttpError(409, req.t('api.horarioOcupado'));
  }

  // Os dados de contacto vêm da conta, já validados no registo: o cliente não
  // os reescreve a cada marcação e ficam sempre certos para o estúdio.
  const name = req.client.name;
  const phone = req.client.phone;
  const email = req.client.email;

  let serviceId = null;
  let remote = false;
  if (b.service_id) {
    const sv = db.prepare('SELECT id, name, remote_ok, traducoes FROM services WHERE id=? AND active=1').get(U.toInt(b.service_id));
    if (!sv) throw new HttpError(400, req.t('api.servicoInvalido'));
    serviceId = sv.id;
    if (b.remote) {
      if (!sv.remote_ok) {
        throw new HttpError(400, req.t('api.servicoPresencial', { servico: TR.local(sv.name, sv.traducoes, req.lingua, 'name') }));
      }
      remote = true;
    }
  } else if (b.remote) {
    throw new HttpError(400, req.t('api.servicoParaDistancia'));
  }

  const now = new Date().toISOString();
  const status = s.auto_confirm ? 'confirmado' : 'pedido';

  const create = db.transaction(() => {
    // Verificação final dentro da transação, imediatamente antes de gravar.
    if (findConflict(room.id, date, start, end)) throw new HttpError(409, req.t('api.horarioAcabouOcupado'));
    const code = newCode();
    const info = db.prepare(
      `INSERT INTO bookings(code,room_id,service_id,title,style,date,start_min,end_min,client_id,client_name,client_phone,
                            client_email,notes,status,remote,price,paid,source,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'site',?,?)`
    ).run(code, room.id, serviceId, U.clean(b.title, 120), U.clean(b.style, 60), date, start, end, req.client.id, name, phone, email,
      U.clean(b.notes, 1000), status, remote ? 1 : 0, priceFor(room, start, end), now, now);
    return db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(info.lastInsertRowid);
  });

  res.status(201).json({ ok: true, booking: publicBooking(create()) });
});

// As marcações da conta com sessão iniciada, das mais recentes para as antigas.
router.get('/my-bookings', requireClient, (req, res) => {
  const rows = db.prepare(BOOKING_SELECT + ' WHERE b.client_id=? ORDER BY b.date DESC, b.start_min DESC').all(req.client.id);
  res.json({ bookings: rows.map((r) => ({ ...publicBooking(r), can_cancel: canCancel(r) })) });
});

function findForClient(req) {
  const body = req.body || {};
  const code = U.clean(body.code, 12).toUpperCase();
  const phone = U.digits(body.phone).slice(-7);
  const row = code ? db.prepare(BOOKING_SELECT + ' WHERE b.code=?').get(code) : null;
  if (!row || phone.length < 6 || U.digits(row.client_phone).slice(-7) !== phone) {
    throw new HttpError(404, req.t('api.marcacaoNaoEncontrada'));
  }
  return row;
}

router.post('/lookup', lookupLimiter, (req, res) => {
  const row = findForClient(req);
  res.json({ booking: publicBooking(row), can_cancel: canCancel(row) });
});

function canCancel(row) {
  if (row.status !== 'pedido' && row.status !== 'confirmado') return false;
  const now = U.nowLocal();
  return U.daysBetween(now.date, row.date) * 1440 + row.start_min > now.minutes;
}

router.post('/cancel', lookupLimiter, (req, res) => {
  const row = findForClient(req);
  if (!canCancel(row)) throw new HttpError(400, req.t('api.naoPodeCancelar'));
  db.prepare("UPDATE bookings SET status='cancelado', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
  const updated = db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(row.id);
  res.json({ booking: publicBooking(updated), can_cancel: false });
});

module.exports = router;
