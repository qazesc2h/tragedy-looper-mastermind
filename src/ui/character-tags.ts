import { characterDataOf } from "../data";
import type { CharacterId } from "../types";
import { translatedText } from "./terms";

const TAG_TRANSLATION_KEYS: Readonly<Record<string, string>> = {
  adult: "Adult",
  animal: "Animal",
  boy: "Boy",
  construct: "Construct",
  girl: "Girl",
  littleSisterKeyword: "Little Sister",
  man: "Man",
  student: "Student",
  tree: "Tree",
  woman: "Woman",
};

export function characterTagLabels(character: CharacterId): string[] {
  return characterDataOf(character).tags.map((tag) => {
    const translationKey = TAG_TRANSLATION_KEYS[tag] ?? tag;
    return translatedText(translationKey, translationKey);
  });
}
