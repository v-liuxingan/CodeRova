"""Group deletion uses isolated files; never mutates the user's graph catalog."""
import json, os, socket, subprocess, tempfile, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
BINARY=ROOT/os.environ.get('CALLGRAPH_TEST_BINARY','target/source-navigation-test/debug/callgraph-visualizer.exe')
with tempfile.TemporaryDirectory(prefix='groups-',dir=ROOT/'target') as tmp:
 root=Path(tmp); project=root/'project';project.mkdir();(project/'main.rs').write_text('fn main() {}\n')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':id,'name':id,'root':str(project)} for id in ['fixture','other']]}))
 graphs=root/'graphs';graphs.mkdir()
 for slug,title,pid in [('a','Alpha','fixture'),('b','Beta','fixture'),('c','Other','other')]:
  graph={'schemaVersion':'0.4','projectId':pid,'categoryId':'group','category':'Examples','title':title,'root':'root','nodes':[{'id':'root','kind':'function','label':'main','file':'main.rs','line':1,'role':'entry'}],'edges':[]}
  (graphs/(slug+'.json')).write_text(json.dumps(graph))
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   page.goto(base+'/v2/?graph=a');expect(page.locator('#fit')).to_be_enabled()
   group=page.locator('.tree-group[data-project="fixture"][data-category="group"]')
   group.get_by_role('button',name='删除分组 Examples',exact=True).click()
   expect(page.locator('dialog[open]')).to_contain_text('全部 2 张')
   page.get_by_role('button',name='取消',exact=True).click()
   assert (graphs/'a.json').exists() and (graphs/'b.json').exists()
   # One success, then failure: reconcile both trees and preserve the remaining file.
   page.route('**/api/graphs/b',lambda r:r.fulfill(status=500,content_type='application/json',body='{"error":"fixture failure"}') if r.request.method=='DELETE' else r.continue_())
   group.get_by_role('button',name='删除分组 Examples',exact=True).click()
   page.locator('dialog[open] button[type=submit]').click()
   expect(page.locator('#status')).to_contain_text('1/2')
   assert not (graphs/'a.json').exists() and (graphs/'b.json').exists() and (graphs/'c.json').exists()
   expect(page.locator('[data-graph="a"]')).to_have_count(0)
   assert page.request.post(base+'/api/graph-trash/a/restore').ok
   page.unroute('**/api/graphs/b')
   page.reload();expect(page.locator('#fit')).to_be_enabled()
   page.locator('#filter').fill('Alpha')
   group.get_by_role('button',name='删除分组 Examples',exact=True).click()
   expect(page.locator('dialog[open]')).to_contain_text('全部 2 张')
   page.locator('dialog[open] button[type=submit]').click()
   expect(page.locator('dialog[open]')).to_have_count(0)
   expect(page.locator('#catalog')).to_have_attribute('aria-busy','false')
   assert not (graphs/'a.json').exists() and not (graphs/'b.json').exists()
   assert (graphs/'c.json').exists() and (project/'main.rs').exists()
   trash=page.request.get(base+'/api/graph-trash').json();assert {g['slug'] for g in trash}=={'a','b'}
   page.locator('#filter').fill('');page.reload();expect(page.locator('#fit')).to_be_enabled()
   expect(group).to_have_count(0)
   # The outer project directory includes all categories, even under a filter.
   for slug in ['a','b']:
    assert page.request.post(base+f'/api/graph-trash/{slug}/restore').ok
   second=json.loads((graphs/'b.json').read_text());second['categoryId']='second';second['category']='Second'
   (graphs/'b.json').write_text(json.dumps(second))
   page.reload();expect(page.locator('#fit')).to_be_enabled()
   project_folder=page.locator('.tree-project[data-folder="fixture"]')
   page.locator('#filter').fill('Alpha')
   project_folder.get_by_role('button',name='删除目录 fixture',exact=True).click()
   expect(page.locator('dialog[open]')).to_contain_text('全部 2 张')
   page.get_by_role('button',name='取消',exact=True).click()
   assert (graphs/'a.json').exists() and (graphs/'b.json').exists()
   project_folder.get_by_role('button',name='删除目录 fixture',exact=True).click()
   page.locator('dialog[open] button[type=submit]').click()
   expect(page.locator('#status')).to_contain_text('已删除目录')
   page.locator('#filter').fill('');page.reload();expect(page.locator('#fit')).to_be_enabled()
   expect(project_folder).to_have_count(0)
   assert (graphs/'c.json').exists() and (project/'main.rs').exists() and config.exists()
   assert page.request.post(base+'/api/graph-trash/a/restore').ok
   page.reload();expect(project_folder).to_be_visible()
   expect(page.locator('[data-graph="a"]')).to_be_visible()
   page.screenshot(path=str(ROOT/'target/group-delete.png'))
   browser.close()
 finally:server.terminate();server.wait(timeout=15)
print('Group deletion: cancel, complete filtered membership, project isolation, partial failure, recovery and refresh PASS')
