import json
import os
import shutil
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACTS = Path(__file__).parent / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
TEMP_LAYOUTS = Path(__file__).parent / ".tmp-layouts"
BASE_URL = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4317")
TEST_GRAPHS = Path(os.environ.get("CALLGRAPH_TEST_GRAPHS", "graphs"))
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
    rail_scroll_state = page.locator(".rail").evaluate(
        """rail => ({
            clientHeight: rail.clientHeight,
            scrollHeight: rail.scrollHeight,
            scrollbarColor: getComputedStyle(rail).scrollbarColor,
        })"""
    )
    assert rail_scroll_state["scrollHeight"] > rail_scroll_state["clientHeight"]
    assert rail_scroll_state["scrollbarColor"].count("rgba(0, 0, 0, 0)") == 2
    page.locator(".rail").evaluate("rail => { rail.scrollTop = 80; }")
    assert page.locator(".rail").evaluate("rail => rail.scrollTop") > 0
    page.locator(".workspace").hover()

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
    expected_slugs = {
        "codex-config-resolution",
        "codex-context-compaction",
        "codex-end-to-end-agent-loop",
        "codex-mcp-tool-call",
        "codex-shell-tool-execution",
        "codex-thread-resume",
        "codex-turn-lifecycle",
        "tui-authorization",
    }
    assert {graph["slug"] for graph in graph_summaries} == expected_slugs
    assert all(graph["projectId"] == "codex" for graph in graph_summaries)
    assert sum(graph["nodeCount"] for graph in graph_summaries) == 171
    assert sum(graph["edgeCount"] for graph in graph_summaries) == 197
    assert page.locator(".graph-option").count() == 8
    expected_category_counts = {
        "全景流程": 1,
        "会话运行": 2,
        "工具执行": 3,
        "配置与上下文": 2,
    }
    expected_category_id_counts = {
        "overview": 1,
        "session": 2,
        "tools": 3,
        "context": 2,
    }
    assert Counter(
        graph["category"] for graph in graph_summaries
    ) == expected_category_counts
    assert Counter(
        graph["categoryId"] for graph in graph_summaries
    ) == expected_category_id_counts
    assert page.locator(".graph-category").evaluate_all(
        "groups => groups.map(group => group.dataset.category)"
    ) == list(expected_category_counts)
    assert page.locator(".graph-category").evaluate_all(
        """groups => Object.fromEntries(groups.map(group => [
            group.dataset.category,
            group.querySelectorAll(".graph-option").length,
        ]))"""
    ) == expected_category_counts
    category_toggles = page.locator(".graph-category-header")
    assert category_toggles.count() == 4
    assert category_toggles.evaluate_all(
        "buttons => buttons.map(button => button.getAttribute('aria-expanded'))"
    ) == ["true", "true", "true", "true"]
    tools_category = page.locator('.graph-category[data-category-id="tools"]')
    tools_toggle = tools_category.locator(".graph-category-header")
    tools_items = tools_category.locator(".graph-category-items")
    tools_toggle.click()
    assert tools_toggle.get_attribute("aria-expanded") == "false"
    assert tools_items.is_hidden()
    assert page.evaluate(
        "() => JSON.parse(localStorage.getItem('callgraph.catalog.collapsed.v1'))"
    ) == ["tools"]
    page.reload(wait_until="networkidle")
    tools_category = page.locator('.graph-category[data-category-id="tools"]')
    tools_toggle = tools_category.locator(".graph-category-header")
    tools_items = tools_category.locator(".graph-category-items")
    assert tools_toggle.get_attribute("aria-expanded") == "false"
    assert tools_items.is_hidden()
    tools_toggle.focus()
    page.keyboard.press("Enter")
    assert tools_toggle.get_attribute("aria-expanded") == "true"
    assert tools_items.is_visible()
    assert page.evaluate(
        "() => JSON.parse(localStorage.getItem('callgraph.catalog.collapsed.v1'))"
    ) == []
    rail_toggle = page.locator("#rail-collapse")
    assert rail_toggle.get_attribute("aria-expanded") == "true"
    workspace_before_collapse = page.locator(".workspace").bounding_box()
    rail_toggle.click()
    assert "rail-collapsed" in (page.locator("html").get_attribute("class") or "")
    assert rail_toggle.get_attribute("aria-expanded") == "false"
    assert page.locator(".rail-section").first.is_hidden()
    workspace_after_collapse = page.locator(".workspace").bounding_box()
    assert workspace_after_collapse["width"] > workspace_before_collapse["width"]
    assert page.evaluate(
        "() => localStorage.getItem('callgraph.rail.collapsed.v1')"
    ) == "true"
    page.reload(wait_until="networkidle")
    rail_toggle = page.locator("#rail-collapse")
    assert "rail-collapsed" in (page.locator("html").get_attribute("class") or "")
    assert rail_toggle.get_attribute("aria-expanded") == "false"
    rail_toggle.click()
    assert "rail-collapsed" not in (
        page.locator("html").get_attribute("class") or ""
    )
    assert page.evaluate(
        "() => localStorage.getItem('callgraph.rail.collapsed.v1')"
    ) == "false"
    catalog_slugs = page.locator(".graph-option").evaluate_all(
        "buttons => buttons.map(button => button.dataset.slug)"
    )
    assert len(catalog_slugs) == len(set(catalog_slugs)) == 8
    category_by_slug = {
        graph["slug"]: graph["category"] for graph in graph_summaries
    }
    assert page.locator(".graph-option").evaluate_all(
        """buttons => Object.fromEntries(buttons.map(button => [
            button.dataset.slug,
            button.dataset.category,
        ]))"""
    ) == category_by_slug
    first_catalog_slug = page.locator(".graph-option").first.get_attribute(
        "data-slug"
    )
    assert first_catalog_slug == "codex-end-to-end-agent-loop"
    assert page.locator(".graph-option.active").count() == 1
    assert page.locator(".graph-option.active").get_attribute(
        "data-slug"
    ) == first_catalog_slug
    first_catalog_title = next(
        graph["title"]
        for graph in graph_summaries
        if graph["slug"] == first_catalog_slug
    )
    assert page.locator("#graph-title").inner_text() == first_catalog_title

    legacy_path = TEST_GRAPHS / "legacy-default.json"
    legacy_graph = json.loads(
        (TEST_GRAPHS / "overview" / "codex-end-to-end-agent-loop.json").read_text(
            encoding="utf-8"
        )
    )
    legacy_graph.pop("categoryId", None)
    legacy_graph.pop("category", None)
    legacy_path.write_text(
        json.dumps(legacy_graph, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    default_summary = next(
        graph
        for graph in page.request.get(f"{BASE_URL}/api/graphs").json()
        if graph["slug"] == "legacy-default"
    )
    assert default_summary["categoryId"] == "uncategorized"
    assert default_summary["category"] == "未分类"
    legacy_path.unlink()

    category_edit = page.locator(
        '.graph-category-edit[data-slug="tui-authorization"]'
    )
    category_edit.click()
    assert page.locator("#category-editor").is_visible()
    page.locator("#category-editor-select").select_option("__new__")
    page.locator("#category-editor-name").fill("临时验证分类")
    with page.expect_response(
        lambda response: response.url.endswith(
            "/api/graphs/tui-authorization/category"
        )
        and response.request.method == "PUT"
    ) as category_response:
        page.locator("#category-editor-save").click()
    assert category_response.value.ok
    category_payload = category_response.value.json()
    temporary_category_id = category_payload["categoryId"]
    assert temporary_category_id.startswith("custom-")
    page.wait_for_selector(
        f'.graph-category[data-category-id="{temporary_category_id}"]'
    )
    assert (
        TEST_GRAPHS / temporary_category_id / "tui-authorization.json"
    ).is_file()
    assert not (TEST_GRAPHS / "tools" / "tui-authorization.json").exists()

    page.locator(
        '.graph-category-edit[data-slug="tui-authorization"]'
    ).click()
    page.locator("#category-editor-select").select_option("tools")
    with page.expect_response(
        lambda response: response.url.endswith(
            "/api/graphs/tui-authorization/category"
        )
        and response.request.method == "PUT"
    ) as restore_category_response:
        page.locator("#category-editor-save").click()
    assert restore_category_response.value.ok
    page.wait_for_selector(
        '.graph-category[data-category-id="tools"] '
        '.graph-option[data-slug="tui-authorization"]'
    )
    assert (TEST_GRAPHS / "tools" / "tui-authorization.json").is_file()
    assert not (TEST_GRAPHS / temporary_category_id).exists()

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
        exact_edge = next(
            edge
            for edge in graph["edges"]
            if edge.get("callSiteStatus", "exact") == "exact"
        )
        targets = [("node", graph["root"]), ("edge", exact_edge["id"])]
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
        "Codex layered configuration resolution": (10, 23),
        "Codex automatic context compaction": (17, 34),
        "Codex end-to-end agent turn and context loop": (49, 91),
        "Codex MCP tool call lifecycle": (15, 30),
        "Codex shell tool approval and sandbox execution": (21, 41),
        "Codex persisted thread resume": (16, 33),
        "Codex interactive turn lifecycle": (20, 37),
        "TUI authorization call graph": (23, 44),
    }
    for title, (node_count, source_location_count) in expected_graphs.items():
        graph_button = page.locator(".graph-option", has_text=title)
        selected_slug = graph_button.get_attribute("data-slug")
        graph_button.click()
        page.wait_for_function(
            "(title) => document.querySelector('#graph-title')?.textContent === title",
            arg=title,
        )
        assert page.locator(".graph-option.active").count() == 1
        assert page.locator(".graph-option.active").get_attribute(
            "data-slug"
        ) == selected_slug
        page.wait_for_function(
            "(count) => document.querySelectorAll('.graph-node').length === count",
            arg=node_count,
        )
        page.wait_for_function(
            "(text) => document.querySelector('#validation-badge')?.textContent === text",
            arg=f"{source_location_count} 处源码有效",
        )
        if title == "Codex automatic context compaction":
            long_description = (
                "原子替换活动历史，更新 WorldState 基线，持久化 "
                "Compacted/TurnContext 项并安排 compact session-start hook。"
            )
            page.locator('[data-node-id="compact.replace-history"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_selector("#inspector-content.node-detail")
            page.wait_for_selector(".source-workbench")
            purpose = page.locator(".node-purpose")
            description = page.locator(".node-purpose-description")
            assert purpose.count() == 1
            assert description.inner_text() == long_description
            assert page.locator("#inspector-content").evaluate(
                """content => {
                    const purpose = content.querySelector(".node-purpose");
                    const facts = content.querySelector(".inspect-facts");
                    const actions = content.querySelector(".inspect-actions");
                    return Boolean(
                        purpose && facts && actions
                        && purpose.compareDocumentPosition(facts)
                            & Node.DOCUMENT_POSITION_FOLLOWING
                        && purpose.compareDocumentPosition(actions)
                            & Node.DOCUMENT_POSITION_FOLLOWING
                    );
                }"""
            )
            purpose_style = purpose.evaluate(
                """element => {
                    const style = getComputedStyle(element);
                    const copy = getComputedStyle(
                        element.querySelector(".node-purpose-description")
                    );
                    return {
                        background: style.backgroundColor,
                        borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
                        borderLeftColor: style.borderLeftColor,
                        fontSize: Number.parseFloat(copy.fontSize),
                        lineHeight: Number.parseFloat(copy.lineHeight),
                        color: copy.color,
                    };
                }"""
            )
            assert purpose_style["background"] not in (
                "rgba(0, 0, 0, 0)",
                "transparent",
            )
            assert purpose_style["borderLeftWidth"] >= 3
            assert purpose_style["fontSize"] >= 13
            assert (
                purpose_style["lineHeight"] / purpose_style["fontSize"]
            ) >= 1.5
            compact_spacing = page.evaluate(
                """() => {
                    const summary = document.querySelector("#inspector-summary");
                    const content = document.querySelector("#inspector-content");
                    const source = document.querySelector("#inspector-source-pane");
                    const summaryBox = summary.getBoundingClientRect();
                    const contentBox = content.getBoundingClientRect();
                    const sourceBox = source.getBoundingClientRect();
                    return {
                        trailingBlank: summaryBox.bottom - contentBox.bottom,
                        sourceGap: sourceBox.top - summaryBox.bottom,
                        summaryHeight: summaryBox.height,
                    };
                }"""
            )
            assert -1 <= compact_spacing["trailingBlank"] <= 24, compact_spacing
            assert abs(compact_spacing["sourceGap"]) <= 2, compact_spacing
            assert page.locator("#inspector-source-pane").is_visible()
            assert page.locator(".source-editor-host").is_visible()

            long_summary = description.evaluate(
                """(element, original) => {
                    element.textContent = Array.from(
                        { length: 24 },
                        (_, index) => `${index + 1}. ${original}`
                    ).join(" ");
                    const summary = document.querySelector("#inspector-summary");
                    const source = document.querySelector("#inspector-source-pane");
                    const summaryBox = summary.getBoundingClientRect();
                    const sourceBox = source.getBoundingClientRect();
                    return {
                        height: summaryBox.height,
                        clientHeight: summary.clientHeight,
                        scrollHeight: summary.scrollHeight,
                        overflowY: getComputedStyle(summary).overflowY,
                        sourceGap: sourceBox.top - summaryBox.bottom,
                    };
                }""",
                long_description,
            )
            assert long_summary["height"] <= 361, long_summary
            assert long_summary["scrollHeight"] > long_summary["clientHeight"] + 20
            assert long_summary["overflowY"] in ("auto", "scroll")
            assert abs(long_summary["sourceGap"]) <= 2, long_summary
            assert page.locator("#inspector-source-pane").is_visible()
            description.evaluate(
                "(element, original) => element.textContent = original",
                long_description,
            )
            assert description.inner_text() == long_description
            page.locator(".inspector").screenshot(
                path=str(ARTIFACTS / "node-purpose-detail.png")
            )

            resizer = page.locator("#inspector-resizer")
            resizer.focus()
            for _ in range(5):
                page.keyboard.press("ArrowRight")
            assert "inspector-width-320" in (
                page.locator("html").get_attribute("class") or ""
            )
            assert page.locator(".inspector").bounding_box()["width"] == 320
            assert page.locator("#inspector-summary").is_visible()
            assert page.locator("#inspector-source-pane").is_visible()
            assert page.locator(".source-editor-host").is_visible()
            narrow_spacing = page.evaluate(
                """() => {
                    const summary = document.querySelector("#inspector-summary")
                        .getBoundingClientRect();
                    const content = document.querySelector("#inspector-content")
                        .getBoundingClientRect();
                    const source = document.querySelector("#inspector-source-pane")
                        .getBoundingClientRect();
                    return {
                        trailingBlank: summary.bottom - content.bottom,
                        sourceGap: source.top - summary.bottom,
                    };
                }"""
            )
            assert -1 <= narrow_spacing["trailingBlank"] <= 24, narrow_spacing
            assert abs(narrow_spacing["sourceGap"]) <= 2, narrow_spacing
            assert page.locator(".inspector-stage").evaluate(
                """stage => [stage, stage.querySelector(".inspect-content"),
                    stage.querySelector(".node-purpose")].every(element =>
                        element && element.scrollWidth <= element.clientWidth + 1
                    )"""
            )
            resizer.focus()
            page.keyboard.press("Home")
            assert "inspector-width-520" in (
                page.locator("html").get_attribute("class") or ""
            )

            page.locator("#theme-select").select_option("aether")
            assert page.locator("html").get_attribute("data-theme") == "aether"
            dark_style = purpose.evaluate(
                """element => {
                    const style = getComputedStyle(element);
                    const copy = getComputedStyle(
                        element.querySelector(".node-purpose-description")
                    );
                    return {
                        background: style.backgroundColor,
                        border: style.borderLeftColor,
                        copy: copy.color,
                    };
                }"""
            )
            assert dark_style["background"] not in (
                "rgba(0, 0, 0, 0)",
                "transparent",
            )
            assert dark_style["border"] not in (
                "rgba(0, 0, 0, 0)",
                "transparent",
            )
            assert dark_style["copy"] != dark_style["background"]
            page.locator("#theme-select").select_option("halo")
            assert page.locator("html").get_attribute("data-theme") == "halo"
        if title == "Codex layered configuration resolution":
            page.locator("#fit-view").click()
            assert page.locator("#graph-canvas").get_attribute(
                "data-layout-mode"
            ) == "narrative"
            assert page.locator("#branch-scenarios").count() == 0
            assert page.locator(".runtime-region").count() == 0
            assert page.locator(".runtime-continuation").count() == 0
            assert page.locator(".runtime-transition").count() == 0
            fork = page.locator(
                '[data-node-id="config.load-layer-stack"] [data-fork-count]'
            )
            assert fork.get_attribute("data-fork-count") == "4"
            branch_geometry = page.evaluate(
                """() => {
                    const center = (id) => {
                        const box = document.querySelector(
                            `[data-node-id="${id}"]`
                        ).getBoundingClientRect();
                        return box.left + box.width / 2;
                    };
                    const spine = center("config.load-layer-stack");
                    const children = [
                        "config.load-managed",
                        "config.compose-requirements",
                        "config.thread-loader",
                        "config.load-project-layers",
                    ].map(center);
                    return {
                        spine,
                        children,
                        left: children.filter((value) => value < spine).length,
                        right: children.filter((value) => value > spine).length,
                        aligned: children.filter(
                            (value) => Math.abs(value - spine) < 1
                        ).length,
                    };
                }"""
            )
            assert branch_geometry["left"] >= 1, branch_geometry
            assert branch_geometry["right"] >= 1, branch_geometry
            assert branch_geometry["aligned"] == 1, branch_geometry
            page.locator('[data-kind="trait-dispatch"]').click()
            assert page.locator(
                '[data-node-id="config.load-layer-stack"] [data-fork-count]'
            ).get_attribute("data-fork-count") == "3"
            page.locator('[data-kind="trait-dispatch"]').click()
            assert page.locator(
                '[data-node-id="config.load-layer-stack"] [data-fork-count]'
            ).get_attribute("data-fork-count") == "4"
            data_edge = page.locator(
                '.data-edge-layer [data-edge-group-id="config.managed-to-stack"]'
            )
            assert data_edge.count() == 1
            assert float(data_edge.evaluate(
                "element => getComputedStyle(element).opacity"
            )) < 0.5
            page.locator(
                '[data-edge-hit-id="config.managed-to-stack"]'
            ).evaluate(
                "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            assert data_edge.get_attribute("class").endswith("selected")
            assert float(data_edge.evaluate(
                "element => getComputedStyle(element).opacity"
            )) == 1
            page.locator(".canvas-wrap").screenshot(
                path=str(ARTIFACTS / "narrative-config-branches.png")
            )
            fork_node = page.locator('[data-node-id="config.load-layer-stack"]')
            fork_box = fork_node.locator(".node-box").bounding_box()
            assert fork_box
            page.mouse.move(
                fork_box["x"] + fork_box["width"] / 2,
                fork_box["y"] + fork_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                fork_box["x"] + fork_box["width"] / 2 + 24,
                fork_box["y"] + fork_box["height"] / 2 + 18,
                steps=4,
            )
            page.mouse.up()
            fork_node = page.locator('[data-node-id="config.load-layer-stack"]')
            assert fork_node.locator("[data-fork-count]").get_attribute(
                "data-fork-count"
            ) == "4"
            group_outline = fork_node.evaluate(
                """element => {
                    const style = getComputedStyle(element);
                    return {
                        style: style.outlineStyle,
                        width: style.outlineWidth,
                    };
                }"""
            )
            assert group_outline == {"style": "none", "width": "0px"}, group_outline

            fork_node.focus()
            page.keyboard.press("Tab")
            page.keyboard.press("Shift+Tab")
            page.wait_for_function(
                """() => {
                    const node = document.querySelector(
                        '[data-node-id="config.load-layer-stack"]'
                    );
                    const box = node?.querySelector(".node-box");
                    return node?.matches(":focus-visible")
                        && Number.parseFloat(getComputedStyle(box).strokeWidth) >= 2;
                }"""
            )
            keyboard_focus = fork_node.evaluate(
                """element => {
                    const box = element.querySelector(".node-box");
                    const style = getComputedStyle(box);
                    return {
                        focusVisible: element.matches(":focus-visible"),
                        stroke: style.stroke,
                        strokeWidth: Number.parseFloat(style.strokeWidth),
                    };
                }"""
            )
            assert keyboard_focus["focusVisible"], keyboard_focus
            assert keyboard_focus["stroke"] != "none", keyboard_focus
            assert keyboard_focus["strokeWidth"] >= 2, keyboard_focus
        if title == "Codex end-to-end agent turn and context loop":
            page.locator("#fit-view").click()
            assert page.locator("#graph-canvas").get_attribute(
                "data-layout-mode"
            ) == "narrative"
            assert page.locator("#branch-scenarios").count() == 0
            assert page.locator(".runtime-region").count() == 0
            assert page.locator(".runtime-continuation").count() == 0
            assert page.locator(".runtime-transition").count() == 0
            assert page.locator(".node-decision-marker").count() == 0
            assert page.locator(".graph-node.path-focused").count() == 0
            assert page.locator(".graph-node.path-dimmed").count() == 0

            forward_geometry = page.evaluate(
                """() => {
                    const nodeMain = (id) => {
                        const node = document.querySelector(
                            `[data-node-id="${id}"]`
                        );
                        return node.transform.baseVal.consolidate().matrix.f;
                    };
                    const groups = [
                        ...document.querySelectorAll(
                            ".edge-layer > .graph-edge-group"
                            + '[data-routing-role="forward"]'
                        ),
                        ...document.querySelectorAll(
                            ".data-edge-layer > .graph-edge-group"
                            + '[data-routing-role="forward"]'
                        ),
                    ];
                    return {
                        count: groups.length,
                        backwards: groups
                            .filter((group) =>
                                nodeMain(group.dataset.toNodeId)
                                <= nodeMain(group.dataset.fromNodeId))
                            .map((group) => group.dataset.edgeGroupId),
                    };
                }"""
            )
            assert forward_geometry["count"] > 0
            assert forward_geometry["backwards"] == [], forward_geometry
            feedback_geometry = page.evaluate(
                """() => {
                    const nodeBounds = document.querySelector(
                        ".node-layer"
                    ).getBBox();
                    return [
                        ...document.querySelectorAll(
                            '.graph-edge-group[data-routing-role="feedback"]'
                            + ":not(.graph-edge-label-group)"
                        ),
                    ].map((group) => {
                        const path = group.querySelector(".graph-edge");
                        const box = path.getBBox();
                        return {
                            id: group.dataset.edgeGroupId,
                            path: path.getAttribute("d"),
                            outside:
                                box.x < nodeBounds.x - 1
                                || box.x + box.width
                                    > nodeBounds.x + nodeBounds.width + 1,
                        };
                    });
                }"""
            )
            assert sorted(item["id"] for item in feedback_geometry) == [
                "e2e.compacted-history-to-prompt",
                "e2e.history-back-to-prompt",
            ], feedback_geometry
            assert all(item["outside"] for item in feedback_geometry), feedback_geometry
            assert all(
                " H " in item["path"] and " V " in item["path"]
                for item in feedback_geometry
            ), feedback_geometry
            default_feedback_style = page.evaluate(
                """() => {
                    const group = document.querySelector(
                        '[data-edge-group-id="e2e.history-back-to-prompt"]'
                        + ":not(.graph-edge-label-group)"
                    );
                    const path = group.querySelector(".graph-edge");
                    const labelGroup = document.querySelector(
                        '[data-edge-group-id="e2e.history-back-to-prompt"]'
                        + ".graph-edge-label-group"
                    );
                    const card = labelGroup.querySelector(".edge-label-card");
                    const label = labelGroup.querySelector(".edge-label");
                    const callsite = labelGroup.querySelector(".edge-callsite");
                    const pathStyle = getComputedStyle(path);
                    const cardStyle = getComputedStyle(card);
                    return {
                        opacity: Number.parseFloat(pathStyle.opacity),
                        strokeWidth: Number.parseFloat(pathStyle.strokeWidth),
                        marker: path.getAttribute("marker-end"),
                        labelOpacity: Number.parseFloat(
                            getComputedStyle(labelGroup).opacity
                        ),
                        cardFill: cardStyle.fill,
                        cardStroke: cardStyle.stroke,
                        cardStrokeWidth: Number.parseFloat(cardStyle.strokeWidth),
                        labelFill: getComputedStyle(label).fill,
                        callsiteFill: getComputedStyle(callsite).fill,
                    };
                }"""
            )
            assert default_feedback_style["opacity"] >= 0.82, default_feedback_style
            assert default_feedback_style["strokeWidth"] >= 1.7, default_feedback_style
            assert default_feedback_style["marker"] == "url(#arrow-feedback)"
            assert default_feedback_style["labelOpacity"] == 1
            assert default_feedback_style["cardFill"] != "none"
            assert default_feedback_style["cardStroke"] != "none"
            assert default_feedback_style["cardStrokeWidth"] >= 1.1
            assert default_feedback_style["labelFill"] != "none"
            assert default_feedback_style["callsiteFill"] != "none"
            page.locator(".workspace").screenshot(
                path=str(ARTIFACTS / "narrative-agent-loop.png")
            )
            assert page.locator(
                '[data-node-id="e2e.build-prompt"] .collapse-toggle'
            ).count() == 0
            assert page.locator(
                '[data-node-id="e2e.http-stream"] .collapse-toggle'
            ).count() == 1

            empty_canvas_point = page.evaluate(
                """() => {
                    const canvas = document.querySelector("#graph-canvas");
                    const box = canvas.getBoundingClientRect();
                    for (const y of [box.bottom - 24, box.top + 24]) {
                        for (const x of [box.left + 24, box.right - 24]) {
                            const target = document.elementFromPoint(x, y);
                            if (
                                target
                                && !target.closest(
                                    ".graph-node, .graph-edge-group"
                                )
                            ) return { x, y };
                        }
                    }
                    return { x: box.left + 18, y: box.bottom - 18 };
                }"""
            )
            fit_transform = page.locator(".graph-viewport").get_attribute("transform")
            page.mouse.move(empty_canvas_point["x"], empty_canvas_point["y"])
            page.mouse.wheel(0, -360)
            zoom_transform = page.locator(".graph-viewport").get_attribute("transform")
            assert zoom_transform != fit_transform
            page.mouse.down()
            page.mouse.move(
                empty_canvas_point["x"] + 47,
                empty_canvas_point["y"] - 31,
                steps=4,
            )
            page.mouse.up()
            scenario_camera = page.locator(".graph-viewport").get_attribute("transform")
            assert scenario_camera != zoom_transform

            page.locator("#inspector-collapse").click()
            page.wait_for_function(
                "() => document.documentElement.classList.contains("
                "'inspector-collapsed')"
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            page.locator("#inspector-collapse").click()
            page.wait_for_function(
                "() => !document.documentElement.classList.contains("
                "'inspector-collapsed')"
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            page.locator('[data-kind="callback"]').click()
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            page.locator('[data-kind="callback"]').click()
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            page.locator("#orientation").click()
            assert page.locator("#orientation").inner_text() == "横向布局"
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            page.locator("#orientation").click()
            assert page.locator("#orientation").inner_text() == "纵向布局"
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            page.locator(
                '[data-node-id="e2e.http-stream"] .collapse-toggle'
            ).evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert page.locator(".graph-node").count() == 48
            assert page.locator('[data-node-id="e2e.responses-http"]').count() == 0
            assert page.locator('[data-node-id="e2e.handle-output"]').count() == 1
            assert page.locator('[data-node-id="e2e.websocket-stream"]').count() == 1
            assert page.locator('[data-node-id="e2e.model-stream"]').count() == 1
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            page.locator(
                '[data-node-id="e2e.http-stream"] .collapse-toggle'
            ).evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert page.locator(".graph-node").count() == 49
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            page.locator('[data-node-id="e2e.http-stream"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_function(
                "() => document.querySelector("
                "'[data-node-id=\"e2e.http-stream\"].path-origin'"
                ")"
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            assert page.locator(".graph-node").count() == 49
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.http-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.handle-output"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.websocket-stream"]')
                .get_attribute("class") or ""
            )
            assert page.locator(
                '[data-edge-group-id="e2e.model-to-http"]'
                ":not(.graph-edge-label-group)"
            ).get_attribute("class").find("path-focused") >= 0
            opacity = page.evaluate(
                """() => ({
                    focused: Number.parseFloat(getComputedStyle(
                        document.querySelector(
                            '[data-node-id="e2e.http-stream"]'
                        )
                    ).opacity),
                    dimmed: Number.parseFloat(getComputedStyle(
                        document.querySelector(
                            '[data-node-id="e2e.websocket-stream"]'
                        )
                    ).opacity),
                })"""
            )
            assert opacity["focused"] > opacity["dimmed"], opacity

            page.locator('[data-node-id="e2e.model-stream"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_function(
                "() => document.querySelector("
                "'[data-node-id=\"e2e.model-stream\"].path-origin'"
                ")"
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.http-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.handle-output"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.websocket-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator(
                    '[data-edge-group-id="e2e.model-to-http"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert "path-focused" not in (
                page.locator(
                    '[data-edge-group-id="e2e.model-to-websocket"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )

            page.locator('[data-node-id="e2e.mcp-handler"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_function(
                "() => document.querySelector("
                "'[data-node-id=\"e2e.mcp-handler\"].path-origin'"
                ")"
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera
            assert page.locator(".graph-node").count() == 49
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.mcp-remote"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.drain-tools"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.shell-handler"]')
                .get_attribute("class") or ""
            )

            page.locator('[data-node-id="e2e.turn-start-client"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.locator('[data-node-id="e2e.turn-steer-client"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.turn-start-client"]')
                .get_attribute("class") or ""
            )
            page.locator('[data-node-id="e2e.run-turn"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert "path-origin" in (
                page.locator('[data-node-id="e2e.run-turn"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.turn-steer-client"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.turn-start-client"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator(
                    '[data-edge-group-id="e2e.steer-back-to-turn"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert page.locator("#trace-next").get_attribute(
                "data-trace-node-id"
            ) == "e2e.pre-sampling-compact"
            assert page.locator(
                '[data-edge-group-id="e2e.turn-to-pre-compact"]'
                ".graph-edge-label-group"
            ).get_attribute("data-execution-order") == "1"
            ordered_same_level_x = page.evaluate(
                """ids => ids.map(id => document.querySelector(
                    `[data-node-id="${id}"]`
                ).transform.baseVal.consolidate().matrix.e)""",
                [
                    "e2e.pre-sampling-compact",
                    "e2e.capture-step-context",
                    "e2e.build-skills-plugins",
                    "e2e.record-inputs",
                    "e2e.run-sampling",
                ],
            )
            assert ordered_same_level_x == sorted(ordered_same_level_x)
            assert page.locator(
                '[data-edge-group-id="e2e.turn-to-pre-compact"]'
                ".graph-edge-label-group .edge-label"
            ).text_content().startswith("[01]")
            page.locator("#trace-branch-trigger").click()
            first_ordered_branch = page.locator(
                ".trace-branch-option"
            ).first
            assert first_ordered_branch.get_attribute(
                "data-trace-branch-id"
            ) == "e2e.turn-to-pre-compact"
            assert "第 01 步" in (
                first_ordered_branch.locator("small").inner_text()
            )
            page.locator(".workspace").screenshot(
                path=str(ARTIFACTS / "execution-order-run-turn.png")
            )
            page.keyboard.press("Escape")
            page.locator(
                '[data-edge-hit-id="e2e.turn-to-step-context"]'
            ).evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert "CALL ORDER第 2 步" in (
                page.locator("#inspector-content").inner_text()
            )
            with page.expect_response(
                lambda response: response.url.endswith(
                    "/api/graphs/codex-end-to-end-agent-loop/layout"
                )
                and response.request.method == "PUT"
            ):
                page.locator("#reset-layout").click()
            stable_ordered_ids = [
                "e2e.capture-step-context",
                "e2e.build-skills-plugins",
                "e2e.record-inputs",
                "e2e.run-sampling",
            ]
            stable_ordered_transforms = {
                node_id: page.locator(
                    f'[data-node-id="{node_id}"]'
                ).get_attribute("transform")
                for node_id in stable_ordered_ids
            }
            dragged_ordered_node = page.locator(
                '[data-node-id="e2e.pre-sampling-compact"]'
            )
            ordered_drag_before = dragged_ordered_node.get_attribute("transform")
            ordered_drag_box = dragged_ordered_node.bounding_box()
            assert ordered_drag_box
            with page.expect_response(
                lambda response: response.url.endswith(
                    "/api/graphs/codex-end-to-end-agent-loop/layout"
                )
                and response.request.method == "PUT"
            ):
                page.mouse.move(
                    ordered_drag_box["x"] + ordered_drag_box["width"] / 2,
                    ordered_drag_box["y"] + ordered_drag_box["height"] / 2,
                )
                page.mouse.down()
                page.mouse.move(
                    ordered_drag_box["x"] + ordered_drag_box["width"] / 2 - 54,
                    ordered_drag_box["y"] + ordered_drag_box["height"] / 2 + 24,
                    steps=6,
                )
                page.mouse.up()
            assert dragged_ordered_node.get_attribute(
                "transform"
            ) != ordered_drag_before
            for node_id, transform in stable_ordered_transforms.items():
                assert page.locator(
                    f'[data-node-id="{node_id}"]'
                ).get_attribute("transform") == transform
            with page.expect_response(
                lambda response: response.url.endswith(
                    "/api/graphs/codex-end-to-end-agent-loop/layout"
                )
                and response.request.method == "PUT"
            ):
                page.locator("#reset-layout").click()

            page.locator("#graph-canvas").evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_function(
                """() => document.querySelectorAll(
                    ".graph-node.path-focused, .graph-node.path-dimmed"
                ).length === 0"""
            )
            assert page.locator(".graph-node").count() == 49
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            http_edge_group = page.locator(
                '[data-edge-group-id="e2e.model-to-http"]'
                ":not(.graph-edge-label-group)"
            )
            assert http_edge_group.get_attribute("data-flow-kind") == "fallback"
            http_edge_aria = http_edge_group.get_attribute("aria-label") or ""
            assert "控制流 降级" in http_edge_aria
            assert "!websocket_available || websocket_failed" in http_edge_aria
            http_edge_title = http_edge_group.locator("title").text_content() or ""
            assert "控制流 降级" in http_edge_title
            assert "!websocket_available || websocket_failed" in http_edge_title
            page.locator('[data-edge-hit-id="e2e.model-to-http"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            evidence_summary = (
                page.locator("#inspector-content").text_content() or ""
            )
            assert "EDGE /" in evidence_summary
            assert "HTTP" in evidence_summary
            assert ".rs:" in evidence_summary
            assert "CONTROL FLOW降级" in evidence_summary
            assert "CONDITION!websocket_available || websocket_failed" in evidence_summary
            assert page.locator(".node-purpose").count() == 0
            assert "path-focused" in (
                http_edge_group.get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.model-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.http-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator('[data-node-id="e2e.handle-output"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="e2e.websocket-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" not in (
                page.locator(
                    '[data-edge-group-id="e2e.model-to-websocket"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == scenario_camera

            loop_edge_group = page.locator(
                '[data-edge-group-id="e2e.history-back-to-prompt"]'
                ":not(.graph-edge-label-group)"
            )
            assert loop_edge_group.get_attribute("data-flow-kind") == "loop-back"
            loop_edge_aria = loop_edge_group.get_attribute("aria-label") or ""
            assert "控制流 循环回边" in loop_edge_aria
            assert "needs_follow_up" in loop_edge_aria
            page.locator(
                '[data-edge-hit-id="e2e.history-back-to-prompt"]'
            ).evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            loop_summary = page.locator("#inspector-content").text_content() or ""
            assert "CONTROL FLOW循环回边" in loop_summary
            assert "CONDITIONneeds_follow_up" in loop_summary
            page.locator("#orientation").click()
            assert page.locator("#orientation").inner_text() == "横向布局"
            assert page.locator("#graph-canvas").get_attribute(
                "data-layout-mode"
            ) == "narrative"
            assert page.locator(".runtime-region").count() == 0
            assert page.locator(".runtime-continuation").count() == 0
            assert page.locator(".runtime-transition").count() == 0
            assert page.locator(".graph-node").evaluate_all(
                """nodes => nodes.every(node => {
                    const box = node.getBoundingClientRect();
                    return Number.isFinite(box.x)
                        && Number.isFinite(box.y)
                        && box.width > 0
                        && box.height > 0;
                })"""
            )
            page.locator("#orientation").click()
            assert page.locator("#orientation").inner_text() == "纵向布局"
        if title == "Codex interactive turn lifecycle":
            turn_camera = page.locator(".graph-viewport").get_attribute("transform")
            page.locator('[data-node-id="core.handle-output-item"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="core.model-client-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" not in (
                page.locator(
                    '[data-edge-group-id="turn.try-to-model-stream"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == turn_camera

            page.locator('[data-node-id="core.run-turn"]').evaluate(
                "element => element.dispatchEvent("
                "new MouseEvent('click', { bubbles: true }))"
            )
            assert "path-focused" in (
                page.locator('[data-node-id="core.handle-output-item"]')
                .get_attribute("class") or ""
            )
            assert "path-dimmed" in (
                page.locator('[data-node-id="core.model-client-stream"]')
                .get_attribute("class") or ""
            )
            assert "path-focused" not in (
                page.locator(
                    '[data-edge-group-id="turn.try-to-model-stream"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert "path-focused" in (
                page.locator(
                    '[data-edge-group-id="turn.stream-to-output-handler"]'
                    ":not(.graph-edge-label-group)"
                ).get_attribute("class") or ""
            )
            assert page.locator(".graph-viewport").get_attribute(
                "transform"
            ) == turn_camera
        if title == "Codex shell tool approval and sandbox execution":
            stepper_positions = page.locator(
                "#trace-previous, #trace-callsite, #trace-next"
            ).evaluate_all(
                """elements => elements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return [Math.round(rect.x), Math.round(rect.y)];
                })"""
            )
            assert page.locator(
                '[data-node-id="orchestrator.run"] [data-fork-count]'
            ).get_attribute("data-fork-count") == "4"
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
            assert page.locator("#trace-branch-current").inner_text() == (
                "ToolCallRuntime::handle_tool_call"
            )
            page.locator("#trace-branch-trigger").click()
            assert page.locator("#trace-branch-trigger").get_attribute(
                "aria-expanded"
            ) == "true"
            assert page.locator("#trace-branch-menu").is_visible()
            assert page.locator(".trace-branch-option").count() == 2
            assert page.locator(
                '.trace-branch-option[aria-selected="true"]'
            ).count() == 1
            page.locator(".workspace").screenshot(
                path=str(ARTIFACTS / "source-stepper-branch-menu.png")
            )
            page.locator(
                '[data-trace-branch-id="shell.output-to-build"]'
            ).click()
            assert page.locator("#trace-branch-trigger").get_attribute(
                "aria-expanded"
            ) == "false"
            assert not page.locator("#trace-branch-menu").is_visible()
            assert page.locator("#trace-branch-label").inner_text() == "分支 1/2"
            assert page.locator("#trace-callsite").get_attribute(
                "data-trace-edge-id"
            ) == "shell.output-to-build"
            assert page.locator("#trace-next").get_attribute(
                "data-trace-node-id"
            ) == "tools.build-tool-call"
            assert page.locator(
                "#trace-previous, #trace-callsite, #trace-next"
            ).evaluate_all(
                """elements => elements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return [Math.round(rect.x), Math.round(rect.y)];
                })"""
            ) == stepper_positions
            page.locator("#trace-branch-trigger").click()
            page.locator(
                '[data-trace-branch-id="shell.output-to-runtime"]'
            ).click()
            page.locator('[data-edge-hit-id="shell.output-to-build"]').evaluate(
                "element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            assert page.locator("#trace-branch").input_value() == "shell.output-to-build"
            page.locator("#trace-branch-trigger").click()
            page.locator(
                '[data-trace-branch-id="shell.output-to-runtime"]'
            ).click()
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
                min(branch_labels["runtimeCenter"], branch_labels["buildCenter"])
                < branch_labels["sourceCenter"]
                < max(branch_labels["runtimeCenter"], branch_labels["buildCenter"])
            ), branch_labels
            page.locator(".canvas-wrap").screenshot(
                path=str(ARTIFACTS / "edge-label-branches.png")
            )

    page.wait_for_selector('[data-node-id="cli.main"]')

    assert page.locator(".graph-node").count() == 23
    assert "TUI authorization" in page.locator("#graph-title").inner_text()
    assert "44 处源码有效" in page.locator("#validation-badge").inner_text()
    assert page.locator(
        '.edge-callsite[data-callsite-status="exact"]'
    ).count() == 21
    assert page.locator(
        '.edge-callsite[data-callsite-status="omitted-nodes"]'
    ).count() == 2
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
    assert "等 3 个" in page.locator("#graph-overview-end").inner_text()
    assert page.locator("#graph-overview-scale").inner_text() == "23 节点 · 23 关系"
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

    page.locator("#fit-view").click()
    multiselect_camera = page.locator(".graph-viewport").get_attribute("transform")
    marquee_plan = page.evaluate(
        """() => {
            const canvas = document.querySelector("#graph-canvas").getBoundingClientRect();
            const nodes = [...document.querySelectorAll(".graph-node")].map(node => {
                const box = node.getBoundingClientRect();
                return {
                    id: node.dataset.nodeId,
                    x: box.left + box.width / 2,
                    y: box.top + box.height / 2,
                };
            });
            const pairs = [];
            for (let left = 0; left < nodes.length; left += 1) {
                for (let right = left + 1; right < nodes.length; right += 1) {
                    pairs.push({
                        a: nodes[left],
                        b: nodes[right],
                        distance: Math.hypot(
                            nodes[left].x - nodes[right].x,
                            nodes[left].y - nodes[right].y,
                        ),
                    });
                }
            }
            pairs.sort((a, b) => a.distance - b.distance);
            for (const pair of pairs) {
                const left = Math.min(pair.a.x, pair.b.x) - 16;
                const right = Math.max(pair.a.x, pair.b.x) + 16;
                const top = Math.min(pair.a.y, pair.b.y) - 16;
                const bottom = Math.max(pair.a.y, pair.b.y) + 16;
                const corners = [
                    [{ x: left, y: top }, { x: right, y: bottom }],
                    [{ x: right, y: bottom }, { x: left, y: top }],
                    [{ x: right, y: top }, { x: left, y: bottom }],
                    [{ x: left, y: bottom }, { x: right, y: top }],
                ];
                for (const [start, end] of corners) {
                    if (
                        start.x < canvas.left + 2 || start.x > canvas.right - 2
                        || start.y < canvas.top + 2 || start.y > canvas.bottom - 2
                        || end.x < canvas.left + 2 || end.x > canvas.right - 2
                        || end.y < canvas.top + 2 || end.y > canvas.bottom - 2
                    ) continue;
                    const target = document.elementFromPoint(start.x, start.y);
                    if (!target?.closest(".graph-node, .graph-edge-group")) {
                        return {
                            start,
                            end,
                            expected: [pair.a.id, pair.b.id],
                        };
                    }
                }
            }
            throw new Error("No blank marquee corner found");
        }"""
    )
    page.keyboard.down("Shift")
    page.mouse.move(marquee_plan["start"]["x"], marquee_plan["start"]["y"])
    page.mouse.down()
    page.mouse.move(
        marquee_plan["end"]["x"],
        marquee_plan["end"]["y"],
        steps=8,
    )
    page.mouse.up()
    page.keyboard.up("Shift")
    assert page.locator(".graph-node.group-selected").count() >= 2
    assert page.locator(".marquee-selection.active").count() == 0
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == multiselect_camera
    for node_id in marquee_plan["expected"]:
        assert "group-selected" in (
            page.locator(f'[data-node-id="{node_id}"]').get_attribute("class") or ""
        )

    group_ids = page.locator(".graph-node.group-selected").evaluate_all(
        "nodes => nodes.map(node => node.dataset.nodeId)"
    )
    group_count = len(group_ids)
    toggle_node = page.locator(f'[data-node-id="{group_ids[0]}"]')
    toggle_node.click(modifiers=["Shift"])
    assert page.locator(".graph-node.group-selected").count() == group_count - 1
    assert toggle_node.get_attribute("aria-pressed") == "false"
    toggle_node.click(modifiers=["Shift"])
    assert page.locator(".graph-node.group-selected").count() == group_count
    assert page.locator(
        f'[data-node-id="{group_ids[0]}"]'
    ).get_attribute("aria-pressed") == "true"
    page.locator(f'[data-node-id="{group_ids[0]}"]').click()
    assert page.locator(".graph-node.group-selected").count() == 0
    for node_id in group_ids:
        page.locator(f'[data-node-id="{node_id}"]').click(modifiers=["Shift"])
    assert page.locator(".graph-node.group-selected").count() == group_count

    group_ids = page.locator(".graph-node.group-selected").evaluate_all(
        "nodes => nodes.map(node => node.dataset.nodeId)"
    )
    transforms_before = page.evaluate(
        """ids => Object.fromEntries(ids.map(id => {
            const node = document.querySelector(`[data-node-id="${id}"]`);
            const matrix = node.transform.baseVal.consolidate().matrix;
            return [id, { x: matrix.e, y: matrix.f }];
        }))""",
        group_ids,
    )
    connected_edge = page.evaluate(
        """ids => {
            const selected = new Set(ids);
            const group = [...document.querySelectorAll(
                ".edge-layer .graph-edge-group, .data-edge-layer .graph-edge-group"
            )].find(candidate =>
                selected.has(candidate.dataset.fromNodeId)
                || selected.has(candidate.dataset.toNodeId)
            );
            if (!group) throw new Error("Selected nodes have no rendered edge");
            const path = group.querySelector(".graph-edge");
            return {
                id: group.dataset.edgeGroupId,
                path: path.getAttribute("d"),
            };
        }""",
        group_ids,
    )
    group_layout_requests = []

    def record_group_layout(request):
        if (
            request.url.endswith("/api/graphs/tui-authorization/layout")
            and request.method == "PUT"
        ):
            group_layout_requests.append(request)

    page.on("request", record_group_layout)
    drag_node = page.locator(f'[data-node-id="{group_ids[0]}"]')
    drag_box = drag_node.bounding_box()
    assert drag_box
    with page.expect_response(
        lambda response: response.url.endswith(
            "/api/graphs/tui-authorization/layout"
        )
        and response.request.method == "PUT"
    ) as group_layout_saved:
        page.mouse.move(
            drag_box["x"] + drag_box["width"] / 2,
            drag_box["y"] + drag_box["height"] / 2,
        )
        page.mouse.down()
        page.mouse.move(
            drag_box["x"] + drag_box["width"] / 2 + 64,
            drag_box["y"] + drag_box["height"] / 2 + 32,
            steps=7,
        )
        page.mouse.up()
    assert group_layout_saved.value.ok
    page.wait_for_timeout(200)
    page.remove_listener("request", record_group_layout)
    assert len(group_layout_requests) == 1
    transforms_after = page.evaluate(
        """ids => Object.fromEntries(ids.map(id => {
            const node = document.querySelector(`[data-node-id="${id}"]`);
            const matrix = node.transform.baseVal.consolidate().matrix;
            return [id, { x: matrix.e, y: matrix.f }];
        }))""",
        group_ids,
    )
    group_deltas = [
        (
            transforms_after[node_id]["x"] - transforms_before[node_id]["x"],
            transforms_after[node_id]["y"] - transforms_before[node_id]["y"],
        )
        for node_id in group_ids
    ]
    assert all(
        abs(delta[0] - group_deltas[0][0]) < 0.2
        and abs(delta[1] - group_deltas[0][1]) < 0.2
        for delta in group_deltas
    ), group_deltas
    moved_edge_path = page.locator(
        f'[data-edge-group-id="{connected_edge["id"]}"]'
        ":not(.graph-edge-label-group) .graph-edge"
    ).get_attribute("d")
    assert moved_edge_path != connected_edge["path"]
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == multiselect_camera
    saved_group_layout = group_layout_saved.value.json()
    assert all(
        node_id in saved_group_layout["positions"]["vertical"]
        for node_id in group_ids
    )

    cancel_transforms = transforms_after
    cancel_layout_requests = []

    def record_cancel_layout(request):
        if (
            request.url.endswith("/api/graphs/tui-authorization/layout")
            and request.method == "PUT"
        ):
            cancel_layout_requests.append(request)

    page.on("request", record_cancel_layout)
    cancel_node = page.locator(f'[data-node-id="{group_ids[0]}"]')
    cancel_box = cancel_node.bounding_box()
    assert cancel_box
    page.mouse.move(
        cancel_box["x"] + cancel_box["width"] / 2,
        cancel_box["y"] + cancel_box["height"] / 2,
    )
    page.mouse.down()
    page.mouse.move(
        cancel_box["x"] + cancel_box["width"] / 2 + 38,
        cancel_box["y"] + cancel_box["height"] / 2 - 24,
        steps=4,
    )
    page.locator("#graph-canvas").dispatch_event(
        "pointercancel",
        {"pointerId": 1, "pointerType": "mouse", "button": 0},
    )
    page.mouse.up()
    page.wait_for_timeout(500)
    page.remove_listener("request", record_cancel_layout)
    assert cancel_layout_requests == []
    assert page.evaluate(
        """([ids, expected]) => ids.every(id => {
            const node = document.querySelector(`[data-node-id="${id}"]`);
            const matrix = node.transform.baseVal.consolidate().matrix;
            return Math.abs(matrix.e - expected[id].x) < 0.2
                && Math.abs(matrix.f - expected[id].y) < 0.2;
        })""",
        [group_ids, cancel_transforms],
    )
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == multiselect_camera

    blank_point = page.evaluate(
        """() => {
            const box = document.querySelector("#graph-canvas").getBoundingClientRect();
            for (let y = box.top + 12; y < box.bottom; y += 18) {
                for (let x = box.left + 12; x < box.right; x += 18) {
                    const target = document.elementFromPoint(x, y);
                    if (!target?.closest(".graph-node, .graph-edge-group")) {
                        return { x, y };
                    }
                }
            }
            throw new Error("No blank canvas point found");
        }"""
    )
    page.mouse.click(blank_point["x"], blank_point["y"])
    assert page.locator(".graph-node.group-selected").count() == 0
    assert page.locator("#inspector-empty").is_visible()
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == multiselect_camera

    for node_id in group_ids[:2]:
        page.locator(f'[data-node-id="{node_id}"]').click(modifiers=["Shift"])
    assert page.locator(".graph-node.group-selected").count() == 2
    page.keyboard.press("Escape")
    assert page.locator(".graph-node.group-selected").count() == 0
    assert page.locator("#inspector-empty").is_visible()
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == multiselect_camera

    pan_before = page.locator(".graph-viewport").get_attribute("transform")
    page.mouse.move(blank_point["x"], blank_point["y"])
    page.mouse.down()
    page.mouse.move(
        blank_point["x"] + 44,
        blank_point["y"] + 26,
        steps=5,
    )
    page.mouse.up()
    assert page.locator(".graph-viewport").get_attribute("transform") != pan_before
    with page.expect_response(
        lambda response: response.url.endswith("/api/graphs/tui-authorization/layout")
        and response.request.method == "PUT"
    ) as multiselect_layout_reset:
        page.locator("#reset-layout").click()
    assert multiselect_layout_reset.value.ok
    page.locator("#fit-view").click()
    page.locator('[data-node-id="cli.main"]').click()

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
    trace_camera = page.locator(".graph-viewport").get_attribute("transform")
    trace_focus_samples = [
        (
            page.locator(".graph-node.path-focused").count(),
            page.locator(
                ".graph-edge-group.path-focused:not(.graph-edge-label-group)"
            ).count(),
        )
    ]
    assert all(count > 0 for count in trace_focus_samples[0])

    page.locator("#trace-callsite").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-position"
    ) == "edge"
    trace_focus_samples.append(
        (
            page.locator(".graph-node.path-focused").count(),
            page.locator(
                ".graph-edge-group.path-focused:not(.graph-edge-label-group)"
            ).count(),
        )
    )
    assert all(count > 0 for count in trace_focus_samples[-1])
    assert "path-focused" in (
        page.locator(
            '[data-edge-group-id="edge.main-cli-main"]'
            ":not(.graph-edge-label-group)"
        ).get_attribute("class") or ""
    )
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == trace_camera
    assert "异步入口" in page.locator("#inspector-content h2").inner_text()
    assert "main.rs" in page.locator(".source-preview-path").inner_text()
    assert "目标 959" in page.locator(".source-preview-stats").inner_text()
    assert page.locator(".source-editor-host").get_attribute("data-focus-line") == "959"
    assert page.locator(".source-editor-host").get_attribute("data-focus-end-line") == "959"

    page.locator("#trace-next").click()
    assert page.locator(".source-stepper").get_attribute(
        "data-current-node"
    ) == "cli.cli-main"
    trace_focus_samples.append(
        (
            page.locator(".graph-node.path-focused").count(),
            page.locator(
                ".graph-edge-group.path-focused:not(.graph-edge-label-group)"
            ).count(),
        )
    )
    assert all(count > 0 for count in trace_focus_samples[-1])
    assert page.locator(".graph-viewport").get_attribute(
        "transform"
    ) == trace_camera
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
    assert 1 < upstream_count < 23
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
    assert 1 < downstream_count < 23
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
    assert 0 < dimmed_count < 23
    assert "search-dim" not in (
        page.locator('[data-node-id="provider.bearer-auth"]').get_attribute("class") or ""
    )
    page.locator("#search").fill("")
    page.locator("#orientation").click()
    assert page.locator("#orientation").inner_text() == "纵向布局"

    page.locator('[data-node-id="cli.main"] .collapse-toggle').click()
    assert 1 < page.locator(".graph-node").count() < 23
    assert page.locator('[data-node-id="cli.main"]').count() == 1
    page.locator("#reset-view").click()
    assert page.locator(".graph-node").count() == 23

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
