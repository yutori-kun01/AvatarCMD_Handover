// アバターのエクスポート: 選べるアバター・クライアントの一覧（GET）・ファイルのダウンロード（POST）
// 運用側のノウハウ（プラットフォームの傾向）と接続情報・秘密は含めない（export.ts）
import { NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import { currentSchemaVersion, EXPORT_FILE_SUFFIX, EXPORT_POLICY, exportAvatars } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const avatars = await prisma.avatar.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, clientLabel: true } });
  const clients = new Map<string, number>();
  for (const a of avatars) if (a.clientLabel) clients.set(a.clientLabel, (clients.get(a.clientLabel) ?? 0) + 1);
  return NextResponse.json({
    avatars,
    clients: [...clients].map(([label, count]) => ({ label, count })),
    schemaVersion: await currentSchemaVersion(),
    excluded: Object.entries(EXPORT_POLICY).flatMap(([model, p]) => (p.include ? [] : [{ model, label: p.label, reason: p.reason }])),
  });
});

export const POST = route(async (req: Request) => {
  const b = (await req.json()) as { avatarIds?: string[]; clientLabel?: string; includeMedia?: boolean };
  const { bytes, summary } = await exportAvatars({ avatarIds: b.avatarIds, clientLabel: b.clientLabel, includeMedia: b.includeMedia !== false });
  const date = new Date().toISOString().slice(0, 10);
  const base = (b.clientLabel?.trim() || summary.avatars.join("_")).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "avatars";
  const name = `avatar-cmd-${base}-${date}${EXPORT_FILE_SUFFIX}`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="avatar-cmd-export-${date}${EXPORT_FILE_SUFFIX}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-export-summary": encodeURIComponent(JSON.stringify(summary)),
      "cache-control": "no-store",
    },
  });
});
