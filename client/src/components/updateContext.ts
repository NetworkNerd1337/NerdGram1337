import { createContext, useContext } from "react";
import type { UpdateJob, UpdateStatus } from "../types";

export type UpdatePanel = "about" | "notes" | "docker" | "manual" | "progress" | null;

export type UpdateContextValue = {
  status: UpdateStatus | null;
  job: UpdateJob | null;
  busy: boolean;
  notice: string | null;
  panel: UpdatePanel;
  actionError: string | null;
  openAbout: () => void;
  closePanel: () => void;
  checkNow: (options?: { keepPanel?: boolean }) => Promise<void>;
  later: () => Promise<void>;
  skip: () => Promise<void>;
  clearSkipped: () => Promise<void>;
  setAutomatic: (value: boolean) => Promise<void>;
  setPrerelease: (value: boolean) => Promise<void>;
  openNotes: () => void;
  openUpgrade: () => void;
  startApply: () => Promise<void>;
  reload: () => void;
  dismissNotice: () => void;
};

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("Update controls are not available on this screen.");
  return value;
}
