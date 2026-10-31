from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='edge-menu-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fixture=page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
  fixture['root']='a';fixture['nodes']=[dict(fixture['nodes'][0],id=id,label=id) for id in ['a','b','c','d']]
  fixture['edges']=[dict(fixture['edges'][0],id=str(i),**{'from':a,'to':b}) for i,(a,b) in enumerate([('a','b'),('b','c'),('a','d'),('d','c')])]
  fixture['edges'].append(dict(fixture['edges'][0],id='parallel-call'))
  page.route('**/api/graphs/callgraph-v2-validation',lambda r:r.fulfill(json=fixture))
  page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  page.goto(BASE+'/?graph=callgraph-v2-validation');expect(page.locator('#fit')).to_be_enabled()
  assert page.evaluate('window.__testGraph.getEdgeData().length')==5
  assert page.evaluate("window.__testGraph.getEdgeData().every(e=>e.data.memberIds.length===1)")
  def right_click(source,target):
   point=page.evaluate('''({source,target})=>{const g=window.__testGraph,e=g.getEdgeData().find(e=>e.source===source&&e.target===target);const shape=g.context.element.getElement(e.id).getShape('key');const p=shape.getPoint(.5);return g.getViewportByCanvas([p.x,p.y]);}''',{'source':source,'target':target})
   # Hit slightly off the visible one-pixel stroke, as a user would.
   box=page.locator('#canvas').bounding_box();page.mouse.click(box['x']+point[0],box['y']+point[1]+3,button='right')
   expect(page.locator('#edge-context-menu')).to_be_visible()
  right_click('a','b');expect(page.get_by_role('menuitem',name='收起下游')).to_be_enabled()
  expect(page.locator('#canvas')).to_have_attribute('data-selection','')
  page.screenshot(path='tests/artifacts/edge-style-preview/edge-context-menu.png')
  page.keyboard.press('Escape');expect(page.locator('#edge-context-menu')).to_be_hidden()
  right_click('a','b');page.get_by_role('menuitem',name='收起下游').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','5')
  assert page.evaluate("window.__testGraph.getNodeData().some(n=>n.data.sourceId==='c')")
  right_click('a','b');expect(page.get_by_role('menuitem',name='收起下游')).to_be_disabled()
  page.mouse.click(350,350);expect(page.locator('#edge-context-menu')).to_be_hidden()
  def right_node(id):
   point=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',id)
   box=page.locator('#canvas').bounding_box();page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
   expect(page.get_by_role('menu',name='分支操作')).to_be_visible()
  right_node('d');expect(page.get_by_role('menuitem',name='收起下游')).to_be_enabled()
  expect(page.locator('#canvas')).to_have_attribute('data-selection','')
  page.get_by_role('menuitem',name='收起下游').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','4')
  right_node('d');expect(page.get_by_role('menuitem',name='收起下游')).to_be_disabled()
  page.keyboard.press('Escape');expect(page.get_by_role('menu',name='分支操作')).to_be_hidden()
  click_branch(page,'b','expand');expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','5')
  assert page.evaluate("window.__testGraph.getNodeData().some(n=>n.id==='b')")
  assert not errors,errors
  b.close();print('Node and edge context menu: real node/curve hit, Escape/outside dismissal, branch collapse, shared reference retained, disabled leaf, no selection change PASS')
