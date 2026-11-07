import type { ReactNode } from "react";

/** Small safe Markdown subset for assistant text. It never parses HTML or uses dangerouslySetInnerHTML. */
export default function ChatMarkdown({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/).filter(Boolean);
  return <div className="space-y-2 break-words text-sm leading-relaxed">
    {blocks.map((block, index) => {
      const lines = block.split("\n");
      const code = block.match(/^```(?:[a-z0-9_-]+)?\n([\s\S]*?)\n```$/i);
      if (code) return <pre key={index} className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{code[1]}</code></pre>;
      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const Heading = heading[1].length === 1 ? "h3" : "h4";
        return <Heading key={index} className="font-semibold">{inline(heading[2])}</Heading>;
      }
      if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
        return <ul key={index} className="list-disc space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>)}</ul>;
      }
      if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
        return <ol key={index} className="list-decimal space-y-1 pl-5">{lines.map((line, lineIndex) => <li key={lineIndex}>{inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
      }
      if (lines.every((line) => /^\s*>\s?/.test(line))) {
        return <blockquote key={index} className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{lines.map((line) => line.replace(/^\s*>\s?/, "")).join(" ")}</blockquote>;
      }
      return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 && <br />}{inline(line)}</span>)}</p>;
    })}
  </div>;
}

function inline(text: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  const parts = text.split(pattern).filter((part) => part !== "");
  return parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{link[1]}</a> : <span key={index}>{link[1]}</span>;
    }
    if (/^https?:\/\//.test(part)) {
      const href = safeHref(part);
      return href ? <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{part}</a> : <span key={index}>{part}</span>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-muted px-1 py-0.5 text-xs">{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}
