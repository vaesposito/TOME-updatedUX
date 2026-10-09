"""Exercise renderer isolation in a fresh process, never in the test runner."""

import ctypes.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tome_agent.agent.document_renderer import cleanup_profile_socket, profile_socket


def test_profile_socket_identity_is_unique_and_cleanup_rejects_regular_files(
    tmp_path: Path,
) -> None:
    profile = tmp_path / "profile"
    path = profile_socket(profile)
    assert path != profile_socket(tmp_path / "other-profile")
    assert path.parent == Path("/tmp")
    path.write_text("keep", encoding="utf-8")
    try:
        with pytest.raises(RuntimeError, match="Unexpected file"):
            cleanup_profile_socket(profile)
        assert path.read_text() == "keep"
    finally:
        path.unlink()


@pytest.mark.skipif(
    sys.platform != "linux" or ctypes.util.find_library("seccomp") is None,
    reason="Linux/libseccomp runtime required",
)
def test_sandbox_denies_credentials_other_workspace_files_and_ip_sockets(
    tmp_path: Path,
) -> None:
    staging = tmp_path / "staging"
    staging.mkdir()
    outside = tmp_path / "other-project.txt"
    outside.write_text("private fixture", encoding="utf-8")
    script = """
import socket, sys
from pathlib import Path
from tome_agent.agent.document_renderer import sandbox
staging, outside = map(Path, sys.argv[1:])
sandbox(staging, 384)
(staging / 'allowed.txt').write_text('test')
for target in (outside, Path('/proc/self/environ')):
    try: target.read_bytes()
    except PermissionError: pass
    else: raise AssertionError('outside read was allowed')
try: outside.write_text('changed')
except PermissionError: pass
else: raise AssertionError('outside write was allowed')
for family in (socket.AF_INET, socket.AF_INET6):
    try: socket.socket(family)
    except PermissionError: pass
    else: raise AssertionError('IP socket was allowed')
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(staging), str(outside)],
        env=os.environ.copy(),
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert outside.read_text() == "private fixture"
    assert (staging / "allowed.txt").read_text() == "test"
