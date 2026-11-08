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
const os = require('os');
const { app, BrowserWindow } = require('electron');

// 截图用独立 profile：别把 mock 场景写进真实客户端的 localStorage。
// 每次进程单独一个目录，避免上一次没退干净时两个实例抢 GPU 缓存而卡死。
const profileDir = path.join(os.tmpdir(), `esf-shot-${process.pid}`);
app.setPath('userData', profileDir);
app.on('will-quit', () => {
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* 清理失败无所谓，临时目录会自己回收 */
  }
});

function argOf(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const state = argOf('state', 'dashboard');
const clickSelector = argOf('click', '');
const contextSelector = argOf('contextmenu', '');
const role = argOf('role', 'owner');
const scrollPx = Number(argOf('scroll', 0));
const width = Number(argOf('width', 1320));
const height = Number(argOf('height', 900));
const zoom = Number(argOf('zoom', 1));

// 必须在创建 BrowserWindow 之前设置：渲染进程的环境变量在进程创建时就固化了
process.env.MOCK_STATE = state === 'login' || state === 'register' ? 'login' : 'dashboard';
process.env.MOCK_SCENARIO = state;
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
      // 窗口被别的窗口挡住时 Chromium 会停掉合成，capturePage 只能拿到旧帧
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();


  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setZoomFactor(zoom);
  // 大厅 hero 用整张背景图，合成层要等图片解码完才栅格化；等太短会截出空白块
  await new Promise((resolve) => setTimeout(resolve, 1900));

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
      // 支持 "nth:2:.nav-item" 按下标点击（nth-child 在动态列表里不稳）
      let expr = `document.querySelector(${JSON.stringify(selector)})`;
      const nth = selector.match(/^nth:(\d+):(.+)$/);
      if (nth) {
        expr = `document.querySelectorAll(${JSON.stringify(nth[2])})[${Number(nth[1])}]`;
      }
      const clicked = await win.webContents.executeJavaScript(`
        (() => {
          let el = null;
          try { el = ${expr}; } catch (err) { return 'bad-selector'; }
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

  if (contextSelector) {
    const fired = await win.webContents.executeJavaScript(`
      (() => {
        let el = null;
        try { el = document.querySelector(${JSON.stringify(contextSelector)}); } catch (err) { return 'bad-selector'; }
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        return true;
      })()
    `);
    console.log('contextmenu', contextSelector, 'matched =', fired);
    await new Promise((resolve) => setTimeout(resolve, 500));
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

  if (argOf('type', '')) {
    // --type="选择器@@文本"：写入输入框并触发 input 事件（React 受控组件需要原生 setter）
    const [selector, ...rest] = String(argOf('type', '')).split('@@');
    const text = rest.join('@@');
    const typed = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector.trim())});
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `);
    console.log('type', selector, 'matched =', typed);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  if (argOf('probe', '')) {
    const probe = await win.webContents.executeJavaScript(`
      ({
        modal: !!document.querySelector('.release-modal'),
        active: document.querySelector('.release-item.is-active b')?.textContent || '',
        detail: document.querySelector('.release-detail-head h3')?.textContent || '',
        focus: document.activeElement?.className || document.activeElement?.tagName || ''
      })
    `);
    console.log('probe', JSON.stringify(probe));
  }

  if (argOf('trace', '')) {
    const trace = await win.webContents.executeJavaScript(`
      ({
        nav: document.querySelector('.nav-item.is-active')?.textContent?.trim() || null,
        heading: document.querySelector('.hero-title, .workspace h1')?.textContent?.trim() || null,
        challenge: !!document.querySelector('.challenge-page'),
        table: !!document.querySelector('.challenge-table'),
        rows: document.querySelectorAll('.challenge-row').length,
        page: location.hash || ''
      })
    `);
    console.log('trace', JSON.stringify(trace));
  }

  if (argOf('dump', '') === '1') {
    const metrics = await win.webContents.executeJavaScript(`
      (() => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
        };
        const center = document.querySelector('.center');
        return {
          viewport: { w: innerWidth, h: innerHeight },
          center: center ? { clientH: center.clientHeight, scrollH: center.scrollHeight } : null,
          children: center
            ? Array.from(center.children).map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  cls: el.className,
                  h: Math.round(r.height),
                  top: Math.round(r.top),
                };
              })
            : null,
          hero: pick('.hero'),
          quick: pick('.quick-cards'),
          rooms: pick('.rooms'),
          feed: pick('.feed'),
          rankedPage: pick('.ranked-page'),
          rankedHero: pick('.ranked-hero'),
          rankedGrid: pick('.ranked-grid'),
          rankedMain: pick('.ranked-main'),
          rankHistory: pick('.rank-history'),
          rankFlow: pick('.rank-flow'),
          rankedSide: pick('.ranked-side'),
        };
      })()
    `);
    console.log('metrics', JSON.stringify(metrics));
  }

  // 切页/展开后合成层可能还是旧帧：先丢弃一帧，再等一拍重画
  win.webContents.invalidate();
  await win.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 350));

  const image = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, `${state}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log('saved', file);
  // 直接退出：Windows 上 app.quit() / app.exit() 偶尔会被渲染进程收尾拖住，脚本会挂起
  setTimeout(() => process.exit(0), 50);
});
