import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown } from "../src/panel/markdown";

function render(text: string, opts?: Parameters<typeof renderMarkdown>[1]): HTMLElement {
  const host = document.createElement("div");
  host.appendChild(renderMarkdown(text, opts));
  return host;
}

describe("renderMarkdown", () => {
  it("renders bold, italic and inline code as elements", () => {
    const host = render("a **bold** and *em* and `code` end");
    expect(host.querySelector("strong")?.textContent).toBe("bold");
    expect(host.querySelector("em")?.textContent).toBe("em");
    expect(host.querySelector("code")?.textContent).toBe("code");
  });

  it("maps headings to h3..h6 inside chat bubbles", () => {
    const host = render("# one\n#### four");
    expect(host.querySelector("h3")?.textContent).toBe("one");
    expect(host.querySelector("h6")?.textContent).toBe("four");
  });

  it("renders fenced code blocks with the language class", () => {
    const host = render("```python\nprint(1)\n```");
    const code = host.querySelector("pre > code");
    expect(code?.className).toBe("language-python");
    expect(code?.textContent).toBe("print(1)");
  });

  it("keeps unterminated fenced blocks", () => {
    const host = render("```js\nlet x = 1;");
    expect(host.querySelector("pre > code")?.textContent).toBe("let x = 1;");
  });

  it("never treats code fence content as markdown", () => {
    const host = render("```\n**not bold**\n```");
    const pre = host.querySelector("pre");
    expect(pre?.textContent).toBe("**not bold**");
    expect(host.querySelector("strong")).toBeNull();
  });

  it("renders ordered and unordered lists", () => {
    const host = render("- a\n- b\n\n1. x\n2. y");
    expect(host.querySelectorAll("ul > li").length).toBe(2);
    expect(host.querySelectorAll("ol > li").length).toBe(2);
    expect(host.querySelector("ul > li")?.textContent).toBe("a");
  });

  it("renders pipe tables", () => {
    const host = render("| dis | cases |\n|---|---:|\n| North | 120 |\n| South | 90 |");
    const headers = Array.from(host.querySelectorAll("th")).map((th) => th.textContent);
    const cells = Array.from(host.querySelectorAll("td")).map((td) => td.textContent);
    expect(headers).toEqual(["dis", "cases"]);
    expect(cells).toEqual(["North", "120", "South", "90"]);
  });

  it("joins paragraph lines with <br>", () => {
    const host = render("line one\nline two");
    const p = host.querySelector("p");
    expect(p?.querySelectorAll("br").length).toBe(1);
    expect(p?.textContent).toBe("line oneline two");
  });

  it("escapes HTML-looking agent output as plain text", () => {
    const host = render('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelectorAll("script").length).toBe(0);
    expect(host.textContent).toContain("<img src=x");
    expect(host.textContent).toContain("<script>");
  });
});

describe("links", () => {
  it("renders http(s) links with safety attributes", () => {
    const host = render("[DATASUS](https://datasus.saude.gov.br)");
    const a = host.querySelector("a");
    expect(a?.href).toBe("https://datasus.saude.gov.br/");
    expect(a?.target).toBe("_blank");
    expect(a?.rel).toBe("noopener noreferrer");
    expect(a?.textContent).toBe("DATASUS");
  });

  it("renders javascript: links as plain text", () => {
    const host = render("[click](javascript:alert(1))");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("[click](javascript:alert(1))");
  });
});

describe("images", () => {
  it("asks the resolver for markdown images and inserts its element", () => {
    const host = document.createElement("div");
    const resolved = document.createElement("img");
    resolved.src = "blob:mock";
    host.appendChild(
      renderMarkdown("![cases](plots/cases.png)", {
        resolveImage: (url) => {
          expect(url).toBe("plots/cases.png");
          return resolved;
        },
      }),
    );
    expect(host.querySelector("img")).toBe(resolved);
  });

  it("falls back to the alt text when the resolver returns null", () => {
    const host = render("![cases](plots/cases.png)", { resolveImage: () => null });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("cases");
  });

  it("never passes javascript: URLs to the resolver", () => {
    let called = false;
    render("![x](javascript:alert(1))", {
      resolveImage: () => {
        called = true;
        return null;
      },
    });
    expect(called).toBe(false);
  });
});

describe("renderInline", () => {
  it("returns plain text untouched", () => {
    const fragment = renderInline("just words");
    const host = document.createElement("div");
    host.appendChild(fragment);
    expect(host.textContent).toBe("just words");
    expect(host.children.length).toBe(0);
  });
});
