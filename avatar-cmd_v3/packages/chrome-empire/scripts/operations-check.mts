// ================================================
// BrowserOperation 実行の回帰チェック
// ================================================
// ローカルに立てたダミーのフォームページに対して操作列を実行し、
// 入力・送信・一覧取得・失敗時の中断を確認する。
//
// 実ブラウザが必要:
//   pnpm exec playwright install chromium
// で取得するか、既にあるバイナリを CHROMIUM_EXECUTABLE で指定する。
//
//   pnpm --filter @avatar-cmd/chrome-empire check:operations

import { createServer, type Server } from "http";
import { chromium } from "playwright";
import { executeOperations, type OperationStep } from "../src/operations";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  console.log(
    `  ${ok ? "OK " : "NG "} ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`
  );
  if (!ok) failures++;
}

/** 投稿フォームと一覧ページを持つダミーサイト */
function startSite(): Promise<{
  server: Server;
  origin: string;
  submitted: () => unknown;
}> {
  let lastSubmission: unknown = null;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/compose") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>
        <input id="title" />
        <div id="editor" contenteditable="true"></div>
        <button id="publish" onclick="
          fetch('/submit', { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ title: document.getElementById('title').value,
                                   body: document.getElementById('editor').innerText }) })
            .then(function () { history.pushState({}, '', '/published/1'); document.body.innerHTML = '<p id=done>done</p>'; });
        ">publish</button>
      </body></html>`);
      return;
    }

    if (url.pathname === "/submit" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          lastSubmission = JSON.parse(raw);
        } catch {
          lastSubmission = raw;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
      return;
    }

    if (url.pathname === "/list") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body><ul id="results">
        <li class="row">1件目の記事</li><li class="row">2件目の記事</li><li class="row">3件目の記事</li>
      </ul></body></html>`);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        server,
        origin: `http://127.0.0.1:${port}`,
        submitted: () => lastSubmission,
      });
    });
  });
}

async function main() {
  const site = await startSite();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const page = await browser.newPage();

  try {
    console.log("── 入力して送信できる（contenteditable も含む）");
    const postSteps: OperationStep[] = [
      {
        action: "post",
        confirmationUrlPattern: "/published/1$",
        url: `${site.origin}/compose`,
        waitFor: "#publish",
        selectors: { title: "#title", editor: "#editor", submit: "#publish" },
        inputData: { title: "テストタイトル", editor: "本文のテキスト" },
      },
    ];
    let result = await executeOperations(page, postSteps, 15_000);
    check("成功する", result.success, result.error);
    check(
      "submit が押される",
      result.steps[0]?.submitted === "#publish",
      result.steps[0]?.submitted
    );

    // 送信は fetch なので完了を待つ
    await page.waitForSelector("#done", { timeout: 10_000 }).catch(() => undefined);
    const submitted = site.submitted() as { title?: string; body?: string } | null;
    check("title が送信される", submitted?.title === "テストタイトル", submitted?.title);
    check(
      "contenteditable の本文が送信される",
      submitted?.body === "本文のテキスト",
      submitted?.body
    );

    console.log("── read は一覧を取得し、送信はしない");
    result = await executeOperations(
      page,
      [
        {
          action: "read",
          url: `${site.origin}/list`,
          waitFor: "#results",
          selectors: { items: "#results .row", submit: "#publish" },
        },
      ],
      15_000
    );
    check("成功する", result.success, result.error);
    check("3件取得できる", result.steps[0]?.items?.length === 3, result.steps[0]?.items);
    check(
      "submit は押さない",
      result.steps[0]?.submitted === undefined,
      result.steps[0]?.submitted
    );

    console.log("── セレクタが見つからない場合は失敗し、以降を実行しない");
    result = await executeOperations(
      page,
      [
        {
          action: "post",
        confirmationUrlPattern: "/published/1$",
          url: `${site.origin}/compose`,
          selectors: { title: "#does-not-exist", submit: "#publish" },
          inputData: { title: "x" },
          timeout: 2_000,
        },
        {
          action: "read",
          url: `${site.origin}/list`,
          selectors: { items: "#results .row" },
        },
      ],
      15_000
    );
    check("失敗になる", !result.success, result.error);
    check("1ステップ目で止まる", result.steps.length === 1, result.steps.length);
    check(
      "エラーにステップ番号が入る",
      (result.error ?? "").includes("step 1/2"),
      result.error
    );

    console.log("── 到達できない URL も失敗として扱う");
    result = await executeOperations(
      page,
      [{ action: "navigate", url: "http://127.0.0.1:1/", timeout: 3_000 }],
      15_000
    );
    check("失敗になる", !result.success, result.error);
  } finally {
    await browser.close().catch(() => undefined);
    site.server.close();
  }

  console.log();
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECKS FAILED`);
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(() => process.exit(failures > 0 ? 1 : 0));
