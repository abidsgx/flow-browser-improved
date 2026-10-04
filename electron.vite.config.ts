import { join, resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";
import type { Plugin } from "vite";
import { defineConfig } from "electron-vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { generateRoutes } from "./scripts/frontend-routes-generator/generator";

const routes = await generateRoutes();

const BLOCKLIST_SOURCE = resolve("src/main/blocklist/blocklist.json");
const BLOCKLIST_ASSET = "blocklist.json";

/**
 * The blocklist is ~12MB of user-owned JSON. Importing it as a module would
 * turn every entry into a JS string literal inside the main bundle, so V8 has
 * to compile ~11MB of data on every startup for no benefit. Copying it next to
 * the main bundle instead lets `blocker.ts` read it as bytes and hash straight
 * out of the buffer, never materialising the hostnames as strings.
 *
 * `writeBundle` is used rather than `emitFile` so the copy happens after
 * Vite has cleared and repopulated `out/main`, and so it also runs during
 * `electron-vite dev` watch rebuilds.
 */
function blocklistAssetPlugin(): Plugin {
  let outDir = "";

  return {
    name: "flow:blocklist-asset",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      // Keep the copy in sync while watching, so editing the blocklist in dev
      // does not require a manual restart of the build.
      this.addWatchFile(BLOCKLIST_SOURCE);
    },
    writeBundle() {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(BLOCKLIST_SOURCE, join(outDir, BLOCKLIST_ASSET));
    }
  };
}

function isProductionBuild() {
  return process.env.PRODUCTION_BUILD === "true";
}

const mainAliases: Record<string, string> = {
  "@": resolve("src/main")
};

const rendererAliases: Record<string, string> = {
  "@": resolve("src/renderer/src")
};

const sharedAliases: Record<string, string> = {
  "~": resolve("src/shared")
};

const commonOptions = {
  build: {
    minify: isProductionBuild() ? "esbuild" : false
  }
} as const;

export default defineConfig({
  main: {
    ...commonOptions,
    build: {
      ...commonOptions.build,
      externalizeDeps: { exclude: ["electron-context-menu", "hono", "objcjs-types"], include: ["objc-js"] }
    },
    plugins: [blocklistAssetPlugin()],
    resolve: {
      alias: {
        ...mainAliases,
        ...sharedAliases
      }
    }
  },
  preload: {
    ...commonOptions,
    build: {
      ...commonOptions.build,
      externalizeDeps: { exclude: ["electron-chrome-extensions"] }
    },
    resolve: {
      alias: {
        ...mainAliases,
        ...sharedAliases
      }
    }
  },
  renderer: {
    ...commonOptions,
    resolve: {
      alias: {
        ...rendererAliases,
        ...sharedAliases
      }
    },
    build: {
      ...commonOptions.build,
      // Electron 40 ships Chromium ~140, while Vite's default target is
      // `baseline-widely-available` (Chrome 111). Transpiling down to that is
      // wasted build time and produces larger output for V8 to parse at
      // startup. Only the renderer can take this - electron-vite requires the
      // main and preload targets to stay on `node*`.
      target: "esnext",
      assetsInlineLimit: (filePath) => {
        // Each Phosphor icon is ~600 bytes, well under the default 4KB inline
        // limit, so the default would base64 all 1,512 of them into a single
        // ~1.2MB chunk. Emitting them as files instead keeps the URL map small
        // and lets a windowed icon grid download only the icons it shows.
        if (filePath.includes("@phosphor-icons")) return false;
        return undefined;
      },
      // `rollupOptions` is a deprecated alias in Vite 8; `rolldownOptions` is
      // the supported name.
      rolldownOptions: {
        input: {
          ...routes
        }
      }
    },
    plugins: [
      react(),
      babel({
        presets: [reactCompilerPreset()]
      }),
      tailwindcss()
    ]
  }
});
