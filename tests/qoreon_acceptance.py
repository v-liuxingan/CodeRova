"""Execute selected Qoreon functions from source with isolated storage/scheduling.

No Qoreon server, real CLI, timer, session or external message is started.
This checks bounded recovery facts, not end-to-end runtime success.
"""
import ast
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "callgraph.projects.json").read_text(encoding="utf-8"))
QOREON = (ROOT / next(p["root"] for p in CONFIG["projects"] if p["id"] == "qoreon")).resolve()


def source_function(file, name, namespace):
    tree = ast.parse((QOREON / file).read_text(encoding="utf-8"))
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    isolated = ast.Module(body=[function], type_ignores=[])
    exec(compile(isolated, file, "exec"), namespace)
    return namespace[name]


def main():
    ns = {"Any": object, "Callable": __import__("typing").Callable}
    build = source_function("task_dashboard/runtime/network_recovery.py", "build_network_resume_retry_meta", ns)
    backlink = source_function("task_dashboard/runtime/network_recovery.py", "apply_network_resume_schedule", ns)
    failure = source_function("task_dashboard/runtime/execution_retry.py", "apply_network_retry_failure", ns)
    auth = source_function("server.py", "_is_auth_error", ns)
    network = source_function("server.py", "_is_transient_network_error", ns)
    original = {"status": "error"}
    waiting = build({}, source_id="source", delay_s=60, message="resume", iso_after_s=lambda _: "due")
    assert waiting["status"] == "retry_waiting" and waiting["retryOf"] == "source"
    assert waiting["autoResumePrompt"] is True
    backlink(original, retry_run_id="retry", delay_s=60, iso_after_s=lambda _: "due")
    assert original["status"] == "error" and original["networkResumeRunId"] == "retry"
    for error, expected in [("stream disconnected before completion", True), ("401 unauthorized", False), ("invalid session id", False)]:
        meta = {}
        result = failure(meta, recovered=False, final_err=error, err_text=error, detected_text=error,
                         detected_auth_error=False, network_retry_max=3, safe_text=lambda text, _: text,
                         is_auth_error=auth, is_transient_network_error=network)
        assert result is expected and meta["status"] == "error"

    class Store:
        def __init__(self):
            self.created = []
            self.saved = {}

        def create_run(self, *args, **kwargs):
            self.created.append((args, kwargs))
            return {"id": "new-run"}

        def load_meta(self, _):
            return None

        def save_meta(self, rid, meta):
            self.saved[rid] = meta

    calls, fallbacks = [], []
    environment = {}
    ns.update({"time": SimpleNamespace(time=lambda: 100), "os": SimpleNamespace(environ=environment),
               "__getattr__": lambda name: {"_default_network_resume_delay_s": lambda: 60,
                                             "_default_network_resume_message": lambda: "resume"}[name],
               "runtime_build_network_resume_retry_meta": build, "_iso_after_s": lambda _: "due",
               "_schedule_retry_waiting_fallback": lambda *args: fallbacks.append(args)})
    schedule = source_function("task_dashboard/runtime/execution_runtime.py", "_schedule_network_resume_run", ns)
    source = {"id": "old", "projectId": "p", "channelName": "c", "sessionId": "s"}
    scheduler = SimpleNamespace(schedule_retry_waiting=lambda *args, **kwargs: calls.append((args, kwargs)))
    store = Store()
    assert schedule(store, source, scheduler=scheduler, cli_type="codex") == "new-run"
    assert calls[0][0] == ("new-run", "s", 160.0)
    assert store.saved["new-run"]["status"] == "retry_waiting"
    assert store.created[0][0][:3] == ("p", "c", "s")
    assert schedule(store, {**source, "autoResumePrompt": True}, scheduler=scheduler, cli_type="codex") == ""
    assert schedule(store, {**source, "sessionId": ""}, scheduler=scheduler, cli_type="codex") == ""
    assert len(store.created) == 1
    environment["CCB_SCHEDULER"] = "0"
    assert schedule(store, source, scheduler=scheduler, cli_type="codex") == "new-run"
    assert len(calls) == 1 and len(fallbacks) == 1
    print("Qoreon source acceptance: classification, failure/waiting separation, guards and scheduler fallback passed")


if __name__ == "__main__":
    main()
