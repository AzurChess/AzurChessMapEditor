/**
 * 无依赖的截图工具：直接走 CDP，等页面真正画完再拍。
 *
 * Chrome 的 `--screenshot` 配 `--virtual-time-budget` 会在虚拟时间耗尽时立刻拍照，
 * 而 fetch 大文件和 createImageBitmap 走的是真实时间，于是永远拍到空白页。
 * 这里改为轮询页面上的 `window.__done` 标志。
 *
 *   node scripts/screenshot.mjs <url> <输出png> [chrome路径]
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [url, outPath, chromePath] = process.argv.slice(2);
if (!url || !outPath) {
  console.error('用法: node scripts/screenshot.mjs <url> <输出png> [chrome路径]');
  process.exit(2);
}

const CHROME =
  chromePath ??
  process.env.CHROME_PATH ??
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9222 + Math.floor(Math.random() * 500);

/**
 * WSL 里跑的是 Windows 侧的 chrome.exe，调试端口不在 WSL 的 127.0.0.1 上，
 * 且 --user-data-dir 必须给 Windows 路径。
 */
const isWindowsChrome = CHROME.endsWith('.exe');
const profile = isWindowsChrome
  ? String.raw`C:\Windows\Temp\acme-shot-${process.pid}`
  : `/tmp/acme-shot-${process.pid}`;

function debugHost() {
  if (!isWindowsChrome) return '127.0.0.1';
  try {
    // WSL2 的默认网关就是 Windows 主机
    const route = readFileSync('/proc/net/route', 'utf8');
    for (const line of route.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[1] === '00000000' && cols[2]) {
        const hex = cols[2];
        return [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16)).join('.');
      }
    }
  } catch {
    // 落回 localhost
  }
  return '127.0.0.1';
}

const HOST = debugHost();

const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=0.0.0.0',
    `--user-data-dir=${profile}`,
    '--window-size=1280,760',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWebSocketUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // 还没起来
    }
    await sleep(250);
  }
  throw new Error(`连不上 Chrome 的调试端口 ${HOST}:${PORT}`);
}

function cdp(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
}

const wsUrl = (await targetWebSocketUrl()).replace(/\/\/[^/]+\//, `//${HOST}:${PORT}/`);
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

const send = cdp(ws);
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });

  // 等页面把 window.__done 置位（失败时置 window.__error）
  let status = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const { result } = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({ done: window.__done ?? null, error: window.__error ?? null })',
      returnByValue: true,
    });
    status = JSON.parse(result.value);
    if (status.error) throw new Error(`页面报错：${status.error}`);
    if (status.done) break;
  }
  if (!status?.done) throw new Error('等待超时：页面未设置 window.__done');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log(`已截图 ${outPath}（页面状态：${status.done}）`);
} finally {
  ws.close();
  chrome.kill();
}
