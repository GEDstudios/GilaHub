/**
 * A folder as a key ("l:<listId>"): what pins on the bar, blocks on Today, a folder page's filter
 * and its groups are keyed by. Always build and read these keys here.
 */
export const listKey = (listId: string): string => `l:${listId}`;
export const listIdOf = (key: string): string | null => (key.startsWith('l:') ? key.slice(2) : null);
