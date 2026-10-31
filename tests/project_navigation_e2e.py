"""One workbench for home, scene and graph reading, including navigation races."""
import os
import re
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4317")
QSCENE = "/?scene=qoreon-network-recovery"
QGRAPH = "/?graph=qoreon-network-recovery"


def open_project(page, project):
    group = page.locator(f'.catalog-project[data-project-id="{project}"]')
    if not group.evaluate("el => el.open"):
        group.locator("summary").click()
    return group


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        errors, requests = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        page.goto(BASE, wait_until="networkidle")
        home = page.locator("#catalog-home")
        expect(home).to_be_visible()
        expect(home.locator(".home-project")).to_have_count(3)
        expect(home.locator(".home-graph-link")).to_have_count(17)
        expect(home.locator(".project-scene-link")).to_have_count(3)
        assert not any("/api/graphs/" in url for url in requests)
        page.evaluate("window.documentMarker = 'same-workbench'")
        home.locator(f'a[href="{QSCENE}"]').click()
        page.wait_for_url("**/?scene=qoreon-network-recovery")
        expect(page.locator("#scene-content svg.sequence")).to_have_count(1)
        expect(page.locator("#scene-reader")).to_be_visible()
        assert page.locator("#scene-content .page-nav, #scene-content .page-footer").count() == 0
        assert page.locator("#project-shortcuts").count() == 0
        expect(page.locator('.catalog-project[open]')).to_have_count(1)
        expect(page.locator('.catalog-project[open]')).to_have_attribute("data-project-id", "qoreon")
        page.locator("#scene-reader").evaluate("el => el.scrollTop = 420")
        page.locator(f'#reading-switcher a[href="{QGRAPH}"]').click()
        expect(page.locator(".graph-node")).to_have_count(11)
        page.locator('.graph-node[data-node-id="schedule"]').evaluate("el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
        page.locator("#zoom-in").click()
        camera = page.locator(".graph-viewport").get_attribute("transform")
        graph_requests = sum("/api/graphs/qoreon-network-recovery" in url for url in requests)
        page.locator(f'#reading-switcher a[href="{QSCENE}"]').click()
        expect(page.locator("#scene-reader")).to_be_visible()
        page.wait_for_function("document.querySelector('#scene-reader').scrollTop === 420")
        page.go_back()
        expect(page.locator(".canvas-wrap")).to_be_visible()
        expect(page.locator('.graph-node[data-node-id="schedule"]')).to_have_class(re.compile(r".*selected.*"))
        assert page.locator(".graph-viewport").get_attribute("transform") == camera
        assert sum("/api/graphs/qoreon-network-recovery" in url for url in requests) == graph_requests
        page.go_forward()
        expect(page.locator("#scene-reader")).to_be_visible()
        assert page.evaluate("window.documentMarker") == "same-workbench"
        page.select_option("#theme-select", "aether")
        expect(page.locator("#scene-content")).to_have_attribute("data-theme", "aether")
        assert page.locator("#scene-content").evaluate("el => getComputedStyle(el).colorScheme") == "dark"
        # Failure leaves both visible reading content and URL unchanged.
        page.route("**/scenes/codex-agent-turn.html", lambda route: route.fulfill(status=503, body="unavailable"))
        open_project(page, "codex").locator('a[href="/?scene=codex-agent-turn"]').click()
        expect(page.locator("#toast-region")).to_contain_text("503")
        assert page.url.endswith(QSCENE)
        expect(page.locator("#scene-reader")).to_be_visible()
        page.unroute("**/scenes/codex-agent-turn.html")
        # A late graph response cannot replace a newer scene/home selection.
        pending = []
        page.route("**/api/graphs/codex-end-to-end-agent-loop", lambda route: pending.append(route))
        open_project(page, "codex").locator('.graph-option[data-slug="codex-end-to-end-agent-loop"]').click()
        page.wait_for_timeout(100)
        page.locator(".catalog-home-link").click()
        expect(home).to_be_visible()
        assert pending
        for route in pending:
            route.fulfill(json=page.request.get(BASE + "/api/graphs/codex-end-to-end-agent-loop").json())
        page.unroute("**/api/graphs/codex-end-to-end-agent-loop")
        expect(home).to_be_visible()
        assert page.url == BASE + "/"
        # Scene requests are abortable; changing the selection keeps the last choice.
        pending = []
        page.route("**/scenes/codex-agent-turn.html", lambda route: pending.append(route))
        home.locator('a[href="/?scene=codex-agent-turn"]').click()
        page.wait_for_timeout(100)
        page.locator(".catalog-home-link").click()
        expect(home).to_be_visible()
        assert pending
        for route in pending:
            route.abort()
        page.unroute("**/scenes/codex-agent-turn.html")
        # Save failures block ordinary reading transitions, including history traversal.
        home.locator(f'a[href="{QGRAPH}"]').click()
        expect(page.locator(".canvas-wrap")).to_be_visible()
        page.route("**/api/graphs/*/layout", lambda route: route.fulfill(status=503, json={"error": "save failed"}) if route.request.method == "PUT" else route.continue_())
        page.locator("#reset-layout").click()
        page.locator(".catalog-home-link").click()
        expect(page.locator("#toast-region")).to_contain_text("布局尚未保存")
        assert page.url.endswith(QGRAPH)
        page.go_back()
        page.wait_for_url("**/?graph=qoreon-network-recovery")
        expect(page.locator(".canvas-wrap")).to_be_visible()
        page.unroute("**/api/graphs/*/layout")
        page.route("**/api/graphs/*/layout", lambda route: route.fulfill(json={}) if route.request.method == "PUT" else route.continue_())
        page.locator(".catalog-home-link").click()
        expect(home).to_be_visible()
        # Scene catalog failure does not block graph entries or direct scene reading.
        page.route("**/scenes/catalog.json", lambda route: route.fulfill(status=503, json={}))
        page.goto(BASE, wait_until="networkidle")
        expect(home.locator(".home-graph-link")).to_have_count(17)
        expect(home.locator("[data-scene-retry]")).to_be_visible()
        page.unroute("**/scenes/catalog.json")
        home.locator("[data-scene-retry]").click()
        expect(home.locator(".project-scene-link")).to_have_count(3)
        # Empty and unregistered scene-only content stays discoverable.
        health = page.request.get(BASE + "/api/health").json()
        health["projects"].append({"id": "empty", "name": "Empty", "rootExists": True, "root": "."})
        page.route("**/api/health", lambda route: route.fulfill(json=health))
        scene = {"slug": "legacy", "projectId": None, "projectLabel": "Legacy", "title": "Legacy", "summary": "Sequence", "callgraph": None}
        page.route("**/scenes/catalog.json", lambda route: route.fulfill(json={"schemaVersion": "1.0", "scenes": [scene]}))
        page.goto(BASE, wait_until="networkidle")
        expect(home.locator(".home-project")).to_have_count(5)
        expect(home.locator('[data-project-id="empty"]')).to_contain_text("暂无调用图")
        assert not errors, errors
        context.close()
        # Inert scene import: no executable elements, foreign resources, or duplicate page navigation.
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        bad = '<main class="page"><h1>Test</h1><svg class="sequence" viewBox="0 0 20 20"><script>alert(1)</script><foreignObject>bad</foreignObject><rect width="10" height="10" onload="alert(1)"/></svg><img src="https://invalid.example/pixel"><a href="javascript:alert(1)">bad</a><iframe src="/atlas.html"></iframe></main>'
        page.route("**/scenes/inert-test.html", lambda route: route.fulfill(content_type="text/html", body=bad))
        page.goto(BASE + "/?scene=inert-test", wait_until="networkidle")
        expect(page.locator("#scene-content svg.sequence")).to_have_count(1)
        assert page.locator("#scene-content script, #scene-content iframe, #scene-content img, #scene-content foreignObject, #scene-content [onload]").count() == 0
        assert page.locator('#scene-content a[href]').count() == 0
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.goto(BASE + QSCENE, wait_until="networkidle")
        expect(page.locator("#scene-reader")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        context.close()
        context = browser.new_context()
        context.add_init_script("Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); };")
        page = context.new_page()
        page.goto(BASE + QSCENE, wait_until="networkidle")
        expect(page.locator("#scene-reader")).to_be_visible()
        context.close()
        browser.close()
    print("Unified reading E2E: one document, view switching, history, preserved reading, races, failure recovery, inert import and mobile passed")


if __name__ == "__main__":
    main()
