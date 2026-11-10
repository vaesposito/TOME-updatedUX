import {
  inFlightLabel,
  ingestEndpoint,
  isRunInFlight,
} from "@/lib/tome/ingest-run";
import { isSynthesizedType } from "@/types/projects";

describe("ingestEndpoint", () => {
  it("synthesizes the spaces that roll up and reads the ones with sources", () => {
    // Taken from the space's own type rather than restated, so the header and
    // the ingest panel cannot come to disagree about which verb applies.
    expect(ingestEndpoint(isSynthesizedType("bhag"))).toBe("synthesize");
    expect(ingestEndpoint(isSynthesizedType("area"))).toBe("synthesize");
    expect(ingestEndpoint(isSynthesizedType("project"))).toBe("reingest");
    expect(ingestEndpoint(isSynthesizedType("subject"))).toBe("reingest");
  });
});

describe("isRunInFlight", () => {
  it("counts a run nobody should start a second one beside", () => {
    expect(isRunInFlight("running")).toBe(true);
    expect(isRunInFlight("queued")).toBe(true);
  });

  it("leaves a finished run out of the way", () => {
    // A run waiting to be reviewed has done its work: the space can be
    // brought up to date again without waiting for someone to read it.
    expect(isRunInFlight("awaiting_review")).toBe(false);
    expect(isRunInFlight("succeeded")).toBe(false);
    expect(isRunInFlight("failed")).toBe(false);
  });
});

describe("inFlightLabel", () => {
  it("tells accepted apart from started", () => {
    expect(inFlightLabel("running")).toBe("Ingesting");
    expect(inFlightLabel("queued")).toBe("Queued");
  });
});
