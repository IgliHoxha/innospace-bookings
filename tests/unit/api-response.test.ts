import { describe, expect, it } from "vitest";
import { jsonError } from "@/lib/api-response";

describe("jsonError", () => {
  it("answers with the status and the ok/error body", async () => {
    const res = jsonError("Not found.", 404);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("adds nothing to the body beyond ok and error", async () => {
    const body = await jsonError("Invalid status.", 400).json();
    expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
  });

  it("carries extra headers, such as CORS or Retry-After", () => {
    const res = jsonError("Too many attempts.", 429, {
      "Retry-After": "60",
      "Access-Control-Allow-Origin": "https://ok.com",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://ok.com",
    );
  });

  it("sets no such header when none is passed", () => {
    const res = jsonError("Unauthorized", 401);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
