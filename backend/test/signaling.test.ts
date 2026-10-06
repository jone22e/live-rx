/**
 * Teste de integração do signaling: sobe o servidor em uma porta livre e simula
 * participantes com clientes WebSocket. Executar com: npm run test:signaling
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';

const GRACE_MS = 400;

class Client {
  private readonly queue: ServerMessage[] = [];
  private waiter: ((m: ServerMessage) => void) | null = null;
  readonly closed: Promise<number>;
  private readonly ws: WebSocket;

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(message);
      } else {
        this.queue.push(message);
      }
    });
    this.closed = new Promise((resolve) => this.ws.on('close', (code) => resolve(code)));
  }

  static async connect(url: string): Promise<Client> {
    const client = new Client(url);
    await once(client.ws, 'open');
    return client;
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('timeout waiting for message'));
      }, timeoutMs);
      this.waiter = (m) => {
        clearTimeout(timer);
        resolve(m);
      };
    });
  }

  async expect<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const message = await this.next();
    if (message.type !== type) {
      throw new Error(`expected "${type}" but got ${JSON.stringify(message)}`);
    }
    return message as Extract<ServerMessage, { type: T }>;
  }

  async expectSilence(ms = 300): Promise<void> {
    try {
      const m = await this.next(ms);
      throw new Error(`expected no message but got ${JSON.stringify(m)}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('timeout')) throw error;
    }
  }

  close(): void {
    this.ws.close();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

async function waitForHealth(url: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function startServer(extraEnv: Record<string, string>): Promise<{ child: ChildProcess; port: number; url: string }> {
  const port = await freePort();
  const serverEntry = fileURLToPath(new URL('../src/server.ts', import.meta.url));
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      EMPTY_ROOM_GRACE_MS: String(GRACE_MS),
      MEDIASOUP_RTC_PORT: String(41000 + Math.floor(Math.random() * 4000)),
      ...extraEnv,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  return { child, port, url: `ws://127.0.0.1:${port}/ws` };
}

let passed = 0;
const step = (name: string) => {
  passed += 1;
  console.log(`  ok ${passed}. ${name}`);
};

async function run(): Promise<void> {
  const { child, port, url } = await startServer({ MAX_PARTICIPANTS_PER_ROOM: '2', API_TOKEN: 'flexi-secret', PUBLIC_URL: 'https://live.exemplo.com/' });

  try {

    // 1. qualquer código válido abre a sala; o primeiro a entrar dá o nome
    const ana = await Client.connect(url);
    ana.send({ type: 'join-room', roomId: 'abc', displayName: 'Ana' });
    assert((await ana.expect('error')).code === 'invalid-message', 'bad code format rejected');
    ana.send({ type: 'join-room', roomId: 'FLEX7K4P92' } as never);
    assert((await ana.expect('error')).code === 'invalid-message', 'join without name rejected');
    ana.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: '   ' });
    assert((await ana.expect('error')).code === 'invalid-message', 'blank display name rejected');
    ana.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: 'Ana  Souza ', roomName: ' Revisão de sprint ' });
    const joinedAna = await ana.expect('room-joined');
    assert(joinedAna.roomId === 'FLEX7K4P92' && joinedAna.roomName === 'Revisão de sprint' && joinedAna.participants.length === 0, 'room created on first join with normalized name');
    step('first join creates the room (long code accepted)');

    // 2. segundo participante entra no mesmo código; nome da sala não muda
    const bruno = await Client.connect(url);
    bruno.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: 'Bruno Lima', roomName: 'Outro nome' });
    const joinedBruno = await bruno.expect('room-joined');
    assert(joinedBruno.roomName === 'Revisão de sprint', 'room name fixed by the first participant');
    assert(joinedBruno.participants.length === 1 && joinedBruno.participants[0]?.peerId === joinedAna.peerId && joinedBruno.participants[0]?.name === 'Ana Souza', 'participant list with name');
    const pj = await ana.expect('participant-joined');
    assert(pj.peerId === joinedBruno.peerId && pj.name === 'Bruno Lima' && pj.participantCount === 2, 'existing participant notified');
    bruno.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: 'Bruno' });
    assert((await bruno.expect('error')).code === 'already-in-room', 'cannot join twice');
    step('second participant joins the same code');

    // 3. sala cheia e pedidos fora de sala
    const carla = await Client.connect(url);
    carla.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: 'Carla' });
    assert((await carla.expect('error')).code === 'room-full', 'room full enforced');
    carla.send({ type: 'sfu-request', requestId: 'x1', request: { action: 'capabilities' } });
    assert((await carla.expect('error')).code === 'not-in-room', 'sfu request outside a room rejected');
    carla.send({ type: 'leave' });
    assert((await carla.expect('error')).code === 'not-in-room', 'leave outside room rejected');
    carla.close();
    await ana.expectSilence();
    step('room limit and out-of-room requests');

    // 4. negociação com o SFU: capacidades, transport, erros controlados
    bruno.send({ type: 'sfu-request', requestId: 'r1', request: { action: 'capabilities' } });
    const caps = await bruno.expect('sfu-response');
    assert(caps.ok === true, 'capabilities ok');
    const capsData = caps.ok ? (caps.data as { rtpCapabilities: { codecs: unknown[] }; producers: unknown[] }) : null;
    assert((capsData?.rtpCapabilities.codecs.length ?? 0) > 0 && capsData?.producers.length === 0, 'router capabilities with codecs and no producers yet');
    bruno.send({ type: 'sfu-request', requestId: 'r2', request: { action: 'create-transport', direction: 'send' } });
    const transport = await bruno.expect('sfu-response');
    assert(transport.ok === true, 'create-transport ok');
    const transportData = transport.ok ? (transport.data as { id: string; iceParameters: object; iceCandidates: Array<{ ip: string }>; dtlsParameters: object }) : null;
    assert(!!transportData?.id && !!transportData.iceParameters && transportData.iceCandidates.length > 0 && !!transportData.dtlsParameters, 'transport params returned');
    assert(transportData?.iceCandidates.every((c) => c.ip !== '0.0.0.0'), `announced ip is routable (${transportData?.iceCandidates[0]?.ip})`);
    const ports = new Set(transportData?.iceCandidates.map((c) => (c as { port: number }).port));
    assert(ports.size === 1, `single media port shared by udp and tcp (${[...ports].join(',')})`);
    bruno.send({ type: 'sfu-request', requestId: 'r3', request: { action: 'connect-transport', transportId: transportData?.id ?? '', dtlsParameters: { role: 'client', fingerprints: [] } } });
    assert((await bruno.expect('sfu-response')).ok === false, 'invalid dtls parameters answered with an error, server keeps running');
    bruno.send({ type: 'sfu-request', requestId: 'r4', request: { action: 'consume', producerId: 'nope', rtpCapabilities: {} } });
    assert((await bruno.expect('sfu-response')).ok === false, 'consuming unknown producer answered with an error');
    bruno.send({ type: 'sfu-request', requestId: 'r5', request: { action: 'bogus' } } as never);
    assert((await bruno.expect('error')).code === 'invalid-message', 'unknown sfu action rejected by validation');
    step('sfu negotiation (capabilities, transport, errors)');

    // 5. salas isoladas
    const stranger = await Client.connect(url);
    stranger.send({ type: 'join-room', roomId: 'ZZZZZZ', displayName: 'Estranho' });
    const other = await stranger.expect('room-joined');
    assert(other.roomName === 'Reunião' && other.participants.length === 0, 'another code is another room with default name');
    await ana.expectSilence(150);
    stranger.send({ type: 'leave' });
    stranger.close();
    step('rooms isolated');

    // 6. saída, queda de socket e fechamento da sala vazia após a tolerância
    bruno.send({ type: 'leave' });
    const left = await ana.expect('participant-left');
    assert(left.peerId === joinedBruno.peerId && left.participantCount === 1, 'participant-left notified');
    bruno.close();
    ana.close();
    await ana.closed;
    let health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { rooms: number; participants: number };
    assert(health.participants === 0 && health.rooms >= 1, 'empty room kept during grace');
    await new Promise((r) => setTimeout(r, GRACE_MS + 300));
    health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { rooms: number; participants: number };
    assert(health.rooms === 0, 'empty rooms removed after grace');
    step('empty room closed after grace');

    // 7. reentrar no mesmo código recria a sala (nome volta ao padrão, pois não há persistência)
    const again = await Client.connect(url);
    again.send({ type: 'join-room', roomId: 'FLEX7K4P92', displayName: 'Ana' });
    assert((await again.expect('room-joined')).roomName === 'Reunião', 'same code reopens a fresh room');
    again.send({ type: 'leave' });
    again.close();
    step('same code reopens the room');

    // 8. payload grande é recusado pelo ws (maxPayload)
    const big = await Client.connect(url);
    big.sendRaw('x'.repeat(70 * 1024));
    const code = await big.closed;
    assert(code === 1009, `oversized payload closes socket with 1009 (got ${code})`);
    step('oversized payload rejected');

    // 9. API REST de integração (token no .env)
    const api = `http://127.0.0.1:${port}/api/rooms`;
    const auth = { Authorization: 'Bearer flexi-secret', 'Content-Type': 'application/json' };
    assert((await fetch(api)).status === 401, 'api without token rejected');
    assert((await fetch(api, { headers: { Authorization: 'Bearer wrong' } })).status === 401, 'api with wrong token rejected');
    const generated = (await (await fetch(api, { method: 'POST', headers: auth, body: '{}' })).json()) as { code: string; url: string };
    assert(generated.code.length === 10 && generated.url === `https://live.exemplo.com/live/${generated.code}`, `api generates 10-char code with public url (${generated.url})`);
    const short = (await (await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ length: 6 }) })).json()) as { code: string };
    assert(short.code.length === 6, 'api honors requested length');
    assert((await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ length: 3 }) })).status === 400, 'api rejects bad length');
    assert((await fetch(`${api}/${generated.code}`, { headers: auth })).status === 404, 'inactive room reports 404');
    const member = await Client.connect(url);
    member.send({ type: 'join-room', roomId: generated.code, displayName: 'Diego', roomName: 'Daily' });
    await member.expect('room-joined');
    const status = (await (await fetch(`${api}/${generated.code.toLowerCase()}`, { headers: auth })).json()) as { active: boolean; name: string; participants: Array<{ name: string; sharingScreen: boolean }> };
    assert(status.active && status.name === 'Daily' && status.participants.length === 1 && status.participants[0]?.name === 'Diego' && status.participants[0]?.sharingScreen === false, 'active room status with participants');
    const list = (await (await fetch(api, { headers: auth })).json()) as { rooms: Array<{ code: string; participantCount: number }> };
    assert(list.rooms.some((r) => r.code === generated.code && r.participantCount === 1), 'room listed');
    const renamed = (await (await fetch(`${api}/${generated.code}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ name: ' Daily  do time ' }) })).json()) as { name: string };
    assert(renamed.name === 'Daily do time', 'room renamed via api');
    assert((await member.expect('room-updated')).roomName === 'Daily do time', 'members notified of rename');
    const bearer = { Authorization: 'Bearer flexi-secret' };
    assert((await fetch(`${api}/${generated.code}`, { method: 'DELETE', headers: bearer })).status === 204, 'room closed via api');
    await member.expect('room-closed');
    assert((await fetch(`${api}/${generated.code}`, { method: 'DELETE', headers: bearer })).status === 404, 'closing again reports 404');
    member.close();
    step('integration api (token, generate, status, rename, close)');

    await new Promise((r) => setTimeout(r, GRACE_MS + 300));
    const finalHealth = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { rooms: number; participants: number; sfu: boolean };
    assert(finalHealth.rooms === 0 && finalHealth.participants === 0 && finalHealth.sfu === true, 'no leaked rooms, sfu worker alive');
    step('no leaked rooms after cleanup');
    console.log(`\nAll ${passed} signaling checks passed.`);
  } finally {
    child.kill('SIGTERM');
  }
}

run().catch((error: unknown) => {
  console.error('\nFAILED:', error);
  process.exitCode = 1;
});
