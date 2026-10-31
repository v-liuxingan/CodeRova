"""Real rust-analyzer + isolated HTTP server + page checkpoint continuation."""
import json,os,pathlib,socket,subprocess,tempfile,time
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
BINARY=ROOT/'target/collection-review/debug/callgraph-visualizer.exe'
with tempfile.TemporaryDirectory(prefix='resume-',dir=ROOT/'target') as tmp:
 root=pathlib.Path(tmp);project=root/'project';(project/'src').mkdir(parents=True)
 (project/'Cargo.toml').write_text('[package]\nname="resume_fixture"\nversion="0.1.0"\nedition="2021"\n')
 (project/'src/main.rs').write_text('fn main() { b(); }\nfn b() { c(); }\nfn c() {}\n\n')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(project)}]}))
 graphs=root/'graphs';graphs.mkdir();output=graphs/'fixture.json'
 subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/main.rs','--line','1','--column','4','--max-depth','1','--request-budget','1','--output',str(output)],check=True,timeout=210)
 initial=json.loads(output.read_text(encoding='utf-8'));assert len(initial['analysis']['pendingNodes'])==1
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--scenarios',str(ROOT/'scenes'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 bundle=root/'test-bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/v2/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/v2'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,cwd=ROOT)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page()
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   endpoint=base+'/api/graphs/fixture/analysis'
   assert page.request.post(endpoint,data={'requestBudget':1,'nodeId':initial['root']},headers={'Origin':base}).status==400
   assert page.request.get(base+'/api/graphs/fixture/source-files/unknown').status==400
   page.route('**/vendor/v2/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
   page.goto(base+'/v2/?graph=fixture');expect(page.locator('#fit')).to_be_enabled()
   page.select_option('#symbols',initial['root'])
   expect(page.get_by_role('button',name='继续采集',exact=True)).to_be_disabled()
   point=page.evaluate('(id)=>window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition(id))',initial['root'])
   box=page.locator('#canvas').bounding_box();page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
   expect(page.get_by_role('menuitem',name='继续采集')).to_be_disabled()
   page.get_by_role('menuitem',name='添加节点').click()
   expect(page.get_by_role('dialog',name='添加节点')).to_be_visible()
   page.get_by_label('项目文件',exact=True).fill('src/main.rs');page.get_by_role('button',name='打开文件',exact=True).click()
   expect(page.locator('.entry-picker .monaco-editor')).to_be_visible()
   import re
   def choose_line(n):
    page.locator('.entry-picker .line-numbers').filter(has_text=re.compile('^'+str(n)+'$')).click()
   choose_line(4);page.get_by_role('button',name='校验').click()
   expect(page.locator('.entry-picker-status')).to_contain_text('无法添加',timeout=30000)
   expect(page.get_by_role('button',name='添加',exact=True)).to_be_disabled()
   page.get_by_role('button',name='搜索代码').click();expect(page.locator('.entry-picker .find-widget')).to_be_visible()
   page.keyboard.press('Escape')
   choose_line(3);page.get_by_role('button',name='校验').click()
   expect(page.get_by_role('button',name='添加',exact=True)).to_be_enabled(timeout=30000)
   page.screenshot(path=str(ROOT/'target/entry-picker-light.png'))
   page.get_by_label('入口关联说明').fill('消息处理后续入口')
   page.get_by_role('button',name='添加',exact=True).click()
   expect(page.get_by_role('dialog')).not_to_be_visible()
   expect(page.locator('#selection-title')).to_have_text('c')
   assert json.loads(output.read_text(encoding='utf-8'))==initial
   expect(page.locator('#save-edits')).to_be_enabled();page.locator('#save-edits').click();expect(page.locator('#edit-state')).to_have_text('已保存');expect(page.locator('#save-edits')).to_be_disabled()
   saved=json.loads(output.read_text(encoding='utf-8'));target=next(n['id'] for n in saved['nodes'] if n['label']=='c')
   assert page.evaluate('(id)=>window.__testGraph.getNodeData().find(n=>n.data.sourceId===id).data.tone',target)=='manual'
   assert any(e['id'].startswith('manual-async-') and e['callSiteStatus']=='omitted-nodes' for e in saved['edges'])
   width=page.locator('#canvas').bounding_box()['width']
   page.locator('#toggle-library').click();expect(page.locator('#toggle-library')).to_have_attribute('aria-expanded','false')
   assert page.locator('#canvas').bounding_box()['width']>width
   page.locator('#toggle-library').click();page.locator('#toggle-inspector').click()
   expect(page.locator('#toggle-inspector')).to_have_attribute('aria-expanded','false')
   page.locator('#toggle-inspector').click()
   page.get_by_role('button',name='继续采集',exact=True).click();page.locator('#resume-budget').fill('1');page.get_by_role('button',name='开始采集',exact=True).click()
   expect(page.locator('#resume-stop')).to_be_visible();expect(page.locator('#resume-refresh')).to_be_visible(timeout=30000)
   assert page.request.get(endpoint).json()['status']=='idle'
   page.locator('#resume-accept').click();expect(page.locator('#save-edits')).to_be_disabled()
   expect(page.locator('#active-collection')).to_be_hidden()
   final=json.loads(output.read_text(encoding='utf-8'));assert target in final['analysis']['queriedNodes']
   assert initial['analysis']['pendingNodes'][0] in final['analysis']['pendingNodes']
   page.select_option('#appearance','dark');page.screenshot(path=str(ROOT/'target/entry-node-dark.png'))
   prune_url=base+'/api/graphs/fixture/prune'
   assert page.request.post(prune_url,data={'nodeId':initial['root']},headers={'Origin':base}).status==400
   assert page.request.post(prune_url,data={'nodeId':target,'path':'bad'},headers={'Origin':base}).status==422
   assert page.request.post(prune_url,data={'nodeId':target},headers={'Origin':'https://other.invalid'}).status==400
   plan=page.request.post(prune_url,data={'nodeId':target},headers={'Origin':base}).json()
   assert plan['removedNodeIds']==[target] and not plan['applied']
   assert page.request.post(prune_url,data={'nodeId':target,'apply':True,'revision':'stale'},headers={'Origin':base}).status==400
   if not page.locator('.node-edit-tools').evaluate('(d)=>d.open'):page.locator('.node-edit-tools > summary').click()
   with page.expect_event('dialog') as dialog:
    page.get_by_role('button',name='删除',exact=True).click()
   dialog.value.dismiss()
   assert target in [n['id'] for n in json.loads(output.read_text(encoding='utf-8'))['nodes']]
   if not page.locator('.node-edit-tools').evaluate('(d)=>d.open'):page.locator('.node-edit-tools > summary').click()
   with page.expect_event('dialog') as dialog:
    page.get_by_role('button',name='删除',exact=True).click()
   dialog.value.accept()
   expect(page.locator('#coverage-title')).to_contain_text('已减枝 1 个符号')
   page.locator('#save-edits').click();expect(page.locator('#edit-state')).to_have_text('已保存');expect(page.locator('#save-edits')).to_be_disabled()
   pruned=json.loads(output.read_text(encoding='utf-8'));assert target in pruned['analysis']['prunedNodeIds']
   assert target not in [n['id'] for n in pruned['nodes']]
   # AI uses the same API, no browser clicks: b calls the pruned c, which must not return.
   run=subprocess.run(['python','-X','utf8',str(ROOT/'scripts/atlas_agent.py'),'--base',base,'collect','fixture','--max-requests','1','--batch','1'],capture_output=True,text=True,encoding='utf-8',timeout=210)
   assert run.returncode==0,run.stdout+run.stderr
   result=json.loads(run.stdout);assert result['finished'] and result['completedRequests']==1,result
   final=json.loads(output.read_text(encoding='utf-8'));assert not final['analysis']['pendingNodes']
   assert target not in [n['id'] for n in final['nodes']]
   assert target not in final['analysis']['queriedNodes']
   browser.close()
  print('Pruning preview, cancel/commit, root protection, stale revision, strict origin, persistent exclusion and AI automatic checkpoint collection PASS')
 finally:
  server.terminate();server.wait(timeout=10)
