import { describe, expect, it, vi } from "vitest";
import { ConfigError, runtimeConfig } from "../src/index.js";

const definition = { path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl", "sentryDsn"] } as const;
const good = { apiBaseUrl: "https://api.example.com", sentryDsn: "https://key@sentry.example.com/1" };

/** The server answers every request with this. */
function serve(body: string, init: ResponseInit = {}) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function problemsOf(promise: Promise<unknown>): Promise<readonly string[]> {
  const error = await promise.then(
    () => {
      throw new Error("expected load() to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ConfigError);
  expect((error as ConfigError).source).toBe("/config.json");
  return (error as ConfigError).problems;
}

describe("load() with a good file", () => {
  it("resolves with the values, which get() then returns, frozen", async () => {
    serve(JSON.stringify(good));
    const config = runtimeConfig(definition);

    const values = await config.load();

    expect(values).toEqual(good);
    expect(config.get()).toBe(values);
    expect(Object.isFrozen(values)).toBe(true);
  });

  it("asks for the file at its path, never from a cache", async () => {
    const fetchMock = serve(JSON.stringify(good));
    await runtimeConfig(definition).load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe("/config.json");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps values exactly as written - judging them is the project's check", async () => {
    serve(JSON.stringify({ apiBaseUrl: " not an address ", sentryDsn: "x" }));
    expect(await runtimeConfig(definition).load()).toEqual({ apiBaseUrl: " not an address ", sentryDsn: "x" });
  });

  it("loads again when asked, replacing the values", async () => {
    const config = runtimeConfig(definition);
    serve(JSON.stringify(good));
    await config.load();
    serve(JSON.stringify({ ...good, apiBaseUrl: "https://other.example.com" }));
    await config.load();
    expect(config.get().apiBaseUrl).toBe("https://other.example.com");
  });
});

describe("get() before anything loaded", () => {
  it("throws, naming the file - something ran too early", () => {
    expect(() => runtimeConfig(definition).get()).toThrow(
      "The settings from /config.json were read before load() finished - something ran too early.",
    );
  });

  it("still throws after a failed load - nothing half-loaded is kept", async () => {
    serve("{}");
    const config = runtimeConfig(definition);
    await expect(config.load()).rejects.toBeInstanceOf(ConfigError);
    expect(() => config.get()).toThrow(/read before load\(\) finished/);
  });
});

describe("load() names what is wrong with the file", () => {
  it("a 404, with the server's own explanation when it gave one", async () => {
    serve("config.dev.json is missing - create it:\n{\n  \"x\": 1\n}", { status: 404, statusText: "Not Found" });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      "the server answered 404 Not Found\n  config.dev.json is missing - create it:\n  {\n    \"x\": 1\n  }",
    ]);
  });

  it("a bare 404 or a 404 page: where the file should come from", async () => {
    serve("", { status: 404, statusText: "Not Found" });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      "the server answered 404 Not Found - the file isn't there. Create it from config.json.template",
    ]);
    serve("<html><body>404 Not Found</body></html>", { status: 404 });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      "the server answered 404 - the file isn't there. Create it from config.json.template",
    ]);
  });

  it("a server error without a body, or with a web page as its body", async () => {
    serve("", { status: 500 });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual(["the server answered 500"]);
    serve("<html><body>Bad gateway</body></html>", { status: 502, statusText: "Bad Gateway" });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual(["the server answered 502 Bad Gateway"]);
  });

  it("a web page answered with 200 - the app's index.html standing in for a missing file", async () => {
    serve("\n  <!doctype html><html><body><div id=root></div></body></html>", { status: 200 });
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      "the file is missing - the server sent a web page in its place. Create it from config.json.template",
    ]);
  });

  it("text that isn't JSON", async () => {
    serve('{ "apiBaseUrl": ');
    const [problem] = await problemsOf(runtimeConfig(definition).load());
    expect(problem).toMatch(/^the file is not valid JSON: /);
  });

  it.each([
    ["a list", "[1,2]", 'must be one JSON object: { "setting": "value", ... } - got a list: [1,2]'],
    ["text", '"hello"', 'must be one JSON object: { "setting": "value", ... } - got "hello"'],
    ["null", "null", 'must be one JSON object: { "setting": "value", ... } - got null'],
  ])("JSON that is %s, not an object", async (_kind, body, expected) => {
    serve(body);
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([expected]);
  });

  it("a network failure, and no answer in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual(["the file could not be fetched: Failed to fetch"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    expect(await problemsOf(runtimeConfig({ ...definition, timeoutMs: 50 }).load())).toEqual([
      "the file could not be fetched: no answer within 0.05 s",
    ]);
  });
});

describe("load() names what is wrong with each setting - all at once", () => {
  it("missing, not text, an unfilled placeholder, empty, and a setting nobody defined", async () => {
    serve(
      JSON.stringify({
        apiBaseUrl: "${MYAPP_API_BASE_URL}",
        sentryDsn: 42,
        apiBaseURL: "https://typo.example.com",
      }),
    );
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      '"apiBaseUrl" still holds the placeholder ${MYAPP_API_BASE_URL} - set MYAPP_API_BASE_URL',
      '"sentryDsn" must be text - got 42',
      '"apiBaseURL" is not a setting of this app - its settings are: apiBaseUrl, sentryDsn',
    ]);

    serve(JSON.stringify({ sentryDsn: "   " }));
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      '"apiBaseUrl" is missing (its environment variable is MYAPP_API_BASE_URL)',
      '"sentryDsn" is empty - set MYAPP_SENTRY_DSN',
    ]);
  });

  it("a placeholder anywhere in the value, not only the whole value", async () => {
    serve(JSON.stringify({ ...good, apiBaseUrl: "https://${HOST}/api" }));
    expect(await problemsOf(runtimeConfig(definition).load())).toEqual([
      '"apiBaseUrl" still holds the placeholder ${HOST} - set MYAPP_API_BASE_URL',
    ]);
  });

  it("an inherited name like toString is not mistaken for a setting that is present", async () => {
    serve(JSON.stringify({ sentryDsn: "x" }));
    const config = runtimeConfig({ ...definition, settings: ["toString", "sentryDsn"] });
    expect(await problemsOf(config.load())).toEqual(['"toString" is missing (its environment variable is MYAPP_TO_STRING)']);
  });
});

describe("the project's check", () => {
  const withCheck = runtimeConfig({
    ...definition,
    check: ({ apiBaseUrl }) => (apiBaseUrl.startsWith("https://") ? [] : [`"apiBaseUrl" must start with https:// - got "${apiBaseUrl}"`]),
  });

  it("adds its problems to the report", async () => {
    serve(JSON.stringify({ ...good, apiBaseUrl: "http://plain.example.com" }));
    expect(await problemsOf(withCheck.load())).toEqual(['"apiBaseUrl" must start with https:// - got "http://plain.example.com"']);
  });

  it("passes the values through when it finds nothing", async () => {
    serve(JSON.stringify(good));
    expect(await withCheck.load()).toEqual(good);
  });

  it("reports its problems together with an unknown key's - every problem at once", async () => {
    serve(JSON.stringify({ ...good, apiBaseUrl: "http://plain.example.com", apiBaseURL: "typo" }));
    expect(await problemsOf(withCheck.load())).toEqual([
      '"apiBaseURL" is not a setting of this app - its settings are: apiBaseUrl, sentryDsn',
      '"apiBaseUrl" must start with https:// - got "http://plain.example.com"',
    ]);
  });

  it("runs only on a complete set of values", async () => {
    const check = vi.fn(() => []);
    serve(JSON.stringify({ apiBaseUrl: "x" }));
    await expect(runtimeConfig({ ...definition, check }).load()).rejects.toBeInstanceOf(ConfigError);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("parse() and provide()", () => {
  it("parse checks values without keeping them, naming the source it was given", () => {
    const config = runtimeConfig(definition);
    expect(config.parse(good)).toEqual(good);
    expect(() => config.get()).toThrow();

    try {
      config.parse({}, "my values");
      throw new Error("expected parse to fail");
    } catch (error) {
      expect((error as ConfigError).source).toBe("my values");
      expect((error as ConfigError).problems).toHaveLength(2);
    }
  });

  it("provide makes checked values the loaded ones - no file fetched", () => {
    const fetchMock = serve("never asked for");
    const config = runtimeConfig(definition);

    expect(config.provide(good)).toEqual(good);
    expect(config.get()).toEqual(good);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => config.provide({ apiBaseUrl: "x" })).toThrow(/^provided values:\n- "sentryDsn" is missing/);
  });

  it("describes any kind of wrong input safely", () => {
    const config = runtimeConfig(definition);
    expect(() => config.parse(undefined)).toThrow(/got nothing$/);
    expect(() => config.parse({ apiBaseUrl: () => 1, sentryDsn: 10n })).toThrow(
      /"apiBaseUrl" must be text - got a function\n- "sentryDsn" must be text - got a bigint/,
    );
    expect(() => config.parse({ ...good, sentryDsn: ["z".repeat(200)] })).toThrow(/got a list: \["z+\.\.\.$/);
  });
});
