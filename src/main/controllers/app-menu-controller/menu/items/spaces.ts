import { MenuItemConstructorOptions, nativeImage, NativeImage } from "electron";
import { getFocusedBrowserWindow } from "../helpers";
import { settings } from "@/controllers/windows-controller/interfaces/settings";
import sharp from "sharp";
import { canUserSwitchWindowSpace, setWindowSpace } from "@/ipc/session/spaces";
import path from "path";
import { readFile } from "fs/promises";
import { spacesController } from "@/controllers/spaces-controller";
import { profilesController } from "@/controllers/profiles-controller";
import { browserWindowsManager, windowsController } from "@/controllers/windows-controller";

// Types
interface Space {
  id: string;
  name: string;
  profileId: string;
  icon?: string;
}

/**
 * Icon utilities
 *
 * Phosphor names are the kebab-case form of the PascalCase name
 * ("DotOutline" -> "dot-outline"). Deriving it keeps the ~450KB
 * `@phosphor-icons/core` metadata array out of the main process heap.
 */
function getIconNameFromPascalCase(pascalCaseName: string): string {
  return pascalCaseName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function getPhosphorIconPath(pascalName: string): string | null {
  const name = getIconNameFromPascalCase(pascalName);
  if (!name) return null;

  try {
    const iconPath = path.join(
      require.resolve("@phosphor-icons/core"),
      "..",
      "..",
      "assets",
      "duotone",
      `${name}-duotone.svg`
    );
    return iconPath;
  } catch (error) {
    console.error("Failed to resolve phosphor-icons path:", error);
    return null;
  }
}

const svgPlatforms: NodeJS.Platform[] = ["darwin"];
async function createSvgFromIconPath(iconPath: string): Promise<NativeImage | null> {
  if (!svgPlatforms.includes(process.platform)) {
    // The SVG will not show on the platform, so it's not needed
    return null;
  }

  try {
    let svgString = await readFile(iconPath, "utf8");

    // Make SVG white using a more robust approach
    // 1. Handle existing fill attributes on the SVG root
    svgString = svgString.replace(/<svg([^>]*)>/, (_match, attributes) => {
      // Remove any existing fill attribute
      const cleanedAttributes = attributes.replace(/\s*fill="[^"]*"\s*/g, " ");
      return `<svg${cleanedAttributes} fill="white">`;
    });

    // 2. Add style to ensure all elements inherit the white color
    svgString = svgString.replace(/<svg([^>]*)>/, (match) => {
      return `${match}<style>* { fill: white; stroke: white; }</style>`;
    });

    // Convert to native image
    const iconBuffer = await sharp(Buffer.from(svgString)).png().resize(16, 16).toBuffer();

    return nativeImage.createFromBuffer(iconBuffer);
  } catch (error) {
    console.error("Error creating SVG from path:", error);
    return null;
  }
}

// Icon cache
type IconCacheKey = `${string}`;
const ICON_CACHE_LIMIT = 64;
const iconCache = new Map<IconCacheKey, NativeImage>();

async function getIconAsNativeImage(name: string): Promise<NativeImage | null> {
  const cacheKey = `${name}` as IconCacheKey;

  // Check cache first
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey) as NativeImage;
  }

  // Create new icon if not in cache
  const iconPath = getPhosphorIconPath(name);
  if (!iconPath) return null;

  const image = await createSvgFromIconPath(iconPath);
  if (image) {
    // Bound the cache: insertion-ordered, so the oldest key is the first one.
    while (iconCache.size >= ICON_CACHE_LIMIT) {
      const oldest = iconCache.keys().next();
      if (oldest.done) break;
      iconCache.delete(oldest.value);
    }
    iconCache.set(cacheKey, image);
  }

  return image;
}

/**
 * Space menu item creation
 */
async function createSpaceMenuItem(
  space: Space,
  index: number,
  currentSpaceId: string | null
): Promise<MenuItemConstructorOptions> {
  let iconImage: NativeImage | null = null;

  if (space.icon) {
    try {
      iconImage = await getIconAsNativeImage(space.icon);
    } catch (error) {
      console.error(`Failed to load icon for space "${space.name}":`, error);
      // Continue without an icon
    }
  }

  const checked = space.id === currentSpaceId;
  return {
    type: "checkbox",
    id: `space-${space.id}-${checked ? "checked" : "unchecked"}`,
    checked,
    label: space.name,
    accelerator: `Ctrl+${index + 1}`,
    click: () => {
      const window = getFocusedBrowserWindow();
      if (!window) return;
      void canUserSwitchWindowSpace(window, space.profileId, space.id).then((canSwitch) => {
        if (!canSwitch) return;
        setWindowSpace(window, space.id);
      });
    },
    ...(iconImage ? { icon: iconImage } : {})
  };
}

/**
 * Creates the Spaces menu for the application
 */
export async function createSpacesMenu(): Promise<MenuItemConstructorOptions> {
  const manageSpacesItem = {
    label: "Manage Spaces",
    click: () => settings.show()
  };
  const noSpacesMenu = {
    label: "Spaces",
    submenu: [manageSpacesItem]
  };

  try {
    const [spaces, areProfilesInternal] = await Promise.all([
      spacesController.getAll(),
      profilesController.getAreProfilesInternal()
    ]);
    const visibleSpaces = spaces.filter((space) => !areProfilesInternal[space.profileId]);

    const focusedWindow = windowsController.getFocused();
    if (!focusedWindow || !browserWindowsManager.isInstanceOf(focusedWindow)) {
      return noSpacesMenu;
    }

    if (focusedWindow.browserWindowType === "popup") {
      return noSpacesMenu;
    }

    const currentSpaceId = focusedWindow.currentSpaceId;
    if (currentSpaceId) {
      const currentSpace = spaces.find((space) => space.id === currentSpaceId);
      if (currentSpace && areProfilesInternal[currentSpace.profileId]) {
        return noSpacesMenu;
      }
    }

    // Use Promise.allSettled to ensure all space menu items are attempted
    // even if some fail to be created
    const spaceMenuItemResults = await Promise.allSettled(
      visibleSpaces.map((space, index) => createSpaceMenuItem(space, index, currentSpaceId))
    );

    // Filter out any rejected promises and only keep the fulfilled ones
    const spaceMenuItems = spaceMenuItemResults
      .filter((result): result is PromiseFulfilledResult<MenuItemConstructorOptions> => result.status === "fulfilled")
      .map((result) => result.value);

    return {
      label: "Spaces",
      submenu: [...spaceMenuItems, { type: "separator" }, manageSpacesItem]
    };
  } catch (error) {
    console.error("Failed to create spaces menu:", error);
    // Provide a fallback menu if the spaces menu creation fails
    return noSpacesMenu;
  }
}
