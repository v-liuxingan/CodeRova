"""Draft isolation, save conflicts and browser leave/hide semantics on an isolated server."""
import json,pathlib,socket,subprocess,tempfile,time,os
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[2]
BINARY=ROOT/os.environ.get('CALLGRAPH_TEST_BINARY','target/frontend-e2e/debug/callgraph-visualizer.exe')
with tempfile.TemporaryDirectory(prefix='drafts-',dir=ROOT/'target') as tmp:
 root=pathlib.Path(tmp);project=root/'project';project.mkdir();(project/'main.rs').write_text('fn main() {}\n')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(project)}]}))
 graphs=root/'graphs';graphs.mkdir()
 graph={'schemaVersion':'0.4','projectId':'fixture','title':'draft test','root':'root','nodes':[{'id':id,'kind':'function','label':id,'file':'main.rs','line':1,'role':'test'} for id in ['root','a','b']],'edges':[{'id':str(i),'from':a,'to':b,'kind':'static-call','file':'main.rs','line':1} for i,(a,b) in enumerate([('root','a'),('a','b')])]}
 output=graphs/'fixture.json';output.write_text(json.dumps(graph));(graphs/'other.json').write_text(json.dumps(dict(graph,title='other graph')))
 original=output.read_bytes()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--scenarios',str(ROOT/'scenes'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  bundle=root/'review-bundle.js'
  subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   endpoint=base+'/api/graphs/fixture/draft'
   def op(action,id=None,**extra):
    return page.request.post(endpoint,data={**({'draftId':id} if id else {}),'operation':{'action':action,**extra}},headers={'Origin':base})
   assert op('read',path='bad').status==422
   assert op('prune',request={'nodeId':'missing'}).status==400
   d=op('read').json();draft=d['draftId'];assert not d['dirty']
   linked=op('open',draft,request={'graph':'fixture','targetType':'node','id':'root'})
   assert linked.ok and linked.json()['result']['uri'].startswith('vscode://file/')
   assert not linked.json()['dirty'] and output.read_bytes()==original
   assert op('open',draft,request={'graph':'other','targetType':'node','id':'root'}).status==400
   assert op('open',draft,request={'graph':'fixture','targetType':'node','id':'root','path':'arbitrary'}).status==422
   plan=op('prune',draft,request={'nodeId':'a','apply':False}).json()['result']
   staged=op('prune',draft,request={'nodeId':'a','apply':True,'revision':plan['revision']}).json();assert staged['dirty']
   assert op('open',draft,request={'graph':'fixture','targetType':'node','id':'a'}).status in (400,404)
   assert staged['changes']['removedNodes']==2 and output.read_bytes()==original
   assert len(page.request.get(base+'/api/graphs/fixture').json()['nodes'])==3
   second=op('read').json();assert len(second['graph']['nodes'])==3
   op('discard',second['draftId'])
   changed=dict(graph,title='external change');output.write_text(json.dumps(changed))
   assert op('save',draft).status==400
   assert op('read',draft).json()['dirty']
   assert json.loads(output.read_text(encoding='utf-8'))['title']=='external change'
   assert op('discard',draft).ok
   clean=op('read').json()['draftId'];assert op('save',clean).ok;assert op('save',clean).ok;assert not op('read',clean).json()['dirty'];assert op('discard',clean).ok
   output.write_bytes(original)
   page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
   page.goto(base+'/?graph=fixture');expect(page.locator('#fit')).to_be_enabled()
   opened=[]
   def source_link(route):
    opened.append(route.request.post_data_json)
    route.fulfill(status=200,content_type='application/json',body=json.dumps({'uri':'#source-test','path':'main.rs','line':1,'column':1}))
   page.route('**/api/open',source_link)
   page.select_option('#symbols','root')
   expect(page.locator('#open-source')).to_be_visible()
   assert not opened
   page.locator('#open-source').click()
   expect(page.locator('#status')).to_contain_text('已请求')
   assert opened[-1]=={'graph':'fixture','targetType':'node','id':'root'}
   page.locator('#click-source').click()
   page.evaluate("window.__testGraph.emit('node:click',{target:{id:window.__testGraph.getNodeData().find(n=>(n.data.sourceId||n.id)==='a').id}})")
   expect(page.locator('#selection-title')).to_have_text('a')
   page.wait_for_function("location.hash==='#source-test'")
   expect(page.locator('#open-source')).to_be_enabled()
   assert opened[-1]['id']=='a'
   page.locator('#click-source').click()
   def choose():
    page.select_option('#symbols','a');page.locator('.node-edit-tools > summary').click()
   def edge_menu():
    edge=page.evaluate("()=>{const g=window.__testGraph,n=g.getNodeData().find(n=>(n.data.sourceId||n.id)==='a');return g.getEdgeData().find(e=>e.target===n.id).id}")
    page.evaluate('(id)=>window.__testGraph.focusElement(id,false)',edge)
    point=page.evaluate("id=>{const g=window.__testGraph,p=g.context.element.getElement(id).getShape('key').getPoint(.5);return g.getViewportByCanvas([p.x,p.y]);}",edge)
    box=page.locator('#canvas').bounding_box()
    page.mouse.click(box['x']+point[0],box['y']+point[1],button='right')
    expect(page.locator('#edge-context-menu')).to_be_visible()
    expect(page.locator('.edge-menu-target')).to_have_text('a')
   def prune():
    edge_menu()
    with page.expect_event('dialog') as dialog:page.get_by_role('menuitem',name='删除',exact=True).click()
    dialog.value.accept();expect(page.locator('#save-edits')).to_be_enabled()
   choose()
   page.screenshot(path=str(ROOT/'target/inspector-selected.png'))
   page.evaluate("async()=>{await window.__testGraph.zoomTo(1.2,false);await window.__testGraph.translateBy([37,29],false)}")
   edge_menu()
   page.evaluate("()=>{const g=window.__testGraph;window.beforeHide={graph:g,zoom:g.getZoom(),screen:g.getViewportByCanvas([0,0]).slice(0,2).map((v,i)=>v+document.querySelector('#canvas').getBoundingClientRect()[i?'top':'left']),root:g.getElementPosition('root'),child:g.getElementPosition('a')};}")
   page.get_by_role('menuitem',name='隐藏',exact=True).click()
   expect(page.locator('#restore-hidden')).to_be_visible();expect(page.locator('#save-edits')).to_be_disabled()
   assert output.read_bytes()==original
   page.wait_for_function("()=>document.querySelector('#status').textContent.startsWith('已临时隐藏')")
   assert page.evaluate("()=>{const g=window.__testGraph,b=window.beforeHide;return g===b.graph && g.getZoom()===b.zoom && g.getViewportByCanvas([0,0]).slice(0,2).every((v,i)=>Math.abs(v+document.querySelector('#canvas').getBoundingClientRect()[i?'top':'left']-b.screen[i])<0.1) && JSON.stringify(g.getElementPosition('root'))===JSON.stringify(b.root) && g.getNodeData().length===1;}")
   page.locator('#restore-hidden').click()
   expect(page.locator('#restore-hidden')).to_be_hidden()
   page.wait_for_function("()=>document.querySelector('#status').textContent.startsWith('已恢复隐藏')")
   assert page.evaluate("()=>{const g=window.__testGraph,b=window.beforeHide;return g===b.graph && g.getZoom()===b.zoom && g.getViewportByCanvas([0,0]).slice(0,2).every((v,i)=>Math.abs(v+document.querySelector('#canvas').getBoundingClientRect()[i?'top':'left']-b.screen[i])<0.1) && JSON.stringify(g.getElementPosition('a'))===JSON.stringify(b.child) && g.getNodeData().length===3;}")
   page.reload();expect(page.locator('#restore-hidden')).to_be_hidden();choose()
   prune();assert output.read_bytes()==original
   with page.expect_event('dialog') as dialog:page.evaluate('setTimeout(()=>location.reload(),0)')
   assert dialog.value.type=='beforeunload';dialog.value.dismiss()
   expect(page.locator('#save-edits')).to_be_enabled()
   page.locator('.tree-open[data-slug="other"]').click()
   expect(page.get_by_role('dialog',name='保存当前图的修改？')).to_be_visible()
   page.screenshot(path=str(ROOT/'target/draft-leave-light.png'))
   page.get_by_role('button',name='取消',exact=True).click();expect(page.locator('#title')).to_have_text('draft test')
   page.locator('.tree-open[data-slug="other"]').click();page.get_by_role('button',name='放弃修改',exact=True).last.click()
   expect(page.locator('#title')).to_have_text('other graph');assert output.read_bytes()==original
   page.locator('.tree-open[data-slug="fixture"]').click();expect(page.locator('#title')).to_have_text('draft test')
   prune();page.locator('.tree-open[data-slug="other"]').click();page.get_by_role('button',name='保存并离开',exact=True).click()
   expect(page.locator('#title')).to_have_text('other graph');assert len(json.loads(output.read_text(encoding='utf-8'))['nodes'])==1
   page.locator('.tree-open[data-slug="fixture"]').click();expect(page.locator('#title')).to_have_text('draft test')
   expect(page.locator('#save-edits')).to_be_disabled();page.select_option('#appearance','dark')
   page.screenshot(path=str(ROOT/'target/draft-saved-dark.png'))
   # Removing a wide branch must reclaim its space, not just hide its shapes.
   ids=['root','a','b']+[f'{parent}{i}' for parent in ['a','b'] for i in range(4)]
   pairs=[('root','a'),('root','b')]+[(parent,f'{parent}{i}') for parent in ['a','b'] for i in range(4)]
   wide=dict(graph,nodes=[dict(graph['nodes'][0],id=id,label=id) for id in ids],edges=[dict(graph['edges'][0],id=str(i),**{'from':a,'to':b}) for i,(a,b) in enumerate(pairs)])
   output.write_text(json.dumps(wide));wide_bytes=output.read_bytes()
   for direction,axis in [('LR',1),('TB',0)]:
    page.reload();expect(page.locator('#fit')).to_be_enabled()
    page.locator(f'#direction input[value={direction}]').check()
    expect(page.locator('#apply-window')).to_be_enabled()
    choose()
    edge_menu()
    before=page.evaluate('''axis=>{const g=window.__testGraph;return {gap:Math.abs(g.getElementPosition('b')[axis]-g.getElementPosition('root')[axis]),zoom:g.getZoom()}}''',axis)
    page.get_by_role('menuitem',name='隐藏',exact=True).click()
    page.wait_for_function("()=>document.querySelector('#status').textContent.startsWith('已临时隐藏')")
    after=page.evaluate('''axis=>{const g=window.__testGraph;return {gap:Math.abs(g.getElementPosition('b')[axis]-g.getElementPosition('root')[axis]),zoom:g.getZoom(),count:g.getNodeData().length}}''',axis)
    assert after['gap']<before['gap'],(direction,before,after)
    assert after['zoom']==before['zoom'] and after['count']==6
    assert output.read_bytes()==wide_bytes
    page.locator('#restore-hidden').click()
    page.wait_for_function("()=>document.querySelector('#status').textContent.startsWith('已恢复隐藏')")
    assert page.evaluate('window.__testGraph.getNodeData().length')==len(ids)
   browser.close()
  print('Draft API isolation, conflict preservation, temporary hide refresh, explicit save, beforeunload and save/discard/cancel navigation PASS')
 finally:server.terminate();server.wait(timeout=10)
