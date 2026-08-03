// The day the widget was last looked at.
//
// Emergence is "the first open of a day later than the day it was written", and
// the word doing the work there is *first*. Whether a square has already been
// watched hatching is not derivable from the diary: `hasEmerged` says the day
// has turned, which stays true forever, and nothing in a kigo file records that
// anybody was in the room. So one date has to be remembered, and this is it.
//
// It is not diary data and it must never become any. It is a fact about the
// application — the same kind of thing as which window the user dragged it to —
// so it lives in the webview's own storage rather than in the store, and the
// store's rules about markdown, schemas and migrations do not apply to it. No
// file appears next to anyone's entries because of this.
//
// It is also allowed to be lost. If it is missing, `since` returns today, which
// means nothing hatches — an app that opened by unfolding a hundred and fifty
// butterflies because a browser profile had been cleared would be far worse
// than one that quietly missed a ceremony. Failing safe is the whole of the
// error handling here.
//
// The clock's scrubbed days are deliberately not written. A widget parked two
// years in the future for a minute must not come back to a real Tuesday and
// decide that nothing has happened since 2028.

const KEY = "saijiki.lastOpen";

function shelf(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can be disabled outright, and asking is the throw.
    return null;
  }
}

function keyFor(store: string): string {
  // The synthetic store keeps its own, so a seeded afternoon of scrubbing does
  // not decide what the real diary thinks it has already shown you.
  return store === "dev" ? `${KEY}.dev` : KEY;
}

/**
 * The last day this was open, or `fallback` if there is no answer.
 *
 * Callers pass today as the fallback, which is what makes a first run, a
 * cleared profile and a storage-less environment all mean "nothing is waiting".
 */
export function lastOpen(store: string, fallback: string): string {
  const value = shelf()?.getItem(keyFor(store)) ?? null;
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

/** Remember it. Never throws: a full or read-only profile is not an emergency. */
export function rememberOpen(store: string, day: string): void {
  try {
    shelf()?.setItem(keyFor(store), day);
  } catch {
    /* ignored on purpose */
  }
}
