import { execSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdpBase, sleep } from './cdp-lib.mjs';

async function freePort() {
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  return port;
}

/** Chromes de execuções anteriores que não fecharam (reconhecidos pelo prefixo do perfil temporário). */
function killStaleChromes() {
  try {
    execSync('pkill -f screen-live-e2e- || true', { stdio: 'ignore' });
  } catch {
    /* sem pkill (Windows) */
  }
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/**
 * Sobe um Chrome isolado (perfil temporário) com flags que dispensam diálogos nativos:
 * captura de tela escolhe automaticamente a aba "Screen Live" e câmera/microfone são dispositivos falsos.
 */
export async function launchChrome() {
  const binary = CANDIDATES.find((p) => existsSync(p));
  if (!binary) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  killStaleChromes();
  const port = await freePort();
  process.env.CDP_PORT = String(port);
  const profile = mkdtempSync(join(tmpdir(), 'screen-live-e2e-'));
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-tab-capture-source-by-title=Screen Live',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${cdpBase()}/json/version`);
      if (res.ok) break;
    } catch {
      /* ainda subindo */
    }
    await sleep(250);
  }
  return {
    close() {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        rmSync(profile, { recursive: true, force: true });
      }, 1500);
    },
  };
}
