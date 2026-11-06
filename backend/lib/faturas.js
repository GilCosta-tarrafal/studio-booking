'use strict';
// ---------------------------------------------------------------------------
// Faturas internas das marcações.
//
// Não têm validade fiscal (não vêm de software certificado nem do e-Fatura):
// servem de documento interno até haver certificação. Mesmo assim seguem as
// regras de uma fatura a sério, para a passagem ser simples:
//   - numeração seguida por série (uma por ano: "FT 2026"), sem buracos nem
//     números reaproveitados — uma fatura errada anula-se e emite-se outra;
//   - uma só fatura em vigor por marcação;
//   - fica com uma cópia dos dados do momento (cliente, estúdio, valores e
//     taxa), para não mudar se a marcação ou o estúdio mudarem depois.
// O valor da marcação já inclui o imposto: base = total / (1 + taxa).
// ---------------------------------------------------------------------------
const { db, getSettings, BOOKING_SELECT } = require('./db');
const { HttpError, clean, nowLocal } = require('./util');

const r2 = (n) => Math.round(n * 100) / 100;
const numeroTexto = (f) => `${f.serie}/${f.numero}`;

function obter(id) {
  const f = db.prepare('SELECT * FROM faturas WHERE id=?').get(id);
  return f && { ...f, emitente: JSON.parse(f.emitente || '{}'), numero_texto: numeroTexto(f) };
}

// A fatura em vigor da marcação (ou null) e as anuladas, das mais recentes.
function daMarcacao(bookingId) {
  const todas = db.prepare('SELECT id FROM faturas WHERE booking_id=? ORDER BY id DESC').all(bookingId).map((r) => obter(r.id));
  return { fatura: todas.find((f) => f.estado === 'emitida') || null, anuladas: todas.filter((f) => f.estado === 'anulada') };
}

function emitir(bookingId, dados = {}, userId = null) {
  const b = db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(bookingId);
  if (!b) throw new HttpError(404, 'Marcação não encontrada.');
  if (['cancelado', 'expirado'].includes(b.status)) throw new HttpError(400, 'Não se fatura uma marcação cancelada ou expirada.');
  if (b.status === 'pedido') throw new HttpError(400, 'Confirme a marcação antes de emitir a fatura.');
  if (!(b.price > 0)) throw new HttpError(400, 'A marcação não tem valor para faturar.');
  const st = db.prepare('SELECT * FROM studios WHERE id=?').get(b.studio_id) || {};
  if (st.vat_rate == null) {
    throw new HttpError(400, `O estúdio "${st.name || ''}" ainda não tem a taxa de IVA. Defina-a em Estúdios (sai sozinha da localização).`);
  }
  const taxa = Number(st.vat_rate);
  const total = r2(b.price);
  const base = r2(total / (1 + taxa / 100));
  const imposto = r2(total - base);
  const descricao = [b.service_name || 'Sessão em estúdio', b.room_name].filter(Boolean).join(' · ')
    + ` — ${b.date.split('-').reverse().join('/')}, ${String(Math.floor(b.start_min / 60)).padStart(2, '0')}:${String(b.start_min % 60).padStart(2, '0')}`
    + `-${String(Math.floor(b.end_min / 60)).padStart(2, '0')}:${String(b.end_min % 60).padStart(2, '0')}`;
  const emitente = {
    nome: st.legal_name || st.name || '', nome_estudio: st.name || '', nif: st.nif || '', telefone: st.phone || '',
    email: st.email || '', morada: [st.address, st.city].filter(Boolean).join(', '), pais: st.country_code || '',
  };
  const serie = 'FT ' + nowLocal().date.slice(0, 4);

  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM faturas WHERE booking_id=? AND estado='emitida'").get(bookingId)) {
      throw new HttpError(409, 'Esta marcação já tem uma fatura em vigor. Anule-a primeiro para emitir outra.');
    }
    const numero = db.prepare('SELECT COALESCE(MAX(numero),0)+1 n FROM faturas WHERE serie=?').get(serie).n;
    const id = db.prepare(
      `INSERT INTO faturas(serie,numero,booking_id,studio_id,emitente,emitida_em,cliente_nome,cliente_nif,cliente_morada,cliente_email,
                           descricao,total,base,imposto,taxa,imposto_nome,moeda,emitida_por)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(serie, numero, b.id, b.studio_id, JSON.stringify(emitente), new Date().toISOString(),
      clean(dados.cliente_nome, 120) || b.client_name, clean(dados.cliente_nif, 20), clean(dados.cliente_morada, 200),
      b.client_email || '', descricao, total, base, imposto, taxa, st.tax_name || 'IVA', b.currency || getSettings().currency || '', userId).lastInsertRowid;
    return obter(id);
  })();
}

function anular(id, motivo) {
  const f = obter(id);
  if (!f) throw new HttpError(404, 'Fatura não encontrada.');
  if (f.estado === 'anulada') throw new HttpError(400, 'Esta fatura já está anulada.');
  const m = clean(motivo, 200);
  if (!m) throw new HttpError(400, 'Indique o motivo da anulação.');
  db.prepare("UPDATE faturas SET estado='anulada', anulada_em=?, motivo_anulacao=? WHERE id=?").run(new Date().toISOString(), m, id);
  return obter(id);
}

module.exports = { obter, daMarcacao, emitir, anular, numeroTexto };
