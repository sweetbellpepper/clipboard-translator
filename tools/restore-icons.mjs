// 还原二进制图标：仓库以 base64 文本存放图标（tools/assets.b64.json），
// npm install 的 postinstall 自动调用本脚本写回 src-tauri/icons/ 与原型源图。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = JSON.parse(readFileSync(join(root, "tools", "assets.b64.json"), "utf8"));
let n = 0;
for (const [rel, b64] of Object.entries(assets)) {
  const dest = join(root, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(b64, "base64"));
  n += 1;
}
console.log(`restore-icons: wrote ${n} binary assets`);