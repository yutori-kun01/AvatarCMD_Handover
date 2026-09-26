import { describe, it, expect } from "vitest";
import http from "http";
import { assertSafeUrl, isBlockedIp, safeFetch, SsrfError } from "../src/security/ssrf-guard";

describe("isBlockedIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "blocks %s",
    (ip) => expect(isBlockedIp(ip)).toBe(true)
  );
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("assertSafeUrl", () => {
  it.each([
    "file:///etc/passwd",
    "gopher://example.com",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/",
    "http://user:pass@example.com/",
    "http://example.com:6379/",
    "http://metadata.google.internal/",
    "not a url",
  ])("rejects %s", (u) => expect(() => assertSafeUrl(u)).toThrow(SsrfError));

  it("accepts public http(s) urls", () => {
    expect(assertSafeUrl("https://example.com/path?q=1").hostname).toBe("example.com");
  });
});

describe("safeFetch", () => {
  it("refuses hostnames that resolve to loopback (connect-time check)", async () => {
    // localtest.me style names are not guaranteed; use a raw hostname that resolves to 127.0.0.1 via /etc/hosts
    const server = http.createServer((_q, r) => r.end("secret"));
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    const port = (server.address() as { port: number }).port;
    process.env.SSRF_ALLOWED_PORTS = `80,443,${port}`;
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(SsrfError);
      // "ip6-localhost"/"localhost" blocked by name; a DNS name resolving to 127.x is blocked in lookup
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(SsrfError);
    } finally {
      delete process.env.SSRF_ALLOWED_PORTS;
      server.close();
    }
  });
});

import { safeLookup } from "../src/security/ssrf-guard";
describe("safeLookup", () => {
  it("rejects names resolving to private addresses (DNS rebinding defence)", async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((res) => safeLookup("localhost", {}, (e) => res(e)));
    expect(err?.code).toBe("ESSRF");
  });
});

import { extractText } from "../src/security/ssrf-guard";
describe("extractText", () => {
  it("strips scripts/styles/tags and decodes entities", () => {
    const html = `<html><head><title>T &amp; U</title><style>.a{}</style></head><body><script>alert(1)</script><h1>Hello</h1><p>A&nbsp;&lt;b&gt;</p></body></html>`;
    expect(extractText(html)).toEqual({ title: "T & U", text: "Hello A <b>" });
  });
});
