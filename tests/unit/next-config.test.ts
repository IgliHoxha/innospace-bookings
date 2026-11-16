import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.mjs";

// The image is only Next's standalone output, so what the config traces into it decides whether the server starts.
const excluded = nextConfig.outputFileTracingExcludes?.["*"] ?? [];

describe("the standalone server bundle", () => {
  it("is built as a self-contained server", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("keeps the native SQLite module external, so its binary is traced in", () => {
    expect(nextConfig.serverExternalPackages).toContain("better-sqlite3");
  });

  it("leaves out sharp and the TypeScript compiler, which the server never loads", () => {
    expect(excluded).toEqual([
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/typescript/**",
    ]);
  });

  it("serves images unoptimised, since the optimiser's sharp is left out", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("never leaves out a package the running server needs", () => {
    for (const needed of [
      "better-sqlite3",
      "bindings",
      "file-uri-to-path",
      "next",
      "react",
      "react-dom",
      "resend",
    ]) {
      const hit = excluded.find(
        (pattern) =>
          pattern === `node_modules/${needed}/**` ||
          pattern.startsWith(`node_modules/${needed}/`),
      );
      expect(hit, `${needed} must stay in the bundle`).toBeUndefined();
    }
    expect(excluded.some((pattern) => pattern.includes("*/**/*"))).toBe(false);
    expect(excluded).not.toContain("node_modules/**");
  });
});
