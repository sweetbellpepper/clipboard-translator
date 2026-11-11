// 手动输入真实窗口端到端：node tests/manual-e2e.mjs
// 需窗口以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" 启动。
// 验证「保留复制即译 + 附加手动输入、无互斥」：textarea/翻译按钮、Enter 翻译、Shift+Enter 换行、
// 空白与输入法组词忽略、聚焦时复制仍自动翻译、超上限跳过+仍要翻译、手动写入历史。
// 真实键事件用 CDP Input.dispatchKeyEvent；截图存 tests/shots-manual/。不改动用户配置。
import { execFileSync } from "node:child_process";
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
const clip = (s) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
  Buffer.from(`Set-Clipboard -Value '${s}'`, "utf16le").toString("base64")], { stdio: "ignore" });
mkdirSync("tests/shots-manual", { recursive: true });
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`tests/shots-manual/${name}.png`, Buffer.from(s.result.data, "base64")); };

const stateExpr = `(()=>{const b=document.getElementById("targetBody"),d=b.querySelector(".dict"),st=document.getElementById("sourceText");
return JSON.stringify({
 srcTag:st.tagName,
 src:st.value,
 placeholder:st.placeholder,
 activeId:document.activeElement?.id??null,
 translateBtn:!!document.getElementById("btnTranslate"),
 loading:b.innerText.includes("正在翻译"),
 isDict:!!d,
 dictTitle:d?.querySelector(".dict-title")?.textContent??null,
 dictPoses:d?[...d.querySelectorAll(".d-pos")].map(p=>p.textContent):[],
 text:b.innerText.slice(0,200),
 note:document.getElementById("engineNote").textContent,
 skipVisible:!!b.querySelector(".force"),
 skipTitle:b.querySelector(".skip-title")?.textContent??null,
 copyVisible:!document.getElementById("btnCopy").className.includes("hidden"),
 libraryVisible:!document.getElementById("libraryView").classList.contains("hidden"),
 libText:document.getElementById("libraryBody").innerText.slice(0,6000),
 libRowCount:document.querySelectorAll("#libraryBody .lib-row").length
})})()`;
const state = async () => JSON.parse(await ev(stateExpr));
async function waitState(pred, timeout = 60000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeout) { last = await state(); if (!last.loading && pred(last)) return last; await sleep(400); }
  return { ...last, timeout: true };
}
const setSource = (text) => ev(`(()=>{const s=document.getElementById("sourceText");s.value=${JSON.stringify(text)};s.dispatchEvent(new Event("input",{bubbles:true}));return s.value})()`);
const focusSource = () => ev(`document.getElementById("sourceText").focus(); "ok"`);
const clickTranslate = () => ev(`document.getElementById("btnTranslate").click(); "ok"`);
async function pressEnter(shift = false) {
  await focusSource();
  const base = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: shift ? 8 : 0 };
  const txt = "\r";
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: txt, unmodifiedText: txt });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const synthEnter = (shift, composing) => ev(`(()=>{const s=document.getElementById("sourceText");const e=new KeyboardEvent("keydown",{key:"Enter",shiftKey:${shift},isComposing:${composing},bubbles:true,cancelable:true});s.dispatchEvent(e);return JSON.stringify({defaultPrevented:e.defaultPrevented})})()`).then(JSON.parse);

const results = [];
function record(id, name, ok, input, output) {
  results.push({ id, name, ok, input, output });
  console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${name}  [${output}]`);
}

// M0 结构：原文框是 textarea、有翻译按钮、占位提示已本地化
{
  const s = await state();
  record("M0", "原文框=textarea + 翻译按钮 + 占位提示", s.srcTag === "TEXTAREA" && s.translateBtn && /输入|Enter/.test(s.placeholder),
    "读取 DOM", `标签=${s.srcTag} | 翻译按钮=${s.translateBtn} | 占位="${s.placeholder}"`);
  await shot("m0-empty");
}
// M1 手动输入单词 apple + 点「翻译」→ 本地词典卡
await setSource("apple"); await clickTranslate();
{
  const s = await waitState((x) => x.src === "apple" && x.isDict);
  record("M1", "手动 apple + 点翻译 → 本地词典卡", !s.timeout && s.isDict && s.dictTitle === "apple" && s.dictPoses.length > 0 && s.note === "由本地词典提供",
    "apple", `词典卡=${s.isDict} | 词头="${s.dictTitle}" | 词性=${s.dictPoses.join("/")} | 底栏="${s.note}"`);
  await shot("m1-word-dict");
}
// M2 手动输入英文句子 + 真实 Enter → 译文（无词典卡）
const SENT = "Manual input verifies the sparrow translates typed sentences.";
await setSource(SENT); await pressEnter(false);
{
  const s = await waitState((x) => x.src === SENT && !x.isDict && x.text.length > 0);
  record("M2", "手动英文句子 + Enter → 译文", !s.timeout && !s.isDict && s.text.length > 0 && s.copyVisible && /^由 .+ 翻译$/.test(s.note),
    SENT, `译文="${s.text.slice(0, 40)}" | 词典卡=${s.isDict} | 底栏="${s.note}"`);
  await shot("m2-sentence");
}
// M3 Shift+Enter → 换行且不翻译（译文保持不变）
{
  const before = await state();
  await setSource("line one"); await pressEnter(true); await sleep(350);
  const s = await state();
  record("M3", "Shift+Enter 换行且不触发翻译", s.src.includes("\n") && !s.loading && s.text === before.text,
    "line one + Shift+Enter", `原文含换行=${s.src.includes("\n")} | 原文="${JSON.stringify(s.src)}" | 译文未变=${s.text === before.text}`);
}
// M4 空白输入 + Enter / 点翻译 → 忽略，不发请求
{
  const before = await state();
  await setSource("   "); await pressEnter(false); await sleep(350);
  await clickTranslate(); await sleep(350);
  const s = await state();
  record("M4", "空白输入被忽略（Enter 与按钮均不发请求）", !s.loading && s.text === before.text && s.src.trim() === "",
    "'   ' + Enter + 点翻译", `加载中=${s.loading} | 译文未变=${s.text === before.text} | 原文trim空=${s.src.trim() === ""}`);
}
// M8 输入法组词期间的 Enter（isComposing）→ 不触发、不拦截默认行为
{
  const before = await state();
  await setSource("nihao");
  const r = await synthEnter(false, true); await sleep(300);
  const s = await state();
  record("M8", "输入法组词 Enter 不翻译且不拦截", r.defaultPrevented === false && !s.loading && s.text === before.text,
    "nihao + isComposing Enter", `defaultPrevented=${r.defaultPrevented} | 加载中=${s.loading} | 译文未变=${s.text === before.text}`);
}
// M5 聚焦原文框、已有草稿时复制新文本 → 仍自动翻译并覆盖草稿（无互斥/无抑制）
{
  await focusSource(); await setSource("my draft that should be replaced");
  const CLIP = "Clipboard still wins while the box is focused.";
  clip(CLIP);
  const s = await waitState((x) => x.src === CLIP && !x.isDict && x.text.length > 0);
  record("M5", "聚焦时复制新文本仍自动翻译（无抑制）", !s.timeout && s.src === CLIP && !s.isDict && s.copyVisible,
    `草稿被复制覆盖：${CLIP}`, `原文="${s.src.slice(0, 40)}" | 译文="${s.text.slice(0, 32)}" | 聚焦=${s.activeId}`);
  await shot("m5-clipboard-focused");
}
// M6 手动超上限 → 跳过卡（不发请求）；点「仍要翻译」→ 正常翻译。不改配置，按当前上限构造超长文本。
{
  const lim = JSON.parse(readFileSync("./config.local.json", "utf8")).maxChars ?? 2000;
  const unit = "This long manual sentence is meant to exceed the configured character limit. ";
  const LONG = unit.repeat(Math.ceil((lim + 200) / unit.length));
  await setSource(LONG); await pressEnter(false); await sleep(700);
  const sk = await state();
  record("M6a", `手动超上限(${Array.from(LONG).length}>${lim}) → 跳过卡`, sk.skipVisible && /跳过/.test(sk.skipTitle ?? "") && !sk.loading,
    `${Array.from(LONG).length} 字符`, `跳过卡=${sk.skipVisible} | 标题="${sk.skipTitle}"`);
  await shot("m6-skip");
  await ev(`document.querySelector("#targetBody .force").click(); "ok"`);
  const fo = await waitState((x) => !x.skipVisible && !x.isDict && x.text.length > 0, 90000);
  record("M6b", "点「仍要翻译」→ 正常翻译", !fo.timeout && !fo.skipVisible && fo.copyVisible,
    "强制翻译超长文本", `跳过卡=${fo.skipVisible} | 译文="${fo.text.slice(0, 30)}" | 复制可见=${fo.copyVisible}`);
}
// M7 手动翻译写入历史
await ev(`document.getElementById("btnLibrary").click(); "ok"`); await sleep(900);
{
  const s = await state();
  record("M7", "手动翻译写入历史", s.libraryVisible && s.libText.includes("Manual input verifies"),
    "打开历史面板", `可见=${s.libraryVisible} | 行数=${s.libRowCount} | 含手动句=${s.libText.includes("Manual input verifies")}`);
  await shot("m7-history");
}
await ev(`document.getElementById("btnLibBack").click(); "ok"`);

writeFileSync("tests/manual-e2e-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n手动输入真实窗口端到端：${pass}/${results.length}`);
ws.close();
if (pass !== results.length) process.exitCode = 1;