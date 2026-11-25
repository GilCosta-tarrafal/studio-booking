'use strict';
// ---------------------------------------------------------------------------
// Os PDFs (recibo, talão, fatura, folha de marcações e lista de clientes) em
// inglês e francês.
//
// Os geradores escrevem os rótulos em português, como sempre. Aqui envolve-se
// o doc.text do pdfkit: cada texto escrito passa pela tabela e, se a língua não
// for o português, sai traduzido. Os dados (nomes, códigos, valores) não estão
// na tabela e ficam como estão. É o mesmo princípio do tradutor do painel.
//
// A língua vem de quem pede o PDF: o cliente no site (cookie "lingua") ou a
// equipa no painel (a língua do painel). O que não estiver aqui fica em português.
// ---------------------------------------------------------------------------

// Português → [inglês, francês].
const MAPA = {
  // Estados
  'Pedido': ['Request', 'Demande'],
  'Aguarda pagamento': ['Awaiting payment', 'En attente de paiement'],
  'Confirmado': ['Confirmed', 'Confirmée'],
  'Em curso': ['In progress', 'En cours'],
  'Concluído': ['Completed', 'Terminée'],
  'Cancelado': ['Cancelled', 'Annulée'],
  'Expirado': ['Expired', 'Expirée'],
  // Recibo da marcação
  'Recibo de Marcação': ['Booking Receipt', 'Reçu de réservation'],
  'REFERÊNCIA DA MARCAÇÃO': ['BOOKING REFERENCE', 'RÉFÉRENCE DE LA RÉSERVATION'],
  'A AGUARDAR CONFIRMAÇÃO': ['AWAITING CONFIRMATION', 'EN ATTENTE DE CONFIRMATION'],
  'O estúdio ainda não confirmou esta marcação.': ['The studio has not confirmed this booking yet.', 'Le studio n’a pas encore confirmé cette réservation.'],
  'AGUARDA PAGAMENTO': ['AWAITING PAYMENT', 'EN ATTENTE DE PAIEMENT'],
  'O estúdio aceitou: falta só o pagamento para a marcação ficar confirmada.': ['The studio accepted: only payment is missing for the booking to be confirmed.', 'Le studio a accepté : il ne manque que le paiement pour confirmer la réservation.'],
  'MARCAÇÃO CONFIRMADA': ['BOOKING CONFIRMED', 'RÉSERVATION CONFIRMÉE'],
  'O horário está reservado para esta sessão.': ['The time is reserved for this session.', 'Le créneau est réservé pour cette séance.'],
  'SESSÃO EM CURSO': ['SESSION IN PROGRESS', 'SÉANCE EN COURS'],
  'A sessão está a decorrer.': ['The session is under way.', 'La séance est en cours.'],
  'SESSÃO CONCLUÍDA': ['SESSION COMPLETED', 'SÉANCE TERMINÉE'],
  'A sessão já foi realizada.': ['The session has taken place.', 'La séance a eu lieu.'],
  'MARCAÇÃO CANCELADA': ['BOOKING CANCELLED', 'RÉSERVATION ANNULÉE'],
  'Esta marcação foi cancelada e não é válida para a sessão.': ['This booking was cancelled and is not valid for the session.', 'Cette réservation a été annulée et n’est pas valable pour la séance.'],
  'MARCAÇÃO EXPIRADA': ['BOOKING EXPIRED', 'RÉSERVATION EXPIRÉE'],
  'O pedido não foi confirmado a tempo e não é válido para a sessão.': ['The request was not confirmed in time and is not valid for the session.', 'La demande n’a pas été confirmée à temps et n’est pas valable pour la séance.'],
  'DADOS DA MARCAÇÃO': ['BOOKING DETAILS', 'DÉTAILS DE LA RÉSERVATION'],
  'INFORMAÇÃO DA SESSÃO': ['SESSION INFORMATION', 'INFORMATIONS SUR LA SÉANCE'],
  'Cliente': ['Client', 'Client'],
  'Telefone': ['Phone', 'Téléphone'],
  'Email': ['Email', 'E-mail'],
  'Tipo de cliente': ['Client type', 'Type de client'],
  'Estado': ['Status', 'Statut'],
  'Total pago': ['Total paid', 'Total payé'],
  'Método de pagamento': ['Payment method', 'Moyen de paiement'],
  'Estúdio': ['Studio', 'Studio'],
  'Sala': ['Room', 'Salle'],
  'Data': ['Date', 'Date'],
  'Horário': ['Time', 'Horaire'],
  'Duração': ['Duration', 'Durée'],
  'Modo': ['Mode', 'Mode'],
  'À distância': ['Remote', 'À distance'],
  'Presencial': ['In person', 'Sur place'],
  'Serviço': ['Service', 'Service'],
  'Descrição': ['Description', 'Description'],
  'Projeto': ['Project', 'Projet'],
  'Género': ['Genre', 'Genre'],
  'Valor': ['Amount', 'Montant'],
  'Sessão em estúdio': ['Studio session', 'Séance en studio'],
  'Valor total': ['Total amount', 'Montant total'],
  'Já pago': ['Already paid', 'Déjà payé'],
  'Em falta': ['Outstanding', 'Restant dû'],
  'TOTAL PAGO': ['TOTAL PAID', 'TOTAL PAYÉ'],
  'Mensagem do cliente': ['Client message', 'Message du client'],
  // Talão do pagamento
  'RECIBO DE PAGAMENTO': ['PAYMENT RECEIPT', 'REÇU DE PAIEMENT'],
  'RECIBO': ['RECEIPT', 'REÇU'],
  'DATA': ['DATE', 'DATE'],
  'COMPRA': ['PURCHASE', 'ACHAT'],
  'CLIENTE': ['CLIENT', 'CLIENT'],
  'Quantidade': ['Quantity', 'Quantité'],
  'ESTÚDIO': ['STUDIO', 'STUDIO'],
  'SALA': ['ROOM', 'SALLE'],
  'MARCAÇÃO': ['BOOKING', 'RÉSERVATION'],
  'SESSÃO': ['SESSION', 'SÉANCE'],
  'Base': ['Net', 'Base'],
  'TOTAL': ['TOTAL', 'TOTAL'],
  'PAGO': ['PAID', 'PAYÉ'],
  'PAGO COM': ['PAID WITH', 'PAYÉ AVEC'],
  'ESTADO': ['STATUS', 'STATUT'],
  'DEMONSTRAÇÃO — NADA FOI COBRADO': ['DEMO — NOTHING WAS CHARGED', 'DÉMONSTRATION — RIEN N’A ÉTÉ DÉBITÉ'],
  'o estúdio': ['the studio', 'le studio'],
  'IVA': ['VAT', 'TVA'],
  // Fatura
  'Fatura': ['Invoice', 'Facture'],
  'FATURA ANULADA': ['INVOICE CANCELLED', 'FACTURE ANNULÉE'],
  'DOCUMENTO INTERNO — SEM VALIDADE FISCAL': ['INTERNAL DOCUMENT — NO TAX VALIDITY', 'DOCUMENT INTERNE — SANS VALEUR FISCALE'],
  'Não foi emitida por software certificado nem comunicada ao e-Fatura. Não serve para efeitos fiscais.': ['It was not issued by certified software nor reported to e-Fatura. It is not valid for tax purposes.', 'Elle n’a pas été émise par un logiciel certifié ni déclarée à e-Fatura. Elle n’a pas de valeur fiscale.'],
  'Nome': ['Name', 'Nom'],
  'NIF': ['Tax ID', 'NIF'],
  'Consumidor final': ['Final consumer', 'Consommateur final'],
  'Morada': ['Address', 'Adresse'],
  'DOCUMENTO': ['DOCUMENT', 'DOCUMENT'],
  'Número': ['Number', 'Numéro'],
  'Data de emissão': ['Issue date', 'Date d’émission'],
  'Marcação': ['Booking', 'Réservation'],
  'Moeda': ['Currency', 'Devise'],
  'Qtd.': ['Qty', 'Qté'],
  'Total': ['Total', 'Total'],
  'Base tributável': ['Taxable base', 'Base imposable'],
  // Folha de marcações e lista de clientes
  'DATA MARCAÇÃO': ['BOOKED ON', 'RÉSERVÉ LE'],
  'CÓDIGO': ['CODE', 'CODE'],
  'ESTÚDIO / SALA': ['STUDIO / ROOM', 'STUDIO / SALLE'],
  'SERVIÇO': ['SERVICE', 'SERVICE'],
  'Sessão': ['Session', 'Séance'],
  'DATA SESSÃO': ['SESSION DATE', 'DATE DE LA SÉANCE'],
  'HORÁRIO': ['TIME', 'HORAIRE'],
  'VALOR': ['AMOUNT', 'MONTANT'],
  'EM FALTA': ['OUTSTANDING', 'RESTANT DÛ'],
  'Folha de Marcações': ['Bookings Sheet', 'Feuille de réservations'],
  'Sem marcações no período e filtros escolhidos.': ['No bookings for the chosen period and filters.', 'Aucune réservation pour la période et les filtres choisis.'],
  'TOTAIS:': ['TOTALS:', 'TOTAUX :'],
  'TELEFONE': ['PHONE', 'TÉLÉPHONE'],
  'SESSÕES': ['SESSIONS', 'SÉANCES'],
  'ÚLTIMA SESSÃO': ['LAST SESSION', 'DERNIÈRE SÉANCE'],
  'Lista de Clientes': ['Client List', 'Liste des clients'],
  'Nenhum cliente encontrado.': ['No clients found.', 'Aucun client trouvé.'],
};

// Textos com partes variáveis: [padrão, inglês, francês].
const PADROES = [
  [/^Emitido em (.+)$/, 'Issued on $1', 'Émis le $1'],
  [/^Emitida em (.+)$/, 'Issued on $1', 'Émise le $1'],
  [/^(.*) · Recibo da marcação (\w+)( · Fatura (.+))?\.$/, (_, n, c, f, nf) => `${n} · Receipt for booking ${c}${f ? ' · Invoice ' + nf : ''}.`, (_, n, c, f, nf) => `${n} · Reçu de la réservation ${c}${f ? ' · Facture ' + nf : ''}.`],
  [/^Anulada em (.+)\. Motivo: (.*)$/, 'Cancelled on $1. Reason: $2', 'Annulée le $1. Motif : $2'],
  [/^Preço s\/ (.+)$/, (_, i) => 'Price excl. ' + trIdx(i, 0), (_, i) => 'Prix HT ' + trIdx(i, 1)],
  [/^TOTAL \((.+) INCLUÍDO\)$/, (_, i) => 'TOTAL (' + trIdx(i, 0) + ' INCLUDED)', (_, i) => 'TOTAL (' + trIdx(i, 1) + ' INCLUSE)'],
  [/^IVA \((.+)\)$/, 'VAT ($1)', 'TVA ($1)'],
  [/^Página (\d+) de (\d+)$/, 'Page $1 of $2', 'Page $1 sur $2'],
  [/^Moeda: (.*)$/, 'Currency: $1', 'Devise : $1'],
  [/^Pesquisa: (.*)$/, 'Search: $1', 'Recherche : $1'],
  [/^(\d+) sessões$/, '$1 sessions', '$1 séances'],
  [/^(\d+) sessão$/, '$1 session', '$1 séance'],
  [/^(.*) \(primeiros 500\)$/, '$1 (first 500)', '$1 (500 premiers)'],
  [/^NIF:? (.+)$/, 'Tax ID: $1', 'NIF : $1'],
];

function trIdx(s, i) { return MAPA[s] ? MAPA[s][i] : s; }

function traduzir(s, lingua) {
  const i = lingua === 'en' ? 0 : lingua === 'fr' ? 1 : -1;
  if (i < 0 || typeof s !== 'string' || !s) return s;
  if (MAPA[s]) return MAPA[s][i];
  for (const p of PADROES) if (p[0].test(s)) return s.replace(p[0], p[i + 1]);
  return s;
}

// Passa a escrever o doc nessa língua (não faz nada em português).
function traduzirDoc(doc, lingua) {
  if (lingua !== 'en' && lingua !== 'fr') return doc;
  const original = doc.text;
  doc.text = function (texto, ...resto) { return original.call(this, traduzir(texto, lingua), ...resto); };
  return doc;
}

module.exports = { traduzir, traduzirDoc, MAPA };
