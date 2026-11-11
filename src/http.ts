import { invoke } from "@tauri-apps/api/core";

export interface HttpReply {
  status: number;
  body: string;
}

export interface HttpOptions {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function httpRequest(options: HttpOptions): Promise<HttpReply> {
  return invoke<HttpReply>("http_request", {
    req: {
      method: options.method,
      url: options.url,
      headers: options.headers ?? {},
      body: options.body ?? null,
      timeout_ms: options.timeoutMs ?? null,
    },
  });
}
