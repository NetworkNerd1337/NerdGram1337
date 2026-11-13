import { registerCommands } from "./commands";
import { api } from "../api";

/**
 * GitHub sync actions. No shortcut: F5, Mod-Shift-Enter, Mod-/, Mod-F,
 * Mod-Alt-G, Mod-K, Mod-L, and F11 are already reserved.
 */
registerCommands([
  {
    id: "sync.now",
    title: "Sync now",
    section: "GitHub",
    keywords: ["github", "push", "backup", "diagrams"],
    order: 10,
    run: async (ctx) => {
      await api.syncNow();
      ctx.navigate("/settings");
    },
  },
  {
    id: "sync.status",
    title: "GitHub sync status",
    section: "GitHub",
    keywords: ["github", "account", "repository", "connect"],
    order: 20,
    run: (ctx) => {
      ctx.navigate("/settings");
    },
  },
]);
