"""Smoke test for the independent React Flow architecture atlas entry."""

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = ROOT / "tests" / "artifacts" / "architecture-atlas.png"
SCENARIO_ARTIFACT = ROOT / "tests" / "artifacts" / "architecture-atlas-scenario.png"
CALLGRAPH_ARTIFACT = ROOT / "tests" / "artifacts" / "architecture-atlas-callgraph.png"


def main() -> None:
    failures: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1680, "height": 980}, device_scale_factor=1)
        page.on("console", lambda message: failures.append(message.text) if message.type == "error" else None)
        page.goto("http://127.0.0.1:4321/atlas.html", wait_until="networkidle")
        scenario_steps = page.locator(".scenario-step-node")
        scenario_steps.first.wait_for()
        assert scenario_steps.count() >= 6
        step_x_positions = scenario_steps.evaluate_all("nodes => nodes.map(node => node.getBoundingClientRect().x)")
        assert step_x_positions == sorted(step_x_positions), "Scenario steps must follow the authored reading order from left to right."
        scenario_viewport = page.locator(".react-flow__viewport").get_attribute("style")
        page.locator(".scenario-step-node").nth(1).click()
        assert page.locator(".react-flow__viewport").get_attribute("style") == scenario_viewport
        page.screenshot(path=str(SCENARIO_ARTIFACT), full_page=True)
        page.get_by_role("button", name="查看调用图").first.click()
        phase_cards = page.locator(".phase-node")
        phase_cards.first.wait_for()
        assert phase_cards.count() >= 4, "A phased graph must first explain execution architecture, not render every implementation node."
        phase_count = phase_cards.count()
        assert page.locator(".react-flow__edge").count() < phase_cards.count() * 3, "Phase overview must retain only backbone and semantic control relations."
        page.get_by_role("button", name="完整调用图").click()
        full_nodes = page.locator(".code-node")
        full_nodes.first.wait_for()
        assert full_nodes.count() >= phase_count * 2, "Full view must retain the source graph rather than a second static sketch."
        vertical_levels = full_nodes.evaluate_all("nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().y))).size")
        assert vertical_levels >= 3, "Narrative layout must keep a multi-level execution order."
        page.get_by_role("button", name="改为横向").click()
        horizontal_levels = full_nodes.evaluate_all("nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().x))).size")
        assert horizontal_levels >= 3, "The reader must be able to switch execution direction without losing graph content."
        page.locator(".atlas-graph-toolbar button").first.click()
        phase_cards.first.wait_for()
        phase_viewport = page.locator(".react-flow__viewport").get_attribute("style")
        phase_cards.nth(1).click()
        assert page.locator(".react-flow__viewport").get_attribute("style") == phase_viewport
        page.locator(".drilldown-list button").click()
        page.locator(".code-node").first.wait_for()
        assert page.locator(".code-node").count() >= 1
        page.wait_for_timeout(500)
        page.screenshot(path=str(CALLGRAPH_ARTIFACT), full_page=True)
        callgraph_viewport = page.locator(".react-flow__viewport").get_attribute("style")
        page.locator(".code-node").first.click()
        assert page.locator(".react-flow__viewport").get_attribute("style") == callgraph_viewport
        source_code = page.locator(".source-panel pre")
        source_code.wait_for()
        source_scroll_before = source_code.evaluate("element => element.scrollTop")
        canvas = page.locator(".atlas-canvas").bounding_box()
        assert canvas is not None
        page.mouse.move(canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2)
        page.mouse.wheel(0, 320)
        assert page.evaluate("window.scrollY") == 0
        assert source_code.evaluate("element => element.scrollTop") == source_scroll_before
        page.screenshot(path=str(ARTIFACT), full_page=True)
        browser.close()
    if failures:
        raise AssertionError(f"browser console errors: {failures}")
    print("Architecture Atlas: all assertions passed")


if __name__ == "__main__":
    main()
