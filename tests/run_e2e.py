import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMP_LAYOUTS = ROOT / "tests" / ".tmp-layouts"
SERVER = ROOT / "target" / "debug" / (
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


def main() -> int:
    subprocess.run(["cargo", "build", "--quiet"], cwd=ROOT, check=True)
    shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)
    server = subprocess.Popen(
        [str(SERVER), "serve", "--layouts", str(TEMP_LAYOUTS)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_port(4317, True)
        result = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "e2e_visualizer.py")],
            cwd=ROOT,
            check=False,
        )
        return result.returncode
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        wait_for_port(4317, False)
        shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
