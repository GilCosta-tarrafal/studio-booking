'use strict';
// ---------------------------------------------------------------------------
// Recibo de uma marcação em PDF (pdfkit), para o painel e para o cliente.
//
// Layout (de cima para baixo): à esquerda o logótipo, o nome e a frase do
// negócio; à direita os dados do estúdio onde é a sessão (nome legal, NIF,
// telefone, email e morada — preenchidos em Estúdios). Depois o título com a
// data de emissão, a referência da marcação em destaque, uma faixa com o
// estado, dois cartões (dados da marcação e da sessão), a tabela do serviço,
// o resumo do pagamento e, no fim, o total pago em destaque.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const path = require('path');
const { TZ } = require('./util');

const LOGO = path.join(__dirname, '..', 'comum', 'assets', 'img', 'logo.png');

const COR = {
  laranja: '#E5622A', pessego: '#FEF3E8', tinta: '#111827', suave: '#6B7280', linha: '#E5E7EB',
  zebra: '#F8F9FB', branco: '#FFFFFF',
};
// Faixa do estado: cor de fundo, cor do texto, título e frase.
const FAIXA = {
  pedido: ['#FEF3C7', '#92400E', 'A AGUARDAR CONFIRMAÇÃO', 'O estúdio ainda não confirmou esta marcação.'],
  aguarda_pagamento: ['#FEF3C7', '#92400E', 'AGUARDA PAGAMENTO', 'O estúdio aceitou: falta só o pagamento para a marcação ficar confirmada.'],
  confirmado: ['#DCFCE7', '#166534', 'MARCAÇÃO CONFIRMADA', 'O horário está reservado para esta sessão.'],
  em_curso: ['#DCFCE7', '#166534', 'SESSÃO EM CURSO', 'A sessão está a decorrer.'],
  concluido: ['#E0F2FE', '#075985', 'SESSÃO CONCLUÍDA', 'A sessão já foi realizada.'],
  cancelado: ['#FDE2E2', '#B91C1C', 'MARCAÇÃO CANCELADA', 'Esta marcação foi cancelada e não é válida para a sessão.'],
  expirado: ['#FDE2E2', '#B91C1C', 'MARCAÇÃO EXPIRADA', 'O pedido não foi confirmado a tempo e não é válido para a sessão.'],
};
const ESTADO = { pedido: 'Pedido', aguarda_pagamento: 'Aguarda pagamento', confirmado: 'Confirmado', em_curso: 'Em curso', concluido: 'Concluído', cancelado: 'Cancelado', expirado: 'Expirado' };

const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dinheiro = (n, cur) => `${cur || ''} ${nf.format(n || 0).replace(/\s/g, ' ')}`.trim();
const ddmmaaaa = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const hm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const duracao = (min) => { const h = Math.floor(min / 60), m = min % 60; return (h ? h + ' h' : '') + (m ? (h ? ' ' : '') + m + ' min' : '') || '0 min'; };

// b: marcação (BOOKING_SELECT + start/end); st: estúdio; biz: definições do
// negócio; nomes: { client_type, payment_method, project_type } já por extenso.
function gerar(res, b, st, biz, nomes = {}) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, info: { Title: 'Recibo ' + b.code } });
  doc.pipe(res);
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
  const cur = b.currency || biz.currency || '';   // a moeda da marcação (a do estúdio)

  // -------------------------------------------------- Cabeçalho
  let y = doc.page.margins.top;
  let yEsq = y;
  try { doc.image(LOGO, L, y, { fit: [70, 52] }); yEsq = y + 58; } catch (_) { /* segue sem logótipo */ }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COR.tinta).text(biz.business_name || '', L, yEsq, { width: W / 2 });
  if (biz.tagline) doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(biz.tagline, L, doc.y + 2, { width: W / 2 });
  const fimEsq = doc.y;

  // À direita, os dados do estúdio onde decorre a sessão.
  const rW = 230, rX = R - rW;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COR.laranja)
    .text((st.legal_name || st.name || '').toUpperCase(), rX, y, { width: rW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(COR.tinta);
  const morada = [st.address, st.city].filter(Boolean).join(', ');
  for (const linha of [st.nif && 'NIF: ' + st.nif, st.phone && 'Tel: ' + st.phone, st.email, morada].filter(Boolean)) {
    doc.text(linha, rX, doc.y + 2, { width: rW, align: 'right' });
  }
  y = Math.max(fimEsq, doc.y) + 14;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).strokeColor(COR.linha).stroke();

  // -------------------------------------------------- Título
  y += 14;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.tinta).text('Recibo de Marcação', L, y);
  const agora = new Date();
  const emitido = agora.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ });
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text('Emitido em ' + emitido, L, doc.y + 3);
  y = doc.y + 16;

  // -------------------------------------------------- Referência
  doc.roundedRect(L, y, W, 56, 8).fill(COR.pessego);
  doc.font('Helvetica').fontSize(7.5).fillColor(COR.laranja).text('REFERÊNCIA DA MARCAÇÃO', L + 16, y + 12, { characterSpacing: 0.4 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COR.laranja).text(b.code, L + 16, y + 24);
  y += 56 + 16;

  // -------------------------------------------------- Estado
  const [fundo, tinta, titulo, frase] = FAIXA[b.status] || FAIXA.pedido;
  doc.roundedRect(L, y, W, 50, 8).fill(fundo);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(tinta).text(titulo, L + 16, y + 11);
  doc.font('Helvetica').fontSize(8).fillColor(tinta).text(frase, L + 16, y + 29, { width: W - 32 });
  y += 50 + 16;

  // -------------------------------------------------- Dois cartões
  const gap = 18, cW = (W - gap) / 2;
  const cartao = (x, titulo, linhas) => {
    const alto = 34 + linhas.length * 19 + 6;
    doc.roundedRect(x, y, cW, alto, 8).lineWidth(0.8).strokeColor(COR.linha).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COR.laranja).text(titulo, x + 12, y + 12, { characterSpacing: 0.3 });
    linhas.forEach(([k, v], i) => {
      const ly = y + 32 + i * 19;
      doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(k, x + 12, ly, { width: cW * 0.42 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.tinta).text(String(v), x + 12 + cW * 0.42, ly, { width: cW * 0.58 - 24, align: 'right', height: 12, ellipsis: true });
    });
    return alto;
  };
  const dados = [
    ['Cliente', b.client_name],
    b.client_phone && ['Telefone', b.client_phone],
    b.client_email && ['Email', b.client_email],
    nomes.client_type && ['Tipo de cliente', nomes.client_type],
    ['Estado', ESTADO[b.status] || b.status],
    ['Total pago', dinheiro(b.paid, cur)],
    nomes.payment_method && ['Método de pagamento', nomes.payment_method],
  ].filter(Boolean);
  const sessao = [
    ['Estúdio', b.studio_name],
    ['Sala', b.room_name],
    ['Data', ddmmaaaa(b.date)],
    ['Horário', `${hm(b.start_min)} - ${hm(b.end_min)}`],
    ['Duração', duracao(b.end_min - b.start_min)],
    ['Modo', b.remote ? 'À distância' : 'Presencial'],
  ];
  const a1 = cartao(L, 'DADOS DA MARCAÇÃO', dados);
  const a2 = cartao(L + cW + gap, 'INFORMAÇÃO DA SESSÃO', sessao);
  y += Math.max(a1, a2) + 22;

  // -------------------------------------------------- Serviço (tabela)
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COR.tinta).text('Serviço', L, y);
  y = doc.y + 8;
  const cols = [['Descrição', 0.40], ['Projeto', 0.24], ['Género', 0.16], ['Valor', 0.20]];
  const cab = 28, lin = 30;
  doc.rect(L, y, W, cab).fill(COR.laranja);
  let x = L;
  for (const [nome, frac] of cols) {
    const largura = W * frac;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.branco)
      .text(nome, x + 10, y + 10, { width: largura - 20, align: nome === 'Valor' ? 'right' : 'left' });
    x += largura;
  }
  y += cab;
  doc.rect(L, y, W, lin).fill(COR.zebra);
  const descricao = b.service_name || 'Sessão em estúdio';
  const projeto = [b.title, nomes.project_type].filter(Boolean).join(' · ') || '—';
  const celulas = [descricao, projeto, b.style || '—', dinheiro(b.price, cur)];
  x = L;
  cols.forEach(([nome, frac], i) => {
    const largura = W * frac;
    doc.font('Helvetica').fontSize(8.5).fillColor(COR.tinta)
      .text(celulas[i], x + 10, y + 11, { width: largura - 20, align: nome === 'Valor' ? 'right' : 'left', height: 12, ellipsis: true });
    x += largura;
  });
  y += lin + 14;

  // -------------------------------------------------- Resumo do pagamento
  const falta = Math.max(0, (b.price || 0) - (b.paid || 0));
  const resumo = [['Valor total', dinheiro(b.price, cur)], ['Já pago', dinheiro(b.paid, cur)]];
  if (!['cancelado', 'expirado'].includes(b.status)) resumo.push(['Em falta', dinheiro(falta, cur)]);
  const rx = R - 220;
  for (const [k, v] of resumo) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(k, rx, y, { width: 110 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.tinta).text(v, rx + 110, y, { width: 110, align: 'right' });
    y += 16;
  }
  y += 14;

  // -------------------------------------------------- Total pago
  doc.roundedRect(L, y, W, 52, 8).fill(COR.pessego);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.laranja).text('TOTAL PAGO', L + 16, y + 21, { characterSpacing: 0.4 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.laranja).text(dinheiro(b.paid, cur), L, y + 17, { width: W - 16, align: 'right' });
  y += 52 + 18;

  if (b.notes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.suave).text('Mensagem do cliente', L, y);
    doc.font('Helvetica').fontSize(8).fillColor(COR.tinta).text(b.notes, L, doc.y + 3, { width: W });
  }

  // -------------------------------------------------- Rodapé
  // Escrito abaixo da margem de baixo: sem margem, o pdfkit não abre outra página.
  const fy = doc.page.height - 40;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7).fillColor(COR.suave)
    .text(`${biz.business_name || ''} · Recibo da marcação ${b.code}${nomes.fatura ? ' · Fatura ' + nomes.fatura : ''}.`, L, fy, { width: W, align: 'center', lineBreak: false });
  doc.end();
}

// Junta o que o recibo precisa (estúdio, definições, nomes dos catálogos) e
// envia o PDF como anexo. `row` vem de BOOKING_SELECT.
function enviar(res, row) {
  const { db, getSettings } = require('./db');
  const st = db.prepare('SELECT * FROM studios WHERE id=?').get(row.studio_id) || {};
  const nome = (catalogo, codigo) => (codigo
    ? (db.prepare('SELECT nome FROM catalogo_itens WHERE catalogo=? AND codigo=?').get(catalogo, codigo) || {}).nome || codigo
    : '');
  const nomes = {
    client_type: nome('tipos_cliente', row.client_type),
    payment_method: nome('metodos_pagamento', row.payment_method),
    project_type: nome('tipos_projeto', row.project_type),
    // A fatura em vigor desta marcação, se houver (fica no rodapé do recibo).
    fatura: (() => { const f = db.prepare("SELECT serie, numero FROM faturas WHERE booking_id=? AND estado='emitida'").get(row.id); return f ? `${f.serie}/${f.numero}` : ''; })(),
  };
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="recibo-${row.code}.pdf"` });
  gerar(res, row, st, getSettings(), nomes);
}

module.exports = { gerar, enviar };
