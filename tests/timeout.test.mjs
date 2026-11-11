// 按模型分档超时的回归：node tests/timeout.test.mjs
import { execSync } from "node:child_process";
import assert from "node:assert";

execSync(
  "npx esbuild src/config.ts --bundle --format=esm --outfile=.tmp-timeout-bundle.mjs --external:@tauri-apps/api --log-level=silent",
  { stdio: "ignore" },
);
const { MODEL_TIMEOUT_MS, timeoutForModel, MODEL_CHOICES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_CHARS,
  DEFAULT_WORD_MODEL, DEFAULT_MODEL, maxCharsOf } =
  await import("../.tmp-timeout-bundle.mjs");

const MT2 = ["hy-mt2-pro", "hy-mt2-plus", "hy-mt2-lite"];

const cases = [
  ["三个 hy-mt2 都是 12000ms（2000 字符标准）", () => MT2.every((m) => MODEL_TIMEOUT_MS[m] === 12_000)],
  ["deepseek 是 30000ms", () => MODEL_TIMEOUT_MS["deepseek-v4.1-flash-1017"] === 30_000],
  ["四个可选模型都有超时映射", () => MODEL_CHOICES.every((m) => typeof MODEL_TIMEOUT_MS[m] === "number")],
  ["映射表没有多余条目", () => Object.keys(MODEL_TIMEOUT_MS).length === MODEL_CHOICES.length],
  ["未知模型回退到配置值", () => timeoutForModel("unknown-model", 12_345) === 12_345],
  ["已知模型不受配置值影响", () => timeoutForModel("deepseek-v4.1-flash-1017", 1_000) === 30_000 && timeoutForModel("hy-mt2-pro", 99_000) === 12_000],
  ["全部落在 Rust 的 clamp 范围 [1000, 120000] 内", () =>
    Object.values(MODEL_TIMEOUT_MS).every((v) => v >= 1_000 && v <= 120_000)],
  ["每个模型对 1950 字符实测峰值都留有余量", () =>
    MODEL_TIMEOUT_MS["hy-mt2-plus"] > 5_400 && MODEL_TIMEOUT_MS["deepseek-v4.1-flash-1017"] > 11_600],
  ["默认字符上限为 2000", () => DEFAULT_MAX_CHARS === 2_000],
  ["全局兜底仍为 15000ms", () => DEFAULT_TIMEOUT_MS === 15_000],
  ["单词兜底固定模型为 deepseek-v4.1-flash-1017", () => DEFAULT_WORD_MODEL === "deepseek-v4.1-flash-1017"],
  ["长文本初次默认模型为 hy-mt2-pro", () => DEFAULT_MODEL === "hy-mt2-pro"],
  ["maxChars 超范围夹到 200–2000", () => maxCharsOf({ maxChars: 5000 }) === 2000 && maxCharsOf({ maxChars: 100 }) === 200],
];

let pass = 0;
for (const [name, check] of cases) {
  try {
    assert.ok(check(), "断言失败");
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}  →  ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n超时分档回归：${pass}/${cases.length}`);
execSync("node -e \"require('fs').unlinkSync('.tmp-timeout-bundle.mjs')\"", { stdio: "ignore" });
