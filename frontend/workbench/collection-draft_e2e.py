"""Real rust-analyzer + isolated HTTP server + page checkpoint continuation."""
import json,os,pathlib,socket,subprocess,tempfile,time
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
BINARY=ROOT/os.environ.get('CALLGRAPH_TEST_BINARY','target/collection-review/debug/callgraph-visualizer.exe')
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
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
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
   def collect():
    page.select_option('#symbols',seed)
    page.get_by_role('button',name='继续采集',exact=True).click()
    page.locator('#resume-budget').fill('1')
    page.get_by_role('button',name='开始采集',exact=True).click()
    expect(page.locator('#resume-accept')).to_be_visible(timeout=210000)
    assert output.read_bytes()==original
    expect(page.locator('#save-edits')).to_be_enabled()
   collect()
   page.locator('#resume-refresh').click()
   expect(page.locator('#active-collection-status')).to_contain_text('预览中',timeout=30000)
   assert output.read_bytes()==original
   assert not page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('callgraph:loaded-result:'))")
   with page.expect_event('dialog') as dialog:page.evaluate('setTimeout(()=>location.reload(),0)')
   assert dialog.value.type=='beforeunload';dialog.value.dismiss()
   page.once('dialog',lambda dialog:dialog.accept());page.locator('#resume-discard').click()
   expect(page.locator('#active-collection')).to_be_hidden()
   expect(page.locator('#save-edits')).to_be_disabled();assert output.read_bytes()==original
   collect();page.screenshot(path=str(ROOT/'target/collection-pending.png'))
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
   browser.close()
  print('PASS: private draft collection, stop ownership, unchanged disk through preview/discard, leave warning, explicit accept, refresh, CAS conflict')
 finally:
  server.terminate();server.wait(timeout=10)
