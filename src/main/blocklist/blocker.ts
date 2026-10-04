import { debugPrint } from "@/modules/output";
import { loadedProfilesController } from "@/controllers/loaded-profiles-controller";
import { sessionsController, unifiedWebRequests } from "@/controllers/sessions-controller";
import { session, type Session } from "electron";
import { readFileSync } from "fs";
import { join } from "path";

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
 * The blocklist is ~12MB of JSON holding ~547k hostnames, and it is user-owned
 * so it ships as an asset next to the main bundle rather than a JS import.
 *
 * Importing it as a module meant V8 had to compile an ~11MB array literal on
 * every startup (~290ms, ~33MB transient heap) just to materialise ~547k
 * strings that we immediately hashed and threw away. Reading the file as a
 * `Buffer` and hashing each host straight out of its byte range skips both
 * costs - no listed hostname is ever allocated as a string.
 *
 * Two independent 32-bit hashes make an accidental match for a host that is
 * *not* on the list negligible (~1e-9 per lookup), so membership stays
 * effectively exact while lookups stay O(1).
 */
const HASH_SEEDS = [0x811c9dc5, 0x01000193] as const;

const BLOCKLIST_FILE_NAME = "blocklist.json";

const CHAR_TAB = 0x09;
const CHAR_LINE_FEED = 0x0a;
const CHAR_CARRIAGE_RETURN = 0x0d;
const CHAR_SPACE = 0x20;
const CHAR_QUOTE = 0x22;
const CHAR_ASTERISK = 0x2a;
const CHAR_COMMA = 0x2c;
const CHAR_DOT = 0x2e;
const CHAR_OPEN_BRACKET = 0x5b;
const CHAR_BACKSLASH = 0x5c;
const CHAR_CLOSE_BRACKET = 0x5d;
const ASCII_MAX = 0x7f;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const ASCII_LOWERCASE_OFFSET = 0x20;
const FNV_PRIME = 0x01000193;

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
    h = Math.imul(h, FNV_PRIME);
  }
  return mix32(h);
}

/**
 * Hashes an already-normalised, ASCII-only byte range. Must stay identical to
 * running `hash32` over the equivalent string, which is why the only transform
 * applied here is `A-Z` -> `a-z`: for ASCII that is precisely what
 * `String.prototype.toLowerCase()` does, and `bytes[i]` is then equal to the
 * string's `charCodeAt(i)`.
 *
 * Returns `null` if the range contains a non-ASCII byte, because
 * `toLowerCase()` can change the length of such characters (for example
 * "İ") and the two paths would stop agreeing. Those entries - in practice
 * none - fall back to the string path.
 */
function hash32AsciiRange(bytes: Buffer, start: number, end: number, seed: number): number | null {
  let h = seed >>> 0;

  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    if (byte > ASCII_MAX) return null;
    h ^= byte >= UPPER_A && byte <= UPPER_Z ? byte + ASCII_LOWERCASE_OFFSET : byte;
    h = Math.imul(h, FNV_PRIME);
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

  private insert(a: number, b: number): void {
    let index = a & this.mask;
    while (this.keysA[index] !== 0) {
      index = (index + 1) & this.mask;
    }

    this.keysA[index] = a;
    this.keysB[index] = b;
  }

  addHashes(a: number, b: number): void {
    this.insert(toSlotKey(a), toSlotKey(b));
  }

  add(host: string): void {
    this.addHashes(hash32(host, HASH_SEEDS[0]), hash32(host, HASH_SEEDS[1]));
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

/** JSON's own definition of insignificant whitespace. */
function isJsonWhitespace(byte: number): boolean {
  return byte === CHAR_SPACE || byte === CHAR_LINE_FEED || byte === CHAR_TAB || byte === CHAR_CARRIAGE_RETURN;
}

interface HostRange {
  start: number;
  end: number;
}

/**
 * Walks a JSON array of strings, handing each element's byte range to `visit`
 * without allocating anything. `escaped` reports whether the element contained
 * a backslash escape, in which case its byte range is *not* the same text the
 * old `JSON.parse` import produced and the caller must take the string path.
 */
function visitJsonStringArray(bytes: Buffer, visit: (start: number, end: number, escaped: boolean) => void): void {
  const length = bytes.length;
  let cursor = 0;

  while (cursor < length && isJsonWhitespace(bytes[cursor])) cursor++;
  if (bytes[cursor] !== CHAR_OPEN_BRACKET) {
    throw new Error("Blocklist is not a JSON array.");
  }
  cursor++;

  while (cursor < length) {
    while (cursor < length && (isJsonWhitespace(bytes[cursor]) || bytes[cursor] === CHAR_COMMA)) {
      cursor++;
    }

    if (cursor >= length) break;
    if (bytes[cursor] === CHAR_CLOSE_BRACKET) return;
    if (bytes[cursor] !== CHAR_QUOTE) {
      throw new Error(`Blocklist entry at byte ${cursor} is not a string.`);
    }

    cursor++;
    const start = cursor;
    let escaped = false;

    while (cursor < length && bytes[cursor] !== CHAR_QUOTE) {
      if (bytes[cursor] === CHAR_BACKSLASH) {
        escaped = true;
        cursor += 2;
      } else {
        cursor++;
      }
    }

    if (cursor >= length) {
      throw new Error("Blocklist has an unterminated string.");
    }

    const end = cursor;
    cursor++;
    visit(start, end, escaped);
  }

  throw new Error("Blocklist is missing its closing bracket.");
}

/**
 * Byte-level equivalent of `normalizeHostname`, expressed as offsets so no
 * intermediate string is needed. Returns `null` when nothing is left.
 */
function normalizeHostRange(bytes: Buffer, start: number, end: number): HostRange | null {
  while (start < end && isJsonWhitespace(bytes[start])) start++;
  while (end > start && isJsonWhitespace(bytes[end - 1])) end--;

  // `.replace(/^\*\./, "")`
  if (end - start >= 2 && bytes[start] === CHAR_ASTERISK && bytes[start + 1] === CHAR_DOT) {
    start += 2;
  }

  // `.replace(/^\.+|\.+$/g, "")`
  while (start < end && bytes[start] === CHAR_DOT) start++;
  while (end > start && bytes[end - 1] === CHAR_DOT) end--;

  if (start >= end) return null;
  return { start, end };
}

function buildBlockedHosts(bytes: Buffer): { table: HostHashTable; count: number } {
  let count = 0;
  visitJsonStringArray(bytes, () => {
    count++;
  });

  // 1.5x keeps the load factor at or below ~0.67 even with no de-duplication,
  // which keeps probe chains short while leaving headroom to grow.
  const table = new HostHashTable(Math.ceil(count * 1.5));

  visitJsonStringArray(bytes, (start, end, escaped) => {
    const range = normalizeHostRange(bytes, start, end);
    if (!range) return;

    if (!escaped) {
      const a = hash32AsciiRange(bytes, range.start, range.end, HASH_SEEDS[0]);
      if (a !== null) {
        const b = hash32AsciiRange(bytes, range.start, range.end, HASH_SEEDS[1]);
        if (b !== null) {
          table.addHashes(a, b);
          return;
        }
      }
    }

    // Escaped or non-ASCII entry: go through a string so behaviour is identical
    // to what the old `JSON.parse` import produced.
    const host = normalizeHostname(bytes.toString("utf8", start, end));
    if (host) table.add(host);
  });

  return { table, count };
}

function readBlocklistBytes(): Buffer | null {
  const filePath = join(__dirname, BLOCKLIST_FILE_NAME);

  try {
    return readFileSync(filePath);
  } catch (error) {
    // Deliberately failing open. A browser that refuses to start is worse than
    // one that stops blocking, and this can only happen if the app was built or
    // packaged without the asset.
    console.error(
      `[site-blocker] Could not read "${filePath}", so requests will not be blocked. ` +
        `Make sure "${BLOCKLIST_FILE_NAME}" is emitted next to the main bundle.`,
      error
    );
    return null;
  }
}

function loadBlockedHosts(): { table: HostHashTable; count: number } {
  const empty = { table: new HostHashTable(16), count: 0 };

  const bytes = readBlocklistBytes();
  if (!bytes) return empty;

  try {
    return buildBlockedHosts(bytes);
  } catch (error) {
    console.error("[site-blocker] Could not parse the blocklist, so requests will not be blocked.", error);
    return empty;
  }
}

const { table: BLOCKED_HOSTS, count: BLOCKED_HOST_COUNT } = loadBlockedHosts();

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
