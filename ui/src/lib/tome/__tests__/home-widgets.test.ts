import {
  DEFAULT_TOME_HOME_LAYOUT,
  TOME_HOME_WIDGETS,
  isCustomized,
  parseLayout,
  visibleWidgets,
  widgetAppliesTo,
  widgetLabel,
  widgetWidthClass,
  withHidden,
  withOrder,
  withShown,
  type TomeHomeLayout,
  type TomeHomeWidgetId,
} from "../home-widgets";

const DEFAULTS = TOME_HOME_WIDGETS.map((widget) => widget.id);

const layout = (
  order: TomeHomeWidgetId[] = [],
  hidden: TomeHomeWidgetId[] = [],
): TomeHomeLayout => ({ order, hidden });

describe("visibleWidgets", () => {
  it("ships every card, in the order the page was designed in", () => {
    expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT)).toEqual(DEFAULTS);
  });

  it("keeps the order a reader chose", () => {
    const chosen: TomeHomeWidgetId[] = [
      "team",
      "ask",
      "attention",
      "tagged",
      "updates",
      "children",
      "glance",
      "milestones",
      "sources",
      "kpis",
    ];
    expect(visibleWidgets(layout(chosen))).toEqual(chosen);
  });

  it("leaves out what was put away", () => {
    expect(visibleWidgets(layout([], ["team", "kpis"]))).not.toContain("team");
    expect(visibleWidgets(layout([], ["team", "kpis"]))).not.toContain("kpis");
  });

  it("drops an id that no longer names a card", () => {
    const stored = { order: ["ask", "retired-card", "team"], hidden: [] };
    expect(visibleWidgets(parseLayout(stored))).toContain("ask");
    expect(visibleWidgets(parseLayout(stored))).not.toContain("retired-card");
  });

  it("gives a card nobody has arranged its place beside its neighbour", () => {
    // A reader who arranged the page before "milestones" existed: it is in
    // neither list, so it is new rather than unwanted, and belongs after the
    // card it ships behind.
    const arranged = DEFAULTS.filter((id) => id !== "milestones");
    const shown = visibleWidgets(layout(arranged));
    expect(shown).toHaveLength(DEFAULTS.length);
    expect(shown[shown.indexOf("milestones") - 1]).toBe("glance");
  });

  it("puts a new first card first rather than last", () => {
    const arranged = DEFAULTS.filter((id) => id !== "ask");
    expect(visibleWidgets(layout(arranged))[0]).toBe("ask");
  });

  it("ignores a card listed twice", () => {
    const shown = visibleWidgets(layout(["team", "team", "ask"]));
    expect(shown.filter((id) => id === "team")).toHaveLength(1);
  });
});

describe("withHidden and withShown", () => {
  it("brings a card back where it was, not where it shipped", () => {
    const moved = withOrder(DEFAULT_TOME_HOME_LAYOUT, [
      "team",
      ...DEFAULTS.filter((id) => id !== "team"),
    ]);
    const away = withHidden(moved, "team");
    expect(visibleWidgets(away)).not.toContain("team");
    expect(visibleWidgets(withShown(away, "team"))[0]).toBe("team");
  });

  it("keeps a hidden card's place through a reorder of the rest", () => {
    const away = withHidden(DEFAULT_TOME_HOME_LAYOUT, "tagged");
    const shown = visibleWidgets(away);
    // Drag the last card to the front, with "tagged" still put away.
    const dragged = [shown[shown.length - 1], ...shown.slice(0, -1)];
    const after = withShown(withOrder(away, dragged), "tagged");
    expect(visibleWidgets(after)[0]).toBe("kpis");
    expect(visibleWidgets(after)).toContain("tagged");
    // Still behind the card it was behind, rather than back at the front.
    const order = visibleWidgets(after);
    expect(order[order.indexOf("tagged") - 1]).toBe("attention");
  });

  it("hiding twice is hiding once", () => {
    const away = withHidden(DEFAULT_TOME_HOME_LAYOUT, "kpis");
    expect(withHidden(away, "kpis").hidden).toEqual(["kpis"]);
  });

  it("can put every card away", () => {
    const empty = DEFAULTS.reduce(
      (current, id) => withHidden(current, id),
      DEFAULT_TOME_HOME_LAYOUT as TomeHomeLayout,
    );
    expect(visibleWidgets(empty)).toEqual([]);
  });
});

describe("withOrder", () => {
  it("records what the reader dragged", () => {
    const dragged: TomeHomeWidgetId[] = ["glance", "ask"];
    expect(withOrder(DEFAULT_TOME_HOME_LAYOUT, dragged).order.slice(0, 2)).toEqual(
      dragged,
    );
  });
});

describe("isCustomized", () => {
  it("is false for the page as it ships", () => {
    expect(isCustomized(DEFAULT_TOME_HOME_LAYOUT)).toBe(false);
    expect(isCustomized(layout(DEFAULTS))).toBe(false);
  });

  it("is true once something is moved or put away", () => {
    expect(isCustomized(withHidden(DEFAULT_TOME_HOME_LAYOUT, "kpis"))).toBe(true);
    expect(
      isCustomized(layout(["team", ...DEFAULTS.filter((id) => id !== "team")])),
    ).toBe(true);
  });
});

describe("parseLayout", () => {
  it("reads nothing out of nothing", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_TOME_HOME_LAYOUT);
    expect(parseLayout("team")).toEqual(DEFAULT_TOME_HOME_LAYOUT);
    expect(parseLayout({ order: "team" })).toEqual(DEFAULT_TOME_HOME_LAYOUT);
  });

  it("keeps only what names a card", () => {
    expect(parseLayout({ order: ["team", 7, "nope"], hidden: ["kpis"] })).toEqual({
      order: ["team"],
      hidden: ["kpis"],
    });
  });
});

describe("the registry", () => {
  it("names every card for the controls that move it", () => {
    for (const widget of TOME_HOME_WIDGETS) {
      expect(widgetLabel(widget.id)).toBe(widget.label);
      expect(widget.label).not.toHaveLength(0);
    }
  });

  it("gives a card the same share of the page wherever it sits", () => {
    expect(widgetWidthClass(3)).toBe("lg:col-span-3");
    expect(widgetWidthClass(2)).toBe("lg:col-span-2");
    expect(widgetWidthClass(1)).toBe("");
  });

  it("fills whole rows of three, for every kind of space", () => {
    for (const kind of ["project", "bhag", "area"] as const) {
      const total = TOME_HOME_WIDGETS.filter((w) =>
        widgetAppliesTo(w.id, kind),
      ).reduce((sum, w) => sum + w.width, 0);
      expect(total % 3).toBe(0);
    }
  });
});

describe("kinds", () => {
  it("offers a project nothing about what is below it", () => {
    expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "project")).not.toContain(
      "children",
    );
    expect(widgetAppliesTo("children", "project")).toBe(false);
  });

  it("lists what is below a BHAG and an Area", () => {
    for (const kind of ["bhag", "area"] as const) {
      expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, kind)).toContain(
        "children",
      );
      expect(widgetAppliesTo("children", kind)).toBe(true);
    }
  });

  it("puts it where it was designed to go, closing the recent band", () => {
    const shown = visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "bhag");
    expect(shown[shown.indexOf("children") - 1]).toBe("updates");
  });

  it("keeps a place made on a BHAG through a move made on a project", () => {
    // Placed first while reading a BHAG, where the card is on show.
    const placed = withOrder(DEFAULT_TOME_HOME_LAYOUT, [
      "children",
      ...visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "bhag").filter(
        (id) => id !== "children",
      ),
    ]);
    expect(visibleWidgets(placed, "bhag")[0]).toBe("children");

    // Then something moved on a project's home, where it is not on show and
    // so is not in the dragged list. Its place has to survive that.
    const later = withOrder(placed, [
      "team",
      ...visibleWidgets(placed, "project").filter((id) => id !== "team"),
    ]);
    expect(visibleWidgets(later, "project")).not.toContain("children");
    expect(visibleWidgets(later, "bhag")).toContain("children");
    expect(visibleWidgets(later, "bhag").indexOf("children")).toBeLessThan(
      visibleWidgets(later, "bhag").indexOf("ask"),
    );
  });

  it("applies every other card to every kind", () => {
    for (const widget of TOME_HOME_WIDGETS) {
      if (widget.id === "children") continue;
      expect(widgetAppliesTo(widget.id, "project")).toBe(true);
      expect(widgetAppliesTo(widget.id, "bhag")).toBe(true);
    }
  });
});
