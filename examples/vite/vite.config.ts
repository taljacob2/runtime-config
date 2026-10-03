import { runtimeConfigPlugin } from "@taljacob/runtime-config/vite";
import { defineConfig } from "vite";
import { config } from "./src/config";

export default defineConfig({
  // `vite` and `vite preview` serve /config.json from config.dev.json (git-ignored);
  // `vite build` ships config.json.template and refuses to ship a real config.json.
  plugins: [runtimeConfigPlugin(config)],
  build: { target: "es2022" },
});
