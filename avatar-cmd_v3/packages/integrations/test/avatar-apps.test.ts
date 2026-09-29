// アバター専用の開発者アプリとトークン管理（実 DB を使う）
// 共通アプリ設定を一時的に書き換えるため、AVATAR_CMD_DB_TESTS=1 のときだけ実行する（CI で有効。本番 DB では実行しないこと）
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mockFetch } from "./helpers";

const hasDb = process.env.AVATAR_CMD_DB_TESTS === "1" && !!process.env.DATABASE_URL && !!process.env.ENCRYPTION_KEY;
const opts = { skip: hasDb ? false : "AVATAR_CMD_DB_TESTS=1（と DATABASE_URL / ENCRYPTION_KEY）が未設定" };

type Svc = typeof import("../src/server");
let svc: Svc;
let prisma: typeof import("@avatar-cmd/db").prisma;
let userId = "";
let avatarA = "";
let avatarB = "";
let originalShared: { config: string } | null = null;

before(async () => {
  if (!hasDb) return;
  svc = await import("../src/server");
  prisma = (await import("@avatar-cmd/db")).prisma;
  const tag = Date.now().toString(36);
  const user = await prisma.user.create({ data: { email: `apps-test-${tag}@example.com`, name: "test" } });
  userId = user.id;
  avatarA = (await prisma.avatar.create({ data: { userId, name: `A-${tag}` } })).id;
  avatarB = (await prisma.avatar.create({ data: { userId, name: `B-${tag}` } })).id;
  originalShared = await prisma.platformApp.findUnique({ where: { platform: "x" }, select: { config: true } });
  await svc.savePlatformApp("x", { clientId: "SHARED_ID", clientSecret: "SHARED_SECRET" });
});

after(async () => {
  if (!hasDb) return;
  await prisma.avatar.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  // 共通アプリ設定を元に戻す
  if (originalShared) await prisma.platformApp.update({ where: { platform: "x" }, data: { config: originalShared.config } });
  else await prisma.platformApp.deleteMany({ where: { platform: "x" } });
  await prisma.$disconnect();
});

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

test("専用アプリは必須項目がそろわないと保存できない", opts, async () => {
  await assert.rejects(svc.saveAvatarPlatformApp(avatarA, "x", { clientSecret: "S" }), /必須項目/);
  assert.equal(await svc.getAvatarPlatformApp(avatarA, "x"), null);
});

test("アバター専用アプリで認可・接続し、同じアプリでトークンを更新する", opts, async () => {
  await svc.saveAvatarPlatformApp(avatarA, "x", { clientId: "OWN_ID", clientSecret: "OWN_SECRET" });

  // 認可URL: A は専用アプリ、B は共通アプリの Client ID
  const urlA = new URL(await svc.startOAuth("x", avatarA));
  const urlB = new URL(await svc.startOAuth("x", avatarB));
  assert.equal(urlA.searchParams.get("client_id"), "OWN_ID");
  assert.equal(urlB.searchParams.get("client_id"), "SHARED_ID");

  const m = mockFetch([
    [
      "POST",
      /api\.x\.com\/2\/oauth2\/token/,
      (c) => ({
        json: {
          access_token: c.form?.grant_type === "refresh_token" ? "AT2" : "AT1",
          refresh_token: c.form?.grant_type === "refresh_token" ? "RT2" : "RT1",
          expires_in: 7200,
          scope: "tweet.read tweet.write users.read media.write offline.access",
        },
      }),
    ],
    ["GET", /api\.x\.com\/2\/users\/me/, { data: { id: "u1", username: "avatar_a" } }],
  ]);
  try {
    const [saved] = await svc.finishOAuth("x", urlA.searchParams.get("state")!, "CODE");
    assert.equal(saved.appScope, "avatar");
    assert.equal(m.calls[0].headers.authorization, basic("OWN_ID", "OWN_SECRET"));

    // 認証情報の表示: 秘密は伏せ字、ユーザー名はそのまま
    const info = await svc.describeAccountCredentials(saved.id);
    assert.equal(info.appScope, "avatar");
    assert.ok(info.hasRefreshToken && info.canRefresh);
    const byKey = Object.fromEntries(info.fields.map((f) => [f.key, f]));
    assert.equal(byKey.username.value, "avatar_a");
    assert.equal(byKey.accessToken.secret, true);
    assert.ok(!byKey.accessToken.value.includes("AT1"));
    assert.ok(!JSON.stringify(info).includes("RT1"));

    // 期限前でも「今すぐ更新」でき、専用アプリの認証で更新される
    await svc.refreshAccountNow(saved.id);
    const refreshCall = m.calls.filter((c) => c.form?.grant_type === "refresh_token");
    assert.equal(refreshCall.length, 1);
    assert.equal(refreshCall[0].form?.refresh_token, "RT1");
    assert.equal(refreshCall[0].headers.authorization, basic("OWN_ID", "OWN_SECRET"));
    const { credentials } = await svc.loadFreshCredentials(saved.id);
    assert.equal(credentials.accessToken, "AT2");
    assert.equal(credentials.refreshToken, "RT2");

    // 専用アプリを解除すると、そのアプリで接続したアカウントは再接続を求める
    await svc.deleteAvatarPlatformApp(avatarA, "x");
    await assert.rejects(svc.loadFreshCredentials(saved.id), /再接続/);
  } finally {
    m.restore();
  }
});

test("共通アプリで接続したアカウントは、後から専用アプリを登録しても共通アプリで更新する", opts, async () => {
  const m = mockFetch([
    ["POST", /api\.x\.com\/2\/oauth2\/token/, { access_token: "B1", refresh_token: "BR1", expires_in: 7200 }],
    ["GET", /api\.x\.com\/2\/users\/me/, { data: { id: "u2", username: "avatar_b" } }],
  ]);
  try {
    const url = new URL(await svc.startOAuth("x", avatarB));
    const [saved] = await svc.finishOAuth("x", url.searchParams.get("state")!, "CODE");
    assert.equal(saved.appScope, "shared");
    await svc.saveAvatarPlatformApp(avatarB, "x", { clientId: "B_OWN", clientSecret: "B_SECRET" });
    await svc.refreshAccountNow(saved.id);
    const last = m.calls.filter((c) => c.form?.grant_type === "refresh_token").at(-1)!;
    assert.equal(last.headers.authorization, basic("SHARED_ID", "SHARED_SECRET"));
  } finally {
    m.restore();
  }
});

test("別ブラウザ用の認可 URL: 完了を元の画面が読み取れ、同じ URL は1回しか使えない", opts, async () => {
  const m = mockFetch([
    ["POST", /api\.x\.com\/2\/oauth2\/token/, { access_token: "E1", refresh_token: "ER1", expires_in: 7200 }],
    ["GET", /api\.x\.com\/2\/users\/me/, { data: { id: "u-ext", username: "ext_user" } }],
  ]);
  try {
    const link = await svc.createOAuthLink("x", avatarB);
    assert.equal(new URL(link.url).searchParams.get("state"), link.state);
    assert.equal(await svc.getOAuthMode(link.state), "external");
    assert.deepEqual(await svc.getOAuthLinkStatus(link.state), { status: "pending" });

    const saved = await svc.finishOAuth("x", link.state, "CODE");
    await svc.recordOAuthResult(link.state, { ok: true, message: saved[0].accountName });
    assert.deepEqual(await svc.getOAuthLinkStatus(link.state), { status: "done", ok: true, message: "@ext_user" });

    // 使用済みの URL をもう一度開いても失敗し、成功の結果は上書きされない
    await assert.rejects(svc.finishOAuth("x", link.state, "CODE"), /使用済み/);
    await svc.recordOAuthResult(link.state, { ok: false, message: "used" });
    assert.equal((await svc.getOAuthLinkStatus(link.state)).ok, true);

    // この画面で認可する通常の state はポーリング対象外
    const normal = new URL(await svc.startOAuth("x", avatarB)).searchParams.get("state")!;
    assert.equal((await svc.getOAuthLinkStatus(normal)).status, "unknown");

    // 同じ X アカウントを別アバターにも接続すると警告
    const again = await svc.createOAuthLink("x", avatarA);
    const dup = await svc.finishOAuth("x", again.state, "CODE");
    const warnings = await svc.sameAccountWarnings(dup);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /@ext_user/);
  } finally {
    m.restore();
  }
});
