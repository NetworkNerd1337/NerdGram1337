import { registerCommands } from "./commands";

/**
 * About and update check. No shortcut: F5, Mod-Shift-Enter, Mod-/, Mod-F,
 * Mod-Alt-G, Mod-K, Mod-L, and F11 are already reserved.
 */
registerCommands([
  {
    id: "app.about",
    title: "About NerdGram1337",
    section: "Help",
    keywords: ["version", "update", "release", "docker"],
    order: 200,
    run: () => {
      window.dispatchEvent(new CustomEvent("nerdgram:about"));
    },
  },
  {
    id: "app.checkUpdates",
    title: "Check for updates",
    section: "Help",
    keywords: ["upgrade", "release", "version", "docker"],
    order: 210,
    run: () => {
      window.dispatchEvent(new CustomEvent("nerdgram:check-updates"));
    },
  },
]);
