# Feature Specification: Chat Transcript Evaluation

**Feature Branch**: `2026-09-30-tome-chat-evaluation`
**Created**: 2026-09-30
**Status**: Draft
**Input**: User description: "create a POST /evaluate/chat endpoint (or a mode=chat extension of the existing endpoint) that accepts a transcript + evidence bundle and reuses evaluator.py's claim-extraction machinery generalized to non-page input. It should optionally take a reference answer to judge against or otherwise use a rubric for measuring relevance and completeness."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify chat responses are grounded in evidence (Priority: P1)

As a system evaluating an AI assistant's chat responses, I want to submit a
completed chat transcript along with the evidence bundle that should have
grounded the assistant's answer, so that the same claim-by-claim factual
verification used today for generated pages can also verify chat answers —
flagging unsupported, contradicted, or fabricated claims.

**Why this priority**: This is the direct generalization of the existing
page-based evidence audit onto chat-based experiences, which currently have
no automated way to check whether an assistant's answer is actually backed
by the evidence it was given. Without it, a regression in chat groundedness
goes undetected until a person notices a wrong or fabricated answer.

**Independent Test**: Can be fully tested by submitting a transcript whose
assistant answer mixes accurate, unsupported, and fabricated statements
together with a matching evidence bundle, and confirming the response
classifies each extracted claim correctly using the same claim fields
(exact text, offsets, verdict, critical kind) used for page evaluation
today.

**Acceptance Scenarios**:

1. **Given** a chat transcript whose assistant answer contains only claims
   backed by the supplied evidence bundle, **When** the transcript is
   submitted for evaluation, **Then** every extracted claim is marked
   supported and no fabricated entities are reported.
2. **Given** a chat transcript whose assistant answer contains a claim
   contradicted by the supplied evidence bundle, **When** the transcript is
   submitted for evaluation, **Then** that claim is returned with a
   contradicted verdict identifying the conflicting evidence.
3. **Given** a chat transcript whose assistant answer contains a specific,
   checkable detail with no matching evidence in the bundle, **When** the
   transcript is submitted for evaluation, **Then** that claim is returned
   with an unsupported or unverifiable verdict.

---

### User Story 2 - Score a chat response against a reference answer (Priority: P2)

As someone validating a new chat agent version or comparing agent
configurations, I want to optionally supply a known-good reference answer
alongside the transcript, so that the evaluation also tells me how relevant
and complete the assistant's actual answer was compared to that reference.

**Why this priority**: Grounding alone (Story 1) tells you whether the
assistant fabricated or contradicted something, but not whether it actually
answered the question well or left out important information. Reference-
answer comparison is what lets teams run before/after regression comparisons
on agent quality — the main way experiment quality is judged today.

**Independent Test**: Can be fully tested by submitting the same transcript
and evidence bundle twice with two different reference answers (one closely
matching the assistant's answer, one substantially different) and
confirming relevance/completeness scores differ accordingly.

**Acceptance Scenarios**:

1. **Given** a transcript and a reference answer that covers the same key
   points as the assistant's answer, **When** evaluated, **Then** the
   response reports high relevance and completeness scores relative to that
   reference.
2. **Given** a transcript and a reference answer that covers additional key
   points absent from the assistant's answer, **When** evaluated, **Then**
   the response reports a lower completeness score and identifies what was
   missing.
3. **Given** a transcript and a reference answer addressing a different
   question than the one the assistant answered, **When** evaluated,
   **Then** the response reports a low relevance score.

---

### User Story 3 - Score a chat response using a rubric when no reference answer exists (Priority: P3)

As someone evaluating a chat response in an ad-hoc or exploratory setting
where no gold-standard answer exists yet, I want the evaluation to still
measure relevance and completeness using a rubric-based assessment, so that
I get a meaningful quality signal even without preparing a reference
answer.

**Why this priority**: Requiring every caller to author a reference answer
before they can evaluate a chat response would block adoption for
exploratory and continuous-monitoring use cases; a rubric-based fallback
keeps the feature usable when no reference exists.

**Independent Test**: Can be fully tested by submitting a transcript and
evidence bundle with no reference answer and confirming the response still
contains relevance and completeness scores, derived from rubric criteria
rather than a comparison target.

**Acceptance Scenarios**:

1. **Given** a transcript and evidence bundle with no reference answer
   supplied, **When** evaluated, **Then** the response includes relevance
   and completeness scores along with the rubric criteria that produced
   them.
2. **Given** a transcript whose assistant answer does not address the
   evidence bundle's subject matter at all, **When** evaluated under the
   rubric, **Then** the response reports a low relevance score.

---

### Edge Cases

- What happens when the transcript contains no assistant turns (e.g., only
  user turns)?
- What happens when both a reference answer is supplied and no rubric is
  requested — does the reference answer fully replace rubric scoring, or do
  both run?
- How does the system handle an evidence bundle that is empty for a chat
  transcript that makes specific factual claims?
- What happens when the transcript is large enough to require the same
  token/batching budget the page evaluator plans for today?
- How does the system score an assistant turn that explicitly declines to
  answer (e.g., "I don't have that information") — as a completeness gap,
  an unverifiable claim, or excluded from claim extraction entirely?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a chat-based evaluation request consisting
  of a chat transcript (an ordered sequence of conversation turns) and an
  evidence bundle in the same shape used by page-based evaluation today.
- **FR-002**: System MUST extract independently checkable factual claims
  from the assistant's final answer in the transcript, using the same
  claim definition (verbatim exact text and offsets, excluding headings,
  opinions, and TBD statements) used for page-based evaluation.
- **FR-003**: System MUST classify each extracted claim against the
  supplied evidence bundle using the same verdict taxonomy (supported,
  partially_supported, unsupported, contradicted, unverifiable) and
  critical-kind flags used for page-based evaluation today.
- **FR-004**: System MUST detect fabricated entities and fabricated
  quantitative details within chat transcripts using the same detection
  logic used for page-based evaluation.
- **FR-005**: System MUST allow the caller to optionally supply a reference
  answer; when supplied, the system MUST score the assistant's answer for
  relevance and completeness relative to that reference answer.
- **FR-006**: System MUST, when no reference answer is supplied, score the
  assistant's answer for relevance and completeness using a built-in
  default rubric, while allowing the caller to optionally override that
  rubric with custom criteria in the request.
- **FR-007**: System MUST represent relevance and completeness results as
  numeric scores per dimension (relevance, completeness), each with
  supporting rationale, regardless of whether scoring was driven by a
  reference answer or a rubric.
- **FR-008**: System MUST return chat evaluation results (claims, verdicts,
  relevance/completeness scores, telemetry) without requiring existing
  page-based evaluation callers to change their request or response
  handling.
- **FR-009**: System MUST report the same telemetry fields (tokens, cost,
  batches, attempts) for chat evaluation requests as it does for page
  evaluation requests, so cost and usage tracking works uniformly across
  both.

### Key Entities

- **Chat Transcript**: An ordered sequence of conversation turns (each with
  a role such as user/assistant and message content) representing the
  conversation being evaluated; generalizes today's "candidate pages"
  input.
- **Evidence Bundle**: The existing frozen set of evidence items (id,
  canonical URI, content hash, content) the assistant's answer should be
  grounded in; unchanged from page-based evaluation.
- **Extracted Claim**: An independently checkable factual statement pulled
  from the transcript, with its exact text, location, verdict against the
  evidence bundle, and any fabrication/critical-kind flags; same shape as
  today's page-evaluation claims.
- **Reference Answer**: An optional known-good answer supplied by the
  caller, used as the comparison target for relevance and completeness
  scoring.
- **Rubric**: The set of criteria used to score relevance and completeness
  when no reference answer is supplied, either the system's built-in
  default or caller-supplied custom criteria.
- **Relevance/Completeness Result**: The numeric score(s) and supporting
  rationale describing how well the assistant's answer addressed the
  question and covered the relevant evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A caller can evaluate a chat transcript's factual grounding
  and receive claim-level verdicts with the same accuracy and field
  completeness as page-based evaluation, without transforming the
  transcript into a page-like document first.
- **SC-002**: When a reference answer is supplied, relevance and
  completeness scores move in the expected direction — higher when the
  assistant's answer matches the reference more closely, lower when it
  diverges — across representative test transcripts.
- **SC-003**: When no reference answer is supplied, every chat evaluation
  request still returns non-null relevance and completeness scores derived
  from the rubric.
- **SC-004**: Existing page-based evaluation callers observe no change in
  behavior, response shape, or cost after this feature ships.
- **SC-005**: A chat-transcript evaluation request completes within the
  same latency and cost budget as an equivalently sized page evaluation
  request.

## Assumptions

- Only the assistant's final answer in a transcript is evaluated for
  factual claims and relevance/completeness; earlier turns provide context
  but are not independently claim-checked. This keeps chat evaluation
  aligned with the reference-answer/rubric model, which judges a single
  answer, not a whole conversation.
- Relevance and completeness are reported as numeric scores with rationale
  (consistent with a scoring model teams can threshold and trend over
  time), rather than as free-text or categorical ratings alone.
- A built-in default rubric is always available so that relevance and
  completeness can be scored even when no reference answer is supplied;
  callers may override it with custom criteria when they need
  domain-specific measures.
