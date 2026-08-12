import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

describe("Markdown", () => {
  it("renders bold, italic, and inline code", () => {
    render(<Markdown text="a **bold** word, an *italic* word, and `inline code`." />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("inline code").tagName).toBe("CODE");
  });

  it("renders a fenced code block with a language label", () => {
    render(<Markdown text={"```ts\nconst x = 1;\n```"} />);
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByText("const x = 1;").tagName).toBe("CODE");
  });

  it("renders unordered and ordered lists", () => {
    const { container } = render(<Markdown text={"- one\n- two\n\n1. first\n2. second"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders a link with target=_blank", () => {
    render(<Markdown text="see [the docs](https://example.com/docs) for more" />);
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders headings", () => {
    render(<Markdown text={"## Section title\n\nbody text"} />);
    expect(screen.getByRole("heading", { name: "Section title" })).toBeInTheDocument();
  });

  it("separates paragraphs on blank lines", () => {
    const { container } = render(<Markdown text={"first paragraph\n\nsecond paragraph"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});
