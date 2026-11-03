import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tests"))
from browser_controls import select_option
"""Exercise validated source links without launching external editor processes."""
import os, pathlib, subprocess, tempfile
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('CALLGRAPH_TEST_URL', 'http://127.0.0.1:4324')
with tempfile.TemporaryDirectory(prefix='editor-links-') as tmp:
    bundle = pathlib.Path(tmp) / 'bundle.js'
    subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('sourceNavigation({api,','sourceNavigation({launch:uri=>{window.testEditorUri=uri},api,'),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});", str(bundle)], check=True, capture_output=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width':1440,'height':960})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/vendor/workbench/workbench.js', lambda route: route.fulfill(path=str(bundle), content_type='application/javascript'))
        graph = page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
        page.goto(BASE+'/?graph=callgraph-v2-validation')
        expect(page.locator('#fit')).to_be_enabled()
        page.locator('.editor-settings > summary').click()
        select_option(page,'#source-editor','idea')
        page.reload()
        expect(page.locator('#source-editor')).to_have_value('idea')
        expect(page.locator('#fit')).to_be_enabled()
        select_option(page,'#symbols',graph['root'])
        expect(page.locator('#open-source')).to_be_visible()
        page.locator('#open-source').click()
        page.wait_for_function("() => window.testEditorUri?.startsWith('idea://open?')")
        assert page.evaluate("() => Number(new URL(window.testEditorUri).searchParams.get('line'))") > 0
        assert page.evaluate("() => new URL(window.testEditorUri).searchParams.get('file').includes('/')")
        page.locator('.editor-settings > summary').click()
        select_option(page,'#source-editor','vscode')
        page.locator('#open-source').click()
        page.wait_for_function("() => window.testEditorUri?.startsWith('vscode://file/')")
        assert not errors, errors
        browser.close()
print('Editor selection persistence, validated IDEA source position and VS Code switching PASS')
