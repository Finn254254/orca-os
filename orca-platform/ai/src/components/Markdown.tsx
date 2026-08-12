import { Fragment, type ReactNode } from "react";

// Minimal, dependency-free markdown renderer. Builds React elements
// directly (never dangerouslySetInnerHTML), so there's no HTML-injection
// surface — safe by construction rather than by sanitizing. Supports the
// subset an AI chat reply actually uses: headings, bold/italic, inline
// code, fenced code blocks, links, and un/ordered lists.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    if (match[1] !== undefined) {
      nodes.push(
        <code className="inline-code" key={`${keyPrefix}-c${i++}`}>
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{match[3]}</em>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push(
        <a href={match[5]} target="_blank" rel="noopener noreferrer" key={`${keyPrefix}-a${i++}`}>
          {match[4]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

interface ListBlock {
  type: "ul" | "ol";
  items: string[];
}

function flushList(list: ListBlock | undefined, key: string, out: ReactNode[]): void {
  if (!list || list.items.length === 0) return;
  const Tag = list.type;
  out.push(
    <Tag key={key}>
      {list.items.map((item, idx) => (
        <li key={idx}>{renderInline(item, `${key}-${idx}`)}</li>
      ))}
    </Tag>,
  );
}

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: ListBlock | undefined;
  let blockKey = 0;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const content = paragraph.join(" ");
    out.push(<p key={`p${blockKey++}`}>{renderInline(content, `p${blockKey}`)}</p>);
    paragraph = [];
  }

  function flushCurrentList() {
    flushList(list, `l${blockKey++}`, out);
    list = undefined;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      flushCurrentList();
      const lang = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(
        <pre className="code-block" key={`code${blockKey++}`}>
          {lang && <div className="code-lang">{lang}</div>}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushCurrentList();
      const level = heading[1].length;
      const HeadingTag = `h${Math.min(level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      out.push(<HeadingTag key={`h${blockKey++}`}>{renderInline(heading[2], `h${blockKey}`)}</HeadingTag>);
      i++;
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      const item = (unordered ?? ordered)![1];
      if (!list || list.type !== type) {
        flushCurrentList();
        list = { type, items: [] };
      }
      list.items.push(item);
      i++;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushCurrentList();
      i++;
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  flushCurrentList();

  return <>{out}</>;
}
