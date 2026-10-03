import { app, webContents, BrowserWindow, type WebContents } from "electron";
import { tabsController } from "@/controllers/tabs-controller";
import { debugPrint } from "@/modules/output";
import { getSettingValueById } from "@/saving/settings";

/**
 * Dev-only memory instrumentation.
 *
 * This answers the question that source inspection cannot: where is the RAM
 * actually going at runtime. It correlates Electron's per-process metrics with
 * the OS process id of every tab's web contents, so sleeping/waking tabs and
 * per-tab renderer cost become visible.
 *
 * It is opt-in and only starts when FLOW_MEMORY_MONITOR=1 is set, so it costs
 * nothing in normal use.
 */

const INTERVALS = {
  /** Frequent enough to catch a tab being opened or put to sleep. */
  active: 5_000,
  /** Slow heartbeat when nothing is happening. */
  idle: 30_000
} as const;

interface ProcessSample {
  pid: number;
  type: string;
  /** Resident set size in bytes. */
  memory: number;
  /** Peak resident set size in bytes since the app started. */
  peakMemory: number;
}

function toBytes(kilobytes: number): number {
  return kilobytes * 1024;
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Describes a web contents well enough to recognise it in a report.
 */
function describeWebContents(contents: WebContents, depth = 0): string {
  const tab = tabsController.getTabByWebContents(contents);

  if (tab) {
    const state = tab.asleep ? "asleep" : "awake";
    const url = tab.webContents?.getURL();
    const title = tab.webContents?.getTitle();

    if (url) return `tab #${tab.id} (${state}) ${url}`;
    if (title) return `tab #${tab.id} (${state}) ${title}`;
    return `tab #${tab.id} (${state})`;
  }

  // Webviews and portal windows nest; stop before following a cycle.
  if (depth < 3) {
    const owner = contents.hostWebContents;
    if (owner && !owner.isDestroyed()) {
      return `${contents.getType()} in ${describeWebContents(owner, depth + 1)}`;
    }
  }

  return `${contents.getType()} ${contents.getURL()}`;
}

/**
 * Builds a pid -> label map for every live renderer we can account for.
 */
function buildRendererLabels(): Map<number, string> {
  const labels = new Map<number, string>();

  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue;

    let pid: number;
    try {
      pid = contents.getOSProcessId();
    } catch {
      continue;
    }

    if (!pid) continue;
    labels.set(pid, describeWebContents(contents));
  }

  return labels;
}

export interface MemoryReport {
  totalMemory: number;
  totalPeakMemory: number;
  byType: { type: string; count: number; memory: number }[];
  /** Largest processes first. */
  top: ProcessSample[];
  awakeTabs: number;
  asleepTabs: number;
}

export function collectMemoryReport(): MemoryReport {
  const metrics = app.getAppMetrics();

  const byType = new Map<string, { count: number; memory: number }>();
  const samples: ProcessSample[] = [];

  let totalMemory = 0;
  let totalPeakMemory = 0;

  for (const metric of metrics) {
    const memory = toBytes(metric.memory.workingSetSize);
    const peakMemory = toBytes(metric.memory.peakWorkingSetSize);

    totalMemory += memory;
    totalPeakMemory += peakMemory;

    const entry = byType.get(metric.type) ?? { count: 0, memory: 0 };
    entry.count += 1;
    entry.memory += memory;
    byType.set(metric.type, entry);

    samples.push({ pid: metric.pid, type: metric.type, memory, peakMemory });
  }

  samples.sort((a, b) => b.memory - a.memory);

  let awakeTabs = 0;
  let asleepTabs = 0;
  const seenTabIds = new Set<number>();

  for (const browserWindow of BrowserWindow.getAllWindows()) {
    for (const tab of tabsController.getTabsInWindow(browserWindow.id)) {
      if (seenTabIds.has(tab.id)) continue;
      seenTabIds.add(tab.id);

      if (tab.asleep) asleepTabs += 1;
      else awakeTabs += 1;
    }
  }

  return {
    totalMemory,
    totalPeakMemory,
    byType: [...byType.entries()].map(([type, entry]) => ({ type, ...entry })).sort((a, b) => b.memory - a.memory),
    top: samples,
    awakeTabs,
    asleepTabs
  };
}

export function formatMemoryReport(report: MemoryReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(72));
  lines.push(
    `MEMORY  total ${formatBytes(report.totalMemory)} (peak ${formatBytes(report.totalPeakMemory)})` +
      `  tabs awake=${report.awakeTabs} asleep=${report.asleepTabs}`
  );
  lines.push("-".repeat(72));

  for (const entry of report.byType) {
    lines.push(
      `  ${entry.type.padEnd(22)} ${String(entry.count).padStart(4)} proc  ${formatBytes(entry.memory).padStart(10)}`
    );
  }

  lines.push("-".repeat(72));
  lines.push("  largest processes");

  const labels = buildRendererLabels();

  for (const sample of report.top.slice(0, 15)) {
    const label = labels.get(sample.pid);
    lines.push(
      `  pid ${String(sample.pid).padStart(7)}  ${formatBytes(sample.memory).padStart(10)}` +
        `  ${sample.type}${label ? `  ${label}` : ""}`
    );
  }

  lines.push("=".repeat(72));

  return lines.join("\n");
}

let timer: NodeJS.Timeout | null = null;
let isIdle = false;

function schedule(tick: () => void, interval: number) {
  if (timer) clearInterval(timer);

  timer = setInterval(tick, interval);
  // Do not let the heartbeat alone keep the main process alive.
  timer.unref?.();
}

/**
 * Starts the memory reporter. Safe to call more than once.
 *
 * Enable it by running the app with FLOW_MEMORY_MONITOR=1.
 */
export function startMemoryMonitor(): void {
  if (timer) return;
  if (process.env.FLOW_MEMORY_MONITOR !== "1") return;

  debugPrint("WINDOWS", `Memory monitor enabled (sleepTabAfter=${String(getSettingValueById("sleepTabAfter"))}).`);

  const tick = () => {
    const report = collectMemoryReport();

    debugPrint("WINDOWS", `\n${formatMemoryReport(report)}`);

    const nowIdle = report.awakeTabs <= 1;
    const interval = nowIdle ? INTERVALS.idle : INTERVALS.active;

    if (nowIdle !== isIdle || !timer) {
      isIdle = nowIdle;
      schedule(tick, interval);
    }
  };

  tick();
}

export function stopMemoryMonitor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
