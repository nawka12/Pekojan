import type { Character, Group } from "../game/types";

// ---------------------------------------------------------------------------
// Character roster & generation (group) data.
//
// Data-driven: swapping this file re-skins the entire game. Group `symbol`
// is the crest printed on every card's corner index; `name` appears in the
// bottom-left label. Fubuki belongs to two generations, so "1st Gen" and
// "Gamers" are mutually exclusive within a match.
// ---------------------------------------------------------------------------

export const GROUPS: Group[] = [
  {
    id: "gen0",
    name: "0th Gen",
    symbol: "0",
    shortLabel: "Gen 0",
    characterIds: ["sora", "roboco", "azki", "miko", "suisei"],
  },
  {
    id: "gen1",
    name: "1st Gen",
    symbol: "1",
    shortLabel: "Gen 1",
    characterIds: ["fubuki", "matsuri", "aki", "haato"],
    mutuallyExclusiveWith: ["gamers"],
  },
  {
    id: "gen2",
    name: "2nd Gen",
    symbol: "2",
    shortLabel: "Gen 2",
    characterIds: ["ayame", "choco", "subaru", "shion"],
  },
  {
    id: "gamers",
    name: "Gamers",
    symbol: "Ga",
    shortLabel: "Gamers",
    characterIds: ["fubuki", "mio", "okayu", "korone"],
    mutuallyExclusiveWith: ["gen1"],
  },
  {
    id: "gen3",
    name: "3rd Gen",
    symbol: "3",
    shortLabel: "Gen 3",
    characterIds: ["pekora", "flare", "noel", "marine"],
  },
  {
    id: "gen4",
    name: "4th Gen",
    symbol: "4",
    shortLabel: "Gen 4",
    characterIds: ["watame", "towa", "luna", "kanata"],
  },
  {
    id: "gen5",
    name: "5th Gen",
    symbol: "5",
    shortLabel: "Gen 5",
    characterIds: ["lamy", "nene", "botan", "polka"],
  },
  {
    id: "holox",
    name: "holoX",
    symbol: "X",
    shortLabel: "holoX",
    characterIds: ["laplus", "lui", "koyori", "iroha", "chloe"],
  },
  {
    id: "id1",
    name: "ID 1st Gen",
    symbol: "ID1",
    shortLabel: "ID 1",
    characterIds: ["risu", "moona", "iofi"],
  },
  {
    id: "id2",
    name: "ID 2nd Gen",
    symbol: "ID2",
    shortLabel: "ID 2",
    characterIds: ["ollie", "anya", "reine"],
  },
  {
    id: "id3",
    name: "ID 3rd Gen",
    symbol: "ID3",
    shortLabel: "ID 3",
    characterIds: ["zeta", "kaela", "kobo"],
  },
  {
    id: "myth",
    name: "Myth",
    symbol: "My",
    shortLabel: "Myth",
    characterIds: ["calliope", "kiara", "inanis", "gura", "amelia"],
  },
  {
    id: "promise",
    name: "Promise",
    symbol: "Pr",
    shortLabel: "Promise",
    characterIds: ["irys", "kronii", "baelz", "fauna", "mumei"],
  },
  {
    id: "advent",
    name: "Advent",
    symbol: "Ad",
    shortLabel: "Advent",
    characterIds: ["shiori", "bijou", "nerissa", "fuwawa", "mococo"],
  },
  {
    id: "regloss",
    name: "ReGLOSS",
    symbol: "Re",
    shortLabel: "ReGLOSS",
    characterIds: ["kanade", "ririka", "raden", "hajime", "ao"],
  },
];

const EMOJI: Record<string, string> = {
  // 0th Gen
  sora: "🐻", roboco: "🤖", azki: "⚒️", miko: "🌸", suisei: "☄️",
  // 1st Gen
  fubuki: "🌽", matsuri: "🏮", aki: "🍎", haato: "❤️",
  // 2nd Gen
  ayame: "😈", choco: "💋", subaru: "🚑", shion: "🌙",
  // Gamers
  mio: "🌲", okayu: "🍙", korone: "🥐",
  // 3rd Gen
  pekora: "👯‍♀️", flare: "🔥", noel: "⚔️", marine: "🏴‍☠️",
  // 4th Gen
  watame: "🐏", towa: "👾", luna: "🍬", kanata: "💫",
  // 5th Gen
  lamy: "☃️", nene: "🥟", botan: "♌", polka: "🎪",
  // holoX
  laplus: "🛸", lui: "🥀", koyori: "🧪", iroha: "🍃", chloe: "🎣",
  // ID
  risu: "🐿️", moona: "🔮", iofi: "🎨",
  ollie: "🧟‍♀️", anya: "🍂", reine: "🦚",
  zeta: "📜", kaela: "🔨", kobo: "☔",
  // EN
  calliope: "💀", kiara: "🐔", inanis: "🐙", gura: "🔱", amelia: "🔎",
  irys: "💎", kronii: "⏳", baelz: "🎲", fauna: "🌿", mumei: "🪶",
  shiori: "👁️‍🗨️", bijou: "🗿", nerissa: "🎷", fuwawa: "🐾🩵", mococo: "🐾🩷",
  // ReGLOSS
  kanade: "🎼", ririka: "💡", raden: "🪭", hajime: "⚡", ao: "🖋️",
};

/** Unique characters across all groups (Fubuki appears in two). */
export const CHARACTERS: Character[] = GROUPS.flatMap((g) =>
  g.characterIds.map((id) => ({
    id,
    name: displayName(id),
    groupId: g.id,
    emoji: EMOJI[id] ?? "🎴",
  }))
).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);

function displayName(id: string): string {
  const NAMES: Record<string, string> = {
    sora: "Sora", roboco: "Roboco", azki: "AZKi", miko: "Miko", suisei: "Suisei",
    fubuki: "Fubuki", matsuri: "Matsuri", aki: "Aki", haato: "Haato",
    ayame: "Ayame", choco: "Choco", subaru: "Subaru", shion: "Shion",
    mio: "Mio", okayu: "Okayu", korone: "Korone",
    pekora: "Pekora", flare: "Flare", noel: "Noel", marine: "Marine",
    watame: "Watame", towa: "Towa", luna: "Luna", kanata: "Kanata",
    lamy: "Lamy", nene: "Nene", botan: "Botan", polka: "Polka",
    laplus: "La+", lui: "Lui", koyori: "Koyori", iroha: "Iroha", chloe: "Chloe",
    risu: "Risu", moona: "Moona", iofi: "Iofi",
    ollie: "Ollie", anya: "Anya", reine: "Reine",
    zeta: "Zeta", kaela: "Kaela", kobo: "Kobo",
    calliope: "Calliope", kiara: "Kiara", inanis: "Ina'nis", gura: "Gura", amelia: "Amelia",
    irys: "IRyS", kronii: "Kronii", baelz: "Baelz", fauna: "Fauna", mumei: "Mumei",
    shiori: "Shiori", bijou: "Bijou", nerissa: "Nerissa", fuwawa: "Fuwawa", mococo: "Mococo",
    kanade: "Kanade", ririka: "Ririka", raden: "Raden", hajime: "Hajime", ao: "Ao",
  };
  return NAMES[id] ?? id;
}

export function getCharacter(id: string): Character {
  return CHARACTERS.find((c) => c.id === id)!;
}

export function getGroup(id: string): Group {
  return GROUPS.find((g) => g.id === id)!;
}
