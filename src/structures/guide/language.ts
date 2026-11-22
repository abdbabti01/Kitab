// The learner's chosen code language: the one Data Structures preference worth keeping. A plain validated string;
// anything else stored under the key (corrupt, or a value from a newer version) falls back to C# without being erased.
import type { Lang } from "./content.ts";

export const LANGUAGE_KEY = "kitab.code-language.v1";
const known = (value: unknown): value is Lang => value === "csharp" || value === "java" || value === "python";

export function readLanguage(storage: Pick<Storage, "getItem">): Lang {
  try {
    const value = storage.getItem(LANGUAGE_KEY);
    return known(value) ? value : "csharp";
  } catch {
    return "csharp";
  }
}

/** Saves the choice if storage allows; a failed write keeps the choice for this page only. */
export function writeLanguage(storage: Pick<Storage, "setItem">, lang: Lang) {
  try {
    storage.setItem(LANGUAGE_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

export const isLang = known;
