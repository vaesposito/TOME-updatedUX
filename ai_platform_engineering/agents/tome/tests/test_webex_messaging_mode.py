from tome_agent.agent import http_client
from tome_agent.agent.connectors.base import SourceItem
from tome_agent.agent.connectors.webex import WebexConnector, WebexExtra


def test_messaging_only_credential_excludes_meeting_tools_and_guidance() -> None:
    connector = WebexConnector()
    http_client.set_active_credentials(
        {"webex": {"access_token": "test-token", "messaging_only": "true"}}
    )

    assert connector.mcp_tools == [
        "mcp__webex__webex_list_rooms",
        "mcp__webex__webex_list_messages",
        "mcp__webex__webex_get_message",
        "mcp__webex__webex_get_person",
    ]
    guidance = connector.deep_research_guidance(
        [SourceItem(slug="example-room", display_name="Example Room")]
    )
    assert "webex_meetings" not in guidance


def test_legacy_webex_credential_keeps_meeting_tools() -> None:
    connector = WebexConnector()
    http_client.set_active_credentials({"webex": {"access_token": "test-token"}})

    assert "mcp__webex__webex_meetings_list_transcripts" in connector.mcp_tools
    prompt = connector.system_prompt_block(
        [],
        extra_data=WebexExtra(
            meetings=[
                {
                    "id": "meeting-1",
                    "title": "Weekly Sync",
                    "start": "2026-09-09T12:00:00Z",
                }
            ]
        ),
    )
    assert "WEBEX MEETINGS TO INGEST" in prompt
