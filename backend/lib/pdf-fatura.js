'use strict';
// ---------------------------------------------------------------------------
// Fatura interna em PDF (pdfkit), no estilo do recibo.
//
// De cima para baixo: o cabeçalho (negócio à esquerda; o estúdio emitente à
// direita, com os dados guardados na própria fatura), o título com o número
// (FT 2026/3), o aviso de documento interno sem validade fiscal (ou de fatura
// anulada), os cartões do cliente e do documento, a linha faturada, o resumo
// (base, imposto, total) e o total em destaque.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const path = require('path');
const { TZ } = require('./util');

const LOGO = path.join(__dirname, '..', '..', 'publico', 'assets', 'img', 'logo.png');
const COR = {
  laranja: '#E5622A', pessego: '#FEF3E8', tinta: '#111827', suave: '#6B7280', linha: '#E5E7EB', zebra: '#F8F9FB', branco: '#FFFFFF',
};
const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinheiro = (n, cur) => `${cur || ''} ${nf.format(n || 0).replace(/\s/g, ' ')}`.trim();
const pct = (n) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(n) + '%';
const data = (iso) => new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });

// f: fatura (lib/faturas.obter); biz: definições do negócio; codigo: o código da marcação.
function gerar(res, f, biz, codigo) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, info: { Title: 'Fatura ' + f.numero_texto } });
  doc.pipe(res);
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
  const cur = f.moeda, e = f.emitente || {}, imp = f.imposto_nome || 'IVA';

  // -------------------------------------------------- Cabeçalho
  let y = doc.page.margins.top;
  let yEsq = y;
  try { doc.image(LOGO, L, y, { fit: [70, 52] }); yEsq = y + 58; } catch (_) { /* segue sem logótipo */ }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COR.tinta).text(biz.business_name || '', L, yEsq, { width: W / 2 });
  if (biz.tagline) doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(biz.tagline, L, doc.y + 2, { width: W / 2 });
  const fimEsq = doc.y;
  const rW = 230, rX = R - rW;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COR.laranja).text((e.nome || '').toUpperCase(), rX, y, { width: rW, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(COR.tinta);
  for (const linha of [e.nif && 'NIF: ' + e.nif, e.telefone && 'Tel: ' + e.telefone, e.email, e.morada].filter(Boolean)) {
    doc.text(linha, rX, doc.y + 2, { width: rW, align: 'right' });
  }
  y = Math.max(fimEsq, doc.y) + 14;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).strokeColor(COR.linha).stroke();

  // -------------------------------------------------- Título e número
  y += 14;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.tinta).text('Fatura', L, y);
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text('Emitida em ' + data(f.emitida_em), L, doc.y + 3);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COR.laranja).text(f.numero_texto, L, y + 2, { width: W, align: 'right' });
  y += 44;

  // -------------------------------------------------- Aviso
  const anulada = f.estado === 'anulada';
  const [fundo, tinta, titulo, frase] = anulada
    ? ['#FDE2E2', '#B91C1C', 'FATURA ANULADA', `Anulada em ${data(f.anulada_em)}. Motivo: ${f.motivo_anulacao}`]
    : ['#FEF3C7', '#92400E', 'DOCUMENTO INTERNO — SEM VALIDADE FISCAL',
      'Não foi emitida por software certificado nem comunicada ao e-Fatura. Não serve para efeitos fiscais.'];
  doc.roundedRect(L, y, W, 50, 8).fill(fundo);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(tinta).text(titulo, L + 16, y + 11);
  doc.font('Helvetica').fontSize(8).fillColor(tinta).text(frase, L + 16, y + 29, { width: W - 32, height: 14, ellipsis: true });
  y += 50 + 16;

  // -------------------------------------------------- Cartões
  const gap = 18, cW = (W - gap) / 2;
  const cartao = (x, tit, linhas) => {
    const alto = 34 + linhas.length * 19 + 6;
    doc.roundedRect(x, y, cW, alto, 8).lineWidth(0.8).strokeColor(COR.linha).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COR.laranja).text(tit, x + 12, y + 12, { characterSpacing: 0.3 });
    linhas.forEach(([k, v], i) => {
      const ly = y + 32 + i * 19;
      doc.font('Helvetica').fontSize(8).fillColor(COR.suave).text(k, x + 12, ly, { width: cW * 0.36 });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COR.tinta).text(String(v), x + 12 + cW * 0.36, ly, { width: cW * 0.64 - 24, align: 'right', height: 12, ellipsis: true });
    });
    return alto;
  };
  const a1 = cartao(L, 'CLIENTE', [
    ['Nome', f.cliente_nome], ['NIF', f.cliente_nif || 'Consumidor final'],
    f.cliente_morada && ['Morada', f.cliente_morada], f.cliente_email && ['Email', f.cliente_email],
  ].filter(Boolean));
  const a2 = cartao(L + cW + gap, 'DOCUMENTO', [
    ['Número', f.numero_texto], ['Data de emissão', data(f.emitida_em)],
    codigo && ['Marcação', codigo], ['Moeda', cur || '—'],
  ].filter(Boolean));
  y += Math.max(a1, a2) + 22;

  // -------------------------------------------------- Linha faturada
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COR.tinta).text('Descrição', L, y);
  y = doc.y + 8;
  const cols = [['Descrição', 0.46, 'left'], ['Qtd.', 0.08, 'right'], [`Preço s/ ${imp}`, 0.17, 'right'], [imp, 0.11, 'right'], ['Total', 0.18, 'right']];
  doc.rect(L, y, W, 28).fill(COR.laranja);
  let x = L;
  for (const [nome, frac, al] of cols) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.branco).text(nome, x + 10, y + 10, { width: W * frac - 20, align: al });
    x += W * frac;
  }
  y += 28;
  doc.font('Helvetica').fontSize(8.5);
  const desc = f.descricao;
  const altoL = Math.max(30, doc.heightOfString(desc, { width: W * 0.46 - 20 }) + 20);
  doc.rect(L, y, W, altoL).fill(COR.zebra);
  const celulas = [desc, '1', dinheiro(f.base, cur), pct(f.taxa), dinheiro(f.total, cur)];
  x = L;
  cols.forEach(([, frac, al], i) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(COR.tinta).text(celulas[i], x + 10, y + 10, { width: W * frac - 20, align: al });
    x += W * frac;
  });
  y += altoL + 14;

  // -------------------------------------------------- Resumo
  const rx = R - 240;
  for (const [k, v] of [['Base tributável', dinheiro(f.base, cur)], [`${imp} (${pct(f.taxa)})`, dinheiro(f.imposto, cur)], ['Total', dinheiro(f.total, cur)]]) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(k, rx, y, { width: 120 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.tinta).text(v, rx + 120, y, { width: 120, align: 'right' });
    y += 16;
  }
  y += 14;

  // -------------------------------------------------- Total
  doc.roundedRect(L, y, W, 52, 8).fill(COR.pessego);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.laranja).text(`TOTAL (${imp} INCLUÍDO)`, L + 16, y + 21, { characterSpacing: 0.4 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.laranja).text(dinheiro(f.total, cur), L, y + 17, { width: W - 16, align: 'right' });

  // -------------------------------------------------- Rodapé
  const fy = doc.page.height - 40;
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7).fillColor(COR.suave)
    .text(`${biz.business_name || ''} · Fatura ${f.numero_texto} · Documento interno, sem validade fiscal.`, L, fy, { width: W, align: 'center', lineBreak: false });
  doc.end();
}

module.exports = { gerar };
