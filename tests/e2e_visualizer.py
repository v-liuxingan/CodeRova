import json
import os
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
TEMP_LAYOUTS = Path(__file__).parent / ".tmp-layouts"
BASE_URL = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4317")
shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)


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
    page_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".graph-option")

    document_response = page.request.get(BASE_URL)
    assert "default-src 'self'" in document_response.headers["content-security-policy"]
    assert document_response.headers["x-content-type-options"] == "nosniff"
    assert document_response.headers["referrer-policy"] == "no-referrer"
    assert document_response.headers["x-frame-options"] == "DENY"
    assert "'unsafe-inline'" not in document_response.headers["content-security-policy"]
    preview_document_response = page.request.get(f"{BASE_URL}/monaco-preview.html")
    assert preview_document_response.ok
    assert (
        "style-src 'self' 'unsafe-inline'"
        in preview_document_response.headers["content-security-policy"]
    )
    assert preview_document_response.headers["x-frame-options"] == "SAMEORIGIN"
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

    health = page.request.get(f"{BASE_URL}/api/health")
    assert health.ok
    projects = health.json()["projects"]
    assert len(projects) == 1
    assert projects[0]["id"] == "codex"
    assert projects[0]["rootExists"]

    graphs = page.request.get(f"{BASE_URL}/api/graphs")
    assert graphs.ok
    graph_summaries = graphs.json()
    assert len(graph_summaries) == 4
    assert all(graph["projectId"] == "codex" for graph in graph_summaries)
    assert sum(graph["nodeCount"] for graph in graph_summaries) == 62
    assert sum(graph["edgeCount"] for graph in graph_summaries) == 60
    assert page.locator(".graph-option").count() == 4

    empty_layout = page.request.get(
        f"{BASE_URL}/api/graphs/tui-authorization/layout"
    )
    assert empty_layout.ok
    assert empty_layout.json() == {
        "schemaVersion": "0.1",
        "graph": "tui-authorization",
        "positions": {},
    }
    invalid_layout = page.request.put(
        f"{BASE_URL}/api/graphs/tui-authorization/layout",
        data={
            "schemaVersion": "0.1",
            "graph": "tui-authorization",
            "positions": {
                "vertical": {"missing.node": {"x": 10, "y": 20}}
            },
        },
    )
    assert invalid_layout.status == 400

    for summary in graph_summaries:
        graph_response = page.request.get(
            f"{BASE_URL}/api/graphs/{summary['slug']}"
        )
        assert graph_response.ok
        graph = graph_response.json()
        targets = [("node", graph["root"]), ("edge", graph["edges"][0]["id"])]
        for target_type, target_id in targets:
            link_response = page.request.post(
                f"{BASE_URL}/api/open",
                data={
                    "graph": summary["slug"],
                    "targetType": target_type,
                    "id": target_id,
                },
            )
            assert link_response.ok
            assert link_response.json()["uri"].startswith("vscode://file/E:/")
            preview_response = page.request.post(
                f"{BASE_URL}/api/preview",
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
        f"{BASE_URL}/api/preview",
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
        f"{BASE_URL}/api/preview",
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
        f"{BASE_URL}/api/preview",
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
            branch_labels = page.evaluate(
                """() => {
                    const runtime = document.querySelector(
                        '[data-edge-group-id="shell.output-to-runtime"].graph-edge-label-group'
                    ).getBoundingClientRect();
                    const build = document.querySelector(
                        '[data-edge-group-id="shell.output-to-build"].graph-edge-label-group'
                    ).getBoundingClientRect();
                    const source = document.querySelector(
                        '[data-node-id="stream.handle-output-item"]'
                    ).getBoundingClientRect();
                    return {
                        overlap: !(
                            runtime.right <= build.left
                            || runtime.left >= build.right
                            || runtime.bottom <= build.top
                            || runtime.top >= build.bottom
                        ),
                        runtimeCenter: runtime.left + runtime.width / 2,
                        buildCenter: build.left + build.width / 2,
                        sourceCenter: source.left + source.width / 2,
                    };
                }"""
            )
            assert not branch_labels["overlap"], branch_labels
            assert (
                branch_labels["runtimeCenter"]
                < branch_labels["sourceCenter"]
                < branch_labels["buildCenter"]
            ), branch_labels
            page.locator(".canvas-wrap").screenshot(
                path=str(ARTIFACTS / "edge-label-branches.png")
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
    page.wait_for_selector(".source-workbench")
    page.wait_for_selector('.source-editor-host[data-source-surface="monaco"]')
    assert page.locator("#inspector-details-tab").count() == 0
    assert page.locator("#inspector-source-tab").count() == 0
    assert page.locator("#inspector-summary").is_visible()
    assert page.locator("#inspector-source-pane").is_visible()
    assert "CLI 进程入口" in page.locator("#inspector-content").inner_text()
    assert "arg0 分发器进入异步 cli_main" in page.locator(
        "#inspector-content"
    ).inner_text()
    assert "从 Codex CLI 启动到模型请求鉴权" in page.locator(
        "#graph-overview-description"
    ).inner_text()
    assert page.locator("#graph-overview-start").inner_text() == "main"
    assert page.locator(
        "#graph-overview-end"
    ).inner_text() == "ConfiguredModelProvider::auth 等 2 个"
    assert page.locator("#graph-overview-scale").inner_text() == "19 节点 · 19 关系"
    assert page.locator("#trace-next strong").inner_text() == "cli_main"
    assert "RUST · 目标 956–962" in page.locator(".source-preview-stats").inner_text()
    assert page.locator(".source-engine-badge").inner_text() == "MONACO · READ ONLY"
    assert page.locator(".source-editor-host").get_attribute("data-focus-line") == "956"
    assert page.locator(".source-editor-host").get_attribute("data-focus-end-line") == "962"
    assert page.locator(".source-editor-host").get_attribute("data-read-only") == "true"
    monaco_frame = page.frame_locator(".monaco-source-frame")
    monaco_frame.locator(".monaco-editor").wait_for()
    assert monaco_frame.locator(".monaco-editor").count() == 1
    assert monaco_frame.locator(".monaco-source-focus").count() >= 1
    assert "956" in monaco_frame.locator(".line-numbers").all_text_contents()
    assert "/assets/cursors/canvas-pointer.svg" in page.locator(
        "#graph-canvas"
    ).evaluate("element => getComputedStyle(element.parentElement).cursor")
    assert page.locator(".source-density button").count() == 3
    assert page.locator(".source-density button.active").inner_text() == "标准"
    assert page.locator(".source-scope button.active").inner_text() == "目标范围"
    page.locator(".source-scope button", has_text="完整文件").click()
    page.wait_for_function(
        """() =>
            document.querySelector('.source-scope button.active')?.textContent === '完整文件'
            && document.querySelector('.source-editor-host')?.dataset.previewScope === 'file'
            && document.querySelector('.source-editor-host')?.dataset.startLine === '1'
            && document.querySelector('.source-editor-host')?.getAttribute('aria-busy') === 'false'"""
    )
    assert "完整文件" in page.locator(".source-preview-stats").inner_text()
    assert not page.locator(".source-density").is_visible()
    page.locator(".source-scope button", has_text="目标范围").click()
    page.wait_for_function(
        """() =>
            document.querySelector('.source-scope button.active')?.textContent === '目标范围'
            && document.querySelector('.source-editor-host')?.dataset.previewScope === 'target'
            && document.querySelector('.source-editor-host')?.getAttribute('aria-busy') === 'false'"""
    )
    page.locator(".source-find input").fill("async")
    page.wait_for_function(
        "() => document.querySelector('.source-find span')?.textContent !== '0/0'"
    )
    page.locator(".source-find input").fill("")

    canvas_width_before_resize = page.locator("#graph-canvas").bounding_box()["width"]
    resizer = page.locator("#inspector-resizer")
    resizer_box = resizer.bounding_box()
    assert resizer_box
    initial_resize_class = page.locator("html").get_attribute("class") or ""
    assert "inspector-width-520" in initial_resize_class, initial_resize_class
    page.mouse.move(
        resizer_box["x"] + resizer_box["width"] / 2,
        resizer_box["y"] + 120,
    )
    page.mouse.down()
    page.mouse.move(resizer_box["x"] - 80, resizer_box["y"] + 120, steps=5)
    page.mouse.up()
    resized_class = page.locator("html").get_attribute("class") or ""
    assert "inspector-width-600" in resized_class, resized_class
    assert page.locator("#graph-canvas").bounding_box()["width"] < canvas_width_before_resize
    resizer.focus()
    page.keyboard.press("ArrowRight")
    assert "inspector-width-560" in (page.locator("html").get_attribute("class") or "")
    resizer_box = resizer.bounding_box()
    page.mouse.move(
        resizer_box["x"] + resizer_box["width"] / 2,
        resizer_box["y"] + 120,
    )
    page.mouse.down()
    page.mouse.move(0, resizer_box["y"] + 120, steps=8)
    page.mouse.up()
    assert page.locator(".inspector").bounding_box()["width"] > 1440 / 2
    assert page.locator("#graph-canvas").bounding_box()["width"] >= 280
    wide_canvas_box = page.locator("#graph-canvas").bounding_box()
    wide_inspector_box = page.locator(".inspector").bounding_box()
    assert (
        wide_canvas_box["x"] + wide_canvas_box["width"]
        <= wide_inspector_box["x"] + 1
    ), (wide_canvas_box, wide_inspector_box)
    resizer.dblclick()
    assert "inspector-width-520" in (page.locator("html").get_attribute("class") or "")

    assert "main" in page.locator("#inspector-content h2").inner_text()
    assert page.locator("#inspector-source-pane").is_visible()
    preview_height = page.locator(".source-editor-host").bounding_box()["height"]
    assert preview_height > 430
    page.locator("#inspector-focus").click()
    assert "workbench-focused" in (page.locator(".inspector").get_attribute("class") or "")
    assert page.locator(".inspector").bounding_box()["width"] > 1440 / 2
    focused_canvas_box = page.locator("#graph-canvas").bounding_box()
    focused_inspector_box = page.locator(".inspector").bounding_box()
    assert (
        focused_canvas_box["x"] + focused_canvas_box["width"]
        <= focused_inspector_box["x"] + 1
    ), (focused_canvas_box, focused_inspector_box)
    assert page.locator("#inspector-focus").inner_text() == "还原"
    assert page.locator(".source-editor-host").get_attribute("data-source-surface") == "monaco"
    assert page.locator(".source-preview-body").evaluate("element => element.scrollLeft") == 0
    page.screenshot(path=str(ARTIFACTS / "source-workbench-wide.png"), full_page=True)

    canvas_width_before_collapse = page.locator("#graph-canvas").bounding_box()["width"]
    page.locator("#inspector-collapse").click()
    assert "inspector-collapsed" in (page.locator("html").get_attribute("class") or "")
    assert "workbench-focused" not in (page.locator(".inspector").get_attribute("class") or "")
    assert page.locator(".inspector").bounding_box()["width"] == 44
    assert page.locator("#graph-canvas").bounding_box()["width"] > canvas_width_before_collapse
    page.locator("#inspector-collapse").click()
    assert "inspector-collapsed" not in (page.locator("html").get_attribute("class") or "")
    assert "inspector-width-520" in (page.locator("html").get_attribute("class") or "")

    page.locator(".source-density button", has_text="展开").click()
    page.wait_for_function(
        """() =>
            document.querySelector('.source-density button.active')?.textContent === '展开'
            && document.querySelector('.source-editor-host')?.dataset.sourceSurface === 'monaco'
            && document.querySelector('.source-editor-host')?.getAttribute('aria-busy') === 'false'"""
    )
    assert page.locator(".source-editor-host").get_attribute("data-start-line") == "932"
    monaco_frame.locator(".codicon-folding-expanded").first.wait_for()
    codicon_status = monaco_frame.locator(".codicon-folding-expanded").first.evaluate(
        """async folding => {
            await document.fonts.ready;
            return {
                loaded: document.fonts.check('16px codicon'),
                beforeFont: getComputedStyle(folding, '::before').fontFamily,
                beforeContent: getComputedStyle(folding, '::before').content,
            };
        }"""
    )
    assert codicon_status["loaded"] and "codicon" in codicon_status["beforeFont"], (
        codicon_status
    )
    page.locator('[data-editor-action="foldAll"]').click()
    monaco_frame.locator(".codicon-folding-collapsed").first.wait_for()
    page.locator('[data-editor-action="unfoldAll"]').click()
    monaco_frame.locator(".codicon-folding-expanded").first.wait_for()
    wrap_button = page.locator('[data-editor-action="toggleWrap"]')
    wrap_button.click()
    page.wait_for_function(
        "() => document.querySelector('[data-editor-action=\"toggleWrap\"]')"
        "?.getAttribute('aria-pressed') === 'true'"
    )
    assert wrap_button.get_attribute("aria-pressed") == "true"
    font_before = float(
        monaco_frame.locator(".view-line").first.evaluate(
            "element => Number.parseFloat(getComputedStyle(element).fontSize)"
        )
    )
    page.locator('[data-editor-action="fontLarger"]').click()
    page.wait_for_function(
        """() => {
            const frame = document.querySelector('.monaco-source-frame');
            const line = frame?.contentDocument?.querySelector('.view-line');
            return line && Number.parseFloat(getComputedStyle(line).fontSize) > 12;
        }"""
    )
    font_after = float(
        monaco_frame.locator(".view-line").first.evaluate(
            "element => Number.parseFloat(getComputedStyle(element).fontSize)"
        )
    )
    assert font_after > font_before
    page.locator(".source-density button", has_text="标准").click()
    page.wait_for_function(
        "() => document.querySelector('.source-density button.active')?.textContent === '标准'"
    )

    draggable_node = page.locator('[data-node-id="cli.main"]')
    original_transform = draggable_node.get_attribute("transform")
    draggable_box = draggable_node.bounding_box()
    assert draggable_box
    with page.expect_response(
        lambda response: response.url.endswith("/api/graphs/tui-authorization/layout")
        and response.request.method == "PUT"
    ) as layout_saved:
        page.mouse.move(
            draggable_box["x"] + draggable_box["width"] / 2,
            draggable_box["y"] + draggable_box["height"] / 2,
        )
        page.mouse.down()
        page.mouse.move(
            draggable_box["x"] + draggable_box["width"] / 2 + 72,
            draggable_box["y"] + draggable_box["height"] / 2 + 36,
            steps=6,
        )
        page.mouse.up()
    assert layout_saved.value.ok
    moved_transform = page.locator('[data-node-id="cli.main"]').get_attribute("transform")
    assert moved_transform != original_transform
    saved_layout = page.request.get(
        f"{BASE_URL}/api/graphs/tui-authorization/layout"
    ).json()
    assert "cli.main" in saved_layout["positions"]["vertical"]

    page.reload()
    page.wait_for_load_state("networkidle")
    page.locator(".graph-option", has_text="TUI authorization call graph").click()
    page.wait_for_function(
        "() => document.querySelector('#graph-title')?.textContent === 'TUI authorization call graph'"
    )
    page.wait_for_selector('[data-node-id="cli.main"]')
    assert page.locator('[data-node-id="cli.main"]').get_attribute("transform") == moved_transform
    with page.expect_response(
        lambda response: response.url.endswith("/api/graphs/tui-authorization/layout")
        and response.request.method == "PUT"
    ) as layout_reset:
        page.locator("#reset-layout").click()
    assert layout_reset.value.ok
    assert "cli.main" not in layout_reset.value.json()["positions"]["vertical"]

    source_link = page.request.post(
        f"{BASE_URL}/api/open",
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
        f"{BASE_URL}/api/open",
        data={
            "graph": "tui-authorization",
            "targetType": "edge",
            "id": "edge.auth-to-request-phase",
        },
    )
    assert unavailable_link.status == 400
    unavailable_preview = page.request.post(
        f"{BASE_URL}/api/preview",
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
    assert page.locator("#trace-next strong").inner_text() == "cli_main"

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
    assert page.locator(".source-editor-host").get_attribute("data-focus-line") == "959"
    assert page.locator(".source-editor-host").get_attribute("data-focus-end-line") == "959"

    page.locator("#trace-next").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.cli-main"
    assert page.locator("#trace-previous strong").inner_text() == "main"
    assert page.locator("#trace-next strong").inner_text() == "run_interactive_tui"
    assert page.locator("#trace-callsite").get_attribute(
        "data-trace-edge-id"
    ) == "edge.cli-main-interactive"
    assert "从 Codex CLI 启动到模型请求鉴权" in page.locator(
        "#graph-overview-description"
    ).inner_text()

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
    assert page.locator("#inspector-summary").is_visible()
    assert page.locator("#inspector-source-pane").is_visible()
    assert "当前目标没有精确源码位置" in page.locator(
        ".source-workbench-empty"
    ).inner_text()
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
    page.get_by_role("button", name="上游").click()
    page.wait_for_timeout(100)
    upstream_count = page.locator(".graph-node").count()
    assert 1 < upstream_count < 19
    assert page.locator(".graph-node").evaluate_all(
        """nodes => {
            const canvas = document.querySelector('#graph-canvas').getBoundingClientRect();
            return nodes.every(node => {
                const box = node.getBoundingClientRect();
                return box.left >= canvas.left && box.right <= canvas.right
                    && box.top >= canvas.top && box.bottom <= canvas.bottom;
            });
        }"""
    )

    page.get_by_role("button", name="下游").click()
    page.wait_for_timeout(100)
    downstream_count = page.locator(".graph-node").count()
    assert 1 < downstream_count < 19
    assert page.locator(".graph-node").evaluate_all(
        """nodes => {
            const canvas = document.querySelector('#graph-canvas').getBoundingClientRect();
            return nodes.every(node => {
                const box = node.getBoundingClientRect();
                return box.left >= canvas.left && box.right <= canvas.right
                    && box.top >= canvas.top && box.bottom <= canvas.bottom;
            });
        }"""
    )

    page.get_by_role("button", name="全图").click()
    page.locator("#orientation").click()
    assert page.locator("#orientation").inner_text() == "横向布局"
    edge_rendering = page.locator(
        '.graph-edge-label-group[data-edge-group-id="edge.client-runtime-start"]'
    ).evaluate(
        """group => {
            const card = group.querySelector(".edge-label-card");
            const text = group.querySelector(".edge-callsite");
            const path = document.querySelector(
                '.graph-edge[data-edge-id="edge.client-runtime-start"]'
            );
            const cardRect = card.getBoundingClientRect();
            const length = path.getTotalLength();
            const matrix = path.getScreenCTM();
            const pathCrossesCard = Array.from({ length: 81 }, (_, index) => {
                const point = path.getPointAtLength(length * index / 80)
                    .matrixTransform(matrix);
                return point.x >= cardRect.left && point.x <= cardRect.right
                    && point.y >= cardRect.top && point.y <= cardRect.bottom;
            }).some(Boolean);
            return {
                pathCrossesCard,
                textStroke: getComputedStyle(text).stroke,
                moveCount: (path.getAttribute("d").match(/M/g) || []).length,
            };
        }"""
    )
    assert not edge_rendering["pathCrossesCard"]
    assert edge_rendering["textStroke"] == "none"
    assert edge_rendering["moveCount"] == 1
    page.evaluate(
        """() => {
            const path = document.querySelector(
                '.graph-edge[data-edge-id="edge.client-runtime-start"]'
            );
            const viewport = document.querySelector(".graph-viewport");
            const canvas = document.querySelector("#graph-canvas").getBoundingClientRect();
            const box = path.getBBox();
            const scale = 1.5;
            viewport.setAttribute(
                "transform",
                `translate(${canvas.width / 2 - (box.x + box.width / 2) * scale} `
                    + `${canvas.height / 2 - (box.y + box.height / 2) * scale}) scale(${scale})`
            );
        }"""
    )
    page.locator("#canvas-wrap").screenshot(
        path=str(ARTIFACTS / "edge-label-horizontal.png")
    )
    page.locator("#fit-view").click()

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
    assert not page_errors, f"browser page errors: {page_errors}"
    browser.close()

shutil.rmtree(TEMP_LAYOUTS, ignore_errors=True)
print(f"E2E OK; upstream node count={upstream_count}")
