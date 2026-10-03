import { describe, expect, it } from "vitest";
import { ConfigError, runtimeConfig, type RuntimeConfigOptions } from "../src/index.js";

function problemsOf(options: RuntimeConfigOptions<string>): readonly string[] {
  try {
    runtimeConfig(options);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).problems;
  }
  throw new Error("expected the definition to be refused");
}

const valid = { path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl"] } as const;

describe("the definition is checked as it is written", () => {
  it("accepts a valid definition, a prefix of none, and an http(s) address as the path", () => {
    expect(() => runtimeConfig(valid)).not.toThrow();
    expect(() => runtimeConfig({ ...valid, envPrefix: "" })).not.toThrow();
    expect(() => runtimeConfig({ ...valid, path: "https://cdn.example.com/app/config.json" })).not.toThrow();
  });

  it("refuses a relative path - a deep link would look for it under its own folder", () => {
    expect(problemsOf({ ...valid, path: "config.json" })).toEqual([
      'path must start with "/" (so a page opened at a deep link still finds it), or be an http(s) address - got "config.json"',
    ]);
  });

  it.each(["myapp_", "MYAPP", "MY-APP_", "1APP_"])("refuses the prefix %s", (envPrefix) => {
    expect(problemsOf({ ...valid, envPrefix })).toEqual([
      `envPrefix must be capitals, digits and _, ending with _ (or "" for none) - got "${envPrefix}"`,
    ]);
  });

  it("refuses no settings, and a timeout that is not a positive number", () => {
    expect(problemsOf({ ...valid, settings: [] })).toEqual(["settings is empty - name at least one"]);
    expect(problemsOf({ ...valid, timeoutMs: 0 })).toEqual(["timeoutMs must be a positive number - got 0"]);
    expect(problemsOf({ ...valid, timeoutMs: Number.NaN })).toEqual(["timeoutMs must be a positive number - got NaN"]);
  });

  it.each(["ApiBaseUrl", "api_base_url", "api-base", "1api", ""])("refuses the setting name %j", (name) => {
    expect(problemsOf({ ...valid, settings: [name] })).toEqual([
      `setting "${name}" must be camelCase: a lowercase letter, then letters and digits`,
    ]);
  });

  it("refuses a setting listed twice, and two settings filled from one variable", () => {
    expect(problemsOf({ ...valid, settings: ["apiBaseUrl", "apiBaseUrl"] })).toEqual(['setting "apiBaseUrl" is listed twice']);
    expect(problemsOf({ ...valid, settings: ["apiURL", "apiUrl"] })).toEqual([
      'settings "apiURL" and "apiUrl" would both be filled from MYAPP_API_URL',
    ]);
  });

  it("reports every problem at once", () => {
    const problems = problemsOf({ path: "x", envPrefix: "x", settings: ["Bad"] });
    expect(problems).toHaveLength(3);
    try {
      runtimeConfig({ path: "x", envPrefix: "x", settings: ["Bad"] });
    } catch (error) {
      expect((error as ConfigError).source).toBe("runtimeConfig() definition");
      expect((error as Error).message).toMatch(/^runtimeConfig\(\) definition:\n- path must start/);
    }
  });

  it("keeps its own copy of the settings - changing the array passed in changes nothing", () => {
    const settings = ["apiBaseUrl"];
    const config = runtimeConfig({ ...valid, settings });
    settings.push("other");
    expect(config.settings).toEqual(["apiBaseUrl"]);
    expect(Object.isFrozen(config.settings)).toBe(true);
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe("envVarOf and template", () => {
  it("names each setting's variable, and the template holds their placeholders", () => {
    const config = runtimeConfig({ path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl", "sentryDsn"] });
    expect(config.envVarOf("sentryDsn")).toBe("MYAPP_SENTRY_DSN");
    expect(config.template()).toBe('{\n  "apiBaseUrl": "${MYAPP_API_BASE_URL}",\n  "sentryDsn": "${MYAPP_SENTRY_DSN}"\n}\n');
  });
});
