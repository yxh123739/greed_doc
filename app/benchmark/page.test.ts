import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BenchmarkPage from "./page";

vi.mock("@/components/navbar", () => ({
  Navbar: () => React.createElement("div", { "data-testid": "navbar" }),
}));

const savedForm = {
  address: "10 Main St",
  city: "Austin",
  stateProvince: "TX",
  country: "United States",
  zipCode: "78701",
  ratingSystem: "LEED BD+C: New Construction",
  ltc1PreviouslyDeveloped: "yes",
  ltc2Selection: "opt1-p1",
  parkingSpaces: "20",
  programType: "commercial",
  ltc5Opt1X: true,
  ltc5Opt1Y: false,
  ltc5Opt2Z: false,
};

describe("BenchmarkPage summary layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "leed_v5_benchmark_project_location",
      JSON.stringify(savedForm)
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            walkScore: 79,
            transitScore: 50,
            bikeScore: 55,
            canonicalUrl: "https://example.com/walkscore",
            title: "Example Walk Score",
            queriedAddress: "10 Main St, Austin, TX 78701",
          }),
      })
    );
  });

  it("renders the summary as headed credit sections with a download CTA section", async () => {
    render(React.createElement(BenchmarkPage));

    await waitFor(() => {
      expect(
        screen.getByRole("tab", {
          name: "LEED v5 Location & Transportation Summary",
        })
      ).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Start Benchmark" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "LTc1 Sensitive Land Protection",
        })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", {
        name: "LTc2 Equitable Development",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "LTc3 Compact and Connected Development",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "LTc4 Transportation Demand Management",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "LTc5 Electric Vehicles",
      })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Your project qualifies for at least 6 L&T points.",
        })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", {
        name: "Grab Your LEED Docs Now!",
      })
    ).toBeInTheDocument();
  });
});
