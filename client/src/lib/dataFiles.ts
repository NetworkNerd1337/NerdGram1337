export type DataFileMove = { from: string; to: string };

export type DataPrompt = {
  title: string;
  intro: string;
  primaryLabel: string;
  secondaryLabel: string;
};

/** Names the files that moved with a diagram, for the status line. */
export function dataMoveSentence(files: readonly DataFileMove[]): string {
  if (files.length === 0) return "";
  const names = files.map((file) => file.to.split("/").pop() || file.to);
  return files.length === 1 ? `Moved ${names[0]} with it.` : `Moved ${names.join(", ")} with it.`;
}

export function duplicateDataPrompt(): DataPrompt {
  return {
    title: "Copy the data file?",
    intro:
      "This diagram was generated from a data file that sits next to it. Copying gives the duplicate its own file and points that copy at it. Sharing leaves both diagrams on the original file, so a later refresh writes that same data.",
    primaryLabel: "Copy the data file",
    secondaryLabel: "Share the original",
  };
}

export function deleteDataPrompt(): DataPrompt {
  return {
    title: "Trash the data file too?",
    intro:
      "A data file sits next to this diagram. Trashing it moves the file into the trash with the diagram, and restore brings it back. Keeping it leaves the file in the workspace.",
    primaryLabel: "Trash the data file",
    secondaryLabel: "Keep the data file",
  };
}

export function duplicateStatus(path: string, files: readonly DataFileMove[], shared: boolean): string {
  if (shared) return `Duplicated as ${path}. It shares the original data file.`;
  if (files.length === 0) return `Duplicated as ${path}.`;
  const names = files.map((file) => file.to.split("/").pop() || file.to).join(", ");
  return `Duplicated as ${path}. Copied ${names}.`;
}
