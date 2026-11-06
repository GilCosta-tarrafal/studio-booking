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
```

Para trabalhar no projeto, cada parte arranca no seu terminal, na sua porta, e reinicia sozinha quando muda o código dela:

| Parte | Comando | Endereço |
| --- | --- | --- |
| API | `npm run dev:start` | http://localhost:3007 (o site e o painel falam com ela; não se abre no browser) |
| Site | `npm run dev:site` | http://localhost:3005 |
| Painel | `npm run dev` | http://localhost:3006/admin |

Arranque primeiro a API: o site e o painel precisam dela para mostrar as páginas. Para ligar as três de uma vez, num só terminal e sem reinício automático, use `npm start`.

O terminal mostra também os endereços na rede local, para abrir noutro aparelho ligado ao mesmo Wi-Fi. Se uma porta estiver ocupada por outro programa, o arranque para e diz qual. Para usar outras, defina `SITE_PORT`, `ADMIN_PORT` e `API_PORT` no `.env` da raiz (copie-o de `api/.env.example`).

Na primeira vez, o terminal mostra também o email e a palavra-passe do administrador. Guarde-os, entre no painel e mude a palavra-passe em **Definições**.

Para escolher você a conta inicial: `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm start`.

Na primeira execução são criados dois estúdios de exemplo (com salas e serviços) para não começar com o site vazio. Edite-os ou apague-os em **Estúdios** e **Serviços**. Para não criar exemplos: `SEED_DEMO=0`.

## Primeiros passos no painel

1. **Definições**: nome do negócio, telefone, WhatsApp, moeda, indicativo do país, regras de marcação. Escolha se os pedidos do site ficam "por confirmar" ou são confirmados automaticamente.
2. **Estúdios**: nome, morada, horário de cada dia da semana e, dentro de cada estúdio, as salas com o preço por hora.
3. **Serviços**: o que o cliente pode indicar ao marcar (gravação, mistura, masterização...).
4. **Equipa** (em Definições): crie contas para colaboradores. A equipa gere marcações, clientes e estúdios; só o proprietário altera definições e utilizadores.

Dia a dia: os pedidos novos aparecem no **Painel** e no selo junto a "Marcações". **Confirmar** e **Recusar** estão ao lado de cada pedido, e o botão do WhatsApp dentro da marcação abre uma conversa com o cliente já com a mensagem escrita. Clientes que ligam ou passam no estúdio entram por **Nova marcação**. Para reservar tempo para manutenção ou sessões próprias, use **Bloquear horário** no calendário.

## Pôr online

O projeto vai para o ar em **três partes separadas**, cada uma com a sua pasta, o seu `package.json` e o seu `npm start`. Cada pasta leva tudo o que precisa (incluindo a sua cópia de `comum/`), por isso pode ser posta num serviço sozinha:

| Pasta | O que é | Endereço típico | Precisa de |
| --- | --- | --- | --- |
| `api/` | Base de dados, regras, integrações | `api.o-seu-dominio` | Node 22 e **disco persistente** |
| `site/` | Site público (início, marcar, consultar, pagar, conta) | `o-seu-dominio` | Node 22 |
| `admin/` | Painel de gestão | `painel.o-seu-dominio` | Node 22 |

O site e o painel não têm base de dados: pedem à API o que precisam e reencaminham-lhe `/api`. Para o browser, a API está no mesmo endereço da página, por isso os cookies de sessão e a proteção contra pedidos forjados funcionam sem configurar nada (nem CORS).

A API guarda tudo num ficheiro SQLite. Se o disco for apagado a cada reinício (comum em planos gratuitos), perde as marcações.

Duas opções comuns:

- **Servidor virtual (VPS)** com Linux: instale Node 22, copie as três pastas, corra cada uma com `systemd` ou `pm2` e ponha o Caddy ou o Nginx à frente para o HTTPS e os domínios. O site e o painel falam com a API em `http://127.0.0.1:3007`.
- **Serviços de alojamento de aplicações** (Render, Railway, Fly.io e semelhantes): crie três serviços a partir do mesmo repositório, cada um com a sua pasta como *root directory* e o comando `npm start`. Anexe o disco persistente só à API. Se o serviço tiver rede privada entre serviços, aponte o `API_URL` para o endereço interno da API.

Variáveis de ambiente de cada parte (ver o `.env.example` de cada pasta):

| Parte | Variável | Para quê |
| --- | --- | --- |
| site, painel | `API_URL` | Onde está a API. |
| painel | `SITE_URL` | Endereço do site, para onde vai quem abrir no painel uma página do site. |
| todas | `PORT` | Porta (a maioria dos serviços define-a sozinha). |
| api | `SITE_URL`, `PAINEL_URL` | Endereços públicos do site e do painel, para os links dos emails, o "Ver o site" do painel e o regresso do Stripe. |
| api | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Conta do proprietário, criada só no primeiro arranque. |
| api | `TIMEZONE` | Fuso horário do estúdio. Por omissão `Atlantic/Cape_Verde`. Afeta "hoje" e a antecedência mínima. |
| api | `DATA_DIR` | Pasta da base de dados. Em produção, aponte para o disco persistente. |
| api | `COOKIE_SECURE=1` | Ative quando o site estiver em HTTPS (deve estar sempre). |
| api | `TRUST_PROXY` | Só se o site e o painel falarem com a API pela internet e não por uma rede privada: o número de proxies pelo meio, para os limites de pedidos verem o IP real de quem visita. |
| api | `BLOQUEIO_MIN` | Minutos sem mexer até o painel se bloquear e pedir a palavra-passe. Por omissão `15`. |
| api | `SMTP_USER`, `SMTP_PASS` | Envio de emails aos clientes (referência da marcação, pagamento, recuperar a palavra-passe) pelo Gmail: o endereço e uma palavra-passe de aplicação. Também há `RESEND_API_KEY` ou `BREVO_API_KEY`. Teste com `npm run testar-email -- voce@exemplo.com`. |
| api | `ANTHROPIC_API_KEY` | Chave da API da Claude para o "Assistente IA" do painel (botão de auriculares). Sem ela, o assistente avisa que não está configurado; o chat da equipa funciona na mesma. |

Os nomes de domínio e o HTTPS são configurados no serviço de alojamento. Os avisos do Stripe e da plataforma da gravadora podem apontar para a API ou para o site, porque o site também os reencaminha.

O site e o painel ficam em domínios diferentes, por isso cada um tem a sua sessão. Quem é da equipa e entra pela página **A minha conta** do site é levado ao painel, mas aí pode ter de iniciar sessão outra vez.

**Antes de pôr no ar uma alteração a `comum/`**, corra `npm run comum`. Isso atualiza as cópias dentro de `api/`, `site/` e `admin/`, que são as que vão para o ar. Os comandos `npm run dev...` e o `npm test` já o fazem, e um teste avisa se alguma cópia ficar desatualizada.

### Os trechos de música

Ao carregar num estilo, toca um trecho de 5 segundos. Há dois caminhos:

1. **O trecho do estúdio.** Grave (ou corte) cerca de 5 segundos do instrumental, guarde o ficheiro em `site/assets/audio/` e aponte-lhe a linha certa em `site/assets/js/sons.js`. Use música sua ou com licença: o trecho fica no site, à vista de toda a gente.
2. **A batida sintetizada**, enquanto não houver ficheiro. O `site/assets/js/som.js` desenha a percussão e o baixo do género com osciladores e ruído — dá o andamento e o feitio, mas **não é música nem substitui uma gravação**. Serve para o formulário funcionar sem ficheiro nenhum. Para mexer num ritmo, ou acrescentar um para um estilo novo, a tabela `RITMOS` está no topo desse ficheiro: cada compasso são 16 passos, `x` é toque e `.` é silêncio.

Nada toca sozinho — só ao carregar numa etiqueta — e há um botão para silenciar que fica guardado no aparelho.

### Coordenadas dos estúdios

O campo *Onde fica* (em **Estúdios**) aceita três maneiras:

- **Colar o link do Google Maps.** As coordenadas vêm dentro do próprio link, por isso são lidas ali mesmo, sem chave da Google, sem custos e sem falar com ninguém. Reconhece os links de lugar (`!3d…!4d…`), os de partilha (`?q=`), o endereço da barra (`/@…`), graus-minutos-segundos e dois números soltos. Os links curtos (`maps.app.goo.gl`) não trazem as coordenadas dentro: abra-os e copie o endereço completo da barra.
- **Carregar em "Estou aqui".** Estando no estúdio, o próprio aparelho diz onde é — é a maneira mais certa de acertar no sítio. Aqui sim se pede autorização, porque é o dono a pedi-la a si mesmo, com um clique explícito. O browser só dá a localização em ligações seguras (`https://` ou `localhost`); fora disso, aparece a explicação e há sempre as outras duas maneiras.
- **Escrever a morada e carregar em Procurar.** Aí o servidor pergunta ao [OpenStreetMap](https://nominatim.openstreetmap.org), que é gratuito e não pede chave. Só corre com sessão iniciada e só ao carregar no botão — o serviço é comunitário e a política de uso pede parcimónia (um pedido por segundo, e que nos identifiquemos).

Duas variáveis de ambiente, para quem precise: `GEOCODER_URL` aponta para outro servidor compatível (uma instância própria, por exemplo) e `GEOCODER=off` desliga a procura, para servidores sem saída para a internet — colar o link continua a funcionar.

## Integrações

Pagamentos online com o **Stripe** e ligação à **plataforma da gravadora**: os lançamentos entram sozinhos nas novidades do site, e os que passam de um certo número de reproduções entram em "Saíram deste estúdio". Estão na pasta `api/integracoes/`, à parte do resto da API, e ficam desligadas até lhes dar as variáveis de ambiente. Tudo o que é preciso, incluindo o formato que a plataforma da gravadora tem de enviar, está em [api/integracoes/README.md](api/integracoes/README.md). No painel, a secção **Integrações** mostra o estado de cada uma.

## Cópias de segurança

`npm run backup` cria uma cópia consistente em `api/data/backups/` (pode correr com o site ligado; guarda as 30 mais recentes). Agende-a uma vez por dia e **copie os ficheiros para fora do servidor**. Se perder o servidor sem cópia, perde as marcações.

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
- Novidades e singles: `site/assets/js/novidades.js` e `singles.js`. O `texto` e o `botao` de uma novidade (e a `descricao` de um single) podem levar as três línguas: `{ pt: '...', en: '...', fr: '...' }`.
- Onde fica cada estúdio: **Estúdios**, no painel, no campo *Onde fica*. Cole aí o link do Google Maps (as coordenadas vêm dentro do próprio link — não é preciso chave nem se fala com a Google) ou escreva a morada e carregue em *Procurar*, que pergunta ao OpenStreetMap.
- Trechos de música dos estilos: `site/assets/js/sons.js` — ver abaixo.
- Estilos de música do formulário: `site/assets/js/estilos.js` — uma linha por estilo. A lista não tem de ser exaustiva: quem não se revir em nenhum escolhe "Outro" e escreve. A lista vazia faz o campo desaparecer.
- Desenho de fundo de cada serviço: sai do nome que lhe deu (microfone para "Gravação", mesa para "Mistura"...). A lista de palavras está em `DESENHOS_SERVICO`, em `comum/assets/js/common.js`; um serviço que não encaixe em nenhuma fica com as barras de som.
- Estrutura das páginas: `site/views/` (`index.html`, `marcar.html`, `consultar.html`, `pagar.html`, `conta.html`) e `admin/views/admin.html`.
- Fotografia de fundo das páginas de marcar e consultar: `comum/assets/img/many.jpg` (trocar o ficheiro chega; o enquadramento e o véu estão em `.page-inner::before`, em `site.css`).
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

Está fora do fluxo, por isso o conteúdo por baixo precisa de saber a altura dela. Como essa altura muda com a largura do ecrã, é medida em `site/assets/js/cabecalho.js` e deixada na variável `--altura-cabecalho`; o CSS traz um valor de reserva para quem tenha o JavaScript desligado. Num ecrã estreito a barra encolhe a uma linha (logótipo, preferências e o botão principal) — fixa, cada pixel que ocupa é um pixel que a página perde para sempre.

## Testes

```bash
npm test                              # API e integrações
npm install --no-save jsdom           # só uma vez
npm run test:frontend                 # site e painel num browser simulado
```

## Estrutura

```
api/                 a API — vai para o ar sozinha (precisa de disco persistente)
  server.js            arranque, segurança, rotas
  lib/                 base de dados, autenticação, limites, endereços, PDFs, utilitários
  routes/              API pública, autenticação, conta do cliente, API do painel
  integracoes/         serviços de fora (Stripe, gravadora, YouTube, câmbio) — ver o README lá dentro
  data/                a base de dados (estudio.db), anexos, capas e cópias de segurança
  scripts/             cópia de segurança, testar o email, repor o administrador
  comum/               cópia de comum/ (não mexer aqui)

site/                o site público — vai para o ar sozinho
  server.js            monta as páginas e reencaminha /api para a API
  views/               início, marcar, consultar, pagar, a minha conta
  assets/              CSS, JavaScript, imagens e áudio do site
    js/prefs.js          os botões de idioma e tema, no cabeçalho
    js/rodape.js         o rodapé, partilhado pelas páginas
    js/cabecalho.js      a barra presa ao topo (mede-se para o conteúdo lhe dar lugar)
    js/book.js           o formulário de marcação
    js/lookup.js         consultar e cancelar uma marcação
    js/estilos.js        estilos de reserva (os ativos vêm de Configurações › Géneros musicais)
    js/som.js, sons.js   a batida e os trechos que tocam ao escolher um estilo
  comum/               cópia de comum/ (não mexer aqui)

admin/               o painel de gestão — vai para o ar sozinho
  server.js            monta a página do painel e reencaminha /api para a API
  views/admin.html     a página do painel
  assets/              CSS e JavaScript do painel
  comum/               cópia de comum/ (não mexer aqui)

comum/               o ORIGINAL do que as três partes partilham (mexa aqui e corra `npm run comum`)
  assets/css/base.css  cores, tipos de letra e os blocos de base (tema escuro e claro)
  assets/js/common.js  utilitários do lado do navegador, usados por todas as páginas
  assets/js/dicionario.js  os textos em português, inglês e francês (também usado pela API)
  assets/js/carregamento.js  o ecrã de carregamento com o logótipo
  assets/img/          logótipo, ícone e fotografia de fundo
  servidor/prefs.js    língua, tema e moeda de quem visita; os botões do cabeçalho
  servidor/paginas.js  montar e traduzir as páginas, segurança, reencaminhar para a API

dev.js               no computador: arranca a API (`dev:start`), o site (`dev:site`) ou o painel (`dev`)
scripts/copiar-comum.js  põe as cópias de comum/ em dia
test/                testes de ponta a ponta (arrancam as três partes)
```
