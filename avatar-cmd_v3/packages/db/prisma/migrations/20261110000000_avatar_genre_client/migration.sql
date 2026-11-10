-- v3.8: アバターのジャンル（自動判定）とクライアントのラベル（任意）
ALTER TABLE "avatars" ADD COLUMN "genre" TEXT;
ALTER TABLE "avatars" ADD COLUMN "genre_meta" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "avatars" ADD COLUMN "client_label" TEXT;
