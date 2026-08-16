// Wire types for the shared editor document, kept free of any runtime
// dependency so the browser can import them without dragging the Redis
// client along.

export interface EditorDoc {
  code: string;
  language: string;
  version: number;
}

// One contiguous replacement, in UTF-16 offsets — the same units Monaco's
// change events and the browser's string indexing both use.
export interface DocChange {
  offset: number;
  length: number;
  text: string;
}

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export type EditorEvent =
  // The whole document, for a client that has just connected, has fallen
  // behind, or whose document was replaced wholesale (new problem, new
  // language).
  | { type: "doc"; version: number; code: string; language: string }
  // An incremental edit taking the document from version-1 to version.
  | {
      type: "delta";
      version: number;
      from: string;
      origin: string;
      changes: DocChange[];
      // Length of the document after applying `changes`. A receiver whose
      // buffer doesn't match this has drifted and resyncs — cheap insurance
      // against an edit sequence that didn't replay exactly.
      length: number;
      cursor: CursorPosition | null;
    }
  | { type: "cursor"; from: string; origin: string; cursor: CursorPosition | null };
