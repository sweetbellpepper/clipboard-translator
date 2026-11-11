// 发布版冒烟：无密钥配置下，词典卡与设置页必须正常（不依赖 API）
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const ev = (ex) => new Promise((res) => {
  const i = ++id; pend.set(i, (m) => res(m.result?.result?.value));
  ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: ex, returnByValue: true } }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
  Buffer.from(`Set-Clipboard -Value '${s}'`, "utf16le").toString("base64")], { stdio: "ignore" });

const stateExpr = `(()=>{const b=document.getElementById("targetBody"),d=b.querySelector(".dict");
return JSON.stringify({
 src:document.getElementById("sourceText").value,
 loading:b.innerText.includes("正在翻译"),
 isDict:!!d,
 title:d?.querySelector(".dict-title")?.textContent??null,
 chips:d?[...d.querySelectorAll(".dict-chip")].map(c=>c.textContent):[],
 note:document.getElementById("engineNote").textContent,
 settingsVisible:!document.getElementById("settingsView").classList.contains("hidden"),
 dictStatus:document.getElementById("dictStatus")?.textContent??null,
 keyMasked:(document.getElementById("apiKeyInput")?.value??"")===""
})})()`;
const state = async () => JSON.parse(await ev(stateExpr));
async function waitState(pred, timeout = 30000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeout) {
    last = await state();
    if (!last.loading && pred(last)) return last;
    await sleep(400);
  }
  return { ...last, timeout: true };
}
const results = [];
const record = (id, name, ok, output) => { results.push({ id, name, ok, output }); console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${name}  [${output}]`); };

// 前置：确保监听开启。旧 WebView2 profile 可能残留「30 分钟空闲自动暂停」持久化的 wb_watch=0，
// 那会让剪贴板入口直接 return，与功能无关；这里恢复监听再测。
await ev(`(()=>{const b=document.getElementById("btnWatch");if(b.getAttribute("aria-checked")!=="true")b.click();return b.getAttribute("aria-checked")})()`);
await sleep(300);

clip("apple");
{
  const s = await waitState((x) => x.src === "apple");
  record("S1", "发布版：apple 词典卡（无密钥可用）", !s.timeout && s.isDict && s.title === "apple" && s.chips.length > 0 && s.note === "由本地词典提供",
    `词头=${s.title} | chips=${s.chips.join(",")} | 底栏=${s.note}`);
}
clip("model");
{
  const s = await waitState((x) => x.src === "model");
  record("S2", "发布版：model 词典卡", !s.timeout && s.isDict && s.title === "model" && s.note === "由本地词典提供",
    `词头=${s.title} | 底栏=${s.note}`);
}
await ev(`(()=>{if(document.getElementById("settingsView").classList.contains("hidden"))document.getElementById("btnSettings").click();return "ok"})()`);
{
  await sleep(1000); // 等 refreshDictStatus 异步完成，避免读到上一次的旧状态文本
  const s = await state();
  record("S3", "发布版：设置页词典状态已加载", s.settingsVisible && /词典已加载/.test(s.dictStatus ?? ""), `词典状态="${s.dictStatus}"`);
}
// S4 回归：设置页改动触发保存后，磁盘上的 dictPath 不得被表单默认值覆盖
{
  await ev(`(()=>{const s=document.getElementById("modelSel");s.value="deepseek-v4.1-flash-1017";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()`);
  await sleep(1200);
  const cfg = JSON.parse((await import("node:fs")).readFileSync("E:/译雀1.0/config.local.json", "utf8"));
  const ok = cfg.dictPath === "E:\\译笺词库\\ecdict.db" && cfg.engines[0].model === "deepseek-v4.1-flash-1017";
  record("S4", "发布版：保存设置不覆盖 dictPath", ok, `dictPath=${JSON.stringify(cfg.dictPath)} | model=${cfg.engines[0].model}`);
  await ev(`(()=>{const s=document.getElementById("modelSel");s.value="hy-mt2-plus";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()`);
  await sleep(1200);
}
writeFileSync("tests/release-smoke-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n发布版冒烟：${pass}/${results.length}`);
ws.close();
if (pass !== results.length) process.exitCode = 1;
