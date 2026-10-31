from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='edge-menu-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/v2/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/v2'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fixture=page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
  fixture['root']='a';fixture['nodes']=[dict(fixture['nodes'][0],id=id,label=id) for id in ['a','b','c','d']]
  fixture['edges']=[dict(fixture['edges'][0],id=str(i),**{'from':a,'to':b}) for i,(a,b) in enumerate([('a','b'),('b','c'),('a','d'),('d','c')])]
  fixture['edges'].append(dict(fixture['edges'][0],id='parallel-call'))
  page.route('**/api/graphs/callgraph-v2-validation',lambda r:r.fulfill(json=fixture))
  page.route('**/vendor/v2/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  page.goto(BASE+'/v2/?graph=callgraph-v2-validation');expect(page.locator('#fit')).to_be_enabled()
  assert page.evaluate('window.__testGraph.getEdgeData().length')==5
  assert page.evaluate("window.__testGraph.getEdgeData().every(e=>e.data.memberIds.length===1)")
  def right_click(source,target):
   point=page.evaluate('''({source,target})=>{const g=window.__testGraph,e=g.getEdgeData().find(e=>e.source===source&&e.target===target);const shape=g.context.element.getElement(e.id).getShape('key');const p=shape.getPoint(.5);return g.getViewportByCanvas([p.x,p.y]);}''',{'source':source,'target':target})
   box=page.locator('#canvas').bounding_box();page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
   expect(page.locator('#edge-context-menu')).to_be_visible()
  right_click('a','b');expect(page.get_by_role('menuitem',name='收起此分支')).to_be_enabled()
  expect(page.locator('#canvas')).to_have_attribute('data-selection','')
  page.screenshot(path='tests/artifacts/edge-style-preview/edge-context-menu.png')
  page.keyboard.press('Escape');expect(page.locator('#edge-context-menu')).to_be_hidden()
  stable=page.evaluate("Object.fromEntries(['a','b','d'].map(id=>[id,window.__testGraph.getElementPosition(id)]))")
  right_click('a','b');page.get_by_role('menuitem',name='收起此分支').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','5')
  assert page.evaluate("window.__testGraph.getNodeData().some(n=>n.data.sourceId==='c')")
  right_click('a','b');expect(page.get_by_role('menuitem',name='收起此分支')).to_be_disabled()
  page.mouse.click(350,350);expect(page.locator('#edge-context-menu')).to_be_hidden()
  def right_node(id):
   point=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',id)
   box=page.locator('#canvas').bounding_box();page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
   expect(page.get_by_role('menu',name='分支操作')).to_be_visible()
  right_node('d');expect(page.get_by_role('menuitem',name='收起此分支')).to_be_enabled()
  expect(page.locator('#canvas')).to_have_attribute('data-selection','')
  page.get_by_role('menuitem',name='收起此分支').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','4')
  right_node('d');expect(page.get_by_role('menuitem',name='收起此分支')).to_be_disabled()
  page.keyboard.press('Escape');expect(page.get_by_role('menu',name='分支操作')).to_be_hidden()
  click_branch(page,'b','expand');expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','5')
  assert page.evaluate("Object.fromEntries(['a','b','d'].map(id=>[id,window.__testGraph.getElementPosition(id)]))")==stable
  page.select_option('#view-mode','relations');page.locator('#apply-window').click();page.wait_for_timeout(300)
  page.locator('#canvas').click(position={'x':5,'y':5})
  requests=[]
  page.on('request',lambda r: requests.append(r.post_data_json) if r.url.endswith('/api/preview') else None)
  pair=page.evaluate("window.__testGraph.getEdgeData().find(e=>e.data.memberIds.length===2)")
  page.evaluate('(id)=>window.__testGraph.emit("edge:click",{target:{id}})',pair['id'])
  expect(page.locator('#relations')).to_contain_text('2 个调用关系')
  page.locator('#relations button').filter(has_text='调用点').nth(1).click()
  page.wait_for_timeout(150)
  assert requests[-1]['id']=='parallel-call',requests
  assert not errors,errors
  b.close();print('Node and edge context menu: real node/curve hit, Escape/outside dismissal, branch collapse, shared reference retained, disabled leaf, no selection change PASS')
