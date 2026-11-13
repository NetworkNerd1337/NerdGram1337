/**
 * Palette entry for presentation mode.
 *
 * The shortcut string is a label. F5 and Mod-Shift-Enter are reserved in
 * `commands.ts` and are handled by `presentationKeys.ts`, not by the palette.
 * Call `registerPresentCommand` (or import this module once) so the command
 * is added through `registerCommands`. The return value removes it again.
 */

import { registerCommands, type CommandContext, type PaletteCommand } from "./commands";

export const PRESENT_COMMAND_ID = "diagram.present";

export const presentCommand: PaletteCommand = {
  id: PRESENT_COMMAND_ID,
  title: "Present diagram",
  section: "Preview",
  keywords: ["slideshow", "fullscreen", "projector", "zoom", "pan", "rotate", "f5"],
  shortcut: "F5",
  order: 145,
  when: (ctx: CommandContext) =>
    ctx.route === "editor" && !ctx.conflictOpen && typeof ctx.actions.present === "function",
  run: (ctx) => {
    ctx.actions.present?.();
  },
};

export function registerPresentCommand(): () => void {
  return registerCommands([presentCommand]);
}

export const removePresentCommand = registerPresentCommand();
