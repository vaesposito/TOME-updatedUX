"""Shared-token validation for requests arriving at tome-agent.

The UI and agent already use the same bearer token for agent-to-UI callbacks.
This module applies that convention in the other direction without accepting
blank configuration or alternative authorization schemes.
"""

from __future__ import annotations

import hmac


def has_valid_bearer_token(
    authorization: str | None,
    expected_token: str | None,
) -> bool:
    """Return whether ``authorization`` carries the configured bearer token.

    ``compare_digest`` avoids making a token prefix observable through the
    comparison itself. Missing or whitespace-only configured values are never
    treated as authorization.
    """
    expected = (expected_token or "").strip()
    if not expected or not authorization:
        return False

    parts = authorization.strip().split(maxsplit=1)
    if len(parts) != 2 or parts[0].casefold() != "bearer":
        return False

    supplied = parts[1].strip()
    return bool(supplied) and hmac.compare_digest(
        supplied.encode(),
        expected.encode(),
    )
