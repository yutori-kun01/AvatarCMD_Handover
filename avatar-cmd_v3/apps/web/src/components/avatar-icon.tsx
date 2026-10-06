"use client";
// アバターのアイコン（接続アカウントのプロフィール画像。無ければ頭文字）
import { useState } from "react";

const SIZES = { sm: "h-7 w-7 text-xs", md: "h-10 w-10 text-base", lg: "h-14 w-14 text-2xl" } as const;

export function AvatarIcon({ name, url, size = "md", className = "" }: { name: string; url?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const [broken, setBroken] = useState(false);
  const cls = `${SIZES[size]} shrink-0 rounded-full ${className}`;
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className={`${cls} object-cover ring-1 ring-white/10`} onError={() => setBroken(true)} />;
  }
  return <div className={`${cls} flex items-center justify-center bg-violet-500/20 font-bold text-violet-300`}>{name[0] ?? "?"}</div>;
}
