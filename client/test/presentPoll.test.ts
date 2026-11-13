import { describe, expect, it } from "vitest";
import {
  DIAGRAM_MISSING_MESSAGE,
  PRESENT_POLL_BASE_MS,
  PRESENT_POLL_MAX_MS,
  presentPollDecision,
} from "../src/lib/presentPoll";

describe("presentation polling", () => {
  it("stops on 404 with a diagram-missing message", () => {
    const decision = presentPollDecision({
      ok: false,
      status: 404,
      failures: 2,
      errorMessage: "Not found",
    });
    expect(decision.stop).toBe(true);
    expect(decision.message?.toLowerCase()).toContain("diagram missing");
    expect(decision.message).toBe(DIAGRAM_MISSING_MESSAGE);
    expect(decision.failures).toBe(3);
  });

  it("backs off on other errors and resets after a successful read", () => {
    const first = presentPollDecision({
      ok: false,
      status: 503,
      failures: 0,
      errorMessage: "unavailable",
    });
    expect(first.stop).toBe(false);
    expect(first.delayMs).toBe(PRESENT_POLL_BASE_MS);
    expect(first.message).toBe("unavailable");

    const second = presentPollDecision({
      ok: false,
      status: 500,
      failures: first.failures,
      errorMessage: "still down",
    });
    expect(second.stop).toBe(false);
    expect(second.delayMs).toBe(PRESENT_POLL_BASE_MS * 2);

    let failures = 0;
    let delay = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const next = presentPollDecision({ ok: false, status: 500, failures, errorMessage: "down" });
      expect(next.stop).toBe(false);
      failures = next.failures;
      delay = next.delayMs;
    }
    expect(delay).toBe(PRESENT_POLL_MAX_MS);

    const recovered = presentPollDecision({ ok: true, status: 200, failures });
    expect(recovered.stop).toBe(false);
    expect(recovered.failures).toBe(0);
    expect(recovered.delayMs).toBe(PRESENT_POLL_BASE_MS);
    expect(recovered.message).toBeNull();
  });
});
