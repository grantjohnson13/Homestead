/**
 * A minimal MCP Apps *host*, for local development only.
 *
 * The farm view is designed to run inside a host like claude.ai: it speaks
 * JSON-RPC over postMessage to `window.parent` and never touches the network
 * itself. That makes it impossible to look at in a plain browser — which is
 * exactly the problem this page solves.
 *
 * It embeds the real, unmodified farm view in an iframe and plays the other end
 * of the protocol: answers `ui/initialize`, supplies host context (theme, safe
 * areas), and proxies `tools/call` to the MCP endpoint over same-origin HTTP.
 *
 * Not part of the game. Served at /dev so the deployed Worker can be poked at
 * too, but it is a development tool, not a second client.
 */

import { FARM_VIEW_HTML } from "../ui/generated/farm-view.html.ts";

export function devHostPage(farmKey: string): string {
  // The view goes into a srcdoc attribute, so only the quote character and
  // ampersands need escaping — the iframe still gets a real `window.parent`.
  const srcdoc = FARM_VIEW_HTML.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homestead — dev host</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
    background: #efeadc; color: #3b3128;
    display: flex; flex-direction: column; min-height: 100vh;
  }
  body.dark { background: #17150f; color: #ece4d8; }
  header {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px; border-bottom: 1px solid rgba(127,127,127,.3);
  }
  h1 { font-size: 15px; margin: 0; font-weight: 700; }
  .tag {
    font-size: 12px; padding: 2px 8px; border-radius: 999px;
    background: rgba(127,127,127,.18);
  }
  .spacer { margin-left: auto; }
  button {
    font: inherit; padding: 4px 11px; border-radius: 7px; cursor: pointer;
    border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit;
  }
  button:hover { background: rgba(127,127,127,.14); }
  #status { font-size: 12px; opacity: .75; font-variant-numeric: tabular-nums; }
  #status.bad { color: #c25046; opacity: 1; font-weight: 600; }
  main { flex: 1; padding: 12px; display: flex; justify-content: center; }
  iframe {
    width: 100%; max-width: 920px; height: 760px; border: 0;
    border-radius: 12px; background: transparent;
    box-shadow: 0 2px 20px rgba(0,0,0,.14);
  }
  footer { padding: 8px 14px; font-size: 12px; opacity: .65; }
  code { font-family: ui-monospace, Menlo, monospace; }
</style>
</head>
<body>
  <header>
    <h1>🌾 Homestead</h1>
    <span class="tag">dev host</span>
    <span class="tag">farm: <code>${escapeText(farmKey)}</code></span>
    <span class="spacer"></span>
    <span id="status">connecting…</span>
    <button id="theme">Toggle theme</button>
  </header>

  <main>
    <iframe id="view" title="Farm view" srcdoc="${srcdoc}"></iframe>
  </main>

  <footer>
    This page plays the host side of the MCP Apps protocol so the farm view can
    run outside Claude. Tool calls are proxied to <code>/mcp/${escapeText(farmKey)}</code>.
  </footer>

<script>
(function () {
  "use strict";

  var FARM_KEY = ${JSON.stringify(farmKey)};
  var ENDPOINT = "/mcp/" + FARM_KEY;
  var PROTOCOL_VERSION = "2026-01-26";

  var frame = document.getElementById("view");
  var statusEl = document.getElementById("status");
  var theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  var calls = 0;

  document.body.classList.toggle("dark", theme === "dark");

  function setStatus(text, bad) {
    statusEl.textContent = text;
    statusEl.className = bad ? "bad" : "";
  }

  function post(message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, "*");
  }

  function hostContext() {
    return {
      theme: theme,
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      platform: "web",
      userAgent: "homestead-dev-host/1.0",
    };
  }

  /** Forwards a tools/call from the view to the MCP server over HTTP. */
  function callServer(id, params) {
    calls += 1;
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "host-" + calls, method: "tools/call", params: params }),
    })
      .then(function (response) { return response.text(); })
      .then(function (text) {
        var payload = parseBody(text);
        if (!payload) throw new Error("unparseable response");
        if (payload.error) throw new Error(payload.error.message || "tool error");
        post({ jsonrpc: "2.0", id: id, result: payload.result });
        setStatus("live · " + calls + " call" + (calls === 1 ? "" : "s"), false);
      })
      .catch(function (err) {
        post({ jsonrpc: "2.0", id: id, error: { code: -32000, message: String(err && err.message || err) } });
        setStatus("server unreachable — is npm run dev still running?", true);
      });
  }

  /** The server may answer as JSON or as a single SSE frame. */
  function parseBody(text) {
    if (!text) return null;
    if (text.indexOf("data:") === 0 || text.indexOf("\\ndata:") >= 0) {
      var lines = text.split(/\\r?\\n/);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("data:") === 0) {
          try { return JSON.parse(lines[i].slice(5).trim()); } catch (e) { return null; }
        }
      }
      return null;
    }
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;

    // Requests from the view.
    if (typeof msg.method === "string" && msg.id !== undefined && msg.id !== null) {
      if (msg.method === "ui/initialize") {
        post({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            hostInfo: { name: "homestead-dev-host", version: "1.0.0" },
            hostCapabilities: {},
            hostContext: hostContext(),
          },
        });
        setStatus("connected", false);
        return;
      }
      if (msg.method === "tools/call") {
        callServer(msg.id, msg.params || {});
        return;
      }
      // Anything else still needs an answer so the view does not stall.
      post({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }

    // Notifications from the view: size-changed, initialized, and friends.
    if (msg.method === "ui/notifications/size-changed" && msg.params && msg.params.height) {
      frame.style.height = Math.max(420, Math.min(1400, msg.params.height + 24)) + "px";
    }
  });

  document.getElementById("theme").addEventListener("click", function () {
    theme = theme === "dark" ? "light" : "dark";
    document.body.classList.toggle("dark", theme === "dark");
    post({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: theme },
    });
  });
})();
</script>
</body>
</html>`;
}

function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
