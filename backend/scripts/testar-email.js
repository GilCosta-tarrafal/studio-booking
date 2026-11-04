// Envia um email de teste, para confirmar que o envio está bem configurado.
// Uso: npm run testar-email -- endereco@exemplo.com
'use strict';
const notify = require('../lib/notify');

const para = process.argv[2];
if (!para || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) {
  console.error('Indique para onde enviar: npm run testar-email -- endereco@exemplo.com');
  process.exit(1);
}
if (!notify.emailConfigurado()) {
  console.error('Não há nenhum envio de email configurado. Preencha SMTP_USER e SMTP_PASS no ficheiro .env.');
  process.exit(1);
}

notify.sendEmail({
  to: para,
  subject: 'Teste de email do estúdio',
  text: 'Se está a ler isto, o envio de emails do site está a funcionar.\n\nOs clientes vão passar a receber a referência das marcações.',
}).then((r) => {
  if (r.sent) { console.log(`Enviado para ${para} (por ${r.provider}). Veja a caixa de entrada e o spam.`); process.exit(0); }
  console.error('Não foi enviado:', r.error || 'erro desconhecido');
  if (/535|Username and Password not accepted|BadCredentials/i.test(r.error || '')) {
    console.error('O Gmail recusou a entrada. Confirme o endereço e use uma palavra-passe de APLICAÇÃO (não a normal).');
  }
  process.exit(1);
});
