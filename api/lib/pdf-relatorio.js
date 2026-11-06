'use strict';
// ---------------------------------------------------------------------------
// Relatório de marcações em PDF (pdfkit): a "Folha de Marcações". É usado pela
// rota GET /api/admin/reports.pdf, que o devolve como anexo.
//
// Layout (A4 deitado, como o recibo): à esquerda o logótipo, o nome e a frase
// do negócio; à direita os dados do estúdio (nome legal, NIF, telefone, email,
// morada — de Estúdios). Depois o título com o número de registos, a moeda e o
// período, a tabela das marcações (cabeçalho laranja, linhas alternadas, o
// cabeçalho repete-se em cada página), uma última linha com os totais e, em todas as
// páginas, o rodapé com a origem do documento e o número da página.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const path = require('path');

const LOGO = path.join(__dirname, '..', 'comum', 'assets', 'img', 'logo.png');
const STATUS_PT = { pedido: 'Pedido', aguarda_pagamento: 'Aguarda pagamento', confirmado: 'Confirmado', em_curso: 'Em curso', concluido: 'Concluído', cancelado: 'Cancelado', expirado: 'Expirado' };
const COR = {
  laranja: '#E5622A', pessego: '#FEF3E8', tinta: '#111827', suave: '#6B7280', linha: '#E5E7EB', zebra: '#F8F9FB', branco: '#FFFFFF',
};

const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dinheiro = (n, cur) => `${cur || ''} ${nf.format(n || 0).replace(/\s/g, ' ')}`.trim();
const ddmmaaaa = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const hm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const horas = (min) => { const v = (min || 0) / 60; return (Number.isInteger(v) ? v : v.toFixed(1)) + ' h'; };

// Colunas da folha: título, fração da largura, alinhamento e o valor de cada linha.
const COLUNAS = (cur) => [
  ['DATA MARCAÇÃO', 0.085, 'left', (b) => ddmmaaaa(b.created_at)],
  ['CÓDIGO', 0.07, 'left', (b) => b.code],
  ['CLIENTE', 0.13, 'left', (b) => b.client_name],
  ['ESTÚDIO / SALA', 0.135, 'left', (b) => `${b.studio_name}\n${b.room_name}`],
  ['SERVIÇO', 0.11, 'left', (b) => [b.service_name || 'Sessão', b.style].filter(Boolean).join('\n')],
  ['DATA SESSÃO', 0.08, 'left', (b) => ddmmaaaa(b.date)],
  ['HORÁRIO', 0.08, 'left', (b) => `${hm(b.start_min)}-${hm(b.end_min)}`],
  ['VALOR', 0.075, 'left', (b) => dinheiro(b.price, cur)],
  ['PAGO', 0.075, 'left', (b) => dinheiro(b.paid, cur)],
  ['EM FALTA', 0.075, 'left', (b) => (['cancelado', 'expirado'].includes(b.status) ? '—' : dinheiro(Math.max(0, b.price - b.paid), cur))],
  ['ESTADO', 0.085, 'left', (b) => STATUS_PT[b.status] || b.status],
];

// d: resultado de computeReport; ctx: { business, estudio, periodo, geradoEm, dominio, cur }
function gerar(res, d, ctx) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 60, left: 40, right: 40 }, bufferPages: true, info: { Title: 'Folha de Marcações' } });
  doc.pipe(res);
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
  const fundo = () => doc.page.height - doc.page.margins.bottom;
  const biz = ctx.business || {}, st = ctx.estudio || {}, cur = ctx.cur || '';

  // -------------------------------------------------- Cabeçalho
  let y = doc.page.margins.top;
  let yEsq = y;
  try { doc.image(LOGO, L, y, { fit: [64, 48] }); yEsq = y + 54; } catch (_) { /* segue sem logótipo */ }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COR.tinta).text(biz.business_name || '', L, yEsq, { width: W / 2 });
  if (biz.tagline) doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(biz.tagline, L, doc.y + 2, { width: W / 2 });
  const fimEsq = doc.y;
  const rW = 260, rX = R - rW;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COR.laranja)
    .text((st.legal_name || st.name || biz.business_name || '').toUpperCase(), rX, y, { width: rW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(COR.tinta);
  const morada = [st.address, st.city].filter(Boolean).join(', ');
  for (const linha of [st.nif && 'NIF: ' + st.nif, (st.phone || biz.phone) && 'Tel: ' + (st.phone || biz.phone), st.email || biz.email, morada].filter(Boolean)) {
    doc.text(linha, rX, doc.y + 2, { width: rW, align: 'right' });
  }
  y = Math.max(fimEsq, doc.y) + 12;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).strokeColor(COR.linha).stroke();

  // -------------------------------------------------- Título
  y += 14;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.tinta).text('Folha de Marcações', L, y);
  const n = d.rows.length;
  const sub = [`${n} ${n === 1 ? 'registo' : 'registos'}`, cur && 'Moeda: ' + cur, ctx.periodo].filter(Boolean).join(' • ');
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(sub + (d.limited ? ' (primeiros 500)' : ''), L, doc.y + 3);
  y = doc.y + 16;

  // -------------------------------------------------- Tabela
  const cols = COLUNAS(cur);
  const padX = 8, fs = 7.6;
  let acc = 0;
  const cx = cols.map(([, frac]) => { const o = { x: L + acc * W, w: frac * W }; acc += frac; return o; });
  const cabecalho = () => {
    const alto = 30;
    doc.rect(L, y, W, alto).fill(COR.laranja);
    cols.forEach(([titulo, , align], i) => doc.font('Helvetica-Bold').fontSize(7.6).fillColor(COR.branco)
      .text(titulo, cx[i].x + padX, y + 11, { width: cx[i].w - padX * 2, align, lineBreak: false }));
    y += alto;
  };

  if (!n) {
    doc.font('Helvetica').fontSize(10).fillColor(COR.suave).text('Sem marcações no período e filtros escolhidos.', L, y);
    y = doc.y + 16;
  } else {
    cabecalho();
    d.rows.forEach((b, idx) => {
      const valores = cols.map(([, , , f]) => String(f(b) ?? ''));
      doc.font('Helvetica').fontSize(fs);
      const alto = Math.max(...valores.map((v, i) => doc.heightOfString(v, { width: cx[i].w - padX * 2 }))) + 18;
      if (y + alto > fundo()) { doc.addPage(); y = doc.page.margins.top; cabecalho(); }
      if (idx % 2 === 0) doc.rect(L, y, W, alto).fill(COR.zebra);
      valores.forEach((v, i) => doc.font('Helvetica').fontSize(fs).fillColor(COR.tinta)
        .text(v, cx[i].x + padX, y + 9, { width: cx[i].w - padX * 2, align: cols[i][2] }));
      y += alto;
    });

    // -------------------------------------------------- Linha de totais
    // A soma de cada coluna de dinheiro, tal como está na folha (o "em falta"
    // das canceladas e expiradas não conta, porque lá aparece "—").
    const livre = (b) => ['cancelado', 'expirado'].includes(b.status);
    const soma = (f) => d.rows.reduce((s, b) => s + f(b), 0);
    const totais = {
      7: dinheiro(soma((b) => b.price || 0), cur),
      8: dinheiro(soma((b) => b.paid || 0), cur),
      9: dinheiro(soma((b) => (livre(b) ? 0 : Math.max(0, (b.price || 0) - (b.paid || 0)))), cur),
    };
    const altoT = 30;
    if (y + altoT > fundo()) { doc.addPage(); y = doc.page.margins.top; cabecalho(); }
    doc.rect(L, y, W, altoT).fill(COR.pessego);
    doc.font('Helvetica-Bold').fontSize(fs).fillColor(COR.laranja)
      .text(`${n} ${n === 1 ? 'sessão' : 'sessões'} · ${horas(d.totals.minutes)}`, cx[0].x + padX, y + 11, { width: cx[2].x + cx[2].w - cx[0].x - padX * 2, lineBreak: false })
      .text('TOTAIS:', cx[6].x + padX, y + 11, { width: cx[6].w - padX * 2, lineBreak: false });
    for (const [i, v] of Object.entries(totais)) {
      // Somas grandes não cabem a negrito: a letra encolhe até caber numa linha.
      const largura = cx[i].w - padX;
      let tam = fs;
      doc.font('Helvetica-Bold');
      while (tam > 5.5 && doc.fontSize(tam).widthOfString(v) > largura) tam -= 0.2;
      doc.fontSize(tam).fillColor(COR.laranja).text(v, cx[i].x + padX, y + 11 + (fs - tam) / 2, { width: largura, lineBreak: false });
    }
    y += altoT;
  }

  // -------------------------------------------------- Rodapé (todas as páginas)
  const plataforma = `Documento extraído da plataforma ${biz.business_name || ''}`
    + `${ctx.dominio ? ' (' + ctx.dominio + ')' : ''} — gerado em ${ctx.geradoEm}`;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Sem margem de baixo, o rodapé (desenhado nessa zona) não abre páginas novas.
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 44;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.6).strokeColor(COR.linha).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COR.suave)
      .text(plataforma, L, fy + 8, { width: W - 100, align: 'left', lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, R - 100, fy + 8, { width: 100, align: 'right', lineBreak: false });
  }
  doc.end();
}

module.exports = { gerar };
