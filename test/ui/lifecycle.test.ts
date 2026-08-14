import { afterEach, describe, expect, it } from "vitest";
import { MockHost } from "./host.ts";
import { fixtureState } from "./fixture.ts";

/**
 * The MCP Apps lifecycle, exercised against a mocked host — including the two
 * failure modes that are known to break apps on claude.ai in practice:
 * non-JSON-RPC frames injected into the message stream, and talking to the host
 * before the handshake has completed.
 */

let host: MockHost | null = null;

afterEach(() => {
  host?.close();
  host = null;
});

describe("handshake", () => {
  it("opens with ui/initialize carrying app info and protocol version", async () => {
    host = new MockHost();
    await host.settle();

    const init = host.lastSentWith("ui/initialize");
    expect(init).toBeDefined();
    expect(init?.id).toBeDefined();
    expect(init?.params?.["protocolVersion"]).toBe("2026-01-26");
    expect(init?.params?.["appInfo"]).toMatchObject({ name: "homestead-farm-view" });
    expect(init?.params).toHaveProperty("appCapabilities");
  });

  it("sends ui/notifications/initialized after the handshake resolves", async () => {
    host = new MockHost();
    await host.settle();

    const initialized = host.lastSentWith("ui/notifications/initialized");
    expect(initialized).toBeDefined();
    expect(initialized?.id).toBeUndefined(); // a notification, not a request
  });

  it("does not call any tool before the handshake completes", async () => {
    // No auto-initialize: the host deliberately withholds its reply.
    host = new MockHost({ autoInitialize: false });
    await host.settle(6);

    expect(host.sentWith("tools/call")).toHaveLength(0);
    expect(host.sentWith("ui/notifications/initialized")).toHaveLength(0);
    // ...and it did try to start the handshake.
    expect(host.sentWith("ui/initialize")).toHaveLength(1);
  });

  it("polls get_farm_state only once connected", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(6);

    const calls = host.sentWith("tools/call");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.params?.["name"]).toBe("get_farm_state");

    // The handshake must have come first.
    const initIndex = host.sent.findIndex((f) => f.method === "ui/initialize");
    const callIndex = host.sent.findIndex((f) => f.method === "tools/call");
    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(callIndex).toBeGreaterThan(initIndex);
  });

  it("reports its size to the host", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(6);
    expect(host.sentWith("ui/notifications/size-changed").length).toBeGreaterThan(0);
  });
});

describe("defensive message handling", () => {
  it("ignores host frames that are not JSON-RPC", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);
    const before = host.sent.length;

    // The shapes claude.ai has been observed to inject.
    host.deliver({ type: "auth", token: "abc", payload: { user: "someone" } });
    host.deliver({ type: "resize", height: 400 });
    host.deliver("a bare string");
    host.deliver(null);
    host.deliver(undefined);
    host.deliver(12345);
    host.deliver([1, 2, 3]);
    host.deliver({ jsonrpc: "1.0", method: "legacy/thing" });
    host.deliver({ jsonrpc: 2, method: "wrong/type" });

    await host.settle();

    // Nothing crashed, nothing was answered, and the app is still alive.
    expect(host.sent.length).toBe(before);
    expect(host.document.getElementById("app")).not.toBeNull();
  });

  it("stays responsive after being fed junk", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.deliver({ type: "nonsense" });
    host.deliver({ jsonrpc: "2.0" }); // no method, no id

    // A real request still gets answered.
    host.requestFromHost(9001, "ping");
    await host.settle();

    const reply = host.sent.find((f) => f.id === 9001);
    expect(reply).toBeDefined();
    expect(reply?.result).toEqual({});
  });

  it("does not throw on a malformed tool-result notification", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.notify("ui/notifications/tool-result", { structuredContent: null });
    host.notify("ui/notifications/tool-result", {});
    host.notify("ui/notifications/tool-result", { structuredContent: { state: null } });
    await host.settle();

    expect(host.document.getElementById("app")).not.toBeNull();
  });
});

describe("host requests", () => {
  it("answers ping", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.requestFromHost(42, "ping");
    await host.settle();

    expect(host.sent.find((f) => f.id === 42)?.result).toEqual({});
  });

  it("answers ui/resource-teardown and then goes quiet", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(6);

    host.requestFromHost(77, "ui/resource-teardown");
    await host.settle();

    expect(host.sent.find((f) => f.id === 77)?.result).toEqual({});

    const callsAfterTeardown = host.sentWith("tools/call").length;
    await host.settle(10);
    // No further polling once torn down.
    expect(host.sentWith("tools/call").length).toBe(callsAfterTeardown);
  });

  it("answers unknown requests rather than leaving the host hanging", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.requestFromHost(55, "ui/some-future-method");
    await host.settle();

    expect(host.sent.some((f) => f.id === 55)).toBe(true);
  });
});

describe("host context", () => {
  it("adopts the theme from the initialize result", async () => {
    host = new MockHost({ theme: "dark", toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    expect(host.document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows a later host-context-changed notification", async () => {
    host = new MockHost({ theme: "light", toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);
    expect(host.document.documentElement.getAttribute("data-theme")).toBe("light");

    host.notify("ui/notifications/host-context-changed", { theme: "dark" });
    await host.settle();
    expect(host.document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies host style variables", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.notify("ui/notifications/host-context-changed", {
      styles: { "--color-text-primary": "rgb(1, 2, 3)" },
    });
    await host.settle();

    expect(
      host.document.documentElement.style.getPropertyValue("--color-text-primary"),
    ).toBe("rgb(1, 2, 3)");
  });

  it("applies safe-area insets", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.notify("ui/notifications/host-context-changed", {
      safeAreaInsets: { top: 12, right: 4, bottom: 20, left: 4 },
    });
    await host.settle();

    expect(host.document.documentElement.style.getPropertyValue("--safe-top")).toBe("12px");
    expect(host.document.documentElement.style.getPropertyValue("--safe-bottom")).toBe("20px");
  });

  it("ignores a nonsense host context instead of breaking", async () => {
    host = new MockHost({ toolResults: { get_farm_state: fixtureState() } });
    await host.settle(4);

    host.notify("ui/notifications/host-context-changed", { theme: "chartreuse" });
    host.notify("ui/notifications/host-context-changed", { safeAreaInsets: "nope" });
    await host.settle();

    expect(host.document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("rendering from a tool result", () => {
  it("draws the farm when the host pushes a tool result", async () => {
    host = new MockHost({ autoInitialize: true });
    await host.settle(4);

    host.notify("ui/notifications/tool-result", {
      structuredContent: { state: fixtureState() },
    });
    await host.settle();

    const actors = host.document.querySelectorAll("#actors .actor");
    expect(actors.length).toBeGreaterThan(0);
  });

  it("survives being handed a completely fresh state, as after a remount", async () => {
    host = new MockHost({ autoInitialize: true });
    await host.settle(4);

    host.render(fixtureState());
    const first = host.document.querySelectorAll("#plots use").length;

    host.render(fixtureState());
    const second = host.document.querySelectorAll("#plots use").length;

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
  });
});
