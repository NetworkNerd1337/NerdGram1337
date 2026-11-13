/**
 * A reload after an update has to warn before it interrupts a presentation
 * or throws away unsaved editor text.
 */
export function reloadWarning(flags: { presenting: boolean; unsaved: boolean }): string | null {
  const parts: string[] = [];
  if (flags.presenting) {
    parts.push("A presentation is open. Reloading will close it.");
  }
  if (flags.unsaved) {
    parts.push("This diagram has unsaved edits. Reloading can discard them.");
  }
  if (parts.length === 0) return null;
  return `${parts.join(" ")} Reload now?`;
}

export function requestUpdateReload(): void {
  const message = reloadWarning({
    presenting: document.body.dataset.presenting === "true",
    unsaved: document.body.dataset.unsaved === "true",
  });
  if (message && !window.confirm(message)) return;
  window.location.reload();
}
