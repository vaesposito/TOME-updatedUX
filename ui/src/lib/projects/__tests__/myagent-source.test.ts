import { describe, expect, it } from "@jest/globals";

import {
  hasMyAgentConsent,
  myAgentConnectorsForSubject,
  myAgentConsentRevisionForSubject,
  myAgentConsentSubjectFromSession,
  myAgentSourcesForSubject,
  normalizeMyAgentConnectors,
  normalizeMyAgentConsents,
} from "../myagent-source";

describe("myagent-source", () => {
  it("narrows per-ingest selections without adding unconsented sources or treating empty as all", () => {
    const sources = { myagent_consents: [{ subject: "owner", connectors: ["outlook", "sharepoint"], granted_at: "2026-01-01" }] };
    expect(myAgentConnectorsForSubject(sources, "owner", ["outlook"])).toEqual(["outlook"]);
    expect(myAgentConnectorsForSubject(sources, "owner", ["salesforce", "sharepoint"])).toEqual(["sharepoint"]);
    expect(myAgentConnectorsForSubject(sources, "owner", [])).toEqual([]);
    expect(myAgentConnectorsForSubject(sources, "owner")).toEqual(["outlook", "sharepoint"]);
    expect(myAgentConnectorsForSubject(sources, "other", ["outlook"])).toEqual([]);
  });
  it("normalizes the static connector allow-list in canonical order", () => {
    expect(
      normalizeMyAgentConnectors([
        " SHAREPOINT ",
        "unknown",
        "Outlook",
        "salesforce",
        "outlook",
        42,
      ]),
    ).toEqual(["outlook", "salesforce", "sharepoint"]);
  });

  it("keeps consent scoped to the requesting subject and redacts all records from the projection", () => {
    const sources = {
      github_repos: ["example/repository"],
      myagent_consents: [
        {
          subject: "user-a",
          connectors: ["salesforce"],
          granted_at: "2026-09-15T09:00:00.000Z",
        },
        {
          subject: "user-b",
          connectors: ["sharepoint", "outlook"],
          granted_at: "2026-09-15T09:01:00.000Z",
        },
      ],
    };

    expect(myAgentConnectorsForSubject(sources, "user-a")).toEqual(["salesforce"]);
    expect(myAgentConnectorsForSubject(sources, " user-b ")).toEqual(["outlook", "sharepoint"]);
    expect(myAgentConnectorsForSubject(sources, "user-c")).toEqual([]);
    expect(hasMyAgentConsent(sources)).toBe(true);

    expect(myAgentSourcesForSubject(sources, "user-a")).toEqual({
      github_repos: ["example/repository"],
      myagent_connectors: ["salesforce"],
      myagent_enabled: true,
      myagent_consent_revision: null,
    });
    expect(myAgentSourcesForSubject(sources, "user-c")).toEqual({
      github_repos: ["example/repository"],
      myagent_connectors: [],
      myagent_enabled: false,
      myagent_consent_revision: null,
    });
  });

  it("rejects malformed consent records and uses the last valid record for a subject", () => {
    expect(
      normalizeMyAgentConsents([
        { subject: "", connectors: ["outlook"], granted_at: "2026-09-15T09:00:00.000Z" },
        { subject: "user-a", connectors: ["unknown"], granted_at: "2026-09-15T09:00:00.000Z" },
        { subject: "user-a", connectors: ["outlook"], granted_at: "" },
        {
          subject: "user-a",
          connectors: ["outlook"],
          granted_at: "2026-09-15T09:00:00.000Z",
        },
        {
          subject: "user-a",
          connectors: ["salesforce"],
          granted_at: "2026-09-15T09:02:00.000Z",
        },
      ]),
    ).toEqual([
      {
        subject: "user-a",
        connectors: ["salesforce"],
        granted_at: "2026-09-15T09:02:00.000Z",
      },
    ]);
  });

  it("does not treat legacy project-wide UI fields as consent", () => {
    const legacySources = {
      myagent_connectors: ["outlook"],
      myagent_enabled: true,
    };

    expect(myAgentConnectorsForSubject(legacySources, "user-a")).toEqual([]);
    expect(hasMyAgentConsent(legacySources)).toBe(false);
  });

  it("keeps a revoke tombstone only as the caller's revision, not a live consent", () => {
    const sources = {
      myagent_consents: [
        {
          subject: "user-a",
          connectors: [],
          revision: "revoked-revision",
          revoked_at: "2026-09-15T10:00:00.000Z",
        },
      ],
    };

    expect(myAgentConnectorsForSubject(sources, "user-a")).toEqual([]);
    expect(hasMyAgentConsent(sources)).toBe(false);
    expect(myAgentConsentRevisionForSubject(sources, "user-a")).toBe("revoked-revision");
    expect(myAgentSourcesForSubject(sources, "user-a")).toEqual({
      myagent_connectors: [],
      myagent_enabled: false,
      myagent_consent_revision: "revoked-revision",
    });
  });

  it("never resurrects an earlier grant when a later record revokes or corrupts it", () => {
    const sources = {
      myagent_consents: [
        {
          subject: "user-a",
          connectors: ["outlook"],
          granted_at: "2026-09-15T09:00:00.000Z",
          revision: "grant-revision",
        },
        {
          subject: "user-a",
          connectors: [],
          revision: "revoke-revision",
          revoked_at: "2026-09-15T10:00:00.000Z",
        },
      ],
    };

    expect(myAgentConnectorsForSubject(sources, "user-a")).toEqual([]);
    expect(myAgentConsentRevisionForSubject(sources, "user-a")).toBe("revoke-revision");
    expect(hasMyAgentConsent(sources)).toBe(false);
  });

  it("accepts consent only from an authenticated first-party browser session", () => {
    expect(
      myAgentConsentSubjectFromSession({
        authMethod: "session",
        principalType: "oidc_user",
        sub: " user-a ",
      }),
    ).toBe("user-a");
    expect(
      myAgentConsentSubjectFromSession({ authMethod: "session", sub: "user-a" }),
    ).toBe("user-a");

    expect(
      myAgentConsentSubjectFromSession({
        authMethod: "bearer",
        principalType: "oidc_user",
        sub: "user-a",
      }),
    ).toBeNull();
    expect(
      myAgentConsentSubjectFromSession({
        authMethod: "session",
        principalType: "service_account",
        sub: "user-a",
      }),
    ).toBeNull();
    expect(myAgentConsentSubjectFromSession({ authMethod: "session", sub: "   " })).toBeNull();
  });
});
