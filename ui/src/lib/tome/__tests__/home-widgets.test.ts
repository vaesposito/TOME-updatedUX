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
    // Their order is the shipped one with a card dragged to the front, read
    // off the registry rather than written out: an arrangement that names
    // every card by hand stops being a test about order the moment a release
    // adds one, and starts being a test about which cards exist.
    const chosen = ["team", ...DEFAULTS.filter((id) => id !== "team")];
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

  it("puts a card with nothing shipped ahead of it at the front, not the back", () => {
    // The leading card, whichever it is, read off the registry: naming it
    // would make this a test about which card leads rather than about where
    // an unplaced one lands, and the two change for different reasons.
    const [first] = DEFAULTS;
    const arranged = DEFAULTS.filter((id) => id !== first);
    expect(visibleWidgets(layout(arranged))[0]).toBe(first);
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
  it("leads with what the space is, which every other card assumes", () => {
    // A reader who has not been told what this space is cannot read a word
    // of what follows, so the description goes before the activity, the
    // roster and the rest.
    expect(TOME_HOME_WIDGETS[0].id).toBe("about");
  });

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

  it("gives a BHAG nothing about what is above it, there being nothing", () => {
    expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "bhag")).not.toContain(
      "partof",
    );
    for (const kind of ["project", "area"] as const) {
      expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, kind)).toContain(
        "partof",
      );
    }
  });

  it("applies every card but the hierarchy ones to every kind", () => {
    // The two that depend on where a space sits in the tree are the only
    // cards a kind of space can be without. Anything else absent somewhere is
    // a card that forgot to say so.
    expect(
      TOME_HOME_WIDGETS.filter((widget) => widget.kinds).map(
        (widget) => widget.id,
      ),
    ).toEqual(["children", "partof"]);
    for (const widget of TOME_HOME_WIDGETS) {
      if (widget.kinds) continue;
      expect(widgetAppliesTo(widget.id, "project")).toBe(true);
      expect(widgetAppliesTo(widget.id, "bhag")).toBe(true);
    }
  });
});

describe("the workspace scope", () => {
  it("shows the cards made of rows, and the two that roll up", () => {
    // What is waiting, what named the reader, what happened, and where —
    // plus what the work reads from and who answers for it, both of which are
    // roll-ups of the spaces below wherever they are read. The rest need one
    // wiki to be about.
    expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "workspace")).toEqual([
      "attention",
      "tagged",
      "updates",
      "children",
      "team",
      "sources",
    ]);
  });

  it("keeps what is above out of it, there being nothing above every space", () => {
    expect(visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "workspace")).not.toContain(
      "partof",
    );
  });

  it("requires a card to say so rather than inheriting it", () => {
    // A card with no `kinds` applies to every entity, which must not quietly
    // mean it applies with no entity at all: a question put to this space's
    // agent has no answer when the space is all of them.
    for (const widget of TOME_HOME_WIDGETS) {
      expect(widgetAppliesTo(widget.id, "workspace")).toBe(
        Boolean(widget.workspace),
      );
    }
    expect(widgetAppliesTo("ask", "workspace")).toBe(false);
    expect(widgetAppliesTo("ask", "project")).toBe(true);
  });

  it("keeps one arrangement across both altitudes", () => {
    // The cards mean the same thing from either, so hiding one in a project
    // and finding it on the hub would make the eye a per-page setting.
    const layout = withHidden(DEFAULT_TOME_HOME_LAYOUT, "tagged");
    expect(visibleWidgets(layout, "workspace")).not.toContain("tagged");
    expect(visibleWidgets(layout, "project")).not.toContain("tagged");
  });

  it("drops the cards that do not apply without forgetting them", () => {
    const moved = withOrder(DEFAULT_TOME_HOME_LAYOUT, [
      "updates",
      ...visibleWidgets(DEFAULT_TOME_HOME_LAYOUT, "workspace").filter(
        (id) => id !== "updates",
      ),
    ]);
    expect(visibleWidgets(moved, "workspace")[0]).toBe("updates");
    // The project's home still has every one of its own.
    expect(visibleWidgets(moved, "project")).toContain("ask");
    expect(visibleWidgets(moved, "project")).toContain("team");
  });
});
