import { describe, expect, it, vi } from "vitest";
import { ConfigError, runtimeConfig } from "../src/index.js";
import { configResponse, readEnv } from "../src/server.js";

const config = runtimeConfig({
  path: "/config.json",
  envPrefix: "MYAPP_",
  settings: ["apiBaseUrl", "sentryDsn"],
  check: ({ apiBaseUrl }) => (/^https?:\/\//.test(apiBaseUrl) ? [] : [`"apiBaseUrl" must be an address - got "${apiBaseUrl}"`]),
});

describe("readEnv", () => {
  it("reads each setting from its environment variable, ignoring every other variable", () => {
    expect(
      readEnv(config, {
        MYAPP_API_BASE_URL: "https://api.example.com",
        MYAPP_SENTRY_DSN: "dsn",
        PATH: "/usr/bin",
        MYAPP_SOMETHING_ELSE: "ignored",
      }),
    ).toEqual({ apiBaseUrl: "https://api.example.com", sentryDsn: "dsn" });
  });

  it("names every missing or empty variable at once, as from the environment", () => {
    try {
      readEnv(config, { MYAPP_SENTRY_DSN: "" });
      throw new Error("expected readEnv to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).source).toBe("environment variables");
      expect((error as ConfigError).problems).toEqual([
        '"apiBaseUrl" is missing (its environment variable is MYAPP_API_BASE_URL)',
        '"sentryDsn" is empty - set MYAPP_SENTRY_DSN',
      ]);
    }
  });

  it("runs the project's check too", () => {
    expect(() => readEnv(config, { MYAPP_API_BASE_URL: "nope", MYAPP_SENTRY_DSN: "dsn" })).toThrow(
      /"apiBaseUrl" must be an address - got "nope"/,
    );
  });
});

describe("configResponse", () => {
  it("answers with the settings as JSON, never cached", async () => {
    const response = configResponse(config, { MYAPP_API_BASE_URL: "https://api.example.com", MYAPP_SENTRY_DSN: "dsn" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ apiBaseUrl: "https://api.example.com", sentryDsn: "dsn" });
  });

  it("answers 500 with every problem as plain text - which the browser's load() puts on the page", async () => {
    const response = configResponse(config, { MYAPP_API_BASE_URL: "nope" });
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(
      'environment variables:\n- "sentryDsn" is missing (its environment variable is MYAPP_SENTRY_DSN)',
    );

    // End to end: the browser side reads this answer.
    vi.stubGlobal("fetch", vi.fn(async () => configResponse(config, { MYAPP_API_BASE_URL: "nope" })));
    await expect(config.load()).rejects.toThrow(
      '/config.json:\n- the server answered 500\n  environment variables:\n  - "sentryDsn" is missing (its environment variable is MYAPP_SENTRY_DSN)',
    );
  });
});
