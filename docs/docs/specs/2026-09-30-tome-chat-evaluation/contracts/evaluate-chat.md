# Contract: `POST /evaluate/chat`

Service: `tome_agent` (existing FastAPI service that also serves
`POST /evaluate` and `GET /evaluate/prompt`).

## Request

`Content-Type: application/json`, body validates against
`ChatEvaluationRequest` (see [data-model.md](../data-model.md)).

```json
{
  "blind_label": "candidate-a",
  "evaluator_model": "claude-sonnet-5",
  "max_claims": 12,
  "transcript": [
    { "role": "user", "content": "What is the target launch date for the billing migration?" },
    { "role": "assistant", "content": "The billing migration is targeted for 2026-11-15 and is owned by the payments team." }
  ],
  "evidence": [
    {
      "id": "ev-1",
      "canonical_uri": "example://space/billing-migration-plan",
      "content_hash": "sha256:...",
      "content": "Billing migration target date: 2026-11-01. Owner: payments team."
    }
  ],
  "reference_answer": null,
  "rubric": null,
  "max_cost_usd": 0.50
}
```

- Exactly one of `reference_answer` or `rubric` should be set by the caller
  (setting both is allowed; `reference_answer` takes precedence — see Edge
  Cases in spec.md). Leaving both unset uses the built-in default rubric.
- `transcript` must contain at least one `assistant` turn.

## Response — 200 OK

Body validates against `ChatEvaluationResponse`.

```json
{
  "claims": [
    {
      "id": "chat-1-9f2c1a3b4d5e6f70",
      "page": "transcript",
      "section": null,
      "exact_text": "The billing migration is targeted for 2026-11-15",
      "start_offset": 0,
      "end_offset": 50,
      "classification": "contradicted",
      "reason": "Evidence states the target date is 2026-11-01, not 2026-11-15.",
      "confidence": 0.9,
      "abstained": false,
      "citations": ["example://space/billing-migration-plan"],
      "evidence": [
        {
          "evidence_item_id": "ev-1",
          "canonical_uri": "example://space/billing-migration-plan",
          "content_hash": "sha256:...",
          "quote": "Billing migration target date: 2026-11-01."
        }
      ],
      "critical_kind": "date_or_deadline",
      "fabricated_entities": [],
      "fabricated_quantitative_details": []
    },
    {
      "id": "chat-2-1a2b3c4d5e6f7081",
      "page": "transcript",
      "section": null,
      "exact_text": "is owned by the payments team",
      "start_offset": 54,
      "end_offset": 84,
      "classification": "supported",
      "reason": "Matches evidence exactly.",
      "confidence": 0.95,
      "abstained": false,
      "citations": ["example://space/billing-migration-plan"],
      "evidence": [
        {
          "evidence_item_id": "ev-1",
          "canonical_uri": "example://space/billing-migration-plan",
          "content_hash": "sha256:...",
          "quote": "Owner: payments team."
        }
      ],
      "critical_kind": "ownership",
      "fabricated_entities": [],
      "fabricated_quantitative_details": []
    }
  ],
  "relevance_completeness": {
    "method": "rubric",
    "relevance": {
      "score": 0.9,
      "rationale": "Directly answers the date-and-owner question asked.",
      "findings": []
    },
    "completeness": {
      "score": 0.6,
      "rationale": "Gives a date and owner but omits the migration's current status noted in evidence.",
      "findings": ["Evidence also notes the migration is currently blocked on a schema review; the answer does not mention this."]
    },
    "rubric_applied": [
      { "id": "relevance_default", "description": "Directly addresses the user's actual question, without unrelated or off-topic content.", "weight": 1.0 },
      { "id": "completeness_default", "description": "Covers all evidence-relevant aspects needed to fully answer the question, without omitting material information available in the evidence bundle.", "weight": 1.0 }
    ]
  },
  "tokens": { "input": 812, "output": 340 },
  "turns": 2,
  "cost_usd": 0.0041,
  "batches": 1,
  "attempts": 2
}
```

## Error responses

Same convention as `/evaluate`: any `ValueError` raised during evaluation
(invalid transcript, evidence exceeding the token budget, evaluator
refusal, etc.) is surfaced as `HTTPException(502, str(exc))`. `503` is
returned when the service is not yet ready (`_state.ready`).

## Compatibility

`POST /evaluate` and `GET /evaluate/prompt` are unchanged — this contract
adds a new route and new request/response types; no existing type in
`contract.py` is modified.
