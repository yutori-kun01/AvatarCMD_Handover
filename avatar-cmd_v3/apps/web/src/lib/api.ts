// API ルート共通: 例外を JSON エラーに変換する
import { NextResponse } from "next/server";
import { ApiError, ConfigError } from "@avatar-cmd/integrations";
import { withUsageContext } from "@avatar-cmd/integrations/server";

export function jsonError(e: unknown) {
  if (e instanceof ConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ApiError) {
    return NextResponse.json({ error: `${e.platform} API エラー (${e.status}): ${e.body.slice(0, 500)}` }, { status: 502 });
  }
  console.error(e);
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** 管理画面の API。ここから呼んだ外部 API の使用量は「手動」として台帳に記録される（自動化ルールの実行などは内側で上書き） */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await withUsageContext({ context: "manual" }, () => fn(...args));
    } catch (e) {
      return jsonError(e);
    }
  };
}
