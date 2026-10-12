/**
 * @jest-environment jsdom
 */

import {
  applyColorTheme,
  applyGradientTheme,
  markAppearanceInteraction,
  mergeUnchangedServerAppearance,
  readCachedAppearancePreferences,
  snapshotAppearanceInteractions,
  type AppearancePreferences,
} from "@/lib/appearance-preferences";
import { gradientThemes } from "@/lib/gradient-themes";

const CURRENT: AppearancePreferences = {
  fontFamily: "inter",
  fontSize: "large",
  gradientTheme: "default",
  theme: "dark",
};

describe("appearance preference hydration",() => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
  });

  it("applies explicit themes to the root and clears stale native color schemes",() => {
    document.documentElement.style.colorScheme = "dark";

    applyColorTheme("legacy-light");

    expect(document.documentElement).toHaveAttribute("data-theme","legacy-light");
    expect(document.documentElement.style.colorScheme).toBe("");
    expect(localStorage.getItem("theme")).toBe("legacy-light");
  });

  it("reads the next-themes cache with the other appearance values",() => {
    localStorage.setItem("theme","nord");

    expect(readCachedAppearancePreferences()).toMatchObject({ theme: "nord" });
  });

  it("recognizes the opt-in Legacy Light cache value",() => {
    localStorage.setItem("theme","legacy-light");

    expect(readCachedAppearancePreferences()).toMatchObject({ theme: "legacy-light" });
  });

  it("does not overwrite a field changed after hydration started",() => {
    const snapshot = snapshotAppearanceInteractions();
    markAppearanceInteraction("fontSize");

    expect(mergeUnchangedServerAppearance(
      CURRENT,
      {
        fontFamily: "source-sans",
        fontSize: "small",
        gradientTheme: "ocean",
        theme: "light",
      },
      snapshot,
    )).toEqual({
      fontFamily: "source-sans",
      fontSize: "large",
      gradientTheme: "ocean",
      theme: "light",
    });
  });
});

describe("accent contrast",() => {
  /** WCAG 2.1 relative luminance, from the `H S% L%` the root variables hold. */
  function luminance(components: string): number {
    const [h,s,l] = components.split(" ").map((part) => Number.parseFloat(part));
    const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    const channels = [
      [c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x],
    ][Math.floor((((h % 360) + 360) % 360) / 60)];
    const [r,g,b] = channels
      .map((v) => v + m)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string,b: string): number {
    const [hi,lo] = [luminance(a),luminance(b)].sort((x,y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  // Every accent is a background for button labels, selected text and the
  // glyph in a filled control, so the pair has to clear WCAG 1.4.3's 4.5:1 —
  // which neither a fixed white nor a fixed near-black manages on its own.
  it.each(gradientThemes.map((theme) => theme.id))(
    "keeps text on the %s accent readable",
    (id) => {
      applyGradientTheme(id);
      const root = document.documentElement.style;

      expect(
        contrast(
          root.getPropertyValue("--primary"),
          root.getPropertyValue("--primary-foreground"),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
