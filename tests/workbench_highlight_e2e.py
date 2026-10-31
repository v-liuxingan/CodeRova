"""Pixel regression for residual dim styles across selection and reset."""
import os
import base64
from playwright.sync_api import sync_playwright

BASE = os.environ.get("CALLGRAPH_TEST_URL", "http://127.0.0.1:4322")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1500, "height": 950}, device_scale_factor=1)
    if os.environ.get("CALLGRAPH_V2_BUNDLE"):
        page.route("**/vendor/workbench/workbench.js", lambda route: route.fulfill(path=os.environ["CALLGRAPH_V2_BUNDLE"], content_type="application/javascript"))
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    graph = page.request.get(BASE + "/api/graphs/callgraph-v2-validation").json()
    leaves = [n["id"] for n in graph["nodes"] if n["id"] != graph["root"]]
    def same_pixels(left, right):
        urls = ['data:image/png;base64,' + base64.b64encode(value).decode() for value in [left, right]]
        differences = page.evaluate("""async urls => {
            const images = await Promise.all(urls.map(src => new Promise(resolve => {
                const image = new Image(); image.onload = () => resolve(image); image.src = src;
            })));
            if (images[0].width !== images[1].width || images[0].height !== images[1].height) return Infinity;
            const arrays = images.map(image => {
                const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
                return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            });
            let count = 0;
            for (let i = 0; i < arrays[0].length; i += 4) {
                if ([0,1,2,3].some(j => Math.abs(arrays[0][i+j] - arrays[1][i+j]) > 3)) count++;
            }
            return count;
        }""", urls)
        # Camera roundoff changes edge antialiasing by up to 3/255 across layouts.
        # Keep the 8-pixel allowance for arrow tips; residual dimming is much larger.
        if differences > 8:
            from pathlib import Path
            Path('tests/artifacts/codex-startup/highlight-actual.png').write_bytes(left)
            Path('tests/artifacts/codex-startup/highlight-baseline.png').write_bytes(right)
        assert differences <= 8, f'{differences} pixels differ'

    for theme in ["light", "dark"]:
        page.goto(BASE + "/?graph=callgraph-v2-validation")
        page.wait_for_function("() => !document.querySelector('#fit').disabled")
        page.locator('#appearance').select_option(theme)
        page.wait_for_function("() => !document.querySelector('#appearance').disabled")
        page.locator('#fit').click()
        canvas = page.locator('#canvas')
        page.locator('.graph-minimap').wait_for(state='visible')
        page.wait_for_timeout(250)  # Native minimap redraw is debounced by 100 ms.
        baseline = canvas.screenshot()
        def select(symbol):
            page.locator('#symbols').select_option(symbol)
            page.wait_for_selector('#source .focus')
            # Keep identical geometry so the comparison measures drawing, not camera movement.
            page.locator('#fit').click()
            page.wait_for_timeout(150)
        select(leaves[1])
        expected = canvas.screenshot()
        select(leaves[0])
        select(leaves[1])
        same_pixels(canvas.screenshot(), expected)
        box = canvas.bounding_box()
        page.mouse.click(box['x'] + 15, box['y'] + 15)
        page.wait_for_function("() => document.querySelector('#canvas').dataset.selection === ''")
        page.wait_for_timeout(150)
        same_pixels(canvas.screenshot(), baseline)
    assert not errors, errors
    browser.close()
print('V2 highlight pixels: light/dark selection switching and reset match clean rendering')
