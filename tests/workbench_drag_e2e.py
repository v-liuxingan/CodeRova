"""Measure real pointer-to-node motion with a test-only instrumented bundle."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('CALLGRAPH_TEST_URL', 'http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='v2-drag-') as directory:
    bundle = Path(directory) / 'workbench.js'
    subprocess.run(['node', '--input-type=module', '-e', '''
      import {build} from 'esbuild'; import {readFileSync} from 'node:fs'; import {resolve} from 'node:path';
      await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});
    ''', str(bundle)], cwd=ROOT, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1500, 'height': 950})
        page.route('**/vendor/workbench/workbench.js', lambda route: route.fulfill(path=str(bundle), content_type='application/javascript'))
        for slug in ['callgraph-v2-validation', 'codex-end-to-end-agent-loop']:
            page.goto(BASE + '/?graph=' + slug)
            expect(page.locator('#fit')).to_be_enabled()
            initial = page.evaluate('''() => {
              const g = window.__testGraph, id = g.getNodeData()[0].id;
              window.dragSample = {id, start: g.getElementPosition(id), frames: []};
              g.on('node:dragstart', () => {dragSample.delay = performance.now() - dragSample.down});
              document.querySelector('#canvas').addEventListener('pointerdown', () => {dragSample.down = performance.now()}, {once: true});
              const point = g.getViewportByCanvas(g.getElementPosition(id));
              return {point, zoom:g.getZoom()};
            }''')
            box = page.locator('#canvas').bounding_box()
            x, y = box['x'] + initial['point'][0], box['y'] + initial['point'][1]
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + 2, y + 1)
            still = page.evaluate('window.__testGraph.getElementPosition(dragSample.id).slice(0,2)')
            assert still == page.evaluate('dragSample.start.slice(0,2)'), 'Click jitter moved the node'
            page.mouse.move(x + 16, y + 8)
            first = page.evaluate('''() => {
              const g=window.__testGraph, point=g.getElementPosition(dragSample.id);
              return {dx:(point[0]-dragSample.start[0])*g.getZoom(),dy:(point[1]-dragSample.start[1])*g.getZoom(),delay:dragSample.delay};
            }''')
            assert abs(first['dx'] - 16) < 1 and abs(first['dy'] - 8) < 1, first
            page.mouse.move(x + 120, y + 50, steps=20)
            page.mouse.up()
            final = page.evaluate('''() => {
              const g=window.__testGraph,p=g.getElementPosition(dragSample.id);
              return [(p[0]-dragSample.start[0])*g.getZoom(),(p[1]-dragSample.start[1])*g.getZoom()];
            }''')
            assert abs(final[0]-120) < 1 and abs(final[1]-50) < 1, final
            assert page.locator('#canvas').get_attribute('data-selection') == ''
            # A quick blank-canvas drag must translate the camera, not select.
            position = page.evaluate('window.__testGraph.getPosition()')
            page.mouse.move(box['x']+12, box['y']+12); page.mouse.down()
            page.mouse.move(box['x']+32, box['y']+24); page.mouse.up()
            moved = page.evaluate('window.__testGraph.getPosition()')
            assert moved != position, 'Fast canvas drag was ignored'
            print(json.dumps({'graph':slug, 'firstMove':first,'finalDisplacement':final}))
        browser.close()
