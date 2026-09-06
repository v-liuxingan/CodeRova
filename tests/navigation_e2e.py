"""Regression tests for workbench request ordering and reading context."""

import asyncio
import os
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect


BASE_URL = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4321")


def graph(slug):
    return {
        "schemaVersion": "0.4", "projectId": "project", "title": f"Graph {slug}",
        "root": "shared-root", "description": "Navigation regression fixture",
        "nodes": [{"id": "shared-root", "label": "Root", "kind": "function",
                   "file": "public/js/app.js", "line": 1, "role": f"Root {slug}"}],
        "edges": [],
        "phases": [{"id": "last", "title": "Optional recovery", "order": 100,
                    "summary": "Layout order does not prove an execution outcome"}],
    }


class Workbench:
    def __init__(self, browser, init_script=None):
        self.browser = browser
        self.init_script = init_script
        self.holds = {}
        self.failures = {}
        self.errors = []

    async def __aenter__(self):
        self.context = await self.browser.new_context(viewport={"width": 1440, "height": 1000})
        if self.init_script:
            await self.context.add_init_script(self.init_script)
        self.page = await self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        await self.page.route("**/api/**", self.route)
        await self.page.goto(f"{BASE_URL}/?graph=a")
        await expect(self.page.locator("#graph-title")).to_have_text("Graph a")
        await expect(self.page.locator("#validation-badge")).to_have_text("1 处源码有效")
        await expect(self.page.locator(".source-preview-error")).to_have_text("preview a")
        return self

    async def __aexit__(self, *_):
        for _, release in self.holds.values():
            release.set()
        await self.context.close()

    def hold(self, key):
        self.holds[key] = (asyncio.Event(), asyncio.Event())

    async def arrived(self, key):
        await asyncio.wait_for(self.holds[key][0].wait(), timeout=10)

    async def release(self, key):
        self.holds[key][1].set()
        await self.page.wait_for_load_state("networkidle")

    async def select(self, slug):
        await self.page.locator(f'.graph-option[data-slug="{slug}"]').click()

    async def route(self, route):
        path = urlparse(route.request.url).path
        payload = route.request.post_data_json if route.request.method == "POST" else {}
        key = f"preview:{payload['graph']}" if path == "/api/preview" else path
        if key in self.holds:
            arrived, release = self.holds[key]
            arrived.set()
            await release.wait()
        if key in self.failures:
            await route.fulfill(status=500, json={"error": self.failures[key]})
        elif path == "/api/health":
            await route.fulfill(json={"status": "ok", "projects": []})
        elif path == "/api/graphs":
            await route.fulfill(json=[{
                "slug": slug, "title": f"Graph {slug}", "projectId": "project",
                "categoryId": "review", "category": "Review", "nodeCount": 1, "edgeCount": 0,
            } for slug in "abc"])
        elif path == "/api/preview":
            await route.fulfill(status=500, json={"error": f"preview {payload['graph']}"})
        elif path.endswith("/layout"):
            await route.fulfill(json={"positions": {}})
        elif path.endswith("/validation"):
            count = {"a": 1, "b": 2, "c": 3}[path.split("/")[-2]]
            await route.fulfill(json={"valid": True, "sourceLocations": [{}] * count,
                                      "errors": [], "warnings": []})
        else:
            await route.fulfill(json=graph(path.rsplit("/", 1)[-1]))


async def last_selection_wins(browser):
    async with Workbench(browser) as app:
        app.hold("/api/graphs/b")
        await app.select("b")
        await app.arrived("/api/graphs/b")
        await app.select("c")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph c")
        await app.release("/api/graphs/b")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph c")
        assert urlparse(app.page.url).query == "graph=c"
        await expect(app.page.locator(".graph-option.active")).to_have_attribute("data-slug", "c")
        assert not app.errors, app.errors


async def validation_stays_with_graph(browser):
    # Both a stale success and a stale failure must leave the new report intact.
    for fail in (False, True):
        async with Workbench(browser) as app:
            key = "/api/graphs/b/validation"
            app.hold(key)
            if fail:
                app.failures[key] = "old validation failed"
            await app.select("b")
            await app.arrived(key)
            await app.select("c")
            await expect(app.page.locator("#validation-badge")).to_have_text("3 处源码有效")
            await app.release(key)
            await expect(app.page.locator("#validation-badge")).to_have_text("3 处源码有效")
            assert not app.errors, app.errors


async def failed_load_is_recoverable(browser):
    async with Workbench(browser) as app:
        app.failures["/api/graphs/b"] = "graph unavailable"
        await app.select("b")
        await expect(app.page.locator("#toast-region")).to_contain_text("graph unavailable")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph a")
        assert urlparse(app.page.url).query == "graph=a"
        await app.select("c")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph c")
        assert not app.errors, app.errors


async def stale_failure_is_ignored(browser):
    async with Workbench(browser) as app:
        app.hold("/api/graphs/b")
        app.failures["/api/graphs/b"] = "stale graph failure"
        await app.select("b")
        await app.arrived("/api/graphs/b")
        await app.select("c")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph c")
        await app.release("/api/graphs/b")
        await expect(app.page.locator("#toast-region")).not_to_contain_text("stale graph failure")
        assert not app.errors, app.errors


async def source_identity_includes_graph(browser):
    async with Workbench(browser) as app:
        app.hold("preview:b")
        await app.select("b")
        await app.arrived("preview:b")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph b")
        await expect(app.page.locator(".source-preview-loading")).to_be_visible()
        await expect(app.page.locator("#source-preview-body")).not_to_contain_text("preview a")
        await app.release("preview:b")
        await expect(app.page.locator(".source-preview-error")).to_have_text("preview b")


async def search_matches_visible_graph(browser):
    async with Workbench(browser) as app:
        await app.page.locator("#search").fill("does-not-match")
        await expect(app.page.locator(".graph-node.search-dim")).to_have_count(1)
        await app.select("b")
        await expect(app.page.locator("#graph-title")).to_have_text("Graph b")
        await expect(app.page.locator("#search")).to_have_value("")
        await expect(app.page.locator(".graph-node")).to_have_count(1)
        await expect(app.page.locator(".graph-node.search-dim")).to_have_count(0)


async def phase_order_is_not_an_outcome(browser):
    async with Workbench(browser) as app:
        await expect(app.page.locator("#graph-overview-end-label")).to_have_text("结构终点")
        await expect(app.page.locator("#graph-overview-end")).to_have_text("Root a")


async def slash_does_not_steal_text_input(browser):
    async with Workbench(browser) as app:
        await app.page.locator('.graph-option-row').first.locator('.graph-category-edit').click()
        await app.page.locator("#category-editor-select").select_option("__new__")
        field = app.page.locator("#category-editor-name")
        await field.press("/")
        await expect(field).to_have_value("/")
        await expect(field).to_be_focused()


async def unavailable_theme_storage_is_optional(browser):
    for mode in ("read", "write"):
        script = f"""
            const method = {'"getItem"' if mode == 'read' else '"setItem"'};
            const original = Storage.prototype[method];
            Storage.prototype[method] = function(key, ...args) {{
                if (key === 'callgraph_theme_v2') throw new DOMException('unavailable', 'SecurityError');
                return original.call(this, key, ...args);
            }};
        """
        async with Workbench(browser, init_script=script) as app:
            await app.page.locator("#theme-select").select_option("aether")
            await expect(app.page.locator("html")).to_have_attribute("data-theme", "aether")
            await app.select("b")
            await expect(app.page.locator("#graph-title")).to_have_text("Graph b")
            assert not app.errors, app.errors


async def main():
    failures = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        for case in (last_selection_wins, validation_stays_with_graph,
                     failed_load_is_recoverable, stale_failure_is_ignored,
                     source_identity_includes_graph, search_matches_visible_graph,
                     phase_order_is_not_an_outcome, slash_does_not_steal_text_input,
                     unavailable_theme_storage_is_optional):
            try:
                await case(browser)
                print(f"PASS {case.__name__}")
            except Exception as error:
                failures.append(case.__name__)
                print(f"FAIL {case.__name__}: {error}")
        await browser.close()
    assert not failures, failures
    print("Workbench navigation regression E2E OK")


if __name__ == "__main__":
    asyncio.run(main())
