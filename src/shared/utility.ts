export function getOriginFromURL(url: string): string {
  try {
    const urlObject = new URL(url);
    const protocol = urlObject.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      return urlObject.hostname;
    }
    return urlObject.origin;
  } catch {
    return url;
  }
}

/**
 * Phosphor names its assets in the kebab-case form of the PascalCase icon name
 * ("DotOutline" -> "dot-outline"). Deriving the name lets the main process
 * (which reads the SVG off disk) and the renderer (which looks up an emitted
 * SVG URL) agree without either side loading the ~450KB
 * `@phosphor-icons/core` metadata array.
 */
export function phosphorIconNameFromPascalCase(pascalCaseName: string): string {
  return pascalCaseName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
