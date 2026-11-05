"""Isolated native brush/group drag and focus-scoped keyboard navigation."""
import json,os,socket,subprocess,tempfile,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/workbench-e2e/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='gestures-',dir=ROOT/'target') as directory:
 root=Path(directory);graphs=root/'graphs';graphs.mkdir();source=root/'source';source.mkdir()
 (source/'main.rs').write_text('fn main() {}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'Fixture','root':str(source)}]}))
 graph={'schemaVersion':'0.4','projectId':'fixture','title':'Viewport fixture','root':'n0',
  'nodes':[{'id':f'n{i}','kind':'function','role':'','label':f'function{i}','file':'main.rs','line':1} for i in range(12)],
  'edges':[{'id':f'e{i}','from':f'n{(i-1)//4}','to':f'n{i}','kind':'static-call','file':'main.rs','line':1} for i in range(1,12)]}
 graphfile=graphs/'fixture.json';graphfile.write_text(json.dumps(graph));original=graphfile.read_bytes()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  injection='''
window.__viewport={fit:fitLogicalGraph,select:id=>select('node',id,true),pan:async()=>{await renderer.translateBy([-600,0],false);await refreshViewport(true);},
 ready:async()=>{await mountPromise;await new Promise(r=>setTimeout(r,300));},
 logical:()=>paintWindow.data.nodes,
 positions:()=>JSON.stringify(paintWindow.data.nodes.map(n=>[n.id,n.style.x,n.style.y]))};
'''
  bundle=root/'test.js'
  subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph(')+process.argv[2],resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle),injection],check=True,capture_output=True)
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
   for _ in range(60):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   page.goto(base+'/?graph=fixture')
   try:expect(page.locator('#fit')).to_be_enabled(timeout=15000)
   except AssertionError:raise AssertionError((errors,page.locator('#status').inner_text()))
   page.evaluate('window.__viewport.ready()')
   def brush_all():
    page.evaluate('window.__testGraph.fitView({},false)');page.evaluate('window.__viewport.ready()')
    box=page.locator('#canvas').bounding_box()
    points=page.evaluate('window.__testGraph.getNodeData().map(n=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(n.id)))')
    page.keyboard.down('Shift');page.mouse.move(box['x']+min(p[0] for p in points)-15,box['y']+min(p[1] for p in points)-15);page.mouse.down()
    page.mouse.move(box['x']+max(p[0] for p in points)+15,box['y']+max(p[1] for p in points)+15,steps=15);page.mouse.up();page.keyboard.up('Shift')
    page.evaluate('window.__viewport.ready()')
    assert page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").length')==12
   def menu():
    point=page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("n5"))');box=page.locator('#canvas').bounding_box()
    page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
    expect(page.locator('#edge-context-menu')).to_be_visible()
    expect(page.locator('#edge-context-menu')).to_contain_text('入口节点保留')
    page.evaluate("Promise.all(document.getElementById('edge-context-menu').getAnimations({subtree:true}).map(a=>a.finished))")
   brush_all();menu()
   artifacts=ROOT/'target/test-artifacts/batch-actions';artifacts.mkdir(parents=True,exist_ok=True)
   page.screenshot(path=str(artifacts/'menu-light.png'))
   page.keyboard.press('Escape');select_option(page,'#appearance','dark');page.evaluate('window.__viewport.ready()');menu()
   page.screenshot(path=str(artifacts/'menu-dark.png'))
   expect(page.get_by_role('menuitem',name='隐藏所选',exact=True)).to_be_enabled()
   page.get_by_role('menuitem',name='隐藏所选',exact=True).click()
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
   assert graphfile.read_bytes()==original
   page.locator('#restore-hidden').click()
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','12')
   brush_all();menu()
   page.once('dialog',lambda d:d.dismiss());page.get_by_role('menuitem',name='删除所选',exact=True).click()
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','12')
   menu();page.once('dialog',lambda d:d.accept());page.get_by_role('menuitem',name='删除所选',exact=True).click()
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
   expect(page.locator('#save-edits')).to_be_enabled()
   assert graphfile.read_bytes()==original
   page.once('dialog',lambda d:d.accept());page.locator('#discard-edits').click()
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','12')
   assert graphfile.read_bytes()==original
   assert not errors,errors
   browser.close()
  print('Batch menu PASS: root protection, hide/restore, cancel, atomic draft deletion and discard')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
