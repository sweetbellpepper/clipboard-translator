// 轮D 真窗口可视化 + 功能验证（亲眼截图）。需窗口带 CDP 9222 启动。
// 覆盖：设置页新行/外观折叠、错误态提示、加载态耗时+模型+慢提示、词典卡收藏星标、
//       历史/生词本面板、导出 CSV/Anki、缓存统计+清空。所有改动结束后自恢复。
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("1420")) || list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
  Buffer.from(`Set-Clipboard -Value '${s}'`, "utf16le").toString("base64")], { stdio: "ignore" });
const shot = async (name) => {
  const m = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`tests/shots/${name}`, Buffer.from(m.result.data, "base64"));
  console.log("  📸", name);
};
const readCfg = () => JSON.parse(readFileSync("./config.local.json", "utf8"));
const ORIGINAL_URL = readCfg().engines[0].baseUrl;

const getState = async () => JSON.parse(await ev(`(()=>{const b=document.getElementById("targetBody");return JSON.stringify({
 src:document.getElementById("sourceText").textContent,
 loading:b.innerText.includes("正在翻译"),
 isDict:!!b.querySelector(".dict"),
 error:!!b.querySelector(".state-error"),
 errorSub:b.querySelector(".state-error.sub")?.textContent??null,
 star:!!b.querySelector(".dict-fav"),
 starOn:!!b.querySelector(".dict-fav.on"),
 bodyText:b.innerText.slice(0,220),
 settingsVisible:!document.getElementById("settingsView").classList.contains("hidden"),
 libraryVisible:!document.getElementById("libraryView").classList.contains("hidden"),
 libRows:document.querySelectorAll("#libraryBody .lib-row").length,
 cacheStats:document.getElementById("cacheStats")?.textContent??null
})})()`));
async function waitPred(pred, timeout = 30000) {
  const t0 = Date.now(); let s = await getState();
  while (Date.now() - t0 < timeout) { s = await getState(); if (pred(s)) return s; await sleep(250); }
  return { ...s, timeout: true };
}
const setUrl = async (v) => {
  await ev(`(()=>{const i=document.getElementById("urlInput");i.value=${JSON.stringify(v)};i.dispatchEvent(new Event("input",{bubbles:true}));return i.value})()`);
  await sleep(800); // 等防抖落盘
};

// ---- 1. 设置页：新行 + 外观折叠 ----
await ev(`document.getElementById("btnSettings").click(); "ok"`);
await waitPred((s) => /词典已加载|未找到/.test(s.cacheStats ?? "") || s.settingsVisible, 8000);
await sleep(600);
await shot("d-settings-top.png");
await ev(`(()=>{const b=document.getElementById("settingsBody");b.scrollTop=b.scrollHeight;return b.scrollTop})()`);
await sleep(400);
await shot("d-settings-bottom.png");
await ev(`document.querySelector("details.group-fold").open=true; "ok"`);
await sleep(300);
await shot("d-settings-appearance.png");
console.log("设置页新行:", await ev(`JSON.stringify({cache:cacheLabel.textContent,hotkey:hotkeyLabel.textContent,autostart:autostartLabel.textContent,autostartChecked:autostartToggle.getAttribute("aria-checked"),relatedGone:!document.getElementById("relatedLabel")})`));

// ---- 2. 错误态：临时改坏接口地址 → 截图 → 还原 ----
try {
  await setUrl("http://127.0.0.1:9/v1");
  await ev(`document.getElementById("btnBack").click(); "ok"`);
  clip("The committee has reached a consensus on the annual budget.");
  const err = await waitPred((s) => s.error, 20000);
  await sleep(300);
  await shot("d-error.png");
  console.log("错误态提示:", err.errorSub, "| 超时=", !!err.timeout);
} finally {
  await ev(`document.getElementById("btnSettings").click(); "ok"`);
  await sleep(400);
  await setUrl(ORIGINAL_URL);
  await ev(`document.getElementById("btnBack").click(); "ok"`);
  console.log("接口地址已还原:", readCfg().engines[0].baseUrl === ORIGINAL_URL);
}

// ---- 3. 词典卡收藏星标 ----
clip("apple");
await waitPred((s) => s.src === "apple" && s.isDict, 15000);
await sleep(300);
await shot("d-word-star-off.png");
await ev(`document.querySelector("#targetBody .dict-fav").click(); "ok"`);
await sleep(600);
const starOn = await getState();
await shot("d-word-star-on.png");
console.log("收藏星标点亮:", starOn.starOn);

// ---- 4. 生词本面板 + 导出 ----
await ev(`document.getElementById("btnLibrary").click(); "ok"`);
await sleep(400);
await ev(`document.getElementById("tabFav").click(); "ok"`);
const fav = await waitPred((s) => s.libraryVisible && s.libRows > 0, 8000);
await sleep(300);
await shot("d-library-fav.png");
console.log("生词本行数:", fav.libRows);
await ev(`document.getElementById("btnExportCsv").click(); "ok"`);
await sleep(800);
await ev(`document.getElementById("btnExportAnki").click(); "ok"`);
await sleep(800);
console.log("导出 CSV 存在:", existsSync("./生词本.csv"), "| 导出 Anki 存在:", existsSync("./生词本-anki.txt"));
if (existsSync("./生词本.csv")) console.log("CSV 内容:\n" + readFileSync("./生词本.csv", "utf8").trim());
if (existsSync("./生词本-anki.txt")) console.log("Anki 内容:\n" + readFileSync("./生词本-anki.txt", "utf8").trim());

// ---- 5. 历史面板 ----
await ev(`document.getElementById("tabHistory").click(); "ok"`);
const hist = await waitPred((s) => s.libRows > 0, 8000);
await sleep(300);
await shot("d-library-history.png");
console.log("历史行数:", hist.libRows);

// ---- 6. 取消 apple 收藏（还原），关闭面板 ----
await ev(`document.getElementById("tabFav").click(); "ok"`);
await sleep(400);
await ev(`(()=>{const d=document.querySelector("#libraryBody .lib-row .lib-copy");if(d)d.click();return !!d})()`);
await sleep(600);
await ev(`document.getElementById("btnLibBack").click(); "ok"`);
console.log("收藏已还原（应为 0）:", await ev(`window.__TAURI__.core.invoke("favorite_list").then(a=>a.length)`));

// ---- 7. 加载态：全新未缓存词 → 抓加载中帧 ----
clip("zorpquake");
await sleep(450); // 合并 100ms + 渲染
let loadShot = false;
for (let i = 0; i < 12; i++) {
  const s = await getState();
  if (s.loading) { await shot("d-loading.png"); console.log("加载态文案:", JSON.stringify(s.bodyText)); loadShot = true; break; }
  if (s.isDict) break;
  await sleep(200);
}
if (!loadShot) console.log("⚠ 未抓到加载帧（AI 过快），稍后重试");
await waitPred((s) => s.src === "zorpquake" && !s.loading, 90000);

// ---- 8. 缓存统计 + 清空 ----
await ev(`document.getElementById("btnSettings").click(); "ok"`);
await sleep(700);
const before = await getState();
console.log("清空前缓存:", before.cacheStats);
await ev(`document.getElementById("btnCacheClear").click(); "ok"`);
await sleep(700);
const after = await getState();
await shot("d-cache-cleared.png");
console.log("清空后缓存:", after.cacheStats);
await ev(`document.getElementById("btnBack").click(); "ok"`);

// ---- 9. 重新填充原有缓存词（skibidi / zorbqux），还原缓存 ----
for (const w of ["skibidi", "zorbqux"]) {
  clip("apple"); await sleep(1200); // 切走保证剪贴板变化
  clip(w);
  await waitPred((s) => s.src === w && !s.loading, 90000);
  await sleep(400);
}
console.log("还原后缓存:", await ev(`window.__TAURI__.core.invoke("cache_stats").then(s=>JSON.stringify(s))`));

// ---- 10. 清理导出测试文件，回到译文视图，核对配置 ----
for (const f of ["./生词本.csv", "./生词本-anki.txt"]) if (existsSync(f)) unlinkSync(f);
await ev(`document.getElementById("btnLibBack").click(); "ok"`).catch(() => {});
const finalCfg = readCfg();
console.log("配置核对: baseUrl还原=", finalCfg.engines[0].baseUrl === ORIGINAL_URL,
  "| model=", finalCfg.engines[0].model, "| maxChars=", finalCfg.maxChars);
console.log("DONE");
ws.close();