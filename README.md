# Site de marcações e painel de gestão para estúdios

Site público onde os clientes veem a disponibilidade de cada sala e pedem uma sessão, mais um painel de gestão para o produtor e a equipa gerirem marcações, clientes e vários estúdios.

- **Site** (`/`): quadro "Hoje" com a ocupação de todas as salas, estúdios, serviços e preços.
- **Marcar sessão** (`/marcar`): em três passos — o trabalho (serviço e estilo de música), depois o estúdio, a sala, o dia e a hora, e por fim os seus dados com o resumo do pedido. No fim recebe um código.
- **Consultar marcação** (`/consultar`): com o código e o telefone, o cliente vê o estado ou cancela.
- **Painel** (`/admin`): pedidos por confirmar, calendário por sala, marcações, clientes, estúdios e salas, serviços, definições e equipa.

O site fala **português, inglês e francês**, e tem **tema escuro e claro**. As duas escolhas estão no cabeçalho e ficam guardadas num cookie. O painel é interno e fica sempre em português.

O que se escreve no painel — nomes e descrições dos estúdios, salas e serviços, a frase de apresentação e o texto antes de enviar o pedido — tem um bloco **Traduções** logo abaixo, com o inglês e o francês. Um campo deixado vazio mostra o português no site.

O sistema **nunca aceita duas marcações sobrepostas na mesma sala**, nem sobre um horário bloqueado. A verificação é feita no servidor, dentro de uma transação, por isso vale para o site e para o painel.

## Correr no seu computador

Precisa de [Node.js 22](https://nodejs.org) ou superior.

```bash
npm install
npm start
```

Para trabalhar no projeto, arranque com:

```
npm run dev
```

O servidor reinicia sozinho sempre que muda o código. O terminal mostra onde abrir o site — normalmente http://localhost:3005, e também o endereço na rede local para abrir noutro aparelho ligado ao mesmo Wi-Fi. Se a porta estiver ocupada por outro programa, salta para a seguinte e diz qual.

Na primeira vez, o terminal mostra também o email e a palavra-passe do administrador. Guarde-os, entre em /admin e mude a palavra-passe em **Definições**.

Para escolher você a conta inicial: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm start`.

Na primeira execução são criados dois estúdios de exemplo (com salas e serviços) para não começar com o site vazio. Edite-os ou apague-os em **Estúdios** e **Serviços**. Para não criar exemplos: `SEED_DEMO=0`.

## Primeiros passos no painel

1. **Definições**: nome do negócio, telefone, WhatsApp, moeda, indicativo do país, regras de marcação. Escolha se os pedidos do site ficam "por confirmar" ou são confirmados automaticamente.
2. **Estúdios**: nome, morada, horário de cada dia da semana e, dentro de cada estúdio, as salas com o preço por hora.
3. **Serviços**: o que o cliente pode indicar ao marcar (gravação, mistura, masterização...).
4. **Equipa** (em Definições): crie contas para colaboradores. A equipa gere marcações, clientes e estúdios; só o proprietário altera definições e utilizadores.

Dia a dia: os pedidos novos aparecem no **Painel** e no selo junto a "Marcações". **Confirmar** e **Recusar** estão ao lado de cada pedido, e o botão do WhatsApp dentro da marcação abre uma conversa com o cliente já com a mensagem escrita. Clientes que ligam ou passam no estúdio entram por **Nova marcação**. Para reservar tempo para manutenção ou sessões próprias, use **Bloquear horário** no calendário.

## Pôr online

Isto é uma aplicação Node.js com base de dados SQLite (um ficheiro). Precisa de um serviço que corra Node e que tenha **disco persistente**: se o disco for apagado a cada reinício (comum em planos gratuitos), perde as marcações.

Duas opções comuns:

- **Servidor virtual (VPS)** com Linux: instale Node 22, copie o projeto, corra-o com `systemd` ou `pm2` e ponha o Caddy ou o Nginx à frente para o HTTPS.
- **Serviços de alojamento de aplicações** (Render, Railway, Fly.io e semelhantes): ligue o repositório, comando de arranque `npm start`, e anexe um volume/disco persistente. Confirme no serviço que escolher se o plano inclui o disco e quanto custa.

Variáveis de ambiente (ver `.env.example`):

| Variável | Para quê |
| --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Conta do proprietário, criada só no primeiro arranque. |
| `TIMEZONE` | Fuso horário do estúdio. Por omissão `Atlantic/Cape_Verde`. Afeta "hoje" e a antecedência mínima. |
| `DATA_DIR` | Pasta da base de dados. Em produção, aponte para o disco persistente. |
| `COOKIE_SECURE=1` | Ative quando o site estiver em HTTPS (deve estar sempre). |
| `TRUST_PROXY=1` | Ative atrás do proxy do serviço, para os limites de pedidos verem o IP real. |
| `PORT` | Porta (a maioria dos serviços define-a sozinha). |

O nome de domínio e o HTTPS são configurados no serviço de alojamento.

### Os trechos de música

Ao carregar num estilo, toca um trecho de 5 segundos. Há dois caminhos:

1. **O trecho do estúdio.** Grave (ou corte) cerca de 5 segundos do instrumental, guarde o ficheiro em `marcacoes/assets/audio/` e aponte-lhe a linha certa em `marcacoes/assets/js/sons.js`. Use música sua ou com licença: o trecho fica no site, à vista de toda a gente.
2. **A batida sintetizada**, enquanto não houver ficheiro. O `marcacoes/assets/js/som.js` desenha a percussão e o baixo do género com osciladores e ruído — dá o andamento e o feitio, mas **não é música nem substitui uma gravação**. Serve para o formulário funcionar sem ficheiro nenhum. Para mexer num ritmo, ou acrescentar um para um estilo novo, a tabela `RITMOS` está no topo desse ficheiro: cada compasso são 16 passos, `x` é toque e `.` é silêncio.

Nada toca sozinho — só ao carregar numa etiqueta — e há um botão para silenciar que fica guardado no aparelho.

### Coordenadas dos estúdios

O campo *Onde fica* (em **Estúdios**) aceita três maneiras:

- **Colar o link do Google Maps.** As coordenadas vêm dentro do próprio link, por isso são lidas ali mesmo, sem chave da Google, sem custos e sem falar com ninguém. Reconhece os links de lugar (`!3d…!4d…`), os de partilha (`?q=`), o endereço da barra (`/@…`), graus-minutos-segundos e dois números soltos. Os links curtos (`maps.app.goo.gl`) não trazem as coordenadas dentro: abra-os e copie o endereço completo da barra.
- **Carregar em "Estou aqui".** Estando no estúdio, o próprio aparelho diz onde é — é a maneira mais certa de acertar no sítio. Aqui sim se pede autorização, porque é o dono a pedi-la a si mesmo, com um clique explícito. O browser só dá a localização em ligações seguras (`https://` ou `localhost`); fora disso, aparece a explicação e há sempre as outras duas maneiras.
- **Escrever a morada e carregar em Procurar.** Aí o servidor pergunta ao [OpenStreetMap](https://nominatim.openstreetmap.org), que é gratuito e não pede chave. Só corre com sessão iniciada e só ao carregar no botão — o serviço é comunitário e a política de uso pede parcimónia (um pedido por segundo, e que nos identifiquemos).

Duas variáveis de ambiente, para quem precise: `GEOCODER_URL` aponta para outro servidor compatível (uma instância própria, por exemplo) e `GEOCODER=off` desliga a procura, para servidores sem saída para a internet — colar o link continua a funcionar.

## Integrações

Pagamentos online com o **Stripe** e ligação à **plataforma da gravadora**: os lançamentos entram sozinhos nas novidades do site, e os que passam de um certo número de reproduções entram em "Saíram deste estúdio". Estão na pasta `integracoes/`, à parte do resto do backend, e ficam desligadas até lhes dar as variáveis de ambiente. Tudo o que é preciso, incluindo o formato que a plataforma da gravadora tem de enviar, está em [integracoes/README.md](integracoes/README.md). No painel, a secção **Integrações** mostra o estado de cada uma.

## Cópias de segurança

`npm run backup` cria uma cópia consistente em `backend/data/backups/` (pode correr com o site ligado; guarda as 30 mais recentes). Agende-a uma vez por dia e **copie os ficheiros para fora do servidor**. Se perder o servidor sem cópia, perde as marcações.

## Segurança, em resumo

- Palavras-passe guardadas com `scrypt`; sessões em cookie `HttpOnly` com validade de 14 dias.
- Todas as rotas do painel exigem sessão; as de definições e utilizadores exigem perfil de proprietário.
- Limite de tentativas de início de sessão, de pedidos de marcação e de consultas por IP.
- Proteção contra pedidos forjados (cabeçalho obrigatório em ações que alteram dados), campo isco contra robôs e política CSP restritiva.
- A consulta pública só devolve dados da marcação a quem tem o código **e** o telefone.

## O que não está incluído

- **Envio de emails ou SMS.** O contacto com o cliente é por telefone/WhatsApp (o painel gera a mensagem). Ligar um serviço de email é possível, mas exige uma conta nesse serviço.
- **Design testado em browsers reais.** A lógica está coberta por testes automáticos; o aspeto foi construído com cuidado, mas convém rever o site no telemóvel e no computador antes de o divulgar.

## Personalizar

- Textos do site: `comum/assets/js/dicionario.js` — as três línguas lado a lado, com a mesma chave. O português é o original: se faltar uma tradução, é ele que aparece.
- Novidades e singles: `publico/assets/js/novidades.js` e `singles.js`. O `texto` e o `botao` de uma novidade (e a `descricao` de um single) podem levar as três línguas: `{ pt: '...', en: '...', fr: '...' }`.
- Onde fica cada estúdio: **Estúdios**, no painel, no campo *Onde fica*. Cole aí o link do Google Maps (as coordenadas vêm dentro do próprio link — não é preciso chave nem se fala com a Google) ou escreva a morada e carregue em *Procurar*, que pergunta ao OpenStreetMap.
- Trechos de música dos estilos: `marcacoes/assets/js/sons.js` — ver abaixo.
- Estilos de música do formulário: `marcacoes/assets/js/estilos.js` — uma linha por estilo. A lista não tem de ser exaustiva: quem não se revir em nenhum escolhe "Outro" e escreve. A lista vazia faz o campo desaparecer.
- Desenho de fundo de cada serviço: sai do nome que lhe deu (microfone para "Gravação", mesa para "Mistura"...). A lista de palavras está em `DESENHOS_SERVICO`, em `comum/assets/js/common.js`; um serviço que não encaixe em nenhuma fica com as barras de som.
- Estrutura das páginas: `publico/views/index.html`, `marcacoes/views/marcar.html`, `marcacoes/views/consultar.html`.
- Fotografia de fundo das páginas de marcar e consultar: `publico/assets/img/many.jpg` (trocar o ficheiro chega; o enquadramento e o véu estão em `.page-inner::before`, em `site.css`).
- Cores e tipos de letra: variáveis no topo de `comum/assets/css/base.css` — o primeiro bloco é o tema escuro, o segundo (`:root[data-tema="claro"]`) é o claro.
- Regras (duração mínima e máxima, antecedência, bloco de tempo): **Definições**, no painel.

### Línguas e tema, por dentro

O mesmo dicionário serve o servidor e o navegador, para não haver duas listas a divergir. A página sai do servidor já traduzida e já com o tema escolhido — o texto não troca à frente dos olhos, não há um instante em branco, e cada língua tem o seu `<html lang>` e a sua descrição para os motores de busca.

Nas páginas, o texto português está escrito à vista e marcado com:

| marca | troca |
| --- | --- |
| `data-i18n="chave"` | o texto do elemento |
| `data-i18n-attr="placeholder:chave"` | um atributo |
| `data-i18n-tpl="…{chave}…"` | texto composto (usa-se no `<title>`) |
| `{{t:chave}}` | texto solto, onde não há elemento |

O texto português fica escrito nos próprios ficheiros e é esse que a página em português mostra — o servidor nem lhe toca. Uma chave sem tradução deixa ficar o original em vez de escrever o nome da chave na página, e há um teste que garante que o texto do HTML e o dicionário não se desencontram.

Escolher outra língua no cabeçalho **não recarrega a página**: o texto do HTML é trocado e as partes desenhadas em JavaScript (o quadro "Hoje", o formulário, o resumo) são redesenhadas ao ouvirem o evento `lingua`. Quem estava a meio do formulário não perde o que já escreveu.

Para acrescentar uma língua: junte o código a `LINGUAS` e um bloco de textos em `dicionario.js`. O botão do cabeçalho passa a mostrá-la sozinho.

**Tema.** São dois, escuro (o da casa, por omissão) e claro. O herói fica escuro nos dois: é fotografia com texto por cima.

### O cabeçalho

Fica preso ao topo durante toda a página: uma faixa de ponta a ponta e opaca, para nada se ver a passar por trás dela ao rolar. Em três zonas — o logótipo à esquerda, os links ao centro, as preferências e a ação principal à direita — com um limite próprio (1680 px, mais largo do que os 1120 px do resto da página), para o logótipo encostar ao canto.

Está fora do fluxo, por isso o conteúdo por baixo precisa de saber a altura dela. Como essa altura muda com a largura do ecrã, é medida em `publico/assets/js/cabecalho.js` e deixada na variável `--altura-cabecalho`; o CSS traz um valor de reserva para quem tenha o JavaScript desligado. Num ecrã estreito a barra encolhe a uma linha (logótipo, preferências e o botão principal) — fixa, cada pixel que ocupa é um pixel que a página perde para sempre.

## Testes

```bash
npm test                              # API (133) e integrações (48)
npm install --no-save jsdom           # só uma vez
npm run test:frontend                 # site e painel: 153 verificações
```

## Estrutura

```
backend/             tudo o que corre no servidor
  server.js            arranque, segurança, entrega das páginas
  lib/                 base de dados, autenticação, limites, idioma e tema, utilitários
  routes/              API pública, autenticação, API do painel
  data/                a base de dados (estudio.db) e as cópias de segurança
  scripts/backup.js    cópia de segurança

comum/               o que é partilhado pelo público, pelas marcações e pelo painel
  assets/css/base.css  cores, tipos de letra e os blocos de base (tema escuro e claro)
  assets/js/common.js  utilitários do lado do navegador, usados por todas as páginas
  assets/js/dicionario.js  os textos em português, inglês e francês
  assets/js/carregamento.js  o ecrã de carregamento com o logótipo (ao abrir e ao mudar de página)

publico/             o site aberto a toda a gente
  views/               página inicial
  assets/              CSS, JavaScript e imagens do site (partilhados com marcacoes/)
    js/prefs.js          os botões de idioma e tema, no cabeçalho
    js/rodape.js         o rodapé, partilhado pelas três páginas
    js/cabecalho.js      a barra presa ao topo (mede-se para o conteúdo lhe dar lugar)

marcacoes/           o fluxo de marcação do cliente
  views/               marcar sessão, consultar marcação
  assets/js/book.js    o formulário de marcação
  assets/js/lookup.js  consultar e cancelar uma marcação
  assets/js/estilos.js os estilos de música do formulário
  assets/js/som.js     a batida que toca ao escolher um estilo
  assets/js/sons.js    os trechos do estúdio, se os houver
  assets/audio/        os ficheiros desses trechos

integracoes/         serviços de fora (Stripe, plataforma da gravadora) — ver o README lá dentro

booking/             a área de gestão (painel), sem ligações à pasta do público
  views/               painel de administração
  assets/              CSS e JavaScript do painel

test/                testes de ponta a ponta
```
