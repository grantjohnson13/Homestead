import { afterEach, describe, expect, it } from "vitest";
import { MockHost } from "./host.ts";
import { fixtureState } from "./fixture.ts";

/**
 * The speed control is the one thing the view is allowed to change. Everything
 * else about the farm is driven from the conversation; pace is a property of
 * how you *watch* the world, not of the world itself.
 */

let host: MockHost | null = null;

afterEach(() => {
  host?.close();
  host = null;
});

function stateAt(speed: number) {
  return { ...fixtureState(), speed };
}

async function mounted(speed: number): Promise<MockHost> {
  const created = new MockHost({
    autoInitialize: true,
    toolResults: { set_speed: stateAt(speed * 2), get_farm_state: stateAt(speed) },
  });
  host = created;
  await created.settle(4);
  created.render(stateAt(speed));
  return created;
}

describe("the speed button", () => {
  it("shows the current speed", async () => {
    const h = await mounted(5);
    expect(h.document.getElementById("stat-speed")?.textContent).toBe("5x");
  });

  it("looks calm at normal speed and loud when racing", async () => {
    const normal = await mounted(1);
    const button = normal.document.getElementById("speed-button");
    expect(button?.className).not.toContain("fast");
    normal.close();
    host = null;

    const fast = await mounted(60);
    expect(fast.document.getElementById("speed-button")?.className).toContain("fast");
  });

  it("marks a slowed world differently from a sped-up one", async () => {
    const h = await mounted(0.5);
    const button = h.document.getElementById("speed-button");
    expect(button?.className).toContain("slow");
    expect(button?.className).not.toContain("fast");
    expect(h.document.getElementById("stat-speed")?.textContent).toBe("0.5x");
  });

  it("calls set_speed with the next rung up the ladder", async () => {
    const h = await mounted(2);
    const button = h.document.getElementById("speed-button") as HTMLElement;

    button.click();
    await h.settle(4);

    const call = h
      .sentWith("tools/call")
      .find((frame) => (frame.params as { name?: string })?.name === "set_speed");

    expect(call).toBeDefined();
    expect((call?.params as { arguments?: { speed?: number } })?.arguments?.speed).toBe(5);
  });

  it("wraps back round to the slowest after the top speed", async () => {
    const h = await mounted(360);
    const button = h.document.getElementById("speed-button") as HTMLElement;

    button.click();
    await h.settle(4);

    const call = h
      .sentWith("tools/call")
      .find((frame) => (frame.params as { name?: string })?.name === "set_speed");
    expect((call?.params as { arguments?: { speed?: number } })?.arguments?.speed).toBe(0.5);
  });

  it("shows the target immediately rather than waiting for the round trip", async () => {
    const h = await mounted(1);
    const button = h.document.getElementById("speed-button") as HTMLElement;

    button.click();
    // Before any response has been processed.
    expect(h.document.getElementById("stat-speed")?.textContent).toBe("2x");
    expect(button.className).toContain("pending");
  });

  it("does nothing before the handshake has completed", async () => {
    const created = new MockHost({ autoInitialize: false });
    host = created;
    await created.settle(4);

    const button = created.document.getElementById("speed-button") as HTMLElement;
    button.click();
    await created.settle(2);

    expect(created.sentWith("tools/call")).toHaveLength(0);
  });

  it("recovers when the server refuses the change", async () => {
    const created = new MockHost({
      autoInitialize: true,
      toolResults: { get_farm_state: stateAt(1) },
    });
    host = created;
    await created.settle(4);
    created.render(stateAt(1));

    const button = created.document.getElementById("speed-button") as HTMLElement;
    button.click();
    await created.settle(6);

    // set_speed has no canned result, so the host errors it. The button must
    // not be left stuck mid-flight.
    expect(button.className).not.toContain("pending");
  });
});
