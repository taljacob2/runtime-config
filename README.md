# runtime-config

**Build a web app once. Set its settings when it is deployed. Refuse to start when they are missing or wrong.**

[![CI](https://github.com/taljacob2/runtime-config/actions/workflows/ci.yml/badge.svg)](https://github.com/taljacob2/runtime-config/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@taljacob2/runtime-config)](https://www.npmjs.com/package/@taljacob2/runtime-config)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A browser can't read environment variables. So tools like Vite, webpack and
Next.js (for `NEXT_PUBLIC_*`) copy each value **into the built JavaScript** at
build time. A built app then holds one API address, one feature flag, one key,
forever. To deploy the same app twice with different settings, you build it
twice.

`runtime-config` moves those settings into a small JSON file the app reads
**when it starts**. One build serves every deployment, and each deployment
fills the file from its own environment variables. And because a wrong setting
is worse than no app, it is **loud**:

- **The container refuses to start** when a variable is missing, and names it.
- **The page refuses to start** when the file is missing, malformed, or holds
  a wrong value, and lists every problem at once instead of a blank screen.

```
build:     vite build                 ->  dist/config.json.template   { "apiBaseUrl": "${MYAPP_API_BASE_URL}" }
deploy:    docker run -e MYAPP_...    ->  dist/config.json            { "apiBaseUrl": "https://api.example.com" }
start:     await config.load()        ->  checked values, or a page that says exactly what's wrong
```

It has no runtime dependencies, works in any browser and with any framework,
and its container side needs only `sh` and `envsubst`, not Node.

## Contents

- [Install](#install)
- [Quick start (Vite + Docker)](#quick-start-vite--docker)
- [What it checks](#what-it-checks)
- [Deploying](#deploying)
- [Other setups](#other-setups): [no build step](#plain-html-no-build-step) ·
  [webpack, Rollup, Parcel, Angular...](#any-other-bundler) · [Next.js](#nextjs) · [tests](#in-your-tests)
- [API](#api)
- [Security](#security)
- [Compared with other approaches](#compared-with-other-approaches)
- [Contributing](#contributing)

## Install

```sh
npm install @taljacob2/runtime-config
```

ESM only. The browser part runs in every current browser. The Vite plugin, the
CLI and the server helper need Node 22 or later.

## Quick start (Vite + Docker)

**1. Define the settings, once.** Every setting is required, and each one is
filled from an environment variable named after it.

```ts
// src/config.ts
import { runtimeConfig } from "@taljacob2/runtime-config";

export const config = runtimeConfig({
  path: "/config.json",
  envPrefix: "MYAPP_",
  settings: ["apiBaseUrl", "sentryDsn"], // filled from MYAPP_API_BASE_URL and MYAPP_SENTRY_DSN
  check: ({ apiBaseUrl }) =>
    /^https?:\/\//.test(apiBaseUrl) ? [] : [`"apiBaseUrl" must start with http:// or https:// - got "${apiBaseUrl}"`],
});
```

Values arrive as text, exactly as given. Judging them, or turning them into
numbers or flags, is your `check`'s job, with whatever rules you like (or none).

**2. Load them before anything else runs.**

```ts
// src/main.ts
import { showConfigError } from "@taljacob2/runtime-config";
import { config } from "./config";

try {
  await config.load();
} catch (error) {
  showConfigError(error, { into: document.getElementById("app")! }); // say what's wrong on the page
  throw error;                                                       // and crash for real
}

startApp(); // anywhere from here: config.get().apiBaseUrl
```

**3. Add the plugin.**

```ts
// vite.config.ts
import { runtimeConfigPlugin } from "@taljacob2/runtime-config/vite";
import { defineConfig } from "vite";
import { config } from "./src/config";

export default defineConfig({ plugins: [runtimeConfigPlugin(config)] });
```

- **`vite` and `vite preview`** serve `/config.json` from `config.dev.json`
  (add it to `.gitignore`). If it's missing, the page tells you what to put in it.
- **`vite build`** ships `config.json.template`, and refuses to build if a real
  `config.json` would be shipped (say, from `public/`): a deployment that forgot
  to set its own would otherwise quietly run on it.

**4. Fill it when the container starts.** The package ships a script for the
official nginx images, which run every script in `/docker-entrypoint.d/`
before nginx starts:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules/@taljacob2/runtime-config/docker/40-runtime-config.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
```

```sh
docker run -e MYAPP_API_BASE_URL=https://api.example.com -e MYAPP_SENTRY_DSN=... my-app
```

Forget a variable and the container stops before nginx starts:

```
runtime-config: these environment variables are not set: MYAPP_SENTRY_DSN
```

A complete, tested example lives in [`examples/vite`](examples/vite), including
its [`Dockerfile`](examples/vite/Dockerfile) and [`nginx.conf`](examples/vite/nginx.conf).

## What it checks

`load()` collects **every** problem before it reports, so a broken file shows
all its mistakes at once:

| Problem | What the page says |
|---|---|
| No file, and the server says 404 | `the server answered 404 Not Found - the file isn't there. Create it from config.json.template` |
| No file, and the server sends the app's `index.html` in its place (what single-page-app hosting usually does) | `the file is missing - the server sent a web page in its place. Create it from config.json.template` |
| No answer in time (default 10 s) | `the file could not be fetched: no answer within 10 s` |
| Not JSON | `the file is not valid JSON: Unexpected end of JSON input` |
| JSON, but not one object | `must be one JSON object: { "setting": "value", ... } - got a list: [1,2]` |
| The server failed, and said why | `the server answered 500 Internal Server Error`, then its explanation, indented |
| A setting is missing | `"apiBaseUrl" is missing (its environment variable is MYAPP_API_BASE_URL)` |
| A value still holds its placeholder (copied the template, forgot one) | `"apiBaseUrl" still holds the placeholder ${MYAPP_API_BASE_URL} - set MYAPP_API_BASE_URL` |
| A value is empty or blank | `"sentryDsn" is empty - set MYAPP_SENTRY_DSN` |
| A value isn't text | `"sentryDsn" must be text - got 42` |
| A key nobody defined (a typo) | `"apiBaseURL" is not a setting of this app - its settings are: apiBaseUrl, sentryDsn` |
| Your `check` found something | your sentence |

Your `check` runs once every setting is present and usable, so it always sees
a complete set of values. Its problems are reported together with any unknown
key.

`showConfigError` shows it like this, in plain DOM (no framework, nothing else
that could fail), with the message set as text, never as markup:

```
This app can't start - its settings are missing or wrong.

/config.json:
- "apiBaseURL" is not a setting of this app - its settings are: apiBaseUrl, greeting
- "apiBaseUrl" must start with http:// or https:// - got "api.example.com"
```

Mistakes in the definition itself, such as a relative path, a name that isn't
camelCase, or two settings that would share one variable, throw as soon as
`runtimeConfig()` runs, because they're the developer's to fix, not the
deployment's.

## Deploying

The file is ordinary static content. Anything that can put a file next to
`index.html` can fill it in.

**Docker with nginx:** use the script, as in the quick start. It:

- fills every `${NAME}` in the template from the environment, and replaces nothing else;
- escapes `"` and `\`, so any value makes valid JSON;
- stops the container, naming each variable that is unset or blank, or that holds a line break or a tab;
- needs `sh`, `grep`, `sed` and `envsubst`, which the nginx images already have.

| Variable | Default | |
|---|---|---|
| `RUNTIME_CONFIG_DIR` | `/usr/share/nginx/html` | the folder the app is served from |
| `RUNTIME_CONFIG_TEMPLATE` | `config.json.template` | the template's name; the file written drops `.template` |

The folder must be writable by the container's user. With
`nginx-unprivileged` images, make it so in your Dockerfile; otherwise the
script stops and says so.

**Serve the file uncached.** Hashed assets can be cached forever, but
`config.json` changes with every deployment:

```nginx
location = /config.json { add_header Cache-Control "no-store" always; try_files $uri =404; }
location /assets/       { add_header Cache-Control "public, max-age=31536000, immutable" always; }
location /              { try_files $uri /index.html; }
```

`load()` asks with `cache: "no-store"` too, so a browser never reuses an old answer.

**Kubernetes:** the same image, with the variables from a ConfigMap or Secret
(`envFrom`). A new value is a rollout, not a rebuild.

**A plain web server (IIS, Apache, a zip install):** copy
`config.json.template` to `config.json` next to `index.html`, and replace
every `${...}`. Forget one and the page names it.

## Other setups

### Plain HTML (no build step)

The library is plain ES modules, so a browser can load it directly. Copy the
package's `dist` folder next to your page, or use a CDN that serves npm
packages, and map the name with an import map:

```html
<script type="importmap">
  { "imports": { "@taljacob2/runtime-config": "./vendor/runtime-config/index.js" } }
</script>
<script type="module">
  import { runtimeConfig, showConfigError } from "@taljacob2/runtime-config";

  const config = runtimeConfig({ path: "/config.json", envPrefix: "MYAPP_", settings: ["apiBaseUrl"] });
  try {
    await config.load();
  } catch (error) {
    showConfigError(error);
    throw error;
  }
  startApp(config.get());
</script>
```

Write `config.json.template` by hand, or print it with the CLI below. See
[`examples/plain-html`](examples/plain-html).

### Any other bundler

webpack, Rollup, Parcel, esbuild, Angular, Vue CLI: the browser part is the
same as in the quick start. What the Vite plugin does at build time, the CLI
does from any build script:

```sh
runtime-config template src/config.js --out dist/config.json.template
```

It prints, or writes with `--out`, the template of the module's one
`runtimeConfig()` export (pick one with `--export <name>` when there are
several). It fails if a real `config.json` sits next to the template it
writes. The module can be `.js`/`.mjs`, or `.ts` on a Node that runs
TypeScript (22.18 or later). For local development, serve a `config.json`
from your dev server the way you serve any other file, and keep it out of
the build output.

```json
{
  "scripts": {
    "build": "webpack && runtime-config template src/config.js --out dist/config.json.template"
  }
}
```

### Next.js

A Next.js app that runs its own server (`next start`) doesn't need a file:
the server can read the environment on every request. `configResponse`
answers `/config.json` with the same names and checks:

```ts
// app/config.json/route.ts - serves /config.json from the server's environment
import { configResponse } from "@taljacob2/runtime-config/server";
import { connection } from "next/server";
import { config } from "../../runtime-config";

export async function GET() {
  await connection(); // read the environment per request, never at build time
  return configResponse(config, process.env);
}
```

Client components then `await config.load()` as usual. When a variable is
wrong, `configResponse` answers 500 with the problems as plain text, and the
page shows them:

```
/config.json:
- the server answered 500 Internal Server Error
  environment variables:
  - "apiBaseUrl" must start with http:// or https:// - got "not-an-address"
```

To refuse to start at all, check in `instrumentation.ts`, and exit. Next
only logs an error thrown in `register()` and keeps serving every request
with a 500:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { readEnv } = await import("@taljacob2/runtime-config/server");
    const { config } = await import("./runtime-config");
    try {
      readEnv(config, process.env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
```

The build doesn't need the variables; only the running server does. (Checked
with Next.js 16.3.)

With `output: "export"` there is no server: a static export is a plain
single-page app, so deploy it like the quick start (the CLI writes the
template).

### Node servers

`readEnv(config, process.env)` works in any server code (Express, Fastify, a
build script): it reads each setting from its variable and runs the same
checks, throwing a `ConfigError` that names every problem. On servers built
on the Fetch API's `Response` (Hono, Bun, Deno, Cloudflare Workers),
`configResponse(config, env)` is the whole `/config.json` handler.

### In your tests

Code that calls `config.get()` needs loaded values. In tests, provide them
directly, with the same checks and no file:

```ts
config.provide({ apiBaseUrl: "http://localhost:3000", sentryDsn: "test" });
```

## API

### `runtimeConfig(options)`

| Option | | |
|---|---|---|
| `path` | `string` | Where the app fetches the file: a path starting with `/` (so a page opened at a deep link still finds it), or an `http(s)://` address. |
| `envPrefix` | `string` | Put before each variable's name. Capitals, digits and `_`, ending with `_`, or `""`. |
| `settings` | `string[]` | The settings' names, camelCase. All required. |
| `check?` | `(values) => string[]` | Your own checks: one sentence per problem. |
| `timeoutMs?` | `number` | How long `load()` waits for the file. Default `10000`. |

Returns a frozen object:

| | |
|---|---|
| `load(): Promise<values>` | Fetches and checks the file; resolves with the values, or rejects with a `ConfigError`. |
| `get(): values` | The loaded values. Throws if nothing has loaded yet, because that means something ran too early. |
| `provide(input): values` | Checks values you already have (from your server, in tests) and makes them the loaded ones. |
| `parse(input, source?): values` | Checks values without keeping them. |
| `envVarOf(setting): string` | The variable a setting is filled from. |
| `template(): string` | The file a deployment fills in. |
| `path`, `envPrefix`, `settings` | As given. |

Values are typed from `settings`: `config.get().apiBaseUrl` is a `string`, and
a misspelled name is a type error.

**Variable names** are the prefix plus the setting's name in capitals, with
`_` between its words: `apiBaseUrl` → `API_BASE_URL`, `oauthClientID` →
`OAUTH_CLIENT_ID`. The same rule is available as `envVarName(prefix, setting)`.

### `ConfigError`

An `Error` whose `message` lists every problem, one per line. It also has
`source` (the file's path, `"environment variables"`, ...) and `problems`
(the list).

### `showConfigError(error, { into?, title? })`

Replaces the content of `into` (default `document.body`) with the message,
as an `alert`, with the text set as text.

### `readEnv(config, env)` and `configResponse(config, env)` (from `@taljacob2/runtime-config/server`)

`readEnv` reads each setting from its variable in `env` (pass `process.env`)
and runs the same checks. Throws a `ConfigError` with source
`"environment variables"`.

`configResponse` wraps it as a Fetch API `Response`: the values as JSON, or
a 500 whose plain-text body lists every problem. Both answers are never cached.

### `runtimeConfigPlugin(config, { devFile? })` (from `@taljacob2/runtime-config/vite`)

Vite 5 or later. `devFile` is relative to the project root (default
`config.dev.json`); keep it out of `public/`, or the build refuses.

### CLI

```
runtime-config template <definition> [--export <name>] [--out <file>]
```

Exits `1` on a problem and `2` on wrong usage.

## Security

- **Everything in the file is public.** The browser downloads it, and so can
  anyone who can open the app. Put addresses, public keys and feature flags
  in it; never secrets, passwords or private keys. The same is true of any
  build-time variable a browser can see.
- The error box sets its message with `textContent`, so a value can't inject
  markup into the page.
- The container script reads variable names from the template through a
  strict pattern (letters, digits and `_`) before it uses them.

## Compared with other approaches

- **Build-time variables** (`import.meta.env`, `process.env.NEXT_PUBLIC_*`):
  simplest, but one build per deployment.
- **Rewriting the built files when the container starts**, for example
  [import-meta-env](https://github.com/runtime-env/import-meta-env), or
  `envsubst` over `index.html`: also one build for every deployment. They
  rewrite the built files and usually need their own tool (often Node) in the
  container, and they don't refuse a wrong value.
- **Framework-specific loaders** such as next-runtime-env for Next.js or
  runtime-config-loader for Angular each fit one framework.

runtime-config never touches the built files, works with any framework or
none, needs only `sh` and `envsubst` in the container, and treats a missing or
wrong setting as a reason not to start.

## Contributing

```sh
npm ci
npm run verify   # typecheck, build, unit tests, container-script tests, package checks
```

The CI also builds the example image and checks it in a real browser. See
[CHANGELOG.md](CHANGELOG.md) for releases.

## License

[MIT](LICENSE) © Tal Jacob
