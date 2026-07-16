// The currently-mounted rich-text editor, published so the transfer layer can
// read what's on screen (flushing the active tab's content before a send).
// There is only ever one editor mounted (the active tab), so a module
// singleton is enough — no store/subscription needed.
import type { Editor } from "@tiptap/react";

let current: Editor | null = null;

export function setActiveEditor(editor: Editor | null): void {
  current = editor;
}

export function getActiveEditor(): Editor | null {
  return current;
}
