import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The build must not fetch fonts: Next 15 crashes on the URLs Google now sends, which blocked a deploy.
const APP = path.join(process.cwd(), "src", "app");
const css = fs.readFileSync(path.join(APP, "fonts.css"), "utf8");

const sources = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? sources(path.join(dir, entry.name))
        : /\.(ts|tsx|css)$/.test(entry.name)
          ? [path.join(dir, entry.name)]
          : [],
    );

/** Each @font-face in fonts.css, as its descriptors. */
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const read = (name: string) =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
  return {
    family: read("font-family").replace(/"/g, ""),
    weight: read("font-weight"),
    file: /url\("\.\/fonts\/([^"]+)"\)/.exec(body)?.[1],
    range: read("unicode-range"),
  };
});
const plex = faces.filter((face) => face.family === "IBM Plex Sans");

describe("fonts", () => {
  it("never loads a font from Google, at build time or in the browser", () => {
    const offenders = sources(path.join(process.cwd(), "src")).filter((file) =>
      /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(
        fs.readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("loads its stylesheet from the root layout, ahead of the app's own", () => {
    const layout = fs.readFileSync(path.join(APP, "layout.tsx"), "utf8");
    expect(layout).toContain('import "./fonts.css";');
    expect(layout.indexOf("./fonts.css")).toBeLessThan(
      layout.indexOf("./globals.css"),
    );
  });

  it("ships every font file the stylesheet names, and no stray one", () => {
    const named = [...new Set(plex.map((face) => face.file))].sort();
    const shipped = fs
      .readdirSync(path.join(APP, "fonts"))
      .filter((name) => name.endsWith(".woff2"))
      .sort();
    expect(named).toEqual(shipped);
    for (const name of shipped) {
      const file = fs.readFileSync(path.join(APP, "fonts", name));
      expect(file.subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
  });

  it("covers the three weights the UI uses in each of the six subsets", () => {
    const bySubset = new Map<string, string[]>();
    for (const face of plex) {
      const subset = face.file ?? "";
      bySubset.set(subset, [...(bySubset.get(subset) ?? []), face.weight]);
      expect(face.range).not.toBe("");
    }
    expect([...bySubset.keys()].sort()).toEqual([
      "ibm-plex-sans-cyrillic-ext.woff2",
      "ibm-plex-sans-cyrillic.woff2",
      "ibm-plex-sans-greek.woff2",
      "ibm-plex-sans-latin-ext.woff2",
      "ibm-plex-sans-latin.woff2",
      "ibm-plex-sans-vietnamese.woff2",
    ]);
    for (const weights of bySubset.values()) {
      expect(weights).toEqual(["400", "600", "700"]);
    }
  });

  it("defines the variable globals.css reads, with a metric-matched fallback", () => {
    expect(css).toContain(
      '--font-ibm-plex-sans: "IBM Plex Sans", "IBM Plex Sans Fallback";',
    );
    expect(fs.readFileSync(path.join(APP, "globals.css"), "utf8")).toContain(
      "var(--font-ibm-plex-sans)",
    );
    const fallback = faces.find(
      (face) => face.family === "IBM Plex Sans Fallback",
    );
    expect(fallback).toBeDefined();
    expect(css).toContain("size-adjust: 101.17%;");
  });

  it("keeps the font's licence beside the files", () => {
    const licence = fs.readFileSync(path.join(APP, "fonts", "OFL.txt"), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
});
