# Quickstart: Chat Transcript Evaluation

## Try it against a running `tome_agent`

```bash
curl -sS -X POST "$TOME_AGENT_URL/evaluate/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "blind_label": "manual-check",
    "evaluator_model": "claude-sonnet-5",
    "transcript": [
      { "role": "user", "content": "When is the billing migration launching, and who owns it?" },
      { "role": "assistant", "content": "The billing migration is targeted for 2026-11-15 and is owned by the payments team." }
    ],
    "evidence": [
      {
        "id": "ev-1",
        "canonical_uri": "example://space/billing-migration-plan",
        "content_hash": "sha256:placeholder",
        "content": "Billing migration target date: 2026-11-01. Owner: payments team. Status: blocked on schema review."
      }
    ]
  }' | jq .
```

Expected: a `contradicted` claim on the date (evidence says 2026-11-01, not
2026-11-15), a `supported` claim on ownership, and a `relevance_completeness`
result scored against the built-in default rubric (no `reference_answer`
was supplied) — flagging that the answer omits the "blocked on schema
review" status.

## Try it with a reference answer instead of the default rubric

Add `"reference_answer": "The billing migration is targeted for 2026-11-01, owned by the payments team, and is currently blocked on a schema review."`
to the request body above. `relevance_completeness.method` switches to
`"reference_answer"`, and `completeness.findings` should call out the same
missing status detail, now framed as a gap against the reference answer
rather than the default rubric.

## Verify existing `/evaluate` behavior is untouched

```bash
uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py -k "not chat"
```

All existing page-evaluation tests must continue to pass unmodified — this
feature adds new tests, it does not change any existing ones (SC-004).

## Run the new chat-evaluation tests

```bash
uv run pytest ai_platform_engineering/agents/tome/tests/test_evaluator.py -k "chat"
```
