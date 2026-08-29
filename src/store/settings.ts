import type { Difficulty, SortMode } from "../game/types";

// ---------------------------------------------------------------------------
// Persisted settings + cross-match statistics (rule doc §39 / §40).
// ---------------------------------------------------------------------------

export interface MatchStats {
  gamesPlayed: number;
  firsts: number;
  seconds: number;
  thirds: number;
  fourths: number;
  totalPekojans: number;
  selfDrawPekojans: number;
  discardPekojans: number;
  highestHand: number;
  longestChain: number;
  monochromeHands: number;
  bonusHands: number;
}

export interface SettingsState extends MatchStats {
  volume: number; // 0..1
  audioEnabled: boolean;
  animationSpeed: "normal" | "fast";
  difficulty: Difficulty;
  /** freestyle = untimed (current behavior); classic = original turn timers */
  gameMode: "freestyle" | "classic";
  /** offline multiplayer: number of human seats (1..4) */
  humansCount: number;
  /** per-seat display names ("" = default) */
  seatNames: string[];
  sortMode: SortMode;
  claimWindowSeconds: number; // 5..8 configurable
  tutorialDone: boolean;
  language: string;
  lastSeed?: string;
}

const DEFAULT_SETTINGS: SettingsState = {
  volume: 0.6,
  audioEnabled: true,
  animationSpeed: "normal",
  difficulty: "normal",
  gameMode: "freestyle",
  humansCount: 1,
  seatNames: ["", "", "", ""],
  sortMode: "group",
  claimWindowSeconds: 6,
  tutorialDone: false,
  language: "en",
  gamesPlayed: 0,
  firsts: 0,
  seconds: 0,
  thirds: 0,
  fourths: 0,
  totalPekojans: 0,
  selfDrawPekojans: 0,
  discardPekojans: 0,
  highestHand: 0,
  longestChain: 0,
  monochromeHands: 0,
  bonusHands: 0,
};

const KEY = "pekojan-settings-v1";

function load(): SettingsState {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

import { create } from "zustand";

interface SettingsStore {
  settings: SettingsState;
  update(patch: Partial<SettingsState>): void;
  recordMatch(
    placement: number,
    stats: {
      pekojans: number;
      selfDrawWins: number;
      discardWins: number;
      largestHand: number;
      longestChain: number;
      monochrome: number;
      bonusHands: number;
    }
  ): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: load(),
  update(patch) {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  },
  recordMatch(placement, stats) {
    const s = get().settings;
    const next: SettingsState = {
      ...s,
      gamesPlayed: s.gamesPlayed + 1,
      firsts: s.firsts + (placement === 1 ? 1 : 0),
      seconds: s.seconds + (placement === 2 ? 1 : 0),
      thirds: s.thirds + (placement === 3 ? 1 : 0),
      fourths: s.fourths + (placement === 4 ? 1 : 0),
      totalPekojans: s.totalPekojans + stats.pekojans,
      selfDrawPekojans: s.selfDrawPekojans + stats.selfDrawWins,
      discardPekojans: s.discardPekojans + stats.discardWins,
      highestHand: Math.max(s.highestHand, stats.largestHand),
      longestChain: Math.max(s.longestChain, stats.longestChain),
      monochromeHands: s.monochromeHands + stats.monochrome,
      bonusHands: s.bonusHands + stats.bonusHands,
    };
    set({ settings: next });
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(next));
  },
}));

export function averagePlacement(s: MatchStats): number | null {
  if (!s.gamesPlayed) return null;
  return (s.firsts * 1 + s.seconds * 2 + s.thirds * 3 + s.fourths * 4) / s.gamesPlayed;
}
