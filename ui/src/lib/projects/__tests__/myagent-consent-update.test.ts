import { describe, expect, it } from "@jest/globals";

import {
  buildMyAgentConsentDelegationClaim,
  buildMyAgentConsentDelegationConsumptionClaim,
  buildMyAgentConsentMutation,
  buildMyAgentConsentSelfRevoke,
  myAgentConsentRevisionFilter,
  myAgentConsentSubjectFilter,
} from "../myagent-consent-update";

type Expression = Record<string, unknown>;

function object(value: unknown): Expression {
  expect(value).toEqual(expect.any(Object));
  return value as Expression;
}

function consentExpression(mutation: ReturnType<typeof buildMyAgentConsentMutation>): Expression {
  const stage = object(mutation.update[0]);
  return object(object(stage.$set)["sources.myagent_consents"]);
}

function upsertGrantedAtExpression(
  mutation: ReturnType<typeof buildMyAgentConsentMutation>,
): unknown[] {
  const outerLet = object(consentExpression(mutation).$let);
  const innerLet = object(outerLet.in).$let;
  const upsertLet = object(object(innerLet).in).$let;
  const concat = object(object(upsertLet).in).$concatArrays as unknown[];
  const appendedRecord = object((concat[1] as unknown[])[0]);
  const timestampLet = object(appendedRecord.granted_at).$let;
  return object(object(timestampLet).in).$cond as unknown[];
}

describe("myagent-consent-update", () => {
  it("builds a live Mongo pipeline instead of accepting a stale project consent snapshot", () => {
    const mutation = buildMyAgentConsentMutation({
      subject: " user-a ",
      connectors: ["sharepoint", "unknown", "OUTLOOK"],
      grantedAt: "2026-09-15T10:00:00.000Z",
      nextRevision: "revision-1",
    });

    expect(mutation.subject).toBe("user-a");
    expect(mutation.connectors).toEqual(["outlook", "sharepoint"]);
    expect(mutation.kind).toBe("upsert");

    const expression = consentExpression(mutation);
    const outerLet = object(expression.$let);
    expect(outerLet.vars).toEqual({
      existingConsents: {
        $cond: [
          { $isArray: "$sources.myagent_consents" },
          "$sources.myagent_consents",
          [],
        ],
      },
    });

    // Both filters run against the field resolved at write time. A concurrent
    // mutation for user-b sees and retains user-a's record (and vice versa),
    // rather than re-setting a list captured by an earlier project read.
    const innerLet = object(outerLet.in).$let;
    const innerVars = object(object(innerLet).vars);
    expect(object(innerVars.withoutTarget).$filter).toMatchObject({
      input: "$$existingConsents",
    });
    expect(object(innerVars.targetRecords).$filter).toMatchObject({
      input: "$$existingConsents",
    });
    expect(JSON.stringify(mutation.update)).not.toContain("user-b");
  });

  it("keeps granted_at when the effective connector scope is unchanged", () => {
    const timestamp = "2026-09-15T10:00:00.000Z";
    const mutation = buildMyAgentConsentMutation({
      subject: "user-a",
      connectors: ["outlook", "salesforce"],
      grantedAt: timestamp,
      nextRevision: "revision-2",
    });

    const condition = upsertGrantedAtExpression(mutation);
    expect(condition[0]).toMatchObject({
      $and: expect.arrayContaining([
        { $setEquals: expect.any(Array) },
        { $ne: ["$$previousGrantedAt", ""] },
      ]),
    });
    expect(condition.slice(1)).toEqual([
      "$$previousGrantedAt",
      { $literal: timestamp },
    ]);

    // `$setEquals` compares the normalized stored allow-list as a set, so a
    // duplicate or differently ordered legacy record is repaired without
    // falsely recording a fresh authorization time.
    expect(JSON.stringify(condition[0])).toContain("$setUnion");
  });

  it("builds a subject-only revoke tombstone without retaining the prior selection", () => {
    const mutation = buildMyAgentConsentSelfRevoke(
      " user-a ",
      "revision-3",
      "2026-09-15T10:01:00.000Z",
    );

    expect(mutation).toMatchObject({
      subject: "user-a",
      connectors: [],
      kind: "revoke",
    });
    const expression = consentExpression(mutation);
    const innerLet = object(object(expression.$let).in).$let;
    expect(JSON.stringify(object(innerLet).in)).toContain("$concatArrays");
    expect(JSON.stringify(mutation.update)).toContain('"revision-3"');
    expect(JSON.stringify(mutation.update)).toContain('"revoked_at"');
    expect(JSON.stringify(mutation.update)).not.toContain("granted_at");
    expect(myAgentConsentSubjectFilter(" user-a ")).toEqual({
      $expr: expect.objectContaining({ $anyElementTrue: expect.any(Object) }),
    });
    expect(JSON.stringify(myAgentConsentSubjectFilter(" user-a "))).toContain(
      '"$literal":"user-a"',
    );
    expect(JSON.stringify(myAgentConsentSubjectFilter(" user-a "))).toContain(
      '"$trim"',
    );
  });

  it("uses $literal for subject values that could otherwise be parsed as expressions", () => {
    const mutation = buildMyAgentConsentMutation({
      subject: "$user-a",
      connectors: ["outlook"],
      grantedAt: "2026-09-15T10:00:00.000Z",
      nextRevision: "revision-4",
    });

    expect(JSON.stringify(mutation.update)).toContain('"$literal":"$user-a"');
  });

  it("matches a PUT only against the caller's last opaque revision", () => {
    const filter = myAgentConsentRevisionFilter(" user-a ", "revision-7");

    expect(JSON.stringify(filter)).toContain('"$literal":"user-a"');
    expect(JSON.stringify(filter)).toContain('"$literal":"revision-7"');
    expect(JSON.stringify(filter)).toContain('"$arrayElemAt"');
    expect(JSON.stringify(filter)).toContain('"$$target.revision"');

    // Missing legacy revisions use only the empty/null sentinel, so an old
    // client cannot overwrite a newer generated revision after Disconnect.
    expect(JSON.stringify(myAgentConsentRevisionFilter("user-a", null))).toContain(
      '"$literal":""',
    );
  });

  it("builds a revision-conditional, server-literal delegation claim", () => {
    const claim = buildMyAgentConsentDelegationClaim({
      subject: " user-a ",
      expectedRevision: "revision-8",
      runId: "run-1",
      claimedAt: "2026-09-15T10:02:00.000Z",
    });

    expect(claim.subject).toBe("user-a");
    expect(claim.expectedRevision).toBe("revision-8");
    expect(JSON.stringify(claim.filter)).toContain('"$literal":"revision-8"');
    expect(JSON.stringify(claim.update)).toContain('"$mergeObjects"');
    expect(JSON.stringify(claim.update)).toContain('"myagent_delegation_claim_run_id":"run-1"');
    // Values are data, not aggregation expressions even if a server-created
    // id contains a dollar sign in a future implementation.
    const special = buildMyAgentConsentDelegationClaim({
      subject: "user-a",
      expectedRevision: null,
      runId: "$run",
      claimedAt: "2026-09-15T10:02:00.000Z",
    });
    expect(JSON.stringify(special.update)).toContain('"$literal":{"myagent_delegation_claimed_at"');
    expect(JSON.stringify(special.update)).toContain('"myagent_delegation_claim_run_id":"$run"');
  });

  it("requires the outbound claim before consuming a received reply", () => {
    const consume = buildMyAgentConsentDelegationConsumptionClaim({
      subject: "user-a",
      expectedRevision: "revision-9",
      runId: "run-1",
      consumedAt: "2026-09-15T10:03:00.000Z",
    });
    expect(JSON.stringify(consume.filter)).toContain('$$target.myagent_delegation_claim_run_id');
    expect(JSON.stringify(consume.filter)).toContain('"$literal":"run-1"');
    expect(JSON.stringify(consume.update)).toContain('"myagent_delegation_consumed_run_id":"run-1"');
  });

  it("rejects an empty subject and a non-revocation without a server timestamp", () => {
    expect(() =>
      buildMyAgentConsentMutation({
        subject: "   ",
        connectors: [],
        nextRevision: "revision-5",
        revokedAt: "2026-09-15T10:00:00.000Z",
      }),
    ).toThrow("non-empty subject");
    expect(() =>
      buildMyAgentConsentMutation({
        subject: "user-a",
        connectors: ["outlook"],
        nextRevision: "revision-6",
      }),
    ).toThrow("server-generated grantedAt");
  });
});
