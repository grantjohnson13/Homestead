import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * The dev host is the only way to look at the farm view outside Claude, so it
 * needs to keep working — a broken srcdoc or a missing route fails silently and
 * is only noticed when someone tries to see the game.
 */
describe("the local dev host", () => {
  async function fetchDev(path: string): Promise<{ status: number; html: string }> {
    const response = await SELF.fetch(`https://homestead.test${path}`);
    return { status: response.status, html: await response.text() };
  }

  it("is served at /dev", async () => {
    const { status, html } = await fetchDev("/dev");
    expect(status).toBe(200);
    expect(html).toContain("dev host");
  });

  it("defaults to the demo farm and honours ?farm=", async () => {
    const fallback = await fetchDev("/dev");
    expect(fallback.html).toContain("/mcp/demo");

    const keyed = await fetchDev("/dev?farm=dev-farm");
    expect(keyed.html).toContain("/mcp/dev-farm");
  });

  it("sanitises the farm key out of the URL", async () => {
    const { html } = await fetchDev("/dev?farm=../../evil%20key");
    expect(html).not.toContain("../..");
    expect(html).not.toContain("evil key");
  });

  it("embeds the whole farm view in the iframe", async () => {
    const { html } = await fetchDev("/dev?farm=dev-farm");
    // srcdoc-escaped, so the view's own markup appears with escaped quotes.
    expect(html).toContain("srcdoc=");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("id=&quot;t-grass&quot;");
    expect(html).toContain("id=&quot;ch-wren-down&quot;");
  });

  it("plays the host side of the protocol", async () => {
    const { html } = await fetchDev("/dev");
    // Answers the handshake, proxies tool calls, and pushes theme changes.
    expect(html).toContain("ui/initialize");
    expect(html).toContain("hostContext");
    expect(html).toContain("tools/call");
    expect(html).toContain("ui/notifications/host-context-changed");
  });

  it("filters non-JSON-RPC frames on its side too", async () => {
    const { html } = await fetchDev("/dev");
    expect(html).toContain('msg.jsonrpc !== "2.0"');
  });

  it("needs no external resources of its own", async () => {
    const { html } = await fetchDev("/dev");
    const urls = [...html.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)]
      .map((m) => m[0])
      .filter((url) => !url.includes("w3.org"));
    expect(urls).toEqual([]);
  });
});
