"""Real JDT LS contract test. Requires callgraph.lsp.local.json and a built binary."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / os.environ.get('CALLGRAPH_JAVA_TEST_BINARY', 'target/java-lsp-test/debug/callgraph-visualizer.exe')
with tempfile.TemporaryDirectory(prefix='java-lsp-', dir=ROOT/'target') as tmp:
    folder = Path(tmp)
    launch=json.loads(Path(os.environ.get('CALLGRAPH_LSP_CONFIG',ROOT/'callgraph.lsp.local.json')).read_text(encoding='utf-8'))
    launch['java']['workspaceRoot']=str(folder/'jdt-workspaces')
    launch_file=folder/'lsp.json'; launch_file.write_text(json.dumps(launch),encoding='utf-8')
    env={**os.environ,'CALLGRAPH_LSP_CONFIG':str(launch_file)}
    source = folder/'project/src'; source.mkdir(parents=True)
    (source/'Main.java').write_text('public class Main {\n public static void main(String[] args) { first(); }\n /** @see Main */\n static void first() { second(); }\n static void second() {}\n}\n', encoding='utf-8')
    config = folder/'projects.json'
    config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'java-test','name':'Java test','root':str(folder/'project')}]}), encoding='utf-8')
    graphs=folder/'graphs'; graphs.mkdir(); output=graphs/'java.json'
    subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','java-test','--file','src/Main.java','--line','2','--column','21','--max-depth','1','--request-budget','1','--output',str(output)],cwd=ROOT,env=env,check=True,timeout=180)
    initial=output.read_bytes(); graph=json.loads(initial)
    assert graph['analysis']['provider'].startswith('eclipse-jdtls')
    assert len(graph['nodes'])==2 and len(graph['edges'])==1
    assert graph['edges'][0]['line']==2
    assert all(n['label'].startswith('Main::') for n in graph['nodes'])
    seed=graph['analysis']['pendingNodes'][0]
    with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(folder/'layouts')],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(); page=browser.new_page()
            for _ in range(100):
                try:
                    if page.request.get(base+'/api/health').ok: break
                except Exception: pass
                time.sleep(.1)
            def post(path,body): return page.request.post(base+path,data=body,headers={'Origin':base},timeout=180000)
            assert post('/api/graphs/java/draft',{'operation':{'action':'analyze','request':{'nodeId':seed,'requestBudget':1,'javaHome':'arbitrary'}}}).status==422
            files=page.request.get(base+'/api/graphs/java/source-files').json()
            assert any(f['name']=='src/Main.java' for f in files)
            file=next(f for f in files if f['name']=='src/Main.java')
            checked=post('/api/graphs/java/entry-check',{'fileId':file['id'],'line':4})
            assert checked.ok,checked.text()
            assert 'first' in checked.json()['node']['label']
            def op(id,action,**extra):
                response=post('/api/graphs/java/draft',{**({'draftId':id} if id else {}),'operation':{'action':action,**extra}})
                assert response.ok,response.text()
                return response.json()
            draft=op(None,'read')['draftId']
            op(draft,'analyze',request={'nodeId':seed,'requestBudget':1})
            for _ in range(1200):
                task=op(draft,'analysisStatus')['result']
                if task['status']!='running': break
                time.sleep(.1)
            assert task['status']=='finished',task
            assert output.read_bytes()==initial
            preview=op(draft,'read')['graph']
            assert len(preview['nodes'])==3 and len(preview['edges'])==2
            assert any(e['line']==4 for e in preview['edges'])
            op(draft,'save'); assert len(json.loads(output.read_bytes())['nodes'])==3
            saved=output.read_bytes()
            next_seed=preview['analysis']['pendingNodes'][0]
            op(draft,'analyze',request={'nodeId':next_seed,'requestBudget':1})
            op(draft,'stopAnalysis')
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                stopped=op(draft,'analysisStatus')['result']
                if stopped['status']!='running': break
                time.sleep(.1)
            assert stopped['status']=='stopped',stopped
            assert output.read_bytes()==saved
            op(draft,'discard')
            page.goto(base+'/?graph=java'); page.wait_for_load_state('networkidle')
            expect(page.locator('#fit')).to_be_enabled()
            page.locator('#symbols').select_option(seed)
            expect(page.locator('#source-location')).to_contain_text('Main.java')
            assert not page.locator('#resume-panel').evaluate('(el)=>el.hidden')
            browser.close()
    finally:
        server.terminate(); server.wait(timeout=15)
print('Java LSP: initial calls, source selection, draft continuation, explicit save and V2 source navigation PASS')
