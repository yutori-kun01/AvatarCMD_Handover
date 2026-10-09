import type { MediaFile, PublishContext, SystemConfig } from "../src/types";
import { __setPollScale } from "../src/http";

__setPollScale(0);

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  json?: any;
  form?: Record<string, string>;
}

type Handler = (c: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | undefined;

/** globalThis.fetch を差し替え、[method, URL正規表現, 応答] のルートで応答する */
export function mockFetch(routes: [string, RegExp, Handler | object][]) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    if (input instanceof Request) {
      init = { method: input.method, headers: input.headers, body: new Uint8Array(await input.arrayBuffer()), ...init };
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const raw = init.body;
    const isText = /json|x-www-form-urlencoded|text\/|multipart\/related/.test(headers["content-type"] ?? "");
    const body =
      typeof raw === "string" ? raw
      : raw instanceof Uint8Array || raw instanceof ArrayBuffer ? (isText ? new TextDecoder().decode(raw) : `<${raw.byteLength} bytes>`)
      : raw ? String(raw) : "";
    const call: Call = { method, url, headers, body };
    if (headers["content-type"]?.includes("json") && body) call.json = JSON.parse(body);
    if (headers["content-type"]?.includes("x-www-form-urlencoded")) call.form = Object.fromEntries(new URLSearchParams(body));
    calls.push(call);
    for (const [m, re, h] of routes) {
      if (m === method && re.test(url)) {
        const r = typeof h === "function" ? (h as Handler)(call) ?? {} : { json: h };
        const text = r.text ?? (r.json !== undefined ? JSON.stringify(r.json) : "");
        return new Response(text, { status: r.status ?? 200, headers: { ...(r.json !== undefined ? { "content-type": "application/json" } : {}), ...r.headers } });
      }
    }
    console.error(`[mockFetch] no route for ${method} ${url}`);
    return new Response(`no route for ${method} ${url}`, { status: 599 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export const system: SystemConfig = { appUrl: "https://cmd.example.com", metaGraphVersion: "v26.0", linkedinVersion: "202604" };

export function ctx(partial: Partial<PublishContext> = {}): PublishContext {
  return {
    app: {},
    credentials: { accessToken: "TOKEN" },
    settings: {},
    account: { accountId: "acct", accountName: "@me" },
    system,
    ...partial,
  };
}

export function media(mimeType: string, size = 10, name = "a"): MediaFile {
  const ext = mimeType.split("/")[1];
  return {
    url: `https://cmd.example.com/media/${name}.${ext}`,
    mimeType,
    filename: `${name}.${ext}`,
    size,
    load: async () => new Uint8Array(size),
  };
}

/** Claude Messages API のストリーミング応答（SSE）を作る */
export function claudeSse(model: string, text: string, stopReason = "end_turn") {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
    ev("content_block_stop", { index: 0 }),
    ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev("message_stop", {}),
  ].join("");
}
