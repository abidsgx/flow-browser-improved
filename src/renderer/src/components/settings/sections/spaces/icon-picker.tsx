import { useState, useEffect, useMemo, memo } from "react";
import { Search } from "lucide-react";
import { motion } from "motion/react";
import { Input } from "@/components/ui/input";
import { SpaceIcon } from "@/lib/phosphor-icons";
import type { IconEntry } from "@phosphor-icons/core";

// ==============================
// PhosphorIconPicker Component
// ==============================
interface SpaceIconPickerProps {
  selectedIcon: string;
  onSelectIcon: (iconId: string) => void;
}

// The grid is windowed: the full set is ~1,500 icons, and mounting every one
// of them at once costs far more memory than the icons themselves.
const COLUMNS = 8;
const ROW_HEIGHT = 36;
const ROW_GAP = 4;
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP;
const VIEWPORT_HEIGHT = 180;
const OVERSCAN_ROWS = 2;

export function SpaceIconPicker({ selectedIcon, onSelectIcon }: SpaceIconPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [iconList, setIconList] = useState<IconEntry[]>([]);
  const [scrollTop, setScrollTop] = useState(0);

  // The icon metadata is only needed while this picker is open, so it is
  // loaded on demand rather than being part of the renderer's startup cost.
  useEffect(() => {
    let cancelled = false;

    void import("@phosphor-icons/core").then((mod) => {
      if (!cancelled) setIconList((mod.icons ?? []) as unknown as IconEntry[]);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Lowercased search terms are built once per list rather than on every
  // keystroke, which used to allocate ~7,000 strings per character typed.
  const searchIndex = useMemo(
    () =>
      iconList.map((icon) =>
        [...icon.tags, ...icon.categories, icon.name, icon.pascal_name].map((value) => value.toLowerCase())
      ),
    [iconList]
  );

  const filteredIcons = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return iconList;

    const matched: IconEntry[] = [];
    for (let i = 0; i < iconList.length; i++) {
      if (searchIndex[i].some((value) => value.includes(query))) {
        matched.push(iconList[i]);
      }
    }
    return matched;
  }, [searchQuery, iconList, searchIndex]);

  const rowCount = Math.ceil(filteredIcons.length / COLUMNS);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_STRIDE) - OVERSCAN_ROWS);
  const lastRow = Math.min(rowCount, firstRow + Math.ceil(VIEWPORT_HEIGHT / ROW_STRIDE) + OVERSCAN_ROWS * 2);
  const startIndex = firstRow * COLUMNS;
  const endIndex = Math.min(filteredIcons.length, lastRow * COLUMNS);

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute left-2.5 top-2.5 text-muted-foreground">
          <Search className="h-4 w-4" />
        </div>
        <Input
          id="icon-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search icons..."
          className="pl-8"
        />
      </div>

      <div
        className="h-[180px] overflow-y-auto border rounded-md"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="grid grid-cols-8 gap-1 p-1" style={{ gridAutoRows: `${ROW_HEIGHT}px` }}>
          {firstRow > 0 && <div style={{ gridColumn: "1 / -1", height: firstRow * ROW_STRIDE }} />}

          {filteredIcons.slice(startIndex, endIndex).map((icon) => {
            const pascalName = icon.pascal_name;
            return (
              <MemoizedIconItem
                key={icon.name}
                icon={icon}
                isSelected={selectedIcon === pascalName}
                onSelect={() => {
                  onSelectIcon(pascalName);
                }}
              />
            );
          })}

          {rowCount - lastRow > 0 && (
            <div style={{ gridColumn: "1 / -1", height: (rowCount - lastRow) * ROW_STRIDE }} />
          )}
        </div>
      </div>
    </div>
  );
}

function IconItem({ icon, isSelected, onSelect }: { icon: IconEntry; isSelected: boolean; onSelect: () => void }) {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      className={`flex flex-col items-center justify-center p-1 cursor-pointer rounded-md ${
        isSelected ? "bg-primary/10 border-primary border" : "border border-muted/50"
      }`}
      onClick={onSelect}
      title={icon.name}
    >
      <div className="relative h-6 w-6 flex items-center justify-center">
        <SpaceIcon id={icon.pascal_name} className="h-5 w-5" />
      </div>
    </motion.div>
  );
}

export const MemoizedIconItem = memo(IconItem);
