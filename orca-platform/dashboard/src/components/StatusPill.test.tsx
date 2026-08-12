import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill.js";

describe("StatusPill", () => {
  it("renders the status label and a matching class", () => {
    render(<StatusPill status="online" />);
    const el = screen.getByText("online");
    expect(el.closest(".status-pill")).toHaveClass("status-online");
  });

  it("renders offline status", () => {
    render(<StatusPill status="offline" />);
    expect(screen.getByText("offline").closest(".status-pill")).toHaveClass("status-offline");
  });
});
