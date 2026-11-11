import type { EngineConfig } from "../config";
import { httpRequest } from "../http";
import type { TranslateRequest, TranslateResult, Translator } from "./types";

/**
 * TokenHub 句子翻译：一条请求骨架通用于四个模型，只换 model 与 temperature。
 *
 * - 单条 user、无 system：hy-mt2 官方「模型没有默认 system_prompt」；
 *   deepseek 执行这条明确指令也无需 system。
 * - 官方 Default Translation 模板原文，语言用全称 Chinese / English。
 * - 不传 response_format（平台默认 {"type":"text"}）。
 * - 不传 top_p：官方字段文档「一般只调 temperature 或 top_p 之一」；
 *   pro 官方推荐的 top_p 1.0 正是平台默认值，不传即等价。
 * - 不传 repetition_penalty / top_k：官方明确列为客户端传了会被静默忽略的字段。
 * - max_tokens 4096：等于 hy-mt2 系列官方最大输出 4k，同时是输出长度刹车。
 */
const MT2_TEMPERATURE = 0.7;
const GENERAL_TEMPERATURE = 0.3;
const MT2_MODELS = new Set(["hy-mt2-pro", "hy-mt2-plus", "hy-mt2-lite"]);

/** hy-mt2 官方 Default Translation 模板原文。 */
function sentencePrompt(text: string, targetLang: string): string {
  return `Translate the following text into ${targetLang}. Note that you should only output the translated result without any additional explanation:\n\n${text}`;
}

/** 请求体集中在这里构造，便于逐字核对。 */
export function buildPayload(req: TranslateRequest, model: string): string {
  const targetLang = req.to === "zh" || req.to === "zh-CN" ? "Chinese" : "English";
  const payload: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: sentencePrompt(req.text, targetLang) }],
    stream: false,
    temperature: MT2_MODELS.has(model) ? MT2_TEMPERATURE : GENERAL_TEMPERATURE,
    max_tokens: 4096,
  };
  return JSON.stringify(payload);
}

interface ChatChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string; code?: string };
}

export function createHyTranslator(cfg: EngineConfig, timeoutMs: number): Translator {
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    id: cfg.id,
    displayName: cfg.displayName,
    async translate(req: TranslateRequest): Promise<TranslateResult> {
      const reply = await httpRequest({
        method: "POST",
        url: endpoint,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: buildPayload(req, cfg.model),
        timeoutMs,
      });

      let parsed: ChatResponse;
      try {
        parsed = JSON.parse(reply.body) as ChatResponse;
      } catch {
        throw new Error(`响应不是 JSON（HTTP ${reply.status}）`);
      }
      // 服务端错误原文照显，不做中文映射
      if (parsed.error) {
        const code = parsed.error.code ?? "Error";
        throw new Error(`${code}：${parsed.error.message ?? "翻译服务返回错误"}`);
      }
      if (reply.status >= 400) {
        throw new Error(`HTTP ${reply.status}（请检查 API Key 与接口地址）`);
      }
      const choice = parsed.choices?.[0];
      const content = choice?.message?.content?.trim();
      if (!content) throw new Error("响应里没有译文（choices[0].message.content 为空）");
      if (choice?.finish_reason === "length") {
        throw new Error("模型输出超出长度上限，已拦截（建议点重试或缩短原文）");
      }
      // 响应只做 trim，不做引号剥离、前缀清洗或任何结构化解析
      return { kind: "text", text: content };
    },
  };
}
