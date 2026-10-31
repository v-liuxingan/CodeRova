import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4322")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    graph = page.request.get(BASE + "/api/graphs/callgraph-v2-validation").json()
    assert "analysis" in graph and graph["analysis"]["queriedNodes"]
    assert all(e["kind"] == "static-call" for e in graph["edges"])
    page.goto(BASE + "/v2/?graph=callgraph-v2-validation")
    page.wait_for_function("() => document.querySelector('#fit').disabled === false")
    assert page.locator('#canvas').get_attribute('data-selection') == ''
    assert page.locator('#source .focus').count() == 0
    page.locator('#symbols').select_option(graph['root'])
    page.wait_for_selector("#source .focus")
    assert page.locator("#canvas canvas").count() > 0
    assert page.locator("#coverage").is_visible()
    assert page.locator("#selection-title").inner_text() == "validate_graph"
    assert "validate_graph" in page.locator("#source .focus").inner_text()
    assert page.locator('html').get_attribute('data-theme') == 'light'
    selection = page.locator('#canvas').get_attribute('data-selection')
    source = page.locator('#source').inner_text()
    page.locator('#appearance').select_option('dark')
    page.wait_for_function("() => !document.querySelector('#appearance').disabled")
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    assert page.locator('#canvas').get_attribute('data-selection') == selection
    assert page.locator('#source').inner_text() == source
    page.locator('#appearance').select_option('light')
    page.wait_for_function("() => !document.querySelector('#appearance').disabled")

    page.locator("#relations button").first.click()
    page.wait_for_function("() => document.querySelector('#selection-title').textContent === '静态调用'")
    page.wait_for_selector("#source .focus")
    page.locator('#catalog button[data-slug="codex-end-to-end-agent-loop"]').click()
    page.wait_for_function("() => document.querySelector('#title').textContent.includes('发送一条消息') && !document.querySelector('#fit').disabled")
    assert not page.locator("#coverage").is_visible()
    assert page.locator('#catalog button[data-slug="qoreon-network-recovery"]').count() == 1
    page.go_back()
    page.wait_for_function("() => document.querySelector('#title').textContent.includes('validate_graph') && !document.querySelector('#fit').disabled")
    assert page.locator('#canvas').get_attribute('data-selection') == ''
    page.locator('#appearance').select_option('dark')
    page.wait_for_function("() => !document.querySelector('#appearance').disabled")
    page.reload()
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    page.wait_for_function("() => !document.querySelector('#fit').disabled")
    assert page.locator('#canvas').get_attribute('data-selection') == ''
    assert page.locator('#source .focus').count() == 0
    page.locator("#symbol-filter").fill("exact_call_site")
    assert page.locator("#symbols option").count() == 2
    page.locator("#symbols").select_option(label="exact_call_site")
    page.locator("#symbols").dispatch_event("change")
    page.wait_for_function("() => document.querySelector('#selection-title').textContent === 'exact_call_site'")
    page.wait_for_selector("#source .focus")
    # Real pointer gestures: panning, including returning to the press point, must retain selection.
    # Fit first: after focusElement, larger cards can occupy the top-left test point.
    page.locator('#fit').click()
    selected = page.locator('#canvas').get_attribute('data-selection')
    bounds = page.locator('#canvas').bounding_box()
    x, y = bounds['x'] + 20, bounds['y'] + 20
    page.mouse.move(x, y); page.mouse.down()
    page.mouse.move(x + 100, y + 60, steps=8)
    page.mouse.move(x, y, steps=8); page.mouse.up()
    assert page.locator('#canvas').get_attribute('data-selection') == selected
    page.mouse.click(x, y)
    page.wait_for_function("() => document.querySelector('#canvas').dataset.selection === ''")
    assert page.locator('#source .focus').count() == 0
    assert page.locator('#symbols').input_value() == ''
    # Hold an older graph response while the reader chooses a different project.
    held = []
    pattern = "**/api/graphs/codex-end-to-end-agent-loop"
    page.route(pattern, lambda route: held.append(route))
    page.locator('#catalog button[data-slug="codex-end-to-end-agent-loop"]').click()
    page.locator('#catalog button[data-slug="qoreon-network-recovery"]').click()
    assert held
    held[0].continue_()
    page.unroute(pattern)
    qoreon = page.request.get(BASE + "/api/graphs/qoreon-network-recovery").json()
    page.wait_for_function("title => document.querySelector('#title').textContent === title && !document.querySelector('#fit').disabled", arg=qoreon["title"])
    assert page.locator('#canvas').get_attribute('data-selection') == ''
    assert page.locator('#source .focus').count() == 0
    assert not errors, errors
    browser.close()
print("V2 browser: real G6, analysis contract, source evidence, project navigation, history and symbols passed")
