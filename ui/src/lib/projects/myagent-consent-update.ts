import {
  MYAGENT_CONNECTORS,
  normalizeMyAgentConnectors,
  type MyAgentConnector,
} from "./myagent-source";

/**
 * MongoDB update pipelines are evaluated against the document at write time.
 * Keep this deliberately structural rather than accepting a caller-supplied
 * `sources` value, so two users changing their own consent cannot clobber one
 * another with stale project data.
 */
export type MongoUpdatePipeline = Array<Record<string, unknown>>;

export interface MyAgentConsentMutation {
  /** Canonical, authenticated subject whose one record this mutation owns. */
  subject: string;
  /** Canonical allow-listed selection; an empty list is a self-revoke. */
  connectors: MyAgentConnector[];
  /** Whether this writes a zero-connector revoke tombstone instead of a grant. */
  kind: "upsert" | "revoke";
  /** New opaque server-issued revision written by this mutation. */
  revision: string;
  /** Pass directly to `collection.updateOne(filter, update)`. */
  update: MongoUpdatePipeline;
}

/**
 * A one-time delegation claim is the linearization point between a browser's
 * Disconnect and the server sending a Webex request. It deliberately writes
 * no connector data and does not change the consent revision: a caller that
 * observed a particular revision may claim it once the runner is otherwise
 * ready to send, while a revoke that commits first changes the revision and
 * makes this conditional update miss.
 */
export interface MyAgentConsentDelegationClaim {
  /** Subject whose current consent revision must still be active. */
  subject: string;
  /** Revision observed from the freshly loaded project document. */
  expectedRevision: string | null;
  /** Server-created run identifier, retained only for operational correlation. */
  runId: string;
  /** Server-generated timestamp for the claim. */
  claimedAt: string;
  /** Conditional filter plus document-atomic update pipeline. */
  filter: Record<string, unknown>;
  update: MongoUpdatePipeline;
}

export interface MyAgentConsentMutationInput {
  /** Must come from `myAgentConsentSubjectFromSession`, never the request body. */
  subject: string;
  /** Untrusted connector selection from the request body. */
  connectors: unknown;
  /** Server-generated ISO timestamp used only when a scope actually changes. */
  grantedAt?: string;
  /** Server-generated opaque revision; never accepted from the request body. */
  nextRevision: string;
  /** Server-generated timestamp used for a durable revoke tombstone. */
  revokedAt?: string;
}

function normalizeSubject(value: string): string {
  const subject = typeof value === "string" ? value.trim() : "";
  if (!subject) throw new Error("MyAgent consent mutations require a non-empty subject");
  return subject;
}

function normalizeGrantedAt(value: string | undefined): string {
  const grantedAt = typeof value === "string" ? value.trim() : "";
  if (!grantedAt) {
    throw new Error("MyAgent consent grants require a server-generated grantedAt timestamp");
  }
  return grantedAt;
}

function normalizeNextRevision(value: string): string {
  const revision = typeof value === "string" ? value.trim() : "";
  if (!revision) {
    throw new Error("MyAgent consent mutations require a server-generated revision");
  }
  return revision;
}

function normalizeRevokedAt(value: string | undefined): string {
  const revokedAt = typeof value === "string" ? value.trim() : "";
  if (!revokedAt) {
    throw new Error("MyAgent consent revokes require a server-generated revokedAt timestamp");
  }
  return revokedAt;
}

/**
 * Return the canonical, allow-listed connector set for the last record for
 * the target subject. This makes an old out-of-order/duplicated record
 * harmless while retaining its original consent timestamp when the effective
 * scope did not change. Every mutation still writes a fresh opaque revision,
 * so an earlier browser response cannot overwrite a later decision.
 */
function canonicalStoredConnectors(): Record<string, unknown> {
  return {
    $setUnion: [
      {
        $filter: {
          input: {
            $map: {
              input: {
                $cond: [
                  { $isArray: "$$existingConsent.connectors" },
                  "$$existingConsent.connectors",
                  [],
                ],
              },
              as: "connector",
              in: {
                $toLower: {
                  $trim: {
                    input: {
                      $convert: {
                        input: "$$connector",
                        to: "string",
                        onError: "",
                        onNull: "",
                      },
                    },
                  },
                },
              },
            },
          },
          as: "connector",
          cond: { $in: ["$$connector", { $literal: [...MYAGENT_CONNECTORS] }] },
        },
      },
      [],
    ],
  };
}

/**
 * Match a stored subject defensively. The normal form is a trimmed string,
 * but malformed array items remain untouched instead of causing the update
 * pipeline to fail.
 */
function storedSubject(): Record<string, unknown> {
  return {
    $cond: [
      {
        $and: [
          { $eq: [{ $type: "$$consent" }, "object"] },
          { $eq: [{ $type: "$$consent.subject" }, "string"] },
        ],
      },
      { $trim: { input: "$$consent.subject" } },
      "",
    ],
  };
}

/** A valid, normalized prior timestamp, or an empty sentinel. */
function storedGrantedAt(): Record<string, unknown> {
  return {
    $cond: [
      { $eq: [{ $type: "$$existingConsent.granted_at" }, "string"] },
      { $trim: { input: "$$existingConsent.granted_at" } },
      "",
    ],
  };
}

/** A valid opaque revision from a target record, or an empty legacy sentinel. */
function storedTargetRevision(): Record<string, unknown> {
  return {
    $cond: [
      {
        $and: [
          { $eq: [{ $type: "$$target" }, "object"] },
          { $eq: [{ $type: "$$target.revision" }, "string"] },
        ],
      },
      { $trim: { input: "$$target.revision" } },
      "",
    ],
  };
}

/** A server-only delegation claim owner from the last target record. */
function storedTargetClaimRunId(): Record<string, unknown> {
  return {
    $cond: [
      {
        $and: [
          { $eq: [{ $type: "$$target" }, "object"] },
          { $eq: [{ $type: "$$target.myagent_delegation_claim_run_id" }, "string"] },
        ],
      },
      { $trim: { input: "$$target.myagent_delegation_claim_run_id" } },
      "",
    ],
  };
}

/**
 * Build a document-atomic update for exactly one session subject's MyAgent
 * consent. It intentionally reads `$sources.myagent_consents` *inside* the
 * MongoDB pipeline: concurrent updates for different subjects each preserve
 * the other's latest record. Do not replace this with a `$set` value derived
 * from a previously fetched `ProjectDocument`.
 *
 * For an unchanged effective connector scope, the existing `granted_at` is
 * retained. An empty normalized selection writes a minimal zero-connector
 * tombstone for this subject; it is suitable for a self-service revoke endpoint
 * that does not load or authorize read access to the project. The tombstone
 * invalidates delayed grants without retaining the user's former selection.
 */
export function buildMyAgentConsentMutation(
  input: MyAgentConsentMutationInput,
): MyAgentConsentMutation {
  const subject = normalizeSubject(input.subject);
  const connectors = normalizeMyAgentConnectors(input.connectors);
  const kind = connectors.length > 0 ? "upsert" : "revoke";
  const grantedAt = kind === "upsert" ? normalizeGrantedAt(input.grantedAt) : undefined;
  const revision = normalizeNextRevision(input.nextRevision);
  const revokedAt = kind === "revoke" ? normalizeRevokedAt(input.revokedAt) : undefined;
  const subjectLiteral = { $literal: subject };

  const isTargetSubject = { $eq: [storedSubject(), subjectLiteral] };
  const withoutTarget = {
    $filter: {
      input: "$$existingConsents",
      as: "consent",
      cond: { $ne: [storedSubject(), subjectLiteral] },
    },
  };
  const targetRecords = {
    $filter: {
      input: "$$existingConsents",
      as: "consent",
      cond: isTargetSubject,
    },
  };

  const update: MongoUpdatePipeline = [
    {
      $set: {
        "sources.myagent_consents": {
          $let: {
            vars: {
              existingConsents: {
                $cond: [
                  { $isArray: "$sources.myagent_consents" },
                  "$sources.myagent_consents",
                  [],
                ],
              },
            },
            in: {
              $let: {
                vars: { withoutTarget, targetRecords },
                in:
                  kind === "revoke"
                    ? {
                        $concatArrays: [
                          "$$withoutTarget",
                          [
                            {
                              subject: subjectLiteral,
                              connectors: { $literal: [] },
                              revision: { $literal: revision },
                              revoked_at: { $literal: revokedAt },
                            },
                          ],
                        ],
                      }
                    : {
                        $let: {
                          vars: {
                            existingConsent: { $arrayElemAt: ["$$targetRecords", -1] },
                          },
                          in: {
                            $concatArrays: [
                              "$$withoutTarget",
                              [
                                {
                                  subject: subjectLiteral,
                                  connectors: { $literal: connectors },
                                  revision: { $literal: revision },
                                  granted_at: {
                                    $let: {
                                      vars: { previousGrantedAt: storedGrantedAt() },
                                      in: {
                                        $cond: [
                                          {
                                            $and: [
                                              {
                                                $setEquals: [
                                                  canonicalStoredConnectors(),
                                                  { $literal: connectors },
                                                ],
                                              },
                                              { $ne: ["$$previousGrantedAt", ""] },
                                            ],
                                          },
                                          "$$previousGrantedAt",
                                          { $literal: grantedAt },
                                        ],
                                      },
                                    },
                                  },
                                },
                              ],
                            ],
                          },
                        },
                      },
              },
            },
          },
        },
      },
    },
  ];

  return { subject, connectors, kind, revision, update };
}

/**
 * A dedicated self-revoke builder prevents callers from accidentally adding
 * a connector while handling a disconnect action. Pair this with the
 * normalized `myAgentConsentSubjectFilter()` below; that route needs only a
 * first-party session, not project read permission.
 */
export function buildMyAgentConsentSelfRevoke(
  subject: string,
  nextRevision: string,
  revokedAt: string,
): MyAgentConsentMutation {
  return buildMyAgentConsentMutation({
    subject,
    connectors: [],
    nextRevision,
    revokedAt,
  });
}

/**
 * Require a PUT to be based on the caller's last projected revision. Legacy
 * records without one match only the `null` sentinel once, after which every
 * write has a server-issued revision. A DELETE does not use this filter: it
 * always writes a new tombstone so disconnect wins over a delayed prior PUT.
 */
export function myAgentConsentRevisionFilter(
  subject: string,
  expectedRevision: string | null,
): Record<string, unknown> {
  const normalized = normalizeSubject(subject);
  const expected = typeof expectedRevision === "string" && expectedRevision.trim()
    ? expectedRevision.trim()
    : "";
  const subjectLiteral = { $literal: normalized };
  return {
    $expr: {
      $let: {
        vars: {
          existingConsents: {
            $cond: [
              { $isArray: "$sources.myagent_consents" },
              "$sources.myagent_consents",
              [],
            ],
          },
        },
        in: {
          $let: {
            vars: {
              targetRecords: {
                $filter: {
                  input: "$$existingConsents",
                  as: "consent",
                  cond: { $eq: [storedSubject(), subjectLiteral] },
                },
              },
            },
            in: {
              $let: {
                vars: { target: { $arrayElemAt: ["$$targetRecords", -1] } },
                in: { $eq: [storedTargetRevision(), { $literal: expected }] },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Require the current last consent record to still belong to this run's
 * outbound delegation claim. This is used for the second, consumption claim
 * after a reply is received: Disconnect removes/revisions the record, making
 * a late reply non-consumable even though an already-sent Webex DM cannot be
 * recalled.
 */
export function myAgentConsentDelegationClaimFilter(
  subject: string,
  expectedRevision: string | null,
  runId: string,
): Record<string, unknown> {
  const normalized = normalizeSubject(subject);
  const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
  if (!normalizedRunId) throw new Error("MyAgent delegation claim checks require a run id");
  const revisionFilter = myAgentConsentRevisionFilter(normalized, expectedRevision);
  const subjectLiteral = { $literal: normalized };
  return {
    $expr: {
      $and: [
        revisionFilter.$expr,
        {
          $let: {
            vars: {
              existingConsents: {
                $cond: [
                  { $isArray: "$sources.myagent_consents" },
                  "$sources.myagent_consents",
                  [],
                ],
              },
            },
            in: {
              $let: {
                vars: {
                  targetRecords: {
                    $filter: {
                      input: "$$existingConsents",
                      as: "consent",
                      cond: { $eq: [storedSubject(), subjectLiteral] },
                    },
                  },
                },
                in: {
                  $let: {
                    vars: { target: { $arrayElemAt: ["$$targetRecords", -1] } },
                    in: {
                      $eq: [
                        storedTargetClaimRunId(),
                        { $literal: normalizedRunId },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
}

/**
 * Claim an already-selected MyAgent delegation immediately before its Webex
 * request is sent. The runner must use the returned `filter` in the same
 * `updateOne` as this pipeline. If Disconnect committed first, its tombstone
 * has a new revision and this claim returns no match; no request may be sent.
 *
 * This updates only private server-side metadata on the caller's existing
 * consent record. It is intentionally not exposed in `myAgentSourcesForSubject`
 * and does not broaden the selected connector set.
 */
export function buildMyAgentConsentDelegationClaim(input: {
  subject: string;
  expectedRevision: string | null;
  runId: string;
  claimedAt: string;
}): MyAgentConsentDelegationClaim {
  const subject = normalizeSubject(input.subject);
  const runId = typeof input.runId === "string" ? input.runId.trim() : "";
  const claimedAt = typeof input.claimedAt === "string" ? input.claimedAt.trim() : "";
  if (!runId) throw new Error("MyAgent delegation claims require a run id");
  if (!claimedAt) throw new Error("MyAgent delegation claims require a timestamp");
  const expectedRevision =
    typeof input.expectedRevision === "string" && input.expectedRevision.trim()
      ? input.expectedRevision.trim()
      : null;
  const subjectLiteral = { $literal: subject };
  const claimLiteral = {
    $literal: {
      myagent_delegation_claimed_at: claimedAt,
      myagent_delegation_claim_run_id: runId,
    },
  };

  const update: MongoUpdatePipeline = [
    {
      $set: {
        "sources.myagent_consents": {
          $map: {
            input: {
              $cond: [
                { $isArray: "$sources.myagent_consents" },
                "$sources.myagent_consents",
                [],
              ],
            },
            as: "consent",
            in: {
              $cond: [
                { $eq: [storedSubject(), subjectLiteral] },
                { $mergeObjects: ["$$consent", claimLiteral] },
                "$$consent",
              ],
            },
          },
        },
      },
    },
  ];

  return {
    subject,
    expectedRevision,
    runId,
    claimedAt,
    filter: myAgentConsentRevisionFilter(subject, expectedRevision),
    update,
  };
}

/**
 * Atomically claim a received reply for use in this run. The caller invokes
 * this immediately before putting reply content into an agent request. A
 * disconnect that committed while Webex was replying causes a no-match, so
 * the returned content is discarded. Once this write wins, the reply is an
 * already-started processing operation; that bounded in-flight work cannot be
 * retroactively cancelled by a later Disconnect.
 */
export function buildMyAgentConsentDelegationConsumptionClaim(input: {
  subject: string;
  expectedRevision: string | null;
  runId: string;
  consumedAt: string;
}): MyAgentConsentDelegationClaim {
  const subject = normalizeSubject(input.subject);
  const runId = typeof input.runId === "string" ? input.runId.trim() : "";
  const consumedAt = typeof input.consumedAt === "string" ? input.consumedAt.trim() : "";
  if (!runId) throw new Error("MyAgent delegation consumption claims require a run id");
  if (!consumedAt) throw new Error("MyAgent delegation consumption claims require a timestamp");
  const expectedRevision =
    typeof input.expectedRevision === "string" && input.expectedRevision.trim()
      ? input.expectedRevision.trim()
      : null;
  const subjectLiteral = { $literal: subject };
  const consumedLiteral = {
    $literal: {
      myagent_delegation_consumed_at: consumedAt,
      myagent_delegation_consumed_run_id: runId,
    },
  };
  const update: MongoUpdatePipeline = [
    {
      $set: {
        "sources.myagent_consents": {
          $map: {
            input: {
              $cond: [
                { $isArray: "$sources.myagent_consents" },
                "$sources.myagent_consents",
                [],
              ],
            },
            as: "consent",
            in: {
              $cond: [
                { $eq: [storedSubject(), subjectLiteral] },
                { $mergeObjects: ["$$consent", consumedLiteral] },
                "$$consent",
              ],
            },
          },
        },
      },
    },
  ];
  return {
    subject,
    expectedRevision,
    runId,
    claimedAt: consumedAt,
    filter: myAgentConsentDelegationClaimFilter(subject, expectedRevision, runId),
    update,
  };
}

/**
 * Narrow an unauthorised-to-read self-revoke to documents where the caller
 * actually has a consent record. Its `$expr` comparison trims legacy subject
 * strings before matching, so a historical `" user-a "` record is revocable.
 * A route can combine it with a project slug and return a non-enumerating
 * success response without read permission.
 */
export function myAgentConsentSubjectFilter(subject: string): Record<string, unknown> {
  const normalized = normalizeSubject(subject);
  return {
    $expr: {
      $anyElementTrue: {
        $map: {
          input: {
            $cond: [
              { $isArray: "$sources.myagent_consents" },
              "$sources.myagent_consents",
              [],
            ],
          },
          as: "consent",
          in: {
            // `storedSubject()` places `$trim` behind a `$cond` type check.
            // Do not use `$and` as a type guard here: aggregation expressions
            // are not required to short-circuit, so malformed legacy array
            // entries could otherwise make an idempotent self-revoke fail.
            $eq: [storedSubject(), { $literal: normalized }],
          },
        },
      },
    },
  };
}
