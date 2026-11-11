import { httpRequest } from "../http";
import { DEFAULT_WORD_MODEL, timeoutForModel } from "../config";
import type { EngineConfig } from "../config";

/**
 * 单词详解：本地词典（ECDICT）优先，未命中走 AI JSON 模式兜底。
 * 兜底固定 deepseek-v4.1-flash-1017（hy-mt2 系列不支持结构化输出）；
 * 凭证复用当前引擎的 apiKey / baseUrl，只换 model 与请求体。
 */
export const WORD_FALLBACK_MODEL = DEFAULT_WORD_MODEL;

/** 单个英文单词：纯字母，允许词内撇号与连字符（don't / well-known）。 */
const WORD_RE = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;

export function isSingleEnglishWord(text: string): boolean {
  return text.length > 0 && text.length <= 40 && WORD_RE.test(text);
}

export interface WordSense {
  pos: string;
  def: string;
}

/** 归一化后的词典卡数据，本地词典与 AI 兜底产出同一形状。 */
export interface WordCard {
  source: "dict" | "lemma" | "cache" | "ai";
  word: string;
  phonetic?: string;
  senses: WordSense[];
  example?: string;
  exampleCn?: string;
  /** 查询词是变形时的原形（如 better → good） */
  lemma?: string;
  collins?: number;
  oxford?: boolean;
  tags?: string[];
}

/** ECDICT stardict 行的原始字段（Rust dict_lookup 原样透传）。 */
export interface RawDictEntry {
  word: string;
  phonetic?: string;
  definition?: string;
  translation?: string;
  pos?: string;
  collins?: number;
  oxford?: number;
  tag?: string;
  frq?: number;
  bnc?: number;
  exchange?: string;
}

export interface DictLookupReply {
  found: boolean;
  source?: "dict" | "lemma" | "cache";
  lemma?: string;
  entry?: RawDictEntry | WordCard;
}

/** 释义行的词性前缀：n. vt. adj. 等；[医] 之类领域标记不算词性。 */
const POS_RE = /^((?:[a-z]{1,6}\.\s?)+)\s*/;

/**
 * 把 ECDICT translation 字段（每行一条，词性前缀不统一）确定性归一化为
 * 按词性分组的释义。无前缀的行并入上一条；同词性多行用「；」合并。
 */
export function normalizeTranslation(translation: string): WordSense[] {
  const senses: WordSense[] = [];
  for (const rawLine of translation.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = POS_RE.exec(line);
    if (m) {
      const pos = m[1].trim();
      const def = line.slice(m[0].length).trim();
      const existing = senses.find((s) => s.pos === pos);
      if (existing) existing.def = `${existing.def}；${def}`;
      else senses.push({ pos, def });
    } else if (senses.length > 0) {
      senses[senses.length - 1].def += `；${line}`;
    } else {
      senses.push({ pos: "", def: line });
    }
  }
  return senses;
}

/** 本地词典行 → 词典卡。 */
export function cardFromDictEntry(
  entry: RawDictEntry,
  source: "dict" | "lemma" | "cache",
  lemma?: string,
): WordCard {
  const card: WordCard = {
    source,
    word: entry.word,
    senses: normalizeTranslation(entry.translation ?? ""),
    lemma,
  };
  if (entry.phonetic) card.phonetic = entry.phonetic;
  if (entry.collins) card.collins = entry.collins;
  if (entry.oxford) card.oxford = true;
  if (entry.tag) card.tags = entry.tag.split(/\s+/).filter(Boolean);
  if (card.senses.length === 0 && entry.definition) {
    card.senses = [{ pos: "", def: entry.definition.split("\n").join("；") }];
  }
  return card;
}

/**
 * 兜底请求体。与句子翻译（hy.ts）完全独立，互不影响：
 * - response_format json_object：TokenHub DeepSeek 指南确认支持，保证输出合法 JSON；
 *   指南同时要求消息里明确出现「输出 JSON」指令，否则可能返回空内容，prompt 里已包含。
 * - temperature 0：词典义项要确定性输出，不要发挥。
 * - max_tokens 2048：单词卡正常输出 <400 token，留 5 倍余量兼作成本刹车。
 * - json_object 只保证「是合法 JSON」，不保证字段齐全，所以有 validateWordJson 再校验。
 */
export function buildWordPayload(word: string): string {
  const prompt =
    `你是英汉词典。请为英文单词「${word}」输出一个 JSON 对象，字段如下：\n` +
    `{"word":"单词本身","phonetic":"英式国际音标，不含斜杠","senses":[{"pos":"词性缩写，如 n. / vt. / adj.","def":"中文释义"}],"example":"一个自然常用的英文例句","example_cn":"例句的中文翻译"}\n` +
    `要求：senses 覆盖该单词全部常用词性和释义，按常用程度排序；` +
    `只输出 JSON 本身，不要 markdown 代码块，不要任何其他文字。`;
  return JSON.stringify({
    model: WORD_FALLBACK_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    temperature: 0,
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });
}

/** 校验 AI 返回的 JSON 是否具备词典卡所需的最小形状。 */
export function validateWordJson(value: unknown): value is WordCard {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.word !== "string" || !v.word.trim()) return false;
  if (!Array.isArray(v.senses) || v.senses.length === 0) return false;
  return v.senses.every(
    (s) =>
      typeof s === "object" && s !== null &&
      typeof (s as Record<string, unknown>).def === "string" &&
      String((s as Record<string, unknown>).def).trim() !== "",
  );
}

/** 把校验通过的 AI JSON 整理成词典卡（容忍 pos/example 缺失，example_cn → exampleCn）。 */
function cardFromAiJson(raw: WordCard): WordCard {
  const v = raw as unknown as Record<string, unknown>;
  const str = (x: unknown): string | undefined =>
    typeof x === "string" && x.trim() ? x.trim() : undefined;
  return {
    source: "ai",
    word: String(v.word).trim(),
    phonetic: str(v.phonetic),
    senses: (v.senses as Array<Record<string, unknown>>).map((s) => ({
      pos: typeof s.pos === "string" ? s.pos.trim() : "",
      def: String(s.def).trim(),
    })),
    example: str(v.example),
    exampleCn: str(v.example_cn) ?? str(v.exampleCn),
  };
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string; code?: string };
}

/**
 * AI 兜底查词：POST → 解析 → 形状校验，失败自动重试 1 次（temperature 0 下偶发
 * 输出不合形状的概率很低）。两次都失败则抛错，由调用方降级回句子翻译。
 */
export async function aiWordLookup(
  engine: EngineConfig,
  word: string,
  fallbackTimeoutMs: number,
): Promise<WordCard> {
  const endpoint = `${engine.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = timeoutForModel(WORD_FALLBACK_MODEL, fallbackTimeoutMs);
  let lastError = "单词详解失败";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await httpRequest({
      method: "POST",
      url: endpoint,
      headers: {
        Authorization: `Bearer ${engine.apiKey}`,
        "Content-Type": "application/json",
      },
      body: buildWordPayload(word),
      timeoutMs,
    });
    let parsed: ChatResponse;
    try {
      parsed = JSON.parse(reply.body) as ChatResponse;
    } catch {
      lastError = `响应不是 JSON（HTTP ${reply.status}）`;
      continue;
    }
    if (parsed.error) {
      // 402 = 模型未在 TokenHub 控制台激活；这类错误重试也不会好，直接抛出
      throw new Error(`${parsed.error.code ?? "Error"}：${parsed.error.message ?? "服务返回错误"}`);
    }
    if (reply.status >= 400) {
      throw new Error(`HTTP ${reply.status}（请检查 API Key 与接口地址）`);
    }
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (!content) {
      lastError = choice?.finish_reason === "length" ? "模型输出被截断" : "响应内容为空";
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      lastError = "模型输出不是合法 JSON";
      continue;
    }
    if (validateWordJson(json)) return cardFromAiJson(json);
    lastError = "模型输出缺少必要字段（word / senses）";
  }
  throw new Error(lastError);
}
