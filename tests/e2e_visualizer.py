from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


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

    assert page.locator("html").get_attribute("data-theme") == "halo"
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
    page.locator("#fit-view").click()
    page.locator(
        '.graph-edge[data-edge-id="edge.auth-to-request-phase"]'
    ).evaluate(
        "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
    )
    assert "已省略中间节点" in page.locator("#inspector-content").inner_text()
    assert page.locator("#inspector-content [data-open]").count() == 0

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

    page.locator(
        '.graph-edge[data-edge-id="edge.client-runtime-start"]'
    ).click(force=True)
    assert "启动运行时" in page.locator("#inspector-content h2").inner_text()
    assert "codex_app_server::in_process::start" in page.locator(
        "#inspector-content"
    ).inner_text()

    page.locator("#zoom-in").click()
    page.locator("#zoom-in").click()
    page.screenshot(path=str(ARTIFACTS / "callgraph-overview.png"), full_page=True)
    assert not console_errors, f"browser console errors: {console_errors}"
    browser.close()

print(f"E2E OK; upstream node count={upstream_count}")
