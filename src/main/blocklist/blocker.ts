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

/**
 * The blocklist holds ~547k hostnames. Materialising them as a `Set<string>`
 * measures at ~52MB of main-process heap once the source array is also kept
 * alive (~12MB for the Set, ~40MB for the host strings). Storing two 32-bit
 * hashes per host in typed arrays drops that to ~8.5MB of heap plus ~8MB of
 * external array-buffer memory, and the source strings are released below.
 *
 * Two independent hashes make an accidental match for a host that is *not* on
 * the list negligible (~1e-9 per lookup), so membership stays effectively
 * exact while lookups stay O(1).
 */
const HASH_SEEDS = [0x811c9dc5, 0x01000193] as const;

/** murmur3 finalizer - spreads the low bits out so masking doesn't cluster. */
function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function hash32(value: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix32(h);
}

/** 0 is reserved to mean "empty slot", so it is never stored. */
function toSlotKey(hash: number): number {
  return hash === 0 ? 1 : hash;
}

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

class HostHashTable {
  private readonly keysA: Uint32Array;
  private readonly keysB: Uint32Array;
  private readonly mask: number;

  constructor(capacity: number) {
    const size = nextPowerOfTwo(capacity);
    this.keysA = new Uint32Array(size);
    this.keysB = new Uint32Array(size);
    this.mask = size - 1;
  }

  add(host: string): void {
    const a = toSlotKey(hash32(host, HASH_SEEDS[0]));
    const b = toSlotKey(hash32(host, HASH_SEEDS[1]));

    let index = a & this.mask;
    while (this.keysA[index] !== 0) {
      index = (index + 1) & this.mask;
    }

    this.keysA[index] = a;
    this.keysB[index] = b;
  }

  has(host: string): boolean {
    const a = toSlotKey(hash32(host, HASH_SEEDS[0]));
    const b = toSlotKey(hash32(host, HASH_SEEDS[1]));

    let index = a & this.mask;
    while (this.keysA[index] !== 0) {
      if (this.keysA[index] === a && this.keysB[index] === b) {
        return true;
      }
      index = (index + 1) & this.mask;
    }

    return false;
  }
}

function buildBlockedHosts(rawHosts: string[]): HostHashTable {
  // 1.5x keeps the load factor at or below ~0.67 even with no de-duplication,
  // which keeps probe chains short while leaving headroom to grow.
  const table = new HostHashTable(Math.ceil(rawHosts.length * 1.5));

  for (let i = 0; i < rawHosts.length; i++) {
    const host = normalizeHostname(rawHosts[i]);
    if (host) {
      table.add(host);
    }
  }

  return table;
}

const BLOCKED_HOSTS: HostHashTable = buildBlockedHosts(blocklistData);

const BLOCKED_HOST_COUNT = blocklistData.length;

// The imported array is the only thing holding ~547k host strings alive.
// Overwrite it in place so those strings become collectable; the table above is
// now the single source of truth.
blocklistData.fill("");

debugPrint("SITE_BLOCKER", `Blocklist loaded with ${BLOCKED_HOST_COUNT} entries.`);

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
