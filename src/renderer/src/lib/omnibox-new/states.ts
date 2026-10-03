import { getUniqueKeyFromUrl } from "@/lib/omnibox-new/helpers";

// Stores the current profile id for the omnibox.
let currentProfileId: string | undefined = undefined;
export function setOmniboxCurrentProfileId(profileId: string | undefined) {
  currentProfileId = profileId;
}
export function getOmniboxCurrentProfileId(): string | undefined {
  return currentProfileId;
}

// Stores the current space id for the omnibox.
let currentSpaceId: string | undefined = undefined;
export function setOmniboxCurrentSpaceId(spaceId: string | undefined) {
  currentSpaceId = spaceId;
}
export function getOmniboxCurrentSpaceId(): string | undefined {
  return currentSpaceId;
}

// URL Title Cache
// Bounded so that a long browsing session cannot grow it without limit; the
// oldest entries are evicted first and reads refresh recency.
const URL_TITLE_CACHE_LIMIT = 500;
const urlTitleCache = new Map<string, string>();

export function cacheUrlTitle(url: string, title: string) {
  const key = getUniqueKeyFromUrl(url);

  urlTitleCache.delete(key);
  urlTitleCache.set(key, title);

  while (urlTitleCache.size > URL_TITLE_CACHE_LIMIT) {
    const oldest = urlTitleCache.keys().next();
    if (oldest.done) break;
    urlTitleCache.delete(oldest.value);
  }
}

export function getCachedUrlTitle(url: string): string | undefined {
  const key = getUniqueKeyFromUrl(url);
  const title = urlTitleCache.get(key);
  if (title === undefined) return undefined;

  urlTitleCache.delete(key);
  urlTitleCache.set(key, title);
  return title;
}
