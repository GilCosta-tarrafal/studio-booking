'use strict';
// ---------------------------------------------------------------------------
// Gera o relatório de marcações em PDF (pdfkit) e envia-o na resposta. É usado
// pela rota GET /api/admin/reports.pdf, que o devolve como anexo — o navegador
// guarda o ficheiro diretamente, sem abrir a janela de impressão.
//
// Layout: papel timbrado (logótipo + nome à esquerda, contactos da sede à
// direita), título e período, os totais e as repartições em tabelas, e um
// rodapé repetido em cada página com a origem do documento e o número de página.
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const path = require('path');

const LOGO = path.join(__dirname, '..', '..', 'publico', 'assets', 'img', 'logo.png');
const STATUS_PT = { pedido: 'Pedido', confirmado: 'Confirmado', em_curso: 'Em curso', concluido: 'Concluído', cancelado: 'Cancelado' };

const nf = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const money = (n, cur) => nf.format(n || 0).replace(/ /g, ' ') + (cur ? ' ' + cur : '');
const horas = (min) => { const v = (min || 0) / 60; return (Number.isInteger(v) ? v : v.toFixed(1)) + ' h'; };
const mesLabel = (m) => m.slice(5) + '/' + m.slice(0, 4);

function gerar(res, d, ctx) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 64, left: 40, right: 40 }, bufferPages: true });
  doc.pipe(res);

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const bottomY = () => doc.page.height - doc.page.margins.bottom;
  const INK = '#111', MUTED = '#555', LINE = '#cfcfcf', HEAD = '#f2f2f2';

  // -------------------------------------------------- Papel timbrado
  const topY = doc.page.margins.top;
  try { doc.image(LOGO, L, topY, { width: 46, height: 46 }); } catch (_) { /* segue sem logótipo */ }
  const marcaX = L + 58, marcaW = W - 58 - 220;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(ctx.business.business_name || 'Relatório', marcaX, topY + 2, { width: marcaW });
  if (ctx.business.tagline) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(ctx.business.tagline, marcaX, doc.y + 1, { width: marcaW });
  const leftBottom = doc.y;

  const rW = 220, rX = R - rW;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(ctx.business.business_name || '', rX, topY, { width: rW, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  for (const c of ctx.contactos) doc.text(c, rX, doc.y + 1, { width: rW, align: 'right' });
  const lhY = Math.max(topY + 50, leftBottom, doc.y) + 6;
  doc.moveTo(L, lhY).lineTo(R, lhY).lineWidth(1.3).strokeColor('#333').stroke();

  // -------------------------------------------------- Título
  let y = lhY + 12;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('Relatório de marcações', L, y, { width: W - 240 });
  const tituloBottom = doc.y;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(ctx.periodo + ' · Gerado em ' + ctx.geradoEm.split(',')[0], R - 240, y + 4, { width: 240, align: 'right' });
  y = Math.max(tituloBottom, y + 18) + 10;

  // -------------------------------------------------- Ajudantes de tabela
  const ensure = (need) => { if (y + need > bottomY()) { doc.addPage(); y = doc.page.margins.top; } };
  function heading(txt) {
    ensure(22);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(txt, L, y);
    y = doc.y + 3;
  }
  // cols: [{ title, align, w (fração de W), bold }]; linhas: [[c0, c1, ...]]
  function tabela(cols, linhas) {
    const rowH = 17, padX = 10;
    const temCab = cols.some((c) => c.title);
    ensure((temCab ? rowH : 0) + linhas.length * rowH + 4);
    const top = y;
    let acc = 0;
    const cx = cols.map((c) => { const o = { x: L + acc * W, w: c.w * W, align: c.align, bold: c.bold }; acc += c.w; return o; });
    let ry = top;
    if (temCab) {
      doc.rect(L, ry, W, rowH).fillColor(HEAD).fill();
      cols.forEach((c, i) => doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#444')
        .text(c.title || '', cx[i].x + padX, ry + 5, { width: cx[i].w - padX * 2, align: c.align, lineBreak: false }));
      ry += rowH;
    }
    linhas.forEach((ln) => {
      if (ry > top + (temCab ? rowH : 0)) doc.moveTo(L, ry).lineTo(R, ry).lineWidth(0.4).strokeColor('#e8e8e8').stroke();
      ln.forEach((val, i) => doc.font(cx[i].bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(cx[i].bold ? INK : '#333')
        .text(String(val), cx[i].x + padX, ry + 5, { width: cx[i].w - padX * 2, align: cx[i].align, lineBreak: false }));
      ry += rowH;
    });
    doc.rect(L, top, W, ry - top).lineWidth(0.8).strokeColor(LINE).stroke();
    y = ry + 12;
  }

  // -------------------------------------------------- Conteúdo
  if (!d.totals.sessions) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Sem marcações no período e filtros escolhidos.', L, y);
  } else {
    const canc = d.byStatus.find((s) => s.status === 'cancelado');
    const perdido = canc ? canc.billed : 0;
    const col2 = [{ w: 0.62, align: 'left' }, { w: 0.38, align: 'right', bold: true }];

    heading('Finanças');
    tabela(col2, [
      ['Faturado', money(d.totals.billed, ctx.cur)],
      ['Recebido', money(d.totals.received, ctx.cur)],
      ['Por receber', money(d.totals.outstanding, ctx.cur)],
      ['Perdido em cancelamentos', money(perdido, ctx.cur)],
    ]);

    heading('Fluxo de marcações');
    tabela(col2, [
      ['Sessões', String(d.totals.sessions)],
      ['Horas reservadas', horas(d.totals.minutes)],
      ['Clientes', String(d.totals.clients)],
    ]);

    const col4 = (label0) => [
      { title: label0, w: 0.40, align: 'left' },
      { title: 'Sessões', w: 0.16, align: 'right' },
      { title: 'Faturado', w: 0.22, align: 'right' },
      { title: 'Recebido', w: 0.22, align: 'right' },
    ];
    const reparticao = (titulo, label0, linhas) => {
      if (!linhas.length) return;
      heading(titulo);
      tabela(col4(label0), linhas.map((r) => [r.l, String(r.s), money(r.b, ctx.cur), money(r.r, ctx.cur)]));
    };
    reparticao('Por estado', 'Estado', d.byStatus.map((s) => ({ l: STATUS_PT[s.status] || s.status, s: s.sessions, b: s.billed, r: s.received })));
    if (d.byStudio.length > 1) reparticao('Por estúdio', 'Estúdio', d.byStudio.map((s) => ({ l: s.name, s: s.sessions, b: s.billed, r: s.received })));
    reparticao('Por serviço', 'Serviço', d.byService.map((s) => ({ l: s.name, s: s.sessions, b: s.billed, r: s.received })));
    if (d.byMonth.length > 1) reparticao('Por mês', 'Mês', d.byMonth.map((s) => ({ l: mesLabel(s.month), s: s.sessions, b: s.billed, r: s.received })));
  }

  // -------------------------------------------------- Rodapé (todas as páginas)
  const plataforma = `Documento extraído da plataforma ${ctx.business.business_name || ''}`
    + `${ctx.dominio ? ' (' + ctx.dominio + ')' : ''} — gerado em ${ctx.geradoEm}`;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Sem margem inferior, o texto do rodapé (desenhado na zona da margem) não
    // faz o pdfkit criar páginas novas.
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 48;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#777')
      .text(plataforma, L, fy + 6, { width: W - 90, align: 'left', lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, R - 90, fy + 6, { width: 90, align: 'right', lineBreak: false });
  }

  doc.end();
}

module.exports = { gerar };
