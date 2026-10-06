import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isRoomCode, MAX_DISPLAY_NAME_LENGTH, MAX_ROOM_NAME_LENGTH, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH } from '../../../shared/protocol.js';
import type { AppConfig } from '../config.js';
import type { JoinTokenStore } from '../rooms/join-tokens.js';
import { generateRoomCode } from '../rooms/room-code.js';
import type { Room, RoomManager } from '../rooms/room-manager.js';
import type { SfuService } from '../sfu/sfu-service.js';

export interface RoomsApiDeps {
  config: AppConfig;
  rooms: RoomManager;
  sfu: SfuService;
  joinTokens: JoinTokenStore;
}

/** Tamanho padrão dos códigos gerados pela API: mais longos que os do botão "Criar sala", difíceis de adivinhar. */
const API_CODE_LENGTH = 10;
const MAX_CODE_ATTEMPTS = 20;
const MAX_JOIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Alcance do token usado na chamada: API_TOKEN faz tudo; API_RECORDER_TOKEN só lê e emite tokens de gravador. */
type ApiScope = 'full' | 'recorder';

function tokenMatches(expected: string | null, header: string | undefined): boolean {
  if (!expected || !header) return false;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

declare module 'fastify' {
  interface FastifyRequest {
    apiScope?: ApiScope;
  }
}

/**
 * API REST para integração (ex.: Flexi), protegida por API_TOKEN. Salas são abertas e só vivem
 * enquanto têm gente: a API gera códigos, consulta o estado ao vivo, renomeia e encerra.
 */
export function registerRoomsApi(app: FastifyInstance, deps: RoomsApiDeps): void {
  const { config, rooms, sfu, joinTokens } = deps;

  const roomUrl = (code: string): string => (config.publicUrl ? `${config.publicUrl}/live/${code}` : `/live/${code}`);

  const describe = (room: Room) => {
    const screenSharers = new Set(sfu.producersOf(room.id, '').filter((p) => p.purpose === 'screen').map((p) => p.peerId));
    const people = [...room.members.values()].filter((m) => !m.recorder);
    return {
      code: room.id,
      name: room.name,
      url: roomUrl(room.id),
      createdAt: new Date(room.createdAt).toISOString(),
      /** Pessoas na reunião (gravadores não contam). */
      participantCount: people.length,
      /** Há um gravador (ex.: ScreenRx) dentro da sala. */
      recording: rooms.isRecording(room),
      participants: people.map((m) => ({ peerId: m.id, name: m.name, sharingScreen: screenSharers.has(m.id) })),
    };
  };

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // /api/public/* é consultado pelo próprio frontend e /api/docs é a documentação: ambos sem token.
    if (!request.url.startsWith('/api/') || request.url.startsWith('/api/public/') || request.url.startsWith('/api/docs')) return;
    if (!config.apiToken && !config.apiRecorderToken) {
      await reply.code(503).send({ error: 'API desabilitada: defina API_TOKEN no servidor.' });
      return;
    }
    const header = request.headers.authorization;
    if (tokenMatches(config.apiToken, header)) request.apiScope = 'full';
    else if (tokenMatches(config.apiRecorderToken, header)) request.apiScope = 'recorder';
    else await reply.code(401).send({ error: 'Token inválido.' });
  });

  /** Rotas que alteram salas ou identificam pessoas: só com API_TOKEN. */
  const requireFullScope = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.apiScope !== 'full') await reply.code(403).send({ error: 'Esta rota exige o API_TOKEN completo.' });
  };

  app.get('/api/docs', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderDocs(config.publicUrl ?? '')));

  app.get('/api/rooms', async () => ({
    rooms: rooms.listRooms().map((room) => {
      const { participants: _participants, ...summary } = describe(room);
      return summary;
    }),
  }));

  app.post<{ Body: { length?: unknown } | undefined }>('/api/rooms', { preHandler: requireFullScope }, async (request, reply) => {
    const requested = request.body?.length;
    const length = typeof requested === 'number' && Number.isInteger(requested) ? requested : API_CODE_LENGTH;
    if (length < ROOM_CODE_MIN_LENGTH || length > ROOM_CODE_MAX_LENGTH) {
      return reply.code(400).send({ error: `length deve estar entre ${ROOM_CODE_MIN_LENGTH} e ${ROOM_CODE_MAX_LENGTH}.` });
    }
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode(length);
      if (!rooms.getRoom(code)) return reply.code(201).send({ code, url: roomUrl(code) });
    }
    return reply.code(503).send({ error: 'Não foi possível gerar um código livre.' });
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    const room = rooms.getRoom(code);
    if (!room) return reply.code(404).send({ code, active: false, url: roomUrl(code) });
    return { active: true, ...describe(room) };
  });

  app.patch<{ Params: { code: string }; Body: { name?: unknown } | undefined }>('/api/rooms/:code', { preHandler: requireFullScope }, async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    const raw = request.body?.name;
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > MAX_ROOM_NAME_LENGTH) return reply.code(400).send({ error: `name é obrigatório (até ${MAX_ROOM_NAME_LENGTH} caracteres).` });
    const room = rooms.renameRoom(code, name);
    if (!room) return reply.code(404).send({ error: 'Sala não está ativa.' });
    return describe(room);
  });

  /**
   * Token de entrada: identifica o usuário (nome) no link sem expor o nome. Válido mesmo com a sala ainda vazia.
   * Com `recorder: true` vira token de gravador: quem entra só assiste e grava (sem câmera/microfone) e a sala
   * mostra "Gravando". O API_RECORDER_TOKEN só pode emitir tokens de gravador.
   */
  app.post<{ Params: { code: string }; Body: { name?: unknown; ttlSeconds?: unknown; recorder?: unknown } | undefined }>('/api/rooms/:code/join-tokens', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    const recorder = request.body?.recorder === true;
    if (!recorder && request.apiScope !== 'full') return reply.code(403).send({ error: 'Este token só emite tokens de gravador (recorder: true).' });
    const raw = request.body?.name;
    const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!name || name.length > MAX_DISPLAY_NAME_LENGTH) return reply.code(400).send({ error: `name é obrigatório (até ${MAX_DISPLAY_NAME_LENGTH} caracteres).` });
    const ttlRaw = request.body?.ttlSeconds;
    const ttlMs = typeof ttlRaw === 'number' && Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(ttlRaw * 1000, MAX_JOIN_TOKEN_TTL_MS) : config.joinTokenTtlMs;
    const issued = joinTokens.issue(code, name, ttlMs, recorder);
    return reply.code(201).send({
      token: issued.token,
      code,
      name: issued.name,
      recorder,
      expiresAt: new Date(issued.expiresAt).toISOString(),
      url: `${roomUrl(code)}?t=${encodeURIComponent(issued.token)}`,
    });
  });

  /** Consultado pela pré-entrada para mostrar o nome antes de conectar (sem API_TOKEN). */
  app.get<{ Params: { code: string; token: string } }>('/api/public/rooms/:code/join-tokens/:token', async (request, reply) => {
    const code = request.params.code.toUpperCase();
    const identity = isRoomCode(code) ? joinTokens.resolve(request.params.token, code) : null;
    if (!identity) return reply.code(404).send({ error: 'Token inválido ou expirado.' });
    return { code, name: identity.name, recorder: identity.recorder, expiresAt: new Date(identity.expiresAt).toISOString() };
  });

  app.delete<{ Params: { code: string } }>('/api/rooms/:code', { preHandler: requireFullScope }, async (request, reply) => {
    const code = request.params.code.toUpperCase();
    if (!isRoomCode(code)) return reply.code(400).send({ error: 'Código inválido.' });
    if (!rooms.closeRoomById(code)) return reply.code(404).send({ error: 'Sala não está ativa.' });
    return reply.code(204).send();
  });
}

/** Documentação da API de integração, servida em /api/docs (HTML estático, sem dependências). */
function renderDocs(publicUrl: string): string {
  const base = publicUrl || 'https://SEU-DOMINIO';
  const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const code = (text: string) => `<pre><code>${esc(text)}</code></pre>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screen Live · API de integração</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #202124; color: #eef0f5; font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 28px; margin: 0 0 6px; } h2 { font-size: 20px; margin: 40px 0 10px; border-bottom: 1px solid #343a4a; padding-bottom: 6px; }
  h3 { font-size: 16px; margin: 26px 0 6px; } p, li { color: #c9cdd8; } a { color: #7aa0ff; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; background: #171b25; padding: 2px 6px; border-radius: 5px; }
  pre { background: #12151d; border: 1px solid #262b38; border-radius: 10px; padding: 14px 16px; overflow: auto; } pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; } th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #262b38; vertical-align: top; } th { color: #8b91a3; font-weight: 600; }
  .method { display: inline-block; min-width: 58px; font-weight: 700; font-family: ui-monospace, monospace; } .get { color: #30c48d; } .post { color: #7aa0ff; } .patch { color: #f5a524; } .del { color: #ff8a8e; }
  .note { background: rgba(79,124,255,.1); border-left: 3px solid #4f7cff; padding: 10px 14px; border-radius: 6px; }
</style>
</head>
<body>
<main>
<h1>Screen Live · API de integração</h1>
<p>Reuniões por vídeo com compartilhamento de tela. Esta API permite a outro sistema (ex.: Flexi) gerar códigos de sala, identificar usuários, consultar quem está na reunião, renomear e encerrar salas.</p>

<h2>Como funciona</h2>
<ul>
  <li><strong>Salas são abertas.</strong> Qualquer código válido é uma sala: ela passa a existir quando a primeira pessoa entra e some poucos segundos depois de esvaziar. Nada é armazenado no Screen Live. <strong>Quem guarda o código é o seu sistema.</strong></li>
  <li><strong>Código:</strong> 6 a 12 caracteres de <code>ABCDEFGHJKLMNPQRSTUVWXYZ23456789</code> (sem O/0 e I/1). A API gera códigos de 10 caracteres, difíceis de adivinhar.</li>
  <li><strong>Link da sala:</strong> <code>${esc(base)}/live/{código}</code>. Quem abre vê a pré-entrada (câmera, microfone e nome) e clica em Participar.</li>
  <li><strong>Nome do usuário logado:</strong> emita um <em>token de entrada</em> e use o link devolvido. O nome fica no servidor, não no link.</li>
  <li><strong>Mídia:</strong> vídeo e áudio passam cifrados por um servidor de mídia (SFU) que só encaminha, sem gravar.</li>
</ul>

<h2>Autenticação</h2>
<p>Todas as rotas em <code>/api/</code>, exceto <code>/api/public/</code> e esta página, exigem o cabeçalho:</p>
${code('Authorization: Bearer <API_TOKEN>')}
<p>O token é definido na variável <code>API_TOKEN</code> do servidor. Sem ele configurado, a API responde <code>503</code>. Token errado responde <code>401</code>.</p>
<p>Há um segundo token, opcional, para quem só grava reuniões (ex.: ScreenRx): <code>API_RECORDER_TOKEN</code>. Com ele só é possível listar salas, consultar o estado e emitir <em>tokens de gravador</em>; gerar códigos, renomear, encerrar ou emitir tokens de pessoas responde <code>403</code>.</p>

<h2>Fluxo recomendado</h2>
<ol>
  <li>Ao criar o registro que terá reunião (atendimento, cliente, evento), chame <code>POST /api/rooms</code> e guarde o <code>code</code>.</li>
  <li>Quando um usuário logado for entrar, chame <code>POST /api/rooms/{code}/join-tokens</code> com o nome dele e abra a <code>url</code> devolvida (nova aba ou iframe).</li>
  <li>Para mostrar "N pessoas na reunião", consulte <code>GET /api/rooms/{code}</code>.</li>
</ol>

<h2>Rotas</h2>

<h3><span class="method post">POST</span> /api/rooms</h3>
<p>Gera um código livre. Corpo opcional: <code>{"length": 6..12}</code> (padrão 10). Não cria nada no servidor: a sala nasce quando alguém entra.</p>
${code(`curl -s -X POST ${base}/api/rooms \\
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" -d '{}'

{"code":"7K4P92ABCD","url":"${base}/live/7K4P92ABCD"}`)}

<h3><span class="method post">POST</span> /api/rooms/{code}/join-tokens</h3>
<p>Emite um token de entrada que identifica o usuário na sala sem expor o nome no link. Corpo: <code>{"name": "Nome do usuário", "ttlSeconds": 3600}</code> (<code>ttlSeconds</code> opcional, padrão 1 h, máximo 24 h). O token é reutilizável até expirar (suporta recarregar a página) e vale só para o código informado. Pode ser emitido com a sala ainda vazia.</p>
${code(`curl -s -X POST ${base}/api/rooms/7K4P92ABCD/join-tokens \\
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"Jone Schotten"}'

{"token":"k9Qx…","code":"7K4P92ABCD","name":"Jone Schotten","expiresAt":"2026-10-06T19:00:00.000Z",
 "url":"${base}/live/7K4P92ABCD?t=k9Qx…"}`)}
<p class="note">Abra a <code>url</code> para o usuário. A pré-entrada mostra o nome dele e pede só a confirmação. Se o token expirar ou o servidor reiniciar, a página pede o nome normalmente.</p>
<p>Com <code>"recorder": true</code> no corpo, o token é de <strong>gravador</strong>: quem abre a <code>url</code> entra direto, sem pré-entrada, sem câmera nem microfone, e não aparece como pessoa para os outros. Enquanto estiver dentro, a sala mostra <strong>Gravando</strong> para todos e <code>GET /api/rooms/{código}</code> devolve <code>"recording": true</code>. É o que o ScreenRx usa para gravar uma reunião.</p>
${code(`curl -s -X POST ${base}/api/rooms/7K4P92ABCD/join-tokens \\
  -H "Authorization: Bearer $API_RECORDER_TOKEN" -H "Content-Type: application/json" \\
  -d '{"name":"Gravação ScreenRx","recorder":true}'

{"token":"m2Vb…","code":"7K4P92ABCD","name":"Gravação ScreenRx","recorder":true,
 "expiresAt":"2026-10-06T19:00:00.000Z","url":"${base}/live/7K4P92ABCD?t=m2Vb…"}`)}

<h3><span class="method get">GET</span> /api/rooms/{code}</h3>
<p>Estado ao vivo da sala. <code>404</code> se ninguém está nela.</p>
${code(`{"active":true,"code":"7K4P92ABCD","name":"Reunião","url":"${base}/live/7K4P92ABCD",
 "createdAt":"2026-10-06T18:02:11.000Z","participantCount":2,"recording":false,
 "participants":[{"peerId":"…","name":"Jone Schotten","sharingScreen":true},{"peerId":"…","name":"Ana","sharingScreen":false}]}`)}
<p><code>participantCount</code> e <code>participants</code> contam só pessoas; gravadores aparecem em <code>recording</code>.</p>

<h3><span class="method get">GET</span> /api/rooms</h3>
<p>Lista as salas ativas (código, nome, URL, criação, quantidade de pessoas e se está sendo gravada).</p>

<h3><span class="method patch">PATCH</span> /api/rooms/{code}</h3>
<p>Renomeia uma sala ativa. Corpo: <code>{"name": "Novo nome"}</code>. Quem está dentro vê o novo nome na hora. <code>404</code> se a sala está vazia.</p>

<h3><span class="method del">DELETE</span> /api/rooms/{code}</h3>
<p>Encerra uma sala ativa: todos os participantes recebem o aviso e saem. Responde <code>204</code>, ou <code>404</code> se a sala está vazia.</p>

<h3><span class="method get">GET</span> /api/public/rooms/{code}/join-tokens/{token}</h3>
<p>Sem autenticação. Usado pela pré-entrada para descobrir o nome associado ao token. <code>404</code> se inválido, expirado ou de outra sala.</p>

<h3><span class="method get">GET</span> /health</h3>
<p>Sem autenticação. <code>{"ok":true,"rooms":N,"participants":N,"sfu":true}</code>. <code>sfu:true</code> indica o servidor de mídia ativo.</p>

<h2>Embutir no seu sistema</h2>
<p>Nova aba: um link para a <code>url</code>. Embutido: um iframe com as permissões de mídia, senão câmera e tela ficam bloqueadas.</p>
${code(`<iframe src="${base}/live/7K4P92ABCD?t=k9Qx…"
  allow="camera; microphone; display-capture; autoplay; fullscreen"
  style="width:100%;height:100%;border:0"></iframe>`)}

<h2>Gravar uma reunião (ScreenRx)</h2>
<ol>
  <li>Defina <code>API_RECORDER_TOKEN</code> no servidor e informe a URL do Meet e esse token nas configurações do ScreenRx.</li>
  <li>O ScreenRx lista as salas ativas com <code>GET /api/rooms</code>.</li>
  <li>Ao clicar em Gravar, ele emite um token de gravador (<code>recorder: true</code>), abre a <code>url</code> numa janela própria e grava essa janela com o áudio.</li>
  <li>Todos na reunião veem <strong>Gravando</strong> enquanto o gravador estiver dentro.</li>
</ol>

<h2>Erros</h2>
<table>
<tr><th>Código</th><th>Quando</th></tr>
<tr><td>400</td><td>Código de sala, nome ou corpo inválido.</td></tr>
<tr><td>401</td><td>Token de API ausente ou errado.</td></tr>
<tr><td>403</td><td>Rota fora do alcance do <code>API_RECORDER_TOKEN</code>.</td></tr>
<tr><td>404</td><td>Sala vazia (não ativa) ou token de entrada inválido/expirado.</td></tr>
<tr><td>503</td><td>API desabilitada (sem <code>API_TOKEN</code>) ou servidor de mídia indisponível.</td></tr>
</table>
</main>
</body>
</html>`;
}
