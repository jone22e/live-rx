import WebSocket from 'ws';
/** Porta do DevTools: definida pelo lançador (porta livre) ou por CDP_PORT. Lida na hora do uso. */
export const cdpBase = () => `http://localhost:${process.env.CDP_PORT ?? '9444'}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Microfone sintético para o teste: pedidos de áudio recebem um tom de 220 Hz ligado/desligado a cada
 * 0,5 s, gerado por Web Audio. O dispositivo falso do Chrome só emite bipes esporádicos e isso tornaria
 * a verificação de "quem está falando" instável.
 */
const SYNTHETIC_MIC = `(() => {
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints || !constraints.audio || constraints.video) return original(constraints);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    let on = true;
    setInterval(() => { on = !on; gain.gain.value = on ? 0.5 : 0; }, 500);
    return dest.stream;
  };
})();`;

export class Page {
  constructor(ws, id) { this.ws = ws; this.targetId = id; this.id = 0; this.pending = new Map(); this.logs = [];
    ws.on('message', (d) => { const m = JSON.parse(d.toString());
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method === 'Runtime.consoleAPICalled') { this.logs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`); }
      else if (m.method === 'Runtime.exceptionThrown') { this.logs.push(`EXCEPTION: ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`); }
    });
  }
  static async open(url) {
    const r = await fetch(`${cdpBase()}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }); const info = await r.json();
    const ws = new WebSocket(info.webSocketDebuggerUrl, { perMessageDeflate: false }); await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const p = new Page(ws, info.id); await p.send('Runtime.enable'); await p.send('Page.enable');
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: SYNTHETIC_MIC });
    await sleep(500); return p;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async waitFor(expr, timeoutMs = 15000, label = expr) { const t0 = Date.now(); for (;;) { const v = await this.eval(expr); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting: ${label}`); await sleep(250); } }
  /** Clique real (com ativação de usuário) no botão cujo texto ou aria-label bate. */
  async click(text) {
    const box = await this.eval(`(() => { const b = [...document.querySelectorAll('button, a.btn')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!b) return null; b.scrollIntoView({block:'center'}); const r = b.getBoundingClientRect(); const x = r.x + r.width/2, y = r.y + r.height/2; const covered = !b.contains(document.elementFromPoint(x, y)); if (covered) { b.click(); return { js: true }; } return { x, y }; })()`);
    if (!box) throw new Error(`button not found: ${text}`);
    if (box.js) return true;
    // Aba em segundo plano (ex.: logo após um reload) descarta eventos de mouse até ter um frame composto.
    await this.send('Page.bringToFront');
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return true;
  }
  async navigate(url) { await this.send('Page.navigate', { url }); await sleep(700); }
  /** Preenche um input (por seletor) disparando os eventos que o Vue observa. */
  async fill(selector, value) {
    const ok = await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`input not found: ${selector}`);
  }
  async screenshot(path) {
    const { writeFileSync } = await import('node:fs');
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }
  async closeTab() { this.ws.close(); await fetch(`${cdpBase()}/json/close/${this.targetId}`); }
}
export const debugText = `(() => { const d = document.querySelector('.debug'); return d ? d.innerText : '' })()`;
