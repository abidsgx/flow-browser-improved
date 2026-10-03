import type { Configuration } from "electron-builder";
import * as fs from "fs";
import * as jju from "jju";
import * as path from "path";

import type { PackageJson } from "./scripts/_types/package-json";

// Helper Functions //
/**
 * Get the custom app version from environment variables.
 * @returns The custom app version from environment variables, or undefined if not provided
 */
function getCustomAppVersion(): string | undefined {
  return process.env.CUSTOM_APP_VERSION;
}

/**
 * Read the raw `electron` dependency specifier from the project's package.json.
 * @returns The dependency specifier, or undefined if `electron` is not declared
 */
function getElectronDependency(): string | undefined {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = jju.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
  return packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron;
}

/**
 * Resolve the exact Electron version that electron-builder should use.
 *
 * electron-builder cannot infer this on its own, because `electron` points at the
 * castlabs/electron-releases fork (for Widevine DRM) and that specifier looks like a
 * semver range rather than a fixed version. When the version cannot be read from
 * node_modules either, `install-app-deps` fails during `bun install` with:
 *
 *   Electron version "https://github.com/castlabs/electron-releases#v40.7.0+wvcus"
 *   is a range, not a fixed version.
 *
 * Declaring `electronVersion` explicitly short-circuits that resolution. It is derived
 * from the dependency rather than hardcoded, so that the `script:upgrade-electron-to-*`
 * and `script:use-stock-electron` scripts keep working without a matching edit here.
 *
 * @returns The exact Electron version, or undefined if it could not be parsed
 */
function getElectronVersion(): string | undefined {
  const dependency = getElectronDependency();
  if (!dependency) {
    return undefined;
  }

  // Handles the castlabs fork, e.g.
  // "https://github.com/castlabs/electron-releases#v40.7.0+wvcus" and
  // "github:castlabs/electron-releases#v40.7.0+wvcus".
  const forkMatch = dependency.match(/electron-releases#v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  if (forkMatch) {
    return forkMatch[1];
  }

  // Handles plain semver specifiers, e.g. "40.7.0", "^40.7.0" or "~40.7.0".
  const semverMatch = dependency.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/);
  return semverMatch ? semverMatch[0] : undefined;
}

// Options //
const customAppVersion = getCustomAppVersion();
if (customAppVersion) {
  console.log(`Using custom version: ${customAppVersion}`);
}

const electronVersion = getElectronVersion();
if (electronVersion) {
  console.log(`Using Electron version: ${electronVersion}`);
}

// Main Configuration //
const electronBuilderConfig: Configuration = {
  appId: "dev.iamevan.flow",
  productName: "Flow",
  electronVersion,
  ...(customAppVersion && { buildVersion: customAppVersion, extraMetadata: { version: customAppVersion } }),
  directories: {
    buildResources: "build"
  },
  files: [
    "!**/.vscode/*",
    "!build/**",
    "!src/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc,dev-app-update.yml}",
    "!{CHANGELOG.md,README.md,CONTRIBUTING.md,docs/**}",
    "!{scripts/**}",
    "!{.env,.env.*,.npmrc,bun.lock}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}"
  ],
  protocols: [
    {
      name: "HyperText Transfer Protocol",
      schemes: ["http", "https"]
    }
  ],
  fileAssociations: [
    {
      ext: "htm",
      name: "HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "html",
      description: "HTML Document",
      role: "Viewer"
    },
    {
      ext: "mhtml",
      description: "MHTML Document",
      role: "Viewer"
    },
    {
      ext: "shtml",
      name: "HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "xhtml",
      name: "Extensible HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "xhtm",
      name: "Extensible HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "pdf",
      description: "PDF Document",
      role: "Viewer"
    }
  ],
  asarUnpack: ["assets/**", "node_modules/@img/**"],
  extraResources: [
    {
      from: "drizzle",
      to: "drizzle"
    }
  ],
  win: {
    executableName: "flow",
    verifyUpdateCodeSignature: false
  },
  nsis: {
    artifactName: "${name}-${version}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always"
  },
  mac: {
    category: "public.app-category.productivity",
    entitlements: "./build/entitlements.mac.plist",
    notarize: true,
    provisioningProfile: "build/profile.provisionprofile",
    binaries: ["Contents/PlugIns/DockTilePlugIn.plugin"],
    extendInfo: {
      CFBundleIconName: "AppIcon",
      NSUserActivityTypes: ["NSUserActivityTypeBrowsingWeb"],
      NSDockTilePlugIn: "DockTilePlugIn.plugin"
    }
  },
  dmg: {
    artifactName: "${name}-${version}-${arch}.${ext}",
    background: "./build/dmg-background.tiff",
    icon: "./build/volume-icon.icns"
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Network;WebBrowser;",
    executableArgs: ["--ozone-platform-hint=auto"],
    icon: "icon.png"
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}"
  },
  npmRebuild: false,
  publish: {
    provider: "github",
    owner: "multiboxlabs",
    releaseType: "prerelease"
  },
  electronDist: "node_modules/electron/dist",
  afterPack: "./build/hooks/afterPack.js",
  afterSign: "./build/hooks/afterSign.js"
};

export default electronBuilderConfig;
