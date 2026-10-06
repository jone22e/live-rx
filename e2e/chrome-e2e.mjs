/**
 * Teste de ponta a ponta no Chrome real: sala aberta criada pelo primeiro a entrar (com nome), participantes
 * entram com nome, câmeras/microfones e tela via SFU (mediasoup), troca de apresentador, reload, saída e
 * fechamento automático da sala vazia.
 *
 * Pré-requisitos: backend e frontend rodando (npm run dev) e Google Chrome instalado.
 * Executar: npm run test:e2e   (BASE_URL, HEALTH_URL, CHROME_PATH e SCREENSHOT_DIR são opcionais)
 */
import { Page, sleep, debugText } from './cdp-lib.mjs';
import { launchChrome } from './chrome.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:5180';
const HEALTH = process.env.HEALTH_URL ?? `${BASE}/health`;
const SHOTS = process.env.SCREENSHOT_DIR ?? null;
const health0 = await (await fetch(HEALTH)).json();
if (!health0.sfu) throw new Error('backend sem worker do SFU (mediasoup)');
const chrome = await launchChrome();
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`); if (!cond) throw new Error(`FAIL ${name} ${extra}`); };
const hasBtn = (t) => `!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(t)} || b.getAttribute('aria-label') === ${JSON.stringify(t)})`;
/** Nomes dos tiles em ordem alfabética: as posições são estáveis (quem já está não se move quando alguém entra). */
const captions = `[...document.querySelectorAll('.tile figcaption')].map(f => f.textContent).sort().join('|')`;
const tilesWithVideo = `[...document.querySelectorAll('.tile')].filter(t => t.querySelector('video').videoWidth > 0).length`;
const people = `document.querySelector('.people .count')?.textContent.trim()`;
const presentationLabel = `document.querySelector('.presentation-label')?.textContent.trim() ?? ''`;
const remotesLine = `(document.querySelector('.debug')?.innerText.match(/remotes\\s+([^\\n]*)/) || [])[1] ?? ''`;

/** A pré-entrada liga câmera e microfone sozinha; desliga os dois para o teste controlar cada passo. */
async function turnOffPreJoinMedia(page) {
  await page.waitFor(hasBtn('Desligar câmera') + ' && ' + hasBtn('Desligar microfone'), 15000, 'prejoin media auto-started');
  await page.click('Desligar câmera');
  await page.waitFor(hasBtn('Ligar câmera'), 10000, 'prejoin camera off');
  await page.click('Desligar microfone');
  await page.waitFor(hasBtn('Ligar microfone'), 10000, 'prejoin mic off');
}

/** Abre uma aba já na sala, passando pela pré-entrada com o nome informado (o perfil é compartilhado entre abas). */
async function joinAs(code, name) {
  const page = await Page.open(`${BASE}/`);
  await page.eval(`localStorage.removeItem('screen-live:display-name')`);
  await page.navigate(`${BASE}/live/${code}?debug=1`);
  await page.waitFor(`!!document.querySelector('.prejoin-card')`, 10000, 'prejoin card');
  await turnOffPreJoinMedia(page);
  await page.fill('.prejoin-card input', name);
  await page.click('Participar');
  await page.waitFor(`document.querySelector('.badge')?.textContent.trim() === 'Ao vivo'`, 20000, `${name} live`);
  return page;
}

let A, B, C;
try {
  // --- organizador cria a sala sem compartilhar nada ---
  A = await Page.open(`${BASE}/?debug=1`);
  await A.waitFor(`!!document.querySelector('input[autocomplete="name"]')`);
  await A.waitFor(hasBtn('Desligar câmera'), 15000, 'home prejoin camera auto-started');
  ok('prejoin preview shows camera', (await A.waitFor(`document.querySelector('.prejoin-panel video')?.videoWidth || 0`, 10000, 'prejoin preview')) > 0);
  await A.click('Escolher microfone');
  await A.waitFor(`!!document.querySelector('.device-menu')`, 5000, 'mic device menu');
  const micItems = await A.eval(`[...document.querySelectorAll('.device-menu li[role="menuitemradio"]')].map(li => li.textContent.trim() + (li.getAttribute('aria-checked') === 'true' ? '*' : '')).join('|')`);
  ok('mic dropdown lists devices with the selected one checked', micItems.split('|').length >= 1 && micItems.includes('*'), micItems);
  await A.click('Escolher microfone');
  await A.waitFor(`!document.querySelector('.device-menu')`, 5000, 'mic device menu closed');
  await A.click('Escolher câmera');
  const camItems = await A.waitFor(`[...document.querySelectorAll('.device-menu li[role="menuitemradio"]')].map(li => li.textContent.trim()).join('|')`, 5000, 'camera device menu');
  ok('camera dropdown lists devices', camItems.length > 0, camItems);
  await A.eval(`document.body.click()`);
  await A.waitFor(`!document.querySelector('.device-menu')`, 5000, 'camera menu closes on outside click');
  ok('device menu closes on outside click', true);
  await A.fill('input[autocomplete="name"]', 'Ana Souza');
  await sleep(600);
  if (SHOTS) await A.screenshot(`${SHOTS}/home.png`);
  await turnOffPreJoinMedia(A);
  await A.fill('input[aria-label="Nome da reunião"]', 'Revisão de sprint');
  await A.click('Criar sala');
  await A.waitFor(`location.pathname.startsWith('/live/')`, 15000, 'navigate to /live');
  await A.waitFor(`document.querySelector('.badge')?.textContent.trim() === 'Ao vivo'`, 20000, 'creator joined automatically');
  const code = await A.waitFor(`(document.querySelector('.code')||{}).textContent?.trim()`);
  ok('room code format', /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code), code);
  ok('info panel opens for the creator with the url', (await A.eval(`document.querySelector('.info .link')?.textContent`)) === `${BASE}/live/${code}`);
  ok('room name in header', (await A.eval(`document.querySelector('.header h1')?.textContent`)) === 'Revisão de sprint');
  ok('creator alone in grid with own name', (await A.eval(captions)) === 'Ana Souza (você)', await A.eval(captions));
  ok('no presentation yet', (await A.eval(`!!document.querySelector('.main-video')`)) === false);

  // --- participante entra com nome ---
  B = await joinAs(code, 'Bruno Lima');
  ok('viewer sees room name', (await B.eval(`document.querySelector('.header h1')?.textContent`)) === 'Revisão de sprint');
  await A.waitFor(`${people} === '2'`, 10000, 'people 2');
  ok('creator counts 2 people', true);
  ok('creator grid lists Bruno and self', (await A.eval(captions)) === 'Ana Souza (você)|Bruno Lima', await A.eval(captions));
  ok('viewer grid lists Ana and self', (await B.eval(captions)) === 'Ana Souza|Bruno Lima (você)', await B.eval(captions));
  const muteBadges = await A.eval(`[...document.querySelectorAll('.tile')].map(t => t.querySelector('figcaption').textContent + (t.querySelector('.mic-off') ? '[muted]' : '[live]')).join('|')`);
  ok('mic-off indicator on every tile while muted', (await A.eval(`document.querySelectorAll('.tile .mic-off').length`)) === 2, muteBadges);
  await A.click('Escolher câmera');
  const roomCamItems = await A.waitFor(`[...document.querySelectorAll('.toolbar .device-menu li[role="menuitemradio"]')].map(li => li.textContent.trim()).join('|')`, 5000, 'toolbar camera menu');
  ok('toolbar camera dropdown lists devices', roomCamItems.length > 0, roomCamItems);
  await A.eval(`document.body.click()`);
  await A.waitFor(`!document.querySelector('.toolbar .device-menu')`, 5000, 'toolbar menu closes');
  ok('toolbar device menu closes on outside click', true);

  // --- câmeras e microfones ---
  await A.click('Ligar câmera');
  await A.waitFor(hasBtn('Desligar câmera'), 10000, 'host camera on');
  ok('host local camera tile', (await A.waitFor(`[...document.querySelectorAll('.tile video')].find(v => v.videoWidth > 0)?.videoWidth || 0`, 10000, 'host local tile')) > 0);
  await B.waitFor(`[...document.querySelectorAll('.tile')].filter(t => t.querySelector('figcaption').textContent === 'Ana Souza' && t.querySelector('video').videoWidth > 0).length === 1`, 20000, 'viewer sees host camera');
  ok('viewer sees Ana camera tile', true);
  await B.click('Ligar câmera');
  await B.waitFor(hasBtn('Desligar câmera'), 10000, 'viewer camera on');
  await A.waitFor(`${tilesWithVideo} === 2`, 20000, 'host sees viewer camera');
  ok('host sees 2 camera tiles', true);
  await B.click('Ligar microfone');
  await A.waitFor(`/:va-/.test(${remotesLine})`, 15000, 'host sees viewer audio');
  ok('host sees viewer audio flag', true);
  ok('viewer tile without mic-off badge', (await A.eval(`[...document.querySelectorAll('.tile')].filter(t => t.querySelector('figcaption').textContent === 'Bruno Lima' && !t.querySelector('.mic-off')).length`)) === 1);
  await A.waitFor(`document.querySelector('.speaking-indicator .name')?.textContent.trim().startsWith('Bruno Lima')`, 15000, 'host sees Bruno speaking');
  ok('host shows speaking indicator for Bruno', true);
  ok('Bruno tile highlighted while speaking', (await A.eval(`[...document.querySelectorAll('.tile.speaking figcaption')].map(f => f.textContent).join('|')`)) === 'Bruno Lima');
  await B.waitFor(`document.querySelector('.speaking-indicator .name')?.textContent.trim().startsWith('Você')`, 15000, 'viewer sees self speaking');
  ok('viewer shows own speaking indicator', true);
  await sleep(1500);
  if (SHOTS) { await A.screenshot(`${SHOTS}/host-grid.png`); await B.screenshot(`${SHOTS}/viewer-grid.png`); }
  await B.click('Desligar câmera');
  await A.waitFor(`/:-a-/.test(${remotesLine})`, 15000, 'host sees viewer video off');
  ok('host sees viewer camera off (placeholder)', (await A.eval(`[...document.querySelectorAll('.tile')].filter(t => t.querySelector('.placeholder')).length`)) === 1);

  // --- organizador compartilha a tela ---
  await A.click('Compartilhar tela');
  await A.waitFor(hasBtn('Parar de compartilhar'), 15000, 'host screen on');
  ok('host sees own presentation', (await A.waitFor(`document.querySelector('.main-video')?.videoWidth || 0`, 10000, 'host main video')) > 0);
  ok('host presentation label', (await A.eval(presentationLabel)) === 'Você está apresentando', await A.eval(presentationLabel));
  const vw = await B.waitFor(`document.querySelector('.main-video')?.videoWidth || 0`, 20000, 'viewer main video');
  ok('viewer receives screen video', vw > 0, `${vw}px wide`);
  ok('viewer presentation label', (await B.eval(presentationLabel)) === 'Ana Souza está apresentando', await B.eval(presentationLabel));
  ok('viewer side column has tiles', (await B.eval(`document.querySelectorAll('.side .tile').length`)) === 2);
  await sleep(3000);
  const dbgB = await B.eval(debugText);
  ok('viewer debug candidate', /candidate \(local\/remote\)\s+\S+ \/ \S+/.test(dbgB), dbgB.match(/candidate \(local\/remote\)\s+(\S+ \/ \S+)/)?.[1] ?? '');
  ok('viewer stats come from the SFU recv transport', /PEER SFU:RECV/i.test(dbgB));
  ok('viewer debug codec', /codec\s+video\//.test(dbgB), dbgB.match(/codec\s+(\S+)/)?.[1] ?? '');
  ok('viewer debug bitrate', /bitrate\s+\d+ kbps/.test(dbgB), dbgB.match(/bitrate\s+(\d+ kbps)/)?.[1] ?? '');
  ok('viewer debug RTT', /RTT\s+\d+ ms/.test(dbgB), dbgB.match(/RTT\s+(\d+ ms)/)?.[1] ?? '');
  if (SHOTS) { await A.screenshot(`${SHOTS}/host.png`); await B.screenshot(`${SHOTS}/viewer.png`); }

  // --- terceiro participante recebe tudo sem ligar nada ---
  C = await joinAs(code, 'Carla Dias');
  ok('third participant receives screen', (await C.waitFor(`document.querySelector('.main-video')?.videoWidth || 0`, 20000, 'viewer2 main video')) > 0);
  await A.waitFor(`${people} === '3'`, 10000, 'people 3');
  ok('host counts 3 people', true);
  ok('third participant lists everyone by name', (await C.eval(captions)) === 'Ana Souza|Bruno Lima|Carla Dias (você)', await C.eval(captions));
  for (const [label, page] of [['host', A], ['viewer1', B], ['viewer2', C]]) {
    await page.waitFor(`/PEER SFU:RECV[\\s\\S]*?connectionState\\s+connected/i.test(document.querySelector('.debug').innerText)`, 20000, `${label} recv transport connected`);
  }
  ok('everyone connected to the media server (recv transport)', true);
  await C.waitFor(`/:-a-/.test(${remotesLine})`, 15000, 'viewer2 gets viewer1 mic');
  ok('third participant gets Bruno audio', true);
  if (SHOTS) await C.screenshot(`${SHOTS}/viewer2.png`);

  // --- outro participante apresenta: vira a apresentação ativa para todos ---
  await B.click('Compartilhar tela');
  await B.waitFor(hasBtn('Parar de compartilhar'), 15000, 'viewer screen on');
  await A.waitFor(`${presentationLabel} === 'Bruno Lima está apresentando'`, 20000, 'host sees Bruno presenting');
  ok('host switches to Bruno presentation', true);
  await C.waitFor(`${presentationLabel} === 'Bruno Lima está apresentando'`, 20000, 'viewer2 sees Bruno presenting');
  ok('third participant switches to Bruno presentation', true);
  await A.waitFor(`[...document.querySelectorAll('.tile')].filter(t => t.querySelector('figcaption').textContent === 'Bruno Lima' && t.querySelector('.presenting')).length === 1`, 10000, `Bruno presenting badge (tiles: ${await A.eval(`[...document.querySelectorAll('.tile')].map(t => t.querySelector('figcaption').textContent + (t.querySelector('.presenting') ? '*' : '')).join('|')`)})`);
  ok('Bruno tile marked as presenting on host', true);
  await B.click('Parar de compartilhar');
  await A.waitFor(`${presentationLabel} === 'Você está apresentando'`, 20000, 'host back to own presentation');
  ok('host falls back to own presentation', true);
  await C.waitFor(`${presentationLabel} === 'Ana Souza está apresentando'`, 20000, 'viewer2 back to Ana');
  ok('third participant falls back to Ana presentation', true);

  // --- reload do participante: volta com o nome salvo ---
  await B.eval(`localStorage.setItem('screen-live:display-name', 'Bruno Lima')`);
  await B.send('Page.reload');
  await sleep(500);
  await B.waitFor(`!!document.querySelector('.prejoin-card')`, 10000, 'prejoin after reload');
  ok('prejoin prefilled with stored name', (await B.eval(`document.querySelector('.prejoin-card input').value`)) === 'Bruno Lima');
  if (SHOTS) await B.screenshot(`${SHOTS}/prejoin.png`);
  await B.click('Participar');
  await B.waitFor(`document.querySelector('.badge')?.textContent.trim() === 'Ao vivo'`, 20000, 'viewer live after reload');
  ok('viewer live after reload', true);
  await A.waitFor(`${people} === '3'`, 10000, 'still 3 people');
  ok('host still counts 3 after reload', true);
  ok('reloaded viewer receives screen again', (await B.waitFor(`document.querySelector('.main-video')?.videoWidth || 0`, 20000, 'viewer main after reload')) > 0);

  // --- saídas: a sala continua sem o criador e fecha sozinha quando esvazia ---
  await B.closeTab(); B = null;
  await A.waitFor(`${people} === '2'`, 10000, 'viewer1 left');
  ok('creator sees Bruno leave', true);
  await C.waitFor(`${captions} === 'Ana Souza|Carla Dias (você)'`, 10000, 'viewer2 drops Bruno tile');
  ok('third participant drops Bruno tile', true);
  await A.click('Sair da sala');
  await A.waitFor(`location.pathname === '/'`, 10000, 'creator back home');
  await C.waitFor(`${captions} === 'Carla Dias (você)' && ${people} === '1'`, 10000, 'room survives without its creator');
  ok('room survives after the creator leaves (no owner)', true);
  ok('screen presentation gone after presenter left', (await C.eval(`!!document.querySelector('.main-video')`)) === false);
  await C.click('Sair da sala');
  await C.waitFor(`location.pathname === '/'`, 10000, 'viewer2 back home');
  const t0 = Date.now();
  let health = await (await fetch(HEALTH)).json();
  while (health.rooms > 0 && Date.now() - t0 < 20000) { await sleep(500); health = await (await fetch(HEALTH)).json(); }
  ok('empty room closed by itself within the grace period', health.rooms === 0, JSON.stringify(health));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  const dump = (n, p) => p && console.log(`\n--- console ${n} ---\n` + p.logs.filter(l => !l.includes('[vite]')).join('\n'));
  dump('A', A); dump('B', B); dump('C', C);
  for (const p of [A, B, C]) { try { await p?.closeTab(); } catch {} }
  chrome.close();
  await sleep(500);
  process.exit(results.some((r) => r.startsWith('FAIL') || r.startsWith('ERROR')) ? 1 : 0);
}
