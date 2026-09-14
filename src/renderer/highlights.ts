export interface TextRun { text: string; highlighted: boolean }

// Only balanced, non-nested brackets are markup. Unfinished input stays visible.
export function highlightedRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /\[([^\[\]]+)\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index), highlighted: false });
    runs.push({ text: match[1]!, highlighted: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), highlighted: false });
  return runs;
}

export function plainText(text: string): string {
  return highlightedRuns(text).map((run) => run.text).join("");
}

// Redistribute brackets across words/lines so multi-word and multiline spans survive animation splitting.
export function splitHighlightedText(text: string, separator: RegExp): string[] {
  const marked = highlightedRuns(text).map((run) => run.highlighted
    ? run.text.split(separator).map((part) => part && `[${part}]`).join("\u0000")
    : run.text.replace(separator, "\u0000")).join("");
  return marked.split("\u0000");
}

export function migrateKeyword(values: Record<string, string | number | boolean>): void {
  if (typeof values.title === "string" && typeof values.keyword === "string" && values.keyword && !values.title.includes("[")) {
    const keyword = values.keyword.toLocaleLowerCase();
    values.title = values.title.split(/(\s+)/).map((word) => {
      const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      return clean.toLocaleLowerCase() === keyword ? word.replace(clean, `[${clean}]`) : word;
    }).join("");
  }
  delete values.keyword;
}
