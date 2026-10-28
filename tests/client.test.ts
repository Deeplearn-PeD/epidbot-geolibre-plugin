import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_URL,
  EpidBotClient,
  normalizeServerUrl,
} from "../src/api/client";
import {
  ChatCancelledError,
  EpidBotApiError,
  EpidBotAuthError,
  EpidBotPlanError,
  EpidBotQuotaError,
} from "../src/api/errors";

const API_KEY = "test-key";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(
  script: (call: { url: string; init: RequestInit; index: number }) => Response,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {}, index: calls.length };
    calls.push(call);
    return script(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeClient(
  fetchImpl: typeof fetch,
  opts: Partial<ConstructorParameters<typeof EpidBotClient>[0]> = {},
  sleeps: number[] = [],
): EpidBotClient {
  return new EpidBotClient({
    serverUrl: DEFAULT_SERVER_URL,
    getApiKey: () => API_KEY,
    fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...opts,
  });
}

describe("normalizeServerUrl", () => {
  it("strips trailing slashes and surrounding whitespace", () => {
    expect(normalizeServerUrl(" https://api.example.com/ ")).toBe("https://api.example.com");
  });

  it("adds https:// when the scheme is missing", () => {
    expect(normalizeServerUrl("api.example.com")).toBe("https://api.example.com");
  });

  it("keeps a custom scheme", () => {
    expect(normalizeServerUrl("http://localhost:8000/")).toBe("http://localhost:8000");
  });
});

describe("EpidBotClient.ask", () => {
  it("submits and polls until completion", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = makeFetch(({ index }) => {
      if (index === 0) return jsonResponse({ job_id: "job-abcdef01", session_id: 7 });
      if (index === 1) return jsonResponse({ status: "processing" });
      return jsonResponse({
        status: "completed",
        session_id: 7,
        content: "Dengue cases rose.",
        images: ["plots/cases.png"],
      });
    });
    const client = makeClient(fetchImpl, {}, sleeps);
    const statuses: string[] = [];
    const submitted: Array<[string, number | null]> = [];

    const result = await client.ask("How many dengue cases?", {
      locale: "pt-BR",
      onStatus: (job) => statuses.push(job),
      onSubmitted: (job, session) => submitted.push([job, session]),
    });

    expect(result).toEqual({
      sessionId: 7,
      content: "Dengue cases rose.",
      images: ["plots/cases.png"],
    });
    // Submit call.
    expect(calls[0].url).toBe(`${DEFAULT_SERVER_URL}/api/v1/chat`);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: "How many dengue cases?",
      session_id: null,
      locale: "pt-BR",
    });
    // Poll call.
    expect(calls[1].url).toBe(`${DEFAULT_SERVER_URL}/api/v1/chat/job-abcdef01`);
    expect(calls[1].init.method).toBe("GET");
    // One poll sleep between the two polls (processing → completed).
    expect(sleeps).toEqual([1500]);
    expect(statuses).toEqual(["job-abcdef01", "job-abcdef01"]);
    expect(submitted).toEqual([["job-abcdef01", 7]]);
  });

  it("maps 401 to EpidBotAuthError with the server detail", async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ detail: "Invalid API key" }, 401),
    );
    const client = makeClient(fetchImpl, { maxRetries: 0 });
    await expect(client.ask("q")).rejects.toBeInstanceOf(EpidBotAuthError);
    await expect(client.ask("q")).rejects.toMatchObject({ detail: "Invalid API key" });
  });

  it("maps 403 to EpidBotPlanError and 429 to EpidBotQuotaError", async () => {
    const plan = makeFetch(() => jsonResponse({ detail: "upgrade" }, 403));
    const quota = makeFetch(() => jsonResponse({ detail: "slow down" }, 429));
    await expect(makeClient(plan.fetchImpl, { maxRetries: 0 }).ask("q")).rejects.toBeInstanceOf(
      EpidBotPlanError,
    );
    await expect(makeClient(quota.fetchImpl, { maxRetries: 0 }).ask("q")).rejects.toBeInstanceOf(
      EpidBotQuotaError,
    );
  });

  it("retries transient network failures with backoff", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = makeFetch(({ index }) => {
      if (index === 0) throw new TypeError("fetch failed");
      if (index === 1) return jsonResponse({ job_id: "j1" });
      return jsonResponse({ status: "completed", content: "ok" });
    });
    const client = makeClient(fetchImpl, {}, sleeps);
    const result = await client.ask("q");
    expect(result.content).toBe("ok");
    expect(sleeps[0]).toBe(500); // retryBaseDelayMs
    expect(calls.length).toBe(3);
  });

  it("retries HTTP 502/503/504 and gives up after maxRetries", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ detail: "down" }, 503));
    const client = makeClient(fetchImpl, { maxRetries: 2 });
    await expect(client.ask("q")).rejects.toSatisfy((err: unknown) => {
      return err instanceof EpidBotApiError && err.status === 503;
    });
    expect(calls.length).toBe(3); // initial + 2 retries
  });

  it("does not retry non-retryable HTTP errors", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ detail: "nope" }, 500));
    const client = makeClient(fetchImpl, { maxRetries: 2 });
    await expect(client.ask("q")).rejects.toMatchObject({ status: 500 });
    expect(calls.length).toBe(1);
  });

  it("raises a timeout error when the deadline passes", async () => {
    const { fetchImpl } = makeFetch(({ index, init }) => {
      if (index === 0 && init.method === "POST") return jsonResponse({ job_id: "j1" });
      return jsonResponse({ status: "processing" });
    });
    const client = makeClient(fetchImpl, { chatTimeoutMs: 0 });
    await expect(client.ask("q")).rejects.toSatisfy((err: unknown) => {
      return err instanceof EpidBotApiError && err.kind === "timeout";
    });
  });

  it("raises ChatCancelledError when the signal is already aborted", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ job_id: "j1" }));
    const client = makeClient(fetchImpl);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.ask("q", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ChatCancelledError);
  });

  it("surfaces a failed job with the server's error message", async () => {
    const { fetchImpl } = makeFetch(({ index }) => {
      if (index === 0) return jsonResponse({ job_id: "j1" });
      return jsonResponse({ status: "failed", error: "model exploded" });
    });
    const client = makeClient(fetchImpl, {});
    await expect(client.ask("q")).rejects.toSatisfy((err: unknown) => {
      return err instanceof EpidBotApiError && err.kind === "job" && err.message.includes("model exploded");
    });
  });
});

describe("EpidBotClient plots", () => {
  it("extracts the bare filename from plot references", () => {
    expect(EpidBotClient.extractPlotFilename("plots/cases.png")).toBe("cases.png");
    expect(EpidBotClient.extractPlotFilename("/plots/x/y.png")).toBe("y.png");
    expect(EpidBotClient.extractPlotFilename("https://host/api/v1/sessions/plots/a.png?v=2")).toBe(
      "a.png",
    );
    expect(EpidBotClient.extractPlotFilename("bare.png")).toBe("bare.png");
  });

  it("downloads plots with authentication and returns a blob", async () => {
    const { fetchImpl, calls } = makeFetch(
      () => new Response("PNGDATA", { status: 200, headers: { "Content-Type": "image/png" } }),
    );
    const client = makeClient(fetchImpl);
    const blob = await client.fetchPlot("cases.png");
    expect(await blob.text()).toBe("PNGDATA");
    expect(calls[0].url).toBe(`${DEFAULT_SERVER_URL}/api/v1/sessions/plots/cases.png`);
    expect((calls[0].init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
  });

  it("maps plot auth failures to EpidBotAuthError", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ detail: "no" }, 401));
    const client = makeClient(fetchImpl, { maxRetries: 0 });
    await expect(client.fetchPlot("cases.png")).rejects.toBeInstanceOf(EpidBotAuthError);
  });
});

describe("EpidBotClient.misc", () => {
  it("performs the auth check against /auth/me", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ email: "a@b.c" }));
    const user = await makeClient(fetchImpl).checkAuth();
    expect(user).toEqual({ email: "a@b.c" });
    expect(calls[0].url).toBe(`${DEFAULT_SERVER_URL}/api/v1/auth/me`);
  });

  it("list/create sessions and messages hit the documented paths", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse([]));
    const client = makeClient(fetchImpl);
    await client.listSessions();
    await client.createSession("My session");
    await client.getMessages(42);
    expect(calls.map((c) => c.url)).toEqual([
      `${DEFAULT_SERVER_URL}/api/v1/sessions`,
      `${DEFAULT_SERVER_URL}/api/v1/sessions`,
      `${DEFAULT_SERVER_URL}/api/v1/sessions/42/messages`,
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ name: "My session" });
  });

  it("re-targets requests after setServerUrl", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ email: "x" }));
    const client = makeClient(fetchImpl);
    client.setServerUrl("https://staging.example.com");
    await client.checkAuth();
    expect(calls[0].url).toBe("https://staging.example.com/api/v1/auth/me");
  });

  it("reports a network error when the URL is empty", async () => {
    const client = new EpidBotClient({ serverUrl: "", getApiKey: () => "" });
    await expect(client.checkAuth()).rejects.toBeInstanceOf(EpidBotApiError);
  });

  it("omits the API key header when no key is set", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const client = new EpidBotClient({
      serverUrl: DEFAULT_SERVER_URL,
      getApiKey: () => "",
      fetchImpl,
    });
    await client.checkAuth();
    expect((calls[0].init.headers as Record<string, string>)["X-API-Key"]).toBeUndefined();
  });
});

describe("poll backoff growth", () => {
  it("caps the poll interval", async () => {
    const sleeps: number[] = [];
    let polls = 0;
    const { fetchImpl } = makeFetch(({ index }) => {
      if (index === 0) return jsonResponse({ job_id: "j1" });
      polls += 1;
      if (polls >= 6) return jsonResponse({ status: "completed", content: "late" });
      return jsonResponse({ status: "processing" });
    });
    const client = makeClient(fetchImpl, { pollIntervalMs: 1000, pollMaxIntervalMs: 2000 }, sleeps);
    const result = await client.ask("q");
    expect(result.content).toBe("late");
    expect(sleeps.length).toBe(5);
    expect(sleeps[0]).toBe(1000);
    expect(sleeps.every((ms) => ms > 0 && ms <= 2000)).toBe(true);
    for (let i = 1; i < sleeps.length; i += 1) {
      expect(sleeps[i]).toBeGreaterThanOrEqual(sleeps[i - 1]);
    }
  });
});
