"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { EmptyState, Shell, Stat, yen } from "@/components/dashboard/shell";
import { api, Badge, Button, Card, Field, inputCls, Notice, type AccountInfo } from "@/components/settings/ui";
import { AccountVitals } from "@/components/analytics/account-vitals";
import { CHART_COLORS as C, ComboChart, MetricCard, movingAverage, withCumulative } from "@/components/analytics/combo-chart";

interface Report {
  total: number;
  byAvatar: { key: string; total: number }[];
  bySource: { key: string; total: number }[];
  byPlatform: { key: string; total: number }[];
  monthly: { month: string; total: number }[];
  entries: {
    id: string;
    avatarName: string;
    accountName: string | null;
    itemName: string | null;
    quantity: number;
    source: string;
    platform: string;
    amount: number;
    currency: string;
    description: string | null;
    earnedAt: string;
  }[];
}

interface Item {
  id: string;
  avatarId: string;
  avatarName: string;
  snsAccountId: string | null;
  accountName: string | null;
  name: string;
  source: string;
  platform: string;
  unitPrice: number;
  url: string | null;
  isActive: boolean;
  total: number;
  quantity: number;
  lastEarnedAt: string | null;
}

const SOURCES = [
  { value: "paid_content", label: "有料コンテンツ（記事・note など）" },
  { value: "affiliate", label: "アフィリエイト" },
  { value: "sponsorship", label: "スポンサー・案件" },
  { value: "donation", label: "投げ銭・サポート" },
  { value: "ad", label: "広告収益" },
  { value: "subscription", label: "サブスク・メンバーシップ" },
  { value: "merchandise", label: "物販" },
  { value: "other", label: "その他" },
];
const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label.replace(/（.*）/, "") ?? s;
const PLATFORM_SUGGEST = ["note", "Zenn", "Brain", "Tips", "YouTube", "X", "Amazon", "楽天", "A8.net", "Stripe", "BOOTH", "Kindle"];

type Tab = "accounts" | "record" | "overview";
const TABS: { id: Tab; label: string }[] = [
  { id: "accounts", label: "アカウント別分析" },
  { id: "record", label: "収益を記録・アイテム" },
  { id: "overview", label: "全体・記録一覧" },
];

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const toIso = (day: string) => new Date(`${day}T12:00:00+09:00`).toISOString();

function RevenueInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "accounts") as Tab;
  const [r, setR] = useState<Report | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [avatars, setAvatars] = useState<{ id: string; name: string }[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const [rep, it, integ] = await Promise.all([
      api<Report>("/api/revenue"),
      api<{ items: Item[] }>("/api/revenue/items"),
      api<{ avatars: { id: string; name: string }[]; accounts: AccountInfo[] }>("/api/integrations"),
    ]);
    setR(rep);
    setItems(it.items);
    setAvatars(integ.avatars);
    setAccounts(integ.accounts);
  }, []);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", msg: e.message }));
  }, [load]);

  const done = (msg: string) => {
    setNotice({ kind: "ok", msg });
    setReloadKey((k) => k + 1);
    load();
  };
  const fail = (e: unknown) => setNotice({ kind: "error", msg: (e as Error).message });

  return (
    <Shell title="収益分析" description="アカウントごとの収益・投稿・フォロワーを月単位で確認し、売上を記録" wide>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.msg}
        </Notice>
      )}
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => router.replace(`/revenue?tab=${t.id}`)}
            className={`rounded-lg px-4 py-1.5 text-sm transition ${tab === t.id ? "bg-white/10 font-semibold text-white" : "text-white/50 hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountVitals reloadKey={reloadKey} />}
      {tab === "record" && <RecordTab items={items} avatars={avatars} accounts={accounts} recent={r?.entries ?? []} onDone={done} onError={fail} />}
      {tab === "overview" && r && <Overview r={r} onRemove={(id) => api(`/api/revenue/${id}`, { method: "DELETE" }).then(() => done("削除しました"), fail)} />}
    </Shell>
  );
}

// --- 記録 -------------------------------------------------------------------------

function AccountSelect({ avatarId, accounts, value, onChange }: { avatarId: string; accounts: AccountInfo[]; value: string; onChange: (v: string) => void }) {
  const mine = accounts.filter((a) => a.avatarId === avatarId);
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-white/60">アカウント（任意）</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="" className="bg-[#111]">
          指定しない（アバター全体）
        </option>
        {mine.map((a) => (
          <option key={a.id} value={a.id} className="bg-[#111]">
            {a.platform} {a.accountName}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordTab({
  items,
  avatars,
  accounts,
  recent,
  onDone,
  onError,
}: {
  items: Item[];
  avatars: { id: string; name: string }[];
  accounts: AccountInfo[];
  recent: Report["entries"];
  onDone: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const active = items.filter((i) => i.isActive);
  // 未選択なら、アイテムがあれば「アイテムから記録」、無ければ「新しいアイテム」
  const [picked, setMode] = useState<"item" | "new" | "oneoff" | null>(null);
  const mode = picked === "item" && !active.length ? "new" : picked ?? (active.length ? "item" : "new");

  // アイテムから記録
  const [sel, setSel] = useState<string>("");
  const [qty, setQty] = useState("1");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(today());
  const [memo, setMemo] = useState("");
  const item = active.find((i) => i.id === sel) ?? active[0];
  const computed = item ? item.unitPrice * (Number(qty) || 0) : 0;

  async function recordItem() {
    if (!item) return;
    try {
      await api("/api/revenue", { method: "POST", json: { itemId: item.id, quantity: qty, amount: amount || undefined, earnedAt: toIso(day), description: memo } });
      setQty("1");
      setAmount("");
      setMemo("");
      onDone(`「${item.name}」を ${yen(amount ? Number(amount) : computed)} で記録しました`);
    } catch (e) {
      onError(e);
    }
  }

  // 新しいアイテム
  const emptyNew = { avatarId: avatars[0]?.id ?? "", snsAccountId: "", name: "", source: "paid_content", platform: "note", unitPrice: "", url: "", recordNow: true, qty: "1", day: today() };
  const [n, setN] = useState(emptyNew);
  useEffect(() => {
    if (!n.avatarId && avatars[0]) setN((x) => ({ ...x, avatarId: avatars[0].id }));
  }, [avatars, n.avatarId]);

  async function createItem() {
    try {
      const res = await api<{ id: string }>("/api/revenue/items", { method: "POST", json: { ...n, snsAccountId: n.snsAccountId || null } });
      if (n.recordNow) await api("/api/revenue", { method: "POST", json: { itemId: res.id, quantity: n.qty, earnedAt: toIso(n.day) } });
      setSel(res.id);
      setN({ ...emptyNew, avatarId: n.avatarId });
      onDone(n.recordNow ? `アイテム「${n.name}」を登録し、売上を記録しました。次からは「アイテムから記録」で選ぶだけです` : `アイテム「${n.name}」を登録しました`);
      setMode("item");
    } catch (e) {
      onError(e);
    }
  }

  // 単発
  const [o, setO] = useState({ avatarId: "", snsAccountId: "", source: "affiliate", platform: "", amount: "", description: "", day: today() });
  async function recordOneoff() {
    try {
      await api("/api/revenue", { method: "POST", json: { ...o, avatarId: o.avatarId || avatars[0]?.id, snsAccountId: o.snsAccountId || null, earnedAt: toIso(o.day) } });
      setO({ ...o, amount: "", description: "" });
      onDone("記録しました");
    } catch (e) {
      onError(e);
    }
  }

  const byAvatar = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of active) m.set(i.avatarName, [...(m.get(i.avatarName) ?? []), i]);
    return [...m.entries()];
  }, [active]);

  return (
    <div className="space-y-6">
      <datalist id="revenue-platforms">
        {PLATFORM_SUGGEST.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-2 text-sm font-semibold">収益を記録</h3>
          {(
            [
              ["item", "アイテムから記録"],
              ["new", "＋ 新しいアイテム"],
              ["oneoff", "アイテムなし（単発）"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              disabled={m === "item" && !active.length}
              onClick={() => setMode(m)}
              className={`rounded-lg border px-3 py-1 text-xs disabled:opacity-30 ${mode === m ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200" : "border-white/10 text-white/60"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "item" && item && (
          <>
            <p className="text-xs text-white/45">登録済みのアイテム（記事・商品）を選んで、日付と数量を入れるだけで記録できます。金額は「単価 × 数量」（値引きなどがあれば金額を上書き）。</p>
            <div className="flex flex-wrap gap-2">
              {active.slice(0, 8).map((i) => (
                <button
                  key={i.id}
                  onClick={() => setSel(i.id)}
                  className={`rounded-lg border px-3 py-1.5 text-left text-xs ${item.id === i.id ? "border-violet-400/60 bg-violet-500/10 text-violet-100" : "border-white/10 text-white/60 hover:bg-white/[0.04]"}`}
                >
                  <div className="font-semibold">{i.name}</div>
                  <div className="text-[10px] text-white/40">
                    {i.platform} ・ {yen(i.unitPrice)}
                  </div>
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs text-white/60">アイテム</span>
                <select value={item.id} onChange={(e) => setSel(e.target.value)} className={inputCls}>
                  {byAvatar.map(([avatar, list]) => (
                    <optgroup key={avatar} label={avatar} className="bg-[#111]">
                      {list.map((i) => (
                        <option key={i.id} value={i.id} className="bg-[#111]">
                          {i.name}（{i.platform}・{yen(i.unitPrice)}）
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">日付</span>
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
              </label>
              <Field def={{ key: "qty", label: "数量" }} value={qty} onChange={(v) => setQty(v.replace(/[^\d]/g, ""))} />
              <Field def={{ key: "amount", label: "金額（空欄で自動）", placeholder: yen(computed) }} value={amount} onChange={(v) => setAmount(v.replace(/[^\d.-]/g, ""))} />
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <div className="md:col-span-2">
                <Field def={{ key: "memo", label: "メモ（任意）" }} value={memo} onChange={setMemo} />
              </div>
              <div className="flex items-end text-xs text-white/50 md:col-span-3">
                {item.avatarName}
                {item.accountName ? ` / ${item.accountName}` : " / アカウント指定なし"} ・ {sourceLabel(item.source)}
              </div>
            </div>
            <Button onClick={recordItem} disabled={!qty || Number(qty) < 1}>
              {yen(amount ? Number(amount) : computed)} を記録する
            </Button>
          </>
        )}

        {mode === "new" && (
          <>
            <p className="text-xs text-white/45">同じ記事・商品が繰り返し売れる場合は、アイテムとして単価ごと登録しておくと次からは選ぶだけで記録できます。</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">アバター</span>
                <select value={n.avatarId} onChange={(e) => setN({ ...n, avatarId: e.target.value, snsAccountId: "" })} className={inputCls}>
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#111]">
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <AccountSelect avatarId={n.avatarId} accounts={accounts} value={n.snsAccountId} onChange={(v) => setN({ ...n, snsAccountId: v })} />
              <Field def={{ key: "name", label: "アイテム名", required: true, placeholder: "記事『朝の集中ルーティン』" }} value={n.name} onChange={(v) => setN({ ...n, name: v })} />
              <Field def={{ key: "source", label: "収益源", type: "select", options: SOURCES }} value={n.source} onChange={(v) => setN({ ...n, source: v })} />
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">プラットフォーム</span>
                <input list="revenue-platforms" value={n.platform} onChange={(e) => setN({ ...n, platform: e.target.value })} className={inputCls} placeholder="note" />
              </label>
              <Field def={{ key: "price", label: "単価（円）", required: true, placeholder: "500" }} value={n.unitPrice} onChange={(v) => setN({ ...n, unitPrice: v.replace(/[^\d.]/g, "") })} />
              <div className="md:col-span-3">
                <Field def={{ key: "url", label: "URL（任意）", type: "url", placeholder: "https://note.com/..." }} value={n.url} onChange={(v) => setN({ ...n, url: v })} />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={n.recordNow} onChange={(e) => setN({ ...n, recordNow: e.target.checked })} />
                続けて売上も記録する
              </label>
              {n.recordNow && (
                <>
                  <input type="date" value={n.day} onChange={(e) => setN({ ...n, day: e.target.value })} className={`${inputCls} !w-40`} />
                  <input value={n.qty} onChange={(e) => setN({ ...n, qty: e.target.value.replace(/[^\d]/g, "") })} className={`${inputCls} !w-20`} placeholder="数量" />
                  <span className="text-xs text-white/50">= {yen((Number(n.unitPrice) || 0) * (Number(n.qty) || 0))}</span>
                </>
              )}
            </div>
            <Button onClick={createItem} disabled={!n.name.trim() || !n.unitPrice || !n.platform.trim() || !n.avatarId}>
              {n.recordNow ? "登録して記録する" : "アイテムを登録"}
            </Button>
          </>
        )}

        {mode === "oneoff" && (
          <>
            <p className="text-xs text-white/45">案件報酬など、繰り返さない収益はアイテムを作らずに記録できます。</p>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">アバター</span>
                <select value={o.avatarId || avatars[0]?.id || ""} onChange={(e) => setO({ ...o, avatarId: e.target.value, snsAccountId: "" })} className={inputCls}>
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id} className="bg-[#111]">
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <AccountSelect avatarId={o.avatarId || avatars[0]?.id || ""} accounts={accounts} value={o.snsAccountId} onChange={(v) => setO({ ...o, snsAccountId: v })} />
              <Field def={{ key: "source", label: "収益源", type: "select", options: SOURCES }} value={o.source} onChange={(v) => setO({ ...o, source: v })} />
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">プラットフォーム</span>
                <input list="revenue-platforms" value={o.platform} onChange={(e) => setO({ ...o, platform: e.target.value })} className={inputCls} placeholder="note / YouTube / Amazon など" />
              </label>
              <Field def={{ key: "amount", label: "金額（円）", placeholder: "3000" }} value={o.amount} onChange={(v) => setO({ ...o, amount: v.replace(/[^\d.-]/g, "") })} />
              <label className="block">
                <span className="mb-1 block text-xs text-white/60">日付</span>
                <input type="date" value={o.day} onChange={(e) => setO({ ...o, day: e.target.value })} className={inputCls} />
              </label>
              <div className="md:col-span-3">
                <Field def={{ key: "desc", label: "メモ", placeholder: "PR案件『…』の報酬" }} value={o.description} onChange={(v) => setO({ ...o, description: v })} />
              </div>
            </div>
            <Button onClick={recordOneoff} disabled={!o.amount || !o.platform}>
              記録する
            </Button>
          </>
        )}
      </Card>

      <ItemList items={items} onDone={onDone} onError={onError} />

      <Card>
        <h3 className="mb-3 text-sm font-semibold">最近の記録</h3>
        <Entries entries={recent.slice(0, 10)} />
      </Card>
    </div>
  );
}

function ItemList({ items, onDone, onError }: { items: Item[]; onDone: (msg: string) => void; onError: (e: unknown) => void }) {
  const [edit, setEdit] = useState<{ id: string; name: string; unitPrice: string; platform: string } | null>(null);
  const patch = (id: string, json: object, msg: string) => api(`/api/revenue/items/${id}`, { method: "PATCH", json }).then(() => onDone(msg), onError);

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">登録済みのアイテム</h3>
      {items.length === 0 ? (
        <EmptyState>まだアイテムはありません。「＋ 新しいアイテム」から登録してください。</EmptyState>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {items.map((i) =>
            edit?.id === i.id ? (
              <div key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={`${inputCls} !w-64 !py-1.5`} />
                <input list="revenue-platforms" value={edit.platform} onChange={(e) => setEdit({ ...edit, platform: e.target.value })} className={`${inputCls} !w-32 !py-1.5`} />
                <input value={edit.unitPrice} onChange={(e) => setEdit({ ...edit, unitPrice: e.target.value.replace(/[^\d.]/g, "") })} className={`${inputCls} !w-28 !py-1.5`} />
                <Button onClick={() => patch(i.id, { name: edit.name, unitPrice: edit.unitPrice, platform: edit.platform }, "アイテムを更新しました").then(() => setEdit(null))}>保存</Button>
                <Button variant="ghost" onClick={() => setEdit(null)}>
                  キャンセル
                </Button>
              </div>
            ) : (
              <div key={i.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${i.isActive ? "" : "opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{i.name}</span>
                    {!i.isActive && <Badge className="bg-white/10 text-white/50">アーカイブ</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-white/40">
                    {i.avatarName}
                    {i.accountName ? ` / ${i.accountName}` : ""} ・ {i.platform} ・ {sourceLabel(i.source)}
                    {i.url && (
                      <>
                        {" ・ "}
                        <a href={i.url} target="_blank" rel="noreferrer" className="text-cyan-300">
                          URL
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-white/40">単価</div>
                  <div className="font-semibold">{yen(i.unitPrice)}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-white/40">累計（{i.quantity}件）</div>
                  <div className="font-semibold text-violet-200">{yen(i.total)}</div>
                </div>
                <div className="w-20 text-right text-[11px] text-white/35">{i.lastEarnedAt ? new Date(i.lastEarnedAt).toLocaleDateString("ja-JP") : "未記録"}</div>
                <div className="flex gap-2 text-white/40">
                  <button title="編集" onClick={() => setEdit({ id: i.id, name: i.name, unitPrice: String(i.unitPrice), platform: i.platform })} className="hover:text-white">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title={i.isActive ? "アーカイブ（選択肢から外す）" : "元に戻す"}
                    onClick={() => patch(i.id, { isActive: !i.isActive }, i.isActive ? "アーカイブしました" : "元に戻しました")}
                    className="hover:text-white"
                  >
                    {i.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    title="削除（記録済みの収益は残ります）"
                    onClick={() => confirm(`「${i.name}」を削除しますか？記録済みの収益は残ります。`) && api(`/api/revenue/items/${i.id}`, { method: "DELETE" }).then(() => onDone("削除しました"), onError)}
                    className="hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

// --- 全体 -------------------------------------------------------------------------

function Entries({ entries, onRemove }: { entries: Report["entries"]; onRemove?: (id: string) => void }) {
  if (!entries.length) return <EmptyState>まだ記録はありません</EmptyState>;
  return (
    <div className="divide-y divide-white/[0.05]">
      {entries.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
          <span className="w-24 text-xs text-white/40">{new Date(e.earnedAt).toLocaleDateString("ja-JP")}</span>
          <span className="w-24 truncate">{e.avatarName}</span>
          <span className="w-40 truncate text-xs text-white/60">{e.accountName ?? `${sourceLabel(e.source)} / ${e.platform}`}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-white/40">
            {e.itemName ? `${e.itemName}${e.quantity > 1 ? ` × ${e.quantity}` : ""}` : ""}
            {e.itemName && e.description ? " ・ " : ""}
            {e.description}
          </span>
          <span className="font-semibold">{yen(e.amount)}</span>
          {onRemove && (
            <button onClick={() => confirm("この記録を削除しますか？") && onRemove(e.id)} className="text-white/30 hover:text-red-300" title="削除">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Overview({ r, onRemove }: { r: Report; onRemove: (id: string) => void }) {
  const List = ({ title, rows, label = (k: string) => k }: { title: string; rows: { key: string; total: number }[]; label?: (k: string) => string }) => (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-white/40">データなし</p>
      ) : (
        <div className="space-y-2">
          {rows.map((x) => (
            <div key={x.key}>
              <div className="flex justify-between text-xs">
                <span>{label(x.key)}</span>
                <span className="text-white/70">{yen(x.total)}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.06]">
                <div className="h-1 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{ width: `${(x.total / Math.max(1, rows[0].total)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="累計（記録分）" value={yen(r.total)} tone="text-violet-300" />
        <Stat label="今月" value={yen(r.monthly[r.monthly.length - 1]?.total ?? 0)} tone="text-cyan-300" />
        <Stat label="先月" value={yen(r.monthly[r.monthly.length - 2]?.total ?? 0)} />
      </div>
      <MetricCard title="月別（6か月）" value={yen(r.monthly.reduce((s, m) => s + m.total, 0))} sub="6か月合計">
        <ComboChart
          data={(() => {
            const avg = movingAverage(r.monthly.map((m) => m.total), 3);
            return withCumulative(r.monthly, [["total", "cumulative"]]).map((m, i) => ({ ...m, label: `${Number(m.month.slice(5))}月`, avg: avg[i] }));
          })()}
          xKey="label"
          series={[
            { key: "total", label: "月の収益", color: C.brand, gradient: [C.brandFrom, C.brandTo], kind: "bar" },
            { key: "avg", label: "3か月平均", color: C.amber, kind: "line", compare: true },
            { key: "cumulative", label: "累計", color: C.cyan, kind: "area", right: true },
          ]}
          formatLeft={yen}
          formatRight={yen}
          height={240}
        />
      </MetricCard>
      <div className="grid gap-4 md:grid-cols-3">
        <List title="アバター別" rows={r.byAvatar} />
        <List title="収益源別" rows={r.bySource} label={sourceLabel} />
        <List title="プラットフォーム別" rows={r.byPlatform} />
      </div>
      <Card>
        <h3 className="mb-3 text-sm font-semibold">記録一覧</h3>
        <Entries entries={r.entries} onRemove={onRemove} />
      </Card>
    </div>
  );
}

export default function RevenuePage() {
  return (
    <Suspense>
      <RevenueInner />
    </Suspense>
  );
}
