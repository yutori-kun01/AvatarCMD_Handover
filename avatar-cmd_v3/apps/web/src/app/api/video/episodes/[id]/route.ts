// 動画パイプライン: エピソードの詳細（GET）と人の操作（POST { action, ... }）
// 承認 A〜D・差し戻し・アップロードした動画の登録など、工程を進める操作はすべてここを通る
import { NextResponse } from "next/server";
import {
  approvePublish,
  approveScript,
  approveTopic,
  descriptionDraft,
  dismissReport,
  getEpisodeView,
  regenerateNarration,
  regenerateTopics,
  renderManifest,
  requestScriptRevision,
  resolveShot,
  reviewStoryboard,
  scriptChecks,
  setEpisodeStatus,
  setRender,
  setShotVideo,
  setThumbnails,
  updateScript,
  updateShotByHuman,
} from "@avatar-cmd/integrations/server";
import { prisma } from "@avatar-cmd/db";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const include = new URL(req.url).searchParams.get("include");
  if (include === "manifest") return NextResponse.json({ manifest: await renderManifest(id) });
  if (include === "description") return NextResponse.json({ description: await descriptionDraft(id) });
  if (include === "checks") {
    const ep = await prisma.videoEpisode.findUnique({ where: { id } });
    if (!ep) return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    return NextResponse.json({ checks: await scriptChecks(ep) });
  }
  return NextResponse.json({ episode: await getEpisodeView(id) });
});

export const POST = route(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const b = (await req.json()) as Record<string, any>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  let episode;
  switch (b.action) {
    case "approveTopic":
      episode = await approveTopic(id, { index: Number(b.index), title: s(b.title), note: s(b.note), targetMinutes: b.targetMinutes ? Number(b.targetMinutes) : undefined });
      break;
    case "regenerateTopics":
      episode = await regenerateTopics(id, s(b.feedback));
      break;
    case "updateScript":
      episode = await updateScript(id, { script: typeof b.script === "string" ? b.script : undefined, title: typeof b.title === "string" ? b.title : undefined, shotlist: b.shotlist });
      break;
    case "updateShot":
      episode = await updateShotByHuman(id, s(b.shotId), b.patch ?? {});
      break;
    case "requestScriptRevision":
      episode = await requestScriptRevision(id, s(b.feedback));
      break;
    case "approveScript":
      episode = await approveScript(id, { note: s(b.note) });
      break;
    case "regenerateNarration":
      episode = await regenerateNarration(id);
      break;
    case "reviewStoryboard":
      episode = await reviewStoryboard(id, Array.isArray(b.decisions) ? b.decisions : []);
      break;
    case "resolveShot":
      episode = await resolveShot(id, s(b.shotId), { action: b.resolve === "regenerate" ? "regenerate" : "accept", note: s(b.note) });
      break;
    case "setShotVideo":
      episode = await setShotVideo(id, s(b.shotId), { media: b.media, switchToPseudo: b.switchToPseudo === true });
      break;
    case "setRender":
      episode = await setRender(id, s(b.target), b.media ?? null);
      break;
    case "setThumbnails":
      episode = await setThumbnails(id, { add: b.add, remove: typeof b.remove === "string" ? b.remove : undefined, regenerate: typeof b.regenerate === "string" ? b.regenerate : undefined });
      break;
    case "approvePublish":
      episode = await approvePublish(id, b.plan);
      break;
    case "pause":
    case "resume":
    case "cancel":
      episode = await setEpisodeStatus(id, b.action);
      break;
    case "dismissReport":
      episode = await dismissReport(id);
      break;
    default:
      return NextResponse.json({ error: `不明な操作です: ${b.action}` }, { status: 400 });
  }
  return NextResponse.json({ episode });
});
