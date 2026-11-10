// ================================================
// アバターのエクスポート / 取り込み — 運用代行の終了時に、クライアントのアバターのデータだけを別のサーバーへ引き渡す
// ================================================
// 設計書: Reports/platform_insights_and_export.md
// ・含めるのは「アバターのデータ」（人格・投稿・指標・ナレッジ・改善の履歴・成長の状態・ルール・画像スタイル・収益）だけ。
// ・含めないもの:
//   - 運用側のノウハウ（PlatformInsight = プラットフォーム × ジャンルの傾向）
//   - 接続情報・秘密（SNS のトークン、開発者アプリ、AI の API キー、アバターのメールアカウント）。移行先で接続し直す
//   - 運用の記録（判定ログ・引用候補・アクティビティ・使用量）と、動画パイプライン（今回は対象外）
// ・どのテーブルをどう扱うかは EXPORT_POLICY に一覧にしている。アバターに紐づくテーブルを増やしたら、ここにも追加すること
//   （追加し忘れはテストで検出する）。
// ・取り込みではすべての行に新しい ID を振り、関連と JSON の中の古い ID を同じ対応表で付け替える。
//   接続アカウントは停止中、自動化ルールは停止、予約中の投稿は下書きにして取り込む（移行先で確認してから再開する）。
// ・ファイル: gzip 圧縮した JSON。schemaVersion（作成元の DB の最新マイグレーション名）より古い DB には取り込まない。

import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { prisma, Prisma } from "@avatar-cmd/db";
import { ConfigError } from "../http";
import { isMediaName, mediaExists, readMedia, saveMediaNamed } from "./media";

export const EXPORT_FORMAT = "avatar-cmd-export";
export const EXPORT_VERSION = 1;
export const EXPORT_FILE_SUFFIX = ".avatarcmd.json.gz";

/**
 * アバターに紐づくテーブルの扱い。include = エクスポートに含める / exclude = 含めない（理由）。
 * Prisma のモデル名で書く。
 */
export const EXPORT_POLICY: Record<string, { include: true } | { include: false; label: string; reason: string }> = {
  Avatar: { include: true },
  SnsAccount: { include: true },
  GrowthState: { include: true },
  AccountSnapshot: { include: true },
  Campaign: { include: true },
  Content: { include: true },
  PostMetricSnapshot: { include: true },
  RevenueItem: { include: true },
  Revenue: { include: true },
  AvatarAnalytics: { include: true },
  AutomationRule: { include: true },
  KnowledgeItem: { include: true },
  KnowledgeRevision: { include: true },
  StyleReference: { include: true },
  ImprovementCycle: { include: true },
  ImprovementSchedule: { include: true },
  Collaboration: { include: true },
  ScheduledPost: { include: false, label: "予約投稿", reason: "予約は移行先で設定し直す（予約中の投稿は下書きにして取り込む）" },
  AvatarIdentity: { include: false, label: "アバターのメール・Google アカウント", reason: "パスワードは作成元の暗号鍵で暗号化されていて、移行先では読めない" },
  AvatarPlatformApp: { include: false, label: "アバター専用の開発者アプリ", reason: "開発者アプリの秘密情報" },
  DecisionEvent: { include: false, label: "判定（Jev）の記録", reason: "運用の判定ログ" },
  QuoteCandidate: { include: false, label: "引用候補", reason: "一時的な引用候補" },
  ActivityLog: { include: false, label: "アクティビティ", reason: "運用の記録" },
  ChromeProfile: { include: false, label: "ブラウザのプロファイル", reason: "作成元のサーバーのブラウザ環境" },
  OAuthState: { include: false, label: "接続途中のデータ", reason: "接続途中の一時データ" },
  UsageLedger: { include: false, label: "API の使用量", reason: "作成元の API 使用量" },
  ApiAuditLog: { include: false, label: "外部 AI API の記録", reason: "作成元の API の記録" },
  ArticleJob: { include: false, label: "記事の生成ジョブ", reason: "一時的な生成ジョブ" },
  VideoEpisode: { include: false, label: "動画パイプライン", reason: "動画パイプラインは今回は対象外" },
  PlatformInsight: { include: false, label: "プラットフォームの傾向", reason: "運用側のノウハウ（プラットフォーム × ジャンルの傾向）" },
};

/** 取り込み時に作り直す項目・外す項目（エクスポート時に除く） */
const OMIT: Record<string, string[]> = {
  Avatar: ["userId", "chromeProfileId", "browserConfig"],
  SnsAccount: ["accessToken", "refreshToken", "tokenExpiry", "oauthScopes", "sessionData", "credentials"],
};

export type ExportRow = Record<string, unknown>;

export interface AvatarBundle {
  avatar: ExportRow;
  snsAccounts: ExportRow[];
  growthStates: ExportRow[];
  accountSnapshots: ExportRow[];
  campaigns: ExportRow[];
  contents: ExportRow[];
  postMetricSnapshots: ExportRow[];
  revenueItems: ExportRow[];
  revenues: ExportRow[];
  analytics: ExportRow[];
  automationRules: ExportRow[];
  knowledgeItems: ExportRow[];
  knowledgeRevisions: ExportRow[];
  styleReferences: ExportRow[];
  improvementCycles: ExportRow[];
  improvementSchedule: ExportRow | null;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  schemaVersion: string;
  exportedAt: string;
  avatars: AvatarBundle[];
  collaborations: ExportRow[];
  media: { name: string; data: string }[];
  /** 参照しているが見つからなかったメディア */
  missingMedia: string[];
}

/** DB の最新のマイグレーション名（ファイルとシステムの版の照合に使う） */
export async function currentSchemaVersion(): Promise<string> {
  const rows = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`;
  return rows[0]?.migration_name ?? "";
}

function omit(model: string, row: ExportRow): ExportRow {
  const out = { ...row };
  for (const k of OMIT[model] ?? []) delete out[k];
  return out;
}

/** JSON の中に出てくる保存済みメディアの名前（/media/<名前> の URL・mediaName など）を集める */
export function collectMediaNames(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-z0-9]{2,5}/g)) if (isMediaName(m[0])) out.add(m[0]);
  } else if (Array.isArray(value)) for (const v of value) collectMediaNames(v, out);
  else if (value && typeof value === "object" && !(value instanceof Date)) for (const v of Object.values(value)) collectMediaNames(v, out);
  return out;
}

/** 投稿の metadata から運用側の情報（生成に使った傾向）を外す */
function cleanContentMetadata(meta: unknown): unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return meta;
  const { playbook: _playbook, ...rest } = meta as Record<string, unknown>;
  return rest;
}

/** エクスポートするアバターを選ぶ（ID の一覧、またはクライアントのラベル） */
export async function resolveExportAvatars(sel: { avatarIds?: string[]; clientLabel?: string }): Promise<string[]> {
  if (sel.clientLabel?.trim()) {
    const rows = await prisma.avatar.findMany({ where: { clientLabel: sel.clientLabel.trim() }, select: { id: true } });
    if (!rows.length) throw new ConfigError(`クライアント「${sel.clientLabel.trim()}」のアバターがありません`);
    return rows.map((r) => r.id);
  }
  const ids = [...new Set(sel.avatarIds ?? [])];
  if (!ids.length) throw new ConfigError("エクスポートするアバターかクライアントを選んでください");
  const found = await prisma.avatar.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) throw new ConfigError("見つからないアバターがあります");
  return ids;
}

async function bundleAvatar(avatarId: string): Promise<AvatarBundle> {
  const avatar = await prisma.avatar.findUniqueOrThrow({ where: { id: avatarId } });
  const snsAccounts = await prisma.snsAccount.findMany({ where: { avatarId } });
  const accountIds = snsAccounts.map((a) => a.id);
  const contents = await prisma.content.findMany({ where: { avatarId } });
  const knowledgeItems = await prisma.knowledgeItem.findMany({ where: { avatarId } });
  const [growthStates, accountSnapshots, campaigns, postMetricSnapshots, revenueItems, revenues, analytics, automationRules, knowledgeRevisions, styleReferences, improvementCycles, improvementSchedule] =
    await Promise.all([
      prisma.growthState.findMany({ where: { snsAccountId: { in: accountIds } } }),
      prisma.accountSnapshot.findMany({ where: { snsAccountId: { in: accountIds } } }),
      prisma.campaign.findMany({ where: { avatarId } }),
      prisma.postMetricSnapshot.findMany({ where: { contentId: { in: contents.map((c) => c.id) } } }),
      prisma.revenueItem.findMany({ where: { avatarId } }),
      prisma.revenue.findMany({ where: { avatarId } }),
      prisma.avatarAnalytics.findMany({ where: { avatarId } }),
      prisma.automationRule.findMany({ where: { avatarId } }),
      prisma.knowledgeRevision.findMany({ where: { knowledgeId: { in: knowledgeItems.map((k) => k.id) } } }),
      prisma.styleReference.findMany({ where: { avatarId } }),
      prisma.improvementCycle.findMany({ where: { avatarId } }),
      prisma.improvementSchedule.findUnique({ where: { avatarId } }),
    ]);
  return {
    avatar: omit("Avatar", avatar),
    snsAccounts: snsAccounts.map((a) => omit("SnsAccount", a)),
    growthStates,
    accountSnapshots,
    campaigns,
    contents: contents.map((c) => ({ ...c, metadata: cleanContentMetadata(c.metadata) })),
    postMetricSnapshots,
    revenueItems,
    revenues,
    analytics,
    automationRules,
    knowledgeItems,
    knowledgeRevisions,
    styleReferences,
    improvementCycles,
    improvementSchedule,
  };
}

/** エクスポートの中身を作る（ファイルにする前の JSON） */
export async function buildExport(sel: { avatarIds?: string[]; clientLabel?: string; includeMedia?: boolean }): Promise<ExportFile> {
  const ids = await resolveExportAvatars(sel);
  const avatars: AvatarBundle[] = [];
  for (const id of ids) avatars.push(await bundleAvatar(id));
  // コラボは両方のアバターをエクスポートするときだけ
  const collaborations = await prisma.collaboration.findMany({ where: { initiatorId: { in: ids }, partnerId: { in: ids } } });

  const media: ExportFile["media"] = [];
  const missingMedia: string[] = [];
  if (sel.includeMedia !== false) {
    for (const name of [...collectMediaNames(avatars)].sort()) {
      if (!(await mediaExists(name))) {
        missingMedia.push(name);
        continue;
      }
      media.push({ name, data: (await readMedia(name)).toString("base64") });
    }
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, schemaVersion: await currentSchemaVersion(), exportedAt: new Date().toISOString(), avatars, collaborations, media, missingMedia };
}

export function encodeExport(file: ExportFile): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(file)));
}

export function decodeExport(bytes: Uint8Array): ExportFile {
  let text: string;
  try {
    text = gunzipSync(bytes).toString("utf8");
  } catch {
    throw new ConfigError(`エクスポートしたファイル（${EXPORT_FILE_SUFFIX}）を選んでください`);
  }
  let data: ExportFile;
  try {
    data = JSON.parse(text) as ExportFile;
  } catch {
    throw new ConfigError("ファイルが壊れています（JSON として読めません）");
  }
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.avatars)) throw new ConfigError("Avatar CMD のエクスポートファイルではありません");
  if (typeof data.version !== "number" || data.version > EXPORT_VERSION) throw new ConfigError(`このファイルは新しい形式（v${data.version}）です。取り込み先の Avatar CMD を更新してください`);
  return data;
}

/** アバターのエクスポートファイル（gzip）を作る */
export async function exportAvatars(sel: { avatarIds?: string[]; clientLabel?: string; includeMedia?: boolean }) {
  const file = await buildExport(sel);
  return {
    bytes: encodeExport(file),
    summary: { avatars: file.avatars.map((a) => String(a.avatar.name)), media: file.media.length, missingMedia: file.missingMedia },
  };
}

// --- 取り込み -----------------------------------------------------------------------------

type ModelField = { name: string; kind: string; type: string; isRequired: boolean };
const FIELDS = new Map<string, ModelField[]>(Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields as unknown as ModelField[]]));

/** 取り込み先のテーブルにある項目だけを残し、JSON の null を DB の NULL にする（古い・新しいファイルの差を吸収する） */
export function toCreateData(model: string, row: ExportRow): Record<string, unknown> {
  const fields = FIELDS.get(model);
  if (!fields) throw new Error(`unknown model ${model}`);
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.kind !== "scalar" && f.kind !== "enum") continue;
    if (!(f.name in row) || row[f.name] === undefined) continue;
    const v = row[f.name];
    out[f.name] = f.type === "Json" && v === null ? Prisma.DbNull : v;
  }
  return out;
}

/** 値の中の古い ID（文字列が完全に一致するもの）を新しい ID に置き換える。JSON の中も含む */
export function remapIds<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, ids)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, ids)])) as T;
  }
  return value;
}

export interface ImportResult {
  avatars: { id: string; name: string }[];
  counts: Record<string, number>;
  media: { written: number; skipped: number };
  notes: string[];
}

const IMPORT_NOTE = "エクスポートから取り込みました。接続し直してください";

/** エクスポートファイルを取り込む。アバターはすべて新しい ID で作る（同じファイルを 2 回取り込むと 2 体ずつできる） */
export async function importAvatars(bytes: Uint8Array): Promise<ImportResult> {
  const file = decodeExport(bytes);
  const local = await currentSchemaVersion();
  if (file.schemaVersion && local && file.schemaVersion > local) {
    throw new ConfigError(`このファイルは新しい版の Avatar CMD で作られています（${file.schemaVersion}）。取り込み先を更新してから取り込んでください（現在: ${local}）`);
  }
  const owner = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!owner) throw new ConfigError("先に初期設定（管理者の作成）をしてください");

  // 古い ID → 新しい ID
  const ids = new Map<string, string>();
  const fresh = (old: unknown) => {
    const id = randomUUID();
    if (typeof old === "string") ids.set(old, id);
    return id;
  };
  for (const b of file.avatars) {
    fresh(b.avatar.id);
    for (const list of [b.snsAccounts, b.campaigns, b.contents, b.postMetricSnapshots, b.accountSnapshots, b.revenueItems, b.revenues, b.analytics, b.automationRules, b.knowledgeItems, b.knowledgeRevisions, b.styleReferences, b.improvementCycles]) {
      for (const r of list ?? []) fresh(r.id);
    }
  }
  for (const c of file.collaborations ?? []) fresh(c.id);

  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => (counts[k] = (counts[k] ?? 0) + n);
  const rows = (model: string, list: ExportRow[] | undefined, patch: (r: ExportRow) => ExportRow = (r) => r) => (list ?? []).map((r) => toCreateData(model, patch(remapIds(r, ids))));
  const created: { id: string; name: string }[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const b of file.avatars) {
        const avatar = toCreateData("Avatar", { ...remapIds(b.avatar, ids), userId: owner.id });
        await tx.avatar.create({ data: avatar as Prisma.AvatarUncheckedCreateInput });
        created.push({ id: String(avatar.id), name: String(avatar.name) });
        const many = async (model: string, delegate: { createMany: (a: { data: never[] }) => Promise<{ count: number }> }, data: Record<string, unknown>[]) => {
          if (data.length) add(model, (await delegate.createMany({ data: data as never[] })).count);
        };
        await many("SnsAccount", tx.snsAccount as never, rows("SnsAccount", b.snsAccounts, (r) => ({ ...r, isActive: false, appScope: "shared", lastError: IMPORT_NOTE, healthScore: 100 })));
        await many("GrowthState", tx.growthState as never, rows("GrowthState", b.growthStates));
        await many("AccountSnapshot", tx.accountSnapshot as never, rows("AccountSnapshot", b.accountSnapshots));
        await many("Campaign", tx.campaign as never, rows("Campaign", b.campaigns));
        await many(
          "Content",
          tx.content as never,
          rows("Content", b.contents, (r) => (r.status === "SCHEDULED" || r.status === "PUBLISHING" ? { ...r, status: "DRAFT" } : r)),
        );
        await many("PostMetricSnapshot", tx.postMetricSnapshot as never, rows("PostMetricSnapshot", b.postMetricSnapshots));
        await many("RevenueItem", tx.revenueItem as never, rows("RevenueItem", b.revenueItems));
        await many("Revenue", tx.revenue as never, rows("Revenue", b.revenues));
        await many("AvatarAnalytics", tx.avatarAnalytics as never, rows("AvatarAnalytics", b.analytics));
        await many("AutomationRule", tx.automationRule as never, rows("AutomationRule", b.automationRules, (r) => ({ ...r, isActive: false, nextRunAt: null, lastError: null })));
        await many("KnowledgeItem", tx.knowledgeItem as never, rows("KnowledgeItem", b.knowledgeItems));
        await many("KnowledgeRevision", tx.knowledgeRevision as never, rows("KnowledgeRevision", b.knowledgeRevisions));
        await many("StyleReference", tx.styleReference as never, rows("StyleReference", b.styleReferences));
        await many("ImprovementCycle", tx.improvementCycle as never, rows("ImprovementCycle", b.improvementCycles, (r) => ({ ...r, leaseUntil: null })));
        if (b.improvementSchedule) await many("ImprovementSchedule", tx.improvementSchedule as never, rows("ImprovementSchedule", [b.improvementSchedule]));
      }
      const collabs = rows("Collaboration", file.collaborations).filter((c) => created.some((a) => a.id === c.initiatorId) && created.some((a) => a.id === c.partnerId));
      if (collabs.length) add("Collaboration", (await tx.collaboration.createMany({ data: collabs as never[] })).count);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // メディアは DB の取り込みが成功してから書く（名前は UUID なので、同じ名前が既にあれば同じファイルとして書かない）
  let written = 0;
  let skipped = 0;
  for (const m of file.media ?? []) {
    if (!isMediaName(m.name) || (await mediaExists(m.name))) {
      skipped++;
      continue;
    }
    await saveMediaNamed(m.name, Buffer.from(m.data, "base64"));
    written++;
  }

  const notes = [
    "SNS アカウントは停止中で取り込みました。設定 > アカウント で接続し直してください。",
    "自動化ルールは停止した状態で取り込みました。内容を確認してから再開してください。",
    "AI の API キーなどのシステム設定は含まれていません。設定 > AI 共通・判定 で入力してください。",
  ];
  if (file.missingMedia?.length) notes.push(`作成元で見つからなかった画像が ${file.missingMedia.length} 件あります（アイコン・参考画像などが表示されない場合があります）。`);
  return { avatars: created, counts, media: { written, skipped }, notes };
}
