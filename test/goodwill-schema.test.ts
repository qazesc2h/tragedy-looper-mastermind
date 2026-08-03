import charactersJson from "../data/characters.json";
import characterTraitsJson from "../data/character-traits.json";
import goodwillAbilitiesJson from "../data/goodwill-abilities.json";
import goodwillKoJson from "../data/goodwill-ko.json";
import koReleaseJson from "../data/ko-release.json";
import koTranslationsJson from "../data/ko-translations.json";
import { describe, expect, it } from "vitest";

interface SourceAbility {
  rank: number | null;
  en: string;
  timesPerLoop: number | null;
  restrictedToLocation: string[] | null;
  immuneToGoodwillRefusel?: boolean;
}

interface StructuredAbility {
  abilityIndex: number;
  rank: number;
  ko: string | null;
  target: {
    scope: "sameLocation" | "anyCharacter" | "anyLocation" | "self" | "none";
    excludeSelf: boolean;
    tags: string[];
  };
  effect: Record<string, unknown>;
  choices: string[] | null;
  timesPerLoop: number | null;
  restrictedToLocation: string[] | null;
  cannotBeRefused?: boolean;
  _source: string;
}

interface SuppliedAbility {
  rank: number | null;
  ko: string;
  _index?: number;
}

interface CharacterTrait {
  abilityIndex: number;
  ko: string | null;
  _source: string;
}

const characters = charactersJson as unknown as Record<
  string,
  { goodwillAbilities: SourceAbility[] }
>;
const schema = goodwillAbilitiesJson as unknown as Record<
  string,
  StructuredAbility[]
>;
const traits = characterTraitsJson as unknown as Record<
  string,
  CharacterTrait[]
>;
const translations = koTranslationsJson as unknown as Record<string, string>;
const baseCharacters = koReleaseJson.characters["본판"];
const supplied = goodwillKoJson.abilities as unknown as Record<
  string,
  SuppliedAbility[]
>;

describe("structured goodwill-ability data", () => {
  it("covers every Korean base-box character and only ranked abilities", () => {
    expect(Object.keys(schema).sort()).toEqual([...baseCharacters].sort());
    expect(Object.values(schema).flat()).toHaveLength(32);
  });

  it("preserves each characters.json source row and usage restriction", () => {
    for (const [character, abilities] of Object.entries(schema)) {
      for (const ability of abilities) {
        const source = characters[character].goodwillAbilities[ability.abilityIndex];
        expect(source, `${character}:${ability.abilityIndex}`).toBeDefined();
        expect(ability.rank).toBe(source.rank);
        expect(ability._source).toBe(source.en);
        expect(ability.timesPerLoop).toBe(source.timesPerLoop);
        expect(ability.restrictedToLocation).toEqual(
          source.restrictedToLocation,
        );
      }
    }
  });

  it("preserves the two original cannot-refuse flags and no others", () => {
    const protectedAbilities = Object.entries(characters).flatMap(
      ([character, data]) => character.startsWith("_")
        ? []
        : data.goodwillAbilities.flatMap((ability, index) =>
          ability.immuneToGoodwillRefusel
            ? [{ character, index, rank: ability.rank }]
            : []
        ),
    );

    expect(protectedAbilities).toEqual([
      { character: "mysteryBoy", index: 1, rank: 3 },
      { character: "nurse", index: 0, rank: 2 },
    ]);
    expect(schema.mysteryBoy[0].cannotBeRefused).toBe(true);
    expect(schema.nurse[0].cannotBeRefused).toBe(true);
  });

  it("uses only the approved target scopes and null-or-array choices", () => {
    const scopes = new Set([
      "sameLocation",
      "anyCharacter",
      "anyLocation",
      "self",
      "none",
    ]);
    for (const ability of Object.values(schema).flat()) {
      expect(scopes.has(ability.target.scope)).toBe(true);
      expect(
        ability.choices === null || Array.isArray(ability.choices),
      ).toBe(true);
    }
  });

  it("captures the confirmed student, doctor, richStudent and shrineMaiden constraints", () => {
    for (const character of ["boyStudent", "girlStudent"] as const) {
      expect(schema[character][0]).toMatchObject({
        rank: 2,
        ko: translations["-1 :paranoia: on student in same location."],
        target: {
          scope: "sameLocation",
          excludeSelf: true,
          tags: ["student"],
        },
        effect: { counter: "paranoia", delta: -1 },
        choices: null,
      });
    }

    expect(schema.doctor[0]).toMatchObject({
      target: { scope: "sameLocation", excludeSelf: true },
      effect: { counter: "paranoia", delta: null },
      choices: ["+1", "-1"],
    });
    expect(schema.richStudent[0].restrictedToLocation).toEqual([
      "School",
      "City",
    ]);
    expect(schema.shrineMaiden[0]).toMatchObject({
      rank: 3,
      restrictedToLocation: ["Shrine"],
      effect: { counter: "intrigue", delta: -1, fixedLocation: "Shrine" },
    });
  });

  it("uses the root translation dictionary for every ranked ability", () => {
    for (const [character, abilities] of Object.entries(schema)) {
      for (const ability of abilities) {
        expect(
          ability.ko,
          `${character}:${ability.abilityIndex}`,
        ).toBe(translations[ability._source]);
      }
    }
    expect(Object.values(schema).flat().every(({ ko }) => ko !== null))
      .toBe(true);
  });

  it("matches the supplied once-per-loop, refusal and location markers", () => {
    for (const [character, abilities] of Object.entries(supplied)) {
      for (const suppliedAbility of abilities) {
        if (suppliedAbility.rank === null) continue;
        const structured = schema[character].filter(
          ({ rank }) => rank === suppliedAbility.rank,
        )[suppliedAbility._index ?? 0];
        const source = characters[character]
          .goodwillAbilities[structured.abilityIndex];

        expect(
          suppliedAbility.ko.includes("(1루프당 1회)"),
          `${character}:${suppliedAbility.rank}:timesPerLoop`,
        ).toBe(source.timesPerLoop === 1);
        expect(
          suppliedAbility.ko.includes("(거부 불가)"),
          `${character}:${suppliedAbility.rank}:immuneToGoodwillRefusel`,
        ).toBe(source.immuneToGoodwillRefusel === true);
        expect(
          suppliedAbility.ko.includes("(제한:"),
          `${character}:${suppliedAbility.rank}:restrictedToLocation`,
        ).toBe(source.restrictedToLocation !== null);
      }
    }
  });

  it("keeps both journalist rank-2 abilities as distinct rows", () => {
    expect(schema.journalist).toMatchObject([
      {
        abilityIndex: 0,
        rank: 2,
        ko: translations["+1 :paranoia: on any other character."],
        effect: { counter: "paranoia", delta: 1 },
      },
      {
        abilityIndex: 1,
        rank: 2,
        ko: translations[
          "+1 :intrigue: on this Location or any character in this Location."
        ],
        effect: { counter: "intrigue", delta: 1 },
      },
    ]);
  });

  it("covers every passive character trait with one documented fallback", () => {
    const sourceTraits = Object.entries(characters).flatMap(
      ([character, data]) => character.startsWith("_")
        ? []
        : data.goodwillAbilities.flatMap((ability, abilityIndex) =>
          ability.rank === null
            ? [{ character, abilityIndex, source: ability.en }]
            : []
        ),
    );
    const structuredTraits = Object.entries(traits).flatMap(
      ([character, entries]) => entries.map((entry) => ({
        character,
        ...entry,
      })),
    );

    expect(structuredTraits).toHaveLength(21);
    expect(structuredTraits.map(({ character, abilityIndex, _source }) => ({
      character,
      abilityIndex,
      source: _source,
    }))).toEqual(sourceTraits);
    for (const trait of structuredTraits) {
      const expected = trait._source === "Enters game on predefined loop"
        ? "정해진 루프까지는 등장하지 않음"
        : translations[trait._source];
      expect(trait.ko, `${trait.character}:${trait.abilityIndex}`)
        .toBe(expected);
    }
  });
});
