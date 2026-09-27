// ================================================
// 自動投稿に対応していないプラットフォーム
// ================================================
// 公式の投稿APIがなく、安定して動かせる仕組みも確認できていないもの。
// 一覧に表示して「なぜ自動化できないか」を明示する（投稿先としては選べない）。

import type { PlatformDefinition } from "../types";

function manual(p: Pick<PlatformDefinition, "id" | "name" | "icon" | "docs" | "notes">): PlatformDefinition {
  return {
    ...p,
    support: "manual",
    connection: "none",
    appFields: [],
    accountFields: [],
    settingFields: [],
    postFields: [],
    media: { image: false, video: false, maxCount: 0 },
  };
}

export const substack = manual({
  id: "substack",
  name: "Substack",
  icon: "📧",
  docs: [{ label: "Substack Help", url: "https://support.substack.com" }],
  notes: ["Substack は公開の投稿APIを提供していません。記事は Substack のエディタから投稿してください。"],
});

export const ameba = manual({
  id: "ameba",
  name: "Amebaブログ",
  icon: "🟢",
  docs: [{ label: "Amebaヘルプ", url: "https://helps.ameba.jp" }],
  notes: ["Amebaブログは外部からの投稿APIを提供していません。ブログ管理画面から投稿してください。"],
});

export const standfm = manual({
  id: "standfm",
  name: "stand.fm",
  icon: "🎙️",
  docs: [{ label: "stand.fm ヘルプ", url: "https://stand.fm/help" }],
  notes: ["stand.fm は外部からの配信APIを提供していません。アプリから収録・配信してください。"],
});
