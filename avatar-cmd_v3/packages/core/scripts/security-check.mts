// ================================================
// SSRF防御 / パストラバーサル防御の回帰チェック
// ================================================
// テストランナー未導入のため tsx で直接実行する。
//   pnpm --filter @avatar-cmd/core check:security
// 失敗時は終了コード 1 を返す。

import { assertPublicUrl, isBlockedAddress } from "../src/security/url-guard";
import { resolveAvatarFilePath } from "../src/persona/soul-engine";

const blockedUrls = [
  "http://127.0.0.1/admin",
  "http://localhost:3000/",
  "http://169.254.169.254/latest/meta-data/",
  "http://[::1]/",
  "http://10.0.0.5/",
  "http://192.168.1.1/",
  "http://172.16.0.1/",
  "http://100.64.0.1/",
  "file:///etc/passwd",
  "gopher://evil/",
  "http://0.0.0.0/",
  "http://[::ffff:127.0.0.1]/",
];
const allowedUrls = ["https://example.com/", "https://fonts.googleapis.com/css2?family=Inter"];

async function main() {
  let fail = 0;
  for (const u of blockedUrls) {
    try { await assertPublicUrl(u); console.log("NOT BLOCKED (BAD):", u); fail++; }
    catch (e) { console.log("blocked  :", u, "—", (e as Error).message.slice(0, 60)); }
  }
  for (const u of allowedUrls) {
    try { await assertPublicUrl(u); console.log("allowed  :", u); }
    catch (e) { console.log("BLOCKED (BAD):", u, (e as Error).message); fail++; }
  }

  // IPv6 の各レンジ（Nodeが16進へ正規化する射影アドレスを含む）
  const v6cases: [string, boolean][] = [
    ["::1", true], ["::", true], ["::ffff:127.0.0.1", true], ["::ffff:7f00:1", true],
    ["::ffff:10.0.0.1", true], ["fe80::1", true], ["fd00::1", true], ["fc00::1", true],
    ["ff02::1", true], ["64:ff9b::127.0.0.1", true], ["2002:7f00:1::1", true],
    ["2606:4700:4700::1111", false], ["2001:4860:4860::8888", false],
    ["::ffff:8.8.8.8", false], ["64:ff9b::8.8.8.8", false],
  ];
  for (const [ip, want] of v6cases) {
    const got = isBlockedAddress(ip);
    if (got !== want) { console.log(`MISMATCH ${ip}: got ${got} want ${want}`); fail++; }
    else console.log(`${want ? "blocked" : "allowed"}: ${ip}`);
  }
  for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/", "http://[fd00::1]/"]) {
    try { await assertPublicUrl(u); console.log("NOT BLOCKED (BAD):", u); fail++; }
    catch (e) { console.log("blocked:", u, "—", (e as Error).message.slice(0,55)); }
  }
  

  const badPaths: [string, string][] = [
    ["abc-123", "../../../../etc/passwd"],
    ["abc-123", "/etc/passwd"],
    ["../../etc", "soul.md"],
    ["abc-123", "memory/notes.md"],
    ["abc-123", "soul.md.bak"],
  ];
  for (const [id, fn] of badPaths) {
    try { resolveAvatarFilePath(id, fn); console.log("PATH NOT BLOCKED (BAD):", id, fn); fail++; }
    catch (e) { console.log("path blocked:", id, fn, "—", (e as Error).message.slice(0, 50)); }
  }
  console.log("ok path:", resolveAvatarFilePath("abc-123", "soul.md"));
  console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECKS FAILED`);
  if (fail > 0) process.exit(1);

}
main();
