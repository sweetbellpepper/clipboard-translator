// 真窗口验证：连接正在运行的 Tauri 应用（CDP 9222），驱动语言切换 + 8 款配色，
// 读取真实 DOM / computed style，并截取真实窗口截图。不启动新浏览器、不发网络请求。
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:9222";
const OUT = "prototypes/shots-app";
mkdirSync(OUT, { recursive: true });

const list = await (await fetch(BASE + "/json/list")).json();
const page = list.find((p) => p.type === "page" && p.url.includes("localhost:1420"));
if (!page) throw new Error("未找到运行中的应用页面");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
});
function send(method, params = {}) {
  return new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function evaljs(expression) {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (m.result?.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(m.result.exceptionDetails));
  return m.result?.result?.value;
}
async function shot(name) {
  await new Promise((r) => setTimeout(r, 320)); // 等 .scheme-tile/.sw-track 的 .15s 过渡落定再截
  const m = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(m.result.data, "base64"));
  return `${OUT}/${name}.png`;
}
const snap = () => evaljs(`(() => {
  const app = document.getElementById('app');
  const cs = getComputedStyle(app);
  const v = (k) => cs.getPropertyValue(k).trim();
  const on = document.querySelector('.scheme-tile.on');
  const src = document.querySelector('.source');
  const segOn = document.querySelector('#langSeg button.on');
  const swTrack = document.querySelector('#watchToggle .sw-track');
  return {
    brand: document.getElementById('brandTop')?.textContent,
    title: document.title,
    htmlLang: document.documentElement.lang,
    themeLabel: document.getElementById('themeLabel')?.textContent,
    tiles: document.querySelectorAll('.scheme-tile').length,
    onTile: on?.dataset.id ?? null,
    onTileName: on?.querySelector('.scheme-cn')?.textContent ?? null,
    stored: localStorage.getItem('wb_theme'),
    bg: v('--bg'), surface: v('--surface'), fg: v('--fg'),
    accent: v('--accent'), accentFg: v('--accent-fg'), accent2: v('--accent-2'),
    error: v('--error'), success: v('--success'),
    sourceBorder: src ? getComputedStyle(src).borderLeftColor : null,
    segOnBg: segOn ? getComputedStyle(segOn).backgroundColor : null,
    segOnFg: segOn ? getComputedStyle(segOn).color : null,
    swTrackBorder: swTrack ? getComputedStyle(swTrack).borderTopColor : null,
    modePills: [...document.querySelectorAll('.scheme-mode')].map((m) => m.textContent),
  };
})()`);

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");
const report = { steps: [] };
const log = (name, data) => { report.steps.push({ name, data }); console.log(name, JSON.stringify(data)); };

// 0) 确保回到译文视图 + 中文，读取初始（默认应为 brume）
await evaljs(`(() => { const sv=document.getElementById('settingsView'); if(!sv.classList.contains('hidden')) document.getElementById('btnBack').click(); const lv=document.getElementById('libraryView'); if(!lv.classList.contains('hidden')) document.getElementById('btnLibBack').click(); document.querySelector('#langSeg button[data-lang="zh"]').click(); return true; })()`);
log("00-init-zh", await snap());
await shot("00-popup-brume-zh");

// 1) 打开设置，滚到配色方案，截图（中文 brume）
await evaljs(`(() => { const sv=document.getElementById('settingsView'); if(sv.classList.contains('hidden')) document.getElementById('btnSettings').click(); document.getElementById('schemeGrid').scrollIntoView({block:'center'}); return !sv.classList.contains('hidden'); })()`);
log("01-settings-zh-brume", await snap());
await shot("01-settings-brume-zh");

// 2) 切英文：品牌名 / 标题 / 配色标签 / 浅深标记都应英文化
await evaljs(`document.querySelector('#langSeg button[data-lang="en"]').click()`);
log("02-settings-en", await snap());
await shot("02-settings-brume-en");

// 3) 切回中文
await evaljs(`document.querySelector('#langSeg button[data-lang="zh"]').click()`);
log("03-back-zh", await snap());

// 4) 逐款点击 8 个配色，校验变量 / 选中态 / 记忆都同步
const ids = await evaljs(`[...document.querySelectorAll('.scheme-tile')].map((b) => b.dataset.id)`);
const schemes = [];
for (const id of ids) {
  await evaljs(`document.querySelector('.scheme-tile[data-id="${id}"]').click()`);
  const s = await snap();
  schemes.push({ id, bg: s.bg, accent: s.accent, accentFg: s.accentFg, onTile: s.onTile, stored: s.stored, segOnBg: s.segOnBg, segOnFg: s.segOnFg, sourceBorder: s.sourceBorder });
  if (["clay", "onyx", "dusk", "celadon"].includes(id)) {
    await evaljs(`document.getElementById('schemeGrid').scrollIntoView({block:'center'})`);
    await shot(`04-settings-${id}-zh`);
  }
}
log("04-all-schemes", schemes);

// 5) 深色方案下切英文，确认浅深标记 Light/Dark + 品牌 Sparrow
await evaljs(`document.querySelector('.scheme-tile[data-id="onyx"]').click(); document.querySelector('#langSeg button[data-lang="en"]').click()`);
log("05-onyx-en", await snap());
await shot("05-settings-onyx-en");

// 6) 溢出 / 遮挡检查（设置页与配色网格）
const overflow = await evaljs(`(() => {
  const sb = document.getElementById('settingsBody');
  const grid = document.getElementById('schemeGrid');
  const tiles = [...document.querySelectorAll('.scheme-tile')];
  const bad = tiles.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.dataset.id);
  const gr = grid.getBoundingClientRect();
  return { settingsScrollW: sb.scrollWidth, settingsClientW: sb.clientWidth, gridRight: Math.round(gr.right), winW: document.getElementById('app').clientWidth, tileOverflow: bad, tileCount: tiles.length };
})()`);
log("06-overflow", overflow);

// 7) 复位：中文 + brume + 回译文视图，截最终默认态
await evaljs(`(() => { document.querySelector('#langSeg button[data-lang="zh"]').click(); document.querySelector('.scheme-tile[data-id="brume"]').click(); document.getElementById('btnBack').click(); return true; })()`);
log("07-restored", await snap());
await shot("07-restored-popup-brume-zh");

report.errors = errors;
writeFileSync("prototypes/verify-app-results.json", JSON.stringify(report, null, 2));
console.log("ERRORS:", JSON.stringify(errors));
console.log("DONE");
ws.close();