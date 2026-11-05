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
 holdNextSelection:()=>{const original=select;select=async(...args)=>{select=original;await original(...args);await new Promise(resolve=>{window.__releaseNavigation=resolve;});};},
 navigationIdle:async()=>{while(directionalTask)await new Promise(resolve=>setTimeout(resolve,5));},
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
   # Keyboard navigation requires canvas focus and leaves controls alone.
   page.locator('#canvas').focus();page.keyboard.press('ArrowLeft')
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.keyboard.press('ArrowRight')
   expect(page.locator('#selection-title')).to_have_text('function2')
   page.keyboard.press('ArrowUp')
   expect(page.locator('#selection-title')).to_have_text('function1')
   page.keyboard.press('ArrowDown')
   expect(page.locator('#selection-title')).to_have_text('function2')
   page.locator('#canvas').focus();page.keyboard.press('ArrowLeft')
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.locator('#node-center').focus();page.keyboard.press('ArrowDown')
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.locator('#filter').fill('fixture');page.keyboard.press('ArrowDown')
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.locator('#filter').fill('')
   # Buttons use precisely the same spatial neighbors as arrow keys.
   expect(page.locator('#node-left')).to_be_disabled()
   for button,title in [('right','function2'),('up','function1'),('down','function2'),('left','function0')]:
    page.locator('#node-'+button).click();page.evaluate('window.__viewport.navigationIdle()')
    expect(page.locator('#selection-title')).to_have_text(title)
   # Space and the center button produce the same camera position without zooming.
   zoom=page.evaluate('window.__testGraph.getZoom()')
   page.evaluate('window.__viewport.pan()');page.locator('#canvas').focus();page.keyboard.press('Space')
   page.evaluate('window.__viewport.navigationIdle()')
   centered=page.evaluate('window.__testGraph.getCanvasByViewport([0,0])')
   page.evaluate('window.__viewport.pan()');page.locator('#node-center').click()
   page.evaluate('window.__viewport.navigationIdle()')
   assert all(abs(a-b)<.1 for a,b in zip(centered,page.evaluate('window.__testGraph.getCanvasByViewport([0,0])')))
   assert abs(zoom-page.evaluate('window.__testGraph.getZoom()'))<.0001
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.locator('#filter').fill('ab');page.keyboard.press('End');page.keyboard.press('Space')
   expect(page.locator('#filter')).to_have_value('ab ')
   assert centered==page.evaluate('window.__testGraph.getCanvasByViewport([0,0])')
   page.locator('#filter').fill('')
   # A queued key must not jump after the reader moves focus into an input.
   page.evaluate('window.__viewport.holdNextSelection()')
   page.locator('#canvas').focus();page.keyboard.press('ArrowRight')
   page.wait_for_function('()=>typeof window.__releaseNavigation==="function"')
   expect(page.locator('#selection-title')).to_have_text('function2')
   page.keyboard.press('ArrowDown');page.locator('#filter').focus()
   page.evaluate('window.__releaseNavigation()');page.evaluate('window.__viewport.navigationIdle()')
   expect(page.locator('#selection-title')).to_have_text('function2')
   page.evaluate('window.__viewport.select("n0")')
   page.evaluate('window.__viewport.ready()')
   # Fit the small fixture so a real native Shift-brush can enclose nodes.
   page.evaluate('window.__testGraph.fitView({},false)');page.evaluate('window.__viewport.ready()')
   box=page.locator('#canvas').bounding_box()
   before_pan=page.evaluate('window.__testGraph.getCanvasByViewport([0,0])')
   page.mouse.move(box['x']+35,box['y']+100);page.mouse.down();page.mouse.move(box['x']+65,box['y']+120,steps=6);page.mouse.up()
   page.evaluate('window.__viewport.ready()')
   assert before_pan!=page.evaluate('window.__testGraph.getCanvasByViewport([0,0])'),'ordinary canvas drag disabled'
   expect(page.locator('#selection-title')).to_have_text('function0')
   page.evaluate('window.__testGraph.fitView({},false)');page.evaluate('window.__viewport.ready()')
   coords=page.evaluate('window.__testGraph.getNodeData().map(n=>({id:n.id,p:window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(n.id))}))')
   x0=min(n['p'][0] for n in coords)-15;y0=min(n['p'][1] for n in coords)-15
   x1=max(n['p'][0] for n in coords)+15;y1=max(n['p'][1] for n in coords)+15
   center=page.evaluate('window.__testGraph.getCanvasByViewport(window.__testGraph.getSize().map(x=>x/2))')
   page.keyboard.down('Shift');page.mouse.move(box['x']+x0,box['y']+y0);page.mouse.down()
   page.mouse.move(box['x']+x1,box['y']+y1,steps=15);page.mouse.up();page.keyboard.up('Shift')
   page.evaluate('window.__viewport.ready()')
   selected=page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").map(n=>n.id)')
   assert len(selected)==12,(selected,coords,box,page.locator('#batch-selection-info').inner_text(),errors)
   page.locator('#canvas').focus();page.keyboard.press('ArrowRight')
   expect(page.locator('#selection-title')).to_have_text('function0')
   assert page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").length')==12
   expect(page.locator('#selection-title')).to_have_text('function0')
   assert '12' in page.locator('#batch-selection-info').text_content()
   assert center==page.evaluate('window.__testGraph.getCanvasByViewport(window.__testGraph.getSize().map(x=>x/2))'),'brush moved camera'
   before=page.evaluate('Object.fromEntries(window.__testGraph.getNodeData().map(n=>[n.id,window.__testGraph.getElementPosition(n.id)]))')
   point=next(n['p'] for n in coords if n['id']=='n5')
   page.mouse.move(box['x']+point[0],box['y']+point[1]);page.mouse.down();page.mouse.move(box['x']+point[0]+40,box['y']+point[1]+30,steps=10);page.mouse.up()
   page.evaluate('window.__viewport.ready()')
   after=page.evaluate('Object.fromEntries(window.__testGraph.getNodeData().map(n=>[n.id,window.__testGraph.getElementPosition(n.id)]))')
   deltas=[(after[id][0]-before[id][0],after[id][1]-before[id][1]) for id in selected]
   assert deltas[0][0]>0 and deltas[0][1]>0,deltas
   assert all(abs(x-deltas[0][0])<.1 and abs(y-deltas[0][1])<.1 for x,y in deltas),deltas
   logical=page.evaluate('Object.fromEntries(window.__viewport.logical().map(n=>[n.id,[n.style.x,n.style.y]]))')
   assert all(abs(logical[id][i]-after[id][i])<.1 for id in selected for i in range(2))
   artifacts=ROOT/'target/test-artifacts/gestures';artifacts.mkdir(parents=True,exist_ok=True)
   for theme in ['light','dark']:
    select_option(page,'#appearance',theme);page.evaluate('window.__viewport.ready()')
    assert page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").length')==12
    page.screenshot(path=str(artifacts/f'batch-{theme}.png'))
   page.locator('#canvas').focus();page.keyboard.press('Space');page.evaluate('window.__viewport.navigationIdle()')
   assert page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").length')==12
   for direction in ['left','up','down','right']:expect(page.locator('#node-'+direction)).to_be_disabled()
   page.locator('#canvas').focus();page.keyboard.press('Escape');page.evaluate('window.__viewport.ready()')
   assert page.evaluate('window.__testGraph.getElementDataByState("node","batch-selected").length')==0
   assert page.evaluate('window.__testGraph.getNodeData().every(n=>!window.__testGraph.context.element.getElement(n.id).getShape("key").attributes.lineDash?.length)')
   page.set_viewport_size({'width':390,'height':844})
   page.locator('#display-settings > summary').click()
   expect(page.locator('#canvas-keyboard-help')).to_be_visible()
   page.wait_for_function("()=>{const b=document.getElementById('canvas-keyboard-help').getBoundingClientRect();return b.top>=0 && b.bottom<=innerHeight;}")
   page.evaluate("Promise.all(document.getElementById('display-settings').getAnimations({subtree:true}).map(a=>a.finished))")
   page.screenshot(path=str(artifacts/'help-narrow.png'))
   assert graphfile.read_bytes()==original
   assert not errors,errors
   browser.close()
  print('Gestures PASS: focus-only arrows, native Shift-brush, camera stability, group drag, Escape and unchanged graph')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
