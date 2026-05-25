const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const SCRIPT_ROOT = path.join(PROJECT_ROOT, 'scripts', 'test');
const RUNNER_PATH = path.join(SCRIPT_ROOT, 'remote-test-machine.py');
const REMOTE_SMOKE_ENV_HELPER = 'remote-smoke-env.sh';
const EXPECTED_REMOTE_SCRIPTS = [
  '00-setup-remote-env.sh',
  '10-sync-workspace.sh',
  '20-run-fixture-e2e.sh',
  '30-run-real-site-smoke.sh',
  '40-run-long-session.sh',
  '90-cleanup-remote.sh',
];
const EXPECTED_REMOTE_TEST_FILES = [
  ...EXPECTED_REMOTE_SCRIPTS,
  'remote-smoke-env.sh',
  'remote-test-machine.py',
].sort();
const EXPECTED_SHELL_PNPM_RUN_REFERENCES = [
  { fileName: '20-run-fixture-e2e.sh', reference: 'test:extension-smoke' },
  { fileName: '30-run-real-site-smoke.sh', reference: 'test:real-site-smoke' },
];
const EXPECTED_REMOTE_SYNC_UNTRACKED_ROOT_SUFFIXES = [
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
];
const EXPECTED_REMOTE_SYNC_UNTRACKED_PREFIX_RULES = [
  { prefix: '.github/workflows/', suffixes: ['.yaml', '.yml'] },
  { prefix: 'bilibili-vocab-extension/config/', suffixes: ['.json'] },
  { prefix: 'bilibili-vocab-extension/data/', suffixes: ['.json'] },
  { prefix: 'bilibili-vocab-extension/react-ui/', suffixes: ['.css', '.html', '.ts', '.tsx'] },
  { prefix: 'bilibili-vocab-extension/scripts/', suffixes: ['.cjs', '.js', '.mjs', '.py', '.sh'] },
  { prefix: 'bilibili-vocab-extension/tests/', suffixes: ['.cjs', '.js', '.mjs'] },
];

function readPackageScripts() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.scripts || {};
}

function readScript(fileName) {
  return fs.readFileSync(path.join(SCRIPT_ROOT, fileName), 'utf8');
}

function normalizeScript(script) {
  return String(script || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractShellPnpmRunReferences(scriptContent) {
  return [...scriptContent.matchAll(/(?:^|\n)\s*pnpm\s+run\s+([^\s;&|]+)/g)].map(
    (match) => match[1]
  );
}

function readRunnerInvalidCliPortProbe() {
  try {
    execFileSync(
      'python',
      [RUNNER_PATH, 'setup', '--host', 'example.test', '--user', 'root', '--port', 'not-a-port'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  } catch (error) {
    return {
      status: error.status,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
  throw new Error('remote runner should reject an invalid CLI port');
}

function readRunnerProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

print(json.dumps({
    "excluded": sorted(module.REMOTE_SYNC_EXCLUDED_RELPATHS),
    "workspace_relpaths": module.collect_workspace_relpaths(),
    "include_remote_helper": module.should_include_workspace_relpath("bilibili-vocab-extension/scripts/test/remote-smoke-env.sh"),
    "include_package_gate": module.should_include_workspace_relpath("bilibili-vocab-extension/scripts/check-extension-package.js"),
    "include_package_gate_test": module.should_include_workspace_relpath("bilibili-vocab-extension/tests/check-extension-package.test.js"),
    "include_test_out": module.should_include_workspace_relpath("bilibili-vocab-extension/test-out.txt"),
    "include_test_output": module.should_include_workspace_relpath("bilibili-vocab-extension/test-output.txt"),
    "include_tracked_data": module.should_include_workspace_relpath("bilibili-vocab-extension/data/cet4.json", "tracked"),
    "include_tracked_source": module.should_include_workspace_relpath("bilibili-vocab-extension/sources/ecdict.csv", "tracked"),
    "include_untracked_script": module.should_include_workspace_relpath("bilibili-vocab-extension/scripts/new-helper.js", "untracked"),
    "include_untracked_test": module.should_include_workspace_relpath("bilibili-vocab-extension/tests/new-helper.test.js", "untracked"),
    "include_untracked_root_code": module.should_include_workspace_relpath("bilibili-vocab-extension/new-entry.js", "untracked"),
    "include_untracked_root_text": module.should_include_workspace_relpath("bilibili-vocab-extension/manual-output.txt", "untracked"),
    "include_untracked_docs": module.should_include_workspace_relpath("docs/scratch.md", "untracked"),
}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerArchiveCreationFailureProbe() {
  const probe = `
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

outer_dir = Path(tempfile.mkdtemp(prefix="remote-archive-failure-probe-"))
temp_dir = outer_dir / "workspace-temp"
result = {}

def fake_mkdtemp(prefix):
    temp_dir.mkdir()
    return str(temp_dir)

module.REPO_ROOT = outer_dir
module.tempfile.mkdtemp = fake_mkdtemp
module.collect_workspace_relpaths = lambda: ["missing-file.txt"]

try:
    module.create_workspace_archive()
except module.RemoteExecutionError as exc:
    result = {
        "error": str(exc),
        "temp_dir_exists": temp_dir.exists(),
        "type": type(exc).__name__,
    }
finally:
    shutil.rmtree(outer_dir, ignore_errors=True)

print(json.dumps(result))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerLocalCommandExecutionExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

def fake_run(*args, **kwargs):
    raise OSError("spawn failed")

module.subprocess.run = fake_run

try:
    module.run_local(["git", "status"])
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerConfigProbe() {
  const probe = `
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

ENV_KEYS = [
    "TEST_MACHINE_HOST",
    "TEST_MACHINE_USER",
    "TEST_MACHINE_PORT",
    "TEST_MACHINE_PASSWORD",
    "TEST_MACHINE_SSH_KEY",
    "TEST_MACHINE_REMOTE_ROOT",
    "TEST_MACHINE_PHASE",
    "TEST_MACHINE_TASK_CARD",
]

def reset_env():
    for key in ENV_KEYS:
        os.environ.pop(key, None)

def make_args(**overrides):
    values = {
        "host": None,
        "user": None,
        "port": None,
        "ssh_key": None,
        "remote_root": None,
        "phase": None,
        "task_card": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)

result = {}

reset_env()
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["missing_config_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_PASSWORD"] = "secret"
os.environ["TEST_MACHINE_SSH_KEY"] = "/tmp/test-machine-key"
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["auth_conflict_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_PORT"] = "not-a-port"
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["invalid_env_port_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
try:
    module.build_config(make_args(port=0))
except module.RemoteExecutionError as exc:
    result["invalid_cli_port_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_REMOTE_ROOT"] = "/"
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["invalid_env_remote_root_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
try:
    module.build_config(make_args(remote_root="relative/root"))
except module.RemoteExecutionError as exc:
    result["invalid_cli_remote_root_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
try:
    module.build_config(make_args(remote_root="/tmp/../bili"))
except module.RemoteExecutionError as exc:
    result["invalid_parent_remote_root_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_PHASE"] = "../phase-x"
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["invalid_env_phase_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_PHASE"] = "./phase-x"
try:
    module.build_config(make_args())
except module.RemoteExecutionError as exc:
    result["invalid_env_relative_phase_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
try:
    module.build_config(make_args(task_card="CARD/1"))
except module.RemoteExecutionError as exc:
    result["invalid_cli_task_card_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
try:
    module.build_config(make_args(task_card="CARD-1/"))
except module.RemoteExecutionError as exc:
    result["invalid_cli_trailing_task_card_error"] = str(exc)

reset_env()
os.environ["TEST_MACHINE_HOST"] = "example.test"
os.environ["TEST_MACHINE_USER"] = "root"
os.environ["TEST_MACHINE_PORT"] = "2202"
os.environ["TEST_MACHINE_PASSWORD"] = "secret"
config = module.build_config(
    make_args(remote_root="/tmp/bili-remote", phase="phase-x", task_card="CARD-1")
)
result["config"] = {
    "host": config.host,
    "user": config.user,
    "port": config.port,
    "password": config.password,
    "ssh_key": config.ssh_key,
    "remote_root": config.remote_root,
    "phase": config.phase,
    "task_card": config.task_card,
    "extension_subdir": config.extension_subdir,
    "extension_dir": config.extension_dir,
    "commit_sha_length": len(config.commit_sha),
}

print(json.dumps(result))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionRunExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class FakeClient:
    def exec_command(self, command, get_pty=False):
        raise OSError("ssh channel failed")

session = object.__new__(module.RemoteSession)
session.client = FakeClient()

try:
    session.run("echo ok")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionPutFileClosedProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

result = {"run_called": False}

def fail_if_called(command):
    result["run_called"] = True

session = object.__new__(module.RemoteSession)
session.sftp = None
session.run = fail_if_called

try:
    session.put_file(Path("local.tar.gz"), "/remote/workspace.tar.gz")
except module.RemoteExecutionError as exc:
    result["error"] = str(exc)
    result["type"] = type(exc).__name__

print(json.dumps(result))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionPutFileExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class FakeSftp:
    def put(self, local_path, remote_path):
        raise OSError("scp failed")

session = object.__new__(module.RemoteSession)
session.sftp = FakeSftp()
session.run = lambda command: None

try:
    session.put_file(Path("local.tar.gz"), "/remote/workspace.tar.gz")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionConnectExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys

from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=2222,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeClient:
    def __init__(self):
        self.close_called = False
        self.open_sftp_called = False

    def connect(self, **kwargs):
        raise OSError("network down")

    def open_sftp(self):
        self.open_sftp_called = True
        raise AssertionError("open_sftp should not be called")

    def close(self):
        self.close_called = True

client = FakeClient()
session = object.__new__(module.RemoteSession)
session.config = config
session.client = client
session.sftp = None

try:
    session.__enter__()
except module.RemoteExecutionError as exc:
    print(json.dumps({
        "close_called": client.close_called,
        "error": str(exc),
        "open_sftp_called": client.open_sftp_called,
        "type": type(exc).__name__,
    }))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionOpenSftpExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys

from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=2222,
    password=None,
    ssh_key="/tmp/key",
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeClient:
    def __init__(self):
        self.close_called = False
        self.connect_kwargs = None

    def connect(self, **kwargs):
        self.connect_kwargs = kwargs

    def open_sftp(self):
        raise OSError("sftp refused")

    def close(self):
        self.close_called = True

client = FakeClient()
session = object.__new__(module.RemoteSession)
session.config = config
session.client = client
session.sftp = None

try:
    session.__enter__()
except module.RemoteExecutionError as exc:
    print(json.dumps({
        "allow_agent": client.connect_kwargs["allow_agent"],
        "close_called": client.close_called,
        "error": str(exc),
        "key_filename": client.connect_kwargs["key_filename"],
        "look_for_keys": client.connect_kwargs["look_for_keys"],
        "type": type(exc).__name__,
    }))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionCloseExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys

from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class FakeSftp:
    def __init__(self):
        self.close_called = False

    def close(self):
        self.close_called = True
        raise OSError("sftp close refused")

class FakeClient:
    def __init__(self):
        self.close_called = False

    def close(self):
        self.close_called = True
        raise OSError("ssh close refused")

sftp = FakeSftp()
client = FakeClient()
session = object.__new__(module.RemoteSession)
session.sftp = sftp
session.client = client

try:
    session.__exit__(None, None, None)
except module.RemoteExecutionError as exc:
    print(json.dumps({
        "client_close_called": client.close_called,
        "error": str(exc),
        "sftp_close_called": sftp.close_called,
        "type": type(exc).__name__,
    }))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerRemoteSessionCloseAfterPrimaryExceptionProbe() {
  const probe = `
import contextlib
import importlib.util
import io
import json
import sys

from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class FakeSftp:
    def close(self):
        raise OSError("sftp close refused")

class FakeClient:
    def close(self):
        raise OSError("ssh close refused")

session = object.__new__(module.RemoteSession)
session.sftp = FakeSftp()
session.client = FakeClient()

stderr = io.StringIO()
with contextlib.redirect_stderr(stderr):
    result = session.__exit__(module.RemoteExecutionError, module.RemoteExecutionError("primary failed"), None)

print(json.dumps({
    "result_is_none": result is None,
    "stderr": stderr.getvalue().strip(),
}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeSession:
    def __init__(self, config):
        self.config = config

    def run(self, command, env=None, check=True):
        raise module.RemoteExecutionError("target failed")

module.current_timestamp = lambda: "20260525T000000Z"
module.run_sync_action = lambda session, config: "/logs/sync"

def fake_standalone_action(session, config, action, extra_args=None):
    if action == "setup":
        return "/logs/setup"
    if action == "cleanup":
        raise module.RemoteExecutionError("cleanup failed")
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(config), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc)}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineOrdinaryFailureCleanupFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)
calls = []

class FakeSession:
    pass

def fake_sync_action(session, config):
    calls.append("sync")
    raise OSError("sync crashed")

def fake_standalone_action(session, config, action, extra_args=None):
    calls.append(action)
    if action == "setup":
        return "/logs/setup"
    if action == "cleanup":
        raise module.RemoteExecutionError("cleanup failed")
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_sync_action = fake_sync_action
module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"calls": calls, "error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineOrdinaryCleanupAfterTargetFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeSession:
    def __init__(self, config):
        self.config = config

    def run(self, command, env=None, check=True):
        raise module.RemoteExecutionError("target failed")

module.current_timestamp = lambda: "20260525T000000Z"
module.run_sync_action = lambda session, config: "/logs/sync"

def fake_standalone_action(session, config, action, extra_args=None):
    if action == "setup":
        return "/logs/setup"
    if action == "cleanup":
        raise OSError("cleanup crashed")
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(config), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineOrdinaryCleanupOnlyFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)
calls = []

class FakeSession:
    def __init__(self, config):
        self.config = config

    def run(self, command, env=None, check=True):
        calls.append("target")

def fake_sync_action(session, config):
    calls.append("sync")
    return "/logs/sync"

def fake_standalone_action(session, config, action, extra_args=None):
    calls.append(action)
    if action == "setup":
        return "/logs/setup"
    if action == "cleanup":
        raise OSError("cleanup crashed")
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_sync_action = fake_sync_action
module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(config), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"calls": calls, "error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerSyncCleanupFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeArchiveParent:
    def rmdir(self):
        raise OSError("local temp dir busy")

class FakeArchivePath:
    parent = FakeArchiveParent()

    def unlink(self, missing_ok=False):
        return None

class FakeSession:
    def put_file(self, local_path, remote_path):
        raise module.RemoteExecutionError("upload failed")

module.current_timestamp = lambda: "20260525T000000Z"
module.create_workspace_archive = lambda: FakeArchivePath()

try:
    module.run_sync_action(FakeSession(), config)
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc)}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerSyncUploadExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeArchiveParent:
    def rmdir(self):
        return None

class FakeArchivePath:
    parent = FakeArchiveParent()

    def unlink(self, missing_ok=False):
        return None

class FakeSession:
    def put_file(self, local_path, remote_path):
        raise OSError("socket reset")

module.current_timestamp = lambda: "20260525T000000Z"
module.create_workspace_archive = lambda: FakeArchivePath()

try:
    module.run_sync_action(FakeSession(), config)
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerSyncOrdinaryFailureCleanupFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeArchiveParent:
    def rmdir(self):
        raise OSError("local temp dir busy")

class FakeArchivePath:
    parent = FakeArchiveParent()

    def unlink(self, missing_ok=False):
        return None

class FakeSession:
    def put_file(self, local_path, remote_path):
        return None

module.current_timestamp = lambda: "20260525T000000Z"
module.create_workspace_archive = lambda: FakeArchivePath()

def fake_standalone_action(session, config, action, extra_args=None):
    raise OSError("sync crashed")

module.run_standalone_action = fake_standalone_action

try:
    module.run_sync_action(FakeSession(), config)
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerStandaloneUploadExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeSession:
    def __init__(self, config):
        self.config = config

    def put_file(self, local_path, remote_path):
        raise OSError("scp failed")

try:
    module.upload_standalone_script(FakeSession(config), "setup")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerStandaloneRunExceptionProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeSession:
    def __init__(self, config):
        self.config = config

    def put_file(self, local_path, remote_path):
        return None

    def run(self, command, env=None, check=True):
        raise OSError("exec channel closed")

module.current_timestamp = lambda: "20260525T000000Z"

try:
    module.run_standalone_action(FakeSession(config), config, "setup")
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc), "type": type(exc).__name__}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineSyncFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)
calls = []

class FakeSession:
    pass

module.current_timestamp = lambda: "20260525T000000Z"

def fake_sync_action(session, config):
    calls.append("sync")
    raise module.RemoteExecutionError("sync failed")

def fake_standalone_action(session, config, action, extra_args=None):
    calls.append(action)
    if action == "setup":
        return "/logs/setup"
    if action == "cleanup":
        return "/logs/cleanup"
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_sync_action = fake_sync_action
module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"calls": calls, "error": str(exc)}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerPipelineSetupFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)
calls = []

class FakeSession:
    pass

def fake_sync_action(session, config):
    calls.append("sync")
    raise AssertionError("sync should not run after setup failure")

def fake_standalone_action(session, config, action, extra_args=None):
    calls.append(action)
    if action == "setup":
        raise module.RemoteExecutionError("setup failed")
    if action == "cleanup":
        return "/logs/cleanup"
    raise AssertionError(f"unexpected standalone action: {action}")

module.run_sync_action = fake_sync_action
module.run_standalone_action = fake_standalone_action

try:
    module.run_pipeline_action(FakeSession(), config, "fixture")
except module.RemoteExecutionError as exc:
    print(json.dumps({"calls": calls, "error": str(exc)}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function readRunnerSyncLocalCleanupOnlyFailureProbe() {
  const probe = `
import importlib.util
import json
import sys
from pathlib import Path

runner_path = Path(${JSON.stringify(RUNNER_PATH)}).resolve()
spec = importlib.util.spec_from_file_location("remote_test_machine", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

config = module.RemoteConfig(
    host="example.test",
    user="root",
    port=22,
    password="secret",
    ssh_key=None,
    remote_root="/remote",
    phase="phase-x",
    task_card="CARD-1",
    extension_subdir="bilibili-vocab-extension",
    commit_sha="0" * 40,
)

class FakeArchiveParent:
    def rmdir(self):
        raise OSError("local temp dir busy")

class FakeArchivePath:
    parent = FakeArchiveParent()

    def unlink(self, missing_ok=False):
        return None

class FakeSession:
    def put_file(self, local_path, remote_path):
        return None

module.current_timestamp = lambda: "20260525T000000Z"
module.create_workspace_archive = lambda: FakeArchivePath()
module.run_standalone_action = lambda session, config, action, extra_args=None: "/logs/sync"

try:
    module.run_sync_action(FakeSession(), config)
except module.RemoteExecutionError as exc:
    print(json.dumps({"error": str(exc)}))
`;
  return JSON.parse(execFileSync('python', ['-c', probe], { encoding: 'utf8' }));
}

function checkIgnoredByGit(relativePath) {
  return execFileSync('git', ['check-ignore', '--', relativePath], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  }).trim();
}

test('remote test entry contract: package should expose remote test-machine commands', () => {
  const scripts = readPackageScripts();

  assert.equal(
    normalizeScript(scripts['test:remote:setup']),
    'python scripts/test/remote-test-machine.py setup'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:sync']),
    'python scripts/test/remote-test-machine.py sync'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:cleanup']),
    'python scripts/test/remote-test-machine.py cleanup'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:fixture']),
    'python scripts/test/remote-test-machine.py fixture'
  );
  assert.equal(
    normalizeScript(scripts['test:remote:real-site']),
    'python scripts/test/remote-test-machine.py real-site'
  );
  assert.equal(Object.hasOwn(scripts, 'test:remote:long-run'), false);
});

test('remote test entry contract: scripts/test should include the phase-0 baseline scripts', () => {
  const scriptNames = fs
    .readdirSync(SCRIPT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(scriptNames, EXPECTED_REMOTE_TEST_FILES);
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    assert.equal(scriptNames.includes(fileName), true, `${fileName} should exist`);
  });
  assert.equal(scriptNames.includes(REMOTE_SMOKE_ENV_HELPER), true);
  assert.equal(fs.existsSync(RUNNER_PATH), true);
});

test('remote test entry contract: shell scripts should log required artifacts and run in strict bash mode', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    assert.match(content, /^#!\/usr\/bin\/env bash/m);
    assert.match(content, /set -Eeuo pipefail/);
    assert.match(content, /command\.txt/);
    assert.match(content, /stdout\.log/);
    assert.match(content, /stderr\.log/);
    assert.match(content, /summary\.txt/);
    assert.match(content, /status=PASS|status=%s/);
  });
});

test('remote test entry contract: shell scripts should normalize remote root before deriving log dir', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const rootGuardIndex = content.indexOf('if [ "$REMOTE_ROOT" != "/" ]; then');
    const normalizationIndex = content.indexOf('REMOTE_ROOT="${REMOTE_ROOT%/}"');
    const logDirIndex = content.indexOf(
      'LOG_DIR="${TEST_MACHINE_LOG_DIR:-$REMOTE_ROOT/test-results/test-machine'
    );

    assert.notEqual(rootGuardIndex, -1, `${fileName} should keep slash root unchanged`);
    assert.notEqual(normalizationIndex, -1, `${fileName} should normalize remote root`);
    assert.notEqual(logDirIndex, -1, `${fileName} should derive LOG_DIR from REMOTE_ROOT`);
    assert.equal(rootGuardIndex < normalizationIndex, true);
    assert.equal(normalizationIndex < logDirIndex, true);
  });
});

test('remote test entry contract: shell scripts should validate log dir before writing logs', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const validationIndex = content.indexOf('invalid TEST_MACHINE_LOG_DIR');
    const logDirWriteIndex = content.indexOf('mkdir -p "$LOG_DIR"');

    assert.notEqual(validationIndex, -1, `${fileName} should validate TEST_MACHINE_LOG_DIR`);
    assert.notEqual(logDirWriteIndex, -1, `${fileName} should create LOG_DIR explicitly`);
    assert.equal(
      validationIndex < logDirWriteIndex,
      true,
      `${fileName} should validate before mkdir`
    );
    assert.match(
      content,
      /expected_log_dir="\$remote_root_base\/test-results\/test-machine\/\$PHASE\/\$TASK_CARD\/\$TIMESTAMP"/
    );
    assert.match(content, /log_dir_suffix="\$\{LOG_DIR#"\$expected_log_dir"\}"/);
    assert.match(content, /\[\[ "\$LOG_DIR" != \/\* \]\]/);
    assert.match(content, /\[\[ "\$LOG_DIR" == \*"\/\.\.\/"\* \]\]/);
    assert.match(content, /\[\[ "\$LOG_DIR" != "\$expected_log_dir"\* \]\]/);
    assert.match(content, /\[\[ "\$log_dir_suffix" != -\* \]\]/);
    assert.match(content, /\[\[ "\$log_dir_suffix" == \*\/\* \]\]/);
  });
});

test('remote test entry contract: shell scripts should validate remote root before writing logs', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const remoteRootCallIndex = content.indexOf('\nvalidate_remote_root\n');
    const logDirWriteIndex = content.indexOf('mkdir -p "$LOG_DIR"');

    assert.notEqual(remoteRootCallIndex, -1, `${fileName} should validate REMOTE_ROOT`);
    assert.notEqual(logDirWriteIndex, -1, `${fileName} should create LOG_DIR explicitly`);
    assert.equal(
      remoteRootCallIndex < logDirWriteIndex,
      true,
      `${fileName} should validate REMOTE_ROOT before mkdir`
    );
    assert.match(content, /invalid TEST_MACHINE_REMOTE_ROOT/);
    assert.match(content, /\[\[ "\$REMOTE_ROOT" != \/\* \]\]/);
    assert.match(content, /\[\[ "\$REMOTE_ROOT" == \*"\/\.\.\/"\* \]\]/);
  });
});

test('remote test entry contract: shell scripts should validate log path segments', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const phaseValidationIndex = content.indexOf(
      'validate_log_path_segment "TEST_MACHINE_PHASE" "$PHASE"'
    );
    const taskCardValidationIndex = content.indexOf(
      'validate_log_path_segment "TEST_MACHINE_TASK_CARD" "$TASK_CARD"'
    );
    const timestampValidationIndex = content.indexOf(
      'validate_log_path_segment "TEST_MACHINE_TIMESTAMP" "$TIMESTAMP"'
    );
    const logDirValidationIndex = content.indexOf('\nvalidate_log_dir\n');
    const logDirWriteIndex = content.indexOf('mkdir -p "$LOG_DIR"');

    assert.notEqual(phaseValidationIndex, -1, `${fileName} should validate PHASE`);
    assert.notEqual(taskCardValidationIndex, -1, `${fileName} should validate TASK_CARD`);
    assert.notEqual(timestampValidationIndex, -1, `${fileName} should validate TIMESTAMP`);
    assert.notEqual(logDirValidationIndex, -1, `${fileName} should validate LOG_DIR`);
    assert.notEqual(logDirWriteIndex, -1, `${fileName} should create LOG_DIR explicitly`);
    assert.equal(phaseValidationIndex < logDirValidationIndex, true);
    assert.equal(taskCardValidationIndex < logDirValidationIndex, true);
    assert.equal(timestampValidationIndex < logDirValidationIndex, true);
    assert.equal(logDirValidationIndex < logDirWriteIndex, true);
    assert.match(content, /validate_log_path_segment\(\)/);
    assert.match(content, /invalid \$field_name: \$value/);
    assert.match(content, /\[\[ "\$value" == \*\/\* \]\]/);
    assert.match(content, /\[ "\$value" = "\." \]/);
    assert.match(content, /\[ "\$value" = "\.\." \]/);
  });
});

test('remote test entry contract: shell scripts should validate summary fields before writing logs', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const summaryValidationIndex = content.indexOf('\nvalidate_summary_fields\n');
    const logDirWriteIndex = content.indexOf('mkdir -p "$LOG_DIR"');
    const commitWriteIndex = content.indexOf('printf \'commit_sha=%s\\n\' "$COMMIT_SHA"');
    const blocksPhaseWriteIndex = content.indexOf('printf \'blocks_phase=%s\\n\' "$BLOCKS_PHASE"');

    assert.notEqual(summaryValidationIndex, -1, `${fileName} should validate summary fields`);
    assert.notEqual(logDirWriteIndex, -1, `${fileName} should create LOG_DIR explicitly`);
    assert.notEqual(commitWriteIndex, -1, `${fileName} should write commit SHA`);
    assert.notEqual(blocksPhaseWriteIndex, -1, `${fileName} should write blocks_phase`);
    assert.equal(summaryValidationIndex < logDirWriteIndex, true);
    assert.equal(summaryValidationIndex < commitWriteIndex, true);
    assert.equal(summaryValidationIndex < blocksPhaseWriteIndex, true);
    assert.match(content, /validate_summary_fields\(\)/);
    assert.match(content, /invalid TEST_MACHINE_COMMIT_SHA/);
    assert.match(content, /\[\[ ! "\$COMMIT_SHA" =~ \^\[0-9a-fA-F\]\{40\}\$ \]\]/);
    assert.match(content, /invalid TEST_MACHINE_BLOCKS_PHASE/);
    assert.match(content, /\[ "\$BLOCKS_PHASE" != "yes" \] && \[ "\$BLOCKS_PHASE" != "no" \]/);
  });
});

test('remote test entry contract: shell scripts should keep failure summary values single-line', () => {
  EXPECTED_REMOTE_SCRIPTS.forEach((fileName) => {
    const content = readScript(fileName);
    const formatterIndex = content.indexOf('format_summary_value()');
    const failureWriteIndex = content.indexOf(
      'printf \'failure_root_cause=%s\\n\' "$(format_summary_value "$failure_reason")"'
    );
    const rawFailureWriteIndex = content.indexOf(
      'printf \'failure_root_cause=%s\\n\' "$failure_reason"'
    );

    assert.notEqual(formatterIndex, -1, `${fileName} should define summary formatter`);
    assert.notEqual(failureWriteIndex, -1, `${fileName} should format failure summary`);
    assert.equal(rawFailureWriteIndex, -1, `${fileName} should not write raw failure reason`);
    assert.equal(formatterIndex < failureWriteIndex, true);
    assert.match(content, /value="\$\{value\/\/\$'\\r'\/ \}"/);
    assert.match(content, /value="\$\{value\/\/\$'\\n'\/ \}"/);
  });
});

test('remote test entry contract: destructive shell scripts should validate remote root first', () => {
  const syncContent = readScript('10-sync-workspace.sh');
  const cleanupContent = readScript('90-cleanup-remote.sh');
  const syncValidationIndex = syncContent.indexOf('invalid TEST_MACHINE_REMOTE_ROOT');
  const syncLogDirIndex = syncContent.indexOf('mkdir -p "$LOG_DIR"');
  const syncDeleteIndex = syncContent.indexOf('find "$REMOTE_ROOT"');
  const cleanupValidationIndex = cleanupContent.indexOf('invalid TEST_MACHINE_REMOTE_ROOT');
  const cleanupLogDirIndex = cleanupContent.indexOf('mkdir -p "$LOG_DIR"');
  const cleanupDeleteIndex = cleanupContent.indexOf('rm -rf "$REMOTE_ROOT/tmp"/*');

  assert.notEqual(syncValidationIndex, -1);
  assert.notEqual(syncLogDirIndex, -1);
  assert.notEqual(syncDeleteIndex, -1);
  assert.equal(syncValidationIndex < syncLogDirIndex, true);
  assert.equal(syncValidationIndex < syncDeleteIndex, true);
  assert.match(syncContent, /\[\[ "\$REMOTE_ROOT" != \/\* \]\]/);
  assert.match(syncContent, /\[\[ "\$REMOTE_ROOT" == \*"\/\.\.\/"\* \]\]/);
  assert.match(syncContent, /printf '%s\\n' "\$failure_reason" >&2/);

  assert.notEqual(cleanupValidationIndex, -1);
  assert.notEqual(cleanupLogDirIndex, -1);
  assert.notEqual(cleanupDeleteIndex, -1);
  assert.equal(cleanupValidationIndex < cleanupLogDirIndex, true);
  assert.equal(cleanupValidationIndex < cleanupDeleteIndex, true);
  assert.match(cleanupContent, /\[\[ "\$REMOTE_ROOT" != \/\* \]\]/);
  assert.match(cleanupContent, /\[\[ "\$REMOTE_ROOT" == \*"\/\.\.\/"\* \]\]/);
  assert.match(cleanupContent, /printf '%s\\n' "\$failure_reason" >&2/);
});

test('remote test entry contract: sync should validate workspace archive path before use', () => {
  const syncContent = readScript('10-sync-workspace.sh');
  const validationIndex = syncContent.indexOf('invalid workspace archive path');
  const existenceIndex = syncContent.indexOf('archive not found: $ARCHIVE_PATH');
  const extractIndex = syncContent.indexOf('tar -xzf "$ARCHIVE_PATH"');
  const deleteIndex = syncContent.indexOf('rm -f "$ARCHIVE_PATH"');

  assert.notEqual(validationIndex, -1);
  assert.notEqual(existenceIndex, -1);
  assert.notEqual(extractIndex, -1);
  assert.notEqual(deleteIndex, -1);
  assert.equal(validationIndex < existenceIndex, true);
  assert.equal(validationIndex < extractIndex, true);
  assert.equal(validationIndex < deleteIndex, true);
  assert.match(syncContent, /remote_tmp_prefix="\$REMOTE_ROOT\/tmp\/"/);
  assert.match(syncContent, /archive_name="\$\{ARCHIVE_PATH#"\$remote_tmp_prefix"\}"/);
  assert.match(syncContent, /\[\[ "\$ARCHIVE_PATH" != \/\* \]\]/);
  assert.match(syncContent, /\[\[ "\$ARCHIVE_PATH" == \*"\/\.\.\/"\* \]\]/);
  assert.match(syncContent, /\[\[ "\$ARCHIVE_PATH" != "\$remote_tmp_prefix"\* \]\]/);
  assert.match(syncContent, /\[\[ "\$archive_name" == \*\/\* \]\]/);
  assert.match(syncContent, /\[\[ "\$archive_name" != workspace-\*\.tar\.gz \]\]/);
});

test('remote test entry contract: scripts using extension dir should validate it first', () => {
  const cases = [
    {
      fileName: '20-run-fixture-e2e.sh',
      operation: 'cd "$EXTENSION_DIR"',
    },
    {
      fileName: '30-run-real-site-smoke.sh',
      operation: 'cd "$EXTENSION_DIR"',
    },
    {
      fileName: '90-cleanup-remote.sh',
      operation: 'rm -rf "$EXTENSION_DIR/playwright-report"',
    },
  ];

  for (const { fileName, operation } of cases) {
    const content = readScript(fileName);
    const normalizationIndex = content.indexOf('EXTENSION_DIR="${EXTENSION_DIR%/}"');
    const validationIndex = content.indexOf('invalid TEST_MACHINE_EXTENSION_DIR');
    const operationIndex = content.indexOf(operation);

    assert.notEqual(normalizationIndex, -1, `${fileName} should normalize EXTENSION_DIR`);
    assert.notEqual(validationIndex, -1, `${fileName} should validate EXTENSION_DIR`);
    assert.notEqual(operationIndex, -1, `${fileName} should use EXTENSION_DIR`);
    assert.equal(normalizationIndex < validationIndex, true);
    assert.equal(validationIndex < operationIndex, true);
    assert.match(content, /expected_extension_dir="\$REMOTE_ROOT\/bilibili-vocab-extension"/);
    assert.match(content, /\[\[ "\$EXTENSION_DIR" != \/\* \]\]/);
    assert.match(content, /\[\[ "\$EXTENSION_DIR" == \*"\/\.\.\/"\* \]\]/);
    assert.match(content, /\[ "\$EXTENSION_DIR" != "\$expected_extension_dir" \]/);
  }
});

test('remote test entry contract: setup should validate disk threshold before comparison', () => {
  const content = readScript('00-setup-remote-env.sh');
  const validationIndex = content.indexOf('invalid TEST_MACHINE_MIN_FREE_KB');
  const comparisonIndex = content.indexOf('"$available_kb" -lt "$MIN_FREE_KB"');

  assert.notEqual(validationIndex, -1);
  assert.notEqual(comparisonIndex, -1);
  assert.equal(validationIndex < comparisonIndex, true);
  assert.match(content, /\[\[ "\$MIN_FREE_KB" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(content, /\[ "\$MIN_FREE_KB" -le 0 \]/);
});

test('remote test entry contract: setup should validate resolved disk space before comparison', () => {
  const content = readScript('00-setup-remote-env.sh');
  const emptyValueIndex = content.indexOf('unable to resolve free disk space');
  const validationIndex = content.indexOf('invalid free disk space value');
  const comparisonIndex = content.indexOf('"$available_kb" -lt "$MIN_FREE_KB"');

  assert.notEqual(emptyValueIndex, -1);
  assert.notEqual(validationIndex, -1);
  assert.notEqual(comparisonIndex, -1);
  assert.equal(emptyValueIndex < validationIndex, true);
  assert.equal(validationIndex < comparisonIndex, true);
  assert.match(content, /\[\[ "\$available_kb" =~ \^\[0-9\]\+\$ \]\]/);
});

test('remote test entry contract: shell pnpm run references should target package scripts', () => {
  const packageScripts = readPackageScripts();
  const shellScriptNames = fs
    .readdirSync(SCRIPT_ROOT)
    .filter((fileName) => fileName.endsWith('.sh'))
    .sort();
  const references = shellScriptNames.flatMap((fileName) =>
    extractShellPnpmRunReferences(readScript(fileName)).map((reference) => ({
      fileName,
      reference,
    }))
  );

  assert.deepEqual(references, EXPECTED_SHELL_PNPM_RUN_REFERENCES);
  for (const { fileName, reference } of references) {
    assert.equal(
      Object.hasOwn(packageScripts, reference),
      true,
      `${fileName} references missing package script: ${reference}`
    );
  }
});

test('remote test entry contract: smoke scripts should share browser environment setup', () => {
  const helperContent = readScript(REMOTE_SMOKE_ENV_HELPER);
  const fixtureScript = readScript('20-run-fixture-e2e.sh');
  const realSiteScript = readScript('30-run-real-site-smoke.sh');

  assert.match(helperContent, /prepare_remote_smoke_environment\(\)/);
  assert.match(helperContent, /resolve_remote_smoke_browser_path\(\)/);
  assert.match(helperContent, /BILI_VOCAB_EXTENSION_BROWSER/);
  assert.match(helperContent, /BILI_VOCAB_EXTENSION_TMPDIR/);
  assert.match(helperContent, /BILI_VOCAB_EXTENSION_TMPDIR="\$REMOTE_ROOT\/tmp"/);
  assert.doesNotMatch(helperContent, /TEST_MACHINE_REMOTE_ROOT/);

  [fixtureScript, realSiteScript].forEach((scriptContent) => {
    const remoteRootValidationIndex = scriptContent.indexOf('\nvalidate_remote_root\n');
    const helperSourceIndex = scriptContent.indexOf('. "$SCRIPT_DIR/remote-smoke-env.sh"');

    assert.notEqual(remoteRootValidationIndex, -1);
    assert.notEqual(helperSourceIndex, -1);
    assert.equal(remoteRootValidationIndex < helperSourceIndex, true);
    assert.match(scriptContent, /\. "\$SCRIPT_DIR\/remote-smoke-env\.sh"/);
    assert.match(scriptContent, /prepare_remote_smoke_environment/);
    assert.doesNotMatch(scriptContent, /resolve_browser_path\(\)/);
    assert.doesNotMatch(scriptContent, /local candidates=/);
  });
});

test('remote test entry contract: fixture runner should keep browser smoke in explicit out-of-band entry', () => {
  const packageScripts = readPackageScripts();
  const scriptContent = readScript('20-run-fixture-e2e.sh');

  assert.equal(
    normalizeScript(packageScripts['test:extension-smoke']),
    'pnpm run build:extension && pnpm run test:extension-smoke:built'
  );
  assert.equal(
    normalizeScript(packageScripts['test:extension-smoke:built']),
    'node --test tests/browser-extension-smoke.spec.js'
  );
  assert.match(scriptContent, /pnpm run test:extension-smoke/);
  assert.doesNotMatch(scriptContent, /pnpm run build:extension/);
  assert.doesNotMatch(scriptContent, /node --test tests\/browser-extension-smoke\.spec\.js/);
});

test('remote test entry contract: real-site runner should reuse the package smoke entry', () => {
  const packageScripts = readPackageScripts();
  const scriptContent = readScript('30-run-real-site-smoke.sh');

  assert.equal(
    fs.existsSync(path.join(PROJECT_ROOT, 'tests', 'real-site-smoke.spec.js')),
    true,
    'real-site smoke spec should exist'
  );
  assert.equal(
    normalizeScript(packageScripts['test:real-site-smoke']),
    'pnpm run build:extension && node --test tests/real-site-smoke.spec.js'
  );
  assert.doesNotMatch(scriptContent, /exit 64/);
  assert.match(scriptContent, /pnpm run test:real-site-smoke/);
  assert.doesNotMatch(scriptContent, /pnpm run build:extension/);
  assert.doesNotMatch(scriptContent, /node --test tests\/real-site-smoke\.spec\.js/);
});

test('remote test entry contract: python runner should describe action-to-script mapping', () => {
  const output = execFileSync('python', [RUNNER_PATH, '--describe'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  const description = JSON.parse(output);

  assert.deepEqual(description.actions, [
    'setup',
    'sync',
    'fixture',
    'real-site',
    'long-run',
    'cleanup',
  ]);
  assert.deepEqual(description.remote_scripts, {
    setup: '00-setup-remote-env.sh',
    sync: '10-sync-workspace.sh',
    fixture: '20-run-fixture-e2e.sh',
    'real-site': '30-run-real-site-smoke.sh',
    'long-run': '40-run-long-session.sh',
    cleanup: '90-cleanup-remote.sh',
  });
  assert.match(description.placeholder_actions['long-run'], /Phase 3 follow-up/);
  assert.deepEqual(description.required_env, ['TEST_MACHINE_HOST', 'TEST_MACHINE_USER']);
  assert.deepEqual(description.auth_env, ['TEST_MACHINE_PASSWORD', 'TEST_MACHINE_SSH_KEY']);
  assert.equal(description.defaults.remote_root, '/root/bilibili-vocab-extension');
  assert.equal(description.defaults.phase, 'phase-0');
  assert.equal(description.defaults.task_card, 'P0-TEST-BOOTSTRAP');
  assert.deepEqual(description.remote_sync_excluded_relpaths, [
    'bilibili-vocab-extension/test-out.txt',
    'bilibili-vocab-extension/test-output.txt',
  ]);
  assert.deepEqual(description.remote_sync_excluded_prefixes, [
    'bilibili-vocab-extension/sources/',
  ]);
  assert.deepEqual(
    description.remote_sync_untracked_root_suffixes,
    EXPECTED_REMOTE_SYNC_UNTRACKED_ROOT_SUFFIXES
  );
  assert.deepEqual(
    description.remote_sync_untracked_prefix_rules,
    EXPECTED_REMOTE_SYNC_UNTRACKED_PREFIX_RULES
  );
});

test('remote test entry contract: python runner should validate connection config locally', () => {
  const probe = readRunnerConfigProbe();

  assert.match(probe.missing_config_error, /missing TEST_MACHINE_HOST or TEST_MACHINE_USER/);
  assert.equal(
    probe.auth_conflict_error,
    'set either TEST_MACHINE_PASSWORD or TEST_MACHINE_SSH_KEY, not both'
  );
  assert.equal(probe.invalid_env_port_error, 'invalid remote port: not-a-port');
  assert.equal(probe.invalid_cli_port_error, 'invalid remote port: 0');
  assert.equal(probe.invalid_env_remote_root_error, 'invalid remote root: /');
  assert.equal(probe.invalid_cli_remote_root_error, 'invalid remote root: relative/root');
  assert.equal(probe.invalid_parent_remote_root_error, 'invalid remote root: /tmp/../bili');
  assert.equal(probe.invalid_env_phase_error, 'invalid remote phase: ../phase-x');
  assert.equal(probe.invalid_env_relative_phase_error, 'invalid remote phase: ./phase-x');
  assert.equal(probe.invalid_cli_task_card_error, 'invalid remote task card: CARD/1');
  assert.equal(probe.invalid_cli_trailing_task_card_error, 'invalid remote task card: CARD-1/');
  assert.deepEqual(probe.config, {
    host: 'example.test',
    user: 'root',
    port: 2202,
    password: 'secret',
    ssh_key: null,
    remote_root: '/tmp/bili-remote',
    phase: 'phase-x',
    task_card: 'CARD-1',
    extension_subdir: 'bilibili-vocab-extension',
    extension_dir: '/tmp/bili-remote/bilibili-vocab-extension',
    commit_sha_length: 40,
  });
});

test('remote test entry contract: python runner should reject invalid CLI port consistently', () => {
  const probe = readRunnerInvalidCliPortProbe();

  assert.equal(probe.status, 1);
  assert.equal(probe.stdout, '');
  assert.equal(probe.stderr.trim(), 'invalid remote port: not-a-port');
});

test('remote test entry contract: workspace archive creation should cleanup temp dir on failure', () => {
  const probe = readRunnerArchiveCreationFailureProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.match(probe.error, /workspace archive creation failed:/);
  assert.match(probe.error, /missing-file\.txt/);
  assert.equal(probe.temp_dir_exists, false);
});

test('remote test entry contract: local command should wrap execution exceptions', () => {
  const probe = readRunnerLocalCommandExecutionExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'local command execution failed (git status): spawn failed');
});

test('remote test entry contract: remote session run should wrap execution exceptions', () => {
  const probe = readRunnerRemoteSessionRunExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'remote command execution failed (echo ok): ssh channel failed');
});

test('remote test entry contract: remote session put_file should reject closed sftp', () => {
  const probe = readRunnerRemoteSessionPutFileClosedProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'remote sftp session is not open');
  assert.equal(probe.run_called, false);
});

test('remote test entry contract: remote session put_file should wrap upload exceptions', () => {
  const probe = readRunnerRemoteSessionPutFileExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(
    probe.error,
    'remote file upload failed (local.tar.gz -> /remote/workspace.tar.gz): scp failed'
  );
});

test('remote test entry contract: remote session enter should wrap ssh connection exceptions', () => {
  const probe = readRunnerRemoteSessionConnectExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'remote ssh connection failed (root@example.test:2222): network down');
  assert.equal(probe.close_called, true);
  assert.equal(probe.open_sftp_called, false);
});

test('remote test entry contract: remote session enter should wrap sftp open exceptions', () => {
  const probe = readRunnerRemoteSessionOpenSftpExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(
    probe.error,
    'remote sftp session open failed (root@example.test:2222): sftp refused'
  );
  assert.equal(probe.close_called, true);
  assert.equal(probe.key_filename, '/tmp/key');
  assert.equal(probe.look_for_keys, false);
  assert.equal(probe.allow_agent, false);
});

test('remote test entry contract: remote session exit should wrap close exceptions', () => {
  const probe = readRunnerRemoteSessionCloseExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(
    probe.error,
    'remote session close failed: sftp close failed: sftp close refused; ssh client close failed: ssh close refused'
  );
  assert.equal(probe.sftp_close_called, true);
  assert.equal(probe.client_close_called, true);
});

test('remote test entry contract: remote session exit should not mask primary exceptions', () => {
  const probe = readRunnerRemoteSessionCloseAfterPrimaryExceptionProbe();

  assert.equal(probe.result_is_none, true);
  assert.match(
    probe.stderr,
    /\[remote-test-machine\] remote session close failed after RemoteExecutionError:/
  );
  assert.match(probe.stderr, /sftp close failed: sftp close refused/);
  assert.match(probe.stderr, /ssh client close failed: ssh close refused/);
});

test('remote test entry contract: pipeline should preserve target failure when cleanup also fails', () => {
  const probe = readRunnerPipelineFailureProbe();

  assert.match(probe.error, /target failed/);
  assert.match(
    probe.error,
    /log_dir=\/remote\/test-results\/test-machine\/phase-x\/CARD-1\/20260525T000000Z-fixture/
  );
  assert.match(probe.error, /cleanup_error=cleanup failed/);
});

test('remote test entry contract: pipeline should preserve ordinary failure when cleanup also fails', () => {
  const probe = readRunnerPipelineOrdinaryFailureCleanupFailureProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.deepEqual(probe.calls, ['setup', 'sync', 'cleanup']);
  assert.match(probe.error, /pipeline step failed \(sync\): sync crashed/);
  assert.match(probe.error, /cleanup_error=cleanup failed/);
});

test('remote test entry contract: pipeline should preserve target failure when cleanup crashes', () => {
  const probe = readRunnerPipelineOrdinaryCleanupAfterTargetFailureProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.match(probe.error, /target failed/);
  assert.match(
    probe.error,
    /log_dir=\/remote\/test-results\/test-machine\/phase-x\/CARD-1\/20260525T000000Z-fixture/
  );
  assert.match(probe.error, /cleanup_error=pipeline cleanup failed: cleanup crashed/);
});

test('remote test entry contract: pipeline should wrap cleanup crashes after success', () => {
  const probe = readRunnerPipelineOrdinaryCleanupOnlyFailureProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.deepEqual(probe.calls, ['setup', 'sync', 'target', 'cleanup']);
  assert.equal(probe.error, 'pipeline cleanup failed: cleanup crashed');
});

test('remote test entry contract: sync should preserve upload failure when local cleanup also fails', () => {
  const probe = readRunnerSyncCleanupFailureProbe();

  assert.match(probe.error, /upload failed/);
  assert.match(probe.error, /local_cleanup_error=.*local temp dir busy/);
});

test('remote test entry contract: sync should wrap upload exceptions', () => {
  const probe = readRunnerSyncUploadExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'workspace archive upload failed: socket reset');
});

test('remote test entry contract: sync should preserve ordinary failure when local cleanup also fails', () => {
  const probe = readRunnerSyncOrdinaryFailureCleanupFailureProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.match(probe.error, /workspace sync failed: sync crashed/);
  assert.match(probe.error, /local_cleanup_error=.*local temp dir busy/);
});

test('remote test entry contract: standalone script upload should wrap exceptions', () => {
  const probe = readRunnerStandaloneUploadExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.equal(probe.error, 'standalone script upload failed (00-setup-remote-env.sh): scp failed');
});

test('remote test entry contract: standalone action run should wrap exceptions with log dir', () => {
  const probe = readRunnerStandaloneRunExceptionProbe();

  assert.equal(probe.type, 'RemoteExecutionError');
  assert.match(probe.error, /standalone action failed \(setup\): exec channel closed/);
  assert.match(
    probe.error,
    /log_dir=\/remote\/test-results\/test-machine\/phase-x\/CARD-1\/20260525T000000Z-setup/
  );
});

test('remote test entry contract: pipeline should cleanup after sync failure', () => {
  const probe = readRunnerPipelineSyncFailureProbe();

  assert.deepEqual(probe.calls, ['setup', 'sync', 'cleanup']);
  assert.equal(probe.error, 'sync failed');
});

test('remote test entry contract: pipeline should cleanup after setup failure', () => {
  const probe = readRunnerPipelineSetupFailureProbe();

  assert.deepEqual(probe.calls, ['setup', 'cleanup']);
  assert.equal(probe.error, 'setup failed');
});

test('remote test entry contract: sync should diagnose local cleanup failure after success', () => {
  const probe = readRunnerSyncLocalCleanupOnlyFailureProbe();

  assert.match(probe.error, /local archive cleanup failed: .*local temp dir busy/);
  assert.doesNotMatch(probe.error, /upload failed|sync failed/);
});

test('remote test entry contract: workspace sync should keep new scripts and exclude local outputs', () => {
  const probe = readRunnerProbe();
  const workspaceRelpaths = new Set(probe.workspace_relpaths);
  const pythonCachePath = 'scripts/test/__pycache__/remote-test-machine.cpython-311.pyc';

  assert.equal(probe.include_remote_helper, true);
  assert.equal(probe.include_package_gate, true);
  assert.equal(probe.include_package_gate_test, true);
  assert.equal(probe.include_test_out, false);
  assert.equal(probe.include_test_output, false);
  assert.equal(probe.include_tracked_data, true);
  assert.equal(probe.include_tracked_source, false);
  assert.equal(probe.include_untracked_script, true);
  assert.equal(probe.include_untracked_test, true);
  assert.equal(probe.include_untracked_root_code, true);
  assert.equal(probe.include_untracked_root_text, false);
  assert.equal(probe.include_untracked_docs, false);
  assert.equal(
    workspaceRelpaths.has('bilibili-vocab-extension/scripts/test/remote-smoke-env.sh'),
    true
  );
  assert.equal(
    workspaceRelpaths.has('bilibili-vocab-extension/scripts/check-extension-package.js'),
    true
  );
  assert.equal(
    workspaceRelpaths.has('bilibili-vocab-extension/tests/check-extension-package.test.js'),
    true
  );
  assert.equal(workspaceRelpaths.has('bilibili-vocab-extension/data/cet4.json'), true);
  assert.equal(
    [...workspaceRelpaths].some((relpath) =>
      relpath.startsWith('bilibili-vocab-extension/sources/')
    ),
    false
  );
  assert.equal(workspaceRelpaths.has('bilibili-vocab-extension/test-out.txt'), false);
  assert.equal(workspaceRelpaths.has('bilibili-vocab-extension/test-output.txt'), false);
  assert.equal(checkIgnoredByGit(pythonCachePath), pythonCachePath);
  assert.equal(workspaceRelpaths.has(`bilibili-vocab-extension/${pythonCachePath}`), false);
  assert.deepEqual(probe.excluded, [
    'bilibili-vocab-extension/test-out.txt',
    'bilibili-vocab-extension/test-output.txt',
  ]);
});
