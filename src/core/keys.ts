/**
 * A folder as a key ("l:<listId>"): what pins on the bar, blocks on Today, a folder page's filter
 * and its groups are keyed by. Always build and read these keys here.
 */
export const listKey = (listId: string): string => `l:${listId}`;
export const listIdOf = (key: string): string | null => (key.startsWith('l:') ? key.slice(2) : null);

/**
 * A person's preferences record in `settings` ("prefs:<memberId>"): theirs alone, sealed with their
 * personal key (app/userPrefs.ts), unlike the household's `house`. Always build and read these ids here.
 */
export const prefsId = (memberId: string): string => `prefs:${memberId}`;
export const prefsOwnerOf = (id: string): string | null => (id.startsWith('prefs:') ? id.slice(6) : null);
