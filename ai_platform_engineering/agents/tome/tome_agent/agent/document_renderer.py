"""Offline LibreOffice rendering with Landlock, seccomp, and resource limits.

The helper receives only a new staging directory, not credentials or arbitrary
commands. Fail closed when sandbox support is unavailable. No agent Bash.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import os
import platform
import resource
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

LANDLOCK_CREATE_RULESET = 444
LANDLOCK_ADD_RULE = 445
LANDLOCK_RESTRICT_SELF = 446
FS_READ = (1 << 0) | (1 << 2) | (1 << 3)  # EXECUTE, READ_FILE, READ_DIR
FS_ALL_ABI1 = (1 << 13) - 1
AV_SUFFIXES = (".mp4", ".mov", ".avi", ".wmv", ".m4a", ".mp3", ".wav", ".wma")


class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


def sandbox(staging: Path, memory_mib: int) -> None:
    if platform.machine() not in {"x86_64", "aarch64"}:
        raise RuntimeError("Unsupported renderer sandbox architecture")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0):  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), "Cannot enforce no-new-privileges")
    abi = libc.syscall(LANDLOCK_CREATE_RULESET, 0, 0, 1)
    if abi < 1:
        raise RuntimeError("Landlock filesystem isolation is unavailable")
    handled = (
        FS_ALL_ABI1 | ((1 << 13) if abi >= 2 else 0) | ((1 << 14) if abi >= 3 else 0)
    )
    if abi >= 5:
        handled |= 1 << 15  # IOCTL_DEV
    attribute = ctypes.c_uint64(handled)
    ruleset = libc.syscall(
        LANDLOCK_CREATE_RULESET, ctypes.byref(attribute), ctypes.sizeof(attribute), 0
    )
    if ruleset < 0:
        raise OSError(ctypes.get_errno(), "Cannot create renderer filesystem rules")
    try:
        for path, rights in [
            (Path("/usr"), FS_READ),
            (Path("/lib"), FS_READ),
            (Path("/lib64"), FS_READ),
            (Path("/etc/fonts"), FS_READ),
            (Path("/etc/libreoffice"), FS_READ),
            (Path("/etc/ld.so.cache"), 1 << 2),
            (Path("/etc/passwd"), 1 << 2),
            (Path("/etc/nsswitch.conf"), 1 << 2),
            (Path("/etc/group"), 1 << 2),
            (Path("/etc/localtime"), 1 << 2),
            (Path("/var/cache/fontconfig"), FS_READ),
            (Path("/proc/meminfo"), 1 << 2),
            (Path("/proc/cpuinfo"), 1 << 2),
            (Path("/proc/filesystems"), 1 << 2),
            (Path("/proc/mounts"), 1 << 2),
            (Path("/proc/stat"), 1 << 2),
            (Path("/proc/self/maps"), 1 << 2),
            (Path("/sys/devices/system/cpu/online"), 1 << 2),
            # LibreOffice's private, profile-hashed Unix IPC socket is always
            # created in /tmp. No ordinary file reads/writes are granted here.
            (Path("/tmp"), 1 << 9),
            (Path("/dev/null"), (1 << 1) | (1 << 2)),
            (Path("/dev/urandom"), 1 << 2),
            (Path("/dev/random"), 1 << 2),
            (staging, handled),
        ]:
            if not path.exists():
                continue
            descriptor = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                rule = PathRule(rights, descriptor)
                if libc.syscall(LANDLOCK_ADD_RULE, ruleset, 1, ctypes.byref(rule), 0):
                    raise OSError(
                        ctypes.get_errno(), "Cannot add renderer filesystem rule"
                    )
            finally:
                os.close(descriptor)
        if libc.syscall(LANDLOCK_RESTRICT_SELF, ruleset, 0):
            raise OSError(ctypes.get_errno(), "Cannot restrict renderer filesystem")
    finally:
        os.close(ruleset)
    # No IP/network sockets; Unix sockets needed for local Office IPC remain.
    seccomp = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.c_void_p,
    ]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int

    class Comparison(ctypes.Structure):
        _fields_ = [
            ("arg", ctypes.c_uint),
            ("op", ctypes.c_uint),
            ("value", ctypes.c_uint64),
            ("other", ctypes.c_uint64),
        ]

    context = seccomp.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("Cannot create renderer network filter")
    try:
        comparison = Comparison(0, 1, 1, 0)  # socket domain != AF_UNIX
        syscall = seccomp.seccomp_syscall_resolve_name(b"socket")
        if (
            syscall < 0
            or seccomp.seccomp_rule_add_array(
                context, 0x00050000 | errno.EPERM, syscall, 1, ctypes.byref(comparison)
            )
            or seccomp.seccomp_load(context)
        ):
            raise RuntimeError("Cannot enforce renderer network isolation")
    finally:
        seccomp.seccomp_release(context)
    # Office maps large shared libraries. Limit heap/anonymous allocations
    # separately from virtual address space; pod/container memory still caps RSS.
    resource.setrlimit(resource.RLIMIT_DATA, (memory_mib * 1_048_576,) * 2)
    resource.setrlimit(
        resource.RLIMIT_AS, (max(2_147_483_648, memory_mib * 2_097_152),) * 2
    )
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (536_870_912,) * 2)


def visual_copy(source: Path, target: Path) -> None:
    """Copy the ZIP incrementally without decompressing embedded recordings.

    External links and embedded AV are intentionally not followed/played.
    Removing them from the rendering copy avoids reading GB-sized media into
    Office memory. The original and extracted notes are never modified.
    """
    ElementTree.register_namespace(
        "", "http://schemas.openxmlformats.org/package/2006/relationships"
    )
    with (
        zipfile.ZipFile(source) as original,
        zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as output,
    ):
        if len(original.infolist()) > 10_000:
            raise ValueError("Too many presentation parts")
        total = 0
        for entry in original.infolist():
            if entry.filename.startswith(
                "ppt/media/"
            ) and entry.filename.lower().endswith(AV_SUFFIXES):
                continue
            total += entry.file_size
            if entry.file_size > 134_217_728 or total > 536_870_912:
                raise ValueError("Visual-only presentation exceeds rendering limits")
            if entry.filename.endswith(".rels"):
                if entry.file_size > 2_097_152:
                    raise ValueError("Presentation relationships exceed the XML limit")
                data = original.read(entry)
                if (
                    len(data) > 2_097_152
                    or b"<!DOCTYPE" in data.replace(b"\x00", b"").upper()
                    or b"<!ENTITY" in data.replace(b"\x00", b"").upper()
                ):
                    raise ValueError("Unsafe presentation relationships")
                root = ElementTree.fromstring(data)
                for rel in list(root):
                    if rel.get("TargetMode") == "External":
                        root.remove(rel)
                output.writestr(
                    entry,
                    ElementTree.tostring(root, encoding="utf-8", xml_declaration=True),
                )
            else:
                with (
                    original.open(entry) as incoming,
                    output.open(entry, "w") as outgoing,
                ):
                    shutil.copyfileobj(incoming, outgoing, 65_536)


def profile_socket(profile: Path) -> Path:
    # LibreOffice generateOfficePipeId hashes the profile URI as native UTF-16
    # and concatenates unpadded hex bytes. Only this fresh profile's socket is
    # eligible for cleanup, never a glob or another Office instance's socket.
    encoding = "utf-16le" if sys.byteorder == "little" else "utf-16be"
    digest = hashlib.md5(
        profile.resolve().as_uri().encode(encoding), usedforsecurity=False
    ).digest()
    return (
        Path("/tmp")
        / f"OSL_PIPE_{os.getuid()}_SingleOfficeIPC_{''.join(format(byte, 'x') for byte in digest)}"
    )


def cleanup_profile_socket(profile: Path) -> None:
    socket_path = profile_socket(profile)
    try:
        info = socket_path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError("Unexpected file at the new renderer profile's socket path")
    socket_path.unlink()


def render(source: Path, output: Path, memory_mib: int) -> None:
    staging = source.parent.resolve()
    if source.resolve().parent != staging or output.resolve().parent != staging:
        raise ValueError("Renderer inputs must be in one new staging directory")
    sanitized = staging / "visual-source.pptx"
    visual_copy(source, sanitized)
    profile = staging / "office-profile"
    profile.mkdir()
    (profile / "user").mkdir()
    (profile / "user/registrymodifications.xcu").write_text(
        '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
        '<item oor:path="/org.openoffice.Office.Common/Save/Document"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>'
    )
    # Credentials and application paths are deliberately absent from the child
    # environment. Landlock denies wiki/cache/home access outside this staging.
    environment = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "TMPDIR": str(staging),
        "XDG_CACHE_HOME": str(staging / "xdg-cache"),
        "XDG_CONFIG_HOME": str(staging / "xdg-config"),
        "SAL_USE_VCLPLUGIN": "svp",
    }
    command = [
        "/usr/lib/libreoffice/program/soffice.bin",
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        str(staging),
        str(sanitized),
    ]
    if profile_socket(profile).exists():
        raise RuntimeError("The new renderer profile's socket path already exists")
    try:
        for startup in range(2):
            result = subprocess.run(
                command,
                env=environment,
                cwd=staging,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=lambda: sandbox(staging, memory_mib),
            )
            cleanup_profile_socket(profile)
            if result.returncode == 81 and startup == 0:
                # Office's first-use profile initialization requests a restart.
                # This is confined to this new staging directory, not recovery
                # of a persisted ingest run or an existing Office profile.
                continue
            result.check_returncode()
            break
    finally:
        cleanup_profile_socket(profile)
    result = staging / "visual-source.pdf"
    if not result.is_file() or not result.stat().st_size:
        raise RuntimeError("The renderer did not produce a PDF")
    result.rename(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--memory-mib", type=int, default=384)
    args = parser.parse_args()
    if not 128 <= args.memory_mib <= 2048:
        parser.error("Renderer memory limit is out of range")
    render(args.source, args.output, args.memory_mib)
