// 真实窗口端到端：node tests/e2e.mjs
// 需要窗口以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" 启动。
// 用 CDP 写剪贴板并读真实 DOM；输出 tests/e2e-results.json。
// 覆盖：句子翻译（E1-E11）+ 单词详解（W1-W5，词典/AI兜底/缓存/原形/复制）。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("1420")) || list.find((t) => t.type === "page");
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
const readClip = () => {
  const b64 = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Clipboard -Raw)))"], { encoding: "utf8" }).trim();
  return Buffer.from(b64, "base64").toString("utf8").trim();
};

const stateExpr = `(()=>{const b=document.getElementById("targetBody"),d=b.querySelector(".dict"),sel=document.getElementById("modelSel");
return JSON.stringify({
 src:document.getElementById("sourceText").value,
 loading:b.innerText.includes("正在翻译"),
 isDict:!!d,
 dictTitle:d?.querySelector(".dict-title")?.textContent??null,
 dictPhonetic:d?.querySelector(".dict-phonetic")?.textContent??null,
 dictChips:d?[...d.querySelectorAll(".dict-chip")].map(c=>c.textContent):[],
 dictPoses:d?[...d.querySelectorAll(".d-pos")].map(p=>p.textContent):[],
 lemmaRow:d?.querySelector(".dict-base .base-word")?.textContent??null,
 hasExample:!!d?.querySelector(".dict-example"),
 text:b.innerText.slice(0,180),
 note:document.getElementById("engineNote").textContent,
 charCount:document.getElementById("charCount").textContent,
 model:sel?.value??null,
 modelOptions:sel?[...sel.options].map(o=>o.value):[],
 hasWordModelSel:!!document.getElementById("wordModelSel"),
 modelLabelText:document.getElementById("modelLabel")?.textContent??null,
 limitHint:document.getElementById("limitHint")?.textContent??null,
 dictHint:document.getElementById("dictHint")?.textContent??null,
 relatedRowExists:!!document.getElementById("relatedLabel"),
 cacheLabel:document.getElementById("cacheLabel")?.textContent??null,
 cacheStats:document.getElementById("cacheStats")?.textContent??null,
 hotkeyLabel:document.getElementById("hotkeyLabel")?.textContent??null,
 hotkeyChecked:document.getElementById("hotkeyToggle")?.getAttribute("aria-checked")??null,
 hotkeyHint:document.getElementById("hotkeyHint")?.textContent??null,
 hotkeyKbd:document.querySelectorAll("#hotkeyHint kbd").length,
 hotkeyDesc:document.getElementById("hotkeyDesc")?.textContent??null,
 hotkeyDisabled:!!document.getElementById("hotkeyToggle")?.disabled,
 autostartLabel:document.getElementById("autostartLabel")?.textContent??null,
 autostartChecked:document.getElementById("autostartToggle")?.getAttribute("aria-checked")??null,
 autostartState:document.getElementById("autostartState")?.textContent??null,
 lookFolded:!!document.querySelector("details.group-fold")&&!document.querySelector("details.group-fold").open,
 libraryVisible:!document.getElementById("libraryView").classList.contains("hidden"),
 libTab:document.getElementById("tabFav")?.className.includes("on")?"fav":"history",
 libRowCount:document.querySelectorAll("#libraryBody .lib-row").length,
 hasFavStar:!!document.querySelector("#targetBody .dict-fav"),
 favStarOn:!!document.querySelector("#targetBody .dict-fav.on"),
 loadingElapsed:b.innerText.includes("已用"),
 hasDictToggle:!!document.getElementById("dictToggle"),
 dictStatus:document.getElementById("dictStatus")?.textContent??null,
 settingsVisible:!document.getElementById("settingsView").classList.contains("hidden"),
 targetFont:getComputedStyle(b.querySelector(".target-text")||b).fontSize,
 copyVisible:!document.getElementById("btnCopy").className.includes("hidden"),
 brand:document.getElementById("brandTop")?.textContent??null,
 docTitle:document.title,
 themeLabel:document.getElementById("themeLabel")?.textContent??null,
 schemeTiles:document.querySelectorAll(".scheme-tile").length,
 schemeOn:document.querySelector(".scheme-tile.on")?.dataset.id??null,
 schemeStored:localStorage.getItem("wb_theme"),
 schemeBg:getComputedStyle(document.getElementById("app")).getPropertyValue("--bg").trim(),
 schemeAccent:getComputedStyle(document.getElementById("app")).getPropertyValue("--accent").trim(),
 modePills:[...document.querySelectorAll(".scheme-mode")].map(m=>m.textContent),
 hasOldThemeUi:!!document.querySelector(".swatch,.dopa-opt,#hexInput,#colorPicker,#dopaBtn")
})})()`;
const state = async () => JSON.parse(await ev(stateExpr));
async function waitState(pred, timeout = 60000) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeout) {
    last = await state();
    if (!last.loading && pred(last)) return last;
    await sleep(400);
  }
  return { ...last, timeout: true };
}
async function switchSel(id, model) {
  await ev(`(()=>{const s=document.getElementById("${id}");s.value="${model}";s.dispatchEvent(new Event("change",{bubbles:true}));return s.value})()`);
  await sleep(1400);
}
const switchModel = (model) => switchSel("modelSel", model);

const results = [];
// 记录测试开始时的引擎，结束前必须还原：测试不得改动用户配置
const s0 = await state();
const originalModel = s0.model;
const originalMaxChars = JSON.parse(readFileSync("./config.local.json", "utf8")).maxChars;
console.log(`测试开始时引擎：${originalModel} / 长度上限：${originalMaxChars}（结束后恢复）`);
function record(id, name, ok, input, output) {
  results.push({ id, name, ok, input, output });
  console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${name}  [${output}]`);
}

const SENT = "The committee has reached a consensus on the annual budget.";
const ZH = "过度包装不仅浪费资源，还会误导消费者。";

// E1 英文句子 → 纯中文译文，无词典卡
clip(SENT);
{
  const s = await waitState((x) => x.src.startsWith("The committee"));
  record("E1", "英文句子 → 只有中文译文", !s.timeout && !s.isDict && /共识|预算/.test(s.text) && /^由 .+ 翻译$/.test(s.note) && s.charCount === "",
    SENT, `译文="${s.text.slice(0, 32)}" | 词典卡=${s.isDict} | 底栏="${s.note}"`);
}
// E2 中文句子 → 自动判向英文译文
clip(ZH);
{
  const s = await waitState((x) => x.src.startsWith("过度包装"));
  record("E2", "中文句子 → 自动判向英文译文", !s.timeout && !s.isDict && /packag|waste|mislead/i.test(s.text),
    ZH, `译文="${s.text.slice(0, 44)}"`);
}
// E3 单个常见单词 model → 命中本地词典，出词典卡（不再是纯译文）
clip("model");
{
  const s = await waitState((x) => x.src === "model");
  record("E3", "单词 model → 本地词典卡", !s.timeout && s.isDict && s.dictTitle === "model" && s.dictPoses.length > 0 && s.note === "由本地词典提供",
    "model", `词典卡=${s.isDict} | 词头="${s.dictTitle}" | 词性=${s.dictPoses.join("/")} | 底栏="${s.note}"`);
}
// E4 设置页：详解开关已移除（单词常开详解）、词典状态已加载；相关词条行已删除，新增缓存/热键/自启行，外观常开不折叠
await ev(`document.getElementById("btnSettings").click(); "ok"`);
{
  // 词典状态由 refreshDictStatus 异步刷新，等待其完成再断言
  const t0 = Date.now(); let s = await state();
  while (!/词典已加载|未找到/.test(s.dictStatus ?? "") && Date.now() - t0 < 8000) {
    await sleep(300); s = await state();
  }
  const ok = s.settingsVisible && !s.hasDictToggle && /本地词典/.test(s.dictHint ?? "") && /词典已加载/.test(s.dictStatus ?? "")
    && !s.relatedRowExists && s.cacheLabel === "单词缓存" && s.hotkeyLabel === "全局热键"
    && s.autostartLabel === "开机自启" && s.autostartChecked === "false" && !s.lookFolded
    && s.hotkeyKbd === 3 && /唤出/.test(s.hotkeyDesc ?? "");
  record("E4", "设置页：详解常开+词典状态，相关词条已删，缓存/热键键帽+说明/自启（默认关）+外观常开", ok,
    "打开设置页", `开关=${s.hasDictToggle} | 词典="${s.dictStatus}" | 相关词条行=${s.relatedRowExists} | 缓存行="${s.cacheLabel}" | 自启=${s.autostartChecked} | 外观折叠=${s.lookFolded} | 键帽=${s.hotkeyKbd} | 说明="${s.hotkeyDesc}"`);
}
// E5 四个模型都在下拉框里（hy4 / glm 已下架）
{
  const s = await state();
  const want = ["hy-mt2-pro", "hy-mt2-plus", "hy-mt2-lite", "deepseek-v4.1-flash-1017"];
  const ok = JSON.stringify(s.modelOptions) === JSON.stringify(want);
  record("E5", "长文本模型下拉框恰好 4 个选项", ok, "读取 modelSel.options", `选项=${s.modelOptions.join(",")}`);
}
// E10 设置项：长文本模型标签、单词模型选择器已移除（固定 deepseek）、上限与详解提示文案
{
  const s = await state();
  const ok = s.modelLabelText === "长文本翻译模型" && !s.hasWordModelSel
    && /deepseek-v4\.1-flash-1017/.test(s.dictHint ?? "") && /降级/.test(s.dictHint ?? "")
    && /200–2000/.test(s.limitHint ?? "");
  record("E10", "设置页：单词模型固定 deepseek（选择器已移除）+ 上限 200–2000 提示", ok,
    "读取标签/选择器/提示文案", `标签="${s.modelLabelText}" | 单词选择器存在=${s.hasWordModelSel} | 详解提示="${s.dictHint}" | 上限提示="${s.limitHint}"`);
}
// E6 切到通用模型 deepseek：底栏跟随，且真实窗口能出纯译文
await switchModel("deepseek-v4.1-flash-1017");
clip(SENT);
{
  const s = await waitState((x) => x.src.startsWith("The committee") && x.note.includes("deepseek"));
  record("E6", "切到 deepseek → 底栏「由 deepseek-v4.1-flash-1017 翻译」且译文正常", !s.timeout && !s.isDict && /共识|预算/.test(s.text) && s.note === "由 deepseek-v4.1-flash-1017 翻译",
    "切换到 deepseek + 复制英文句子", `译文="${s.text.slice(0, 28)}" | 底栏="${s.note}"`);
}
// E7 恢复测试开始时的引擎（不擅自改用户配置），用句子验证
await switchModel(originalModel);
clip(SENT);
{
  const s = await waitState((x) => x.src.startsWith("The committee") && x.note.includes(originalModel));
  record("E7", `恢复 ${originalModel} → 底栏与译文均正常`, !s.timeout && !s.isDict && /共识|预算/.test(s.text) && s.note === `由 ${originalModel} 翻译`,
    `恢复到 ${originalModel} + 复制英文句子`, `译文="${s.text.slice(0, 20)}" | 底栏="${s.note}"`);
}
// E11 长度上限超范围 → 夹到 2000 落盘 → 还原（设置页仍打开）
const setLimit = (v) => ev(`(()=>{const i=document.getElementById("limitInput");i.value="${v}";i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));return i.value})()`);
{
  const shown = await setLimit(5000);
  await sleep(1400);
  const changed = JSON.parse(readFileSync("./config.local.json", "utf8")).maxChars;
  await setLimit(originalMaxChars);
  await sleep(1400);
  const restored = JSON.parse(readFileSync("./config.local.json", "utf8")).maxChars;
  record("E11", "长度上限填 5000 → 夹到 2000 落盘后还原", shown === "2000" && changed === 2000 && restored === originalMaxChars,
    "填 5000 → 读 config.local.json → 还原", `显示=${shown} | 落盘=${changed} | 还原=${restored}`);
}
await ev(`document.getElementById("btnBack").click(); "ok"`);
// E8 复制按钮内容 = 界面译文（句子场景）
{
  const before = await state();
  await ev(`document.getElementById("btnCopy").click(); "ok"`);
  await sleep(300);
  const copied = readClip();
  record("E8", "复制按钮内容 = 界面主译文", before.copyVisible && copied === before.text.trim(),
    "点击复制", `剪贴板="${copied.slice(0, 32)}" | 界面="${before.text.trim().slice(0, 28)}"`);
}

// ---------- 单词详解（W 系列） ----------
// W1 apple → 词典卡：音标 + n. 词性 + 考纲/柯林斯 chips
clip("apple");
{
  const s = await waitState((x) => x.src === "apple");
  const ok = !s.timeout && s.isDict && s.dictTitle === "apple" && /æpl|ˈæp/.test(s.dictPhonetic ?? "")
    && s.dictPoses.some((p) => p.includes("n")) && s.dictChips.length > 0;
  record("W1", "apple → 词典卡（音标+词性+chips）", ok,
    "apple", `音标="${s.dictPhonetic}" | 词性=${s.dictPoses.join("/")} | chips=${s.dictChips.join(",")}`);
}
// W5 词典卡复制 = 释义行文本（不含音标/chips）
{
  const before = await state();
  await ev(`document.getElementById("btnCopy").click(); "ok"`);
  await sleep(300);
  const copied = readClip();
  const ok = before.copyVisible && copied.includes("苹果") && !copied.includes(before.dictPhonetic ?? "\u0000");
  record("W5", "词典卡复制 = 释义行", ok, "点击复制", `剪贴板="${copied.slice(0, 60).replace(/\n/g, "⏎")}"`);
}
// W4 befallen → 词典自身收录（释义指向原形 befall），或释义为空时反查原形行
clip("befallen");
{
  const s = await waitState((x) => x.src === "befallen");
  const ok = !s.timeout && s.isDict && s.note === "由本地词典提供"
    && (s.lemmaRow === "befall" || (s.dictTitle === "befallen" && /befall/.test(s.text)));
  record("W4", "befallen → 词典卡且释义指向原形 befall", ok,
    "befallen", `原形行="${s.lemmaRow}" | 词头="${s.dictTitle}" | 释义="${s.text.slice(0, 30)}" | 底栏="${s.note}"`);
}
// W2 skibidi → 词典无收录，AI 兜底出卡（真实请求，90s 超时）
const AI_WORD = "skibidi";
clip(AI_WORD);
{
  const t0 = Date.now();
  const s = await waitState((x) => x.src === AI_WORD, 90000);
  const ms = Date.now() - t0;
  const ok = !s.timeout && s.isDict && s.dictPoses.length > 0 && s.note === "由 deepseek-v4.1-flash-1017 详解";
  record("W2", "skibidi → AI 兜底词典卡", ok,
    AI_WORD, `耗时=${ms}ms | 词性=${s.dictPoses.join("/")} | 底栏="${s.note}" | 例句=${s.hasExample}`);
}
// W3 同一单词再查 → 命中 AI 缓存（应明显更快，底栏仍为详解文案）
{
  await sleep(1500); // 避开 1 秒去重窗口
  clip("apple"); await sleep(1200); // 先切走，保证剪贴板变化触发
  clip(AI_WORD);
  const t0 = Date.now();
  const s = await waitState((x) => x.src === AI_WORD, 20000);
  const ms = Date.now() - t0;
  const ok = !s.timeout && s.isDict && ms < 8000 && existsSync("./word_cache.db") && /详解/.test(s.note);
  record("W3", "skibidi 二次查询 → 缓存命中（<8s）", ok,
    `${AI_WORD}（第二次）`, `耗时=${ms}ms | 底栏="${s.note}" | 缓存文件=${existsSync("./word_cache.db")}`);
}

// ---------- 历史 / 生词本 / 缓存 / 热键 / 自启（L 系列，非破坏性、自恢复） ----------
// L1 打开历史面板：前面的翻译已被记录
await ev(`document.getElementById("btnLibrary").click(); "ok"`);
await sleep(700);
{
  const s = await state();
  record("L1", "历史面板记录翻译", s.libraryVisible && s.libTab === "history" && s.libRowCount > 0,
    "打开历史", `可见=${s.libraryVisible} | tab=${s.libTab} | 行数=${s.libRowCount}`);
}
// L2 点击历史行 → 回到译文视图回看
{
  await ev(`document.querySelector("#libraryBody .lib-row").click(); "ok"`);
  await sleep(500);
  const s = await state();
  record("L2", "点击历史行回看译文", !s.libraryVisible && s.src.length > 0,
    "点击首行", `库可见=${s.libraryVisible} | 原文="${s.src.slice(0, 24)}"`);
}
// L3 单词卡收藏星标：点两次（亮→灭）净变化为零，不改动用户生词本
clip("apple");
{
  const sa = await waitState((x) => x.src === "apple" && x.isDict);
  const before = sa.favStarOn;
  await ev(`document.querySelector("#targetBody .dict-fav").click(); "ok"`);
  await sleep(500);
  const sb = await state();
  await ev(`document.querySelector("#targetBody .dict-fav").click(); "ok"`);
  await sleep(500);
  const sc = await state();
  const ok = sa.hasFavStar && sb.favStarOn !== before && sc.favStarOn === before;
  record("L3", "收藏星标可切换且自恢复", ok, "apple 点星两次",
    `星标=${sa.hasFavStar} | 初=${before} | 一次=${sb.favStarOn} | 二次=${sc.favStarOn}`);
}
// L4 设置页新行：缓存统计（W 系列已写缓存）、热键可用+键帽、自启默认关、外观常开
await ev(`document.getElementById("btnSettings").click(); "ok"`);
await sleep(900);
{
  const s = await state();
  const ok = /条/.test(s.cacheStats ?? "") && !s.hotkeyDisabled && s.hotkeyHint === "Ctrl+Alt+T" && s.hotkeyKbd === 3
    && s.autostartChecked === "false" && !s.lookFolded;
  record("L4", "设置页：缓存统计+热键键帽可用+自启默认关+外观常开", ok, "打开设置页",
    `缓存="${s.cacheStats}" | 热键禁用=${s.hotkeyDisabled} | 提示="${s.hotkeyHint}" | 键帽=${s.hotkeyKbd} | 自启=${s.autostartChecked} | 折叠=${s.lookFolded}`);
}
// L5 热键开关 off→on 自恢复（仅改 localStorage 与运行态，无系统副作用）
{
  await ev(`document.getElementById("hotkeyToggle").click(); "ok"`);
  await sleep(300);
  const off = await state();
  await ev(`document.getElementById("hotkeyToggle").click(); "ok"`);
  await sleep(300);
  const on = await state();
  const ok = off.hotkeyChecked === "false" && on.hotkeyChecked === "true" && on.hotkeyHint === "Ctrl+Alt+T";
  record("L5", "热键开关可切换且自恢复", ok, "切换两次", `关=${off.hotkeyChecked} | 开=${on.hotkeyChecked}`);
}
// ---------- 配色方案 / 品牌名随语言（T 系列，非网络、自恢复） ----------
// T1 配色选择器：8 张卡片、默认雾隐、旧背景底色/多巴胺控件已移除
{
  const s = await state();
  const ok = s.schemeTiles === 8 && s.schemeOn === "brume" && s.schemeStored === "brume"
    && s.themeLabel === "配色方案" && !s.hasOldThemeUi && s.schemeBg === "#E7E3DA";
  record("T1", "配色选择器 8 款、默认雾隐、旧控件已移除", ok, "读取设置页外观",
    `卡片=${s.schemeTiles} | 选中=${s.schemeOn} | 记忆=${s.schemeStored} | 标签="${s.themeLabel}" | 旧控件=${s.hasOldThemeUi} | 底色=${s.schemeBg}`);
}
// T2 界面语言切换：左上角品牌名与标题中英联动，浅深标记英文化，再切回
{
  await ev(`document.querySelector('#langSeg button[data-lang="en"]').click(); "ok"`);
  await sleep(200);
  const en = await state();
  await ev(`document.querySelector('#langSeg button[data-lang="zh"]').click(); "ok"`);
  await sleep(200);
  const zh = await state();
  const ok = en.brand === "Sparrow" && en.docTitle === "Sparrow" && en.themeLabel === "Color scheme"
    && en.modePills.includes("Light") && en.modePills.includes("Dark")
    && zh.brand === "译雀" && zh.docTitle === "译雀" && zh.themeLabel === "配色方案";
  record("T2", "品牌名/标题/配色标签随语言中英切换", ok, "切英文再切回中文",
    `en品牌="${en.brand}" | en标题="${en.docTitle}" | en标签="${en.themeLabel}" | en标记=${en.modePills.join("/")} | zh品牌="${zh.brand}"`);
}
// T3 点选深色方案 → 变量/选中/记忆同步，再点回雾隐自恢复
{
  await ev(`document.querySelector('.scheme-tile[data-id="onyx"]').click(); "ok"`);
  await sleep(200);
  const dark = await state();
  await ev(`document.querySelector('.scheme-tile[data-id="brume"]').click(); "ok"`);
  await sleep(200);
  const back = await state();
  const ok = dark.schemeOn === "onyx" && dark.schemeStored === "onyx" && dark.schemeBg === "#1E2422" && dark.schemeAccent === "#86B7A6"
    && back.schemeOn === "brume" && back.schemeStored === "brume" && back.schemeBg === "#E7E3DA";
  record("T3", "点选墨玉→变量/记忆同步，点回雾隐自恢复", ok, "点 onyx 再点 brume",
    `深底色=${dark.schemeBg} | 深强调=${dark.schemeAccent} | 深记忆=${dark.schemeStored} | 还原=${back.schemeOn}/${back.schemeBg}`);
}
await ev(`document.getElementById("btnBack").click(); "ok"`);

// E9 测试结束后配置必须回到原值（句子模型 + 长度上限）
{
  const afterCfg = JSON.parse(readFileSync("./config.local.json", "utf8"));
  const after = afterCfg.engines[0].model;
  record("E9", "测试结束后配置模型与上限未被改动", after === originalModel && afterCfg.maxChars === originalMaxChars,
    "读取 config.local.json", `原始=${originalModel}/${originalMaxChars} | 结束=${after}/${afterCfg.maxChars}`);
}

writeFileSync("tests/e2e-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n真实窗口端到端：${pass}/${results.length}`);
ws.close();
if (pass !== results.length) process.exitCode = 1;
