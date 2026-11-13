import {
  actionForClickTarget as classifyClick,
  clickTargetFromNode,
  type ClickableNode,
  type ClickAction,
} from "../../../server/src/diagramLinks.ts";

export type { ClickAction };

/**
 * What a click on a rendered node should do.
 * `knownPaths` null means the workspace list is not loaded yet, so a path
 * that stays inside the workspace is opened and a missing file is reported
 * by the load, not by a blank page.
 */
export function actionForClickTarget(
  target: string,
  sourcePath: string,
  knownPaths: readonly string[] | null,
): ClickAction {
  return classifyClick(target, sourcePath, knownPaths);
}

function toNode(element: Element, depth = 0): ClickableNode {
  return {
    id: element.getAttribute("id") ?? "",
    dataId: element.getAttribute("data-id"),
    href: element.getAttribute("href") || element.getAttribute("xlink:href"),
    tag: element.tagName.toLowerCase(),
    parent: element.parentElement && depth < 24 ? toNode(element.parentElement, depth + 1) : null,
  };
}

/** Click URL for the SVG element under the pointer, using the diagram source as the authority. */
export function clickTargetOnElement(source: string, target: EventTarget | null): string | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  return clickTargetFromNode(source, toNode(target));
}

/** Open an external http(s) link in a new tab without giving it this window. */
export function openExternalLink(url: string): void {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}
