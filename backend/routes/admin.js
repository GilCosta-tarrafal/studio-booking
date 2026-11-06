'use strict';

const express = require('express');
const {
  db, getSettings, saveSettings, parseHours, findConflict, newCode, BOOKING_SELECT, priceFor, sinalDe,
} = require('../lib/db');
const auth = require('../lib/auth');
const U = require('../lib/util');
const TR = require('../lib/traducoes');
const CAT = require('../lib/catalogos');
const fiscal = require('../lib/fiscal');
const { HttpError } = U;

const router = express.Router();
const STATUSES = ['pedido', 'aguarda_pagamento', 'confirmado', 'em_curso', 'concluido', 'cancelado', 'expirado'];
// Estados que não ocupam a sala nem contam como receita.
const LIVRES = "('cancelado','expirado')";

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
// Estúdio que o agente tenta configurar sem ser o seu: recusa com clareza.
function assertStudioInScope(req, studioId) {
  const scope = scopeStudio(req);
  if (scope && U.toInt(studioId) !== scope) throw new HttpError(403, 'Esse estúdio não é o seu.');
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
    ...catalogoCampos(b),
    client_name, client_phone: U.clean(b.client_phone, 30), client_email,
    notes: U.clean(b.notes, 1000), internal_notes: U.clean(b.internal_notes, 2000),
    price: blankPrice ? priceFor(room, start, end) : Math.max(0, U.toInt(b.price)),
    paid: Math.max(0, U.toInt(b.paid)),
  };
}

// Tipo de projeto, tipo de cliente e método de pagamento vêm dos catálogos de
// Configurações: guarda-se o código, que tem de existir (vazio = não indicado).
function catalogoCampos(b) {
  const out = {};
  for (const [campo, key, rotulo] of [['project_type', 'tipos_projeto', 'Tipo de projeto'], ['client_type', 'tipos_cliente', 'Tipo de cliente'], ['payment_method', 'metodos_pagamento', 'Método de pagamento']]) {
    const v = CAT.codigoValido(key, b[campo]);
    if (v === null) throw new HttpError(400, rotulo + ' inválido.');
    out[campo] = v;
  }
  return out;
}

function assertNoConflict(n, excludeId = 0) {
  if (n.status === 'cancelado' || n.status === 'expirado') return;
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
  // 'recentes': as marcadas há menos tempo primeiro (a lista do painel).
  const order = q.order === 'recentes' ? 'b.created_at DESC, b.id DESC'
    : q.order === 'desc' ? 'b.date DESC, b.start_min DESC' : 'b.date ASC, b.start_min ASC';
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

// Recibo da marcação em PDF (descarrega-se como anexo).
router.get('/bookings/:id/recibo.pdf', (req, res) => {
  const row = db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(idParam(req));
  const scope = scopeStudio(req);
  if (!row || (scope && row.studio_id !== scope)) throw new HttpError(404, 'Marcação não encontrada.');
  require('../lib/pdf-recibo').enviar(res, row);
});

// ------------------------------------------------------------ Faturas (internas)
// Uma marcação tem no máximo uma fatura em vigor; as anuladas ficam no histórico.
const FAT = require('../lib/faturas');
const marcacaoNoAmbito = (req) => {
  const row = db.prepare('SELECT b.id, r.studio_id FROM bookings b JOIN rooms r ON r.id=b.room_id WHERE b.id=?').get(idParam(req));
  const scope = scopeStudio(req);
  if (!row || (scope && row.studio_id !== scope)) throw new HttpError(404, 'Marcação não encontrada.');
  return row;
};
const faturaNoAmbito = (req) => {
  const f = FAT.obter(idParam(req));
  const scope = scopeStudio(req);
  if (!f || (scope && f.studio_id !== scope)) throw new HttpError(404, 'Fatura não encontrada.');
  return f;
};

router.get('/bookings/:id/fatura', (req, res) => {
  res.json(FAT.daMarcacao(marcacaoNoAmbito(req).id));
});

router.post('/bookings/:id/fatura', (req, res) => {
  const f = FAT.emitir(marcacaoNoAmbito(req).id, req.body || {}, req.user.id);
  res.status(201).json({ fatura: f });
});

router.get('/faturas/:id.pdf', (req, res) => {
  const f = faturaNoAmbito(req);
  const codigo = f.booking_id ? (db.prepare('SELECT code FROM bookings WHERE id=?').get(f.booking_id) || {}).code : '';
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="fatura-${f.serie.replace(/\s+/g, '')}-${f.numero}.pdf"` });
  require('../lib/pdf-fatura').gerar(res, f, getSettings(), codigo);
});

router.post('/faturas/:id/anular', (req, res) => {
  faturaNoAmbito(req);
  res.json({ fatura: FAT.anular(U.toInt(req.params.id), (req.body || {}).motivo) });
});

router.post('/bookings', (req, res) => {
  const n = normalizeBooking(req.body || {});
  assertRoomInScope(req, n.room_id);
  const now = new Date().toISOString();
  const id = db.transaction(() => {
    assertNoConflict(n);
    return db.prepare(
      `INSERT INTO bookings(code,room_id,service_id,title,style,date,start_min,end_min,client_name,client_phone,
                            client_email,notes,internal_notes,status,remote,price,paid,project_type,client_type,payment_method,
                            source,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'admin',?,?)`
    ).run(newCode(), n.room_id, n.service_id, n.title, n.style, n.date, n.start, n.end, n.client_name, n.client_phone,
      n.client_email, n.notes, n.internal_notes, n.status, n.remote, n.price, n.paid, n.project_type, n.client_type,
      n.payment_method, now, now).lastInsertRowid;
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
              client_phone=?, client_email=?, notes=?, internal_notes=?, status=?, remote=?, price=?, paid=?,
              project_type=?, client_type=?, payment_method=?, updated_at=?
        WHERE id=?`
    ).run(n.room_id, n.service_id, n.title, n.style, n.date, n.start, n.end, n.client_name, n.client_phone,
      n.client_email, n.notes, n.internal_notes, n.status, n.remote, n.price, n.paid,
      n.project_type, n.client_type, n.payment_method, new Date().toISOString(), id);
  })();
  res.json({ booking: withTimes(db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(id)) });
});

// Mudança rápida de estado (botões Confirmar / Recusar).
router.patch('/bookings/:id/status', (req, res) => {
  const id = idParam(req);
  let status = String((req.body || {}).status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Estado inválido.');
  const row = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Marcação não encontrada.');
  assertInScope(req, row.room_id);
  // Aceitar um pedido do site cujo sinal ainda não foi pago não o confirma
  // logo: fica "aguarda pagamento" e o cliente é avisado de que só falta pagar.
  const aceite = status === 'confirmado' && row.status === 'pedido' && row.paid < sinalDe(row) && !!row.client_id;
  if (aceite) status = 'aguarda_pagamento';
  db.transaction(() => {
    assertNoConflict({ status, room_id: row.room_id, date: row.date, start: row.start_min, end: row.end_min }, id);
    db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
  })();
  const booking = withTimes(db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(id));
  if (aceite) require('../lib/aviso-pagamento').avisar(booking, req).catch((e) => console.error('aviso de pagamento:', e.message));
  res.json({ booking, aguarda_pagamento: aceite });
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

// ------------------------------------------------------------ Notificações (sininho)
// Calculadas na hora a partir do que já existe: pedidos por confirmar, sessões
// de hoje, pagamentos em atraso e tentativas falhadas de entrar nesta conta.
// "Por ler" = mais recente do que a última vez que a pessoa abriu o sininho.
router.get('/notificacoes', (req, res) => {
  const now = U.nowLocal();
  const scope = scopeStudio(req);
  const sf = scope ? ' AND r.studio_id=' + scope : '';
  const inicioDia = new Date(now.date + 'T00:00:00Z').toISOString();
  const itens = [];

  const pedidos = db.prepare(
    `SELECT b.id, b.client_name, b.date, b.start_min, b.created_at, s.name studio
       FROM bookings b JOIN rooms r ON r.id=b.room_id JOIN studios s ON s.id=r.studio_id
      WHERE b.status='pedido'${sf} ORDER BY b.created_at DESC LIMIT 15`
  ).all();
  for (const p of pedidos) {
    itens.push({
      id: 'pedido-' + p.id, kind: 'pedido', title: 'Novo pedido de marcação',
      text: `${p.client_name} · ${p.date.slice(8)}/${p.date.slice(5, 7)} às ${U.fmtHM(p.start_min)}`,
      at: p.created_at, href: '#/marcacoes',
    });
  }

  const hoje = db.prepare(
    `SELECT COUNT(*) n FROM bookings b JOIN rooms r ON r.id=b.room_id
      WHERE b.date=? AND b.status IN ('confirmado','em_curso')${sf}`
  ).get(now.date).n;
  if (hoje) {
    itens.push({
      id: 'hoje-' + now.date, kind: 'hoje', title: hoje === 1 ? '1 sessão marcada para hoje' : `${hoje} sessões marcadas para hoje`,
      text: 'Veja o horário no Painel.', at: inicioDia, href: '#/painel',
    });
  }

  const atraso = db.prepare(
    `SELECT COUNT(*) n, COALESCE(SUM(b.price-b.paid),0) v FROM bookings b JOIN rooms r ON r.id=b.room_id
      WHERE b.status='concluido' AND b.price>b.paid AND b.date<?${sf}`
  ).get(now.date);
  if (atraso.n) {
    itens.push({
      id: 'atraso-' + now.date, kind: 'pagamento',
      title: atraso.n === 1 ? '1 sessão concluída por pagar' : `${atraso.n} sessões concluídas por pagar`,
      text: `Falta receber ${Number(atraso.v).toLocaleString('pt-PT')} ${getSettings().currency}.`, at: inicioDia, href: '#/relatorios',
    });
  }

  // Pagamentos recebidos (página /pagar ou Stripe) nos últimos 14 dias.
  const pagos = db.prepare(
    `SELECT p.id, p.valor, p.moeda, p.atualizado_em, p.cartao_marca, p.cartao_ultimos, p.fornecedor, b.code, b.client_name
       FROM int_pagamentos p JOIN bookings b ON b.id=p.booking_id JOIN rooms r ON r.id=b.room_id
      WHERE p.estado='pago' AND p.atualizado_em>=?${sf} ORDER BY p.atualizado_em DESC LIMIT 15`
  ).all(new Date(Date.now() - 14 * 86400000).toISOString());
  for (const p of pagos) {
    itens.push({
      id: 'pago-' + p.id, kind: 'recebido', title: 'Pagamento recebido',
      text: `${p.client_name} · ${Number(p.valor).toLocaleString('pt-PT')} ${String(p.moeda || getSettings().currency || '').toUpperCase()}`,
      at: p.atualizado_em, href: '#/marcacoes',
    });
  }

  const tentativas = db.prepare(
    `SELECT id, ip, created_at FROM user_activity
      WHERE user_id=? AND action='Tentativa de login falhada' AND created_at>=? ORDER BY id DESC LIMIT 5`
  ).all(req.user.id, new Date(Date.now() - 7 * 86400000).toISOString());
  for (const t of tentativas) {
    itens.push({
      id: 'login-' + t.id, kind: 'seguranca', title: 'Tentativa falhada de entrar na sua conta',
      text: t.ip ? 'A partir de ' + t.ip.replace(/^::ffff:/, '') + '.' : 'Palavra-passe errada.',
      at: t.created_at, href: '#/perfil?sec=atividade',
    });
  }

  const visto = db.prepare('SELECT notif_seen_at FROM users WHERE id=?').get(req.user.id).notif_seen_at;
  itens.sort((a, b) => (a.at < b.at ? 1 : -1));
  for (const i of itens) i.unread = !visto || i.at > visto;
  res.json({ items: itens, unread: itens.filter((i) => i.unread).length });
});

router.post('/notificacoes/vistas', (req, res) => {
  db.prepare('UPDATE users SET notif_seen_at=? WHERE id=?').run(new Date().toISOString(), req.user.id);
  res.json({ ok: true });
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
    today: n(`SELECT COUNT(*) v ${base} AND b.date=? AND b.status NOT IN ${LIVRES}`, now.date).v,
    next7: n(`SELECT COUNT(*) v ${base} AND b.date>? AND b.date<=? AND b.status NOT IN ${LIVRES}`, now.date, U.addDays(now.date, 7)).v,
  };
  const money = {
    received_month: n(`SELECT COALESCE(SUM(b.paid),0) v ${base} AND b.date>=? AND b.date<=? AND b.status NOT IN ${LIVRES}`, monthStart, monthEnd).v,
    outstanding: n(`SELECT COALESCE(SUM(b.price-b.paid),0) v ${base} AND b.status IN ('confirmado','em_curso','concluido') AND b.price>b.paid`).v,
  };
  const pending = db.prepare(`${BOOKING_SELECT} WHERE b.status='pedido'${studioId ? ' AND r.studio_id=' + studioId : ''}
                              ORDER BY b.date, b.start_min LIMIT 12`).all().map(withTimes);
  const today = db.prepare(`${BOOKING_SELECT} WHERE b.date=? AND b.status NOT IN ${LIVRES}${studioId ? ' AND r.studio_id=' + studioId : ''}
                            ORDER BY b.start_min`).all(now.date).map(withTimes);
  res.json({ today: now.date, counts, money, pending, todayList: today });
});

// Fluxo financeiro do Dashboard: os últimos 13 meses (o 13.º serve só para
// comparar o primeiro com o anterior), já com os meses sem marcações a zero, e
// a faturação de cada serviço em cada mês. As canceladas não contam.
router.get('/dashboard/fluxo', (req, res) => {
  const now = U.nowLocal();
  const studioId = scopeStudio(req) || U.toInt(req.query.studio_id);
  const sf = studioId ? ' AND r.studio_id=' + studioId : '';
  const [y, m] = now.date.split('-').map(Number);
  const meses = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    meses.push(d.toISOString().slice(0, 7));
  }
  const de = meses[0] + '-01', ate = meses[meses.length - 1] + '-31';
  const FROM = `FROM bookings b JOIN rooms r ON r.id=b.room_id LEFT JOIN services sv ON sv.id=b.service_id
                WHERE b.status NOT IN ${LIVRES} AND b.date>=? AND b.date<=?${sf}`;
  const porMes = new Map(db.prepare(`SELECT substr(b.date,1,7) month, COUNT(*) sessions,
      COALESCE(SUM(b.end_min-b.start_min),0) minutes, COALESCE(SUM(b.price),0) billed, COALESCE(SUM(b.paid),0) received
      ${FROM} GROUP BY month`).all(de, ate).map((r) => [r.month, r]));
  const servicos = db.prepare(`SELECT substr(b.date,1,7) month, b.service_id id, COALESCE(sv.name,'Sem serviço') name,
      COUNT(*) sessions, COALESCE(SUM(b.price),0) billed
      ${FROM} GROUP BY month, b.service_id`).all(de, ate);
  res.json({
    current: meses[meses.length - 1],
    months: meses.map((mes) => {
      const r = porMes.get(mes) || {};
      return {
        month: mes, sessions: r.sessions || 0, minutes: r.minutes || 0, billed: r.billed || 0, received: r.received || 0,
        services: servicos.filter((s) => s.month === mes).map(({ id, name, sessions, billed }) => ({ id, name, sessions, billed })),
      };
    }),
  });
});

// ------------------------------------------------------------ Relatórios
// Totais e repartições das marcações segundo os filtros escolhidos (período,
// estúdio, estado, serviço, modo). O agente fica sempre preso ao seu estúdio.
function computeReport(req) {
  const q = req.query;
  const where = ['1=1'];
  const args = [];
  const scope = scopeStudio(req);
  if (scope) { where.push('r.studio_id=?'); args.push(scope); }
  else if (q.studio_id) { where.push('r.studio_id=?'); args.push(U.toInt(q.studio_id)); }
  if (q.from && U.isValidDate(String(q.from))) { where.push('b.date>=?'); args.push(String(q.from)); }
  if (q.to && U.isValidDate(String(q.to))) { where.push('b.date<=?'); args.push(String(q.to)); }
  if (q.service_id) { where.push('b.service_id=?'); args.push(U.toInt(q.service_id)); }
  if (q.remote === '1' || q.remote === '0') { where.push('b.remote=?'); args.push(U.toInt(q.remote)); }
  if (q.status) {
    const list = String(q.status).split(',').filter((s) => STATUSES.includes(s));
    if (list.length) { where.push(`b.status IN (${list.map(() => '?').join(',')})`); args.push(...list); }
  }
  const W = where.join(' AND ');
  const FROM = `FROM bookings b JOIN rooms r ON r.id=b.room_id JOIN studios s ON s.id=r.studio_id
                LEFT JOIN services sv ON sv.id=b.service_id WHERE ${W}`;
  // O dinheiro ignora as canceladas: não são receita nem dívida reais.
  const vivo = `CASE WHEN b.status NOT IN ${LIVRES} THEN`;
  const one = (sql) => db.prepare(sql).get(...args);
  const many = (sql) => db.prepare(sql).all(...args);

  const totals = one(`SELECT
      COUNT(*) sessions,
      COALESCE(SUM(b.end_min-b.start_min),0) minutes,
      COALESCE(SUM(${vivo} b.price ELSE 0 END),0) billed,
      COALESCE(SUM(${vivo} b.paid ELSE 0 END),0) received,
      COALESCE(SUM(CASE WHEN b.status IN ('confirmado','em_curso','concluido') AND b.price>b.paid THEN b.price-b.paid ELSE 0 END),0) outstanding,
      COUNT(DISTINCT b.client_name) clients
    ${FROM}`);
  const byStatus = many(`SELECT b.status, COUNT(*) sessions,
      COALESCE(SUM(b.price),0) billed, COALESCE(SUM(b.paid),0) received ${FROM} GROUP BY b.status`);
  const byService = many(`SELECT COALESCE(sv.name,'—') name, COUNT(*) sessions,
      COALESCE(SUM(${vivo} b.price ELSE 0 END),0) billed,
      COALESCE(SUM(${vivo} b.paid ELSE 0 END),0) received ${FROM} GROUP BY b.service_id ORDER BY sessions DESC`);
  const byStudio = scope ? [] : many(`SELECT s.name name, COUNT(*) sessions,
      COALESCE(SUM(${vivo} b.price ELSE 0 END),0) billed,
      COALESCE(SUM(${vivo} b.paid ELSE 0 END),0) received ${FROM} GROUP BY r.studio_id ORDER BY billed DESC`);
  const byMonth = many(`SELECT substr(b.date,1,7) month, COUNT(*) sessions,
      COALESCE(SUM(${vivo} b.price ELSE 0 END),0) billed,
      COALESCE(SUM(${vivo} b.paid ELSE 0 END),0) received ${FROM} GROUP BY month ORDER BY month`);
  const rows = db.prepare(`${BOOKING_SELECT} WHERE ${W} ORDER BY b.date DESC, b.start_min DESC LIMIT 500`).all(...args).map(withTimes);

  return { totals, byStatus, byService, byStudio, byMonth, rows, limited: rows.length >= 500, scope };
}

router.get('/reports', (req, res) => {
  const r = computeReport(req);
  res.json({ totals: r.totals, byStatus: r.byStatus, byService: r.byService, byStudio: r.byStudio, byMonth: r.byMonth, rows: r.rows, limited: r.limited });
});

// O mesmo relatório em PDF, descarregado diretamente (sem passar pela impressão).
router.get('/reports.pdf', (req, res) => {
  const r = computeReport(req);
  const settings = getSettings();
  const sid = r.scope || U.toInt(req.query.studio_id);
  // O cabeçalho leva os dados do estúdio filtrado (ou do primeiro, a sede),
  // os mesmos do recibo: nome legal, NIF, telefone, email e morada.
  const estudio = sid
    ? db.prepare('SELECT * FROM studios WHERE id=?').get(sid)
    : db.prepare('SELECT * FROM studios ORDER BY sort, id LIMIT 1').get();
  const fmtD = (iso, curto) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${curto ? y.slice(2) : y}`; };
  const from = U.isValidDate(String(req.query.from || '')) ? String(req.query.from) : null;
  const to = U.isValidDate(String(req.query.to || '')) ? String(req.query.to) : null;
  const periodo = (!from && !to) ? 'Todo o período'
    : (from && to) ? `De ${fmtD(from)} a ${fmtD(to)}` : from ? `Desde ${fmtD(from)}` : `Até ${fmtD(to)}`;
  const geradoEm = new Intl.DateTimeFormat('pt-PT', {
    timeZone: U.TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());
  const dominio = settings.email && settings.email.includes('@') ? settings.email.split('@')[1] : '';
  res.setHeader('Content-Disposition', `attachment; filename="relatorio-${from || 'inicio'}_a_${to || 'hoje'}.pdf"`);
  res.setHeader('Content-Type', 'application/pdf');
  require('../lib/pdf-relatorio').gerar(res, r, {
    business: settings, estudio, periodo, geradoEm, dominio, cur: settings.currency,
  });
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
  const bookings = db.prepare(BOOKING_SELECT + ` WHERE b.date=? AND b.status NOT IN ${LIVRES} ORDER BY b.start_min`).all(date)
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

// Email do estúdio (para o recibo): vazio ou um endereço válido.
function emailOuVazio(v) {
  const e = U.clean(v, 120).toLowerCase();
  if (e && !U.isEmail(e)) throw new HttpError(400, 'O email do estúdio não é válido.');
  return e;
}

// Taxa de IVA do estúdio em %: vazio = por definir; senão entre 0 e 50.
function taxaIva(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 50) throw new HttpError(400, 'A taxa de IVA tem de ser um número entre 0 e 50.');
  return Math.round(n * 100) / 100;
}

// Sem taxa de IVA mas com o sítio do estúdio: propõe-se a do país onde fica.
async function completarFiscal(b) {
  if (b.vat_rate != null || b.lat == null || b.lon == null) return b;
  const f = await fiscal.detetar(b.lat, b.lon, { url: GEOCODER, agente: `studio-booking (${getSettings().business_name || 'estudio'})` });
  if (f && f.taxa != null) Object.assign(b, { country_code: f.codigo, tax_name: f.imposto, vat_rate: f.taxa });
  return b;
}

function studioBody(b) {
  const name = U.clean(b.name, 80);
  if (!name) throw new HttpError(400, 'Indique o nome do estúdio.');
  return {
    name, city: U.clean(b.city, 60), address: U.clean(b.address, 160), phone: U.clean(b.phone, 30),
    legal_name: U.clean(b.legal_name, 120), nif: U.clean(b.nif, 30), email: emailOuVazio(b.email),
    country_code: U.clean(b.country_code, 2).toLowerCase(), tax_name: U.clean(b.tax_name, 10) || 'IVA', vat_rate: taxaIva(b.vat_rate),
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
      pais_nome: s.country_code ? fiscal.montar(s.country_code).pais : '',
      rooms: rooms.filter((r) => r.studio_id === s.id).map((r) => ({ ...r, bookings: counts[r.id] || 0 })),
    })),
  });
});

router.post('/studios', auth.requireManager, async (req, res) => {
  const b = await completarFiscal(studioBody(req.body || {}));
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM studios').get().m;
  const id = db.prepare(`INSERT INTO studios(name,city,address,phone,legal_name,nif,email,country_code,tax_name,vat_rate,description,hours,lat,lon,traducoes,active,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, '{}'),?,?)`)
    .run(b.name, b.city, b.address, b.phone, b.legal_name, b.nif, b.email, b.country_code, b.tax_name, b.vat_rate, b.description, b.hours, b.lat, b.lon, b.traducoes, b.active, max + 1).lastInsertRowid;
  res.status(201).json({ id });
});

// O agente configura o seu estúdio (dados, horário, recibo); criar ou eliminar
// estúdios continua a ser só da gestão.
router.put('/studios/:id', async (req, res) => {
  const id = idParam(req);
  assertStudioInScope(req, id);
  const b = await completarFiscal(studioBody(req.body || {}));
  const info = db.prepare('UPDATE studios SET name=?, city=?, address=?, phone=?, legal_name=?, nif=?, email=?, country_code=?, tax_name=?, vat_rate=?, description=?, hours=?, lat=?, lon=?, traducoes=COALESCE(?, traducoes), active=? WHERE id=?')
    .run(b.name, b.city, b.address, b.phone, b.legal_name, b.nif, b.email, b.country_code, b.tax_name, b.vat_rate, b.description, b.hours, b.lat, b.lon, b.traducoes, b.active, id);
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

// Salas: o agente gere as do seu estúdio.
router.post('/rooms', (req, res) => {
  const studioId = U.toInt((req.body || {}).studio_id);
  assertStudioInScope(req, studioId);
  if (!db.prepare('SELECT 1 FROM studios WHERE id=?').get(studioId)) throw new HttpError(400, 'Estúdio inválido.');
  const b = roomBody(req.body || {});
  const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM rooms WHERE studio_id=?').get(studioId).m;
  const id = db.prepare(`INSERT INTO rooms(studio_id,name,description,hourly_rate,traducoes,active,sort) VALUES(?,?,?,?,COALESCE(?, '{}'),?,?)`)
    .run(studioId, b.name, b.description, b.hourly_rate, b.traducoes, b.active, max + 1).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/rooms/:id', (req, res) => {
  assertInScope(req, idParam(req));
  const b = roomBody(req.body || {});
  const info = db.prepare('UPDATE rooms SET name=?, description=?, hourly_rate=?, traducoes=COALESCE(?, traducoes), active=? WHERE id=?')
    .run(b.name, b.description, b.hourly_rate, b.traducoes, b.active, idParam(req));
  if (!info.changes) throw new HttpError(404, 'Sala não encontrada.');
  res.json({ ok: true });
});

router.delete('/rooms/:id', (req, res) => {
  const id = idParam(req);
  assertInScope(req, id);
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
    + ` WHERE b.status NOT IN ${LIVRES}` + (scope ? ' AND r.studio_id=' + scope : '') + ' ORDER BY b.date'
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

// Ao mudar a moeda (CVE -> EUR, por exemplo), os valores guardados passam para
// a moeda nova com a taxa do dia: preço por hora das salas, preço e "já pago"
// das marcações, artigos à venda e compras. Os pagamentos registados guardam a
// moeda em que foram feitos e ficam como estão. Devolve a função que converte
// (a correr dentro da transação que grava as definições), ou null.
function conversaoDeMoeda(de, para) {
  const iso = (m) => /^[A-Z]{3}$/.test(String(m || '').trim().toUpperCase());
  if (!iso(de) || !iso(para) || de.toUpperCase() === para.toUpperCase()) return null;
  const { cambio } = require('../../integracoes');
  const taxa = cambio.taxa(de, para);
  if (taxa === null) {
    throw new HttpError(400, `Não há taxa de câmbio de ${de} para ${para}. Atualize as taxas em Integrações › Taxas de câmbio, ou desmarque "Converter os preços".`);
  }
  return () => {
    const c = (col) => `${col} = CAST(ROUND(${col} * ?) AS INTEGER)`;
    db.prepare(`UPDATE rooms SET ${c('hourly_rate')}`).run(taxa);
    db.prepare(`UPDATE bookings SET ${c('price')}, ${c('paid')}`).run(taxa, taxa);
    db.prepare(`UPDATE int_projetos SET ${c('preco')} WHERE preco IS NOT NULL`).run(taxa);
    db.prepare(`UPDATE int_encomendas SET ${c('preco_unit')}, ${c('total')}`).run(taxa, taxa);
    return taxa;
  };
}

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
  const moedaNova = U.clean(b.currency, 8) || 'CVE';
  // Só converte quando o painel o pede (a caixa "Converter os preços").
  const converter = b.converter_precos !== true ? null : conversaoDeMoeda(getSettings().currency, moedaNova);
  let taxa = null;
  db.transaction(() => {
    if (converter) taxa = converter();
    saveSettings({
      business_name: name, tagline: U.clean(b.tagline, 160),
      phone: U.clean(b.phone, 30), whatsapp: U.clean(b.whatsapp, 30), email: U.clean(b.email, 120),
      instagram: rede(b.instagram, 'Instagram'),
      spotify: rede(b.spotify, 'Spotify'), youtube: rede(b.youtube, 'YouTube'),
      currency: moedaNova, country_code: U.digits(b.country_code).slice(0, 4),
      slot_minutes: slot, min_minutes: min, max_minutes: max, lead_hours: lead, max_advance_days: adv,
      auto_confirm: !!b.auto_confirm, terms: U.clean(b.terms, 500),
      deposit_percent: b.deposit_percent === undefined ? getSettings().deposit_percent : Math.min(100, Math.max(1, U.toInt(b.deposit_percent) || 50)),
      // Sem traduções no pedido (um cliente antigo do painel), ficam as que havia.
      ...(b.traducoes === undefined ? {} : { traducoes: TR.limpar(b.traducoes, TR.CAMPOS.settings) }),
    });
  })();
  if (converter) {
    // As taxas guardam-se em relação à moeda base: vão-se buscar já na nova.
    require('../../integracoes').cambio.sincronizar().catch((e) => console.error('[cambio] atualização falhou:', e.message));
  }
  res.json({ settings: getSettings(), convertido: taxa });
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

// A função de cada utilizador é um perfil de "Gestão de acesso" (rbac_roles).
// Escolher a função também acerta o tipo de conta que o painel usa: a função
// Proprietário dá uma conta de proprietário, Agente de estúdio prende a conta a
// um estúdio e as outras ficam como equipa.
function funcaoDoPedido(b) {
  if (b.funcao_id === undefined) return undefined;                     // não veio: não se mexe
  if (b.funcao_id === null || b.funcao_id === '') return null;         // "Sem função"
  const f = db.prepare('SELECT id, code FROM rbac_roles WHERE id=?').get(U.toInt(b.funcao_id));
  if (!f) throw new HttpError(400, 'Função inválida.');
  return f;
}
function tipoDaFuncao(f, b) {
  if (f && f.code === 'proprietario') return { ...b, role: 'owner' };
  if (f && f.code === 'agente') return { ...b, role: 'agent' };
  if (f) return { ...b, role: 'staff' };
  return b;   // sem função: fica o tipo de conta que tinha (ou o que o pedido diz)
}
// Uma função por utilizador: troca as atribuições que tinha por esta.
function gravarFuncao(userId, f) {
  db.prepare('DELETE FROM rbac_assignments WHERE user_id=?').run(userId);
  if (f) db.prepare('INSERT INTO rbac_assignments(user_id,role_id,created_at) VALUES(?,?,?)').run(userId, f.id, new Date().toISOString());
}

router.get('/users', auth.requireOwner, (_req, res) => {
  const rows = db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.created_at, u.last_login_at, u.studio_id, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON s.id = u.studio_id ORDER BY u.created_at DESC, u.id DESC`
  ).all();
  // A função principal: o perfil atribuído com maior prioridade.
  const funcoes = db.prepare(
    `SELECT a.user_id, r.id, r.name, r.code FROM rbac_assignments a JOIN rbac_roles r ON r.id = a.role_id
      WHERE a.expires_at IS NULL OR a.expires_at >= date('now') ORDER BY r.priority DESC`
  ).all();
  const funcaoDe = {};
  for (const f of funcoes) if (!funcaoDe[f.user_id]) funcaoDe[f.user_id] = { id: f.id, name: f.name, code: f.code };
  const roles = db.prepare('SELECT id, name, code FROM rbac_roles ORDER BY priority DESC, id').all();
  res.json({ users: rows.map((u) => ({ ...u, role: shownRole(u), funcao: funcaoDe[u.id] || null })), funcoes: roles });
});

router.post('/users', auth.requireOwner, (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.name, 80);
  const email = U.clean(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  const funcao = funcaoDoPedido(b);
  const { role, studio_id } = roleAndStudio(funcao === undefined ? b : tipoDaFuncao(funcao, b));
  if (!name) throw new HttpError(400, 'Indique o nome.');
  if (!U.isEmail(email)) throw new HttpError(400, 'Indique um email válido.');
  if (password.length < 8) throw new HttpError(400, 'A palavra-passe deve ter pelo menos 8 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Já existe um utilizador com esse email.');
  const active = b.active === undefined ? 1 : flag(b.active);
  const id = db.transaction(() => {
    const novo = db.prepare('INSERT INTO users(name,email,password_hash,role,studio_id,active,phone,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(name, email, auth.hashPassword(password), role, studio_id, active, U.clean(b.phone, 30), new Date().toISOString()).lastInsertRowid;
    if (funcao !== undefined) gravarFuncao(novo, funcao);
    return novo;
  })();
  res.status(201).json({ id });
});

router.put('/users/:id', auth.requireOwner, (req, res) => {
  const id = idParam(req);
  const b = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) throw new HttpError(404, 'Utilizador não encontrado.');
  const funcao = funcaoDoPedido(b);
  // Campos que não vêm ficam como estavam (por exemplo, só ativar/desativar).
  const atual = { role: shownRole(user), studio_id: user.studio_id, ...b };
  const { role, studio_id } = roleAndStudio(funcao === undefined ? atual : tipoDaFuncao(funcao, atual));
  const active = b.active === undefined ? user.active : flag(b.active);
  const losesOwner = user.role === 'owner' && user.active && (role !== 'owner' || !active);
  if (losesOwner && activeOwners() <= 1) throw new HttpError(400, 'Tem de existir pelo menos um proprietário ativo.');
  if (id === req.user.id && !active) throw new HttpError(400, 'Não pode desativar a sua própria conta.');
  const name = U.clean(b.name, 80) || user.name;
  const phone = b.phone === undefined ? user.phone : U.clean(b.phone, 30);
  db.transaction(() => {
    db.prepare('UPDATE users SET name=?, role=?, studio_id=?, active=?, phone=? WHERE id=?').run(name, role, studio_id, active, phone, id);
    if (funcao !== undefined) gravarFuncao(id, funcao);
  })();
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

router.post('/geocode', async (req, res) => {
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

// País e taxa de IVA propostos para um sítio (as coordenadas do estúdio).
router.get('/fiscal', async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'Coordenadas inválidas.');
  const f = await fiscal.detetar(lat, lon, { url: GEOCODER, agente: `studio-booking (${getSettings().business_name || 'estudio'})` });
  res.json({ fiscal: f });
});

module.exports = router;
