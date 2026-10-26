/**
 * Helpers for the tutor's bounded claim checks. They catch specific, supported claim shapes
 * (counts written as digits or words, named mechanisms); they are not general fact verification.
 */
const words: Record<string, number> = {
  zero: 0, no: 0, none: 0, one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

/** Spelled-out numbers ("Three", "ten") as digits, so "Three elements" and "3 elements" are checked alike. */
export function normalizeNumberWords(text: string) {
  return text.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi, (word) => String(words[word.toLowerCase()]));
}
