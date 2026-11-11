// 发布版 UI 验证：改名译雀/Sparrow + 8 配色 + 无密钥，CDP 9222，截图 tests/shots-release/
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (ex) => (await send("Runtime.evaluate", { expression: ex, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s) => execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(`Set-Clipboard -Value '${s}'`, "utf16le").toString("base64")], { stdio: "ignore" });
mkdirSync("tests/shots-release", { recursive: true });
async function shot(name) { await sleep(360); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`tests/shots-release/${name}.png`, Buffer.from(r.result.data, "base64")); console.log("  shot " + name); }
await send("Runtime.enable"); await send("Page.enable");

const probe = `(()=>{const a=document.getElementById("app");const cs=getComputedStyle(a);const t=[...document.querySelectorAll(".scheme-tile")];
return JSON.stringify({brand:document.getElementById("brandTop")?.textContent,title:document.title,
bg:cs.getPropertyValue("--bg").trim(),accent:cs.getPropertyValue("--accent").trim(),accentFg:cs.getPropertyValue("--accent-fg").trim(),
tiles:t.length,on:document.querySelector(".scheme-tile.on")?.dataset.id,stored:localStorage.getItem("wb_theme"),
themeLabel:document.getElementById("themeLabel")?.textContent,
modes:t.map(x=>x.querySelector(".scheme-mode")?.textContent),
keyEmpty:(document.getElementById("apiKeyInput")?.value??"")==="",
settingsVisible:!document.getElementById("settingsView").classList.contains("hidden"),
isDict:!!document.querySelector("#targetBody .dict"),dictTitle:document.querySelector("#targetBody .dict-title")?.textContent??null})})()`;
const P = async () => JSON.parse(await ev(probe));
const results = [];
const rec = (id, name, ok, out) => { results.push({ id, name, ok, out }); console.log(`${ok ? "  ✓" : "  ✗"} ${id} ${name}  [${out}]`); };
const click = (sel) => ev(`document.querySelector('${sel}')?.click(); "ok"`);

// 回到主视图（冒烟测试停在设置页），查 apple 出词典卡
await click("#btnBack"); await sleep(300);
clip("apple"); await sleep(1600);
{
  const s = await P();
  rec("R1", "发布版默认：品牌译雀 + 标题译雀 + 雾隐 brume", s.brand === "译雀" && s.title === "译雀" && s.on === "brume" && s.stored === "brume" && s.bg === "#E7E3DA" && s.tiles === 8 && s.isDict && s.dictTitle === "apple",
    `brand=${s.brand} | title=${s.title} | on=${s.on} | bg=${s.bg} | tiles=${s.tiles} | 词典卡=${s.dictTitle}`);
  await shot("01-main-zh-brume");
}
// 设置页外观：8 配色卡
await click("#btnSettings"); await sleep(500);
await ev(`document.getElementById("schemeGrid").scrollIntoView({block:"center"}); "ok"`); await sleep(300);
{
  const s = await P();
  rec("R2", "设置页：配色方案标签 + 8 卡 + 雾隐选中 + 无密钥", s.themeLabel === "配色方案" && s.tiles === 8 && s.on === "brume" && s.keyEmpty && s.modes.filter(m => m === "浅").length === 5 && s.modes.filter(m => m === "深").length === 3,
    `标签=${s.themeLabel} | tiles=${s.tiles} | on=${s.on} | keyEmpty=${s.keyEmpty} | 浅深=${s.modes.join("/")}`);
  await shot("02-settings-zh-brume");
}
// 切英文：品牌/标题 Sparrow，标签 Color scheme，浅深→Light/Dark
await click('#langSeg button[data-lang="en"]'); await sleep(500);
{
  const s = await P();
  rec("R3", "英文：品牌/标题 Sparrow + Color scheme + Light/Dark", s.brand === "Sparrow" && s.title === "Sparrow" && s.themeLabel === "Color scheme" && s.modes.includes("Light") && s.modes.includes("Dark"),
    `brand=${s.brand} | title=${s.title} | 标签=${s.themeLabel} | modes=${s.modes.join("/")}`);
  await shot("03-settings-en-sparrow");
}
await click('#langSeg button[data-lang="zh"]'); await sleep(400);
// 切墨玉 onyx（深色）验证令牌路由，回主视图截图
await click('.scheme-tile[data-id="onyx"]'); await sleep(500);
{
  const s = await P();
  rec("R4", "墨玉 onyx：bg #1E2422 + accent #86B7A6 + 选中/存储 onyx", s.bg === "#1E2422" && s.accent === "#86B7A6" && s.on === "onyx" && s.stored === "onyx",
    `bg=${s.bg} | accent=${s.accent} | accentFg=${s.accentFg} | on=${s.on} | stored=${s.stored}`);
}
await click("#btnBack"); await sleep(400);
await shot("04-main-zh-onyx-dark");
// 还原雾隐
await click("#btnSettings"); await sleep(400);
await click('.scheme-tile[data-id="brume"]'); await sleep(400);
await click("#btnBack"); await sleep(400);
{
  const s = await P();
  rec("R5", "还原雾隐 brume（交付默认）", s.on === "brume" && s.stored === "brume" && s.bg === "#E7E3DA" && s.brand === "译雀" && s.keyEmpty,
    `on=${s.on} | stored=${s.stored} | bg=${s.bg} | brand=${s.brand} | keyEmpty=${s.keyEmpty}`);
  await shot("05-restored-zh-brume");
}
writeFileSync("tests/release-verify-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
console.log(`\n发布版 UI 验证：${pass}/${results.length}`);
ws.close();
if (pass !== results.length) process.exitCode = 1;