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
    page.wait_for_selector('[data-node-id="cli.main"]')

    health = page.request.get("http://127.0.0.1:4317/api/health")
    assert health.ok
    projects = health.json()["projects"]
    assert len(projects) == 1
    assert projects[0]["id"] == "codex"
    assert projects[0]["rootExists"]

    graphs = page.request.get("http://127.0.0.1:4317/api/graphs")
    assert graphs.ok
    assert graphs.json()[0]["projectId"] == "codex"

    assert page.locator(".graph-node").count() == 19
    assert "TUI authorization" in page.locator("#graph-title").inner_text()
    assert "38 处源码有效" in page.locator("#validation-badge").inner_text()
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

    page.locator("#fit-view").click()
    page.locator('[data-node-id="core.current-client-setup"]').click()
    assert "ModelClient::current_client_setup" in page.locator("#inspector-content h2").inner_text()
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

    page.locator('[data-edge-id="edge.client-runtime-start"]').click(force=True)
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
