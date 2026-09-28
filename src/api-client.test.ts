import { afterEach, describe, expect, it, vi } from "vitest";
import { TrustSourceClient } from "./api-client.js";

describe("TrustSourceClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a versioned path against the real default base URL without dropping /v2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new TrustSourceClient(
      "https://api.trustsource.io/v2",
      "test-key",
    );
    await client.request("GET", "/core/risks/1/tasks", {});

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.trustsource.io/v2/core/risks/1/tasks",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
