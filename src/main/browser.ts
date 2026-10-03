/**
 * Main entrypoint after conditions met in index.ts
 */

// Import everything
import "@/controllers";
import "@/ipc";
import "@/modules/content-blocker";
import "@/blocklist/blocker";
import "@/modules/extensions/main";
import { setupPlatformIntegration } from "@/app/platform";
import { processInitialUrl } from "@/app/urls";
import { setupSecondInstanceHandling } from "@/app/instance";
import { runOnboardingOrInitialWindow } from "@/app/onboarding";
import { setupAppLifecycle } from "@/app/lifecycle";
import { tabPersistenceManager } from "@/saving/tabs";
import { initCursorEdgeMonitor } from "@/controllers/windows-controller/utils/cursor-edge-monitor";
import { cleanupStaleEphemeralProfiles } from "@/controllers/profiles-controller/ephemeral";
import { initTabSync } from "@/controllers/tabs-controller/tab-sync";
import { pinnedTabsController } from "@/controllers/pinned-tabs-controller";
import { startMemoryMonitor } from "@/modules/memory-monitor";
import { onSettingsCached } from "@/saving/settings";

async function bootstrapBrowser() {
  await cleanupStaleEphemeralProfiles().catch((error) => {
    console.error("Failed to cleanup stale ephemeral profiles:", error);
  });

  // Make sure settings (including any migrations) are resolved before the
  // optional memory monitor reports on them.
  await onSettingsCached().catch(() => undefined);
  startMemoryMonitor();

  // Start tab persistence flush interval (writes dirty tabs to disk every ~2s)
  tabPersistenceManager.start();

  // Load pinned tabs from database into memory (synchronous — better-sqlite3)
  pinnedTabsController.loadAll();

  // Start cursor edge monitor (detects pointer near window edges for floating sidebar)
  initCursorEdgeMonitor();

  // Initialize tab sync (handles moving active tabs between windows when sync enabled)
  initTabSync();

  // Handle initial URL (runs asynchronously)
  processInitialUrl();

  // Setup second instance handler
  setupSecondInstanceHandling();

  // Setup platform specific features
  setupPlatformIntegration();

  // Open onboarding / create initial window
  runOnboardingOrInitialWindow();

  // App lifecycle events
  setupAppLifecycle();
}

void bootstrapBrowser();
