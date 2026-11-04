'use strict';
// ---------------------------------------------------------------------------
// Loja: artigos da gravadora à venda no site (projetos do tipo "vendas").
//
// No site, o cliente (com conta) escolhe a quantidade e carrega em "Comprar":
// nasce uma encomenda com um código, como o de uma marcação, e o cliente vai
// para a mesma página de pagamento (/pagar?code=…), com os mesmos cartões,
// resumo com IVA e recibo (ver rotas/pagamento.js).
//
// Stock: a encomenda por pagar reserva as unidades durante RESERVA_MIN
// minutos, para dois clientes não comprarem a mesma última unidade. Paga, as
// unidades saem do stock; sem pagar, a reserva expira e as unidades voltam.
// Com o stock a zero, o artigo sai do site.
// ---------------------------------------------------------------------------
const { db, getSettings, newCode } = require('../../backend/lib/db');
const U = require('../../backend/lib/util');
const { HttpError } = U;

db.exec(`
CREATE TABLE IF NOT EXISTS int_encomendas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  projeto_id    INTEGER REFERENCES int_projetos(id) ON DELETE SET NULL,
  -- Cópia do momento da compra: o artigo pode mudar de nome ou preço depois.
  titulo        TEXT NOT NULL,
  preco_unit    INTEGER NOT NULL,
  quantidade    INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  cliente_nome  TEXT NOT NULL DEFAULT '',
  cliente_email TEXT NOT NULL DEFAULT '',
  cliente_tel   TEXT NOT NULL DEFAULT '',
  estado        TEXT NOT NULL DEFAULT 'aguarda_pagamento' CHECK (estado IN ('aguarda_pagamento','pago','expirado')),
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  pago_em       TEXT
);
CREATE INDEX IF NOT EXISTS idx_int_encomendas_projeto ON int_encomendas(projeto_id, estado);
`);

const RESERVA_MIN = 30;
const MAX_POR_COMPRA = 99;
const erro = (m, s = 400) => new HttpError(s, m);
const r2 = (n) => Math.round(n * 100) / 100;
const limiteReserva = () => new Date(Date.now() - RESERVA_MIN * 60 * 1000).toISOString();

// Reservas que passaram do prazo deixam de contar (o cliente pode retomá-las
// em /pagar, se ainda houver unidades).
function expirar() {
  db.prepare("UPDATE int_encomendas SET estado='expirado', atualizado_em=? WHERE estado='aguarda_pagamento' AND atualizado_em<?")
    .run(new Date().toISOString(), limiteReserva());
}

// Unidades que ainda se podem comprar: o stock menos as reservas em curso.
// `semEncomenda` = não contar a reserva desta encomenda (ao retomá-la).
function disponivel(p, semEncomenda = 0) {
  const reservado = db.prepare(
    "SELECT COALESCE(SUM(quantidade),0) n FROM int_encomendas WHERE projeto_id=? AND estado='aguarda_pagamento' AND atualizado_em>=? AND id<>?"
  ).get(p.id, limiteReserva(), semEncomenda).n;
  return Math.max(0, (p.stock || 0) - reservado);
}

// Vendidas até agora (para o painel).
function vendidas(projetoId) {
  return db.prepare("SELECT COALESCE(SUM(quantidade),0) n FROM int_encomendas WHERE projeto_id=? AND estado='pago'").get(projetoId).n;
}

function novoCodigo() {
  for (let i = 0; i < 20; i++) {
    const c = newCode();   // único entre as marcações; aqui confere-se nas encomendas
    if (!db.prepare('SELECT 1 FROM int_encomendas WHERE code=?').get(c)) return c;
  }
  throw new Error('Não foi possível gerar um código único');
}

// O cliente compra `quantidade` unidades de um artigo à venda.
function criar(cliente, projetoId, quantidade) {
  const q = U.toInt(quantidade);
  return db.transaction(() => {
    expirar();
    const p = db.prepare("SELECT * FROM int_projetos WHERE id=? AND tipo='vendas' AND visivel=1").get(U.toInt(projetoId));
    if (!p || !(p.stock > 0)) throw erro('Este artigo já não está à venda.', 404);
    if (!(q >= 1) || q > MAX_POR_COMPRA) throw erro('Escolha uma quantidade válida.');
    const livres = disponivel(p);
    if (!livres) throw erro('Este artigo esgotou entretanto. Volte a tentar daqui a pouco: uma reserva por pagar pode libertar-se.', 409);
    if (q > livres) throw erro(`Só há ${livres} ${livres === 1 ? 'unidade disponível' : 'unidades disponíveis'}.`, 409);
    const agora = new Date().toISOString();
    const code = novoCodigo();
    db.prepare(`INSERT INTO int_encomendas(code,client_id,projeto_id,titulo,preco_unit,quantidade,total,cliente_nome,cliente_email,cliente_tel,criado_em,atualizado_em)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(code, cliente.id, p.id, p.titulo, p.preco, q, p.preco * q, cliente.name || '', cliente.email || '', cliente.phone || '', agora, agora);
    return porCodigo(code);
  })();
}

const porCodigo = (code) => db.prepare('SELECT * FROM int_encomendas WHERE code=?').get(U.clean(String(code || ''), 12).toUpperCase());

// A encomenda com este código, se for desta conta. Uma reserva expirada volta
// a valer se ainda houver unidades (o cliente voltou a /pagar mais tarde).
function daConta(clientId, code) {
  const e = porCodigo(code);
  if (!e || e.client_id !== clientId) return null;
  if (e.estado === 'aguarda_pagamento' && e.atualizado_em < limiteReserva()) expirar();
  const atual = db.prepare('SELECT * FROM int_encomendas WHERE id=?').get(e.id);
  if (atual.estado === 'expirado') {
    const p = db.prepare('SELECT * FROM int_projetos WHERE id=?').get(atual.projeto_id);
    if (p && disponivel(p, atual.id) >= atual.quantidade) {
      db.prepare("UPDATE int_encomendas SET estado='aguarda_pagamento', atualizado_em=? WHERE id=?").run(new Date().toISOString(), atual.id);
      return db.prepare('SELECT * FROM int_encomendas WHERE id=?').get(atual.id);
    }
  }
  return atual;
}

// O IVA dos artigos: o do estúdio principal (o primeiro na lista), que é quem
// passa o recibo. O preço já inclui o imposto, como nas marcações.
function imposto() {
  const st = db.prepare('SELECT * FROM studios ORDER BY sort, id LIMIT 1').get() || {};
  return { st, taxa: st.vat_rate == null ? null : Number(st.vat_rate), nome: st.tax_name || 'IVA' };
}

// Para o ecrã de pagamento, no mesmo formato do resumo de uma marcação.
function resumo(e) {
  const { taxa, nome } = imposto();
  const total = e.estado === 'pago' ? 0 : e.total;
  const base = taxa == null ? total : r2(total / (1 + taxa / 100));
  const moeda = getSettings().currency || '';
  return {
    tipo: 'encomenda', code: e.code, status: e.estado, artigo: e.titulo, quantidade: e.quantidade, preco_unit: e.preco_unit,
    itens: [{ descricao: e.titulo, detalhe: `${e.quantidade} × ${e.preco_unit.toLocaleString('pt-PT')} ${moeda}`, valor: e.total }],
    ja_pago: e.estado === 'pago' ? e.total : 0, base, imposto: r2(total - base), taxa, imposto_nome: nome, total,
    moeda, pode_pagar: e.estado === 'aguarda_pagamento' && total > 0,
    reserva_min: RESERVA_MIN,
  };
}

// Pagamento confirmado (demonstração ou Stripe): a encomenda fica paga e as
// unidades saem do stock. Só conta uma vez.
function aposPagamento(code) {
  const e = porCodigo(code);
  if (!e || e.estado === 'pago') return e;
  const agora = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE int_encomendas SET estado='pago', pago_em=?, atualizado_em=? WHERE id=?").run(agora, agora, e.id);
    db.prepare('UPDATE int_projetos SET stock=MAX(0, COALESCE(stock,0)-?) WHERE id=?').run(e.quantidade, e.projeto_id);
  })();
  avisar(porCodigo(code)).catch((x) => console.error('aviso de compra:', x.message));
  return porCodigo(code);
}

// O cliente recebe a confirmação da compra no email da conta.
async function avisar(e) {
  if (!e.cliente_email) return;
  const s = getSettings();
  const moeda = s.currency || '';
  await require('../../backend/lib/notify').sendEmail({
    to: e.cliente_email,
    subject: `Compra confirmada — referência ${e.code}`,
    text: [
      `Olá ${e.cliente_nome},`,
      '',
      `Recebemos o pagamento da sua compra no ${s.business_name || 'estúdio'}.`,
      '',
      `Referência: ${e.code}`,
      `${e.quantidade} × ${e.titulo} — ${e.total.toLocaleString('pt-PT')} ${moeda}`,
      '',
      'O estúdio vai entrar em contacto consigo para combinar a entrega.',
      'Guarde esta referência: é por ela que o estúdio encontra a sua compra.',
    ].join('\n'),
  });
}

// O recibo (talão) de um pagamento de encomenda, no formato do das marcações,
// com "compra" no lugar de "marcacao".
function recibo(p, clientId) {
  const e = p && porCodigo(p.booking_code);
  if (!p || !e || p.estado !== 'pago' || (clientId && e.client_id !== clientId)) return null;
  const s = getSettings();
  const { st, taxa, nome } = imposto();
  const base = taxa == null ? p.valor : r2(p.valor / (1 + taxa / 100));
  return {
    id: p.id, numero: `${e.code}-${String(p.id).padStart(4, '0')}`, pago_em: p.atualizado_em, tipo: 'encomenda',
    empresa: {
      nome: s.business_name || '', frase: s.tagline || '', legal: st.legal_name || st.name || '', nif: st.nif || '',
      telefone: st.phone || s.phone || '', email: st.email || s.email || '', morada: [st.address, st.city].filter(Boolean).join(', '),
    },
    compra: { code: e.code, artigo: e.titulo, quantidade: e.quantidade, preco_unit: e.preco_unit, cliente: e.cliente_nome },
    valor: p.valor, base, imposto: r2(p.valor - base), taxa, imposto_nome: nome, moeda: s.currency || '',
    cartao: { marca: p.cartao_marca, ultimos: p.cartao_ultimos }, estado: 'APROVADO', demo: p.fornecedor === 'demo',
  };
}

// Para o painel: as encomendas de um artigo, das mais recentes.
function listar(projetoId) {
  expirar();
  return db.prepare('SELECT id, code, quantidade, total, cliente_nome, cliente_email, cliente_tel, estado, criado_em, pago_em FROM int_encomendas WHERE projeto_id=? ORDER BY id DESC LIMIT 200').all(projetoId);
}

module.exports = { criar, daConta, porCodigo, resumo, aposPagamento, recibo, disponivel, vendidas, listar, expirar, RESERVA_MIN };
