// 空闲自动关监听验证：node tests/idle-watch.mjs
// 运行前需把 src/main.ts 的 WATCH_IDLE_MS 临时改为 8 * 1000，验证后恢复 30 * 60 * 1000。
// 需要 dev 窗口以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" 启动。
// I1 无活动自动暂停 I2 暂停时复制不翻译 I3 手动重开+文本重置计时
// I4 再次自动暂停后仍不翻译 I5 文件剪贴板不触发、不重置计时
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("1420")) || list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (ex) => (await send("Runtime.evaluate", { expression: ex, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
  Buffer.from(`Set-Clipboard -Value '${s}'`, "utf16le").toString("base64")], { stdio: "ignore" });
const clipFile = (p) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
  Buffer.from(`Set-Clipboard -Path '${p}'`, "utf16le").toString("base64")], { stdio: "ignore" });

const stateExpr = `(()=>{const b=document.getElementById("targetBody");
return JSON.stringify({
 watch:document.getElementById("watchState").textContent,
 btnOn:document.getElementById("btnWatch").getAttribute("aria-checked"),
 toggleOn:document.getElementById("watchToggle").getAttribute("aria-checked"),
 stored:localStorage.getItem("wb_watch"),
 src:document.getElementById("sourceText").textContent,
 loading:b.innerText.includes("正在翻译"),
 isDict:!!b.querySelector(".dict"),
 toast:document.getElementById("toast").textContent,
 toastOn:document.getElementById("toast").className.includes("on")
})})()`;
const state = async () => JSON.parse(await ev(stateExpr));

const results = [];
const record = (i, name, ok, output) => { results.push({ id: i, name, ok, output }); console.log(`${ok ? "  ✓" : "  ✗"} ${i} ${name}  [${output}]`); };

async function shot(file) {
  await send("Page.enable");
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(r.result.data, "base64"));
}

// 轮询等待自动暂停，顺带捕获 toast 与截图；返回 {s, elapsed, toastSeen}
async function waitAutoPause(from, timeout = 20000, shotFile) {
  let toastSeen = "";
  while (Date.now() - from < timeout) {
    const s = await state();
    if (s.toastOn && s.toast) toastSeen = s.toast;
    if (s.watch === "已暂停") {
      if (shotFile) await shot(shotFile);
      return { s, elapsed: Date.now() - from, toastSeen };
    }
    await sleep(200);
  }
  return { s: await state(), elapsed: Date.now() - from, toastSeen, timeout: true };
}

// 等应用就绪；若已自动暂停（启动到连接超过时限）先手动重开
{
  const t0 = Date.now(); let s = await state();
  while (!s.watch && Date.now() - t0 < 30000) { await sleep(400); s = await state(); }
  if (s.watch === "已暂停") {
    await ev(`document.getElementById("watchToggle").click(); "ok"`);
    await sleep(300);
    s = await state();
  }
  if (s.watch !== "监听中") { console.log("APP_NOT_READY", JSON.stringify(s)); process.exit(1); }
}
const initialSrc = (await state()).src;
console.log(`初始状态：监听中，原文="${initialSrc}"`);

// I1 无剪贴板活动 → 8 秒左右自动暂停
{
  const t0 = Date.now();
  const { s, elapsed, toastSeen, timeout } = await waitAutoPause(t0, 20000, "tests/shot-idle-autopause.png");
  const ok = !timeout && s.btnOn === "false" && s.toggleOn === "false" && s.stored === "0"
    && elapsed >= 5000 && elapsed <= 14000 && toastSeen.includes("自动暂停");
  record("I1", "无活动自动暂停（状态/开关/localStorage/提示）", ok,
    `耗时=${elapsed}ms | 状态=${s.watch} | stored=${s.stored} | toast="${toastSeen}"`);
}

// I2 暂停期间复制文本 → 不翻译
{
  clip("model");
  await sleep(2500);
  const s = await state();
  record("I2", "暂停时复制文本不触发翻译", s.src === initialSrc && s.watch === "已暂停",
    `原文="${s.src}" | 状态=${s.watch}`);
}

// I3 手动重开 → 5 秒后复制 apple（词典卡）→ 计时重置：重开 10.5 秒仍在监听，复制后约 8 秒才暂停
let enableAt = 0;
{
  await ev(`document.getElementById("watchToggle").click(); "ok"`);
  await sleep(300);
  enableAt = Date.now();
  const s0 = await state();
  await sleep(5000);
  clip("apple");
  const t0 = Date.now();
  let card = await state();
  while ((card.src !== "apple" || card.loading) && Date.now() - t0 < 15000) { await sleep(300); card = await state(); }
  await sleep(5500); // 复制后 5.5 秒 = 重开后 10.5 秒；若未重置计时此刻应已暂停
  const mid = await state();
  const { s, elapsed, timeout } = await waitAutoPause(Date.now(), 15000);
  const sinceCopy = Date.now() - enableAt - 5000;
  const ok = s0.watch === "监听中" && s0.stored === "1" && card.src === "apple" && card.isDict
    && mid.watch === "监听中" && !timeout && s.watch === "已暂停" && sinceCopy >= 6000 && sinceCopy <= 14000;
  record("I3", "手动重开+文本重置计时后再自动暂停", ok,
    `重开=${s0.watch}/stored=${s0.stored} | apple词典卡=${card.isDict} | 复制后5.5s=${mid.watch} | 复制后${sinceCopy}ms暂停`);
}

// I4 再次暂停后复制 → 仍不翻译
{
  clip("banana");
  await sleep(2500);
  const s = await state();
  record("I4", "再次自动暂停后复制不翻译", s.src === "apple" && s.watch === "已暂停",
    `原文="${s.src}" | 状态=${s.watch}`);
}

// I5 文件剪贴板：不触发翻译、不算活动（不重置计时）
{
  await ev(`document.getElementById("watchToggle").click(); "ok"`);
  await sleep(300);
  const t0 = Date.now();
  clipFile("E:\\clipboard-translator-dev\\package.json");
  await sleep(1500);
  const mid = await state();
  const { s, elapsed, timeout } = await waitAutoPause(t0, 15000);
  const ok = mid.src === "apple" && !timeout && s.watch === "已暂停" && s.src === "apple"
    && elapsed >= 5000 && elapsed <= 12000;
  record("I5", "文件剪贴板不触发翻译且不重置计时", ok,
    `复制文件后原文="${mid.src}" | ${elapsed}ms后自动暂停 | 状态=${s.watch}`);
}

writeFileSync("tests/idle-watch-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
ws.close();
process.exit(pass === results.length ? 0 : 1);