"""Exercise the real CLI/stdio transport against a deterministic protocol peer.

No language server installation is needed; a real rust-analyzer smoke test is separate.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SERVER_MODE = len(sys.argv) > 1 and sys.argv[1] == "--peer"


def peer(mode):
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer

    def send(value):
        body = json.dumps({"jsonrpc": "2.0", **value}).encode()
        stdout.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        stdout.flush()

    uri = None

    def item(name, line):
        return {"name": name, "kind": 12, "uri": uri,
                "range": {"start": {"line": line, "character": 0}, "end": {"line": line, "character": 30}},
                "selectionRange": {"start": {"line": line, "character": 3}, "end": {"line": line, "character": 4}},
                "data": {"opaque": name}}

    while True:
        length = None
        while True:
            line = stdin.readline()
            if not line:
                return
            if line == b"\r\n":
                break
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":")[1])
        request = json.loads(stdin.read(length))
        method, rid = request.get("method"), request.get("id")
        if method == "initialize":
            send({"id": rid, "result": {"capabilities": {"callHierarchyProvider": mode != "unsupported"}}})
        elif method == "textDocument/didOpen":
            uri = request["params"]["textDocument"]["uri"]
            send({"id": "configuration", "method": "workspace/configuration", "params": {"items": [{"section": "rust-analyzer"}]}})
        elif rid == "configuration":
            assert request["result"] == [None]
            send({"method": "experimental/serverStatus", "params": {"quiescent": True}})
        elif method == "textDocument/prepareCallHierarchy":
            send({"id": rid, "result": [item("a", 0)]})
        elif method == "callHierarchy/outgoingCalls":
            caller = request["params"]["item"]
            assert caller["data"]["opaque"] == caller["name"], "opaque LSP data lost"
            if mode == "error" and caller["name"] == "b":
                send({"id": rid, "error": {"code": -32603, "message": "index failed"}})
                continue
            if mode == "null" and caller["name"] == "b":
                send({"id": rid, "result": None})
                continue
            target = item("b", 1) if caller["name"] == "a" else item("a", 0)
            start = caller["selectionRange"]["start"]["line"]
            ranges = [{"start": {"line": start, "character": c}, "end": {"line": start, "character": c + 1}} for c in [8, 13]]
            send({"id": rid, "result": [{"to": target, "fromRanges": ranges}]})
        elif method == "shutdown":
            send({"id": rid, "result": None})
        elif method == "exit":
            return


def run():
    binary = Path(os.environ.get("CALLGRAPH_TEST_BINARY", ROOT / "target/debug/callgraph-visualizer.exe"))
    with tempfile.TemporaryDirectory(prefix="callgraph-lsp-") as directory:
        root = Path(directory)
        (root / "test.rs").write_text("fn a() { b(); b(); }\nfn b() { a(); a(); }\n", encoding="utf-8")
        config = root / "projects.json"
        config.write_text(json.dumps({"schemaVersion": "0.1", "projects": [{"id": "fixture", "name": "Fixture", "root": str(root)}]}), encoding="utf-8")

        def invoke(mode, budget=20, depth=5):
            output = root / f"{mode}-{budget}-{depth}.json"
            args = [str(binary), "analyze", "--config", str(config), "--project", "fixture", "--file", "test.rs", "--line", "1", "--column", "4", "--server", sys.executable, "--server-arg", str(Path(__file__).resolve()), "--server-arg", "--peer", "--server-arg", mode, "--output", str(output), "--max-depth", str(depth), "--request-budget", str(budget)]
            result = subprocess.run(args, capture_output=True, timeout=20)
            return result, output

        result, output = invoke("cycle")
        assert result.returncode == 0, result.stderr.decode("utf-8")
        graph = json.loads(output.read_text(encoding="utf-8"))
        assert len(graph["nodes"]) == 2 and len(graph["edges"]) == 4
        assert len(graph["analysis"]["queriedNodes"]) == 2 and not graph["analysis"]["pendingNodes"]
        assert all(edge["kind"] == "static-call" and edge.get("order") is None for edge in graph["edges"])
        assert invoke("cycle")[0].returncode != 0, "existing export must not be overwritten"
        for mode in ["null", "error"]:
            result, output = invoke(mode)
            assert result.returncode == 0, result.stderr.decode("utf-8")
            report = json.loads(output.read_text(encoding="utf-8"))["analysis"]
            assert len(report["pendingNodes"]) == 1 and report["issues"]
        for budget, depth in [(1, 5), (20, 1), (20, 0)]:
            result, output = invoke("cycle", budget, depth)
            assert result.returncode == 0, result.stderr.decode("utf-8")
            report = json.loads(output.read_text(encoding="utf-8"))["analysis"]
            assert len(report["pendingNodes"]) == 1
        result, output = invoke("unsupported")
        assert result.returncode != 0 and not output.exists()
    print("LSP CLI integration: cycles, call sites, budgets, opaque data, null/error, capabilities and no-overwrite passed")


if __name__ == "__main__":
    peer(sys.argv[2]) if SERVER_MODE else run()
