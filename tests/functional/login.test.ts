import { beforeEach, describe, expect, it } from "vitest";
import { makeRequest, resetApp, sessionToken } from "../helpers/app";
import { ADMIN_PASS, ADMIN_USER } from "../helpers/fixtures";
import { SESSION_COOKIE } from "@/lib/auth";

type Route = typeof import("@/app/api/login/route");
let route: Route;

beforeEach(async () => {
  resetApp();
  route = await import("@/app/api/login/route");
});

const post = (body: unknown) =>
  route.POST(makeRequest("/api/login", { method: "POST", body }));

describe("POST /api/login", () => {
  it("signs in with the configured env credentials and sets a session cookie", async () => {
    const res = await post({ username: ADMIN_USER, password: ADMIN_PASS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("401s a wrong password", async () => {
    const res = await post({ username: ADMIN_USER, password: "nope" });
    expect(res.status).toBe(401);
  });

  it("401s a missing field", async () => {
    expect((await post({ username: ADMIN_USER })).status).toBe(401);
  });

  it("401s on a malformed JSON body (parse falls back to empty)", async () => {
    const res = await route.POST(
      makeRequest("/api/login", { method: "POST", rawBody: "{ not json" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/login", () => {
  const logout = (token?: string) =>
    route.DELETE(makeRequest("/api/login", { method: "DELETE", token }));

  it("signs out by clearing the session cookie", async () => {
    const res = await logout(sessionToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("401s without a session, so a forged cross-site logout can't clear it", async () => {
    expect((await logout()).status).toBe(401);
  });
});
