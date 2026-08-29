import { motion } from "framer-motion";
import type { GameState } from "../game/types";
import { SeatToken } from "./PlayerSeat";
import { useGame } from "../store/game";

/**
 * Hot-seat privacy gate: shown whenever a different human must act next.
 * Fully opaque so the previous player's hand can't linger on screen.
 */
export function PassDeviceOverlay({ state, forPlayer }: { state: GameState; forPlayer: number }) {
  const revealFor = useGame((s) => s.revealFor);
  const player = state.players[forPlayer];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[55] grid place-items-center p-4"
      style={{ background: "var(--color-night)" }}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="label">Pass the device to</p>
        <div className="slab flex items-center gap-3 px-6 py-4">
          <SeatToken playerId={forPlayer} name={player.name} />
          <span className="display text-2xl text-[#f3ecd9]">{player.name}</span>
        </div>
        <p className="max-w-xs text-sm leading-relaxed text-[#9aa3b5]">
          Everyone else: avert your eyes. Their hand stays hidden until they
          take over.
        </p>
        <button onClick={() => revealFor(forPlayer)} className="btn-primary px-8 py-3 text-base">
          I'm {player.name} — show my hand
        </button>
      </div>
    </motion.div>
  );
}
