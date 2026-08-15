/**
 * A small landing page so that hitting the deployed URL in a browser explains
 * itself instead of 404-ing. Self-contained, no external assets.
 */

export function landingPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homestead</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 3rem 1.25rem; font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
    background: #f6f3ea; color: #3b3128; display: flex; justify-content: center;
  }
  @media (prefers-color-scheme: dark) { body { background: #1e1b17; color: #ece4d8; } }
  main { max-width: 44rem; width: 100%; }
  h1 { font-size: 2rem; margin: 0 0 .25rem; }
  .sub { opacity: .75; margin: 0 0 2rem; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
  }
  pre {
    background: rgba(127,127,127,.14); padding: .85rem 1rem; border-radius: .5rem;
    overflow-x: auto;
  }
  ol { padding-left: 1.25rem; }
  li { margin: .5rem 0; }
  .note { font-size: .9rem; opacity: .75; border-left: 3px solid rgba(127,127,127,.35);
          padding-left: .9rem; margin-top: 2rem; }
</style>
</head>
<body>
<main>
  <h1>🌾 Homestead</h1>
  <p class="sub">A farming game you play by talking to Claude.</p>

  <p>This is an MCP server, not a website. Connect it to Claude to play.</p>

  <ol>
    <li>Open Claude &rarr; <strong>Settings</strong> &rarr; <strong>Connectors</strong> &rarr;
        <strong>Add custom connector</strong>.</li>
    <li>Paste a URL with your own private farm key on the end:
      <pre>${escapeHtml(origin)}/mcp/your-secret-farm-key</pre>
    </li>
    <li>Save, then tell Claude: <em>&ldquo;Show me my farm.&rdquo;</em></li>
  </ol>

  <p>Anyone who knows your URL can play your farm, so pick something unguessable.
     The key is required &mdash; <code>/mcp</code> on its own will not serve a farm.</p>

  <p class="note">Your farm keeps running while you are away — crops grow, animals
     produce, and customers come and go for up to two game-hours before the world
     pauses and waits for you.</p>
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
