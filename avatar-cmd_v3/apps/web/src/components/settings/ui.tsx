"use client";
// 設定画面の共通UI部品
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "password" | "textarea" | "select" | "url";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
}

export interface PlatformInfo {
  id: string;
  name: string;
  icon: string;
  support: "official" | "legacy" | "unofficial" | "manual";
  connection: "oauth" | "credentials" | "none";
  maxLength?: number;
  appFields: FieldDef[];
  accountFields: FieldDef[];
  settingFields: FieldDef[];
  postFields: FieldDef[];
  media: { image: boolean; video: boolean; required?: string; maxCount?: number };
  docs: { label: string; url: string }[];
  notes: string[];
  redirectUri: string | null;
  app: { values: Record<string, string>; configured: Record<string, boolean>; complete: boolean } | null;
}

export interface AccountInfo {
  id: string;
  avatarId: string;
  avatarName: string;
  platform: string;
  accountId: string | null;
  accountName: string;
  profileUrl: string | null;
  isActive: boolean;
  tokenExpiry: string | null;
  lastError: string | null;
  settings: Record<string, unknown>;
  connected: boolean;
  /** 接続に使った開発者アプリ: shared = 共通 / avatar = アバター専用 */
  appScope: "shared" | "avatar";
}

/** アバター専用の開発者アプリ（共通の SNS連携アプリ設定を上書き） */
export interface AvatarAppInfo {
  avatarId: string;
  platform: string;
  values: Record<string, string>;
  configured: Record<string, boolean>;
  complete: boolean;
}

export const SUPPORT_LABEL: Record<PlatformInfo["support"], { label: string; cls: string }> = {
  official: { label: "公式API", cls: "bg-emerald-500/15 text-emerald-300" },
  legacy: { label: "公式API（新規受付終了）", cls: "bg-amber-500/15 text-amber-300" },
  unofficial: { label: "非公式・下書き保存", cls: "bg-orange-500/15 text-orange-300" },
  manual: { label: "自動投稿非対応", cls: "bg-white/10 text-white/50" },
};

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 ${className}`}>{children}</div>;
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

const VARIANTS = {
  primary: "bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white",
  ghost: "border border-white/10 text-white/70 hover:bg-white/[0.06]",
  danger: "border border-red-500/30 text-red-300 hover:bg-red-500/10",
};

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof VARIANTS }) {
  return (
    <a href={href} className={`inline-block rounded-lg px-3 py-1.5 text-xs font-semibold no-underline transition ${VARIANTS[variant]}`}>
      {children}
    </a>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = VARIANTS[variant];
  return (
    <button {...rest} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-400/60";

export function Field({
  def,
  value,
  onChange,
  configured,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  configured?: boolean;
}) {
  const placeholder = def.type === "password" && configured ? "保存済み（変更する場合のみ入力）" : def.placeholder;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs text-white/60">
        {def.label}
        {def.required && <span className="text-red-400">*</span>}
        {configured && <Check className="h-3 w-3 text-emerald-400" />}
      </span>
      {def.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value} className="bg-[#111]">
              {o.label}
            </option>
          ))}
        </select>
      ) : def.type === "textarea" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={inputCls} />
      ) : (
        <input
          type={def.type === "password" ? "password" : def.type === "url" ? "url" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={inputCls}
        />
      )}
      {def.help && <span className="mt-1 block text-[11px] text-white/35">{def.help}</span>}
    </label>
  );
}

export function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
      <code className="flex-1 break-all text-xs text-cyan-200">{text}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="text-white/40 hover:text-white"
        title="コピー"
      >
        {done ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function DocLinks({ docs }: { docs: { label: string; url: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {docs.map((d) => (
        <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:underline">
          {d.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

export function Notice({ kind, children, onClose }: { kind: "ok" | "error"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
        kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"
      }`}
    >
      <span className="whitespace-pre-wrap break-all">{children}</span>
      {onClose && (
        <button onClick={onClose} className="text-white/40 hover:text-white">
          ×
        </button>
      )}
    </div>
  );
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}
