import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  createOAuthAppCredential: vi.fn(),
}));

vi.mock("@calcom/lib/constants", () => ({ WEBAPP_URL_FOR_OAUTH: "https://app.example.com" }));
vi.mock("@calcom/lib/getSafeRedirectUrl", () => ({ getSafeRedirectUrl: () => null }));
vi.mock("@calcom/prisma", () => ({
  default: { credential: { findMany: mocks.findMany, deleteMany: mocks.deleteMany } },
}));
vi.mock("../../_utils/getInstalledAppPath", () => ({ default: () => "/apps/installed/conferencing" }));
vi.mock("../../_utils/oauth/createOAuthAppCredential", () => ({ default: mocks.createOAuthAppCredential }));
vi.mock("../lib", () => ({ getZoomAppKeys: async () => ({ client_id: "id", client_secret: "secret" }) }));

import { encodeOAuthState } from "../../_utils/oauth/encodeOAuthState";
import handler from "./callback";

function request(userId: number, query: Record<string, string>) {
  return { query, session: { user: { id: userId } } } as unknown as NextApiRequest;
}

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    redirectedTo: undefined as string | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    redirect(url: string) {
      res.redirectedTo = url;
      return res;
    },
  };
  return res;
}

function signedState(userId: number) {
  return encodeOAuthState(request(userId, { state: JSON.stringify({ fromApp: true }) })) as string;
}

describe("zoomvideo OAuth callback", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), {
        status: 200,
      })
    );
    mocks.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function call(userId: number, query: Record<string, string>) {
    const res = response();
    await handler(request(userId, query), res as unknown as NextApiResponse);
    return res;
  }

  function expectRefused(res: ReturnType<typeof response>) {
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Invalid OAuth state" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.createOAuthAppCredential).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  }

  it("refuses a callback with no state", async () => {
    expectRefused(await call(1, { code: "c" }));
  });

  it("refuses a state that is not JSON", async () => {
    expectRefused(await call(1, { code: "c", state: "not-json" }));
  });

  it("refuses a state without a nonce", async () => {
    expectRefused(await call(1, { code: "c", state: JSON.stringify({ fromApp: true }) }));
  });

  it("refuses a state with a tampered nonce hash", async () => {
    const state = JSON.parse(signedState(1));
    state.nonceHash = "00".repeat(32);
    expectRefused(await call(1, { code: "c", state: JSON.stringify(state) }));
  });

  it("refuses a state signed for another user", async () => {
    expectRefused(await call(1, { code: "c", state: signedState(2) }));
  });

  it("saves the credential for a state signed for the signed-in user", async () => {
    const res = await call(1, { code: "c", state: signedState(1) });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.createOAuthAppCredential).toHaveBeenCalledOnce();
    expect(res.redirectedTo).toBe("/apps/installed/conferencing");
  });
});
