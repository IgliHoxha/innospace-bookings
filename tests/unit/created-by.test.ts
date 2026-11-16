import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import CreatedBy from "@/app/dashboard/CreatedBy";

const html = renderToStaticMarkup(createElement(CreatedBy));
const APP = path.join(process.cwd(), "src", "app");

describe("CreatedBy", () => {
  it("credits Stack Rover in words, with the name in bold", () => {
    expect(html.replace(/<[^>]+>/g, "")).toBe("Created by stackrover.tech");
    expect(html).toContain("<strong>stackrover.tech</strong>");
  });

  it("links to the site in a new tab that cannot reach back into the dashboard", () => {
    expect(html).toMatch(/^<a class="created-by" /);
    expect(html).toContain('href="https://stackrover.tech"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });

  it("draws the cube mark as decoration, so a screen reader hears the words once", () => {
    expect(html).toContain('<svg class="created-by-mark"');
    expect(html).toContain('aria-hidden="true"');
    for (const colour of ["#0B1013", "#4CC9F0", "#1A262C", "#FF7A45"]) {
      expect(html).toContain(`fill="${colour}"`);
    }
  });

  it("is styled by the stylesheet and shown in the dashboard footer", () => {
    const css = fs.readFileSync(path.join(APP, "globals.css"), "utf8");
    for (const rule of [
      ".created-by {",
      ".created-by:hover {",
      ".created-by-mark {",
    ]) {
      expect(css).toContain(rule);
    }
    const dashboard = fs.readFileSync(
      path.join(APP, "dashboard", "DashboardClient.tsx"),
      "utf8",
    );
    expect(dashboard).toMatch(/<footer[\s\S]*<CreatedBy \/>[\s\S]*<\/footer>/);
  });
});
