import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def stub_source_open(route):
    request = route.request.post_data_json
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(
            {
                "uri": f"#source-{request['id']}",
                "path": f"codex-rs/{request['id']}.rs",
                "line": 1,
                "column": 1,
            }
        ),
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 980}, device_scale_factor=1)
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )

    page.goto("http://127.0.0.1:4317")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".graph-option")

    document_response = page.request.get("http://127.0.0.1:4317")
    assert "default-src 'self'" in document_response.headers["content-security-policy"]
    assert document_response.headers["x-content-type-options"] == "nosniff"
    assert document_response.headers["referrer-policy"] == "no-referrer"
    assert document_response.headers["x-frame-options"] == "DENY"
    assert "camera=()" in document_response.headers["permissions-policy"]
    assert document_response.headers["cache-control"] == "no-store"
    assert page.locator("html").get_attribute("data-theme") == "halo"
    assert page.locator("#instant-open-toggle").get_attribute("aria-pressed") == "false"
    assert page.locator("#instant-open-toggle").inner_text() == "点击跳转：关"
    assert page.locator("#theme-select").input_value() == "halo"
    assert page.locator("#theme-select option").count() == 3
    page.locator("#theme-select").select_option("aether")
    assert page.locator("html").get_attribute("data-theme") == "aether"
    page.locator("#theme-select").select_option("signal")
    assert page.locator("html").get_attribute("data-theme") == "signal"
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".graph-option")
    assert page.locator("#theme-select").input_value() == "signal"
    page.locator("#theme-select").select_option("halo")
    assert page.locator("html").get_attribute("data-theme") == "halo"

    health = page.request.get("http://127.0.0.1:4317/api/health")
    assert health.ok
    projects = health.json()["projects"]
    assert len(projects) == 1
    assert projects[0]["id"] == "codex"
    assert projects[0]["rootExists"]

    graphs = page.request.get("http://127.0.0.1:4317/api/graphs")
    assert graphs.ok
    graph_summaries = graphs.json()
    assert len(graph_summaries) == 4
    assert all(graph["projectId"] == "codex" for graph in graph_summaries)
    assert sum(graph["nodeCount"] for graph in graph_summaries) == 62
    assert sum(graph["edgeCount"] for graph in graph_summaries) == 60
    assert page.locator(".graph-option").count() == 4

    for summary in graph_summaries:
        graph_response = page.request.get(
            f"http://127.0.0.1:4317/api/graphs/{summary['slug']}"
        )
        assert graph_response.ok
        graph = graph_response.json()
        targets = [("node", graph["root"]), ("edge", graph["edges"][0]["id"])]
        for target_type, target_id in targets:
            link_response = page.request.post(
                "http://127.0.0.1:4317/api/open",
                data={
                    "graph": summary["slug"],
                    "targetType": target_type,
                    "id": target_id,
                },
            )
            assert link_response.ok
            assert link_response.json()["uri"].startswith("vscode://file/E:/")
            preview_response = page.request.post(
                "http://127.0.0.1:4317/api/preview",
                data={
                    "graph": summary["slug"],
                    "targetType": target_type,
                    "id": target_id,
                },
            )
            assert preview_response.ok, (
                summary["slug"],
                target_type,
                target_id,
                preview_response.status,
                preview_response.text(),
            )
            preview = preview_response.json()
            assert preview["lines"]
            assert sum(line["focus"] for line in preview["lines"]) >= 1
            assert preview["startLine"] <= preview["focusLine"] <= preview["endLine"]
            assert preview["focusLine"] <= preview["focusEndLine"]
            assert preview["endLine"] <= preview["totalLines"]
            assert preview["fileSizeBytes"] > 0
            assert preview["contextLines"] == 12
            assert preview["language"]

    expanded_preview = page.request.post(
        "http://127.0.0.1:4317/api/preview",
        data={
            "graph": "tui-authorization",
            "targetType": "node",
            "id": "cli.main",
            "contextLines": 24,
        },
    )
    assert expanded_preview.ok
    expanded_preview_body = expanded_preview.json()
    assert expanded_preview_body["focusLine"] == 956
    assert expanded_preview_body["focusEndLine"] == 962
    assert expanded_preview_body["contextLines"] == 24
    assert sum(line["focus"] for line in expanded_preview_body["lines"]) == 7
    assert expanded_preview_body["language"] == "rust"

    capped_preview = page.request.post(
        "http://127.0.0.1:4317/api/preview",
        data={
            "graph": "tui-authorization",
            "targetType": "node",
            "id": "cli.main",
            "contextLines": 65535,
        },
    )
    assert capped_preview.ok
    assert capped_preview.json()["contextLines"] == 40

    injected_path = page.request.post(
        "http://127.0.0.1:4317/api/preview",
        data={
            "graph": "tui-authorization",
            "targetType": "node",
            "id": "cli.main",
            "path": "../../secret.txt",
        },
    )
    assert injected_path.status == 422

    expected_graphs = {
        "Codex shell tool approval and sandbox execution": (17, 33),
        "Codex persisted thread resume": (12, 24),
        "Codex interactive turn lifecycle": (14, 26),
        "TUI authorization call graph": (19, 37),
    }
    for title, (node_count, source_location_count) in expected_graphs.items():
        page.locator(".graph-option", has_text=title).click()
        page.wait_for_function(
            "(title) => document.querySelector('#graph-title')?.textContent === title",
            arg=title,
        )
        page.wait_for_function(
            "(count) => document.querySelectorAll('.graph-node').length === count",
            arg=node_count,
        )
        page.wait_for_function(
            "(text) => document.querySelector('#validation-badge')?.textContent === text",
            arg=f"{source_location_count} 处源码有效",
        )
        if title == "Codex shell tool approval and sandbox execution":
            assert page.locator("#trace-callsite").get_attribute(
                "data-trace-edge-id"
            ) == "shell.output-to-runtime"
            assert page.locator("#trace-branch-wrap").is_visible()
            assert page.locator("#trace-branch option").count() == 2
            assert page.locator("#trace-branch").input_value() == "shell.output-to-runtime"
            assert page.locator("#trace-branch-label").inner_text() == "分支 2/2"
            assert "ToolCallRuntime::handle_tool_call" in page.locator(
                "#trace-branch option:checked"
            ).inner_text()
            page.locator("#trace-branch").select_option("shell.output-to-build")
            assert page.locator("#trace-branch-label").inner_text() == "分支 1/2"
            assert page.locator("#trace-callsite").get_attribute(
                "data-trace-edge-id"
            ) == "shell.output-to-build"
            assert page.locator("#trace-next").get_attribute(
                "data-trace-node-id"
            ) == "tools.build-tool-call"
            page.locator("#trace-branch").select_option("shell.output-to-runtime")
            page.locator('[data-edge-hit-id="shell.output-to-build"]').evaluate(
                "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            assert page.locator("#trace-branch").input_value() == "shell.output-to-build"
            page.locator("#trace-branch").select_option("shell.output-to-runtime")

    page.wait_for_selector('[data-node-id="cli.main"]')

    assert page.locator(".graph-node").count() == 19
    assert "TUI authorization" in page.locator("#graph-title").inner_text()
    assert "37 处源码有效" in page.locator("#validation-badge").inner_text()
    assert page.locator(
        '.edge-callsite[data-callsite-status="exact"]'
    ).count() == 18
    assert page.locator(
        '.edge-callsite[data-callsite-status="omitted-nodes"]'
    ).text_content() == "◇ 已省略中间节点"
    assert page.locator(
        '.edge-callsite[data-edge-id="edge.client-runtime-start"]'
    ).text_content() == "lib.rs:462"
    page.wait_for_selector(".source-workbench")
    assert "RUST · 目标 956–962" in page.locator(".source-preview-stats").inner_text()
    assert page.locator(".source-preview-line.focus").count() == 7
    assert page.locator(".source-density button").count() == 3
    assert page.locator(".source-density button.active").inner_text() == "标准"
    page.locator(".source-find input").fill("async")
    assert page.locator(".source-preview-line.search-match").count() >= 1
    assert page.locator(".source-find span").inner_text() != "0/0"
    page.locator(".source-find input").fill("")

    page.locator(".source-density button", has_text="展开").click()
    page.wait_for_function(
        "() => document.querySelector('.source-density button.active')?.textContent === '展开'"
    )
    assert page.locator(".source-preview-line").count() > 31
    page.locator(".source-density button", has_text="标准").click()
    page.wait_for_function(
        "() => document.querySelector('.source-density button.active')?.textContent === '标准'"
    )
    source_link = page.request.post(
        "http://127.0.0.1:4317/api/open",
        data={
            "graph": "tui-authorization",
            "targetType": "node",
            "id": "cli.main",
        },
    )
    assert source_link.ok
    source_link_body = source_link.json()
    assert source_link_body["uri"].startswith("vscode://file/E:/")
    assert source_link_body["uri"].endswith(
        "/codex/codex-rs/cli/src/main.rs:956:1"
    )
    unavailable_link = page.request.post(
        "http://127.0.0.1:4317/api/open",
        data={
            "graph": "tui-authorization",
            "targetType": "edge",
            "id": "edge.auth-to-request-phase",
        },
    )
    assert unavailable_link.status == 400
    unavailable_preview = page.request.post(
        "http://127.0.0.1:4317/api/preview",
        data={
            "graph": "tui-authorization",
            "targetType": "edge",
            "id": "edge.auth-to-request-phase",
        },
    )
    assert unavailable_preview.status == 400
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.main"
    assert page.locator("#trace-previous").is_disabled()
    assert page.locator("#trace-callsite").get_attribute(
        "data-trace-edge-id"
    ) == "edge.main-cli-main"
    assert page.locator("#trace-next").get_attribute(
        "data-trace-node-id"
    ) == "cli.cli-main"

    trace_open_requests = []
    page.on(
        "request",
        lambda request: trace_open_requests.append(request.post_data_json)
        if request.url.endswith("/api/open") and request.method == "POST"
        else None,
    )
    page.locator("#trace-next").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-position"
    ) == "edge"
    assert "异步入口" in page.locator("#inspector-content h2").inner_text()
    assert "main.rs" in page.locator(".source-preview-path").inner_text()
    assert "目标 959" in page.locator(".source-preview-stats").inner_text()
    assert page.locator(".source-preview-line.focus").count() == 1

    page.locator("#trace-next").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.cli-main"
    assert page.locator("#trace-callsite").get_attribute(
        "data-trace-edge-id"
    ) == "edge.cli-main-interactive"

    page.locator("#trace-previous").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-position"
    ) == "edge"
    assert "异步入口" in page.locator("#inspector-content h2").inner_text()

    page.locator("#trace-previous").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.main"

    page.locator("#trace-callsite").click()
    assert "异步入口" in page.locator("#inspector-content h2").inner_text()
    page.locator("#trace-previous").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.main"

    page.keyboard.press("ArrowRight")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-position"
    ) == "edge"

    page.keyboard.press("ArrowRight")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.cli-main"

    page.keyboard.press("ArrowLeft")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-position"
    ) == "edge"

    page.keyboard.press("ArrowLeft")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.main"
    assert trace_open_requests == []
    assert page.evaluate("document.hasFocus()")

    page.locator("#search").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.main"
    page.locator("#search").blur()

    page.locator("#fit-view").click()
    page.locator(
        '[data-edge-hit-id="edge.auth-to-request-phase"]'
    ).evaluate(
        "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
    )
    assert "已省略中间节点" in page.locator("#inspector-content").inner_text()
    assert page.locator("#inspector-content [data-open]").count() == 0
    assert page.locator("#trace-callsite").is_disabled()
    assert "省略了多个中间节点" in (
        page.locator("#trace-callsite").get_attribute("title") or ""
    )
    assert page.locator("#trace-next").get_attribute(
        "data-trace-node-id"
    ) == "core.current-client-setup"

    instant_open_requests = []
    page.on(
        "request",
        lambda request: instant_open_requests.append(request.post_data_json)
        if request.url.endswith("/api/open") and request.method == "POST"
        else None,
    )
    page.route("**/api/open", stub_source_open)
    page.locator("#instant-open-toggle").click()
    assert page.locator("#instant-open-toggle").get_attribute("aria-pressed") == "true"
    assert page.locator("#instant-open-toggle").inner_text() == "点击跳转：开"

    with page.expect_request("**/api/open") as instant_node_request:
        page.locator('[data-node-id="cli.main"]').evaluate(
            "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
        )
    assert instant_node_request.value.post_data_json["targetType"] == "node"
    assert instant_node_request.value.post_data_json["id"] == "cli.main"

    with page.expect_request("**/api/open") as instant_edge_request:
        page.locator('[data-edge-hit-id="edge.main-cli-main"]').evaluate(
            "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
        )
    assert instant_edge_request.value.post_data_json["targetType"] == "edge"
    assert instant_edge_request.value.post_data_json["id"] == "edge.main-cli-main"

    page.locator('[data-edge-hit-id="edge.auth-to-request-phase"]').evaluate(
        "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
    )
    page.wait_for_timeout(100)
    assert len(instant_open_requests) == 2

    page.locator("#instant-open-toggle").click()
    assert page.locator("#instant-open-toggle").get_attribute("aria-pressed") == "false"
    page.keyboard.press("ArrowLeft")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "login.auth-manager-shared"

    page.keyboard.press("ArrowRight")
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "core.current-client-setup"
    page.unroute("**/api/open", stub_source_open)

    selected_node = page.locator('[data-node-id="core.current-client-setup"]')
    selected_node.click()
    assert "ModelClient::current_client_setup" in page.locator("#inspector-content h2").inner_text()
    canvas_box = page.locator("#graph-canvas").bounding_box()
    assert canvas_box
    drag_start = (canvas_box["x"] + 20, canvas_box["y"] + 20)
    page.mouse.move(*drag_start)
    page.mouse.down()
    page.mouse.move(drag_start[0] + 90, drag_start[1] + 55, steps=5)
    page.mouse.up()
    assert "selected" in (selected_node.get_attribute("class") or "")
    assert "ModelClient::current_client_setup" in page.locator("#inspector-content h2").inner_text()
    page.mouse.click(*drag_start)
    assert "selected" not in (selected_node.get_attribute("class") or "")
    selected_node.click()
    page.locator("#fit-view").click()
    page.get_by_role("button", name="上游").click()
    upstream_count = page.locator(".graph-node").count()
    assert 1 < upstream_count < 19

    page.get_by_role("button", name="全图").click()
    page.locator("#orientation").click()
    assert page.locator("#orientation").inner_text() == "横向布局"

    page.locator("#search").fill("Bearer")
    dimmed_count = page.locator(".graph-node.search-dim").count()
    assert 0 < dimmed_count < 19
    assert "search-dim" not in (
        page.locator('[data-node-id="provider.bearer-auth"]').get_attribute("class") or ""
    )
    page.locator("#search").fill("")
    page.locator("#orientation").click()
    assert page.locator("#orientation").inner_text() == "纵向布局"

    page.locator('[data-node-id="cli.main"] .collapse-toggle').click()
    assert page.locator(".graph-node").count() == 1
    page.locator("#reset-view").click()
    assert page.locator(".graph-node").count() == 19

    edge_hit_target = page.locator(
        '[data-edge-hit-id="edge.client-runtime-start"]'
    )
    edge_hit_points = edge_hit_target.evaluate(
        """element => {
            const length = element.getTotalLength();
            const matrix = element.getScreenCTM();
            return [0.1, 0.25, 0.5, 0.75, 0.9].flatMap(ratio => {
                const distance = length * ratio;
                const point = element.getPointAtLength(distance);
                const before = element.getPointAtLength(Math.max(0, distance - 1));
                const after = element.getPointAtLength(Math.min(length, distance + 1));
                const dx = after.x - before.x;
                const dy = after.y - before.y;
                const magnitude = Math.hypot(dx, dy) || 1;
                const normal = { x: -dy / magnitude, y: dx / magnitude };
                const screen = point.matrixTransform(matrix);
                return [-10, 10].map(offset => ({
                    x: screen.x + normal.x * offset,
                    y: screen.y + normal.y * offset,
                }));
            });
        }"""
    )
    for point in edge_hit_points:
        assert page.evaluate(
            """([x, y]) =>
                document.elementFromPoint(x, y)
                    ?.closest(".graph-edge-group")
                    ?.dataset.edgeGroupId || null""",
            [point["x"], point["y"]],
        ) == "edge.client-runtime-start"
    hit_test_x = edge_hit_points[4]["x"]
    hit_test_y = edge_hit_points[4]["y"]
    page.mouse.click(hit_test_x, hit_test_y)
    assert "启动运行时" in page.locator("#inspector-content h2").inner_text()
    assert page.locator("#inspector-content [data-open]").count() == 1
    assert "codex_app_server::in_process::start" in page.locator(
        "#inspector-content"
    ).inner_text()
    page.keyboard.press("Escape")
    assert page.locator("#inspector-empty").is_visible()
    page.locator(
        '.edge-callsite[data-edge-id="edge.client-runtime-start"]'
    ).click()
    assert "启动运行时" in page.locator("#inspector-content h2").inner_text()

    page.locator("#zoom-in").click()
    page.locator("#zoom-in").click()
    page.wait_for_timeout(3700)
    page.screenshot(path=str(ARTIFACTS / "callgraph-overview.png"), full_page=True)
    assert not console_errors, f"browser console errors: {console_errors}"
    browser.close()

print(f"E2E OK; upstream node count={upstream_count}")
