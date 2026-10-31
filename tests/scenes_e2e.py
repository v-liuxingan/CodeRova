"""Independent sequence pages: static reading, CSP, and ordinary navigation."""

import os
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4321")
ROOT = Path(__file__).resolve().parents[1]


def operators(body):
    result = set()
    for block in body:
        if block["type"] not in ("message", "note"):
            result.add(block["type"])
        result.update(operators(block.get("body", [])))
        for branch in block.get("branches", []):
            result.update(operators(branch["body"]))
    return result


SCENES = {
    item["slug"]: operators(item["scene"]["body"])
    for item in json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e",
         "import {loadScenes} from './scripts/build_scenes.mjs'; console.log(JSON.stringify(await loadScenes()));"],
        cwd=ROOT, text=True, encoding="utf-8",
    ))
}


def assert_geometry(svg):
    geometry = svg.evaluate("""svg => {
        const bounds = svg.viewBox.baseVal;
        const labels = [...svg.querySelectorAll('text')].map(text => ({
            text: text.textContent, box: text.getBBox(),
        }));
        return {
            clippedActors: [...svg.querySelectorAll('.actor rect')].filter(el => {
                const box = el.getBBox();
                return box.x < 1 || box.y < 1 || box.x + box.width > bounds.width - 1
                    || box.y + box.height > bounds.height - 1;
            }).length,
            outside: labels.filter(({box}) => box.x < 0 || box.y < 0
                || box.x + box.width > bounds.width
                || box.y + box.height > bounds.height).map(x => x.text),
            overlap: labels.flatMap((a, i) => labels.slice(i + 1)
                .filter(b => a.box.x < b.box.x + b.box.width
                    && b.box.x < a.box.x + a.box.width
                    && a.box.y < b.box.y + b.box.height
                    && b.box.y < a.box.y + a.box.height)
                .map(b => [a.text, b.text])),
        };
    }""")
    assert geometry == {"outside": [], "overlap": [], "clippedActors": 0}, geometry


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        static = browser.new_context(java_script_enabled=False)
        page = static.new_page()
        requests = []
        page.on("request", lambda request: requests.append(request.url))
        page.route("**/api/**", lambda route: route.abort())
        for slug in SCENES:
            for width in (1440, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                response = page.goto(f"{BASE_URL}/scenes/{slug}.html")
                assert response.status == 200
                csp = response.headers["content-security-policy"]
                assert "unsafe-inline" not in csp
                assert page.locator("h1").is_visible()
                assert page.locator("script, style, [style]").count() == 0
                svg = page.locator("svg.sequence")
                assert svg.is_visible()
                assert svg.evaluate("el => el.getBoundingClientRect().width >= el.viewBox.baseVal.width")
                ids = svg.get_attribute("aria-labelledby").split()
                assert all(svg.locator(f"[id='{id}']").text_content() for id in ids)
                top_actors = svg.locator('.actor[data-position="top"]')
                bottom_actors = svg.locator('.actor[data-position="bottom"]')
                assert svg.locator(".lifeline").count() == top_actors.count()
                assert top_actors.all_text_contents() == bottom_actors.all_text_contents()
                assert svg.locator(".exchange").count() > 0
                rendered_operators = set(svg.locator(".fragment").evaluate_all(
                    "frames => frames.map(frame => frame.dataset.operator)"
                ))
                assert SCENES[slug] == rendered_operators
                assert_geometry(svg)
                assert page.evaluate(
                    "document.documentElement.scrollWidth <= window.innerWidth"
                )
                assert page.locator("body").evaluate(
                    "body => getComputedStyle(body).color"
                ) == "rgb(45, 49, 66)"
                if width == 390:
                    assert page.locator(".diagram-scroll").evaluate(
                        "el => el.scrollWidth > el.clientWidth"
                    )
                assert page.locator(".evidence li").count() > 0
                for link in page.locator("a[href]").all():
                    href = link.get_attribute("href")
                    assert "targetIds" not in href and "phase" not in href
                evidence_link = svg.locator('a[href^="#evidence-"]').first
                if evidence_link.count():
                    href = evidence_link.get_attribute("href")
                    evidence_link.click()
                    assert page.url.endswith(href)
                    assert page.locator(href).is_visible()
        assert not any("/api/" in url for url in requests), requests
        assert all(urlparse(url).netloc == urlparse(BASE_URL).netloc for url in requests)
        page.goto(f"{BASE_URL}/scenes/index.html")
        for slug in SCENES:
            assert page.locator(f'a[href="{slug}.html"]').count() > 0
        fixtures = json.loads(subprocess.check_output(
            ["node", str(ROOT / "tests/scene_render_test.mjs"), "--fixtures"],
            cwd=ROOT, encoding="utf-8",
        ))
        for fixture in fixtures:
            url = f"{BASE_URL}/scenes/__test-{fixture['slug']}.html"
            page.route(url, lambda route, _request, html=fixture["html"]: route.fulfill(
                status=200, content_type="text/html", body=html,
                headers={"Content-Security-Policy": csp},
            ))
            for width in (1440, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                page.goto(url)
                svg = page.locator("svg.sequence")
                assert page.locator("html").get_attribute("data-theme") == fixture["theme"]
                assert page.locator("html").evaluate("el => getComputedStyle(el).colorScheme") == (
                    "dark" if fixture["theme"] in ("aether", "signal") else "light"
                )
                colors = svg.evaluate("""svg => {
                    const top = [...svg.querySelectorAll('.actor[data-position="top"] rect')];
                    const bottom = [...svg.querySelectorAll('.actor[data-position="bottom"] rect')];
                    return {
                        top: top.map(el => getComputedStyle(el).fill),
                        bottom: bottom.map(el => getComputedStyle(el).fill),
                        messages: [...svg.querySelectorAll('.exchange')].every(el => {
                            const arrow = el.querySelector('.message');
                            const marker = svg.querySelector('.marker-' + el.dataset.kind);
                            return getComputedStyle(arrow).stroke === getComputedStyle(marker)[
                                el.dataset.kind === 'async' ? 'stroke' : 'fill'];
                        }),
                    };
                }""")
                assert colors["top"] == colors["bottom"]
                assert colors["messages"], colors
                if len(colors["top"]) > 1:
                    assert len(set(colors["top"])) > 1, colors
                assert_geometry(svg)
                assert svg.locator(".exchange").count() == fixture["messages"]
                assert svg.locator(".fragment").count() == fixture["fragments"]
                assert page.locator("script, style, [style]").count() == 0
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert svg.evaluate("el => el.getBoundingClientRect().width >= el.viewBox.baseVal.width")
            page.emulate_media(media="print")
            assert page.locator("html").evaluate("el => getComputedStyle(el).colorScheme") == "light"
            assert page.locator("html").evaluate("el => getComputedStyle(el).color") == "rgb(45, 49, 66)"
            page.emulate_media(media="screen")
        static.close()

        # Simulate the retired scenario service failing: callgraphs must still load.
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        errors = []
        scenario_requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: scenario_requests.append(request.url)
                if "/api/scenarios" in request.url else None)
        page.route("**/api/scenarios**", lambda route: route.abort())
        page.goto(f"{BASE_URL}/scenes/qoreon-network-recovery.html")
        page.locator(".page-nav .callgraph-link").click()
        page.wait_for_selector(".graph-node")
        assert page.locator(".graph-option.active").get_attribute("data-slug") == "qoreon-network-recovery"
        response = page.request.post(f"{BASE_URL}/api/preview", data={
            "graph": "qoreon-network-recovery", "targetType": "node", "id": "schedule",
        })
        assert response.status == 200
        assert "_schedule_network_resume_run" in response.text()
        page.goto(f"{BASE_URL}/scenes/codex-message-roundtrip.html")
        page.locator(".page-nav .callgraph-link").click()
        page.wait_for_selector(".graph-node")
        assert page.locator(".graph-option.active").get_attribute("data-slug") == (
            "codex-end-to-end-agent-loop"
        )
        assert page.locator(".workspace").get_attribute("data-workspace-view") == "code"
        assert page.locator("#phase-navigator, #architecture-scenario-navigator").count() == 0
        assert page.locator(".source-stepper").is_visible()
        page.locator('#reading-switcher a[href="/?scene=codex-message-roundtrip"]').click()
        page.wait_for_url("**/?scene=codex-message-roundtrip")
        page.go_back()
        page.wait_for_selector(".graph-node")
        assert page.locator(".graph-option.active").get_attribute("data-slug") == (
            "codex-end-to-end-agent-loop"
        )
        page.goto(f"{BASE_URL}/?graph=unknown-scene-graph")
        page.wait_for_selector(".graph-node")
        page.wait_for_function(
            "() => document.querySelector('#toast-region').textContent.includes('调用图不存在')"
        )
        assert page.locator(".graph-option.active").count() == 1
        assert not scenario_requests, scenario_requests
        assert not errors, errors
        context.close()
        browser.close()
    print("Standalone scene E2E OK: no-JS reading, geometry, CSP, navigation, API isolation")


if __name__ == "__main__":
    main()
