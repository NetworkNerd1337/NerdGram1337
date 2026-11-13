import { LINT_RULES, normalizeLintRules, type LintRuleId } from "../../../server/src/diagramLint.ts";

export { LINT_RULES, type LintRuleId };

const STORAGE_KEY = "nerdgram.lintRules";

export const LINT_RULES_EVENT = "nerdgram-lint-rules";

export function readLintRules(): Record<LintRuleId, boolean> {
  try {
    if (typeof localStorage === "undefined") return normalizeLintRules(undefined);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeLintRules(undefined);
    return normalizeLintRules(JSON.parse(raw) as unknown);
  } catch {
    return normalizeLintRules(undefined);
  }
}

export function writeLintRule(id: LintRuleId, enabled: boolean): Record<LintRuleId, boolean> {
  const next = { ...readLintRules(), [id]: enabled };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(LINT_RULES_EVENT));
  return next;
}
