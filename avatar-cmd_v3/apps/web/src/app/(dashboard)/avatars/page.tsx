"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AVATAR_STATUS, EmptyState, Shell, Stat } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, Notice } from "@/components/settings/ui";
import { AccountVitals } from "@/components/analytics/account-vitals";

interface Persona {
  tone?: string;
  topics?: string[];
  postFrequency?: string;
  bestTime?: string;
  prompt?: string;
}
interface Avatar {
  id: string;
  name: string;
  role: string;
  status: string;
  description: string | null;
  specialization: string | null;
  targetAudience: string | null;
  persona: Persona;
  accounts: { id: string; platform: string; accountName: string; isActive: boolean; lastError: string | null }[];
  contentCount: number;
  publishedCount: number;
  ruleCount: number;
}

type Form = {
  name: string;
  role: string;
  description: string;
  specialization: string;
  targetAudience: string;
  tone: string;
  topics: string;
  postFrequency: string;
  bestTime: string;
  prompt: string;
};

const EMPTY: Form = { name: "", role: "", description: "", specialization: "", targetAudience: "", tone: "", topics: "", postFrequency: "", bestTime: "", prompt: "" };

function toForm(a: Avatar): Form {
  return {
    name: a.name,
    role: a.role === "sns_marketer" ? "" : a.role,
    description: a.description ?? "",
    specialization: a.specialization ?? "",
    targetAudience: a.targetAudience ?? "",
    tone: a.persona.tone ?? "",
    topics: (a.persona.topics ?? []).join(", "),
    postFrequency: a.persona.postFrequency ?? "",
    bestTime: a.persona.bestTime ?? "",
    prompt: a.persona.prompt ?? "",
  };
}

function payload(f: Form) {
  return {
    name: f.name,
    role: f.role,
    description: f.description,
    specialization: f.specialization,
    targetAudience: f.targetAudience,
    persona: { tone: f.tone, topics: f.topics, postFrequency: f.postFrequency, bestTime: f.bestTime, prompt: f.prompt },
  };
}

function AvatarForm({ form, setForm }: { form: Form; setForm: (f: Form) => void }) {
  const f = (key: keyof Form, label: string, extra: Partial<Parameters<typeof Field>[0]["def"]> = {}) => (
    <Field def={{ key, label, ...extra }} value={form[key]} onChange={(v) => setForm({ ...form, [key]: v })} />
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {f("name", "名前", { required: true })}
        {f("role", "役割", { placeholder: "例: ADHD当事者の発信者" })}
        {f("specialization", "専門分野", { placeholder: "例: 集中術・ライフハック" })}
        {f("targetAudience", "想定読者", { placeholder: "例: 20〜30代の会社員" })}
      </div>
      {f("description", "プロフィール", { type: "textarea" })}
      <h4 className="pt-2 text-xs font-semibold text-white/70">ペルソナ（AI の投稿文生成に使われます）</h4>
      <div className="grid gap-4 md:grid-cols-2">
        {f("tone", "口調", { placeholder: "例: やさしく共感的、です・ます調" })}
        {f("topics", "得意なトピック（カンマ区切り）", { placeholder: "ADHD, 睡眠, 仕事術" })}
        {f("postFrequency", "投稿頻度の目安", { placeholder: "1日2〜3件" })}
        {f("bestTime", "よく投稿する時間帯", { placeholder: "19:00-21:00" })}
      </div>
      {f("prompt", "守るべきルール・禁止事項", { type: "textarea", placeholder: "例: 医療的な断定はしない。絵文字は1投稿2個まで。" })}
    </div>
  );
}

function AvatarsInner() {
  const params = useSearchParams();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new">(params.get("new") ? "new" : "view");
  const [form, setForm] = useState<Form>(EMPTY);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api<{ avatars: Avatar[] }>("/api/avatars");
    setAvatars(d.avatars);
    setSelectedId((cur) => cur && d.avatars.some((a) => a.id === cur) ? cur : d.avatars[0]?.id ?? null);
  }, []);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  const selected = avatars.find((a) => a.id === selectedId);

  async function save() {
    setBusy(true);
    try {
      if (mode === "new") {
        const r = await api<{ avatar: { id: string } }>("/api/avatars", { method: "POST", json: payload(form) });
        setSelectedId(r.avatar.id);
        setNotice({ kind: "ok", msg: `「${form.name}」を作成しました` });
      } else if (selected) {
        await api(`/api/avatars/${selected.id}`, { method: "PATCH", json: payload(form) });
        setNotice({ kind: "ok", msg: "保存しました" });
      }
      setMode("view");
      await load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!selected) return;
    await api(`/api/avatars/${selected.id}`, { method: "PATCH", json: { status } }).catch((e) => setNotice({ kind: "error", msg: e.message }));
    load();
  }

  async function remove() {
    if (!selected) return;
    if (!confirm(`「${selected.name}」を削除しますか？接続アカウント・投稿履歴・自動化ルールもすべて削除されます。`)) return;
    try {
      await api(`/api/avatars/${selected.id}`, { method: "DELETE" });
      setNotice({ kind: "ok", msg: "削除しました" });
      setSelectedId(null);
      load();
    } catch (e) {
      setNotice({ kind: "error", msg: (e as Error).message });
    }
  }

  return (
    <Shell title="アバター管理" description="アバターのプロフィール・ペルソナ・接続状況" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="w-full shrink-0 space-y-2 md:w-64">
          {avatars.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setSelectedId(a.id);
                setMode("view");
              }}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                a.id === selectedId && mode !== "new" ? "border-violet-400/40 bg-violet-500/10" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/20 font-bold text-violet-300">{a.name[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{a.name}</span>
                  <Badge className={AVATAR_STATUS[a.status]?.cls ?? ""}>{AVATAR_STATUS[a.status]?.label}</Badge>
                </div>
                <div className="truncate text-xs text-white/40">{a.role === "sns_marketer" ? "—" : a.role}</div>
              </div>
            </button>
          ))}
          <button
            onClick={() => {
              setForm(EMPTY);
              setMode("new");
            }}
            className="w-full rounded-xl border border-dashed border-white/15 p-3 text-sm text-white/40 hover:text-white"
          >
            + 新しいアバター
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          {mode !== "view" ? (
            <Card className="space-y-4">
              <h3 className="text-sm font-semibold">{mode === "new" ? "新しいアバター" : `${selected?.name} を編集`}</h3>
              <AvatarForm form={form} setForm={setForm} />
              <div className="flex gap-2">
                <Button onClick={save} disabled={busy || !form.name.trim()}>
                  {busy ? "保存中…" : "保存"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("view")}>
                  キャンセル
                </Button>
              </div>
            </Card>
          ) : !selected ? (
            <EmptyState>アバターを選択してください</EmptyState>
          ) : (
            <>
              <Card className="flex flex-wrap items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-500/20 text-2xl font-bold text-violet-300">{selected.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    <Badge className={AVATAR_STATUS[selected.status]?.cls ?? ""}>{AVATAR_STATUS[selected.status]?.label}</Badge>
                  </div>
                  <p className="text-sm text-white/50">{selected.description || "プロフィール未設定"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setForm(toForm(selected));
                      setMode("edit");
                    }}
                  >
                    編集
                  </Button>
                  {selected.status === "PAUSED" ? (
                    <Button variant="ghost" onClick={() => setStatus("ACTIVE")}>
                      再開
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setStatus("PAUSED")}>
                      一時停止
                    </Button>
                  )}
                  <Button variant="danger" onClick={remove}>
                    削除
                  </Button>
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="接続アカウント" value={selected.accounts.length} />
                <Stat label="投稿済み" value={selected.publishedCount} tone="text-emerald-300" />
                <Stat label="投稿（全ステータス）" value={selected.contentCount} />
                <Stat label="自動化ルール" value={selected.ruleCount} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <h3 className="mb-3 text-sm font-semibold">ペルソナ</h3>
                  <dl className="space-y-2 text-sm">
                    {[
                      ["役割", selected.role === "sns_marketer" ? "" : selected.role],
                      ["専門", selected.specialization],
                      ["想定読者", selected.targetAudience],
                      ["口調", selected.persona.tone],
                      ["投稿頻度", selected.persona.postFrequency],
                      ["時間帯", selected.persona.bestTime],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-white/[0.04] pb-1.5">
                        <dt className="shrink-0 text-white/40">{k}</dt>
                        <dd className="text-right">{v || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  {!!selected.persona.topics?.length && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selected.persona.topics.map((t) => (
                        <Badge key={t} className="bg-violet-500/10 text-violet-200">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {selected.persona.prompt && <p className="mt-3 whitespace-pre-wrap text-xs text-white/50">{selected.persona.prompt}</p>}
                </Card>
                <Card>
                  <h3 className="mb-3 text-sm font-semibold">接続アカウント</h3>
                  {selected.accounts.length === 0 ? (
                    <p className="text-xs text-white/40">まだ接続されていません。</p>
                  ) : (
                    <div className="space-y-2">
                      {selected.accounts.map((a) => (
                        <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2 text-sm">
                          <span>
                            {a.accountName} <span className="text-xs text-white/40">{a.platform}</span>
                          </span>
                          {!a.isActive ? (
                            <Badge className="bg-white/10 text-white/50">停止中</Badge>
                          ) : a.lastError ? (
                            <Badge className="bg-red-500/15 text-red-300">エラー</Badge>
                          ) : (
                            <Badge className="bg-emerald-500/15 text-emerald-300">接続済み</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <Link href="/settings?tab=accounts" className="mt-3 inline-block text-xs text-cyan-300">
                    アカウントを接続・管理 →
                  </Link>
                </Card>
              </div>

              <Card>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">アカウント分析（バイタルチェック）</h3>
                  <span className="text-[11px] text-white/40">月ごとの投稿・エラー・収益・フォロワー。アカウントをクリックすると詳細グラフ</span>
                  <span className="flex-1" />
                  <Link href="/revenue?tab=record" className="text-xs text-cyan-300">
                    収益を記録 →
                  </Link>
                </div>
                <AccountVitals key={selected.id} avatarId={selected.id} />
              </Card>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

export default function AvatarsPage() {
  return (
    <Suspense>
      <AvatarsInner />
    </Suspense>
  );
}
