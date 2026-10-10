# Contract: `source_fetch` Evidence-Bundle Kind

Satisfies FR-008/FR-009. Extends `captureEvidenceBundle` (`ui/src/lib/tome/evidence-bundle.ts`)
without modifying any existing evidence kind's assembly logic.

## Change to `captureEvidenceBundle` input

```ts
export async function captureEvidenceBundle(input: {
  project: ProjectDocument & { _id: string };
  childProjects?: Array<{ _id: string; slug: string }>;
  createdBy: string;
  seed?: string | null;
  myAgentEvidence?: MyAgentEvidence;
  runId?: string;   // NEW — optional; when present, include that run's source_fetch entries
}): Promise<EvidenceBundle>
```

- `runId` omitted (existing callers, unchanged): bundle assembly behaves exactly as today —
  no `source_fetch` items, all existing kinds unaffected. This is what makes FR-009's "no
  existing behavior changes" true by default rather than by careful case-by-case handling.
- `runId` present: after the existing item-assembly steps, fetch that run's
  `FetchLedgerEntry` records with `status: "success"` and append one `EvidenceItem` per
  entry with `kind: "source_fetch"`, per the mapping in `data-model.md`.

## Existing consumers unaffected

- `evaluator.py`'s claim-grounding judge iterates evidence items by existing kind; it is not
  modified by this feature and will not see `source_fetch` items unless a future change
  explicitly asks for `runId` and teaches the evaluator to use the new kind (that's
  explicitly out of scope here — see spec.md's Assumptions and the companion design's own
  "necessary, not sufficient" framing in §6.1).
- `ExperimentDecisionDashboard.tsx` and other bundle consumers iterate `EvidenceItem[]` by
  `kind`; an unrecognized-to-them `source_fetch` kind is simply not rendered by existing UI
  unless/until a future change adds a view for it — no existing rendering breaks.
