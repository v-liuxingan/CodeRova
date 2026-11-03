from branch_controls import click_branch
import subprocess,tempfile,pathlib,os,re
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='path-view-test-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1500,'height':950});errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r: requests.append(r.post_data_json) if r.url.endswith('/api/preview') else None)
  page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  page.goto(BASE+'/?graph=codex-end-to-end-agent-loop');expect(page.locator('#fit')).to_be_enabled()
  expect(page.locator('#view-mode')).to_have_count(0)
  ref=page.evaluate("window.__testGraph.getNodeData().find(n=>n.data.pathReference && n.data.more && !n.data.pathCycle)")
  assert ref
  valid=page.evaluate('''() => {const g=window.__testGraph; return g.getNodeData().every(n=>new Set(g.getEdgeData().filter(e=>e.target===n.id).map(e=>e.source)).size<=1)}''');assert valid
  page.evaluate('(id)=>window.__testGraph.focusElement(id,false)',ref['id'])
  point=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',ref['id']);box=page.locator('#canvas').bounding_box()
  page.mouse.click(box['x']+point[0],box['y']+point[1]);expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
  assert requests[-1]['id']==ref['data']['sourceId'],requests[-1]
  expect(page.locator('#selection-description')).to_contain_text('共享方法')
  click_branch(page,ref['id'],'expand');expect(page.locator('#apply-window')).to_be_enabled()
  page.locator('#relations > button').filter(has_text=re.compile(r'调用点 [0-9]+')).first.click();expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
  expect(page.locator('#selection-title')).to_contain_text('→')
  expect(page.locator('#relations')).to_contain_text('顺序')
  assert requests[-1]['targetType']=='edge' and not requests[-1]['id'].startswith('["view-edge"'),requests[-1]
  page.locator('#direction input[value=LR]').check();expect(page.locator('#apply-window')).to_be_enabled()
  assert not errors,errors
  print('Path browser: one parent per reference, real symbol/call-site source IDs, explicit subtree expansion, orientation, single path view PASS')
  browser.close()
