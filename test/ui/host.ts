/**
 * A stand-in MCP Apps host: loads the real farm view HTML into jsdom, plays the
 * other end of the postMessage bridge, and records everything the app sends.
 *
 * This is how the lifecycle gets tested without a browser — including the nasty
 * cases, like the host injecting frames that are not JSON-RPC at all.
 */

import { JSDOM, VirtualConsole } from "jsdom";
import { FARM_VIEW_HTML } from "../../src/ui/generated/farm-view.html.ts";

export interface Frame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface HostOptions {
  /** Auto-answer ui/initialize. Off when a test wants to control the timing. */
  autoInitialize?: boolean;
  theme?: "light" | "dark";
  /** Canned responses for tools/call, keyed by tool name. */
  toolResults?: Record<string, unknown>;
}

export class MockHost {
  readonly dom: JSDOM;
  /** Every frame the app has posted to the host. */
  readonly sent: Frame[] = [];
  private options: HostOptions;
  private parentProxy!: { postMessage(message: Frame): void };

  constructor(options: HostOptions = {}) {
    this.options = { autoInitialize: true, theme: "light", ...options };

    const virtualConsole = new VirtualConsole();
    // The app logs debug lines; keep the test output clean.
    virtualConsole.on("jsdomError", () => {});

    this.dom = new JSDOM(FARM_VIEW_HTML, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: "https://app.test/",
      virtualConsole,
    });

    this.installBridge();
  }

  /**
   * The app posts to `window.parent`. In jsdom the page is top-level, so parent
   * is the window itself; intercepting postMessage lets the host see the frames
   * and reply on its own terms.
   */
  private installBridge(): void {
    const win = this.dom.window as unknown as Window & typeof globalThis;

    // One stable object: the app checks `event.source === window.parent` by
    // identity, so handing out a fresh proxy per access would make it reject
    // every reply the host sends.
    this.parentProxy = {
      postMessage: (message: Frame) => {
        this.sent.push(message);
        this.maybeAutoRespond(message);
      },
    };

    Object.defineProperty(win, "parent", {
      configurable: true,
      get: () => this.parentProxy,
    });
  }

  private maybeAutoRespond(message: Frame): void {
    if (!this.options.autoInitialize) return;

    if (message.method === "ui/initialize" && message.id !== undefined) {
      this.respond(message.id, {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "mock-host", version: "1.0.0" },
        hostCapabilities: {},
        hostContext: {
          theme: this.options.theme,
          safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      });
      return;
    }

    if (message.method === "tools/call" && message.id !== undefined) {
      const name = (message.params?.["name"] as string) ?? "";
      const canned = this.options.toolResults?.[name];
      if (canned === undefined) {
        this.respondError(message.id, "no canned result for " + name);
      } else {
        this.respond(message.id, { structuredContent: { state: canned } });
      }
    }
  }

  /** Delivers a frame to the app, exactly as a real host would. */
  deliver(data: unknown): void {
    const win = this.dom.window;
    const event = new win.MessageEvent("message", { data });
    Object.defineProperty(event, "source", { value: win.parent, configurable: true });
    win.dispatchEvent(event);
  }

  respond(id: number | string, result: unknown): void {
    this.deliver({ jsonrpc: "2.0", id, result });
  }

  respondError(id: number | string, message: string): void {
    this.deliver({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.deliver({ jsonrpc: "2.0", method, params: params ?? {} });
  }

  requestFromHost(id: number, method: string, params?: Record<string, unknown>): void {
    this.deliver({ jsonrpc: "2.0", id, method, params: params ?? {} });
  }

  /** Frames the app sent with this method. */
  sentWith(method: string): Frame[] {
    return this.sent.filter((frame) => frame.method === method);
  }

  lastSentWith(method: string): Frame | undefined {
    const all = this.sentWith(method);
    return all[all.length - 1];
  }

  get document(): Document {
    return this.dom.window.document as unknown as Document;
  }

  /** Lets pending promises and timers settle. */
  async settle(times = 3): Promise<void> {
    for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  render(state: unknown): void {
    const win = this.dom.window as unknown as {
      __homesteadRender?: (state: unknown) => void;
    };
    if (!win.__homesteadRender) throw new Error("renderer not exposed");
    win.__homesteadRender(state);
  }

  close(): void {
    this.dom.window.close();
  }
}
