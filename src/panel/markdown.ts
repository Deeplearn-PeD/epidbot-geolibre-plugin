/** Markdown-to-DOM converter (safe subset) for the chat panel.
 *
 * TS counterpart of the QGIS plugin's core/markdown_lite.py: headings, bold/
 * italic, inline code, fenced code blocks, lists, links, images, pipe tables
 * and paragraphs. Instead of emitting HTML strings, this builds DOM nodes and
 * fills text through createTextNode, so agent output can never inject markup.
 */

const FENCED_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ULIST = /^\s*[-*+]\s+(.*)$/;
const OLIST = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;

/** Inline tokens: code, bold, italic, images, links (order matters — the
 * image alternative must win over the link syntax). Links already require
 * http(s) in the pattern, so javascript: URLs can never become anchors. */
const INLINE =
  /(`([^`\n]+)`)|(\*\*([^*\n]+?)\*\*)|(\*([^*\n]+?)\*)|(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;

export interface MarkdownOptions {
  /** Called for ![alt](url) images. Returns the element to insert (or null
   * to skip). The panel uses it to load plot images with authentication. */
  resolveImage?: (url: string, alt: string) => HTMLElement | null;
}

/** Render inline markdown into a fragment; plain text stays plain text. */
export function renderInline(text: string, opts: MarkdownOptions = {}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match; match = INLINE.exec(text)) {
    if (match.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }
    if (match[2] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[2];
      fragment.appendChild(code);
    } else if (match[4] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[4];
      fragment.appendChild(strong);
    } else if (match[6] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[6];
      fragment.appendChild(em);
    } else if (match[9] !== undefined) {
      const url = match[9];
      const alt = match[8] ?? "";
      const allowed = /^(https?:\/\/|\/|plots\/)/i.test(url);
      const element = allowed ? (opts.resolveImage?.(url, alt) ?? null) : null;
      fragment.appendChild(element ?? document.createTextNode(alt || url));
    } else if (match[11] !== undefined && match[12] !== undefined) {
      const anchor = document.createElement("a");
      anchor.href = match[12];
      anchor.textContent = match[11];
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      fragment.appendChild(anchor);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  return fragment;
}

function tableCells(inner: string): string[] {
  return inner.split("|").map((cell) => cell.trim());
}

interface BlockBuilder {
  fragment: DocumentFragment;
  appendCode(lang: string, code: string): void;
  appendFromLines(lines: string[]): void;
}

function createBlockBuilder(opts: MarkdownOptions): BlockBuilder {
  const fragment = document.createDocumentFragment();

  const appendCode = (lang: string, code: string) => {
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    if (lang) codeEl.className = `language-${lang}`;
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    fragment.appendChild(pre);
  };

  const appendFromLines = (sourceLines: string[]) => {
    const paragraph: string[] = [];
    let list: "ul" | "ol" | null = null;

    const closeParagraph = () => {
      if (paragraph.length === 0) return;
      const p = document.createElement("p");
      paragraph.forEach((line, index) => {
        if (index > 0) p.appendChild(document.createElement("br"));
        p.appendChild(renderInline(line, opts));
      });
      fragment.appendChild(p);
      paragraph.length = 0;
    };
    const closeList = () => {
      list = null;
    };

    const appendListItem = (wanted: "ul" | "ol", item: string) => {
      closeParagraph();
      if (list !== wanted) {
        closeList();
        list = wanted;
        fragment.appendChild(document.createElement(wanted));
      }
      const parent = fragment.lastChild as HTMLElement;
      const li = document.createElement("li");
      li.appendChild(renderInline(item, opts));
      parent.appendChild(li);
    };

    const appendTable = (header: string[], rows: string[][]) => {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cell of header) {
        const th = document.createElement("th");
        th.appendChild(renderInline(cell, opts));
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      if (rows.length > 0) {
        const tbody = document.createElement("tbody");
        for (const row of rows) {
          const tr = document.createElement("tr");
          for (const cell of row) {
            const td = document.createElement("td");
            td.appendChild(renderInline(cell, opts));
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
      }
      fragment.appendChild(table);
    };

    let i = 0;
    while (i < sourceLines.length) {
      const line = sourceLines[i];
      if (!line.trim()) {
        closeParagraph();
        closeList();
        i += 1;
        continue;
      }
      // Pipe table: header row, separator row, then body rows.
      const header = TABLE_ROW.exec(line);
      if (header && i + 1 < sourceLines.length && TABLE_SEP.test(sourceLines[i + 1])) {
        closeParagraph();
        closeList();
        const rows: string[][] = [];
        let j = i + 2;
        while (j < sourceLines.length && TABLE_ROW.test(sourceLines[j])) {
          rows.push(tableCells(TABLE_ROW.exec(sourceLines[j])![1]));
          j += 1;
        }
        appendTable(tableCells(header[1]), rows);
        i = j;
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        closeParagraph();
        closeList();
        const level = Math.min(heading[1].length + 2, 6) as 3 | 4 | 5 | 6;
        const h = document.createElement(`h${level}`);
        h.appendChild(renderInline(heading[2], opts));
        fragment.appendChild(h);
        i += 1;
        continue;
      }
      const ul = ULIST.exec(line);
      const ol = ul ? null : OLIST.exec(line);
      if (ul || ol) {
        appendListItem(ul ? "ul" : "ol", (ul ?? ol)![1]);
        i += 1;
        continue;
      }
      paragraph.push(line);
      i += 1;
    }
    closeParagraph();
    closeList();
  };

  return { fragment, appendCode, appendFromLines };
}

/** Convert markdown text into a document fragment of block elements.
 * Fenced code blocks (```lang … ```) become <pre><code>; their content is
 * never touched by inline processing. */
export function renderMarkdown(text: string, opts: MarkdownOptions = {}): DocumentFragment {
  const builder = createBlockBuilder(opts);
  if (!text) return builder.fragment;

  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let plain: string[] = [];
  let i = 0;

  const flushPlain = () => {
    if (plain.length > 0) {
      builder.appendFromLines(plain);
      plain = [];
    }
  };

  while (i < lines.length) {
    const open = FENCED_OPEN.exec(lines[i]);
    if (open) {
      flushPlain();
      const lang = open[1] ?? "";
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip the closing fence (or run past EOF)
      builder.appendCode(lang, code.join("\n"));
      continue;
    }
    plain.push(lines[i]);
    i += 1;
  }
  flushPlain();
  return builder.fragment;
}
