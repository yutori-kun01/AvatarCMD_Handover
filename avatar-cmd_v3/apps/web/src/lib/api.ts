// API ルート共通: 例外を JSON エラーに変換する
import { NextResponse } from "next/server";
import { ApiError, ConfigError } from "@avatar-cmd/integrations";

export function jsonError(e: unknown) {
  if (e instanceof ConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ApiError) {
    return NextResponse.json({ error: `${e.platform} API エラー (${e.status}): ${e.body.slice(0, 500)}` }, { status: 502 });
  }
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 500 });
}

export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return jsonError(e);
    }
  };
}
