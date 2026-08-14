import { describe, expect, it } from "vitest";
import { assertSelfContained, buildFarmViewHtml } from "../../scripts/build-ui.ts";
import { FARM_VIEW_HTML } from "../../src/ui/generated/farm-view.html.ts";
import { MAP_ART } from "../../src/data/map.ts";

/**
 * The farm view has one non-negotiable property: it must be entirely
 * self-contained. Claude.ai enforces a hardcoded CSP on the app iframe and does
 * not reliably honour declared domains, so a single CDN reference silently
 * breaks the app in production while looking fine locally.
 */
describe("farm view build", () => {
  const html = buildFarmViewHtml();

  it("contains no external URLs at all", () => {
    // Whitelist only XML namespace identifiers, which are never fetched.
    const urls = [...html.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)]
      .map((m) => m[0])
      .filter((url) => !url.includes("w3.org"));

    expect(urls).toEqual([]);
  });

  it("has no src or href pointing off-origin", () => {
    expect(html).not.toMatch(/src=["'](https?:)?\/\//i);
    expect(html).not.toMatch(/href=["'](https?:)?\/\//i);
  });

  it("uses no @import or web fonts", () => {
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/@font-face/i);
    expect(html).not.toMatch(/fonts\.googleapis/i);
  });

  it("makes no network calls of its own", () => {
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/XMLHttpRequest/);
    expect(html).not.toMatch(/new WebSocket/);
    expect(html).not.toMatch(/importScripts/);
  });

  it("uses no eval, which the app CSP forbids", () => {
    expect(html).not.toMatch(/\beval\s*\(/);
    expect(html).not.toMatch(/new Function\s*\(/);
  });

  it("rejects a build that smuggles in an external reference", () => {
    expect(() => assertSelfContained('<img src="https://cdn.example.com/tile.png">')).toThrow(
      /self-contained/i,
    );
    expect(() => assertSelfContained("<style>@import url(x);</style>")).toThrow(/self-contained/i);
  });

  it("inlines the stylesheet, sprites and script", () => {
    expect(html).toContain("<style>");
    expect(html).toContain('id="t-grass"');
    expect(html).toContain('id="ch-wren-down"');
    expect(html).toContain("ui/initialize");
    // Placeholders must all have been substituted.
    expect(html).not.toContain("__STYLES__");
    expect(html).not.toContain("__SPRITES__");
    expect(html).not.toContain("__APP__");
    expect(html).not.toContain("__EMBED__");
  });

  it("embeds the map from src/data rather than duplicating it", () => {
    expect(html).toContain(JSON.stringify(MAP_ART[1]));
  });

  it("ships every crop's mature sprite", () => {
    for (const crop of ["radish", "lettuce", "tomato", "corn", "strawberry", "pumpkin"]) {
      expect(html, crop).toContain(`id="c-${crop}"`);
    }
  });

  it("ships all four Wren facings and both animals", () => {
    expect(html).toContain('id="ch-wren-down"');
    expect(html).toContain('id="ch-wren-up"');
    expect(html).toContain('id="ch-wren-side"');
    expect(html).toContain('id="a-chicken"');
    expect(html).toContain('id="a-cow"');
    expect(html).toContain('id="ch-customer"');
  });

  it("declares the animations the design calls for", () => {
    expect(html).toContain("@keyframes step");
    expect(html).toContain("@keyframes splash");
    expect(html).toContain("@keyframes twinkle");
    expect(html).toContain("patience-ring");
  });

  it("supports both themes", () => {
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('[data-theme="dark"]');
    expect(html).toContain("--color-text-primary");
  });

  it("respects reduced motion", () => {
    expect(html).toContain("prefers-reduced-motion");
  });

  it("is laid out to work down to a narrow phone", () => {
    // The sidebar stacks under the farm below this width, and the board scales
    // with its container rather than a fixed pixel size.
    expect(html).toMatch(/@media \(max-width: 6\d\dpx\)/);
    expect(html).toContain("width: 100%");
    expect(html).toContain("viewport-fit=cover");

    // Nothing may impose a width the phone cannot honour. Media query
    // conditions are stripped first: `@media (min-width: 621px)` is responsive
    // design, not an element demanding 621px. `max-width` is a cap rather than
    // a floor, so the lookbehind lets it through.
    const declarations = html.replace(/@media[^{]*\{/g, "{");
    expect(declarations).not.toMatch(/min-width:\s*[4-9]\d\dpx/);
    expect(declarations).not.toMatch(/(?<!-)\bwidth:\s*[4-9]\d\dpx/);
  });

  it("caps the sidebar so it can never shrink the farm", () => {
    // A long Investments list used to stretch the grid row and squeeze the
    // board beside it. The sidebar is now caged and scrolls internally.
    expect(html).toContain("side-shell");
    expect(html).toContain(".panels");
    expect(html).toMatch(/\.panels\s*\{[^}]*overflow-y:\s*auto/);
    // ...but only in the two-column layout; stacked on a phone it flows.
    expect(html).toMatch(/@media \(min-width: 6\d\dpx\)[\s\S]{0,400}position:\s*absolute/);
  });

  it("honours host safe-area insets", () => {
    expect(html).toContain("--safe-top");
    expect(html).toContain("--safe-bottom");
  });

  it("stays small enough to ship in a tool result", () => {
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(200_000);
  });

  it("matches the checked-in generated module", () => {
    expect(FARM_VIEW_HTML).toBe(html);
  });
});
