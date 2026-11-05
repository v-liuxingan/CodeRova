"""Isolated large graph: viewport membership, LOD restoration and bounded states.

Assert behavior/work counts, never machine-dependent frame-time thresholds.
"""
import json,os,socket,subprocess,tempfile,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/workbench-e2e/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='viewport-',dir=ROOT/'target') as directory:
 root=Path(directory);graphs=root/'graphs';graphs.mkdir();source=root/'source';source.mkdir()
 (source/'main.rs').write_text('fn main() {}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'Fixture','root':str(source)}]}))
 graph={'schemaVersion':'0.4','projectId':'fixture','title':'Viewport fixture','root':'n0',
  'nodes':[{'id':f'n{i}','kind':'function','role':'','label':f'function{i}','file':'main.rs','line':1} for i in range(800)],
  'edges':[{'id':f'e{i}','from':f'n{(i-1)//4}','to':f'n{i}','kind':'static-call','file':'main.rs','line':1} for i in range(1,800)]}
 graphfile=graphs/'fixture.json';graphfile.write_text(json.dumps(graph));original=graphfile.read_bytes()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  injection='''
window.__viewport={fit:fitLogicalGraph,select:id=>select('node',id,true),pan:async()=>{await renderer.translateBy([-600,0],false);await refreshViewport(true);},
 ready:async()=>{await mountPromise;await new Promise(r=>setTimeout(r,300));},
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
   positions=page.evaluate('window.__viewport.positions()')
   page.evaluate('''()=>{const g=window.__testGraph;window.__original=g;window.__oldShapes=new Map(g.getNodeData().map(n=>[n.id,g.context.element.getElement(n.id)]));window.__setDataCalls=0;const set=g.setData.bind(g);g.setData=(...args)=>{window.__setDataCalls++;return set(...args)};}''')
   page.evaluate('window.__viewport.pan()');page.evaluate('window.__viewport.ready()')
   assert page.evaluate('window.__setDataCalls')==0
   assert page.evaluate('window.__testGraph.getNodeData().filter(n=>window.__oldShapes.has(n.id)).every(n=>window.__oldShapes.get(n.id)===window.__testGraph.context.element.getElement(n.id))')
   page.evaluate('window.__viewport.fit()');page.evaluate('window.__viewport.ready()')
   assert page.evaluate('window.__testGraph.getNodeData().every(n=>n.type==="rect")')
   assert page.evaluate('window.__testGraph.getEdgeData().every(e=>!e.style.label&&!e.style.endArrow)')
   artifacts=ROOT/'target/test-artifacts/performance';artifacts.mkdir(parents=True,exist_ok=True)
   page.screenshot(path=str(artifacts/'overview.png'))
   page.evaluate('''()=>{const g=window.__testGraph;window.__stateCounts=[];const set=g.setElementState.bind(g);g.setElementState=(states,...args)=>{window.__stateCounts.push(Object.keys(states).length);return set(states,...args)};}''')
   page.evaluate('window.__viewport.select("n799")');page.evaluate('window.__viewport.ready()')
   expect(page.locator('#selection-title')).to_have_text('function799')
   assert page.evaluate('window.__testGraph===window.__original')
   assert page.evaluate('window.__stateCounts.every(n=>n<=window.__testGraph.getNodeData().length+window.__testGraph.getEdgeData().length)')
   assert page.evaluate('window.__testGraph.getNodeData().every(n=>n.type==="execution-card")')
   assert page.evaluate('window.__testGraph.getEdgeData().every(e=>e.style.label&&e.style.endArrow)')
   assert positions==page.evaluate('window.__viewport.positions()')
   assert page.evaluate('window.__testGraph.context.element.getElement("n799").getShape("title").isVisible()')
   assert page.evaluate('window.__testGraph.getEdgeData().filter(e=>e.style.labelText).every(e=>window.__testGraph.context.element.getElement(e.id).getShape("label").isVisible())')
   for theme in ['light','dark']:
    select_option(page,'#appearance',theme);page.evaluate('window.__viewport.ready()')
    page.screenshot(path=str(artifacts/f'detail-{theme}.png'))
   # Native hit testing still selects the rendered card after camera-only redraws.
   point=page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("n799"))');box=page.locator('#canvas').bounding_box()
   page.mouse.click(box['x']+point[0],box['y']+point[1]);expect(page.locator('#canvas')).to_have_attribute('data-selection','n799')
   assert graphfile.read_bytes()==original
   assert not errors,errors
   browser.close()
  print('Viewport PASS: incremental membership, retained shapes, overview detail restoration, bounded selection updates, themes, click and unchanged source graph')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
