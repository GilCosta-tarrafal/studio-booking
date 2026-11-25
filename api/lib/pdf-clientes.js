'use strict';
// ---------------------------------------------------------------------------
// Lista de clientes em PDF (pdfkit), para a rota GET /api/admin/clients.pdf.
// Mesmo aspeto da Folha de Marcações (pdf-relatorio.js): cabeçalho com os
// dados do estúdio, tabela de cabeçalho laranja e linhas alternadas, totais
// no fim e rodapé com a origem do documento em todas as páginas.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const { cabecalhoDoc, rodapeDoc, COR, dinheiro, ddmmaaaa } = require('./pdf-relatorio');

// O email vai por baixo do nome, na coluna do cliente (como no painel).
const COLUNAS = (cur) => [
  ['CLIENTE', 0.38, 'left', (c) => c.name],
  ['TELEFONE', 0.17, 'left', (c) => c.phone || '—'],
  ['SESSÕES', 0.12, 'right', (c) => String(c.sessions)],
  ['TOTAL PAGO', 0.17, 'right', (c) => dinheiro(c.paid, cur)],
  ['ÚLTIMA SESSÃO', 0.16, 'right', (c) => (c.last ? ddmmaaaa(c.last) : '—')],
];
const FS_EMAIL = 7.4;

// clientes: a lista de /clients (já filtrada); ctx: { business, estudio, geradoEm, dominio, cur, pesquisa, lingua }
function gerar(res, clientes, ctx) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 60, left: 40, right: 40 }, bufferPages: true, info: { Title: 'Lista de Clientes' } });
  require('./pdf-i18n').traduzirDoc(doc, ctx.lingua);
  doc.pipe(res);
  const L = doc.page.margins.left, R = doc.page.width - doc.page.margins.right, W = R - L;
  const fundo = () => doc.page.height - doc.page.margins.bottom;
  const cur = ctx.cur || '';

  let y = cabecalhoDoc(doc, ctx) + 14;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COR.tinta).text('Lista de Clientes', L, y);
  const n = clientes.length;
  const sub = [`${n} ${n === 1 ? 'cliente' : 'clientes'}`, cur && 'Moeda: ' + cur, ctx.pesquisa && `Pesquisa: "${ctx.pesquisa}"`].filter(Boolean).join(' • ');
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.suave).text(sub, L, doc.y + 3);
  y = doc.y + 16;

  const cols = COLUNAS(cur);
  const padX = 8, fs = 8.4;
  let acc = 0;
  const cx = cols.map(([, frac]) => { const o = { x: L + acc * W, w: frac * W }; acc += frac; return o; });
  const cabecalho = () => {
    const alto = 28;
    doc.rect(L, y, W, alto).fill(COR.laranja);
    cols.forEach(([titulo, , align], i) => doc.font('Helvetica-Bold').fontSize(7.6).fillColor(COR.branco)
      .text(titulo, cx[i].x + padX, y + 10, { width: cx[i].w - padX * 2, align, lineBreak: false }));
    y += alto;
  };

  if (!n) {
    doc.font('Helvetica').fontSize(10).fillColor(COR.suave).text('Nenhum cliente encontrado.', L, y);
  } else {
    cabecalho();
    clientes.forEach((c, idx) => {
      const valores = cols.map(([, , , f]) => String(f(c) ?? ''));
      const larg = (i) => cx[i].w - padX * 2;
      const altoNome = doc.font('Helvetica-Bold').fontSize(fs).heightOfString(valores[0], { width: larg(0) });
      const altoEmail = c.email ? 2 + doc.font('Helvetica').fontSize(FS_EMAIL).heightOfString(c.email, { width: larg(0) }) : 0;
      doc.font('Helvetica').fontSize(fs);
      const alto = Math.max(altoNome + altoEmail, ...valores.slice(1).map((v, i) => doc.heightOfString(v, { width: larg(i + 1) }))) + 16;
      if (y + alto > fundo()) { doc.addPage(); y = doc.page.margins.top; cabecalho(); }
      if (idx % 2 === 0) doc.rect(L, y, W, alto).fill(COR.zebra);
      doc.font('Helvetica-Bold').fontSize(fs).fillColor(COR.tinta).text(valores[0], cx[0].x + padX, y + 8, { width: larg(0) });
      if (c.email) doc.font('Helvetica').fontSize(FS_EMAIL).fillColor(COR.suave).text(c.email, cx[0].x + padX, y + 8 + altoNome + 2, { width: larg(0) });
      valores.slice(1).forEach((v, j) => doc.font('Helvetica').fontSize(fs).fillColor(COR.tinta)
        .text(v, cx[j + 1].x + padX, y + 8, { width: larg(j + 1), align: cols[j + 1][2] }));
      y += alto;
    });

    const altoT = 28;
    if (y + altoT > fundo()) { doc.addPage(); y = doc.page.margins.top; cabecalho(); }
    doc.rect(L, y, W, altoT).fill(COR.pessego);
    const sessoes = clientes.reduce((s, c) => s + c.sessions, 0);
    const pago = clientes.reduce((s, c) => s + c.paid, 0);
    doc.font('Helvetica-Bold').fontSize(fs).fillColor(COR.laranja)
      .text('TOTAIS:', cx[0].x + padX, y + 10, { width: cx[0].w, lineBreak: false })
      .text(String(sessoes), cx[2].x + padX, y + 10, { width: cx[2].w - padX * 2, align: 'right', lineBreak: false })
      .text(dinheiro(pago, cur), cx[3].x + padX, y + 10, { width: cx[3].w - padX * 2, align: 'right', lineBreak: false });
  }

  rodapeDoc(doc, ctx);
  doc.end();
}

module.exports = { gerar };
