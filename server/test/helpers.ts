import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeTempDataDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const previous = process.env.NERDGRAM_DATA_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nerdgram-"));
  process.env.NERDGRAM_DATA_DIR = dir;
  return {
    dir,
    cleanup: async () => {
      if (previous === undefined) delete process.env.NERDGRAM_DATA_DIR;
      else process.env.NERDGRAM_DATA_DIR = previous;
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export function captureConsole(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    logs,
    errors,
    restore() {
      console.log = origLog;
      console.error = origError;
    },
  };
}
