import { phosphorIconNameFromPascalCase } from "~/utility";

/**
 * The Phosphor icon set as individual SVG assets rather than React components.
 *
 * All 1,512 duotone icons come to ~939KB on disk (621 bytes each) against the
 * ~5MB that `@phosphor-icons/react` adds to the renderer, and the icon picker
 * only ever mounts a windowed slice of them. Pointing each icon at an emitted
 * URL means the renderer fetches the handful it shows rather than retaining
 * 1,512 component definitions in a module namespace.
 */
const DUOTONE_ICON_URLS = import.meta.glob("../../../../node_modules/@phosphor-icons/core/assets/duotone/*.svg", {
  query: "?url",
  eager: true,
  import: "default"
}) as Record<string, string>;

const ICON_URL_BY_NAME: Record<string, string> = {};

for (const [filePath, url] of Object.entries(DUOTONE_ICON_URLS)) {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  ICON_URL_BY_NAME[fileName.replace(/-duotone\.svg$/, "")] = url;
}

/**
 * Resolves the emitted SVG URL for a Phosphor icon given its PascalCase name,
 * or `undefined` if no such icon exists.
 */
export function getPhosphorIconUrl(pascalName: string): string | undefined {
  return ICON_URL_BY_NAME[phosphorIconNameFromPascalCase(pascalName)];
}
