import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMP_LAYOUTS = ROOT / "tests" / ".tmp-layouts"
TEMP_GRAPHS = ROOT / "tests" / ".tmp-graphs"
TEMP_SCENARIOS = ROOT / "tests" / ".tmp-scenarios"
TARGET_DIR = Path(
    os.environ.get("CALLGRAPH_E2E_TARGET_DIR", ROOT / "target" / "frontend-e2e")
)
SERVER = TARGET_DIR / "debug" / (
    "callgraph-visualizer.exe" if sys.platform == "win32" else "callgraph-visualizer"
)


def wait_for_port(port: int, expected_open: bool, timeout: float = 15) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                is_open = True
        except OSError:
            is_open = False
        if is_open == expected_open:
            return
        time.sleep(0.1)
    state = "打开" if expected_open else "释放"
    raise RuntimeError(f"端口 {port} 未在超时前{state}")


def find_free_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return candidate.getsockname()[1]


def main() -> int:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    subprocess.run(["node", str(ROOT / "tests" / "content_check_test.mjs")], cwd=ROOT, check=True)
    subprocess.run(["node", str(ROOT / "tests" / "project_navigation_test.mjs")], cwd=ROOT, check=True)
    subprocess.run(["node", str(ROOT / "tests" / "edge_routing_test.mjs")], cwd=ROOT, check=True)
    subprocess.run([sys.executable, str(ROOT / "tests" / "qoreon_acceptance.py")], cwd=ROOT, check=True)
    subprocess.run(
        ["node", str(ROOT / "tests" / "mermaid_scene_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "scene_render_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "project_evidence_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "execution_context_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "narrative_layout_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "selection_focus_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "trace_navigator_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "edge_semantics_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "graph_state_collapse_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "node_multiselect_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "catalog_grouping_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        ["node", str(ROOT / "tests" / "phase_topology_test.mjs")],
        cwd=ROOT,
        check=True,
    )
    if (ROOT / "node_modules" / "monaco-editor").is_dir():
        subprocess.run([npm, "run", "build:frontend"], cwd=ROOT, check=True)
    subprocess.run(
        ["cargo", "build", "--quiet", "--target-dir", str(TARGET_DIR)],
        cwd=ROOT,
        check=True,
    )
    analysis_environment = os.environ.copy()
    analysis_environment["CALLGRAPH_TEST_BINARY"] = str(SERVER)
    subprocess.run([sys.executable, str(ROOT / "tests" / "lsp_analysis_test.py")], cwd=ROOT, env=analysis_environment, check=True)
    shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)
    shutil.rmtree(TEMP_GRAPHS, ignore_errors=True)
    shutil.rmtree(TEMP_SCENARIOS, ignore_errors=True)
    shutil.copytree(ROOT / "graphs", TEMP_GRAPHS)
    shutil.copytree(ROOT / "scenarios", TEMP_SCENARIOS)
    port = find_free_port()
    server = subprocess.Popen(
        [
            str(SERVER),
            "serve",
            "--layouts",
            str(TEMP_LAYOUTS),
            "--graphs",
            str(TEMP_GRAPHS),
            "--scenarios",
            str(TEMP_SCENARIOS),
            "--port",
            str(port),
        ],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_port(port, True)
        environment = os.environ.copy()
        environment["CALLGRAPH_TEST_URL"] = f"http://127.0.0.1:{port}"
        environment["CALLGRAPH_TEST_GRAPHS"] = str(TEMP_GRAPHS)
        subprocess.run(
            [sys.executable, str(ROOT / "tests" / "renderer_interaction_e2e.py")],
            cwd=ROOT, env=environment, check=True,
        )
        subprocess.run([sys.executable, str(ROOT / "tests" / "v2_e2e.py")], cwd=ROOT, env=environment, check=True)
        subprocess.run([sys.executable, str(ROOT / "tests" / "v2_drag_e2e.py")], cwd=ROOT, env=environment, check=True)
        subprocess.run([sys.executable, str(ROOT / "tests" / "v2_highlight_e2e.py")], cwd=ROOT, env=environment, check=True)
        subprocess.run([sys.executable, str(ROOT / "tests" / "v2_library_e2e.py")], cwd=ROOT, env=environment, check=True)
        result = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "e2e_visualizer.py")],
            cwd=ROOT,
            env=environment,
            check=False,
        )
        if result.returncode:
            return result.returncode
        result = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "navigation_e2e.py")],
            cwd=ROOT,
            env=environment,
            check=False,
        )
        if result.returncode:
            return result.returncode
        result = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "project_navigation_e2e.py")],
            cwd=ROOT, env=environment, check=False,
        )
        if result.returncode:
            return result.returncode
        return subprocess.run(
            [sys.executable, str(ROOT / "tests" / "scenes_e2e.py")],
            cwd=ROOT,
            env=environment,
            check=False,
        ).returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        wait_for_port(port, False)
        shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)
        shutil.rmtree(TEMP_GRAPHS, ignore_errors=True)
        shutil.rmtree(TEMP_SCENARIOS, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
