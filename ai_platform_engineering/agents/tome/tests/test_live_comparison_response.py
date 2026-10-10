import json

import pytest
from pydantic import ValidationError

from tome_agent.agent.live_verification import parse_comparison


@pytest.mark.parametrize("fenced", [False, True])
def test_comparison_accepts_strict_json_with_optional_fence(fenced: bool) -> None:
    text = json.dumps({"answer": "Example answer", "claim_checks": [{
        "claim": "Example claim", "status": "unverified", "source_urls": [], "reason": "No evidence",
    }], "warnings": []})
    if fenced:
        text = "```json\n" + text + "\n```"
    assert parse_comparison(text).claim_checks[0].status == "unverified"


def test_comparison_rejects_non_json_prose() -> None:
    with pytest.raises(ValidationError):
        parse_comparison('Here is the answer: {"answer":"example"}')
