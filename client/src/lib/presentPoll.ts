/**
 * How often `/present/*` reads the diagram again.
 *
 * A 404 stops. The file is gone, and polling it every two seconds does not
 * bring it back. Other failures wait longer each time, up to 30 seconds, so a
 * brief server error can still recover.
 */

export const PRESENT_POLL_BASE_MS = 2000;
export const PRESENT_POLL_MAX_MS = 30_000;

export const DIAGRAM_MISSING_MESSAGE = "Diagram missing. It is no longer in the workspace.";

export type PresentPollDecision = {
  /** Do not schedule another read. */
  stop: boolean;
  /** Null clears a previous error after a successful read. */
  message: string | null;
  /** Delay before the next read. Ignored when `stop` is true. */
  delayMs: number;
  failures: number;
};

export function presentPollDecision(input: {
  ok: boolean;
  status: number | null;
  failures: number;
  errorMessage?: string;
}): PresentPollDecision {
  if (input.ok) {
    return { stop: false, message: null, delayMs: PRESENT_POLL_BASE_MS, failures: 0 };
  }
  if (input.status === 404) {
    return {
      stop: true,
      message: DIAGRAM_MISSING_MESSAGE,
      delayMs: PRESENT_POLL_BASE_MS,
      failures: input.failures + 1,
    };
  }
  const failures = input.failures + 1;
  const exponent = Math.min(failures - 1, 4);
  const delayMs = Math.min(PRESENT_POLL_MAX_MS, PRESENT_POLL_BASE_MS * 2 ** exponent);
  return {
    stop: false,
    message: input.errorMessage?.trim() || "Could not open this diagram",
    delayMs,
    failures,
  };
}
