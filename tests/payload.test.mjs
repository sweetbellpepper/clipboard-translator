// POST 请求体构造回归：node tests/payload.test.mjs
// 验证定稿方案：单条 user、无 system、不传 response_format、官方默认模板；
// 四个模型共用同一条骨架，只有 model 与 temperature 两个字段不同。
import { execSync } from "node:child_process";
import assert from "node:assert";

execSync(
  "npx esbuild src/adapters/hy.ts --bundle --format=esm --outfile=.tmp-payload-bundle.mjs --external:@tauri-apps/api --log-level=silent",
  { stdio: "ignore" },
);
const { buildPayload } = await import("../.tmp-payload-bundle.mjs");

const TEMPLATE = (text, lang) =>
  `Translate the following text into ${lang}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;

// [模型名, 期望 temperature]：三个 hy-mt2 系列统一 0.7，deepseek 通用模型 0.3
const MODELS = [
  ["hy-mt2-pro", 0.7],
  ["hy-mt2-plus", 0.7],
  ["hy-mt2-lite", 0.7],
  ["deepseek-v4.1-flash-1017", 0.3],
];

const load = (req, model = "hy-mt2-pro") => JSON.parse(buildPayload(req, model));
const sentence = (text, from = "en", to = "zh") => ({ text, from, to });
const FIELDS = ["model", "messages", "stream", "temperature", "max_tokens"];

const cases = [
  ["句子 en→zh：官方默认模板逐字一致", () => {
    const p = load(sentence("The committee has reached a consensus."));
    return p.messages[0].content === TEMPLATE("The committee has reached a consensus.", "Chinese");
  }],
  ["句子 zh→en：语言全称为 English", () => {
    const p = load(sentence("过度包装会误导消费者。", "zh", "en"));
    return p.messages[0].content === TEMPLATE("过度包装会误导消费者。", "English");
  }],
  ["单个单词也走同一条模板（model → Chinese）", () => {
    const p = load(sentence("model"));
    return p.messages[0].content === TEMPLATE("model", "Chinese");
  }],
  ["四个模型都只有一条 user 消息，无 system", () =>
    MODELS.every(([m]) => {
      const p = load(sentence("hello"), m);
      return p.messages.length === 1 && p.messages[0].role === "user" && !("system" in p);
    })],
  ["四个模型都不传 response_format", () =>
    MODELS.every(([m]) => !("response_format" in load(sentence("hello"), m)))],
  ["四个模型 stream=false 且 max_tokens=4096", () =>
    MODELS.every(([m]) => {
      const p = load(sentence("hello"), m);
      return p.stream === false && p.max_tokens === 4096;
    })],
  ["三个 hy-mt2 系列 temperature = 0.7", () =>
    MODELS.slice(0, 3).every(([m]) => load(sentence("hello"), m).temperature === 0.7)],
  ["deepseek 通用模型 temperature = 0.3", () =>
    MODELS.slice(3).every(([m]) => load(sentence("hello"), m).temperature === 0.3)],
  ["model 字段取自配置，原样写入", () =>
    MODELS.every(([m]) => load(sentence("hello"), m).model === m)],
  ["四个模型字段集合恰好 5 个", () => {
    const baseKeys = JSON.stringify([...FIELDS].sort());
    return MODELS.every(([m]) => JSON.stringify(Object.keys(load(sentence("hello"), m)).sort()) === baseKeys);
  }],
  ["所有模型都没有 thinking / stop 字段", () =>
    MODELS.every(([m]) => {
      const p = load(sentence("hello"), m);
      return !("thinking" in p) && !("stop" in p);
    })],
  ["不传 top_p / repetition_penalty / top_k / seed / stop", () =>
    MODELS.every(([m]) => {
      const raw = buildPayload(sentence("hello"), m);
      return !/"top_p"|"repetition_penalty"|"top_k"|"seed"|"stop"/.test(raw);
    })],
  ["请求体不含旧方案的 json_schema / B| / word / maxItems 痕迹", () => {
    const raw = buildPayload(sentence("model"), "hy-mt2-pro");
    return !/json_schema|maxItems|B\\\|\[Source Text\]|word-lean|"mode"/.test(raw);
  }],
  ["原文含换行、中文、引号时只作为模板尾部拼接，不改写", () => {
    const text = '第一行 "quoted"\n第二行';
    const p = load(sentence(text));
    return p.messages[0].content === TEMPLATE(text, "Chinese");
  }],
  ["四个模型除 model / temperature 外请求体逐字相同", () => {
    const base = load(sentence("same text"), MODELS[0][0]);
    return MODELS.slice(1).every(([m]) => {
      const p = load(sentence("same text"), m);
      return JSON.stringify({ ...p, model: base.model, temperature: base.temperature }) ===
        JSON.stringify(base);
    });
  }],
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
console.log(`\nPOST 请求体回归：${pass}/${cases.length}`);
execSync("node -e \"require('fs').unlinkSync('.tmp-payload-bundle.mjs')\"", { stdio: "ignore" });
