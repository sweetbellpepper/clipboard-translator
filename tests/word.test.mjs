// 单词详解回归：node tests/word.test.mjs（离线）
// 覆盖：单词判定、兜底请求体逐字回归、ECDICT 释义归一化、AI JSON 形状校验。
import { execSync } from "node:child_process";
import assert from "node:assert";

execSync(
  "npx esbuild src/adapters/word.ts --bundle --format=esm --outfile=.tmp-word-bundle.mjs --external:@tauri-apps/api --log-level=silent",
  { stdio: "ignore" },
);
const {
  isSingleEnglishWord,
  buildWordPayload,
  normalizeTranslation,
  cardFromDictEntry,
  validateWordJson,
  WORD_FALLBACK_MODEL,
} = await import("../.tmp-word-bundle.mjs");

const load = (word) => JSON.parse(buildWordPayload(word));

const cases = [
  /* ---- 单词判定 ---- */
  ["单个纯字母单词判定为单词", () => isSingleEnglishWord("apple")],
  ["词内撇号与连字符算单词（don't / well-known）", () =>
    isSingleEnglishWord("don't") && isSingleEnglishWord("well-known")],
  ["带空格的输入不是单词", () => !isSingleEnglishWord("an apple")],
  ["句子不是单词", () => !isSingleEnglishWord("The committee has reached a consensus.")],
  ["含数字/标点的输入不是单词", () => !isSingleEnglishWord("apple2") && !isSingleEnglishWord("apple.")],
  ["空字符串不是单词", () => !isSingleEnglishWord("")],
  ["超过 40 字符不算单词", () => !isSingleEnglishWord("a".repeat(41))],

  /* ---- 兜底请求体 ---- */
  ["兜底固定模型为 deepseek-v4.1-flash-1017", () => load("apple").model === WORD_FALLBACK_MODEL],
  ["response_format 为 json_object", () =>
    JSON.stringify(load("apple").response_format) === '{"type":"json_object"}'],
  ["temperature = 0（词典义项要确定性输出）", () => load("apple").temperature === 0],
  ["stream=false，max_tokens=2048", () =>
    load("apple").stream === false && load("apple").max_tokens === 2048],
  ["单条 user 消息、无 system", () => {
    const p = load("apple");
    return p.messages.length === 1 && p.messages[0].role === "user";
  }],
  ["prompt 含待查单词与明确的 JSON 输出指令（DeepSeek JSON 模式硬性要求）", () => {
    const content = load("serendipity").messages[0].content;
    return content.includes("serendipity") && content.includes("JSON") && content.includes("senses");
  }],

  /* ---- ECDICT 释义归一化 ---- */
  ["标准词性行按词性分组", () => {
    const s = normalizeTranslation("n. 苹果, 苹果树\nvt. 煽动, 刺激");
    return s.length === 2 && s[0].pos === "n." && s[0].def === "苹果, 苹果树" && s[1].pos === "vt.";
  }],
  ["同词性多行用「；」合并", () => {
    const s = normalizeTranslation("n. 苹果\nn. 苹果树");
    return s.length === 1 && s[0].def === "苹果；苹果树";
  }],
  ["无前缀行并入上一条释义", () => {
    const s = normalizeTranslation("n. 苹果\n一种水果");
    return s.length === 1 && s[0].def === "苹果；一种水果";
  }],
  ["领域标记 [医] 不识别为词性，整行保留", () => {
    const s = normalizeTranslation("[医] 动脉");
    return s.length === 1 && s[0].pos === "" && s[0].def === "[医] 动脉";
  }],
  ["首行无前缀也能成组", () => {
    const s = normalizeTranslation("再见\n告别");
    return s.length === 1 && s[0].pos === "" && s[0].def === "再见；告别";
  }],
  ["词典行 → 词典卡：音标、柯林斯、tag 全带上", () => {
    const card = cardFromDictEntry(
      { word: "apple", phonetic: "ˈæpl", translation: "n. 苹果", collins: 2, oxford: 1, tag: "zk cet4" },
      "dict",
    );
    return card.word === "apple" && card.phonetic === "ˈæpl" && card.collins === 2
      && card.oxford === true && card.tags.join(",") === "zk,cet4" && card.senses.length === 1;
  }],
  ["translation 为空时退回英文 definition", () => {
    const card = cardFromDictEntry({ word: "hmm", definition: "int. used to express doubt", translation: "" }, "dict");
    return card.senses.length === 1 && card.senses[0].def.includes("doubt");
  }],

  /* ---- AI JSON 形状校验 ---- */
  ["合法词典 JSON 通过校验", () =>
    validateWordJson({ word: "apple", senses: [{ pos: "n.", def: "苹果" }] })],
  ["缺 word 不通过", () => !validateWordJson({ senses: [{ pos: "n.", def: "苹果" }] })],
  ["senses 为空数组不通过", () => !validateWordJson({ word: "apple", senses: [] })],
  ["senses 里有空 def 不通过", () => !validateWordJson({ word: "apple", senses: [{ pos: "n.", def: "  " }] })],
  ["非对象不通过", () => !validateWordJson("apple") && !validateWordJson(null)],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    assert.strictEqual(fn(), true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${err.message.split("\n")[0]}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
