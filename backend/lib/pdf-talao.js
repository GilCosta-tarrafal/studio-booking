'use strict';
// ---------------------------------------------------------------------------
// Recibo do pagamento feito no site, em PDF, com aspeto de talão: papel
// estreito (80 mm), letra mono, recorte em ziguezague, carimbo "PAGO" e um
// código de barras com o número do recibo. Leva o logótipo e os dados da
// empresa (nome, frase, nome legal, NIF, telefone, email e morada do estúdio).
// ---------------------------------------------------------------------------
const PDFDocument = require('pdfkit');
const path = require('path');
const crypto = require('crypto');
const { TZ } = require('./util');

const LOGO = path.join(__dirname, '..', '..', 'publico', 'assets', 'img', 'logo.png');
const LARG = 80 * 2.8346;           // 80 mm em pontos
const AZUL = '#2563EB', TINTA = '#111111', SUAVE = '#555555', FUNDO = '#E9E9EC';

const nf = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dinheiro = (n, cur) => `${nf.format(n || 0).replace(/\s/g, ' ')} ${cur || ''}`.trim();
const quando = (iso) => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).toUpperCase();

const soData = (iso) => new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });

// O talão tem a altura do que leva: uma primeira passagem (sem papel) mede-o
// e a segunda desenha-o com a altura certa.
function gerar(res, r) {
  const medida = new PDFDocument({ size: [LARG + 24, 2000], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  const alto = Math.ceil(desenhar(medida, r, 2000)) + 34;
  const doc = new PDFDocument({ size: [LARG + 24, alto], margins: { top: 0, bottom: 0, left: 0, right: 0 }, info: { Title: 'Recibo ' + r.numero } });
  doc.pipe(res);
  desenhar(doc, r, alto);
  doc.end();
}

// Desenha o talão e devolve até onde chegou (o y do fim do texto).
function desenhar(doc, r, ALT) {
  const X = 12, W = LARG, P = 14;            // papel: de X a X+W; P = margem interior
  const L = X + P, R = X + W - P, CW = R - L;

  // Fundo e papel com recorte em ziguezague em cima e em baixo.
  doc.rect(0, 0, LARG + 24, ALT).fill(FUNDO);
  const dente = 6, topo = 12, fundo = ALT - 12;
  doc.moveTo(X, topo + dente);
  for (let x = X; x < X + W; x += dente * 2) doc.lineTo(x + dente, topo).lineTo(Math.min(x + dente * 2, X + W), topo + dente);
  doc.lineTo(X + W, fundo - dente);
  for (let x = X + W; x > X; x -= dente * 2) doc.lineTo(x - dente, fundo).lineTo(Math.max(x - dente * 2, X), fundo - dente);
  doc.closePath().fill('#FFFFFF');

  let y = topo + 22;
  const centro = (txt, { fonte = 'Courier', tam = 7.5, cor = TINTA, esp = 0 } = {}) => {
    doc.font(fonte).fontSize(tam).fillColor(cor).text(txt, L, y, { width: CW, align: 'center', characterSpacing: esp });
    y = doc.y + 2;
  };
  const linha = (k, v, { negrito = false, tam = 7.5 } = {}) => {
    doc.font('Courier').fontSize(tam).fillColor(SUAVE).text(k, L, y, { width: CW * 0.45, lineBreak: false });
    doc.font(negrito ? 'Courier-Bold' : 'Courier').fontSize(tam).fillColor(TINTA).text(v, L + CW * 0.4, y, { width: CW * 0.6, align: 'right' });
    y = doc.y + 3;
  };
  const tracejado = () => {
    y += 4;
    doc.moveTo(L, y).lineTo(R, y).dash(2, { space: 2 }).lineWidth(0.6).strokeColor('#999').stroke().undash();
    y += 8;
  };

  // -------------------------------------------------- Empresa
  try { doc.image(LOGO, X + W / 2 - 22, y, { fit: [44, 44] }); y += 50; } catch (_) { /* sem logótipo */ }
  centro(r.empresa.nome.toUpperCase(), { fonte: 'Courier-Bold', tam: 12, esp: 2 });
  if (r.empresa.frase) centro(r.empresa.frase, { tam: 6.5, cor: SUAVE });
  y += 2;
  if (r.empresa.legal && r.empresa.legal !== r.empresa.nome) centro(r.empresa.legal, { tam: 6.5 });
  for (const t of [r.empresa.nif && 'NIF ' + r.empresa.nif, r.empresa.telefone && 'Tel ' + r.empresa.telefone, r.empresa.email, r.empresa.morada].filter(Boolean)) centro(t, { tam: 6.5, cor: SUAVE });
  y += 4;
  centro('RECIBO DE PAGAMENTO', { fonte: 'Courier-Bold', tam: 7.5, esp: 1.2 });
  tracejado();

  // -------------------------------------------------- Dados
  linha('RECIBO', r.numero);
  linha('DATA', quando(r.pago_em));
  if (r.compra) {
    // Compra na loja do site (rotas/loja.js): o artigo e a quantidade.
    const c = r.compra;
    linha('COMPRA', c.code);
    linha('CLIENTE', c.cliente);
    tracejado();
    linha(c.artigo, dinheiro(r.valor, r.moeda));
    linha('Quantidade', `${c.quantidade} × ${dinheiro(c.preco_unit, r.moeda)}`);
  } else {
    const m = r.marcacao;
    linha('ESTÚDIO', m.studio);
    linha('SALA', m.room);
    linha('MARCAÇÃO', m.code);
    linha('SESSÃO', `${m.date.split('-').reverse().join('/')} ${m.start}-${m.end}`);
    linha('CLIENTE', m.cliente);
    tracejado();
    linha(m.servico, dinheiro(r.valor, r.moeda));
    linha('Duração', `${m.minutos / 60} h`);
  }
  if (r.taxa != null) {
    linha('Base', dinheiro(r.base, r.moeda));
    linha(`${r.imposto_nome} ${nf.format(r.taxa).replace(',00', '')}%`, dinheiro(r.imposto, r.moeda));
  }
  tracejado();

  // -------------------------------------------------- Total e carimbo
  doc.font('Courier-Bold').fontSize(11).fillColor(TINTA).text('TOTAL', L, y + 6);
  doc.font('Courier-Bold').fontSize(13).fillColor(TINTA).text(dinheiro(r.valor, r.moeda), L, y + 4, { width: CW, align: 'right' });
  const cx = L + CW * 0.3, cy = y + 13;
  doc.save().rotate(-14, { origin: [cx, cy] });
  doc.circle(cx, cy, 19).lineWidth(1.6).strokeColor(AZUL).stroke();
  doc.circle(cx, cy, 15.5).lineWidth(0.6).strokeColor(AZUL).stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(AZUL).text('PAGO', cx - 18, cy - 5, { width: 36, align: 'center' });
  doc.font('Helvetica').fontSize(4).fillColor(AZUL).text(soData(r.pago_em), cx - 18, cy + 5, { width: 36, align: 'center' });
  doc.restore();
  y += 34;
  linha('PAGO COM', r.cartao.ultimos ? `${String(r.cartao.marca || '').toUpperCase()} •••• ${r.cartao.ultimos}` : '—');
  linha('ESTADO', r.estado, { negrito: true });
  if (r.demo) centro('DEMONSTRAÇÃO — NADA FOI COBRADO', { tam: 6, cor: '#B45309' });
  y += 8;

  // -------------------------------------------------- Código de barras
  // Barras tiradas do número do recibo (visual); o número fica por baixo.
  const bits = crypto.createHash('sha256').update(r.numero).digest();
  let bx = L + 6;
  const fim = R - 6;
  let i = 0;
  while (bx < fim) {
    const w = 0.6 + (bits[i % bits.length] % 3) * 0.7;
    if (i % 2 === 0) doc.rect(bx, y, w, 34).fill(TINTA);
    bx += w + 0.6 + (bits[(i + 7) % bits.length] % 2) * 0.6;
    i++;
  }
  y += 40;
  centro(r.numero.split('').join(' '), { tam: 6.5, cor: SUAVE, esp: 0.5 });
  y += 6;
  centro(`Obrigado por gravar com ${r.empresa.nome || 'o estúdio'}.`, { tam: 6.5, cor: SUAVE });
  return y;
}

module.exports = { gerar };
