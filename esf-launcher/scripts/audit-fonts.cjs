/**
 * 字体/排版体检：把每个页面渲染出来，找出「文字被裁掉、字号过小、单元格撑破」的地方。
 * 用法：electron scripts/audit-fonts.cjs [--out=font-audit.json]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

const profileDir = path.join(os.tmpdir(), 'esf-font-audit-' + String(process.pid));
app.setPath('userData', profileDir);
app.on('will-quit', () => {
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function argOf(name, fallback) {
  const hit = process.argv.find((v) => v.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
}

process.env.MOCK_STATE = 'dashboard';
process.env.MOCK_SCENARIO = 'dashboard';
process.env.MOCK_ROLE = 'owner';
app.disableHardwareAcceleration();

const PAGES = [
  { name: '大厅', index: 0 },
  { name: '排位', index: 1 },
  { name: '约战', index: 2 },
  { name: '服务器', index: 3 },
  { name: '资源库', index: 4 },
  { name: '管理台', index: 5 },
  { name: '设置抽屉', index: 6 },
];

const AUDIT_JS = `(() => {
  const issues = [];
  const label = (el) => {
    const cls = (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  };
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const fs2 = parseFloat(cs.fontSize) || 0;
    const w = el.clientWidth;
    const sw = el.scrollWidth;
    const h = el.clientHeight;
    const sh = el.scrollHeight;
    const clipX = (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
    const clipY = (cs.overflowY === 'hidden' || cs.overflowY === 'clip');
    const ellipsis = cs.textOverflow === 'ellipsis';
    if (fs2 > 0 && fs2 < 10) issues.push({ kind: 'tiny-font', el: label(el), text: text(el), fontSize: fs2, w, h });
    if (clipX && sw - w > 2 && !ellipsis && w > 0) issues.push({ kind: 'clip-x', el: label(el), text: text(el), fontSize: fs2, w, sw });
    if (clipY && sh - h > 2 && h > 0) issues.push({ kind: 'clip-y', el: label(el), text: text(el), fontSize: fs2, h, sh });
  }
  return issues;
})()`;

app.whenReady().then(async () => {
  const width = Number(argOf('width', 1322));
  const height = Number(argOf('height', 901));
  const win = new BrowserWindow({
    width, height, show: true, frame: false, backgroundColor: '#06070b',
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.cjs'),
      contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await new Promise((r) => setTimeout(r, 1900));

  const report = {};
  for (const page of PAGES) {
    if (page.index > 0) {
      await win.webContents.executeJavaScript(
        'document.querySelectorAll(".nav-item")[' + page.index + '] && document.querySelectorAll(".nav-item")[' + page.index + '].click()'
      );
      await new Promise((r) => setTimeout(r, 900));
    }
    const issues = await win.webContents.executeJavaScript(AUDIT_JS);
    report[page.name] = issues;
    console.log('[page]', page.name, 'issues =', issues.length);
  }

  const file = argOf('out', 'font-audit.json');
  fs.writeFileSync(path.join(process.cwd(), file), JSON.stringify(report, null, 2), 'utf8');
  console.log('saved', file);
  setTimeout(() => process.exit(0), 50);
});
