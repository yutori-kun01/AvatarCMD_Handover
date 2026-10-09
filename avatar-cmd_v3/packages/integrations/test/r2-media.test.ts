import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { mockFetch } from "./helpers";
import { signV4 } from "../src/service/r2";

let media: typeof import("../src/service/media");
const dir = mkdtempSync(path.join(tmpdir(), "r2-media-"));

before(async () => {
  // R2 の接続情報は .env（R2_*）から。エンドポイントは模擬
  process.env.MEDIA_DIR = dir;
  process.env.R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.R2_BUCKET = "avatar-media";
  process.env.R2_ACCESS_KEY_ID = "AKID";
  process.env.R2_SECRET_ACCESS_KEY = "SECRET";
  process.env.R2_ENDPOINT = "https://r2.test";
  media = await import("../src/service/media");
});

test("R2: SigV4 の署名は AWS の例と一致する", () => {
  const h = signV4({
    method: "GET",
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    headers: { range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    date: "20130524T000000Z",
  });
  assert.match(h.Authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test("R2: 保存は R2 に PUT（ローカルには書かない）、読み込み・存在確認・削除も R2", async () => {
  const stored = new Map<string, string>();
  const m = mockFetch([
    ["PUT", /^https:\/\/r2\.test\/avatar-media\/media\//, (c) => (stored.set(c.url, c.body), { status: 200 })],
    ["GET", /^https:\/\/r2\.test\/avatar-media\/media\//, (c) => (stored.has(c.url) ? { text: "PNGDATA" } : { status: 404, text: "<Error><Code>NoSuchKey</Code></Error>" })],
    ["HEAD", /^https:\/\/r2\.test\/avatar-media\/media\//, (c) => ({ status: stored.has(c.url) ? 200 : 404 })],
    ["DELETE", /^https:\/\/r2\.test\/avatar-media\/media\//, (c) => (stored.delete(c.url), { status: 204 })],
  ]);
  try {
    const ref = await media.saveMedia(new TextEncoder().encode("PNGDATA"), "a.png", "image/png");
    const put = m.calls.find((c) => c.method === "PUT")!;
    assert.equal(put.url, `https://r2.test/avatar-media/media/${ref.name}`);
    assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
    assert.equal(put.headers["content-type"], "image/png");
    assert.equal(await media.mediaExists(ref.name), true);
    assert.equal((await media.readMedia(ref.name)).toString(), "PNGDATA");
    await media.deleteMedia(ref.name);
    assert.equal(await media.mediaExists(ref.name), false);
    await assert.rejects(media.readMedia(ref.name), /見つかりません/);
  } finally {
    m.restore();
  }
});

test("R2: 切り替え前のローカルのファイルはローカルから読み、R2 へ移せる", async () => {
  const name = "11111111-2222-3333-4444-555555555555.png";
  writeFileSync(path.join(dir, name), "LOCAL");
  const stored = new Set<string>();
  const m = mockFetch([
    ["HEAD", /r2\.test/, (c) => ({ status: stored.has(c.url) ? 200 : 404 })],
    ["PUT", /r2\.test/, (c) => (stored.add(c.url), { status: 200 })],
  ]);
  try {
    assert.equal((await media.readMedia(name)).toString(), "LOCAL");
    assert.ok(!m.calls.some((c) => c.method === "GET"), "ローカルにあれば R2 は読まない");
    const r = await media.migrateMediaToR2({ deleteLocal: true });
    assert.equal(r.moved, 1);
    assert.equal(r.remaining, 0);
    assert.ok(stored.has(`https://r2.test/avatar-media/media/${name}`));
    assert.equal(await media.mediaExists(name), true); // ローカルは消えたが R2 にある
  } finally {
    m.restore();
  }
});
