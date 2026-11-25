import type { Moment } from '../core/model';

/** How it felt, in one tap. */
export const FEELS = ['🥰', '😂', '🎉', '😌', '🌿', '✨'];

/** The same day in an earlier year (or, failing that, an earlier month): "a year ago today". */
export function onThisDay(moments: Moment[], day: string): { moment: Moment; ago: string } | null {
  const [y, m, d] = day.split('-');
  const year = moments.find((x) => x.day.slice(5) === `${m}-${d}` && x.day.slice(0, 4) < y);
  if (year) {
    const n = +y - +year.day.slice(0, 4);
    return { moment: year, ago: n === 1 ? 'A year ago today' : `${n} years ago today` };
  }
  const month = moments.find((x) => x.day.slice(8) === d && x.day.slice(0, 7) < `${y}-${m}`);
  if (month) {
    const n = (+y - +month.day.slice(0, 4)) * 12 + (+m - +month.day.slice(5, 7));
    return { moment: month, ago: n === 1 ? 'A month ago today' : `${n} months ago today` };
  }
  return null;
}
