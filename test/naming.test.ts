import { describe, expect, it } from "vitest";
import { envVarName } from "../src/index.js";

describe("envVarName", () => {
  it.each([
    ["", "apiBaseUrl", "API_BASE_URL"],
    ["MYAPP_", "apiBaseUrl", "MYAPP_API_BASE_URL"],
    ["", "timeout", "TIMEOUT"],
    ["", "httpTimeout", "HTTP_TIMEOUT"],
    ["", "oauthClientID", "OAUTH_CLIENT_ID"],
    ["", "v2Api", "V2_API"],
    ["", "featureXEnabled", "FEATURE_X_ENABLED"],
    ["APP_", "sentryDsn", "APP_SENTRY_DSN"],
  ])("%s + %s -> %s", (prefix, setting, expected) => {
    expect(envVarName(prefix, setting)).toBe(expected);
  });
});
