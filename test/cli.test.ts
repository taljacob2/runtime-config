import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cli = resolve("dist/cli.js");
const library = pathToFileURL(resolve("dist/index.js")).href;
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
let dir: string;

beforeAll(() => {
  if (!existsSync(cli)) throw new Error("dist/cli.js is missing - run `npm run build` first.");
  dir = mkdtempSync(join(tmpdir(), "runtime-config-cli-"));
  write("one.mjs", `import { runtimeConfig } from ${JSON.stringify(library)};
export const config = runtimeConfig({ path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl", "sentryDsn"] });
export const unrelated = 42;`);
  write("two.mjs", `import { runtimeConfig } from ${JSON.stringify(library)};
export const web = runtimeConfig({ path: "/config.json", envPrefix: "WEB_", settings: ["apiBaseUrl"] });
export const admin = runtimeConfig({ path: "/admin.json", envPrefix: "ADMIN_", settings: ["apiBaseUrl"] });`);
  write("none.mjs", "export const nothing = 1;");
  write("broken.mjs", "export const config = ;");
  write("typed.mts", `import { runtimeConfig } from ${JSON.stringify(library)};
export const config = runtimeConfig({ path: "/config.json", envPrefix: "", settings: ["apiBaseUrl" as string] });`);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("runtime-config template", () => {
  it("prints the template of the module's one config", () => {
    const { code, stdout, stderr } = run("template", "one.mjs");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toBe('{\n  "apiBaseUrl": "${MYAPP_API_BASE_URL}",\n  "sentryDsn": "${MYAPP_SENTRY_DSN}"\n}\n');
  });

  it("writes it with --out, creating the folder", () => {
    const { code, stdout } = run("template", "one.mjs", "--out", "dist/config.json.template");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^runtime-config: wrote .*config\.json\.template\n$/);
    expect(readFileSync(join(dir, "dist", "config.json.template"), "utf8")).toContain("${MYAPP_SENTRY_DSN}");
  });

  it("refuses to write next to a real config file - it would be shipped", () => {
    mkdirSync(join(dir, "shipped"), { recursive: true });
    write("shipped/config.json", "{}");
    const { code, stderr } = run("template", "one.mjs", "--out", "shipped/config.json.template");
    expect(code).toBe(1);
    expect(stderr).toMatch(/config\.json exists next to the template, so it would be shipped/);
    expect(existsSync(join(dir, "shipped", "config.json.template"))).toBe(false);
  });

  it("asks which one when a module has several, and takes --export", () => {
    const several = run("template", "two.mjs");
    expect(several.code).toBe(1);
    // A module's exports always list in alphabetical order.
    expect(several.stderr).toMatch(/exports several configs \(admin, web\) - choose one with --export/);

    const chosen = run("template", "two.mjs", "--export", "admin");
    expect(chosen.code).toBe(0);
    expect(chosen.stdout).toContain("${ADMIN_API_BASE_URL}");

    const wrong = run("template", "two.mjs", "--export", "nope");
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toMatch(/has no runtimeConfig\(\) export named "nope" - its exports: admin, web/);
  });

  it("names what's wrong with the module", () => {
    expect(run("template", "none.mjs").stderr).toMatch(/exports no runtimeConfig\(\) result - its exports: nothing/);
    expect(run("template", "missing.mjs").stderr).toMatch(/missing\.mjs does not exist/);
    const broken = run("template", "broken.mjs");
    expect(broken.code).toBe(1);
    expect(broken.stderr).toMatch(/Loading .*broken\.mjs failed: /);
  });

  it("loads a .ts definition on a Node that runs TypeScript, and says why not on one that can't", () => {
    const result = run("template", "typed.mts");
    if (process.features.typescript) {
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("${API_BASE_URL}");
    } else {
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/can't load .*typed\.mts - point at the built \.js, or use a Node that runs TypeScript/);
    }
  });
});

describe("usage", () => {
  it("prints help and the version", () => {
    expect(run("--help").stdout).toMatch(/^Usage: runtime-config template <definition>/);
    expect(run("-v").stdout).toBe(`${pkg.version}\n`);
  });

  it.each([
    [[], /No command given\./],
    [["build"], /Unknown command "build"\./],
    [["template"], /template needs the module that defines the config\./],
    [["template", "one.mjs", "extra"], /Unexpected arguments: extra/],
    [["template", "one.mjs", "--nope"], /Unknown option '--nope'/],
  ])("exits 2 with the usage for %j", (args, message) => {
    const { code, stderr } = run(...args);
    expect(code).toBe(2);
    expect(stderr).toMatch(message);
    expect(stderr).toContain("Usage: runtime-config template");
  });
});
