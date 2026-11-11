import { validateEngine, timeoutForModel, DEFAULT_TIMEOUT_MS } from "../config";
import type { AppConfig } from "../config";
import { createHyTranslator } from "./hy";
import type { Translator } from "./types";

/** 只有一个适配器：腾讯 TokenHub 大模型。超时按引擎模型分档。 */
export function buildTranslators(cfg: AppConfig): Map<string, Translator> {
  const map = new Map<string, Translator>();
  const fallbackMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  cfg.engines.forEach((engine) => {
    if (validateEngine(engine)) return;
    map.set(engine.id, createHyTranslator(engine, timeoutForModel(engine.model, fallbackMs)));
  });
  return map;
}
