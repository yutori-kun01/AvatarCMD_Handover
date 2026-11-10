// API ルート共通: 例外を JSON エラーに変換する
import { NextResponse } from "next/server";
import { ApiError, ConfigError } from "@avatar-cmd/integrations";
import { withUsageContext } from "@avatar-cmd/integrations/server";
import { randomUUID } from "node:crypto";
import { guardApi, isPublicApi } from "./guard";

/**
 * 例外を JSON のエラーにする。
 * 想定外のエラー（DB・内部の不具合）の詳細はサーバーのログにだけ残し、ログイン前に呼べる API では
 * 「照会番号」だけを返す（内部のパス・ライブラリ名などを攻撃者に教えない）。ログイン済みの管理者には詳細も返す。
 */
export function jsonError(e: unknown, opts: { detailed?: boolean } = {}) {
  if (e instanceof ConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ApiError) {
    if (!opts.detailed) return NextResponse.json({ error: `${e.platform} API エラー (${e.status})` }, { status: 502 });
    return NextResponse.json({ error: `${e.platform} API エラー (${e.status}): ${e.body.slice(0, 500)}` }, { status: 502 });
  }
  const ref = randomUUID().slice(0, 8);
  console.error(`[api] error ${ref}:`, e);
  if (!opts.detailed) return NextResponse.json({ error: `サーバーでエラーが起きました（照会番号: ${ref}）` }, { status: 500 });
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status: 500 });
}

/**
 * 管理画面の API。ここから呼んだ外部 API の使用量は「手動」として台帳に記録される（自動化ルールの実行などは内側で上書き）。
 * middleware の確認に加えて、ここでも DB のセッションと他サイトからの書き込みを確かめる（lib/guard.ts）。
 */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    let detailed = false;
    try {
      const req = args[0];
      if (!(req instanceof Request)) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });
      const denied = await guardApi(req);
      if (denied) return denied;
      // ログインが要る API（＝ログイン済みの管理者）だけ、エラーの詳細を返す
      detailed = !isPublicApi(new URL(req.url).pathname);
      return await withUsageContext({ context: "manual" }, () => fn(...args));
    } catch (e) {
      return jsonError(e, { detailed });
    }
  };
}
