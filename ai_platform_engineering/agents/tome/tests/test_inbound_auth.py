from __future__ import annotations

import asyncio

import httpx
import pytest

from tome_agent.agent.inbound_auth import has_valid_bearer_token


@pytest.mark.parametrize(
    ("authorization", "expected", "authorized"),
    [
        ("Bearer shared-secret", "shared-secret", True),
        ("bEaReR shared-secret", "shared-secret", True),
        ("Bearer\tshared-secret", "shared-secret", True),
        ("Bearer wrong-secret", "shared-secret", False),
        ("Basic shared-secret", "shared-secret", False),
        (None, "shared-secret", False),
        ("Bearer shared-secret", "", False),
        ("Bearer shared-secret", "   ", False),
    ],
)
def test_bearer_token_validation(
    authorization: str | None,
    expected: str,
    authorized: bool,
) -> None:
    assert has_valid_bearer_token(authorization, expected) is authorized


def test_agent_rejects_unauthenticated_non_health_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TTT_AGENT_TOKEN", "shared-secret")

    # Do not enter the app lifespan: this exercises only the HTTP auth boundary,
    # without requiring an LLM credential or a callback service.
    from tome_agent.agent import main

    async def exercise() -> tuple[int, int, int, int]:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            health = await client.get("/healthz")
            denied = await client.post("/model-check", json={"model": "example-model"})
            docs_denied = await client.get("/openapi.json")
            accepted = await client.post(
                "/model-check",
                headers={"Authorization": "Bearer shared-secret"},
                json={"model": "example-model"},
            )
        return health.status_code, denied.status_code, docs_denied.status_code, accepted.status_code

    previous_ready = main._state.ready
    main._state.ready = False
    try:
        health_status, denied_status, docs_status, accepted_status = asyncio.run(exercise())
    finally:
        main._state.ready = previous_ready

    assert health_status == 200
    assert denied_status == 401
    assert docs_status == 401
    # The app is forced not-ready so this cannot call a provider. Its 503 proves
    # the valid shared token reached the protected route before readiness.
    assert accepted_status == 503
