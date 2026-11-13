"""Evidence-aware node guidance on isolated source/graph fixtures; no LSP mutations."""
import json,os,socket,subprocess,tempfile,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option

ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/workbench-e2e/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='reading-guide-',dir=ROOT/'target') as directory:
 root=Path(directory);source=root/'source';source.mkdir();graphs=root/'graphs';graphs.mkdir()
 (source/'main.rs').write_text('fn main() { work(); done(); }\nfn work() { main(); done(); }\nfn done() {}\nfn candidate() {}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'Fixture','root':str(source)}]}),encoding='utf-8')
 nodes=[{'id':id,'kind':'function','role':'','label':label,'file':'main.rs','line':line,'description':description} for id,label,line,description in [('root','main',1,'组织一次处理流程'),('pending','work',2,''),('leaf','done',3,'处理完成'),('candidate','candidate',4,'')]]
 for node,kind in zip(nodes,['class','abstract-class','enum','interface']):
  node['symbol']={'ownerKind':kind,'ownerName':'FixtureType'}
 edges=[{'id':id,'from':a,'to':b,'kind':'static-call','file':'main.rs','line':line,'callSiteStatus':'exact'} for id,a,b,line in [('work','root','pending',1),('done','root','leaf',1),('shared','pending','leaf',2),('cycle','pending','root',2)]]
 edges.append({'id':'implementation','from':'root','to':'candidate','kind':'trait-dispatch','file':'','line':0,'callSiteStatus':'omitted-nodes','callSiteNote':'实现关系没有调用点；请查看目标方法声明。'})
 graph={'schemaVersion':'0.4','projectId':'fixture','title':'Reading fixture','root':'root','nodes':nodes,'edges':edges,'analysis':{'provider':'rust-analyzer','scope':'project','maxDepth':3,'requestBudget':100,'pendingNodes':['pending','candidate'],'queriedNodes':['root','leaf'],'issues':['pending: <script>not executable</script>']+[f'pending: diagnostic {i}' for i in range(100)]+['leaf: historical timeout']}}
 (graphs/'fixture.json').write_text(json.dumps(graph),encoding='utf-8')
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  bundle=root/'review.js'
  subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph(')+'\\nwindow.__collapse=id=>changeBranch(id,\"collapse\");',resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
   page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('**/vendor/workbench/workbench.js',lambda route:route.fulfill(path=str(bundle),content_type='application/javascript'))
   for _ in range(100):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   response=page.request.get(base+'/api/graphs/fixture');assert response.ok,response.text()
   page.goto(base+'/?graph=fixture')
   try:expect(page.locator('#fit')).to_be_enabled()
   except AssertionError:raise AssertionError((errors,page.locator('#status').inner_text()))
   expect(page.locator('#selection-title')).to_have_text('main')
   assert page.evaluate('window.__testGraph.getNodeData("root").data.tone')=='class'
   assert page.evaluate('''() => {const g=window.__testGraph;return g.context.element.getElement('root').getShape('key').attributes.fill===getComputedStyle(document.documentElement).getPropertyValue('--card-class-bg').trim()}''')
   expect(page.locator('.node-reading-actions .badge')).to_have_text('已查询')
   expect(page.locator('.reading-hint')).to_contain_text('图入口')
   expect(page.locator('#selection-description')).to_have_text('类 · 组织一次处理流程')
   more=page.get_by_role('button',name='更多节点操作',exact=True)
   menu=page.get_by_role('menu',name='分支操作')
   more.click();expect(menu).to_be_visible();expect(more).to_have_attribute('aria-expanded','true')
   page.keyboard.press('End');expect(menu.get_by_role('menuitem',name='编辑说明',exact=True)).to_be_focused()
   page.keyboard.press('Escape');expect(menu).to_be_hidden();expect(more).to_be_focused()
   expect(more).to_have_attribute('aria-expanded','false')
   more.click();page.locator('#selection-title').click();expect(menu).to_be_hidden()
   expect(more).to_have_attribute('aria-expanded','false')
   page.evaluate('window.__collapse("root")')
   expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
   expect(page.locator('.node-reading-actions .badge')).to_have_text('已查询')
   select_option(page,'#symbols','pending')
   expect(page.locator('.node-reading-actions .badge')).to_have_text('待继续')
   expect(page.locator('.reading-origin')).to_contain_text('当前路径来自 main')
   records=page.locator('.reading-records');expect(records).not_to_have_attribute('open','')
   records.locator('summary').click();expect(records.locator('p')).to_have_count(20)
   assert records.locator('script').count()==0
   assert records.locator('div').evaluate('(el)=>el.clientHeight<=120')
   records.locator('summary').click()
   badge=page.locator('.node-reading-actions .badge').bounding_box()
   action=page.locator('.node-reading-actions button').bounding_box()
   assert abs(badge['y']+badge['height']/2-action['y']-action['height']/2)<2
   point=page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("root"))')
   page.get_by_role('button',name='查看调用点',exact=True).click()
   expect(page.locator('#source-location')).to_have_text('main.rs:1')
   expect(page.locator('#selection-title')).to_have_text('main → work')
   assert page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("root"))')==point
   select_option(page,'#symbols','candidate')
   expect(page.locator('.node-reading-actions .badge')).to_have_text('候选实现')
   page.get_by_role('button',name='查看关系依据',exact=True).click()
   expect(page.locator('#source')).to_contain_text('实现关系没有调用点')
   expect(page.locator('#source iframe')).to_have_count(0)
   select_option(page,'#symbols','leaf')
   expect(page.locator('.node-reading-actions .badge')).to_have_text('未记录下游')
   expect(page.locator('.reading-hint')).to_contain_text('不等于业务流程结束')
   expect(page.locator('.node-reading-actions .badge')).not_to_contain_text('失败')
   assert page.locator('#node-right').get_attribute('aria-label')=='向右移动'
   artifacts=ROOT/'target/test-artifacts/iteration-two';artifacts.mkdir(parents=True,exist_ok=True)
   page.locator('#fit').click()
   for theme,width in [('light',1440),('dark',1440),('light',390),('dark',390)]:
    page.set_viewport_size({'width':width,'height':960});page.evaluate('window.scrollTo(0,0)');select_option(page,'#appearance',theme)
    page.locator('#source-inspector').scroll_into_view_if_needed()
    page.wait_for_timeout(250) # Capture settled theme colors, not the CSS transition.
    page.screenshot(path=str(artifacts/f'reading-{theme}-{width}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
   for theme,width in [('light',1440),('dark',390)]:
    page.set_viewport_size({'width':width,'height':960});select_option(page,'#appearance',theme)
    page.locator('.node-reading-actions button').click()
    dialog=page.get_by_role('dialog',name='继续采集',exact=True);expect(dialog).to_be_visible()
    page.wait_for_timeout(250)
    page.screenshot(path=str(artifacts/f'collection-{theme}-{width}.png'))
    bounds=dialog.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=width
    dialog.get_by_role('button',name='取消',exact=True).click()
   # Search the full graph, including results beyond the rendered dropdown cap.
   search_nodes=[dict(nodes[0],id=f'search-{i}',label=f'handle{i}',symbol={'ownerKind':'class','ownerName':'SearchOwner' if i>=248 else 'OtherOwner'}) for i in range(250)]
   search_graph={**graph,'root':'search-0','nodes':search_nodes,'edges':[{'id':f'search-edge-{i}','from':'search-0','to':f'search-{i}','kind':'static-call','file':'main.rs','line':1} for i in range(1,250)]}
   search_graph.pop('analysis')
   (graphs/'search-fixture.json').write_text(json.dumps(search_graph),encoding='utf-8')
   page.set_viewport_size({'width':1440,'height':960});page.goto(base+'/?graph=search-fixture');expect(page.locator('#fit')).to_be_enabled()
   expect(page.locator('#symbol-filter')).to_have_count(0)
   wrapper=page.locator('[data-select-id="symbols"]');wrapper.locator('.ts-control').click()
   field=wrapper.locator('.dropdown-input');expect(wrapper.locator('[data-selectable]')).to_have_count(100)
   expect(wrapper.locator('.node-search-limit')).to_contain_text('250')
   before=page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("search-0"))')
   field.fill('SearchOwner');expect(wrapper.locator('[data-selectable]')).to_have_count(2)
   expect(wrapper.locator('.node-option-context').first).to_contain_text('main.rs:1')
   assert before==page.evaluate('window.__testGraph.getViewportByCanvas(window.__testGraph.getElementPosition("search-0"))')
   wrapper.locator('[data-value="search-248"]').click();expect(page.locator('#selection-title')).to_have_text('handle248')
   wrapper.locator('.ts-control').click();field.fill('search-249');wrapper.locator('[data-value="search-249"]').click();expect(page.locator('#selection-title')).to_have_text('handle249')
   wrapper.locator('.ts-control').click();field.fill('main.rs');expect(wrapper.locator('[data-selectable]')).to_have_count(100)
   field.fill('search-249');expect(wrapper.locator('[data-selectable]')).to_have_count(1)
   field.fill('no-such-symbol');expect(wrapper.locator('.no-results')).to_have_text('没有匹配节点')
   field.press('Escape');expect(page.locator('#selection-title')).to_have_text('handle249')
   wrapper.locator('.ts-control').click();field.fill('handle248');page.keyboard.press('ArrowDown');page.keyboard.press('Enter')
   expect(page.locator('#selection-title')).to_have_text('handle248')
   assert page.locator('#symbols option').count()<=2
   page.screenshot(path=str(artifacts/'unified-node-search.png'))
   for theme,width in [('light',1440),('dark',390)]:
    page.set_viewport_size({'width':width,'height':960});select_option(page,'#appearance',theme)
    wrapper.locator('.ts-control').click();field.fill('SearchOwner');page.wait_for_timeout(250)
    page.screenshot(path=str(artifacts/f'node-search-{theme}-{width}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    field.press('Escape')
   page.goto(base+'/');expect(page.locator('.home-start')).to_be_visible()
   for theme,width in [('light',1440),('dark',390)]:
    page.set_viewport_size({'width':width,'height':960});select_option(page,'#appearance',theme)
    page.wait_for_timeout(250)
    page.screenshot(path=str(artifacts/f'home-{theme}-{width}.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
   assert not errors,errors
   browser.close()
  print('Reading guidance PASS: root selection, collapsed facts, historical issues, exact call evidence, candidate boundary, source safety, themes and narrow layout')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
