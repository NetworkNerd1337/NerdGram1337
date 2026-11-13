import { useState } from "react";
import { LINT_RULES, readLintRules, writeLintRule, type LintRuleId } from "../lib/lintSettings";

export function LintSettings() {
  const [rules, setRules] = useState(readLintRules);

  const toggle = (id: LintRuleId, enabled: boolean) => {
    setRules(writeLintRule(id, enabled));
  };

  return (
    <section className="sync-card" id="diagram-checks">
      <h2>Diagram checks</h2>
      <p>
        Warnings show in the editor gutter and the problems list. They do not block the preview or
        autosave. A diagram Mermaid cannot parse is always marked. These switches are saved in this
        browser.
      </p>
      {LINT_RULES.map((rule) => (
        <label key={rule.id} className="sync-check">
          <input
            type="checkbox"
            checked={rules[rule.id]}
            onChange={(event) => toggle(rule.id, event.target.checked)}
          />
          <span>
            <strong>{rule.label}.</strong> {rule.description}
          </span>
        </label>
      ))}
    </section>
  );
}
