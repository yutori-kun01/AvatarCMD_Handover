import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { discardContent, returnToDraft } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";

// 下書きの本文修正 ／ 予約中の投稿の日時変更（scheduledAt）・下書きに戻す（unschedule）
// note の予約公開は、記事を Avatar CMD が保持し、予約の時刻に note へ入稿して公開する。時刻になるまでは日時の変更・取り消しができる
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { text, scheduledAt, unschedule } = (await req.json()) as { text?: string; scheduledAt?: string; unschedule?: boolean };
  const c = await prisma.content.findUniqueOrThrow({ where: { id }, include: { scheduledPost: true } });
  if (unschedule || scheduledAt) {
    if (c.status !== "SCHEDULED" || c.scheduledPost?.status !== "pending") return NextResponse.json({ error: "送信待ちの予約だけ変更できます（送信中・送信済みは変更できません）" }, { status: 400 });
    if (unschedule) {
      if (!(await returnToDraft(id, "予約を取り消して下書きに戻しました"))) return NextResponse.json({ error: "送信が始まったため戻せませんでした" }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    const at = new Date(scheduledAt!);
    if (Number.isNaN(at.getTime())) return NextResponse.json({ error: "予約日時が不正です" }, { status: 400 });
    if (at.getTime() < Date.now() + 60_000) return NextResponse.json({ error: "予約日時は 1 分以上先を指定してください" }, { status: 400 });
    // worker が取り出していない（pending の）ときだけ変える
    const r = await prisma.scheduledPost.updateMany({ where: { contentId: id, status: "pending" }, data: { scheduledAt: at, nextAttemptAt: null } });
    if (!r.count) return NextResponse.json({ error: "送信が始まったため変更できませんでした" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (c.status !== "DRAFT") return NextResponse.json({ error: "下書きのみ編集できます" }, { status: 400 });
  if (!text?.trim()) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
  await prisma.content.update({ where: { id }, data: { content: text } });
  return NextResponse.json({ ok: true });
});

// 未送信（下書き・予約中・失敗）の投稿のみ削除できる。下書きの削除は判定ログに「却下」として残す
export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await discardContent(id);
  return NextResponse.json({ ok: true });
});
