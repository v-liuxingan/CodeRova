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
    (source/'Main.java').write_text('public class Main {\n public static void main(String[] args) { Service s = null; s.run(); }\n}\ninterface Service { void run(); }\nclass First implements Service { public void run() { afterFirst(); } void afterFirst() {} }\nclass Second implements Service { public void run() { afterSecond(); } void afterSecond() {} }\nrecord Item(String value) { public void show() {} }\nabstract class Base { public abstract void work(); }\n@interface Entity {}\n@Entity class Order { public void save() {} }\n', encoding='utf-8')
    config = folder/'projects.json'
    config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'java-test','name':'Java test','root':str(folder/'project')}]}), encoding='utf-8')
    graphs=folder/'graphs'; graphs.mkdir(); output=graphs/'java.json'
    subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','java-test','--file','src/Main.java','--line','2','--column','21','--max-depth','5','--request-budget','20','--output',str(output)],cwd=ROOT,env=env,check=True,timeout=180)
    (source/'Unique.java').write_text('public class Unique {\n public static void main(String[] args) { Solo s = null; s.run(); }\n}\ninterface Solo { void run(); }\nclass Only implements Solo { public void run() { after(); } void after() {} }\n', encoding='utf-8')
    def unique_graph(name, depth, budget):
        dest=graphs/(name+'.json')
        subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','java-test','--file','src/Unique.java','--line','2','--column','21','--max-depth',str(depth),'--request-budget',str(budget),'--output',str(dest)],cwd=ROOT,env=env,check=True,timeout=180)
        return json.loads(dest.read_bytes())
    unique=unique_graph('unique-complete',5,20)
    assert any(n['label']=='Only::after()' for n in unique['nodes']),unique
    unique_id=next(n['id'] for n in unique['nodes'] if n['label']=='Only::run()')
    assert unique_id in unique['analysis']['queriedNodes']
    assert unique_id not in unique['analysis']['pendingNodes']
    shallow=unique_graph('unique-depth',2,20)
    assert not any(n['label']=='Only::after()' for n in shallow['nodes'])
    assert unique_id in shallow['analysis']['pendingNodes']
    limited=unique_graph('unique',5,1)
    assert not any(n['label']=='Only::run()' for n in limited['nodes'])
    unique_seed=next(n['id'] for n in limited['nodes'] if n['label']=='Solo::run()')
    initial=output.read_bytes(); graph=json.loads(initial)

    candidates=[e for e in graph['edges'] if e['kind']=='trait-dispatch']
    assert len(candidates)==2,candidates
    selected=next(n for n in graph['nodes'] if n['label'].startswith('First::run'))
    assert selected['id'] in graph['analysis']['pendingNodes']
    assert not any('afterFirst' in n['label'] or 'afterSecond' in n['label'] for n in graph['nodes'])
    declaration=next(n for n in graph['nodes'] if n['label'].startswith('Service::run'))
    assert declaration['symbol']['ownerKind']=='interface',declaration
    seed=selected['id']
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
            files=page.request.get(base+'/api/graphs/java/source-files').json()
            file=next(f for f in files if f['name']=='src/Main.java')
            for line,kind,tag in [(7,'record',None),(8,'abstract-class',None),(10,'class','Entity')]:
                checked=post('/api/graphs/java/entry-check',{'fileId':file['id'],'line':line})
                assert checked.ok,checked.text()
                symbol=checked.json()['node']['symbol']
                assert symbol['ownerKind']==kind,symbol
                if tag: assert tag in symbol['tags'],symbol
            def op(id,action,slug="java",**extra):
                response=post('/api/graphs/'+slug+'/draft',{**({'draftId':id} if id else {}),'operation':{'action':action,**extra}})
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
            assert any('First::afterFirst' in n['label'] for n in preview['nodes']),preview
            assert not any('Second::afterSecond' in n['label'] for n in preview['nodes'])
            other=next(n['id'] for n in preview['nodes'] if n['label'].startswith('Second::run'))
            plan=op(draft,'prune',request={'nodeId':other})['result']
            op(draft,'prune',request={'nodeId':other,'apply':True,'revision':plan['revision']})
            preview=op(draft,'read')['graph']
            assert not any(n['id']==other for n in preview['nodes'])
            assert any(n['id']==declaration['id'] for n in preview['nodes'])
            assert output.read_bytes()==initial
            op(draft,'save')
            saved=json.loads(output.read_bytes())
            assert not any(n['id']==other for n in saved['nodes'])
            unique_draft=op(None,'read',slug='unique')['draftId']
            op(unique_draft,'analyze',slug='unique',request={'nodeId':unique_seed,'requestBudget':3})
            for _ in range(1200):
                task=op(unique_draft,'analysisStatus',slug='unique')['result']
                if task['status']!='running': break
                time.sleep(.1)
            assert task['status']=='finished',task
            unique_preview=op(unique_draft,'read',slug='unique')['graph']
            assert any(n['label']=='Only::after()' for n in unique_preview['nodes'])
            assert unique_id in unique_preview['analysis']['queriedNodes']
            assert unique_id not in unique_preview['analysis']['pendingNodes']
            assert json.loads((graphs/'unique.json').read_bytes())==limited
            op(unique_draft,'discard',slug='unique')
            page.goto(base+'/v2/?graph=java'); page.wait_for_load_state('networkidle')
            expect(page.locator('#fit')).to_be_enabled()
            page.locator('#symbols').select_option(declaration['id'])
            expect(page.locator('#source-location')).to_contain_text('Main.java')
            page.screenshot(path=str(ROOT/'target/java-polymorphism.png'))
            browser.close()
    finally:
        server.terminate(); server.wait(timeout=15)
print('Java polymorphism: candidates stop, explicit continuation, type facts, prune and save PASS')
