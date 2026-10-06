// ================================================
// @avatar-cmd/integrations — 型定義
// ================================================
// 1プラットフォーム = 1つの PlatformDefinition。
// 「ダッシュボードで入力する値」（開発者アプリ情報・アカウント接続情報）は
// FieldDef で宣言し、UI はこの定義からフォームを自動生成する。

export type Platform =
  | "x"
  | "threads"
  | "instagram"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "reddit"
  | "tiktok"
  | "bluesky"
  | "wordpress"
  | "zenn"
  | "medium"
  | "note"
  | "substack"
  | "ameba"
  | "standfm";

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

/** 接続情報（暗号化して DB に保存される） */
export type Credentials = Record<string, unknown> & {
  accessToken?: string;
  refreshToken?: string;
  /** ISO 8601。アクセストークンの失効時刻 */
  expiresAt?: string;
  /** ISO 8601。トークンを取得/更新した時刻 */
  issuedAt?: string;
};

export interface ConnectedAccount {
  accountId: string;
  accountName: string;
  profileUrl?: string;
  credentials: Credentials;
  settings?: Record<string, unknown>;
  scopes?: string;
}

/** システム設定（ダッシュボードの「システム」タブで変更可能） */
export interface SystemConfig {
  /** 公開URL（OAuthコールバック・メディア公開URLの生成に使う） */
  appUrl: string;
  /** Meta Graph API バージョン（Facebook / Instagram） */
  metaGraphVersion: string;
  /** LinkedIn-Version ヘッダ (YYYYMM) */
  linkedinVersion: string;
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  appUrl: "http://localhost:3333",
  metaGraphVersion: "v26.0",
  linkedinVersion: "202604",
};

export interface MediaFile {
  /** 公開URL（Instagram / Threads 等の「URLから取り込み」型APIに渡す） */
  url: string;
  mimeType: string;
  filename: string;
  size: number;
  alt?: string;
  /** 実体のバイト列を読む（アップロード型APIで使う） */
  load(): Promise<Uint8Array>;
}

/** アカウントの規模（取得できたものだけ入る） */
export interface ProfileStats {
  followers?: number;
  following?: number;
  posts?: number;
  /** プロフィール画像の URL（取得元の CDN。期限付きのことがあるので保存して使う） */
  imageUrl?: string;
}

/** アカウント単位の閲覧数・反応数（媒体が返せるものだけ） */
export interface AccountInsights {
  /** 日別の値（日本時間の "YYYY-MM-DD"）。媒体が日別で返せる場合 */
  daily?: { date: string; views?: number; engagements?: number }[];
  /** 累計（note の PV など）。前日の累計との差分を日別の値にする */
  totals?: { views?: number; engagements?: number };
}

/** 投稿の反応（取得できたものだけ入る） */
export interface PostMetrics {
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  shares?: number;
  bookmarks?: number;
}

/** タイムライン上の他者の投稿（引用候補の元） */
export interface TimelinePost {
  id: string;
  text: string;
  url: string;
  authorId?: string;
  authorUsername?: string;
  authorName?: string;
  createdAt?: string;
  lang?: string;
  metrics?: PostMetrics;
  /** リポスト・返信・引用など、元投稿そのものでないもの */
  kind: "original" | "repost" | "reply" | "quote";
}

export interface PostInput {
  text: string;
  title?: string;
  media: MediaFile[];
  link?: string;
  tags?: string[];
  /** プラットフォーム固有の投稿オプション（postFields の値） */
  options: Record<string, string>;
  /** 引用投稿: 引用元の投稿 ID（X: quote_tweet_id / Threads: quote_post_id） */
  quotePostId?: string;
  /** 引用元の投稿 URL（X で引用が拒否されたとき、本文に URL を入れて投稿し直すのに使う） */
  quotePostUrl?: string;
}

export interface PublishContext {
  app: Record<string, string>;
  credentials: Credentials;
  settings: Record<string, unknown>;
  account: { accountId: string; accountName: string };
  system: SystemConfig;
}

export interface PublishResult {
  postId: string;
  url?: string;
  /** 下書き保存のみ等、利用者に伝えたい補足 */
  note?: string;
}

export interface OAuthSpec {
  /** PKCE (S256) を使うか */
  pkce: boolean;
  authorizeUrl(
    app: Record<string, string>,
    p: { redirectUri: string; state: string; codeChallenge?: string; system: SystemConfig }
  ): string;
  /** 認可コードを交換し、接続するアカウント（複数可: Facebookページ等）を返す */
  exchangeCode(
    app: Record<string, string>,
    p: { code: string; redirectUri: string; codeVerifier?: string; system: SystemConfig }
  ): Promise<ConnectedAccount[]>;
}

export type SupportLevel =
  | "official" // 公式APIで自動投稿
  | "legacy" // 公式APIだが新規発行停止など制限あり
  | "unofficial" // 公式APIなし。セッションを使った下書き保存
  | "manual"; // 自動投稿非対応（手動運用）

export interface PlatformDefinition {
  id: Platform;
  name: string;
  icon: string;
  support: SupportLevel;
  connection: "oauth" | "credentials" | "none";
  maxLength?: number;
  /** 「API連携アプリ」で入力する開発者アプリ情報 */
  appFields: FieldDef[];
  /** 「アカウント接続」で入力する値（connection=credentials の場合） */
  accountFields: FieldDef[];
  /** アカウントごとの投稿設定（秘密でない値） */
  settingFields: FieldDef[];
  /** 投稿ごとの追加入力 */
  postFields: FieldDef[];
  media: { image: boolean; video: boolean; required?: "image" | "video" | "any"; maxCount?: number };
  docs: { label: string; url: string }[];
  /** 開発者ポータルで登録するときの注意（リダイレクトURI・審査など） */
  notes: string[];
  oauth?: OAuthSpec;
  /** connection=credentials: 入力値を検証してアカウント情報を返す */
  connect?(app: Record<string, string>, input: Record<string, string>, system: SystemConfig): Promise<ConnectedAccount>;
  /** トークン更新が必要なら新しい credentials を返す。不要なら null */
  refresh?(app: Record<string, string>, credentials: Credentials, system: SystemConfig): Promise<Credentials | null>;
  publish?(ctx: PublishContext, post: PostInput): Promise<PublishResult>;
  /** 自分の投稿の反応を取得する。取得できない投稿はエラー理由を返す */
  fetchMetrics?(ctx: PublishContext, posts: { postId: string; publishedAt: Date }[]): Promise<Record<string, PostMetrics | { error: string }>>;
  /** アカウントのフォロワー数など（1日1回程度取得して推移を記録する） */
  fetchProfile?(ctx: PublishContext): Promise<ProfileStats>;
  /** アカウント単位の閲覧数・反応数（1日1回。fetchProfile と同じタイミングで取得する） */
  fetchInsights?(ctx: PublishContext, opts: { days: number }): Promise<AccountInsights>;
  /** 自分のホームタイムライン（フォロー中の投稿）を新しい順に取得する */
  fetchTimeline?(ctx: PublishContext, opts: { maxResults: number; sinceId?: string }): Promise<TimelinePost[]>;
  /** 引用投稿に対応しているか */
  supportsQuote?: boolean;
  /** ユーザー情報（名前・フォロワー数）をまとめて取得する（X は 1 件ごとに課金されるのでキャッシュして使う） */
  lookupUsers?(ctx: PublishContext, ids: string[]): Promise<{ id: string; username: string; name?: string; followers?: number }[]>;
}
