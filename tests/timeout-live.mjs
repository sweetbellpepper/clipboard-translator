// 长段落超时实测：node tests/timeout-live.mjs（需联网 + config.local.json）
// 用真实 buildPayload 与真实分档超时，记录每个模型耗时，判定超时是否足够。
// PROBE=1 时，对超时或余量不足 10s 的模型用 60s 上限补测真实耗时。
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

execSync("npx esbuild src/adapters/hy.ts --bundle --format=esm --outfile=.tmp-t-hy.mjs --external:@tauri-apps/api --log-level=silent", { stdio: "ignore" });
execSync("npx esbuild src/config.ts --bundle --format=esm --outfile=.tmp-t-cfg.mjs --external:@tauri-apps/api --log-level=silent", { stdio: "ignore" });
const { buildPayload } = await import("../.tmp-t-hy.mjs");
const { MODEL_TIMEOUT_MS, MODEL_CHOICES, DEFAULT_MAX_CHARS } = await import("../.tmp-t-cfg.mjs");

const cfg = JSON.parse(readFileSync("./config.local.json", "utf8"));
const engine = cfg.engines.find((x) => x.id === "hy") ?? cfg.engines[0];
const URL = engine.baseUrl.replace(/\/+$/, "") + "/chat/completions";

const TEXT = [
  "The rapid expansion of cloud computing has changed how small teams build and operate software. " +
  "Ten years ago, deploying a service meant purchasing physical machines, configuring networks, " +
  "and hiring people to maintain them around the clock. Today a single engineer can provision a " +
  "complete environment in minutes, scale it to handle a sudden spike in traffic, and shut it " +
  "down when the experiment is over. This flexibility comes with new responsibilities: costs can " +
  "grow quietly, data may cross borders without anyone noticing, and a misconfigured permission " +
  "can expose far more than a single application. Teams that treat infrastructure as a product, " +
  "with clear ownership, measurable budgets, and regular reviews, tend to catch these problems " +
  "early. Those that treat it as an afterthought usually discover them during an incident, when " +
  "the pressure is highest and the options are fewest.",

  "Modern software teams also need to think carefully about how they measure success. A dashboard " +
  "full of green indicators can hide the fact that users are quietly giving up on a feature, " +
  "while a single slow page may matter far more than a dozen minor bugs. Good measurements start " +
  "with a question, not with a metric: what decision will this number change, and who will act on " +
  "it? When the answer is unclear, the honest choice is to stop collecting the data rather than " +
  "to store it indefinitely. The same discipline applies to logs, traces, and error reports. " +
  "They are useful when somebody reads them, expensive when nobody does, and dangerous when they " +
  "contain more detail than the team is prepared to protect.",

  "None of this requires a large organisation or an expensive platform. A short weekly review, a " +
  "clear owner for each service, and a habit of writing down why a decision was made will prevent " +
  "most of the failures that later look like technical accidents. The tools will keep changing; " +
  "the habit of asking whether a change actually helped is what survives.",
].join(" ");

async function call(model, timeoutMs) {
  const body = buildPayload({ text: TEXT, from: "en", to: "zh" }, model);
  const t0 = Date.now();
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + engine.apiKey, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json();
    const ch = j.choices?.[0];
    const raw = ch?.message?.content ?? "";
    return {
      status: res.status, elapsedMs: Date.now() - t0, finish: ch?.finish_reason ?? "",
      inTokens: j.usage?.prompt_tokens ?? null, outTokens: j.usage?.completion_tokens ?? null,
      hasReasoning: Boolean(ch?.message?.reasoning_content),
      translatedChars: Array.from(raw.trim()).length, error: j.error?.message ?? null,
      verdict: res.status === 200 && raw.trim() && ch?.finish_reason === "stop" ? "OK" : "BAD",
    };
  } catch (e) {
    return {
      elapsedMs: Date.now() - t0,
      verdict: /timeout|abort/i.test(String(e)) ? "TIMEOUT" : "ERROR",
      error: String(e),
    };
  }
}

console.log(`长段落长度：${Array.from(TEXT).length} 字符（应用默认上限 ${DEFAULT_MAX_CHARS}，会真实发请求）\n`);

const cases = [];
for (const model of MODEL_CHOICES) {
  const timeoutMs = MODEL_TIMEOUT_MS[model];
  const r = await call(model, timeoutMs);
  const rec = { model, timeoutMs, chars: Array.from(TEXT).length, ...r, marginMs: timeoutMs - r.elapsedMs };
  cases.push(rec);
  console.log(
    `${model.padEnd(30)} 超时=${String(timeoutMs / 1000).padStart(2)}s ` +
    `耗时=${(rec.elapsedMs / 1000).toFixed(1).padStart(5)}s ` +
    `余量=${(rec.marginMs / 1000).toFixed(1).padStart(5)}s ` +
    `${rec.verdict.padEnd(8)} out=${String(rec.outTokens ?? "-").padStart(4)} ` +
    `think=${String(rec.hasReasoning ?? "-").padEnd(5)} 旧15s会超时=${rec.elapsedMs > 15_000}`
  );
}

const probe = [];
if (process.env.PROBE === "1") {
  const need = cases.filter((r) => r.verdict !== "OK" || r.marginMs < r.timeoutMs * 0.3);
  console.log("\n=== 60s 上限补测（PROBE）===");
  for (const c of need) {
    for (let i = 1; i <= 2; i++) {
      const r = await call(c.model, 60_000);
      probe.push({ model: c.model, round: i, ...r });
      console.log(`${c.model.padEnd(30)} #${i} 耗时=${(r.elapsedMs / 1000).toFixed(1)}s ${r.verdict} out=${r.outTokens ?? "-"}`);
    }
  }
}

writeFileSync("tests/timeout-live-results.json", JSON.stringify({ chars: Array.from(TEXT).length, cases, probe }, null, 2));
const ok = cases.filter((r) => r.verdict === "OK").length;
console.log(`\n成功 ${ok}/${cases.length}；结果写 tests/timeout-live-results.json（不含密钥）`);
for (const f of [".tmp-t-hy.mjs", ".tmp-t-cfg.mjs"]) {
  execSync(`node -e "require('fs').unlinkSync('${f}')"`, { stdio: "ignore" });
}
if (ok !== cases.length) process.exitCode = 1;
