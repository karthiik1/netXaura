// The editor: a rich-text surface (TipTap) with a formatting toolbar — font
// family & size, bold/italic/underline/strike, and text alignment. Every tab
// uses it. Content is stored as TipTap JSON (§3); autosave is debounced
// last-write-wins (§9), and the current selection is mirrored into the store so
// "Send selection" works from anywhere in the document (§0).
import { FontFamily } from "@tiptap/extension-font-family";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useEffect } from "react";

import { api } from "../../services/api";
import { setActiveEditor } from "../../lib/activeEditor";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Tab } from "../../types/api";
import { FontSize } from "./FontSize";

const FONTS = [
  { label: "Default", value: "" },
  { label: "Sans", value: "Inter, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'JetBrains Mono', ui-monospace, monospace" },
  { label: "Display", value: "'Space Grotesk', system-ui, sans-serif" },
];

const SIZES = ["", "14px", "16px", "18px", "24px", "32px"];

export function RichEditor({ tab }: { tab: Tab }) {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: safeParse(tab.content),
    editorProps: {
      attributes: { class: "tiptap max-w-none focus:outline-none min-h-[70vh]" },
    },
    onUpdate: ({ editor }) => {
      clearTimeout(saveTimer);
      const json = JSON.stringify(editor.getJSON());
      saveTimer = setTimeout(() => {
        api.updateTab(tab.id, { content: json }).catch(() => {});
      }, 800);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      const text = from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
      useWorkspaceStore.getState().setSelectionText(text);
    },
  });

  useEffect(() => {
    function onInsert(e: Event) {
      const text = (e as CustomEvent<{ text: string }>).detail.text;
      editor?.chain().focus().insertContent(text).run();
    }
    window.addEventListener("netxaura:insert", onInsert);
    return () => window.removeEventListener("netxaura:insert", onInsert);
  }, [editor]);

  // Publish this editor so the gesture layer can drive selection by air cursor
  // (op 4). Only the active tab's editor is mounted, so this is always "the"
  // editor the cursor is over.
  useEffect(() => {
    setActiveEditor(editor ?? null);
    return () => setActiveEditor(null);
  }, [editor]);

  return (
    <div className="flex h-full flex-col">
      {editor && <Toolbar editor={editor} />}
      <div className="editor-lines min-h-0 flex-1 overflow-auto">
        <div className="py-6 pl-16 pr-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const currentFont =
    (editor.getAttributes("textStyle").fontFamily as string) || "";
  const currentSize =
    (editor.getAttributes("textStyle").fontSize as string) || "";

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface/80 px-3 py-2 backdrop-blur-md">
      {/* Font family + size */}
      <select
        aria-label="Font"
        value={currentFont}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        className="rounded-md border border-line bg-panel/60 px-2 py-1 text-xs text-ink50 hover:border-aura/40"
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>
      <select
        aria-label="Font size"
        value={currentSize}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setMark("textStyle", { fontSize: v }).run();
          else editor.chain().focus().setMark("textStyle", { fontSize: null }).run();
        }}
        className="rounded-md border border-line bg-panel/60 px-2 py-1 text-xs text-ink50 hover:border-aura/40"
      >
        {SIZES.map((s) => (
          <option key={s || "auto"} value={s}>{s || "Size"}</option>
        ))}
      </select>

      <Divider />

      <Group>
        <TBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label="Bold" k="⌘B"><Bold className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label="Italic" k="⌘I"><Italic className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} label="Underline" k="⌘U"><UnderlineIcon className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} label="Strikethrough"><Strikethrough className="h-4 w-4" /></TBtn>
      </Group>

      <Divider />

      <Group>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} label="Align left"><AlignLeft className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} label="Align center"><AlignCenter className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} label="Align right"><AlignRight className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign("justify").run()} active={editor.isActive({ textAlign: "justify" })} label="Justify"><AlignJustify className="h-4 w-4" /></TBtn>
      </Group>

      <Divider />

      <Group>
        <TBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} label="Heading 1"><Heading1 className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} label="Heading 2"><Heading2 className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} label="Heading 3"><Heading3 className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label="Bullet list"><List className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} label="Numbered list"><ListOrdered className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label="Quote"><Quote className="h-4 w-4" /></TBtn>
      </Group>

      <Divider />

      <Group>
        <TBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} label="Inline code" k="⌘E"><Code className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} label="Code block"><SquareCode className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} label="Horizontal rule"><Minus className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} label="Clear formatting"><RemoveFormatting className="h-4 w-4" /></TBtn>
      </Group>

      <div className="ml-auto flex items-center gap-1">
        <TBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} label="Undo" k="⌘Z"><Undo2 className="h-4 w-4" /></TBtn>
        <TBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} label="Redo" k="⌘⇧Z"><Redo2 className="h-4 w-4" /></TBtn>
      </div>
    </div>
  );
}

function TBtn({
  onClick, active, disabled, label, k, children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  k?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={k ? `${label} · ${k}` : label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors disabled:opacity-30 ${
        active
          ? "bg-aura/20 text-aura shadow-[inset_0_0_0_1px_rgb(var(--aura)/0.4)]"
          : "text-muted hover:bg-panel/70 hover:text-ink50"
      }`}
    >
      {children}
    </button>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}

function safeParse(raw: string): object | string {
  try {
    return raw ? JSON.parse(raw) : "";
  } catch {
    return raw;
  }
}
