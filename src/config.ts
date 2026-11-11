import { invoke } from "@tauri-apps/api/core";

export interface EngineConfig {
  id: string;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppConfig {
  defaultEngineId?: string;
  timeoutMs?: number;
  maxChars?: number;
  /** ECDICT 词库文件路径；相对路径按 config.local.json 所在目录解析，缺省为同目录 ecdict.db */
  dictPath?: string;
  engines: EngineConfig[];
}

export interface SettingsPatch {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxChars?: number;
  dictPath?: string;
}

export const DEFAULT_MAX_CHARS = 2000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_BASE_URL = "https://tokenhub.tencentmaas.com/v1";
export const DEFAULT_MODEL = "hy-mt2-pro";
/** 单词详解固定模型：hy-mt2 系列不支持结构化输出，故不做可选。 */
export const DEFAULT_WORD_MODEL = "deepseek-v4.1-flash-1017";

export const MODEL_CHOICES = [
  "hy-mt2-pro",
  "hy-mt2-plus",
  "hy-mt2-lite",
  "deepseek-v4.1-flash-1017",
] as const;

/**
 * 按模型分档的请求超时（毫秒）。以 1950 字符长段落实测为准，取实测峰值约
 * 1.7–2.2 倍留裕量。satisfies 保证新增模型必须补档。
 */
export const MODEL_TIMEOUT_MS = {
  "hy-mt2-pro": 12_000,
  "hy-mt2-plus": 12_000,
  "hy-mt2-lite": 12_000,
  "deepseek-v4.1-flash-1017": 30_000,
} as const satisfies Record<(typeof MODEL_CHOICES)[number], number>;

/** 取该模型的超时；未登记的模型回退到配置里的全局值。 */
export function timeoutForModel(model: string, fallbackMs: number): number {
  return (MODEL_TIMEOUT_MS as Record<string, number>)[model] ?? fallbackMs;
}

function isBlank(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  return v === "" || v.includes("在这里填") || v.toLowerCase().startsWith("your");
}

export function validateEngine(e: EngineConfig): string | null {
  const name = e.displayName || "翻译引擎";
  if (isBlank(e.apiKey)) return `${name} 的 API Key 未填写`;
  if (!e.baseUrl || !/^https?:\/\//.test(e.baseUrl)) return `${name} 的接口地址无效`;
  if (!e.model) return `${name} 缺少模型名`;
  return null;
}

export function maxCharsOf(cfg: AppConfig | null): number {
  const value = cfg?.maxChars ?? DEFAULT_MAX_CHARS;
  return Math.max(200, Math.min(2000, Math.round(value)));
}

export function timeoutOf(cfg: AppConfig | null): number {
  return cfg?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = await invoke<string>("read_config");
  let parsed: AppConfig;
  try {
    parsed = JSON.parse(raw) as AppConfig;
  } catch {
    throw new Error("config.local.json 不是合法的 JSON");
  }
  if (!parsed || !Array.isArray(parsed.engines) || parsed.engines.length === 0) {
    throw new Error("config.local.json 里没有 engines 配置");
  }
  return parsed;
}

export async function configLocation(): Promise<string> {
  return invoke<string>("config_location");
}

/** 只把白名单字段写回 config.local.json，密钥由 Rust 落盘，不进浏览器存储。 */
export async function saveSettings(patch: SettingsPatch): Promise<void> {
  await invoke("save_settings", { patch });
}
