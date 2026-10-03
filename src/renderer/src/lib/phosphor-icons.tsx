import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { DotOutline } from "@phosphor-icons/react/dist/csr/DotOutline";
import { Globe } from "@phosphor-icons/react/dist/csr/Globe";

type PhosphorIconComponent = ComponentType<IconProps>;

/**
 * Icons that our own source references by name are imported directly. This
 * keeps the common cases (the `SpaceIcon` fallback and the onboarding default)
 * working without ever touching the full icon set.
 */
const STATIC_ICONS: Record<string, PhosphorIconComponent> = {
  DotOutline,
  Globe
};

export type PhosphorIconId = keyof typeof STATIC_ICONS;

/**
 * The full icon set is ~1,500 components. Importing it eagerly means every
 * renderer holds all of them in the module namespace forever, which is the
 * single largest fixed cost in the renderer bundle.
 *
 * A space icon is persisted as an arbitrary string, so we cannot know every id
 * up front - but the number of icons actually on screen is tiny (one per
 * space). So instead of importing all of them we load the set on demand, once,
 * the first time an id outside `STATIC_ICONS` is rendered.
 */
let fullIconSetPromise: Promise<Record<string, PhosphorIconComponent>> | null = null;

function loadFullIconSet(): Promise<Record<string, PhosphorIconComponent>> {
  fullIconSetPromise ??= import("@phosphor-icons/react").then(
    (mod) => mod as unknown as Record<string, PhosphorIconComponent>
  );
  return fullIconSetPromise;
}

/**
 * Guards against loading the full set for ids that can never match an icon,
 * such as the `undefined` that spaces carry until the user picks one.
 */
function isResolvableIconId(id: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(id);
}

function DeferredPhosphorIcon({ id, fallbackId, ...props }: { id: string; fallbackId?: string } & IconProps) {
  const [Icon, setIcon] = useState<PhosphorIconComponent | null>(null);

  useEffect(() => {
    if (!isResolvableIconId(id)) {
      setIcon(null);
      return;
    }

    let cancelled = false;
    void loadFullIconSet().then((all) => {
      if (!cancelled) setIcon(all[id] ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (Icon) return <Icon {...props} />;

  if (fallbackId && fallbackId !== id) {
    return <PhosphorIcon id={fallbackId} {...props} />;
  }

  return null;
}

export function PhosphorIcon({
  id,
  fallbackId,
  ...props
}: { id: PhosphorIconId | (string & Record<never, never>); fallbackId?: string } & IconProps) {
  const StaticIcon = typeof id === "string" ? STATIC_ICONS[id] : undefined;

  if (StaticIcon) return <StaticIcon {...props} />;

  return <DeferredPhosphorIcon id={typeof id === "string" ? id : ""} fallbackId={fallbackId} {...props} />;
}

export function SpaceIcon({ ...props }: ComponentProps<typeof PhosphorIcon>) {
  return <PhosphorIcon fallbackId="DotOutline" weight="duotone" {...props} />;
}
