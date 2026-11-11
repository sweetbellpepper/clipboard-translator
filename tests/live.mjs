// 四模型真实 API 冒烟：node tests/live.mjs（需联网 + config.local.json）
// 用真实 buildPayload 构造请求，记录完整请求体与原始响应；密钥不写入结果文件。
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execSync(
  "npx esbuild src/adapters/hy.ts --bundle --format=esm --outfile=.tmp-live-hy.mjs --external:@tauri-apps/api --log-level=silent",
  { stdio: "ignore" },
);
const { buildPayload } = await import("../.tmp-live-hy.mjs");

const cfg = JSON.parse(readFileSync("./config.local.json", "utf8"));
const engine = cfg.engines.find((x) => x.id === "hy") ?? cfg.engines[0];
const URL = engine.baseUrl.replace(/\/+$/, "") + "/chat/completions";

const MODELS = [
  "hy-mt2-pro", "hy-mt2-plus", "hy-mt2-lite",
  "deepseek-v4.1-flash-1017",
];
const CASES = [
  { id: "S1", scene: "英文句子 → 中文", text: "The committee has reached a consensus on the annual budget.", from: "en", to: "zh" },
  { id: "S2", scene: "中文句子 → 英文", text: "过度包装不仅浪费资源，还会误导消费者。", from: "zh", to: "en" },
  { id: "S3", scene: "单个单词 → 中文", text: "model", from: "en", to: "zh" },
];

function noiseFlags(s) {
  const t = (s || "").trim();
  const flags = [];
  if (!t) return ["空内容"];
  if (/^["'“‘]/.test(t) && /["'”’]$/.test(t)) flags.push("成对引号");
  if (/^(译文|翻译|Translation|Here is|The translation)\s*[:：]/i.test(t)) flags.push("解释前缀");
  if (/\n/.test(t)) flags.push("含换行");
  if (/(注[:：]|Note[:：]|解释[:：]|说明[:：])/.test(t)) flags.push("含注释");
  return flags;
}

const results = [];
for (const model of MODELS) {
  for (const c of CASES) {
    const requestBody = buildPayload({ text: c.text, from: c.from, to: c.to }, model);
    const t0 = Date.now();
    let rec = { id: c.id, scene: c.scene, model, input: c.text, requestBody };
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + engine.apiKey, "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(90000),
      });
      const j = await res.json();
      const ch = j.choices?.[0];
      const raw = ch?.message?.content ?? "";
      const noise = noiseFlags(raw);
      rec = {
        ...rec,
        status: res.status,
        responseRaw: raw,
        finish: ch?.finish_reason ?? "",
        promptTokens: j.usage?.prompt_tokens ?? null,
        completionTokens: j.usage?.completion_tokens ?? null,
        hasReasoning: Boolean(ch?.message?.reasoning_content),
        noise,
        latencyMs: Date.now() - t0,
        error: j.error?.message ?? null,
      };
      rec.verdict = res.status === 200 && raw.trim() && rec.finish === "stop" && noise.length === 0 ? "PASS" : "FAIL";
    } catch (err) {
      rec = { ...rec, verdict: "FAIL", error: String(err), latencyMs: Date.now() - t0 };
    }
    results.push(rec);
    console.log(
      `${c.id} ${model.padEnd(30)} ${String(rec.status ?? "-").padEnd(4)} ` +
      `fin=${String(rec.finish ?? "-").padEnd(6)} in=${String(rec.promptTokens ?? "-").padEnd(4)} ` +
      `out=${String(rec.completionTokens ?? "-").padEnd(5)} think=${String(rec.hasReasoning ?? "-").padEnd(6)} ` +
      `${rec.verdict}  | ${String(rec.responseRaw ?? rec.error ?? "").slice(0, 46).replace(/\n/g, " ")}`
    );
  }
}

writeFileSync("tests/live-results.json", JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.verdict === "PASS").length;
const byModel = MODELS.map((m) => {
  const rs = results.filter((r) => r.model === m);
  const out = rs.reduce((n, r) => n + (r.completionTokens ?? 0), 0);
  return { model: m, pass: rs.filter((r) => r.verdict === "PASS").length, total: rs.length, outTokens: out, reasoning: rs.some((r) => r.hasReasoning) };
});
console.log("\n=== 汇总 ===");
byModel.forEach((x) => console.log(`${x.model.padEnd(30)} ${x.pass}/${x.total}  输出合计=${x.outTokens}  思考=${x.reasoning}`));
console.log(`总计 ${pass}/${results.length} PASS；结果写 tests/live-results.json（不含密钥）`);
execSync("node -e \"require('fs').unlinkSync('.tmp-live-hy.mjs')\"", { stdio: "ignore" });
if (pass !== results.length) process.exitCode = 1;
