/** Immutable formatters only; no dates, prices or user data are cached. */
const dates = new Map<string, Intl.DateTimeFormat>();
const numbers = new Map<string, Intl.NumberFormat>();
const LIMIT = 48;
export function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let formatter = dates.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (dates.size >= LIMIT) dates.clear();
    dates.set(key, formatter);
  }
  return formatter;
}
export function numberFormatter(locale: string, options: Intl.NumberFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let formatter = numbers.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    if (numbers.size >= LIMIT) numbers.clear();
    numbers.set(key, formatter);
  }
  return formatter;
}
