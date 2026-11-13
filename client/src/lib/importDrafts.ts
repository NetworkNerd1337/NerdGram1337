import { diagramNameFromImport } from "./organize";

export const MAX_IMPORT_FILE_CHARS = 512 * 1024;
export const MAX_IMPORT_FILES = 25;

export type ImportCollisionChoice = "rename" | "skip" | "replace";

export type ImportDraft = {
  id: string;
  sourceName: string;
  text: string;
  diagramName: string;
  error?: string;
};

export async function draftsFromFiles(files: File[]): Promise<ImportDraft[]> {
  const drafts: ImportDraft[] = [];
  for (const file of files) {
    const id = `${drafts.length}-${file.name}-${file.size}`;
    if (file.size > MAX_IMPORT_FILE_CHARS) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: "",
        error: "This file is larger than 512 KB.",
      });
      continue;
    }
    const text = await file.text();
    const named = diagramNameFromImport(file.name);
    if (!named.name) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: "",
        error: named.error || "That file cannot be imported.",
      });
      continue;
    }
    if (text.length > MAX_IMPORT_FILE_CHARS) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: named.name,
        error: "This file is larger than 512 KB.",
      });
      continue;
    }
    if (text.includes("\0")) {
      drafts.push({
        id,
        sourceName: file.name,
        text: "",
        diagramName: named.name,
        error: "Only text files can be imported.",
      });
      continue;
    }
    drafts.push({
      id,
      sourceName: file.name,
      text,
      diagramName: named.name,
    });
  }
  return drafts;
}
