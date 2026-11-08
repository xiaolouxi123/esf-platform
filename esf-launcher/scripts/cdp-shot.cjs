// 通过 CDP 在真实客户端里切页并截图（不依赖窗口自动化，避免抢焦点/点错层）
// 用法：node scripts/cdp-shot.cjs <输出名> [--click=".nav-item:nth-child(2)"] [--port=9222]
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || 'real-ranked';
const click = (args.find((a) => a.startsWith('--click=')) || '').slice(8) || null;
const port = Number((args.find((a) => a.startsWith('--port=')) || '--port=9222').slice(7));

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  });

  await send('Runtime.enable');
  await send('Page.enable');

  if (click) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(click)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`,
      returnByValue: true,
    });
    console.log('click', click, '=', r.result.value);
    await new Promise((r2) => setTimeout(r2, 1200));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(__dirname, '..', 'shots', `${out}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
  ws.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
