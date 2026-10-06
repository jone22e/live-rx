# Screen Live

Reunião por vídeo com compartilhamento de tela no navegador, no estilo Google Meet: sala com nome,
participantes com nome, câmera, microfone e tela de qualquer participante, indicador de quem está falando.
A mídia passa por um **SFU** (Selective Forwarding Unit) com mediasoup: cada participante envia cada mídia
uma vez e o servidor encaminha aos demais, sem decodificar nem gravar nada. O backend também faz o
*signaling* (salas, participantes e negociação com o SFU) pelo WebSocket.

```text
                 ┌──────────────────────────────┐
                 │           Backend            │
                 │ Fastify + WebSocket (salas)  │
                 │ mediasoup (SFU de mídia)     │
                 └───┬──────────┬──────────┬────┘
            mídia    │          │          │   mídia
                     │          │          │
               ORGANIZADOR  PARTICIPANTE  PARTICIPANTE
```

## Interface

Layout no estilo Google Meet: cabeçalho com o nome da reunião, cronômetro e selo de status; grade de
participantes com nome, iniciais quando a câmera está desligada e borda azul em quem está falando;
quando alguém compartilha a tela ela ocupa o palco e os participantes vão para uma coluna à direita
(linha inferior em telas estreitas); barra inferior com relógio e código à esquerda, botões em pílula
Microfone, Câmera, Compartilhar e Encerrar/Sair ao centro, e Informações, "Pessoas N" e tela cheia à
direita. Um indicador flutuante mostra quem está falando (avatar, nome, papel e barras animadas). O
painel de informações traz o código grande, o link e os botões de copiar; abre sozinho para quem
criou a sala.

## Salas abertas

Não há cadastro nem dono de sala. **Qualquer código válido é uma sala**: ela passa a existir quando a
primeira pessoa entra (que pode dar o nome da reunião) e é removida alguns segundos depois de esvaziar.
Códigos têm de 6 a 12 caracteres do alfabeto sem ambiguidades (sem O/0 e I/1). Quem guarda códigos fixos
é quem monta os links (por exemplo, o Flexi); o Screen Live não armazena nada.

## Fluxo

A página inicial é uma pré-entrada no estilo Meet: prévia da própria câmera e dois botões divididos, microfone
e câmera, cuja parte principal liga/desliga (ligados automaticamente, se permitidos) e cuja seta abre o menu
de dispositivos. O que for escolhido ali entra junto na sala.

**Criar sala:** informa seu nome e, opcionalmente, o nome da reunião → *Criar sala* gera um código aleatório
(ex.: `7K4P92`), entra nele e mostra o painel com o código e o link `/live/7K4P92` para compartilhar.

**Entrar:** informa seu nome e o código na página inicial, ou abre o link direto e vê a mesma pré-entrada
("Pronto para participar?", com o nome salvo preenchido). Dentro da sala todos podem ligar câmera,
microfone e compartilhar a própria tela, e todos têm o mesmo botão **Sair**.

## Topologia

- **100% SFU**: todo participante abre um transport de envio e um de recepção com o mediasoup. Cada mídia
  local (câmera, microfone, tela, áudio da tela) vira um *producer*; cada producer dos outros vira um
  *consumer*. Quem entra depois consome o que já existe; quem liga mídia depois é anunciado a todos.
- Upload de cada pessoa é constante, independentemente do tamanho da sala: a tela é codificada uma vez só.
  O custo fica na banda de saída do servidor (uma cópia por receptor).
- A tela em destaque é a do apresentador mais recente; quando ele para, volta para quem ainda apresenta.
- Desligar câmera/microfone/tela fecha o producer; os outros recebem `sfu-producer-closed` e atualizam na hora.
- Tela limitada a 6 Mbps; câmera a 640×360 e 600 kbps. Codecs: Opus, VP8 e H264.
- A mídia vai cifrada (DTLS-SRTP) do navegador ao servidor e do servidor aos navegadores. O servidor
  encaminha pacotes sem decodificar e não grava nada.
- A sala vive enquanto tem gente; vazia, é removida após `EMPTY_ROOM_GRACE_MS` (10 s). Ninguém encerra a sala
  pela interface; a API de integração pode encerrá-la.
- Sem o worker do mediasoup o backend não sobe: a reunião depende do servidor de mídia.

## Stack

| Camada   | Tecnologias                                              |
| -------- | -------------------------------------------------------- |
| Frontend | Vue 3, TypeScript, Vite, Vue Router, CSS puro            |
| Backend  | Node.js, TypeScript, Fastify, `@fastify/websocket`, mediasoup (SFU) |
| Infra    | Docker (Node Debian + Nginx), portas RTC UDP/TCP, sem BD |

## Estrutura

```text
live-rx/
├── package.json            # npm workspaces: backend + frontend
├── docker-compose.yml
├── shared/protocol.ts      # mensagens tipadas e regras do código da sala (usado pelos dois lados)
├── backend/
│   ├── Dockerfile
│   ├── test/signaling.test.ts        # teste de integração do signaling (sem navegador)
├── e2e/
│   ├── chrome-e2e.mjs                # teste de ponta a ponta em Chrome real (sala, nomes, câmeras, tela via SFU, fala, reload, saída)
│   ├── chrome.mjs                    # sobe um Chrome isolado com dispositivos falsos
│   └── cdp-lib.mjs                   # cliente mínimo do Chrome DevTools Protocol
│   └── src/
│       ├── server.ts                 # bootstrap Fastify, /health, shutdown
│       ├── config.ts                 # variáveis de ambiente (mediasoup, limites, graça)
│       ├── sfu/sfu-service.ts        # mediasoup: worker, router por sala, transports/producers/consumers
│       ├── api/rooms-api.ts          # API REST de integração (token): gerar código, estado, renomear, encerrar
│       ├── rooms/room-code.ts        # gerador de códigos (alfabeto sem O/0/I/1)
│       ├── rooms/room-manager.ts     # salas abertas em memória: nascem no primeiro join, somem vazias
│       └── websocket/
│           ├── peer.ts               # estado de um socket (id aleatório, nome, sala)
│           ├── validate.ts           # validação estrutural de toda mensagem recebida
│           └── handler.ts            # rota /ws, entrada/saída de sala, pedidos ao SFU, heartbeat
└── frontend/
    ├── Dockerfile, nginx.conf, vite.config.ts
    └── src/
        ├── pages/        HomePage (pré-entrada + criar/entrar), RoomPage (pré-entrada + sala)
        ├── components/   AppIcon, StatusBadge, DebugPanel, ParticipantTile, ParticipantsStrip (grade/coluna)
        │   └── room/     PreJoinPanel (prévia, botões divididos com menu de dispositivos), RoomHeader, RoomStage, RoomToolbar,
        │                 RoomInfoPanel, SpeakingIndicator
        ├── composables/  useRoomSession, useMeeting, useRtcStats, useDebugMode, useFullscreen, useClipboard
        ├── services/
        │   ├── websocket.ts      # SignalingClient (reconexão com backoff). Não conhece WebRTC.
        │   ├── sfu.ts            # SfuNetwork: device, transports, producers e consumers do mediasoup-client
        │   ├── media-network.ts  # tipos de mídia remota
        │   ├── audio-level.ts    # detecção de fala por nível de áudio (Web Audio)
        │   ├── stats.ts          # leitura de getStats() para o painel de debug
        │   ├── screen-capture.ts # getDisplayMedia com fallback sem áudio
        │   ├── profile.ts        # nome do usuário salvo no navegador
        │   └── config.ts         # URL do signaling e link de compartilhamento
        └── styles/main.css
```

Separação de responsabilidades: a interface (pages/components) só usa os composables; `useMeeting`
orquestra `SfuNetwork` e a mídia local; `useRoomSession` cuida da entrada e saída da sala sobre
`SignalingClient`. O signaling transporta mensagens tipadas e não conhece mediasoup.

## Protocolo de signaling

Definido em `shared/protocol.ts`.

Cliente → servidor: `join-room` (código, nome do usuário e, opcionalmente, nome da reunião, usado só se a sala
nascer neste join), `sfu-request` (com `requestId` e uma ação: `capabilities`, `create-transport`,
`connect-transport`, `produce`, `close-producer`, `consume`, `resume-consumer`), `leave`.

Servidor → cliente: `room-joined` (nome da sala e lista de `participants` com nome), `participant-joined`,
`participant-left`, `sfu-response` (mesmo `requestId`), `sfu-producer`, `sfu-producer-closed`,
`room-updated` (renomeada pela API), `room-closed` (encerrada pela API ou shutdown), `error`.

Regras aplicadas no servidor:

- toda mensagem é validada estruturalmente; tamanho máximo de 64 KB;
- a sala é atribuída pelo servidor ao socket; o código enviado pelo cliente só é usado no momento do `join-room`;
- nomes são normalizados (espaços) e limitados (40 caracteres para pessoas, 60 para a reunião);
- pedidos ao SFU só valem para quem está em uma sala e só alcançam producers **da mesma sala**; parâmetros WebRTC são validados pelo mediasoup e erros voltam como `sfu-response` com `ok: false`;
- IDs de peer são UUIDs aleatórios;
- sala é removida (e o router do mediasoup fechado) quando fica vazia por `EMPTY_ROOM_GRACE_MS`, pela API ou no shutdown do servidor; ao sair, os transports do participante são fechados e os outros avisados;
- heartbeat ping/pong a cada 25 s remove sockets mortos (e mantém o WebSocket vivo atrás do Cloudflare).

## Requisitos

- Node.js 20+ (desenvolvido com Node 24)
- Chrome/Edge (recomendado), Firefox ou Safari atuais
- Para **transmitir**, o site precisa estar em contexto seguro: `https://` ou `http://localhost`

## Rodando localmente (desenvolvimento)

```bash
npm install
npm run dev
```

- Frontend: <http://localhost:5180> (o Vite faz proxy de `/ws` e `/health` para o backend)
- Backend: <http://localhost:3005> (`/health`, `/ws`)

Variáveis de ambiente do backend estão em `.env.example` (nenhuma é obrigatória).
Para subir só um lado: `npm run dev -w backend` ou `npm run dev -w frontend`.

### Teste rápido na mesma máquina

1. Abra <http://localhost:5180> no Chrome, informe seu nome e clique em **Criar sala**.
2. Copie o link do painel (ex.: `http://localhost:5180/live/7K4P92`) e abra em uma janela anônima; informe outro nome e clique em **Participar**.
3. Ligue câmera, microfone ou **Compartilhar** em qualquer uma das janelas. Adicione `?debug=1` à URL para ver estados, codec, bitrate, RTT e tipo de candidato ICE.

### Teste de signaling (sem navegador)

```bash
npm run test:signaling
```

Sobe um servidor em porta livre (com worker do mediasoup) e valida: sala criada no primeiro join com código
longo e nome normalizado, segundo participante no mesmo código, limite de participantes, pedidos fora de
sala, negociação com o SFU (capacidades, transport com IP anunciado roteável, erros controlados), isolamento
entre salas, fechamento da sala vazia após a tolerância, reabertura pelo mesmo código, payload grande, a API
de integração (token, geração de código, estado, renomear, encerrar) e ausência de salas vazadas.

### Teste de ponta a ponta no Chrome

Com `npm run dev` rodando e o Google Chrome instalado:

```bash
npm run test:e2e
```

Abre um Chrome isolado (perfil temporário, porta livre do DevTools, captura de aba automática, câmera falsa e
um microfone sintético com tom intermitente injetado na página, porque o microfone falso do Chrome só emite
bipes esporádicos) e verifica (com `SCREENSHOT_DIR=pasta` também salva capturas das telas): pré-entrada com
prévia da câmera e menus de dispositivos; criação da sala com nome pelo primeiro a entrar; entrada pela
pré-entrada com nome; grade com todos os participantes e nomes; câmera, microfone e indicador de quem fala;
tela chegando aos outros pelo SFU (transports conectados, codec, bitrate, resolução e RTT do painel de debug);
terceiro participante recebendo tudo sem ligar nada; outro participante apresentando e a troca de apresentador
nos demais; reload; saída do criador sem fechar a sala; fechamento automático da sala vazia.

## Rodando com Docker

```bash
docker compose up -d --build
```

- Site em <http://localhost:3012> (`WEB_PORT` para trocar).
- O Nginx do container `frontend` serve o SPA e faz proxy de `/ws`, `/api` e `/health` para o `backend`.
- O `backend` publica **uma única porta de mídia** (`MEDIASOUP_RTC_PORT`, padrão 40000, UDP e TCP) e exige
  `MEDIASOUP_ANNOUNCED_IP`, o endereço pelo qual os navegadores alcançam a mídia (IP do balanceador, IP público
  do servidor ou IP da máquina na LAN).
- Sem o IP anunciado correto, a sinalização funciona mas a mídia não chega.

## Instalação no servidor (porta 3012)

1. Pré-requisitos: Docker com Compose, um domínio apontando para o servidor (ex.: `live.exemplo.com`)
   e as portas liberadas: 80/443 (proxy reverso) e **40000 UDP e TCP** (mídia).
   A porta 3012 só precisa ser alcançável pelo proxy reverso local.
2. No servidor, dentro da pasta do projeto, crie o `.env` a partir de `deploy/.env.server.example`:
   `WEB_PORT=3012`, `MEDIASOUP_ANNOUNCED_IP` (veja a seção da AWS abaixo), `API_TOKEN`
   (ex.: `openssl rand -hex 32`) e `PUBLIC_URL=https://live.exemplo.com`.
3. Suba: `docker compose up -d --build`. Confira: `curl http://127.0.0.1:3012/health` deve responder
   `{"ok":true,...,"sfu":true}`. A primeira construção pode levar vários minutos: se o worker pré-compilado
   do mediasoup não rodar no host, o instalador compila o worker do zero dentro da etapa de build
   (a imagem já traz Python e compilador para isso). As seguintes usam o cache.
4. Configure o proxy reverso com TLS na frente da 3012; `deploy/reverse-proxy.nginx.conf` é um exemplo
   pronto para Nginx (o essencial é o upgrade de WebSocket em `/ws` e timeouts longos).
5. Se usar Cloudflare como proxy do domínio: o tráfego HTTP/WebSocket passa por ele normalmente, mas a
   mídia **não**. `MEDIASOUP_ANNOUNCED_IP` deve ser um endereço que receba UDP/TCP direto, nunca o do Cloudflare.
6. Atualizações: `make update` (faz `git pull`, recria os containers e confere o `/health`). Outros atalhos:
   `make logs`, `make status`, `make down`.

A URL para o Flexi é a do domínio, por exemplo `https://live.exemplo.com/live/{código}`; a API fica em
`https://live.exemplo.com/api/rooms` com o `API_TOKEN` do `.env`.

### AWS com instância privada (sem IP público)

A mídia precisa de um endereço público que receba UDP/TCP, mas ele não precisa ser da instância. Um
Network Load Balancer com IP elástico encaminha a porta de mídia para a instância em sub-rede privada:

1. **Elastic IP** para o NLB (um por zona de disponibilidade usada).
2. **NLB internet-facing** com um listener **TCP_UDP** na porta 40000 apontando para um *target group*
   do tipo instância, protocolo TCP_UDP, porta 40000, com a instância do Screen Live como alvo.
   Health check: HTTP na porta 3012, caminho `/health`.
3. **Security group da instância**: entrada TCP e UDP 40000 (origem `0.0.0.0/0`, pois o NLB preserva o IP
   do cliente) e TCP 3012 a partir do proxy reverso/ALB que serve o site.
4. No `.env`: `MEDIASOUP_ANNOUNCED_IP` = IP elástico do NLB e `MEDIASOUP_RTC_PORT=40000`. A porta
   anunciada e a porta do listener precisam ser iguais.
5. O site e o WebSocket continuam pelo caminho HTTP de sempre (ALB/Cloudflare → porta 3012). Só a mídia
   entra pelo NLB.

Uma porta só é suficiente: o mediasoup multiplexa todos os participantes nela (modo `WebRtcServer`).

## Produção com HTTPS

`getDisplayMedia` e `getUserMedia` só funcionam em contexto seguro. Coloque um terminador TLS (Cloudflare, Nginx, Traefik, Caddy)
na frente da porta 3012 do compose. O tráfego de mídia do mediasoup (UDP/TCP 40000) vai direto ao servidor ou ao NLB, fora do proxy. O frontend conecta em `wss://<mesma origem>/ws` automaticamente.
O proxy precisa repassar WebSocket (`Upgrade`/`Connection: upgrade`) na rota `/ws` e manter conexões ociosas abertas
por pelo menos 60 s (o heartbeat do servidor é de 25 s).

Se o backend ficar em outro domínio, construa o frontend com `VITE_WS_URL=wss://api.exemplo.com/ws`
(argumento `--build-arg VITE_WS_URL=...` no Dockerfile) e defina `ALLOWED_ORIGINS=https://site.exemplo.com` no backend.
`ICE_SERVERS` (STUN/TURN) é entregue aos transports do navegador; o padrão com STUN público basta na maioria dos casos.

## Teste com dois computadores em redes diferentes (critério de conclusão)

1. Publique a aplicação em um domínio com HTTPS (ex.: `https://live.exemplo.com`) seguindo a seção acima.
   Confirme `https://live.exemplo.com/health` respondendo `{"ok":true,...}`.
2. **Computador A** (rede residencial A, Chrome): abra `https://live.exemplo.com`, informe seu nome, clique em
   **Criar sala**, depois em **Compartilhar** e escolha o monitor; anote o código do painel (ex.: `ABC123`).
3. **Computador B** (outra rede, 4G ou outra residência, Chrome): abra `https://live.exemplo.com/live/ABC123`, informe um nome e clique em **Participar**.
4. Resultado esperado: a tela de A aparece em B em poucos segundos com "A está apresentando"; em ambos a barra mostra **Pessoas 2**.
5. Com `?debug=1`, o painel mostra os transports `sfu:send` e `sfu:recv` conectados, codec, bitrate e RTT até o servidor.
   Também é possível conferir em `chrome://webrtc-internals`.
6. Nenhuma porta precisa ser aberta nos roteadores dos participantes: todos conectam de saída ao servidor.
   As portas abertas ficam só no servidor ou no balanceador (HTTPS e a porta de mídia do mediasoup).

## Comportamentos de resiliência

| Situação                                           | Comportamento                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Apresentador para pelo botão do navegador          | `track.onended` desliga o compartilhamento; os outros voltam à grade ou a outro apresentador.      |
| Último participante sai                            | Sala fica vazia por `EMPTY_ROOM_GRACE_MS` e é removida; o mesmo código reabre uma sala nova.        |
| Participante fecha a aba                           | `pagehide` avisa o servidor; se não chegar, o heartbeat detecta a queda em até 50 s.               |
| Sala encerrada pela API                            | Todos veem **A sala foi encerrada.**                                                              |
| Participante recarrega a página                    | Passa pela pré-entrada com o nome salvo e entra com novo peer; consome o que já existe.             |
| Participante perde o WebSocket                     | Reconexão com backoff; ao voltar, entra de novo na sala.                                          |
| Conexão com o servidor de mídia falha              | Aviso "Não foi possível conectar ao servidor de mídia."                                            |
| Autoplay com áudio bloqueado                       | Reproduz mudo e mostra o botão **Ativar som** (vale para a tela e para os tiles).                 |
| Participante entra com mídias já ligadas           | Publica no SFU ao entrar; os outros recebem `sfu-producer` e consomem.                             |
| Dispositivo removido / permissão revogada          | `track.onended` desliga o toggle e para de enviar.                                                |

## API de integração (ex.: Flexi)

Habilitada definindo `API_TOKEN` no backend. Toda chamada leva `Authorization: Bearer <token>`.
`PUBLIC_URL` (ex.: `https://live.exemplo.com`) faz os links virem absolutos.

| Método e rota              | O que faz                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/rooms`          | Gera um código livre (10 caracteres; `{"length": 6..12}` opcional). Resposta: `{ code, url }`. Nada é armazenado: guarde o código no seu sistema. |
| `GET /api/rooms`           | Salas ativas: código, nome, URL, criação e quantidade de pessoas.                           |
| `GET /api/rooms/{code}`    | Estado ao vivo da sala: participantes (nome, se compartilha tela). `404` se ninguém está nela. |
| `PATCH /api/rooms/{code}`  | Renomeia uma sala ativa (`{"name": "..."}`); quem está dentro vê o novo nome na hora.        |
| `DELETE /api/rooms/{code}` | Encerra uma sala ativa; todos recebem "A sala foi encerrada."                               |
| `POST /api/rooms/{code}/join-tokens` | Emite um token de entrada para um usuário (`{"name": "...", "ttlSeconds"?: 3600}`). Devolve `url` com `?t=` para abrir: a pré-entrada mostra o nome vindo do servidor, sem expô-lo no link. Reutilizável até expirar (padrão 1 h). |
| `GET /api/public/rooms/{code}/join-tokens/{token}` | Sem token de API; usado pela pré-entrada para descobrir o nome. |
| `GET /api/docs`            | Documentação da API em HTML, pública.                                                       |

Exemplo:

```bash
curl -s -X POST -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{}' https://live.exemplo.com/api/rooms
# {"code":"7K4P92ABCD","url":"https://live.exemplo.com/live/7K4P92ABCD"}
```

Como as salas são abertas, o Flexi só precisa guardar o código e montar o link `/live/{code}`; a sala
nasce quando a primeira pessoa entra. Para salas fixas de uso interno, prefira os códigos de 10 caracteres
gerados pela API, mais difíceis de adivinhar que os de 6 do botão "Criar sala".

Para entrar com o nome do usuário logado sem colocá-lo no link, emita um token de entrada e abra a `url`
devolvida. Se o token expirar ou o servidor reiniciar (tokens ficam só em memória), a página volta a pedir o
nome. A documentação completa, com exemplos, fica em `/api/docs` no próprio servidor.

## Debug

Adicione `?debug=1` à página da sala (`/live/ABC123?debug=1`) para um painel com
peerId, roomId, estado do signaling, `connectionState`, `iceConnectionState`, `signalingState`,
tipo de candidato ICE, codec, bitrate, resolução, FPS, RTT, pacotes perdidos e bytes enviados/recebidos,
lidos de `RTCPeerConnection.getStats()` a cada segundo.

## Scripts

| Comando                   | Descrição                                           |
| ------------------------- | --------------------------------------------------- |
| `npm run dev`             | backend + frontend em modo desenvolvimento          |
| `npm run build`           | compila backend (`tsc`) e frontend (`vite build`)   |
| `npm start`               | inicia o backend compilado                          |
| `npm run typecheck`       | `tsc --noEmit` no backend e `vue-tsc` no frontend   |
| `npm run test:signaling`  | teste de integração do signaling                    |
| `npm run test:e2e`        | teste de ponta a ponta no Chrome (requer `npm run dev`) |
| `make update`             | no servidor: `git pull` + `docker compose up -d --build` + health |

## Fora do escopo deste MVP

Login, gravação, chat, reações, simulcast, TURN próprio, HLS, banco de dados, múltiplos workers do mediasoup.
`MAX_VIEWERS_PER_ROOM` no backend limita o tamanho da sala.
