import { runtimeConfig } from "@taljacob2/runtime-config";

// The app's one definition of its settings. Each is filled from an environment
// variable when the app is deployed: apiBaseUrl from EXAMPLE_API_BASE_URL,
// greeting from EXAMPLE_GREETING.
export const config = runtimeConfig({
  path: "/config.json",
  envPrefix: "EXAMPLE_",
  settings: ["apiBaseUrl", "greeting"],
  check: ({ apiBaseUrl }) =>
    /^https?:\/\/[^/]/.test(apiBaseUrl) ? [] : [`"apiBaseUrl" must start with http:// or https:// - got "${apiBaseUrl}"`],
});
