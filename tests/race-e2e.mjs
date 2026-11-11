// 竞态防护真实窗口端到端：node tests/race-e2e.mjs
// 需窗口以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" 启动。
// 验证 requestSeq：慢请求先发、快请求后发时，慢请求的迟到响应必须被丢弃，界面只留最新一次的译文；
// 且被顶替的旧请求不写历史。反向（快先发慢后发）则最新慢请求正常显示。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("1420")) || list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (ex) => (await send("Runtime.evaluate", { expression: ex, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("tests/shots-race", { recursive: true });
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`tests/shots-race/${name}.png`, Buffer.from(s.result.data, "base64")); };

const stateExpr = `(()=>{const b=document.getElementById("targetBody"),d=b.querySelector(".dict"),st=document.getElementById("sourceText");
return JSON.stringify({
 src:st.value,
 loading:b.innerText.includes("正在翻译"),
 isDict:!!d,
 dictTitle:d?.querySelector(".dict-title")?.textContent??null,
 text:b.innerText.slice(0,200),
 note:document.getElementById("engineNote").textContent,
 libraryVisible:!document.getElementById("libraryView").classList.contains("hidden"),
 libText:document.getElementById("libraryBody").innerText.slice(0,8000)
})})()`;
const state = async () => JSON.parse(await ev(stateExpr));
async function waitState(pred, timeout = 60000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeout) { last = await state(); if (!last.loading && pred(last)) return last; await sleep(200); }
  return { ...last, timeout: true };
}
const setSource = (text) => ev(`(()=>{const s=document.getElementById("sourceText");s.value=${JSON.stringify(text)};s.dispatchEvent(new Event("input",{bubbles:true}));return s.value})()`);
const focusSource = () => ev(`document.getElementById("sourceText").focus(); "ok"`);
async function pressEnter() {
  await focusSource();
  const base = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const results = [];
function record(id, name, ok, input, output) {
  results.push({ id, name, ok, input, output });
  console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${name}  [${output}]`);
}

const SLOW = "The stale slow request must never overwrite the newer result shown in this window.";
const FAST_WORD = "apple";
const SLOW2 = "A newer slow sentence should still win when it is the latest request issued.";

// R1 慢句先发 → 立刻发快词：快词先回；慢句迟到必须被丢弃，界面停留快词词典卡
await setSource(SLOW); await pressEnter();
await setSource(FAST_WORD); await pressEnter();
{
  const s = await waitState((x) => x.src === FAST_WORD && x.isDict);
  record("R1a", "慢先发+快后发 → 先显示最新(快词)词典卡", !s.timeout && s.isDict && s.dictTitle === FAST_WORD,
    `慢句→快词 ${FAST_WORD}`, `词典卡=${s.isDict} | 词头="${s.dictTitle}"`);
  // 再等足够久，让慢句的真实响应到达；若防护缺失它会把界面覆盖成句子译文
  await sleep(7000);
  const after = await state();
  record("R1b", "慢句迟到响应被丢弃（7s 后界面仍是快词）", after.isDict && after.dictTitle === FAST_WORD && after.src === FAST_WORD && !after.loading,
    "等待慢响应到达后复查", `仍词典卡=${after.isDict} | 词头="${after.dictTitle}" | 原文="${after.src}"`);
  await shot("r1-stale-discarded");
}
// R2 被顶替的慢句不写历史
await ev(`document.getElementById("btnLibrary").click(); "ok"`); await sleep(900);
{
  const s = await state();
  record("R2", "被顶替的旧请求不写入历史", s.libraryVisible && !s.libText.includes("stale slow request"),
    "打开历史查慢句", `历史含慢句=${s.libText.includes("stale slow request")}`);
}
await ev(`document.getElementById("btnLibBack").click(); "ok"`); await sleep(300);
// R3 反向：快词先发 → 慢句后发（最新是慢句）→ 最终显示慢句译文
await setSource(FAST_WORD); await pressEnter();
await setSource(SLOW2); await pressEnter();
{
  const s = await waitState((x) => x.src === SLOW2 && !x.isDict && x.text.length > 0, 60000);
  record("R3", "快先发+慢后发 → 最终显示最新(慢句)译文", !s.timeout && !s.isDict && s.text.length > 0 && s.src === SLOW2,
    `快词→慢句`, `词典卡=${s.isDict} | 译文="${s.text.slice(0, 30)}"`);
  await shot("r3-latest-slow-wins");
}

writeFileSync("tests/race-e2e-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n竞态防护真实窗口端到端：${pass}/${results.length}`);
ws.close();
if (pass !== results.length) process.exitCode = 1;