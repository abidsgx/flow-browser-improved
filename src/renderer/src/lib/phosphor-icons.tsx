import { useEffect, useState, type CSSProperties, type ComponentType, type ComponentProps } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { DotOutline } from "@phosphor-icons/react/dist/csr/DotOutline";
import { Globe } from "@phosphor-icons/react/dist/csr/Globe";

type PhosphorIconComponent = ComponentType<IconProps>;

/**
 * Icons that our own source references by name are imported directly, so the
 * common cases (the `SpaceIcon` fallback and the onboarding default) render
 * without ever loading the icon URL map.
 */
const STATIC_ICONS: Record<string, PhosphorIconComponent> = {
  DotOutline,
  Globe
};

export type PhosphorIconId = keyof typeof STATIC_ICONS;

/**
 * The URL map is a lazily imported chunk of ~1,500 filename -> URL pairs. A
 * space icon is persisted as an arbitrary string, so we cannot know every id up
 * front - but the number of icons actually on screen is tiny (one per space), so
 * the map is loaded on demand, once, the first time an id outside
 * `STATIC_ICONS` is rendered.
 */
type IconUrlModule = typeof import("./phosphor-icon-urls");

let iconUrlModulePromise: Promise<IconUrlModule> | null = null;

function loadIconUrlModule(): Promise<IconUrlModule> {
  iconUrlModulePromise ??= import("./phosphor-icon-urls");
  return iconUrlModulePromise;
}

/**
 * Guards against looking up ids that can never match an icon, such as the
 * `undefined` that spaces carry until the user picks one.
 */
function isResolvableIconId(id: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(id);
}

/**
 * Renders an emitted SVG as a CSS mask rather than an `<img>`.
 *
 * A mask is what preserves `currentColor`: the element keeps taking its colour
 * from CSS (`text-white`, `text-foreground`, ...) exactly as the old inline SVG
 * components did, while masking still follows the SVG's alpha channel, so
 * Phosphor's duotone opacity survives. `<img>` would have forced us to pick a
 * single colour at build time.
 */
function MaskedPhosphorIcon({ url, className }: { url: string; className?: string }) {
  const style: CSSProperties = {
    display: "inline-block",
    backgroundColor: "currentColor",
    maskImage: `url("${url}")`,
    maskSize: "100% 100%",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: `url("${url}")`,
    WebkitMaskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center"
  };

  return <span aria-hidden="true" className={className} style={style} />;
}

function DeferredPhosphorIcon({ id, fallbackId, className }: { id: string; fallbackId?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isResolvableIconId(id)) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    void loadIconUrlModule().then((mod) => {
      if (!cancelled) setUrl(mod.getPhosphorIconUrl(id) ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (url) return <MaskedPhosphorIcon url={url} className={className} />;

  if (fallbackId && fallbackId !== id) {
    return <PhosphorIcon className={className} id={fallbackId} />;
  }

  return null;
}

interface PhosphorIconOwnProps {
  id: PhosphorIconId | (string & Record<never, never>);
  fallbackId?: string;
  className?: string;
  /** Accepted for call-site compatibility. Only the duotone set is emitted, so
   *  the masked path always renders duotone regardless of what is asked for. */
  weight?: IconProps["weight"];
}

export function PhosphorIcon({ id, fallbackId, className, weight }: PhosphorIconOwnProps) {
  const StaticIcon = typeof id === "string" ? STATIC_ICONS[id] : undefined;

  if (StaticIcon) return <StaticIcon className={className} weight={weight} />;

  return <DeferredPhosphorIcon className={className} fallbackId={fallbackId} id={typeof id === "string" ? id : ""} />;
}

/**
 * Space icons are always rendered in the duotone weight, which is the only set
 * the URL map is built from, so `weight` is placed after the spread and cannot
 * be overridden by a caller.
 */
export function SpaceIcon(props: ComponentProps<typeof PhosphorIcon>) {
  return <PhosphorIcon fallbackId="DotOutline" {...props} weight="duotone" />;
}
