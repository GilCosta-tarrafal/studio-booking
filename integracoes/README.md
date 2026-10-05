# Integrações

Serviços de fora ligados ao site: **pagamentos online (Stripe)**, a **plataforma da gravadora** (lançamentos e reproduções) e o **YouTube** (views dos vídeos). O módulo está preparado para receber mais.

Fica à parte do resto do backend. Tem as suas tabelas (todas começam por `int_`), as suas rotas e as suas variáveis de ambiente, e o código das marcações nunca chama um serviço de fora. Partilha a base de dados com o site porque são um só ficheiro e um só disco. A única coisa que escreve fora das suas tabelas é o **"Já pago"** de uma marcação, quando entra um pagamento.

Cada integração fica desligada até lhe darem as variáveis. Sem nenhuma, o site funciona tal como antes.

```
integracoes/
  index.js              registo dos fornecedores; o que o servidor monta
  lib/base.js           tabelas int_*, definições, eventos já recebidos, pasta das capas
  lib/assinatura.js     conferir webhooks (HMAC-SHA256 com hora, esquema do Stripe)
  lib/http.js           pedidos para fora, com prazo
  fornecedores/
    stripe.js           pagamento das marcações
    gravadora.js        lançamentos e reproduções
    youtube.js          views dos vídeos (atualizam os números dos cartões)
    youtube-musicas.js  lista, à mão, de cada música → vídeo no YouTube
  rotas/
    publico.js          /api/integracoes/...        (site)
    admin.js            /api/admin/integracoes/...  (painel, com sessão)
    lancamentos.js      lançamentos no formato do site
```

No painel, em **Integrações**, vê-se o estado de cada uma e os lançamentos recebidos (cada um pode ser escondido do site). Também se define a partir de quantas reproduções um lançamento passa a sucesso.

---

## Pagamentos online (Stripe)

O cliente abre **Consultar marcação**, e numa marcação **confirmada** com valor em falta aparece **Pagar online**. O site pede ao Stripe uma página de pagamento com esse valor e manda o cliente para lá. O cliente nunca escreve o cartão no nosso site. Quando o pagamento entra, o Stripe avisa por webhook e o valor soma-se ao "Já pago" da marcação.

- **Só se paga o que está confirmado.** Um pedido por confirmar ainda pode ser recusado, e aí era preciso devolver o dinheiro.
- **Só o webhook muda valores.** Voltar do Stripe para o site (`?pago=1`) não prova nada, porque qualquer pessoa pode abrir esse endereço.
- **Um evento repetido não soma duas vezes.** O Stripe volta a mandar avisos quando não tem resposta a tempo, por isso cada evento fica registado em `int_eventos`.
- **Reembolsos** fazem-se no painel do Stripe. Depois acerte o "Já pago" na marcação.

### Ligar

1. Crie conta em [stripe.com](https://stripe.com) e copie a **chave secreta** (*Developers → API keys*). Comece pela de teste (`sk_test_...`).
2. Em *Developers → Webhooks*, crie um endpoint para `https://o-seu-dominio/integracoes/webhooks/stripe` com os eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`

   Copie o **segredo de assinatura** (`whsec_...`).
3. Defina as variáveis e reinicie:

| Variável | Para quê |
| --- | --- |
| `STRIPE_SECRET_KEY` | Liga os pagamentos. |
| `STRIPE_WEBHOOK_SECRET` | Confere os avisos do Stripe. Sem ele, os pagamentos não chegam às marcações. |
| `SITE_URL` | Endereço público do site (`https://...`), para o Stripe saber para onde devolver o cliente. |
| `STRIPE_CURRENCY` | Só se a moeda em **Definições** não for um código ISO (por exemplo `€` → `eur`). `CVE`, `EUR` e outros códigos servem tal e qual. |

Para experimentar no seu computador, use a [CLI do Stripe](https://docs.stripe.com/stripe-cli):

```bash
stripe listen --forward-to localhost:3005/integracoes/webhooks/stripe
```

Ela mostra um `whsec_...` próprio: ponha esse em `STRIPE_WEBHOOK_SECRET` enquanto testa. Para pagar em modo de teste, use o cartão `4242 4242 4242 4242`, com qualquer data futura e qualquer CVC.

> Confirme no Stripe que a sua conta pode cobrar na moeda escolhida e que o país da conta é suportado. Isso depende do Stripe, não deste código.

---

## Plataforma da gravadora

Tudo o que a gravadora lança entra no site sozinho, no carrossel de **novidades** da página inicial. O que passar do limite de reproduções (100 000 por omissão, muda-se no painel) entra em **"Saíram deste estúdio"**. Juntam-se às listas escritas à mão em `publico/assets/js/novidades.js` e `singles.js`. Se uma música estiver nos dois sítios, aparece uma vez só, e o número do cartão é o **maior** entre o escrito à mão e o da plataforma (o mesmo vale para as views do YouTube, abaixo) — sobe sozinho sem nunca descer abaixo do manual.

Não está presa a nenhuma plataforma. O que segue é o **contrato**: a plataforma da gravadora cumpre-o, ou cumpre-o um pequeno script do lado dela (a ler os relatórios do distribuidor, por exemplo). Há dois caminhos, e podem estar os dois ligados.

### O formato de um lançamento

```json
{
  "id": "fdt-01",
  "titulo": "Fidju Di Téra",
  "artistas": ["Daski FNG"],
  "texto": "Primeiro single do EP FDT. Produção: Many Make.",
  "capa": "https://plataforma.exemplo/capas/fdt-01.jpg",
  "link": "https://open.spotify.com/track/44tQnYrjd7ubuLEaUJEist",
  "data": "2026-09-18",
  "formato": "video",
  "plays": 125000
}
```

| Campo | |
| --- | --- |
| `id` | **Obrigatório.** Identificador estável na plataforma. É o que liga os avisos seguintes ao mesmo lançamento. |
| `titulo` | **Obrigatório.** |
| `artistas` ou `artista` | Lista ou texto. |
| `data` | `AAAA-MM-DD` (ou `AAAA-MM-DDTHH:MM`). Com data futura, o site mostra "Brevemente" e uma contagem decrescente. |
| `capa` | Endereço `http(s)` de uma imagem JPEG, PNG ou WebP, até 5 MB. É **copiada** para o nosso disco, porque o site só mostra imagens servidas por ele próprio. Sem capa, entra o logótipo. |
| `link` | Para onde vai o botão (Spotify, YouTube, Instagram...). |
| `plays` | Reproduções até agora. |
| `texto`, `formato` | Opcionais. Com `"formato": "video"`, a imagem é a miniatura de um clipe. |

Um lançamento que já exista é **atualizado**, e os campos que não vierem ficam como estavam.

### Caminho 1: a plataforma avisa (webhook)

`POST https://o-seu-dominio/integracoes/webhooks/gravadora`

```json
{ "id": "evt-8f2c", "tipo": "lancamento.publicado", "dados": { ...um lançamento... } }
```

| `tipo` | `dados` |
| --- | --- |
| `lancamento.publicado` | um lançamento |
| `lancamento.atualizado` | um lançamento |
| `lancamento.plays` | `{ "id": "fdt-01", "plays": 125000 }` ou `{ "plays": [{ "id": "...", "plays": 0 }, ...] }` |
| `lancamento.removido` | `{ "id": "fdt-01" }` (sai do site e fica no histórico) |

O `id` do evento serve para reconhecer repetições: mandar o mesmo evento duas vezes não faz mal.

**Assinatura.** Cada pedido leva o cabeçalho `X-Gravadora-Assinatura: t=<segundos unix>,v1=<hex>`, onde

```
v1 = HMAC-SHA256(GRAVADORA_WEBHOOK_SECRET, "<t>.<corpo exatamente como foi enviado>")
```

É o mesmo esquema do Stripe. Um pedido com mais de 5 minutos é recusado, mesmo com a assinatura certa. Em Node, do lado da plataforma:

```js
const crypto = require('crypto');
const corpo = JSON.stringify(evento);
const t = Math.floor(Date.now() / 1000);
const v1 = crypto.createHmac('sha256', SEGREDO).update(`${t}.${corpo}`).digest('hex');
await fetch(URL, { method: 'POST', body: corpo,
  headers: { 'Content-Type': 'application/json', 'X-Gravadora-Assinatura': `t=${t},v1=${v1}` } });
```

Respostas: `200` recebido, `400` assinatura ou dados errados (não vale a pena repetir), `5xx` tente mais tarde.

### Caminho 2: nós vamos buscar (feed)

O servidor pede `GET GRAVADORA_FEED_URL` de tantos em tantos minutos, e também quando se carrega em **Sincronizar agora** no painel. A resposta é `{ "lancamentos": [ ... ] }` (ou só a lista). O que não vier na lista **não é apagado**, porque um feed paginado ou a meio de uma falha não pode esvaziar o site. Para tirar um lançamento, use `lancamento.removido` ou esconda-o no painel.

| Variável | Para quê |
| --- | --- |
| `GRAVADORA_WEBHOOK_SECRET` | Liga o caminho 1. Um texto longo e aleatório, combinado com a plataforma. |
| `GRAVADORA_FEED_URL` | Liga o caminho 2. |
| `GRAVADORA_TOKEN` | Vai no pedido do feed como `Authorization: Bearer ...`. |
| `GRAVADORA_INTERVALO_MIN` | De quantos em quantos minutos se vai buscar (60 por omissão, mínimo 5). |
| `GRAVADORA_NOME` | Nome mostrado no painel. |

> **De onde vêm as reproduções?** A API pública do Spotify não dá números de reproduções. Esses números estão no Spotify for Artists e nos relatórios do distribuidor, e é daí que a plataforma da gravadora os tem de tirar para os mandar para cá.

---

## YouTube (views dos vídeos)

Os números dos cartões em **"Saíram deste estúdio"** vêm escritos à mão em `publico/assets/js/singles.js`. Esta integração vai ao YouTube de tantos em tantos minutos buscar as **views** de cada vídeo e atualiza esses números sozinha. O cartão mostra sempre o **maior** entre o número escrito à mão e as views do YouTube, por isso nunca desce e sobe à medida que o vídeo cresce.

Ao contrário do Spotify, **as views do YouTube são públicas**: basta uma chave da API. Sem chave, a integração fica desligada e o site mostra os números à mão, como antes.

### A lista de músicas

Em [`fornecedores/youtube-musicas.js`](fornecedores/youtube-musicas.js), uma por bloco. Já lá estão as sete de `singles.js`; falta colar o link do YouTube de cada uma:

```js
{
  id: 'boca-mundo',                 // identificador estável
  titulo: 'Boca Mundo',
  artista: 'Brou As, khalashy',
  youtube: 'https://youtu.be/XXXXXXXXXXX',   // <- o link do vídeo no YouTube
  link: 'https://open.spotify.com/intl-pt/track/7Ges...',  // IGUAL ao de singles.js
  data: '2023',
}
```

O campo **`link`** (o do Spotify, igual ao de `singles.js`) é o que faz as views juntarem-se ao cartão certo em vez de criarem um repetido. Uma música sem `youtube` é ignorada até lhe colar o link; uma música tirada da lista desaparece do site (fica no histórico).

### A chave da API (gratuita)

1. Entre em [console.cloud.google.com](https://console.cloud.google.com) com a conta Google e crie um projeto (*Select a project → New project*).
2. Em *APIs & Services → Library*, procure **YouTube Data API v3** e carregue em **Enable**.
3. Em *APIs & Services → Credentials → Create credentials → API key*. Copie a chave.
4. (Recomendado) Carregue em **Edit API key → Restrict key → API restrictions** e limite-a à *YouTube Data API v3*, para a chave não servir para mais nada se vazar.
5. Ponha a chave na variável `YOUTUBE_API_KEY` e reinicie.

> O limite gratuito é de 10 000 unidades por dia e cada ida ao YouTube custa 1. Mesmo de 15 em 15 minutos são menos de 100 por dia: fica muito à vontade.

### Ligar

| Variável | Para quê |
| --- | --- |
| `YOUTUBE_API_KEY` | Liga a integração. A chave da YouTube Data API v3. |
| `YOUTUBE_INTERVALO_MIN` | De quantos em quantos minutos se vão buscar as views (60 por omissão, mínimo 15). |
| `YOUTUBE_NOME` | Nome mostrado no painel. |

No painel, em **Integrações**, o cartão **YouTube** mostra quantas músicas já têm vídeo e quando foi a última ida ao YouTube. **Sincronizar agora** vai buscar as views na hora, sem esperar pelo relógio.

---

## Acrescentar outra integração

1. Crie `fornecedores/<nome>.js`, que exporta:
   - `id`, que também dá o endereço do webhook: `/integracoes/webhooks/<id>`
   - `estado()`, que devolve `{ id, nome, ativo, detalhes: [[rótulo, valor], ...] }` para o painel
   - opcionais: `webhook(corpo, cabecalhos)` (o corpo chega em bruto, num Buffer), `iniciar()`, `parar()`
2. Acrescente-o a `FORNECEDORES`, em `index.js`.
3. Para webhooks, confira a assinatura com `lib/assinatura.js` e registe o evento com `eventoNovo()` dentro da mesma transação que o trata (veja `stripe.js`).

## Testes

```bash
npm run test:integracoes
```

O Stripe e a plataforma da gravadora são simulados dentro do próprio teste, por isso corre sem internet, sem contas e sem cobrar nada.
