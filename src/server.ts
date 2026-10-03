import type { ConfigValues, RuntimeConfig } from "./index.js";

/**
 * Reads the settings straight from environment variables, through the same
 * checks as the browser's `load()` - for code that runs on a server: a Next.js
 * route handler or `instrumentation.ts`, an Express or Fastify app, a build script.
 * Throws a `ConfigError` naming every problem.
 *
 * Pass the environment explicitly (`process.env`), so this module never touches
 * `process` itself and is safe in any bundle.
 */
export function readEnv<K extends string>(
  config: RuntimeConfig<K>,
  env: Readonly<Record<string, string | undefined>>,
): ConfigValues<K> {
  const input: Record<string, string> = {};
  for (const setting of config.settings) {
    const value = env[config.envVarOf(setting)];
    if (value !== undefined) {
      input[setting] = value;
    }
  }
  return config.parse(input, "environment variables");
}

/**
 * The answer to `GET <config.path>` for any server built on the Fetch API's
 * `Response` - Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers:
 * the settings as JSON, or a 500 whose plain-text body names every problem
 * (the browser's `load()` shows that text on the page). Never cached.
 *
 * @example
 * // app/config.json/route.ts (Next.js)
 * export async function GET() {
 *   await connection();
 *   return configResponse(config, process.env);
 * }
 */
export function configResponse<K extends string>(
  config: RuntimeConfig<K>,
  env: Readonly<Record<string, string | undefined>>,
): Response {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(readEnv(config, env), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 500, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
