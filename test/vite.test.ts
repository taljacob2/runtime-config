import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer, preview, type InlineConfig, type Plugin } from "vite";
import { runtimeConfig } from "../src/index.js";
import { runtimeConfigPlugin } from "../src/vite.js";

const config = runtimeConfig({ path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl"] });
const projects: string[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A tiny app on disk: index.html and one script. */
function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-config-vite-"));
  projects.push(root);
  const all: Record<string, string> = {
    "index.html": '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',
    "main.js": 'document.getElementById("root").textContent = "app";',
    ...files,
  };
  for (const [name, content] of Object.entries(all)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

function inline(root: string, plugins: Plugin[], extra: InlineConfig = {}): InlineConfig {
  return { root, configFile: false, logLevel: "silent", plugins, ...extra };
}

async function buildError(root: string, plugins: Plugin[], extra: InlineConfig = {}): Promise<string> {
  try {
    await build(inline(root, plugins, extra));
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the build to fail");
}

describe("vite build", () => {
  it("ships the template next to index.html, and no real config file", async () => {
    const root = project();
    await build(inline(root, [runtimeConfigPlugin(config)]));

    expect(readFileSync(join(root, "dist", "config.json.template"), "utf8")).toBe(config.template());
    expect(existsSync(join(root, "dist", "config.json"))).toBe(false);
    expect(existsSync(join(root, "dist", "index.html"))).toBe(true);
  });

  it("puts the template where the path points under a base", async () => {
    const root = project();
    const based = runtimeConfig({ path: "/app/config.json", envPrefix: "", settings: ["apiBaseUrl"] });
    await build(inline(root, [runtimeConfigPlugin(based)], { base: "/app/" }));
    expect(existsSync(join(root, "dist", "config.json.template"))).toBe(true);
  });

  it("puts the template in a sub-folder when the path names one", async () => {
    const root = project();
    const nested = runtimeConfig({ path: "/settings/app.json", envPrefix: "", settings: ["apiBaseUrl"] });
    await build(inline(root, [runtimeConfigPlugin(nested)]));
    expect(existsSync(join(root, "dist", "settings", "app.json.template"))).toBe(true);
  });

  it("refuses to ship a config file from public/", async () => {
    const root = project({ "public/config.json": '{"apiBaseUrl":"http://dev.example.com"}' });
    expect(await buildError(root, [runtimeConfigPlugin(config)])).toMatch(
      /config\.json is in .*public, so it would be shipped - and a deployment that forgot to set its own would quietly run on it/,
    );
  });

  it("refuses a dev file kept inside public/", async () => {
    const root = project({ "public/robots.txt": "" });
    expect(await buildError(root, [runtimeConfigPlugin(config, { devFile: "public/config.dev.json" })])).toMatch(
      /The dev file public\/config\.dev\.json is inside .*public, so it would be shipped/,
    );
  });

  it("refuses a config file another plugin emits", async () => {
    const root = project();
    const emitter: Plugin = {
      name: "emits-config",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "config.json", source: "{}" });
      },
    };
    expect(await buildError(root, [emitter, runtimeConfigPlugin(config)])).toMatch(
      /Something in this build emits config\.json - only config\.json\.template may be shipped/,
    );
  });

  it("refuses, as it is created, a config on another server", () => {
    const remote = runtimeConfig({ path: "https://cdn.example.com/config.json", envPrefix: "", settings: ["apiBaseUrl"] });
    expect(() => runtimeConfigPlugin(remote)).toThrow(/is on another server/);
  });
});

async function listening(server: { httpServer: { address(): string | AddressInfo | null } | null }): Promise<string> {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("the server is not listening");
  return `http://localhost:${address.port}`;
}

describe("vite (dev server)", () => {
  async function start(root: string, options = {}) {
    const server = await createServer(inline(root, [runtimeConfigPlugin(config, options)], { server: { port: 0, host: "localhost" } }));
    await server.listen();
    closers.push(() => server.close());
    return listening(server);
  }

  it("serves the dev file at the config's path, never cached", async () => {
    const root = project({ "config.dev.json": '{ "apiBaseUrl": "http://localhost:5011" }' });
    const url = await start(root);

    const response = await fetch(`${url}/config.json?ignored=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ apiBaseUrl: "http://localhost:5011" });
  });

  it("answers 404 with what to put in a missing dev file", async () => {
    const url = await start(project());
    const response = await fetch(`${url}/config.json`);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).toMatch(/^config\.dev\.json is missing - create it in .+, with a real value for each setting:\n/);
    expect(text).toContain('"apiBaseUrl": "${MYAPP_API_BASE_URL}"');
  });

  it("serves a dev file under another name, and leaves every other path alone", async () => {
    const root = project({ "local/settings.json": '{ "apiBaseUrl": "http://x" }' });
    const url = await start(root, { devFile: "local/settings.json" });
    expect(await (await fetch(`${url}/config.json`)).json()).toEqual({ apiBaseUrl: "http://x" });
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
  });
});

describe("vite preview", () => {
  it("serves the dev file too, so a built app can be tried locally", async () => {
    const root = project({ "config.dev.json": '{ "apiBaseUrl": "http://preview" }' });
    await build(inline(root, [runtimeConfigPlugin(config)]));
    const server = await preview(inline(root, [runtimeConfigPlugin(config)], { preview: { port: 0, host: "localhost" } }));
    closers.push(() => server.close());

    const url = await listening(server);
    expect(await (await fetch(`${url}/config.json`)).json()).toEqual({ apiBaseUrl: "http://preview" });
  });
});
