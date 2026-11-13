import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tests"))
from browser_controls import select_option
"""Real rust-analyzer + isolated HTTP server + page checkpoint continuation."""
import json,os,pathlib,socket,subprocess,tempfile,time
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
BINARY=ROOT/os.environ.get('CALLGRAPH_TEST_BINARY','target/collection-review/debug/coderova.exe')
with tempfile.TemporaryDirectory(prefix='resume-',dir=ROOT/'target') as tmp:
 root=pathlib.Path(tmp);project=root/'project';(project/'src').mkdir(parents=True)
 (project/'Cargo.toml').write_text('[package]\nname="resume_fixture"\nversion="0.1.0"\nedition="2021"\n')
 (project/'src/main.rs').write_text('fn main() { b(); }\nfn b() { c(); }\nfn c() {}\n')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(project)}]}))
 graphs=root/'graphs';graphs.mkdir();output=graphs/'fixture.json'
 subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/main.rs','--line','1','--column','4','--max-depth','1','--request-budget','1','--output',str(output)],check=True,timeout=210)
 initial=json.loads(output.read_text(encoding='utf-8'));assert len(initial['analysis']['pendingNodes'])==1
 (graphs/'other.json').write_text(json.dumps(initial),encoding='utf-8')
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--scenarios',str(ROOT/'scenes'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  bundle=root/'review-bundle.js'
  subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
   page.route('**/vendor/workbench/workbench.js',lambda route:route.fulfill(path=str(bundle),content_type='application/javascript'))
   errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   original=output.read_bytes();seed=initial['analysis']['pendingNodes'][0]
   endpoint=base+'/api/graphs/fixture/draft'
   def op(id,action,**extra):
    return page.request.post(endpoint,data={**({'draftId':id} if id else {}),'operation':{'action':action,**extra}},headers={'Origin':base})
   assert op(None,'analyze',request={'nodeId':seed,'requestBudget':1,'path':'arbitrary'}).status==422
   draft=op(None,'read').json()['draftId']
   other=op(None,'read').json()['draftId']
   assert op(draft,'analyze',request={'nodeId':seed,'requestBudget':1}).ok
   assert op(other,'stopAnalysis').status==400
   assert op(other,'analysisStatus').json()['result']['status']=='idle'
   assert op(draft,'save').status==400
   assert op(draft,'stopAnalysis').ok
   for _ in range(2100):
    state=op(draft,'analysisStatus').json()
    if state['result']['status']!='running':break
    time.sleep(.1)
   assert state['dirty'] and output.read_bytes()==original
   assert op(draft,'discard').ok;assert op(other,'discard').ok
   # Page flow: configure -> collect -> preview -> discard, then collect -> accept.
   page.goto(base+'/?graph=fixture');expect(page.locator('#fit')).to_be_enabled()
   def collect(lost_start=False):
    select_option(page,'#symbols',seed)
    page.get_by_role('button',name='继续采集',exact=True).click()
    page.locator('#resume-budget').fill('1')
    page.get_by_role('button',name='开始采集',exact=True).click()
    if lost_start:
     expect(page.locator('.collection-error')).to_contain_text('启动响应未确认')
     page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='取消',exact=True).click()
    expect(page.locator('#collection-indicator')).to_have_text('待采纳',timeout=210000)
    if not page.locator('#graph-details').evaluate('(el)=>el.open'):page.locator('#graph-details > summary').click()
    expect(page.locator('#resume-accept')).to_be_visible(timeout=210000)
    assert output.read_bytes()==original
    expect(page.locator('#save-edits')).to_be_enabled()
   collect()
   # A temporary status transport failure must recover without re-starting collection.
   reads={'failed':False}
   def fail_status_once(route):
    body=route.request.post_data_json
    if body.get('operation',{}).get('action')=='analysisStatus' and not reads['failed']:
     reads['failed']=True;route.abort('failed')
    else:route.continue_()
   page.route('**/api/graphs/fixture/draft',fail_status_once)
   # Keep the user's current reading focus, even if it differs from the collection origin.
   select_option(page,'#symbols',initial['root'])
   expect(page.locator('#source iframe')).to_have_count(1)
   page.evaluate("window.__retainedSource=document.querySelector('#source iframe')")
   page.evaluate('''async()=>{window.__retainedView=window.__testGraph;await window.__testGraph.zoomTo(.9,false);await window.__testGraph.translateBy([73,31],false);}''')
   def camera():return page.evaluate('''()=>({zoom:window.__testGraph.getZoom(),point:window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(document.querySelector('#canvas').dataset.selection))})''')
   before=camera()
   page.locator('#resume-refresh').click()
   expect(page.locator('#active-collection-status')).to_contain_text('预览中',timeout=30000)
   assert reads['failed']
   expect(page.locator('#canvas')).to_have_attribute('data-selection',initial['root'])
   assert page.evaluate('window.__testGraph===window.__retainedView')
   assert page.evaluate("document.querySelector('#source iframe')===window.__retainedSource")
   after=camera();assert abs(after['zoom']-before['zoom'])<.001,(before,after)
   assert max(abs(a-b) for a,b in zip(before['point'],after['point']))<2,(before,after)
   assert page.evaluate('window.__testGraph.getNodeData().length')==3
   artifacts=ROOT/'target/test-artifacts/iteration-one';artifacts.mkdir(parents=True,exist_ok=True)
   for theme,width in [('light',1440),('dark',1440),('light',390),('dark',390)]:
    select_option(page,'#appearance',theme);page.set_viewport_size({'width':width,'height':960})
    page.screenshot(path=str(artifacts/f'collection-{theme}-{width}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
   page.set_viewport_size({'width':1440,'height':960});select_option(page,'#appearance','light')
   assert output.read_bytes()==original
   assert not page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('callgraph:loaded-result:'))")
   with page.expect_event('dialog') as dialog:page.evaluate('setTimeout(()=>location.reload(),0)')
   assert dialog.value.type=='beforeunload';dialog.value.dismiss()
   expect(page.locator('#graph-toolbar')).to_be_visible()
   if not page.locator('#graph-details').evaluate('(el)=>el.open'):page.locator('#graph-details > summary').click()
   page.once('dialog',lambda dialog:dialog.accept());page.locator('#resume-discard').click()
   expect(page.locator('#active-collection')).to_be_hidden()
   expect(page.locator('#save-edits')).to_be_disabled();assert output.read_bytes()==original
   assert page.evaluate('window.__testGraph===window.__retainedView')
   assert page.evaluate('window.__testGraph.getNodeData().length')==2
   lost={'starts':0}
   def lose_start_response(route):
    if route.request.post_data_json.get('operation',{}).get('action')=='analyze':
     lost['starts']+=1
     response=route.fetch();assert response.ok
     route.abort('failed')
    else:route.fallback()
   page.route('**/api/graphs/fixture/draft',lose_start_response)
   collect(lost_start=True);assert lost['starts']==1
   page.screenshot(path=str(ROOT/'target/collection-pending.png'))
   page.locator('#resume-accept').click();expect(page.locator('#active-collection')).to_be_hidden()
   expect(page.locator('#save-edits')).to_be_disabled()
   saved=json.loads(output.read_text(encoding='utf-8'));assert len(saved['nodes'])==3 and len(saved['edges'])==2
   page.reload();expect(page.locator('#fit')).to_be_enabled();expect(page.locator('#active-collection')).to_be_hidden()
   # Saving against an externally changed file must not silently overwrite it.
   output.write_bytes(original);draft=op(None,'read').json()['draftId']
   assert op(draft,'analyze',request={'nodeId':seed,'requestBudget':1}).ok
   for _ in range(2100):
    state=op(draft,'analysisStatus').json()
    if state['result']['status']!='running':break
    time.sleep(.1)
   changed=dict(initial,title='external change');output.write_text(json.dumps(changed),encoding='utf-8')
   assert op(draft,'save').status==400
   assert op(draft,'read').json()['dirty']
   assert json.loads(output.read_text(encoding='utf-8'))['title']=='external change'
   assert op(draft,'discard').ok
   assert not errors,errors
   browser.close()
  print('PASS: private draft collection, stop ownership, unchanged disk through preview/discard, leave warning, explicit accept, refresh, CAS conflict')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
