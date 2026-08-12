import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter } from "./Meter.js";

describe("Meter", () => {
  it("renders a percentage and clamps the fill width", () => {
    render(<Meter pct={150} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders a placeholder when undefined", () => {
    render(<Meter pct={undefined} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("renders the raw value in range", () => {
    render(<Meter pct={42} />);
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
