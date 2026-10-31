from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
BASE=os.environ.get("CALLGRAPH_TEST_URL","http://127.0.0.1:4322")
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='window-test-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  # This suite targets the relation window; path references have a separate browser suite.
  def relation_page(route):
   response=route.fetch()
   route.fulfill(response=response,body=response.text().replace('<option value="relations">','<option value="relations" selected>'))
  page.route('**/?*',relation_page)
  page.goto(BASE+'/?graph=codex-interactive-startup-lsp');expect(page.locator('#fit')).to_be_enabled(timeout=120000)
  expect(page.locator('#window-unit')).to_have_value('layers')
  page.locator('#display-settings > summary').click();page.select_option('#window-unit','nodes');page.click('#apply-window');expect(page.locator('#stats')).to_contain_text('50 / 4144')
  assert page.evaluate('window.__testGraph.getNodeData().length')==50
  assert page.locator('#coverage-issues li').count()==0
  rootid=page.evaluate('window.__testGraph.getNodeData().find(n=>n.data.more).id');page.select_option('#symbols',rootid)
  before=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',rootid)
  click_branch(page,rootid,'expand');expect(page.locator('#apply-window')).to_be_enabled()
  assert 50 < page.evaluate('window.__testGraph.getNodeData().length') <= 100
  after=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',rootid)
  assert all(abs(a-b)<1 for a,b in zip(before,after)),(before,after)
  page.locator('#direction input[value=LR]').check();expect(page.locator('#apply-window')).to_be_enabled()
  rootid=page.evaluate('window.__testGraph.getNodeData()[0].id')
  xs=page.evaluate('(id)=>{const g=window.__testGraph;return g.getEdgeData().filter(e=>e.source===id&&e.target!==id).map(e=>g.getElementPosition(e.target)[0])}',rootid)
  assert len(set(xs))==1,xs
  last=page.locator('#symbols option').last.get_attribute('value');page.select_option('#symbols',last);expect(page.locator('#canvas')).to_have_attribute('data-selection',last)
  assert page.evaluate('(id)=>window.__testGraph.getNodeData().some(n=>n.id===id)',last)
  page.fill('#window-size','1');page.click('#apply-window');expect(page.locator('#stats')).to_contain_text('1 / 4144');expect(page.locator('#canvas')).to_have_attribute('data-selection','')
  page.select_option('#window-unit','layers');page.fill('#window-size','1');page.click('#apply-window');expect(page.locator('#apply-window')).to_be_enabled()
  assert page.evaluate('window.__testGraph.getNodeData().length')>1
  page.locator('#coverage-title').click();expect(page.locator('#coverage-issues li')).to_have_count(100)
  template=page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
  template['root']='chain-0';template['nodes']=[dict(template['nodes'][0],id=f'chain-{i}',label=f'node{i}') for i in range(125)]
  template['edges']=[dict(template['edges'][0],id=f'edge-{i}',**{'from':f'chain-{i}','to':f'chain-{i+1}'}) for i in range(124)]
  page.route('**/api/graphs/callgraph-v2-validation',lambda r:r.fulfill(json=template))
  page.goto(BASE+'/?graph=callgraph-v2-validation');expect(page.locator('#fit')).to_be_enabled()
  expect(page.locator('#window-unit')).to_have_value('layers');expect(page.locator('#window-size')).to_have_value('50')
  assert page.evaluate('window.__testGraph.getNodeData().length')==51
  page.select_option('#symbols','chain-50');click_branch(page,'chain-50','expand')
  expect(page.locator('#stats')).to_contain_text('101 / 125')
  assert not errors,errors
  print('Progressive browser: 50-node initial, +50, viewport anchor, sibling columns, hidden search, reset, depth mode, lazy issues PASS')
  browser.close()
