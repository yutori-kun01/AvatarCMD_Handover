// Deterministic regression suite: execute production TypeScript with only infrastructure
// boundaries replaced. No real SNS posts, database mutations or credentials are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const coreRequire = createRequire(
  path.join(root, "packages/core/package.json"),
);
const checks = [];
const test = (name, fn) => checks.push([name, fn]);
function load(file, deps = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      require: (n) => {
        if (Object.hasOwn(deps, n)) return deps[n];
        if (
          ["crypto", "path", "fs/promises", "net", "dns/promises"].includes(n)
        )
          return require(n);
        throw Error("Unmocked dependency: " + n);
      },
      console: { log() {}, warn() {}, error() {} },
      process,
      Date,
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
      Buffer,
      fetch: deps.fetch,
    },
    { filename: file },
  );
  return module.exports;
}
const owned = { id: "avatar-a", userId: "user-a", status: "ACTIVE" };
function accessHarness() {
  const db = {
    avatar: {
      findFirst: async ({ where }) =>
        where.id === owned.id && where.userId === owned.userId ? owned : null,
    },
    content: {
      findFirst: async ({ where }) =>
        where.id === "content-a" && where.avatar.userId === "user-a"
          ? { avatarId: owned.id }
          : null,
    },
    knowledgeItem: {
      findFirst: async ({ where }) =>
        where.id === "knowledge-a" && where.avatar.userId === "user-a"
          ? { avatarId: owned.id, sourceUrl: "https://example.com/article" }
          : null,
    },
  };
  return load("packages/core/src/security/job-access.ts", {
    "@avatar-cmd/db": { prisma: db },
  });
}
test("Reject another user’s content even when avatarId is omitted", async () => {
  await assert.rejects(
    accessHarness().authorizeJob("user-a", "publish_post", {
      data: { contentId: "content-b" },
    }),
    /見つかりません/,
  );
});
test("Reject content/avatar mismatch and spoofed owner", async () => {
  await assert.rejects(
    accessHarness().authorizeJob("user-a", "publish_post", {
      avatarId: "avatar-b",
      data: { contentId: "content-a" },
    }),
    /一致しません/,
  );
  await assert.rejects(
    accessHarness().authorizeJob("user-b", "generate_post", {
      avatarId: "avatar-a",
      userId: "user-a",
    }),
    /見つかりません/,
  );
});
test("Derive the owner and target from stored content", async () => {
  const result = await accessHarness().authorizeJob("user-a", "publish_post", {
    userId: "user-b",
    data: { contentId: "content-a", success: true },
  });
  assert.equal(result.userId, "user-a");
  assert.equal(result.avatarId, "avatar-a");
  assert.equal(result.data.success, undefined);
});
test("Knowledge jobs cannot overwrite other users and cannot substitute the URL", async () => {
  await assert.rejects(
    accessHarness().authorizeJob("user-a", "fetch_knowledge", {
      data: { knowledgeId: "knowledge-b" },
    }),
    /見つかりません/,
  );
  const job = await accessHarness().authorizeJob("user-a", "fetch_knowledge", {
    data: { knowledgeId: "knowledge-a", url: "http://localhost" },
  });
  assert.equal(job.data.url, "https://example.com/article");
});
test("Internal browser-result and maintenance jobs cannot be submitted through the public API", async () => {
  for (const type of ["browser_result", "system_maintenance"])
    await assert.rejects(
      accessHarness().authorizeJob("user-a", type, {}),
      /手動実行できません/,
    );
});
test("Paused avatars cannot enqueue work", async () => {
  owned.status = "PAUSED";
  try {
    await assert.rejects(
      accessHarness().authorizeJob("user-a", "generate_post", {
        avatarId: owned.id,
      }),
      /停止中/,
    );
  } finally {
    owned.status = "ACTIVE";
  }
});
function publishingHarness(status = "APPROVED", fail = false) {
  const content = {
    id: "content-a",
    avatarId: "avatar-a",
    platform: "X",
    content: "Synthetic test",
    status,
    metadata: {},
    updatedAt: new Date(0),
    avatar: { status: "ACTIVE" },
  };
  let calls = 0;
  let scheduled = null;
  const logs = [];
  const match = (where) =>
    (!where.avatarId || where.avatarId === content.avatarId) &&
    (!where.id || where.id === content.id) &&
    (!where.avatar?.userId || where.avatar.userId === "user-a") &&
    (!where.avatar?.status || where.avatar.status === content.avatar.status) &&
    (!where.status ||
      (typeof where.status === "string"
        ? where.status === content.status
        : where.status.in?.includes(content.status))) &&
    (!where.metadata ||
      where.metadata.equals === content.metadata.publishAttemptId);
  const db = {
    content: {
      findFirst: async ({ where }) => (match(where) ? { ...content } : null),
      updateMany: async ({ where, data }) => {
        if (!match(where)) return { count: 0 };
        Object.assign(content, data);
        return { count: 1 };
      },
    },
    snsAccount: {
      findMany: async () => [
        { id: "account-a", authType: "oauth", accessToken: "encrypted-test" },
      ],
      update: async () => ({}),
    },
    scheduledPost: {
      updateMany: async ({ data }) => {
        scheduled = data;
        return { count: 1 };
      },
    },
    activityLog: {
      create: async ({ data }) => {
        logs.push(data);
        return data;
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  const provider = {
    post: async (_, credentials) => {
      calls++;
      assert.equal(credentials.operationMode, "api");
      await new Promise((r) => setTimeout(r, 1));
      if (fail) throw Error("timeout");
      return {
        success: true,
        postId: "123",
        url: "https://x.com/test/status/123",
      };
    },
  };
  const workers = load("packages/core/src/scheduler/workers.ts", {
    "@avatar-cmd/db": { prisma: db },
    "../persona/soul-engine": {},
    "../ai/router": {},
    "../security/url-guard": {},
    "@avatar-cmd/queue": {
      enqueueBrowserJob: async () => {
        throw Error("unexpected browser fallback");
      },
    },
    "@avatar-cmd/integrations": {
      createDefaultRegistry: () => ({
        get: (platform) => (platform === "x" ? provider : undefined),
      }),
    },
    "../security/credential-vault": {
      CredentialVault: class {
        decrypt() {
          return "synthetic-token";
        }
      },
    },
  });
  const publish = (
    payload = {
      avatarId: "avatar-a",
      userId: "user-a",
      data: { contentId: "content-a" },
    },
  ) => workers.processJob({ id: "job", type: "publish_post", payload });
  return {
    content,
    publish,
    workers,
    calls: () => calls,
    scheduled: () => scheduled,
    logs,
  };
}
test("Two simultaneous jobs produce exactly one external request", async () => {
  const h = publishingHarness();
  await Promise.all([h.publish(), h.publish()]);
  assert.equal(h.calls(), 1);
  assert.equal(h.content.status, "PUBLISHED");
  assert.equal(h.scheduled().status, "published");
});
test("Uppercase legacy X uses the lowercase provider", async () => {
  const h = publishingHarness();
  await h.publish();
  assert.equal(h.calls(), 1);
  assert.equal(h.content.platform, "x");
});
test("Unapproved drafts and published posts never send", async () => {
  for (const status of [
    "DRAFT",
    "REVIEW",
    "PUBLISHED",
    "PUBLISHING",
    "ARCHIVED",
  ]) {
    const h = publishingHarness(status);
    await h.publish();
    assert.equal(h.calls(), 0);
  }
});
test("Worker independently rejects a different avatar or user", async () => {
  const h = publishingHarness();
  await assert.rejects(
    h.publish({
      avatarId: "avatar-b",
      userId: "user-a",
      data: { contentId: "content-a" },
    }),
  );
  await assert.rejects(
    h.publish({
      avatarId: "avatar-a",
      userId: "user-b",
      data: { contentId: "content-a" },
    }),
  );
  assert.equal(h.calls(), 0);
});
test("Paused avatars do not publish an already queued job", async () => {
  const h = publishingHarness();
  h.content.avatar.status = "PAUSED";
  await h.publish();
  assert.equal(h.calls(), 0);
});
test("Ambiguous API response goes to REVIEW and never retries automatically", async () => {
  const h = publishingHarness("APPROVED", true);
  await h.publish();
  await h.publish();
  assert.equal(h.content.status, "REVIEW");
  assert.equal(h.calls(), 1);
  assert.equal(h.scheduled().status, "review");
});
test("Late browser results cannot overwrite a different attempt or terminal review", async () => {
  const h = publishingHarness("PUBLISHING");
  h.content.metadata.publishAttemptId = "new-attempt";
  const result = (token) =>
    h.workers.processJob({
      id: "result",
      type: "browser_result",
      payload: {
        avatarId: "avatar-a",
        data: {
          contentId: "content-a",
          attemptId: token,
          success: true,
          url: "https://example.com/post/1",
        },
      },
    });
  await result("old-attempt");
  assert.equal(h.content.status, "PUBLISHING");
  h.content.status = "REVIEW";
  await result("new-attempt");
  assert.equal(h.content.status, "REVIEW");
});
test("Matching browser result confirms publication once", async () => {
  const h = publishingHarness("PUBLISHING");
  h.content.metadata.publishAttemptId = "attempt";
  await h.workers.processJob({
    id: "result",
    type: "browser_result",
    payload: {
      avatarId: "avatar-a",
      data: {
        contentId: "content-a",
        attemptId: "attempt",
        success: true,
        url: "https://example.com/post/1",
      },
    },
  });
  assert.equal(h.content.status, "PUBLISHED");
  assert.equal(h.content.postUrl, "https://example.com/post/1");
});
test("A browser click is not considered publication without confirmation", async () => {
  const { executeOperations } = load(
    "packages/chrome-empire/src/operations.ts",
  );
  let clicked = false;
  const page = {
    goto: async () => {},
    locator: () => ({
      first: () => ({
        click: async () => {
          clicked = true;
        },
      }),
    }),
    url: () => "https://example.com/compose",
  };
  const res = await executeOperations(
    page,
    [
      {
        action: "post",
        url: "https://example.com/compose",
        selectors: { submit: "button" },
      },
    ],
    100,
  );
  assert.equal(res.success, false);
  assert.equal(clicked, false);
});
test("Failed browser confirmation is not reported as success", async () => {
  const { executeOperations } = load(
    "packages/chrome-empire/src/operations.ts",
  );
  const page = {
    goto: async () => {},
    locator: () => ({ first: () => ({ click: async () => {} }) }),
    waitForURL: async () => {
      throw Error("timeout");
    },
    url: () => "https://example.com/compose",
  };
  const res = await executeOperations(
    page,
    [
      {
        action: "post",
        url: "https://example.com/compose",
        confirmationUrlPattern: "/post/123$",
        selectors: { submit: "button" },
      },
    ],
    100,
  );
  assert.equal(res.success, false);
});
test("Confirmed browser result uses the actual page URL, not the compose URL", async () => {
  const { executeOperations } = load(
    "packages/chrome-empire/src/operations.ts",
  );
  const page = {
    goto: async () => {},
    locator: () => ({ first: () => ({ click: async () => {} }) }),
    waitForURL: async (predicate) => {
      assert.equal(predicate(new URL("https://example.com/post/123")), true);
    },
    url: () => "https://example.com/post/123",
  };
  const res = await executeOperations(
    page,
    [
      {
        action: "post",
        url: "https://example.com/compose",
        confirmationUrlPattern: "/post/123$",
        selectors: { submit: "button" },
      },
    ],
    100,
  );
  assert.equal(res.success, true);
  assert.equal(res.steps[0].url, "https://example.com/post/123");
});
function schedulerHarness(enqueueFails) {
  let state = "pending";
  const ids = [];
  let updates = 0;
  const scheduled = {
    id: "s1",
    updatedAt: new Date(0),
    contentId: "c1",
    content: { avatarId: "a1", avatar: { userId: "u1" } },
  };
  const prisma = {
    automationRule: { findMany: async () => [] },
    scheduledPost: {
      findMany: async () => (state === "pending" ? [scheduled] : []),
      updateMany: async ({ where, data }) => {
        if (where.id) {
          state = data.status;
          updates++;
        }
        return { count: 1 };
      },
    },
    content: { findMany: async () => [] },
  };
  const tick = load("packages/core/src/scheduler/tick.ts", {
    "../security/job-access": {},
    "cron-parser": coreRequire("cron-parser"),
    "@avatar-cmd/db": { prisma },
    "@avatar-cmd/queue": {
      withLock: async (_, __, fn) => fn(),
      enqueueAppJob: async (_, __, id) => {
        ids.push(id);
        if (enqueueFails()) throw Error("queue unavailable");
        return id;
      },
    },
  });
  return {
    tick: tick.runSchedulerTick,
    state: () => state,
    ids,
    updates: () => updates,
    validateCron: tick.validateCron,
  };
}
test("Queue failure leaves reservation pending and retry uses the same job ID", async () => {
  let fails = true;
  const h = schedulerHarness(() => fails);
  await assert.rejects(h.tick(), /queue unavailable/);
  assert.equal(h.state(), "pending");
  assert.equal(h.updates(), 0);
  fails = false;
  await h.tick();
  assert.equal(h.state(), "processing");
  assert.equal(h.ids[0], h.ids[1]);
});
test("Cron rejects impossible values and accepts a daily JST expression", () => {
  const h = schedulerHarness(() => false);
  h.validateCron("0 9 * * *");
  assert.throws(() => h.validateCron("99 99 * * *"));
  assert.throws(() => h.validateCron("0 0 9 * * *"));
});
test("SSRF checks reject private DNS answers, literal IPs and unsafe redirects", async () => {
  const guard = load("packages/core/src/security/url-guard.ts", {
    "dns/promises": {
      lookup: async (host) => [
        {
          address: host === "internal.example" ? "127.0.0.1" : "93.184.216.34",
        },
      ],
    },
    fetch: async () => ({
      status: 302,
      headers: { get: () => "http://127.0.0.1/" },
    }),
  });
  await assert.rejects(guard.assertPublicUrl("https://internal.example"));
  for (const url of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "file:///etc/passwd",
  ])
    await assert.rejects(guard.assertPublicUrl(url));
  await assert.rejects(guard.safeFetch("https://example.com"));
  assert.equal(
    (await guard.assertPublicUrl("https://example.com")).hostname,
    "example.com",
  );
});
test("Seed imports the generated client and the production worker includes integrations", () => {
  assert.match(
    fs.readFileSync(path.join(root, "packages/db/src/seed.ts"), "utf8"),
    /from "\.\.\/generated\/client"/,
  );
  const docker = fs
    .readFileSync(path.join(root, "Dockerfile"), "utf8")
    .split("FROM base AS worker")[1]
    .split("FROM base AS migrator")[0];
  assert.match(
    docker,
    /COPY --from=builder \/app\/packages\/integrations \.\/packages\/integrations/,
  );
});
(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try {
      await fn();
      console.log("PASS", name);
    } catch (e) {
      failed++;
      console.error("FAIL", name, e);
    }
  }
  console.log(`${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
})();
