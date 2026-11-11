// 设置页截图：确认单词详解开关已移除、词典路径与状态仍在。需窗口带 CDP 9222 启动。
import { writeFileSync } from "node:fs";

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page" && t.url.includes("1420")) || list.find((t) => t.type === "page");
if (!page) { console.log("NO_PAGE"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await ev(`document.getElementById("btnSettings").click(); "ok"`);
const t0 = Date.now();
let status = "";
while (Date.now() - t0 < 8000) {
  status = await ev(`document.getElementById("dictStatus").textContent`);
  if (/词典已加载|未找到/.test(status ?? "")) break;
  await sleep(300);
}
console.log(await ev(`JSON.stringify({hasDictToggle:!!document.getElementById("dictToggle"),dictHint:document.getElementById("dictHint").textContent,dictStatus:document.getElementById("dictStatus").textContent})`));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("tests/shot-settings-no-toggle.png", Buffer.from(shot.result.data, "base64"));
await ev(`(()=>{const b=document.getElementById("settingsBody");b.scrollTop=b.scrollHeight;return b.scrollTop})()`);
await sleep(400);
const shot2 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("tests/shot-settings-no-toggle-bottom.png", Buffer.from(shot2.result.data, "base64"));
await ev(`document.getElementById("btnBack").click(); "ok"`);
console.log("SAVED tests/shot-settings-no-toggle.png + bottom");
ws.close();