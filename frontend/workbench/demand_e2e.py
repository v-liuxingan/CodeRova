import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tests"))
from browser_controls import select_option
from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
from playwright.sync_api import sync_playwright,expect
pathlib.Path('target/test-artifacts').mkdir(parents=True,exist_ok=True)
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='demand-test-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  browser=p.chromium.launch();page=browser.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  graph=page.request.get(BASE+'/api/graphs/codex-cli-startup-lsp').json();root=graph['root']
  page.goto(BASE+'/?graph=codex-cli-startup-lsp');expect(page.locator('#fit')).to_be_enabled()
  logical=int(page.locator('#canvas').get_attribute('data-displayed-nodes'));mounted=page.evaluate('window.__testGraph.getNodeData().length')
  assert logical>2000 and mounted<200,(logical,mounted)
  assert page.locator('#symbols option').count()<=101
  offscreen=next(n for n in reversed(graph['nodes']) if not page.evaluate('(id)=>window.__testGraph.getNodeData().some(n=>n.id===id)',n['id']))
  def choose(id):
   page.fill('#symbol-filter',id);select_option(page,'#symbols',id);expect(page.locator('#canvas')).to_have_attribute('data-selection',id);expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
  choose(root)
  point=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',root);box=page.locator('#canvas').bounding_box()
  x,y=box['x']+point[0],box['y']+point[1];page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+100,y+40,steps=10);page.mouse.up()
  moved=page.evaluate('(id)=>window.__testGraph.getElementPosition(id)',root)
  choose(offscreen['id']);assert page.evaluate('(id)=>window.__testGraph.getNodeData().some(n=>n.id===id)',offscreen['id'])
  choose(root);restored=page.evaluate('(id)=>window.__testGraph.getElementPosition(id)',root)
  assert all(abs(a-b)<1 for a,b in zip(moved,restored)),(moved,restored)
  page.click('#fit');page.wait_for_timeout(700)
  assert page.evaluate('window.__testGraph.getZoom()')<.25
  assert page.evaluate("window.__testGraph.getNodeData().every(n=>n.type==='rect')")
  choose(root);assert page.evaluate('window.__testGraph.getZoom()')>=.35
  page.fill('#symbol-filter','');expect(page.locator('#symbols option')).to_have_count(101)
  page.click('#symbols-more');expect(page.locator('#symbols option')).to_have_count(201)
  choose(root)
  page.screenshot(path='target/test-artifacts/node-actions-light.png')
  before=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',root)
  card_size=page.evaluate('(id)=>({height:window.__testGraph.getNodeData(id).data.height,zoom:window.__testGraph.getZoom()})',root)
  click_branch(page,root,'collapse')
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
  assert page.evaluate('(id)=>({height:window.__testGraph.getNodeData(id).data.height,zoom:window.__testGraph.getZoom()})',root)==card_size
  after=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',root)
  assert all(abs(a-b)<1 for a,b in zip(before,after)),(before,after)
  click_branch(page,root,'expand')
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes',str(logical))
  assert page.evaluate('(id)=>({height:window.__testGraph.getNodeData(id).data.height,zoom:window.__testGraph.getZoom()})',root)==card_size
  expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
  select_option(page,'#appearance','dark');expect(page.locator('#appearance')).to_be_enabled()
  page.screenshot(path='target/test-artifacts/node-actions-dark.png')
  # Dragging from an action must neither move the card nor invoke the action.
  point=page.evaluate('(id)=>{const g=window.__testGraph,n=g.getNodeData(id),p=g.getElementPosition(id);return g.getViewportByCanvas([p[0],p[1]+n.data.height/2+14]);}',root)
  box=page.locator('#canvas').bounding_box();x,y=box['x']+point[0],box['y']+point[1]
  pos=page.evaluate('(id)=>window.__testGraph.getElementPosition(id)',root)
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y+15,steps=5);page.mouse.up()
  assert page.evaluate('(id)=>window.__testGraph.getElementPosition(id)',root)==pos
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes',str(logical))
  page.locator('#direction input[value=LR]').check();expect(page.locator('#apply-window')).to_be_enabled()
  click_branch(page,root,'collapse');expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
  click_branch(page,root,'expand');expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes',str(logical))
  overview=page.locator('.graph-minimap')
  expect(overview).to_have_attribute('data-logical-nodes',str(logical))
  old_center=page.evaluate('window.__testGraph.getCanvasByViewport([400,300])')
  overview.click(position={'x':50,'y':70})
  page.wait_for_timeout(250)
  assert page.evaluate('window.__testGraph.getCanvasByViewport([400,300])')!=old_center
  expect(overview).to_have_attribute('data-logical-nodes',str(logical))
  box=overview.bounding_box();page.mouse.move(box['x']+70,box['y']+70);page.mouse.down();page.mouse.move(box['x']+110,box['y']+80,steps=6);page.mouse.up()
  overview.press('ArrowRight')
  assert page.evaluate('window.__testGraph.getNodeData().length')<logical
  page.screenshot(path='target/test-artifacts/minimap-navigation.png')
  assert not errors,errors
  print(f'On-demand G6: {logical} logical / {mounted} mounted; offscreen search, source, remount positions, overview LOD, themes and paged symbols PASS')
  browser.close()
