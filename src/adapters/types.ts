/** 一次翻译请求：只保留原文与方向，不再有单词/句子模式之分。 */
export interface TranslateRequest {
  text: string;
  from: string;
  to: string;
}

/** 当前只有一种结果：一段纯译文。 */
export interface TranslateResult {
  kind: "text";
  text: string;
}

export interface Translator {
  readonly id: string;
  readonly displayName: string;
  translate(req: TranslateRequest): Promise<TranslateResult>;
}
