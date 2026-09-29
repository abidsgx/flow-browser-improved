import { debugPrint } from "@/modules/output";
import { loadedProfilesController } from "@/controllers/loaded-profiles-controller";
import { sessionsController, unifiedWebRequests } from "@/controllers/sessions-controller";
import { session, type Session } from "electron";
import blocklistData from "./blocklist.json";

const SESSION_KEY = "site-blocker";

const attachedSessions = new WeakSet<Session>();

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\*\./, "")
    .replace(/^\.+|\.+$/g, "");
}

function buildBlockedHosts(rawHosts: string[]): ReadonlySet<string> {
  const blockedHosts = new Set<string>();
  for (const rawHost of rawHosts) {
    const host = normalizeHostname(rawHost);
    if (host) {
      blockedHosts.add(host);
    }
  }
  return blockedHosts;
}

const BLOCKED_HOSTS: ReadonlySet<string> = buildBlockedHosts(blocklistData);

debugPrint("SITE_BLOCKER", `Blocklist loaded with ${BLOCKED_HOSTS.size} entries.`);

function getRequestHostname(url: string): string | null {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Checks whether a hostname (or any of its parent domains) is on the blocklist.
 */
export function isHostBlocked(hostname: string): boolean {
  let suffix = normalizeHostname(hostname);
  if (!suffix) return false;

  while (suffix.includes(".")) {
    if (BLOCKED_HOSTS.has(suffix)) return true;
    suffix = suffix.slice(suffix.indexOf(".") + 1);
  }

  return false;
}

/**
 * Checks whether a full URL points at a blocked hostname.
 */
export function isUrlBlocked(url: string): boolean {
  const hostname = getRequestHostname(url);
  if (!hostname) return false;
  return isHostBlocked(hostname);
}

function attachBlockerToSession(session: Session): void {
  if (attachedSessions.has(session)) return;
  attachedSessions.add(session);

  const webRequest = unifiedWebRequests.createSession(session, SESSION_KEY).webRequest;

  webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    if (!isUrlBlocked(details.url)) {
      callback({});
      return;
    }

    debugPrint("SITE_BLOCKER", "Blocked request:", details.url);

    if (details.resourceType === "mainFrame") {
      const errorPageURL = new URL("flow://error");
      errorPageURL.searchParams.set("errorCode", "-330");
      errorPageURL.searchParams.set("url", details.url);
      errorPageURL.searchParams.set("initial", "1");
      callback({ redirectURL: errorPageURL.toString() });
      return;
    }

    callback({ cancel: true });
  });

  debugPrint("SITE_BLOCKER", "Blocker attached to a session.");
}

function initializeSiteBlocker(): void {
  for (const profile of loadedProfilesController.getAll()) {
    attachBlockerToSession(profile.session);
  }
}

sessionsController.whenDefaultSessionReady().then(() => {
  attachBlockerToSession(session.defaultSession);
});

loadedProfilesController.on("profile-loaded", () => {
  initializeSiteBlocker();
});
