"""Real rust-analyzer + isolated HTTP server + page checkpoint continuation."""
import json,os,pathlib,socket,subprocess,tempfile,time
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
BINARY=ROOT/'target/collection-review/debug/coderova.exe'
with tempfile.TemporaryDirectory(prefix='resume-',dir=ROOT/'target') as tmp:
 root=pathlib.Path(tmp);project=root/'project';(project/'src').mkdir(parents=True)
 (project/'Cargo.toml').write_text('[package]\nname="resume_fixture"\nversion="0.1.0"\nedition="2021"\n')
 (project/'src/main.rs').write_text('fn main() { b(); }\nfn b() { c(); }\nfn c() {}\n')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(project)}]}))
 graphs=root/'graphs';graphs.mkdir();output=graphs/'fixture.json'
 subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/main.rs','--line','1','--column','4','--max-depth','0','--request-budget','1','--output',str(output)],check=True,timeout=210)
 receiver=graphs/'receiver.json'
 subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/main.rs','--line','2','--column','4','--max-depth','0','--request-budget','1','--output',str(receiver)],check=True,timeout=210)
 target=json.loads(receiver.read_text(encoding='utf-8'))['root']
 initial=json.loads(output.read_text(encoding='utf-8'));assert len(initial['analysis']['pendingNodes'])==1
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--scenarios',str(ROOT/'scenes'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page()
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   endpoint=base+'/api/graphs/fixture/analysis'
   assert page.request.post(endpoint,data={'requestBudget':1,'nodeId':'missing'},headers={'Origin':base}).status==400
   page.goto(base+'/?graph=fixture');expect(page.locator('#fit')).to_be_enabled()
   page.select_option('#symbols',initial['root'])
   response=page.request.post(base+'/api/graphs/fixture/links',data={'fromId':initial['root'],'targetGraph':'receiver','targetId':target,'note':'消息处理后续，人工核验'},headers={'Origin':base});assert response.ok,response.text()
   page.reload();page.select_option('#symbols',target)
   saved=json.loads(output.read_text(encoding='utf-8'));link=saved['edges'][0]
   assert link['kind']=='async-boundary' and link['callSiteStatus']=='omitted-nodes'
   assert link['line']==0 and link['confidence']==0 and link['to']==target
   assert len(saved['nodes'])==2 and len(saved['analysis']['pendingNodes'])==2
   pass
   page.get_by_role('button',name='继续采集',exact=True).click();page.locator('#resume-budget').fill('1');page.get_by_role('button',name='开始采集',exact=True).click()
   expect(page.locator('#resume-stop')).to_be_visible()
   expect(page.locator('#resume-refresh')).to_be_visible(timeout=210000)
   status=page.request.get(endpoint).json();assert status['status']=='finished',status
   saved=json.loads(output.read_text(encoding='utf-8'))
   assert target in saved['analysis']['queriedNodes'] and initial['root'] in saved['analysis']['pendingNodes']
   assert len(saved['nodes'])==3 and len(saved['edges'])==2
   assert page.request.delete(base+'/api/graphs/fixture/links/'+saved['edges'][1]['id'],headers={'Origin':base}).status==400
   assert page.request.delete(base+'/api/graphs/fixture/links/'+link['id'],headers={'Origin':base}).ok
   final=json.loads(output.read_text(encoding='utf-8'));assert len(final['edges'])==1 and len(final['nodes'])==3
   assert page.request.post(base+'/api/graphs/fixture/links',data={'fromId':initial['root'],'targetGraph':'receiver','targetId':target,'note':'','path':'arbitrary'},headers={'Origin':base}).status==422
   browser.close()
  print('Manual async bridge: page selection, explicit provenance, targeted collection, unrelated pending preserved and undo PASS')
 finally:
  server.terminate();server.wait(timeout=10)
