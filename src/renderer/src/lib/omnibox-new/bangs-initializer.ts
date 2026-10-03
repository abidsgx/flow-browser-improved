export type BangEntry = {
  /** category */
  c?: string;
  /** subcategory */
  sc?: string;
  /** domain */
  d: string;
  /** relevance */
  r: number;
  /** display name / site name */
  s: string;
  /** bang trigger text */
  t: string;
  /** search url template, with {{{s}}} replaced with the search query */
  u: string;
};

let bangs: BangEntry[] | undefined;
let bangsPromise: Promise<BangEntry[]> | undefined;

async function preloadBangs() {
  if (bangs) return false;
  const bangsModule = (await import("./bangs")) as unknown as { bangs: BangEntry[] };
  bangs = bangsModule.bangs;
  return true;
}

export async function waitForBangsLoad() {
  if (bangs) return bangs;
  getBangs();
  if (bangsPromise) {
    return await bangsPromise;
  }
  throw new Error("Bangs not loaded - should be unreachable!!");
}

export function getBangs() {
  if (bangs) return bangs;
  if (!bangsPromise) {
    bangsPromise = preloadBangs().then(() => {
      bangsPromise = undefined;
      if (bangs) return bangs;
      throw new Error("Bangs not loaded after preload - should be unreachable!!");
    });
  }
  return [];
}

/**
 * Warms the bang list without waiting for it.
 *
 * The dataset is a ~2.5MB chunk. Previously this module kicked off the load at
 * import time, so every renderer paid for it during startup whether or not
 * bangs were ever used. Now the omnibox primes it when it opens, which keeps
 * bangs working while taking the cost off the startup path.
 */
export function primeBangs(): void {
  getBangs();
}
