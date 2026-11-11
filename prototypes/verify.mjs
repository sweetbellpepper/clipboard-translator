// 配色原型真浏览器验证：node prototypes/verify.mjs
// 用 headless Chrome + CDP 渲染每款方案/每个视图，截图并检查溢出/错误/导出。
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = "E:/clipboard-translator-dev/prototypes";
const SHOTS = ROOT + "/shots";
const URL = "file:///E:/clipboard-translator-dev/prototypes/palette-studio.html";
const PORT = 9333;
const UDD = ROOT + "/.tmp-chrome-verify";
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${UDD}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "--force-color-profile=srgb", "--window-size=1440,1100", URL,
], { stdio: "ignore", detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page" && t.url.includes("palette-studio"));
      if (p) return p;
    } catch {}
    await sleep(250);
  }
  throw new Error("NO_PAGE");
}

const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errors = [];
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXC: " + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params).slice(0, 200));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("CONSOLE: " + (m.params.args || []).map((a) => a.value || a.description).join(" ").slice(0, 200));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const m = await send("Runtime.evaluate", { expression, returnByValue: true }); return m.result?.result?.value; };

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 2, mobile: false });
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: SHOTS, eventsEnabled: true });
await sleep(500);

async function shot(name) {
  const m = await send("Page.getLayoutMetrics");
  const cs = m.result.cssContentSize || m.result.contentSize;
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 } });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, "base64"));
  return `${name}.png`;
}
const clickPalette = (pid) => ev(`document.querySelector('.pcard[data-id="${pid}"]').click(); 'ok'`);
const setView = (v) => ev(`document.querySelector('#viewtabs button[data-view="${v}"]').click(); 'ok'`);
const setWidth = (px) => ev(`(()=>{const r=document.getElementById('sizeRange');r.value=${px};r.dispatchEvent(new Event('input'));return 'ok';})()`);

// 溢出/可读性检查：窗口内无横向溢出，关键文本存在
const health = () => ev(`(()=>{const w=document.getElementById('win');const over=w.scrollWidth>w.clientWidth+1;
const bg=getComputedStyle(w).getPropertyValue('--bg').trim();const ac=getComputedStyle(w).getPropertyValue('--accent').trim();
const active=document.querySelector('.pcard.on')?.dataset.id;const vis=[...document.querySelectorAll('.view')].find(v=>!v.classList.contains('hidden'))?.id;
const dictTitle=document.querySelector('#v-dict .dict-title')?.textContent;
return JSON.stringify({over,bg,ac,active,vis,dictTitle,tokens:document.querySelectorAll('.tok').length});})()`);

const results = [];
async function step(name, fn) { await fn(); await sleep(420); const h = JSON.parse(await health()); const file = await shot(name); results.push({ name, file, ...h }); }

// 默认 + 8 款方案的词典卡视图
await step("01-brume-dict", async () => {});
await step("02-slate-dict", () => clickPalette("slate"));
await step("03-clay-dict", () => clickPalette("clay"));
await step("04-moss-dict", () => clickPalette("moss"));
await step("05-ivory-dict", () => clickPalette("ivory"));
await step("06-onyx-dict", () => clickPalette("onyx"));
await step("07-dusk-dict", () => clickPalette("dusk"));
await step("08-celadon-dict", () => clickPalette("celadon"));
// 深色方案的四视图
await step("09-onyx-sentence", () => setView("sentence"));
await step("10-onyx-settings", () => setView("settings"));
await step("11-onyx-library", () => setView("library"));
// 浅色高级感四视图
await step("12-ivory-dict-again", async () => { await clickPalette("ivory"); await setView("dict"); });
await step("13-ivory-settings", () => setView("settings"));
await step("14-ivory-library", () => setView("library"));
await step("15-ivory-sentence", () => setView("sentence"));
// 导出功能：点导出，检查下载文件
await clickPalette("onyx"); await setView("dict"); await sleep(200);
const before = readdirSync(SHOTS).filter((f) => f.endsWith(".json"));
await ev(`document.getElementById('exportBtn').click(); 'ok'`); await sleep(700);
const after = readdirSync(SHOTS).filter((f) => f.endsWith(".json"));
const exported = after.find((f) => !before.includes(f)) || null;
const toastTxt = await ev(`document.getElementById('toast').textContent`);
// 响应式：窄屏堆叠
await send("Emulation.setDeviceMetricsOverride", { width: 780, height: 1200, deviceScaleFactor: 2, mobile: false });
await clickPalette("brume"); await setView("dict"); await sleep(450);
const respFile = await shot("16-responsive-780");
const respOver = await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`);

const summary = { errors, exported, toastTxt, respOver, results };
writeFileSync(`${ROOT}/verify-results.json`, JSON.stringify(summary, null, 2));
console.log("ERRORS:", errors.length ? errors.join(" | ") : "none");
console.log("EXPORT:", exported || "MISSING", "| toast:", toastTxt);
console.log("RESPONSIVE_HSCROLL:", respOver);
console.log("OVERFLOW_ANY:", results.some((r) => r.over));
results.forEach((r) => console.log(`  ${r.file}  active=${r.active} bg=${r.bg} accent=${r.ac} view=${r.vis} over=${r.over}`));

ws.close();
try { chrome.kill(); } catch {}
try { execFileSync("taskkill", ["/F", "/T", "/PID", String(chrome.pid)], { stdio: "ignore" }); } catch {}
process.exit(0);