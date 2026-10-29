// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Lovable's zero-config production build defaults to bundling with `nitro`
// targeting Cloudflare Workers (`.output/server/index.mjs`), which is what
// powers the Lovable-hosted deploy. On a plain Node host like Render, this
// repo's `start` script runs `vite preview`, which instead expects the
// standard Vite/TanStack Start server build at `dist/server/server.js`.
// Nitro's Cloudflare build replaces that output entirely, so `vite preview`
// fails with ERR_MODULE_NOT_FOUND outside Lovable's own sandbox.
// Detect that sandbox the same way @lovable.dev/vite-tanstack-config does,
// and only disable nitro outside of it — this keeps the Lovable-hosted
// Cloudflare deploy working while fixing Render (and any other plain Node host).
const isLovableSandbox =
  process.env["LOVABLE_SANDBOX"] === "1" || !!process.env["DEV_SERVER__PROJECT_PATH"];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Omit `nitro` entirely inside the Lovable sandbox (default Cloudflare behavior applies);
  // only set it to `false` outside — exactOptionalPropertyTypes rejects an explicit `undefined`.
  ...(isLovableSandbox ? {} : { nitro: false as const }),
  vite: {
    preview: {
      allowedHosts: ["sarathi-ai-pathfinder.onrender.com",
                    "sarathi-ai-pathfinder-1.onrender.com"],
    },
  },
});

