/**
 * 截图工具：用 Electron 把构建产物渲染出来截图，方便在没有浏览器的环境里验收 UI。
 *
 * 用法：
 *   node_modules\.bin\electron scripts/shot.cjs --state=dashboard
 *   node_modules\.bin\electron scripts/shot.cjs --state=servers --click=".nav-item:nth-child(2)"
 *
 * 输出：shots/<state>.png
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

function argOf(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const state = argOf('state', 'dashboard');
const clickSelector = argOf('click', '');
const role = argOf('role', 'owner');
const scrollPx = Number(argOf('scroll', 0));
const width = Number(argOf('width', 1320));
const height = Number(argOf('height', 900));

// 必须在创建 BrowserWindow 之前设置：渲染进程的环境变量在进程创建时就固化了
process.env.MOCK_STATE = state === 'login' || state === 'register' ? 'login' : 'dashboard';
process.env.MOCK_ROLE = role;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: true,
    frame: false,
    backgroundColor: '#06070b',
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });


  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 900));

  if (state === 'register') {
    await win.webContents.executeJavaScript(
      "document.querySelector('.auth-switch .link')?.click()"
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (clickSelector) {
    // 支持 "选择器1@@选择器2" 依次点击（例如先切页面再展开房间）
    const selectors = String(clickSelector)
      .split(/@@|\|\|/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const selector of selectors) {
      const clicked = await win.webContents.executeJavaScript(`
        (() => {
          let el = null;
          try { el = document.querySelector(${JSON.stringify(selector)}); } catch (err) { return 'bad-selector'; }
          if (!el) return false;
          el.click();
          return true;
        })()
      `);
      console.log('click', selector, 'matched =', clicked);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (scrollPx > 0) {
    const info = await win.webContents.executeJavaScript(`
      (() => {
        const candidates = ['.center', '.admin', '.workspace', '.rail'];
        const out = [];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (!el) continue;
          out.push({ sel, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflow: getComputedStyle(el).overflowY });
        }
        const el = document.querySelector('.center') || document.scrollingElement;
        if (el) el.scrollTop = ${scrollPx};
        return { applied: el ? el.scrollTop : -1, out };
      })()
    `);
    console.log('scroll', JSON.stringify(info));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, `${state}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log('saved', file);
  app.quit();
});
