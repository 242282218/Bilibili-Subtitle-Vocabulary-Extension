#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

try:
    import paramiko
except ImportError:  # pragma: no cover - optional until a remote action runs.
    paramiko = None

SCRIPT_DIR = Path(__file__).resolve().parent
EXTENSION_ROOT = SCRIPT_DIR.parent.parent
REPO_ROOT = EXTENSION_ROOT.parent
DEFAULT_REMOTE_ROOT = "/root/bilibili-vocab-extension"
DEFAULT_PHASE = "phase-0"
DEFAULT_TASK_CARD = "P0-TEST-BOOTSTRAP"
DEFAULT_EXTENSION_SUBDIR = "bilibili-vocab-extension"
REMOTE_SCRIPT_MAP = {
    "setup": "00-setup-remote-env.sh",
    "sync": "10-sync-workspace.sh",
    "fixture": "20-run-fixture-e2e.sh",
    "real-site": "30-run-real-site-smoke.sh",
    "long-run": "40-run-long-session.sh",
    "cleanup": "90-cleanup-remote.sh",
}


class RemoteExecutionError(RuntimeError):
    pass


@dataclass(frozen=True)
class RemoteConfig:
    host: str
    user: str
    port: int
    password: str | None
    ssh_key: str | None
    remote_root: str
    phase: str
    task_card: str
    extension_subdir: str
    commit_sha: str

    @property
    def extension_dir(self) -> str:
        return str(PurePosixPath(self.remote_root, self.extension_subdir))


def run_local(command: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(
        command,
        cwd=str(cwd or REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RemoteExecutionError(
            f"local command failed ({' '.join(command)}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def current_timestamp() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def shell_join(values: list[str]) -> str:
    return " ".join(shlex.quote(value) for value in values)


def collect_workspace_relpaths() -> list[str]:
    output = run_local(
        ["git", "ls-files", "--cached", "--modified", "--others", "--exclude-standard"],
        cwd=REPO_ROOT,
    )
    relpaths = []
    for raw_line in output.splitlines():
        relpath = raw_line.strip()
        if not relpath:
            continue
        absolute_path = REPO_ROOT / relpath
        if absolute_path.is_file():
            relpaths.append(relpath)
    return relpaths


def create_workspace_archive() -> Path:
    relpaths = collect_workspace_relpaths()
    temp_dir = Path(tempfile.mkdtemp(prefix="bili-vocab-remote-sync-"))
    archive_path = temp_dir / "workspace.tar.gz"

    with tarfile.open(archive_path, "w:gz") as archive:
        for relpath in relpaths:
            archive.add(REPO_ROOT / relpath, arcname=relpath, recursive=False)

    return archive_path


class RemoteSession:
    def __init__(self, config: RemoteConfig):
        if paramiko is None:
            raise RemoteExecutionError(
                "paramiko is required for remote execution; install it locally before running test-machine actions"
            )
        self.config = config
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.sftp = None

    def __enter__(self) -> "RemoteSession":
        connect_kwargs: dict[str, object] = {
            "hostname": self.config.host,
            "username": self.config.user,
            "port": self.config.port,
            "look_for_keys": self.config.password is None,
            "allow_agent": self.config.password is None,
            "timeout": 30,
        }
        if self.config.password:
            connect_kwargs["password"] = self.config.password
        if self.config.ssh_key:
            connect_kwargs["key_filename"] = self.config.ssh_key
            connect_kwargs["look_for_keys"] = False
            connect_kwargs["allow_agent"] = False

        self.client.connect(**connect_kwargs)
        self.sftp = self.client.open_sftp()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.sftp:
            self.sftp.close()
        self.client.close()

    def run(self, command: str, env: dict[str, str] | None = None, check: bool = True) -> tuple[int, str, str]:
        exports = ""
        if env:
            exports = " ".join(f"{key}={shlex.quote(value)}" for key, value in env.items())
        remote_command = command if not exports else f"{exports} {command}"
        stdin, stdout, stderr = self.client.exec_command(
            f"bash -lc {shlex.quote(remote_command)}",
            get_pty=False,
        )
        stdout_text = stdout.read().decode("utf-8", errors="replace")
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        if check and exit_code != 0:
            raise RemoteExecutionError(
                f"remote command failed ({command})\nstdout:\n{stdout_text}\nstderr:\n{stderr_text}"
            )
        return exit_code, stdout_text, stderr_text

    def put_file(self, local_path: Path, remote_path: str) -> None:
        remote_parent = str(PurePosixPath(remote_path).parent)
        self.run(f"mkdir -p {shlex.quote(remote_parent)}")
        assert self.sftp is not None
        self.sftp.put(str(local_path), remote_path)


def make_step_env(config: RemoteConfig, action: str, timestamp: str) -> dict[str, str]:
    log_dir = str(
        PurePosixPath(
            config.remote_root,
            "test-results",
            "test-machine",
            config.phase,
            config.task_card,
            f"{timestamp}-{action}",
        )
    )
    return {
        "TEST_MACHINE_REMOTE_ROOT": config.remote_root,
        "TEST_MACHINE_EXTENSION_DIR": config.extension_dir,
        "TEST_MACHINE_PHASE": config.phase,
        "TEST_MACHINE_TASK_CARD": config.task_card,
        "TEST_MACHINE_TIMESTAMP": timestamp,
        "TEST_MACHINE_LOG_DIR": log_dir,
        "TEST_MACHINE_COMMIT_SHA": config.commit_sha,
        "TEST_MACHINE_BLOCKS_PHASE": "yes",
    }


def upload_standalone_script(session: RemoteSession, action: str) -> str:
    script_name = REMOTE_SCRIPT_MAP[action]
    local_path = SCRIPT_DIR / script_name
    remote_path = str(PurePosixPath(session.config.remote_root, "tmp", "bootstrap", script_name))
    session.put_file(local_path, remote_path)
    return remote_path


def run_standalone_action(session: RemoteSession, config: RemoteConfig, action: str, extra_args: list[str] | None = None) -> str:
    timestamp = current_timestamp()
    env = make_step_env(config, action, timestamp)
    remote_script = upload_standalone_script(session, action)
    command = ["bash", remote_script]
    if extra_args:
        command.extend(extra_args)
    try:
        session.run(shell_join(command), env=env)
    except RemoteExecutionError as exc:
        raise RemoteExecutionError(f"{exc}\nlog_dir={env['TEST_MACHINE_LOG_DIR']}") from exc
    return env["TEST_MACHINE_LOG_DIR"]


def run_sync_action(session: RemoteSession, config: RemoteConfig) -> str:
    archive_path = create_workspace_archive()
    remote_archive = str(PurePosixPath(config.remote_root, "tmp", f"workspace-{current_timestamp()}.tar.gz"))

    try:
        session.put_file(archive_path, remote_archive)
        return run_standalone_action(session, config, "sync", [remote_archive])
    finally:
        archive_path.unlink(missing_ok=True)
        archive_path.parent.rmdir()


def run_pipeline_action(session: RemoteSession, config: RemoteConfig, action: str) -> list[tuple[str, str]]:
    log_dirs: list[tuple[str, str]] = []
    setup_log_dir = run_standalone_action(session, config, "setup")
    log_dirs.append(("setup", setup_log_dir))
    sync_log_dir = run_sync_action(session, config)
    log_dirs.append(("sync", sync_log_dir))

    target_timestamp = current_timestamp()
    target_env = make_step_env(config, action, target_timestamp)
    remote_target = str(PurePosixPath(config.extension_dir, "scripts", "test", REMOTE_SCRIPT_MAP[action]))
    try:
        session.run(shell_join(["bash", remote_target]), env=target_env)
        log_dirs.append((action, target_env["TEST_MACHINE_LOG_DIR"]))
    except RemoteExecutionError as exc:
        raise RemoteExecutionError(f"{exc}\nlog_dir={target_env['TEST_MACHINE_LOG_DIR']}") from exc
    finally:
        cleanup_log_dir = run_standalone_action(session, config, "cleanup")
        log_dirs.append(("cleanup", cleanup_log_dir))

    return log_dirs


def build_config(args: argparse.Namespace) -> RemoteConfig:
    host = args.host or os.environ.get("TEST_MACHINE_HOST")
    user = args.user or os.environ.get("TEST_MACHINE_USER")
    port = int(args.port or os.environ.get("TEST_MACHINE_PORT", "22"))
    password = os.environ.get("TEST_MACHINE_PASSWORD")
    ssh_key = args.ssh_key or os.environ.get("TEST_MACHINE_SSH_KEY")

    if not host or not user:
        raise RemoteExecutionError(
            "missing TEST_MACHINE_HOST or TEST_MACHINE_USER; connection details should come from AGENTS.md-backed env vars"
        )
    if password and ssh_key:
        raise RemoteExecutionError("set either TEST_MACHINE_PASSWORD or TEST_MACHINE_SSH_KEY, not both")

    commit_sha = run_local(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT)
    return RemoteConfig(
        host=host,
        user=user,
        port=port,
        password=password,
        ssh_key=ssh_key,
        remote_root=args.remote_root or os.environ.get("TEST_MACHINE_REMOTE_ROOT", DEFAULT_REMOTE_ROOT),
        phase=args.phase or os.environ.get("TEST_MACHINE_PHASE", DEFAULT_PHASE),
        task_card=args.task_card or os.environ.get("TEST_MACHINE_TASK_CARD", DEFAULT_TASK_CARD),
        extension_subdir=DEFAULT_EXTENSION_SUBDIR,
        commit_sha=commit_sha,
    )


def describe_runner() -> dict[str, object]:
    return {
        "actions": list(REMOTE_SCRIPT_MAP.keys()),
        "remote_scripts": REMOTE_SCRIPT_MAP,
        "repo_root": str(REPO_ROOT),
        "extension_root": str(EXTENSION_ROOT),
        "defaults": {
            "remote_root": DEFAULT_REMOTE_ROOT,
            "phase": DEFAULT_PHASE,
            "task_card": DEFAULT_TASK_CARD,
            "extension_subdir": DEFAULT_EXTENSION_SUBDIR,
        },
        "required_env": ["TEST_MACHINE_HOST", "TEST_MACHINE_USER"],
        "auth_env": ["TEST_MACHINE_PASSWORD", "TEST_MACHINE_SSH_KEY"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run remote test-machine phases for the extension repository."
    )
    parser.add_argument(
        "action",
        nargs="?",
        choices=list(REMOTE_SCRIPT_MAP.keys()),
        help="Remote action to run.",
    )
    parser.add_argument("--host", help="Remote host override.")
    parser.add_argument("--user", help="Remote user override.")
    parser.add_argument("--port", type=int, help="Remote SSH port override.")
    parser.add_argument("--ssh-key", help="SSH key path override.")
    parser.add_argument("--remote-root", help="Remote workspace root override.")
    parser.add_argument("--phase", help="Phase name override.")
    parser.add_argument("--task-card", help="Task card override.")
    parser.add_argument(
        "--describe",
        action="store_true",
        help="Print runner metadata without opening a remote connection.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.describe:
        print(json.dumps(describe_runner(), indent=2, ensure_ascii=False))
        return 0

    if not args.action:
        raise RemoteExecutionError("action is required unless --describe is used")

    config = build_config(args)
    with RemoteSession(config) as session:
        if args.action in {"setup", "cleanup"}:
            log_dir = run_standalone_action(session, config, args.action)
            print(f"{args.action}: PASS")
            print(f"log_dir={log_dir}")
            return 0
        if args.action == "sync":
            log_dir = run_sync_action(session, config)
            print("sync: PASS")
            print(f"log_dir={log_dir}")
            return 0

        log_dirs = run_pipeline_action(session, config, args.action)
        print(f"{args.action}: PASS")
        for step_name, log_dir in log_dirs:
            print(f"{step_name}_log_dir={log_dir}")
        return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RemoteExecutionError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
