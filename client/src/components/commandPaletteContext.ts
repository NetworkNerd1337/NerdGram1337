import { createContext, useContext } from "react";
import type { CommandHostInput } from "../lib/commands";

export type PaletteControls = {
  setHost: (input: CommandHostInput) => void;
  openPalette: () => void;
};

export const PaletteContext = createContext<PaletteControls | null>(null);

export function useCommandHost(input: CommandHostInput): void {
  const controls = useContext(PaletteContext);
  controls?.setHost(input);
}

export function usePaletteControls(): PaletteControls {
  const controls = useContext(PaletteContext);
  if (!controls) {
    throw new Error("Commands are only available inside the app shell");
  }
  return controls;
}
