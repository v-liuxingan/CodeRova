"""Unified home and current reader, using runner-owned fixtures."""
import json, os, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option
BASE=os.environ['CALLGRAPH_TEST_URL']
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
 # Legacy fixture is served canonically, while browser preview still resolves its source.
 wire=page.request.get(BASE+'/api/graphs/sample').json()
 assert wire['schemaVersion']=='0.5'
 assert wire['nodes'][0]['sourceFile']=='main.rs' and 'file' not in wire['nodes'][0]
 edge=wire['edges'][0]
 assert (edge['source'],edge['target'],edge['relation'])==('root','child','static-call')
 assert 'confidenceScore' in edge and not {'from','to','kind','confidence','file'}.intersection(edge)
 # Batch descriptions are atomic draft edits; source evidence is immutable.
 endpoint=BASE+'/api/graphs/sample/draft'
 headers={'Origin':BASE}
 opened=page.request.post(endpoint,headers=headers,data={'operation':{'action':'read'}}).json()
 did=opened['draftId']
 def edit(op):return page.request.post(endpoint,headers=headers,data={'draftId':did,'operation':op})
 assert edit({'action':'describe','edits':[{'targetType':'node','id':'root','description':'入口职责'},{'targetType':'edge','id':'call','description':'调用含义'}]}).ok
 changed=edit({'action':'read'}).json()['graph']
 assert changed['nodes'][0]['description']=='入口职责' and changed['edges'][0]['description']=='调用含义'
 assert page.request.get(BASE+'/api/graphs/sample').json()==wire
 assert not edit({'action':'describe','edits':[{'targetType':'node','id':'root','description':'不应应用'},{'targetType':'node','id':'missing','description':'x'}]}).ok
 assert edit({'action':'read'}).json()['graph']==changed
 assert edit({'action':'describe','edits':[{'targetType':'node','id':'root','description':'x','sourceFile':'x'}]}).status==422
 # Batch prune shares the draft/CAS contract and rejects an entire invalid set.
 for request in [{'nodeIds':[]},{'nodeIds':['child','missing']},{'nodeIds':['child','root']},{'nodeId':'child','nodeIds':['child']},{}]:
  assert edit({'action':'prune','request':request}).status==400
 assert edit({'action':'prune','request':{'nodeIds':['child'],'path':'arbitrary'}}).status==422
 assert edit({'action':'read'}).json()['graph']==changed
 preview=edit({'action':'prune','request':{'nodeIds':['child','child']}}).json()['result']
 legacy=edit({'action':'prune','request':{'nodeId':'child'}}).json()['result']
 assert preview==legacy and preview['removedNodeIds']==['child']
 assert edit({'action':'prune','request':{'nodeIds':['child'],'apply':True,'revision':'stale'}}).status==400
 assert edit({'action':'read'}).json()['graph']==changed
 assert edit({'action':'prune','request':{'nodeIds':['child'],'apply':True,'revision':preview['revision']}}).ok
 assert [n['id'] for n in edit({'action':'read'}).json()['graph']['nodes']]==['root']
 assert page.request.get(BASE+'/api/graphs/sample').json()==wire
 assert edit({'action':'discard'}).ok
 errors=[];requests=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('request',lambda request:requests.append(request.url))
 page.goto(BASE+'/')
 expect(page.locator('.home-start')).to_be_visible()
 expect(page.locator('.home-library')).not_to_be_visible()
 page.get_by_role('tab',name='项目资料库').click()
 expect(page.locator('#home-title')).to_have_text('项目资料库')
 expect(page.locator('.home-project')).to_have_count(2)
 expect(page.locator('.home-summary')).to_contain_text('2 个项目')
 expect(page.get_by_role('link',name='进入工作台',exact=True)).to_be_visible()
 assert not any('/vendor/workbench/workbench.js' in url for url in requests)
 assert page.get_by_text('经典工作台',exact=True).count()==0
 page.get_by_role('link',name='进入工作台',exact=True).click()
 expect(page.locator('#fit')).to_be_enabled()
 expect(page.locator('.tree-project')).to_have_count(2)
 expect(page.locator('#graph-count')).to_have_text('2 张图')
 page.go_back();expect(page.locator('.home-library')).to_be_visible()
 search=page.get_by_role('searchbox',name='搜索项目内容')
 search.fill('alpha');expect(page.locator('.home-project')).to_have_count(1)
 search.fill('不存在的项目');expect(page.locator('.home-feedback')).to_contain_text('没有匹配')
 search.fill('');page.locator('a[href="/?graph=sample"]').click()
 expect(page.locator('#fit')).to_be_enabled();expect(page.locator('#canvas canvas').first).to_be_visible()
 # Collapse includes the recycle bin and remains closed after a catalog refresh.
 trash=page.locator('.tree-trash')
 if trash.evaluate('(el)=>el.open'):trash.locator('summary').click()
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.get_by_role('button',name='折叠所有目录',exact=True).click()
 expect(page.locator('#catalog details[data-folder][open]')).to_have_count(0)
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.get_by_role('button',name='刷新目录',exact=True).click()
 expect(page.locator('#catalog')).to_have_attribute('aria-busy','false')
 expect(page.locator('#catalog details[data-folder][open]')).to_have_count(0)
 trash.locator('summary').click()
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.get_by_role('button',name='折叠所有目录',exact=True).click()
 expect(page.locator('#catalog details[data-folder][open]')).to_have_count(0)
 page.locator('#filter').fill('sample')
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.get_by_role('button',name='折叠所有目录',exact=True).click()
 expect(page.locator('#catalog details[data-folder][open]')).to_have_count(0)
 page.locator('#filter').fill('')
 select_option(page,'#symbols','child');expect(page.locator('#selection-title')).to_have_text('child');expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
 preview=page.locator('#source');code=page.frame_locator('#source iframe')
 expect(preview.locator('.code-preview-bar strong')).to_have_text('main.rs')
 expect(preview.get_by_role('button',name='自动换行',exact=True)).to_have_attribute('aria-pressed','true')
 preview.get_by_role('button',name='自动换行',exact=True).click()
 expect(preview.get_by_role('button',name='自动换行',exact=True)).to_have_attribute('aria-pressed','false')
 preview.get_by_role('button',name='搜索代码',exact=True).click()
 expect(code.get_by_role('textbox',name='Find',exact=True)).to_be_visible()
 code.get_by_role('textbox',name='Find',exact=True).press('Escape')
 for theme in ['dark','light']:
  page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
  expect(code.locator('html')).to_have_attribute('data-theme',theme)
  page.wait_for_timeout(200) # settle the parent theme transitions before visual capture
  page.screenshot(path=str(Path(__file__).resolve().parents[1]/f'target/source-preview-{theme}.png'))
 # Wrap is shared across every selected node; incremental context retains one Monaco frame.
 select_option(page,'#symbols','root')
 expect(page.locator('#source').get_by_role('button',name='自动换行',exact=True)).to_have_attribute('aria-pressed','false')
 def source_fixture(route):
  full=route.request.post_data_json.get('scope')=='file'
  start,end=(1,150) if full else (55,65)
  route.fulfill(json={'path':'main.rs','language':'rust','scope':'file' if full else 'target','focusLine':60,'focusEndLine':60,'startLine':start,'endLine':end,'totalLines':150,'truncatedBefore':not full,'truncatedAfter':not full,'lines':[{'number':n,'text':f'// source line {n}','focus':n==60,'truncated':False} for n in range(start,end+1)]})
 page.route('**/api/preview',source_fixture)
 select_option(page,'#symbols','child')
 frame=page.frame_locator('#source iframe')
 expect(frame.locator('#monaco-root')).to_have_attribute('data-focus-line','60')
 page.wait_for_function("()=>document.querySelector('#source iframe')?.contentDocument?.querySelector('#monaco-root')?.dataset.endLine")
 page.wait_for_timeout(300)
 root=frame.locator('#monaco-root');start=int(root.get_attribute('data-start-line'));end=int(root.get_attribute('data-end-line'))
 assert end-start+1>11,(start,end)
 assert (end-start+1)*21>=page.locator('#source iframe').bounding_box()['height']+10,(start,end)
 page.locator('#source').get_by_role('button',name='↑ 加载前 20 行',exact=True).click()
 expect(root).to_have_attribute('data-start-line',str(max(1,start-20)))
 expect(root).to_have_attribute('data-end-line',str(end))
 page.locator('#source').get_by_role('button',name='↓ 加载后 20 行',exact=True).click()
 expect(root).to_have_attribute('data-end-line',str(min(150,end+20)))
 while page.locator('#source').get_by_role('button',name='↑ 加载前 20 行',exact=True).is_visible():
  next_start=max(1,int(root.get_attribute('data-start-line'))-20)
  page.locator('#source').get_by_role('button',name='↑ 加载前 20 行',exact=True).click()
  expect(root).to_have_attribute('data-start-line',str(next_start))
 expect(root).to_have_attribute('data-start-line','1')
 while page.locator('#source').get_by_role('button',name='↓ 加载后 20 行',exact=True).is_visible():
  next_end=min(150,int(root.get_attribute('data-end-line'))+20)
  page.locator('#source').get_by_role('button',name='↓ 加载后 20 行',exact=True).click()
  expect(root).to_have_attribute('data-end-line',str(next_end))
 expect(root).to_have_attribute('data-end-line','150')
 page.locator('#source').get_by_role('button',name='自动换行',exact=True).click()
 select_option(page,'#symbols','root')
 expect(page.locator('#source').get_by_role('button',name='自动换行',exact=True)).to_have_attribute('aria-pressed','true')
 page.reload();expect(page.locator('#fit')).to_be_enabled();select_option(page,'#symbols','child')
 expect(page.locator('#source').get_by_role('button',name='自动换行',exact=True)).to_have_attribute('aria-pressed','true')
 page.unroute('**/api/preview');select_option(page,'#symbols','root');select_option(page,'#symbols','child')
 page.get_by_role('button',name='编辑说明',exact=True).click()
 desc=page.get_by_role('dialog',name='编辑说明',exact=True)
 desc.get_by_role('textbox',name='说明',exact=True).fill('长'*16001)
 desc.get_by_role('button',name='应用到草稿',exact=True).click()
 expect(desc.get_by_role('alert')).to_contain_text('16000')
 assert page.request.get(BASE+'/api/graphs/sample').json()==wire
 desc.get_by_text('批量编辑 JSON',exact=True).click()
 desc.get_by_label('批量描述 JSON').fill('[{"targetType":"node","id":"child","description":"用户补充的职责"}]')
 desc.get_by_role('button',name='应用到草稿',exact=True).click()
 expect(desc).not_to_be_visible()
 expect(page.locator('#selection-description')).to_have_text('用户补充的职责')
 assert page.request.get(BASE+'/api/graphs/sample').json()==wire
 page.once('dialog',lambda dialog:dialog.accept())
 page.locator('#discard-edits').click()
 expect(page.locator('#edit-bar')).not_to_be_visible()
 page.locator('header a[href="/"]').last.click();page.get_by_role('tab',name='项目资料库').click();expect(page.locator('#home-title')).to_be_visible()
 page.go_back();expect(page.locator('#fit')).to_be_enabled()
 page.goto(BASE+'/v2/?graph=sample')
 expect(page).to_have_url(BASE+'/?graph=sample');expect(page.locator('#fit')).to_be_enabled()
 page.goto(BASE+'/?scene=codex-agent-turn');expect(page).to_have_url(BASE+'/scenes/codex-agent-turn.html')
 page.locator('.project-home-link').first.click();page.get_by_role('tab',name='项目资料库').click();expect(page.locator('#home-title')).to_be_visible()
 select_option(page,'#appearance','dark');page.reload();expect(page.locator('html')).to_have_attribute('data-theme','dark')
 for width in [1440,390]:
  page.set_viewport_size({'width':width,'height':900});expect(page.locator('.home-links a').first).to_be_visible()
  assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/home-mobile.png'))
 page.set_viewport_size({'width':1440,'height':960})
 page.goto(BASE+'/')
 assert page.locator('.home-start h1,.home-start label,.home-start-actions').count()==0
 input_box=page.locator('#analysis-name').bounding_box();go_box=page.locator('.home-create').bounding_box()
 assert abs((input_box['y']+input_box['height']/2)-(go_box['y']+go_box['height']/2))<2
 page.get_by_role('button',name='新建图',exact=True).click()
 assert page.get_by_label('分析器',exact=True).count()==0
 invalid=page.request.post(BASE+'/api/projects/alpha/entry-check',data={'fileId':'unknown','line':1,'engine':'coderova'},headers={'Origin':BASE})
 assert invalid.status==422
 invalid=page.request.post(BASE+'/api/graphs/sample/analysis',data={'requestBudget':1,'nodeId':'root','maxDepth':0},headers={'Origin':BASE})
 assert invalid.status==400
 page.get_by_label('图名称',exact=True).fill('入口验收')
 expect(page.locator('#new-graph-project')).to_have_value('')
 select_option(page,'#new-graph-project','alpha')
 expect(page.locator('.project-lsp')).to_be_visible()
 expect(page.locator('.project-lsp strong')).to_have_text('rust-analyzer')
 expect(page.get_by_role('button',name='启动 LSP',exact=True)).to_be_enabled()
 for style in ['light','dark']:
  page.evaluate('(value)=>document.documentElement.dataset.theme=value',style)
  page.wait_for_timeout(200) # let theme color transitions settle before visual capture
  for width in [1440,390]:
   page.set_viewport_size({'width':width,'height':960})
   select=page.locator('.project-select-row .ts-control').bounding_box();button=page.locator('.project-connect').bounding_box()
   assert abs(select['y']-button['y'])<1 and abs(select['height']-button['height'])<1,(select,button)
   assert page.get_by_role('dialog',name='新建图',exact=True).evaluate('(node)=>node.scrollWidth<=node.clientWidth')
   page.screenshot(path=str(Path(__file__).resolve().parents[1]/f'target/project-setup-{style}-{width}.png'))
 page.set_viewport_size({'width':1440,'height':960})
 # Native selection is stubbed here; catalog persistence has backend coverage.
 page.route('**/api/projects/select-directory',lambda route:route.fulfill(json={'selectionId':'test-selection','name':'Local project','root':'E:/source/Local project'}))
 page.route('**/api/projects',lambda route:route.fulfill(json={'id':'alpha','name':'alpha','root':'fixture','rootExists':True}))
 page.get_by_role('button',name='接入项目',exact=True).click()
 connect=page.get_by_role('dialog',name='接入项目',exact=True)
 expect(connect.get_by_label('项目名称')).to_have_value('Local project')
 connect.get_by_role('button',name='接入项目',exact=True).click()
 expect(connect).not_to_be_visible()
 page.unroute('**/api/projects/select-directory');page.unroute('**/api/projects')
 page.get_by_role('button',name='选择根节点',exact=True).click()
 picker=page.get_by_role('dialog',name='选择根节点',exact=True)
 expect(picker.get_by_role('button',name='浏览本地文件',exact=True)).to_be_enabled()
 source_file=next(f for f in page.request.get(BASE+'/api/projects/alpha/source-files').json() if f['name']=='main.rs')
 page.route('**/api/projects/alpha/select-file',lambda route:route.fulfill(json=source_file))
 picker.get_by_role('button',name='浏览本地文件',exact=True).click()
 expect(picker.get_by_label('项目文件',exact=True)).to_have_value('main.rs')
 expect(picker.locator('.entry-picker-context')).to_contain_text('项目：')
 expect(picker.get_by_role('button',name='校验入口',exact=True)).to_be_enabled(timeout=30000)
 page.unroute('**/api/projects/alpha/select-file')
 frame=page.frame_locator('iframe.entry-editor-frame')
 editor=frame.locator('.monaco-editor')
 expect(editor).to_be_visible()
 frame.locator('.view-line').filter(has_text='fn child()').click()
 expect(picker.locator('.entry-picker-footer span')).to_contain_text('第 2 行')
 expect(frame.locator('.line-numbers.active-line-number')).to_have_text('2')
 assert frame.locator('.current-line').last.evaluate('(el)=>getComputedStyle(el).backgroundColor')!='rgba(0, 0, 0, 0)'
 assert {'1','2'} <= set(frame.locator('.line-numbers').all_text_contents()),frame.locator('.line-numbers').all_text_contents()
 frame.locator('.line-numbers').filter(has_text=re.compile('^2$')).click()
 expect(picker.locator('.entry-picker-footer span')).to_contain_text('第 2 行')
 before=picker.locator('.entry-picker-editor').bounding_box()
 first=frame.locator('.view-line').filter(has_text='fn main()').bounding_box()
 second=frame.locator('.view-line').filter(has_text='fn child()').bounding_box()
 page.mouse.move(first['x']+4,first['y']+8);page.mouse.down();page.mouse.move(second['x']+80,second['y']+8,steps=12);page.mouse.up()
 expect(frame.locator('.selected-text').first).to_be_visible()
 assert {'1','2'} <= set(frame.locator('.line-numbers').all_text_contents()),frame.locator('.line-numbers').all_text_contents()
 assert picker.locator('.entry-picker-editor').bounding_box()==before
 assert frame.locator('.mtkz').count()==0
 picker.get_by_role('button',name='搜索代码',exact=True).click()
 expect(frame.get_by_role('textbox',name='Find',exact=True)).to_be_visible()
 frame.get_by_role('textbox',name='Find',exact=True).press('Escape')
 frame.locator('.view-line').filter(has_text='fn main()').click()
 expect(picker.locator('.entry-picker-footer span')).to_contain_text('第 1 行')
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/entry-editor-fixed.png'))
 expect(picker.locator('.entry-picker-footer > button:visible')).to_have_count(1)
 first_check_started=time.perf_counter()
 picker.get_by_role('button',name='校验入口',exact=True).click()
 expect(picker.get_by_role('button',name='创建图',exact=True)).to_be_enabled(timeout=120000)
 expect(picker.locator('.entry-picker-footer > button:visible')).to_have_count(1)
 expect(picker.get_by_role('button',name='校验入口')).not_to_be_visible()
 first_check_elapsed=time.perf_counter()-first_check_started
 assert first_check_elapsed<5,first_check_elapsed
 assert page.request.get(BASE+'/api/projects/alpha/lsp/rust').json()['state']=='stopped'
 picker.get_by_role('button',name='创建图',exact=True).click()
 expect(page.get_by_role('dialog',name='继续采集',exact=True)).to_be_visible(timeout=30000)
 slug=page.url.split('graph=')[1].split('&')[0]
 graph=page.request.get(BASE+'/api/graphs/'+slug).json()
 task=page.request.get(BASE+'/api/graphs/'+slug+'/analysis').json()
 assert task['addedNodes']==0 and task['addedEdges']==0
 assert len(graph['nodes'])==1 and graph['edges']==[] and graph['analysis']['queriedNodes']==[]
 # Both limits apply to a fresh isolated collection draft, without changing saved graph.
 bounded_endpoint=BASE+'/api/graphs/'+slug+'/draft'
 bounded=page.request.post(bounded_endpoint,headers=headers,data={'operation':{'action':'read'}}).json()['draftId']
 def bounded_op(operation):return page.request.post(bounded_endpoint,headers=headers,data={'draftId':bounded,'operation':operation})
 assert bounded_op({'action':'analyze','request':{'nodeId':graph['root'],'requestBudget':100,'maxDepth':1,'maxNodes':1}}).ok
 for _ in range(1200):
  result=bounded_op({'action':'analysisStatus'}).json()['result']
  if result['status']!='running':break
  time.sleep(.1)
 assert result['status']=='finished' and result['addedNodes']==1,result
 limited=bounded_op({'action':'read'}).json()['graph']
 assert len(limited['nodes'])==2 and all(e['source']==limited['root'] for e in limited['edges'])
 assert bounded_op({'action':'discard'}).ok
 assert page.request.post(BASE+'/api/graphs',data={'projectId':'alpha','candidateId':'invalid','title':'x'}).status==400
 assert page.request.post(BASE+'/api/graphs',data={'projectId':'alpha','candidateId':'invalid','title':'x','root':'C:/'}).status==422
 assert page.request.get(BASE+'/api/projects/alpha/source-files/invalid').status==400
 page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='取消',exact=True).click()
 page.reload();expect(page.get_by_role('dialog',name='继续采集',exact=True)).not_to_be_visible()
 source_file=next(f for f in page.request.get(BASE+'/api/projects/alpha/source-files').json() if f['name']=='main.rs')
 warm_started=time.perf_counter()
 warm=page.request.post(BASE+'/api/projects/alpha/entry-check',data={'fileId':source_file['id'],'line':1},headers={'Origin':BASE},timeout=120000)
 assert warm.ok,warm.text()
 assert warm.json()['verification']=='source-position'
 print(f'LSP-free entry check: initial UI {first_check_elapsed:.3f}s, repeat API {time.perf_counter()-warm_started:.3f}s (small fixture; not a Spring benchmark)')
 select_option(page,'#symbols',graph['root'])
 page.locator('#node-actions-panel').get_by_role('button',name='继续采集',exact=True).click()
 before_canvas=page.locator('#canvas').bounding_box()
 page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='开始采集',exact=True).click()
 expect(page.locator('#graph-details')).not_to_have_attribute('open','')
 expect(page.locator('#active-collection')).not_to_be_visible()
 expect(page.locator('#collection-indicator')).to_have_text('待采纳',timeout=120000)
 after_canvas=page.locator('#canvas').bounding_box()
 assert abs(before_canvas['y']-after_canvas['y'])<2,(before_canvas,after_canvas)
 expect(page.locator('#status')).not_to_contain_text('采集完成')
 page.locator('#graph-details > summary').click()
 expect(page.locator('#resume-accept')).to_be_visible(timeout=120000)
 expect(page.locator('#active-collection-status')).to_contain_text('新增 1 个节点')
 page.wait_for_timeout(300)
 panel_box=page.locator('.graph-details-body').bounding_box()
 assert panel_box['x']>=0 and panel_box['y']>=0 and panel_box['y']+panel_box['height']<=960,panel_box
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/collection-panel.png'))
 expect(page.locator('#active-collection-status')).not_to_contain_text('请求')
 expect(page.locator('#active-collection-status')).not_to_contain_text('连线')
 page.locator('#resume-accept').click()
 expect(page.locator('#selection-title')).to_have_text('main',timeout=30000)
 expect(page.locator('#active-collection')).not_to_be_visible()
 # A fully queried graph can be collected again from root or leaf: merge, do not duplicate.
 saved=page.request.get(BASE+'/api/graphs/'+slug).json()
 assert len(saved['nodes'])==2 and not saved['analysis']['pendingNodes']
 existing_nodes={n['id'] for n in saved['nodes']};existing_edges={e['id'] for e in saved['edges']}
 select_option(page,'#symbols',saved['root'])
 expect(page.locator('#node-actions-panel').get_by_role('button',name='继续采集',exact=True)).to_be_enabled()
 page.locator('#node-actions-panel').get_by_role('button',name='继续采集',exact=True).click()
 before_canvas=page.locator('#canvas').bounding_box()
 page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='开始采集',exact=True).click()
 expect(page.locator('#graph-details')).not_to_have_attribute('open','')
 expect(page.locator('#active-collection')).not_to_be_visible()
 expect(page.locator('#collection-indicator')).to_have_text('待采纳',timeout=120000)
 after_canvas=page.locator('#canvas').bounding_box()
 assert abs(before_canvas['y']-after_canvas['y'])<2,(before_canvas,after_canvas)
 expect(page.locator('#status')).not_to_contain_text('采集完成')
 page.locator('#graph-details > summary').click()
 expect(page.locator('#resume-accept')).to_be_visible(timeout=120000)
 expect(page.locator('#active-collection-status')).to_contain_text('本轮新增 0 个节点')
 expect(page.locator('#resume-status')).to_contain_text('新增 0 条关系 · 当前图 2 个符号、1 条关系')
 page.locator('#resume-accept').click()
 expect(page.locator('#active-collection')).not_to_be_visible()
 repeat=page.request.get(BASE+'/api/graphs/'+slug).json()
 assert {n['id'] for n in repeat['nodes']}==existing_nodes and {e['id'] for e in repeat['edges']}==existing_edges
 leaf=next(n for n in repeat['nodes'] if n['id']!=repeat['root'])
 endpoint_repeat=BASE+'/api/graphs/'+slug+'/draft'
 repeat_did=page.request.post(endpoint_repeat,headers=headers,data={'operation':{'action':'read'}}).json()['draftId']
 def repeat_op(op):return page.request.post(endpoint_repeat,headers=headers,data={'draftId':repeat_did,'operation':op})
 assert repeat_op({'action':'describe','edits':[{'targetType':'node','id':leaf['id'],'description':'保留人工说明'}]}).ok
 assert repeat_op({'action':'analyze','request':{'nodeId':leaf['id'],'requestBudget':100,'maxDepth':2}}).ok
 for _ in range(1200):
  counts=repeat_op({'action':'analysisStatus'}).json()['result']
  if counts['status']!='running':break
  time.sleep(.1)
 assert counts['status']=='finished' and counts['completed']==1,counts
 assert (counts['addedNodes'],counts['addedEdges'],counts['totalNodes'],counts['totalEdges'])==(0,0,2,1),counts
 merged=repeat_op({'action':'read'}).json()['graph']
 assert next(n for n in merged['nodes'] if n['id']==leaf['id'])['description']=='保留人工说明'
 assert repeat_op({'action':'discard'}).ok
 # Unified library contracts: persistent empty groups, aliases and stable graph links.
 assert page.request.post(BASE+'/api/storage',data={'root':'C:/outside'}).status==422
 assert page.request.post(BASE+'/api/storage',data={'selectionId':'invalid'}).status==400
 def library(change):
  response=page.request.post(BASE+'/api/library',data=change,headers=headers)
  assert response.ok,response.text()
  return response.json()
 library({'action':'upsertGroup','projectId':'alpha','groupId':'test-empty','name':'空分组'})
 library({'action':'upsertGroup','projectId':'alpha','groupId':'test-empty','name':'重命名分组'})
 library({'action':'renameDirectory','projectId':'alpha','name':'项目别名'})
 assert next(p for p in page.request.get(BASE+'/api/health').json()['projects'] if p['id']=='alpha')['name']=='项目别名'
 page.goto(BASE+'/?graph=sample');expect(page.locator('#fit')).to_be_enabled()
 page.get_by_role('button',name='项目操作 项目别名',exact=True).click()
 expect(page.get_by_role('button',name='重命名目录 项目别名',exact=True)).to_be_visible()
 page.keyboard.press('Escape')
 page.get_by_role('button',name='目录操作 重命名分组',exact=True).click()
 expect(page.get_by_role('button',name='重命名分组 重命名分组',exact=True)).to_be_visible()
 page.keyboard.press('Escape')
 expect(page.locator('#graph-services .project-lsp')).not_to_be_visible()
 page.locator('#lsp-settings > summary').click()
 expect(page.locator('#lsp-project-name')).to_have_text('项目别名')
 expect(page.locator('#graph-services .project-lsp')).to_be_visible()
 expect(page.locator('#graph-services strong')).to_have_text('rust-analyzer')
 # Explicit controls stay available inside the graph view.
 page.locator('#graph-services button').filter(has_text='停止').click()
 expect(page.locator('#graph-services [role=status]')).to_have_text('未启动',timeout=15000)
 expect(page.locator('#graph-services').get_by_role('button',name='启动 LSP',exact=True)).to_be_enabled()
 # Popup is anchored to its own trigger and constrained to the viewport.
 for width in [1440,850]:
  page.set_viewport_size({'width':width,'height':960})
  panel=page.locator('#display-settings');panel.locator('summary').click()
  expect(panel.locator('.settings-body')).to_be_visible();page.wait_for_timeout(250)
  expect(page.locator('#graph-services .project-lsp')).not_to_be_visible()
  box=panel.locator('.settings-body').bounding_box();anchor=panel.locator('summary').bounding_box()
  assert box['x']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=961,(box,anchor)
  assert abs(box['y']-(anchor['y']+anchor['height']+8))<3,(box,anchor)
  page.keyboard.press('Escape');expect(panel).not_to_have_attribute('open','')
 page.set_viewport_size({'width':1440,'height':960})
 page.locator('[data-graph="sample"] .tree-menu > button').click()
 page.get_by_role('button',name='重命名图 sample',exact=True).click()
 dialog=page.get_by_role('dialog',name='重命名图',exact=True)
 dialog.get_by_label('名称',exact=True).fill('重命名的图');dialog.get_by_role('button',name='保存名称',exact=True).click()
 expect(page.locator('#title')).to_have_text('重命名的图')
 page.reload();expect(page.locator('#title')).to_have_text('重命名的图')
 assert 'graph=sample' in page.url
 page.locator('#storage-settings').click()
 expect(page.get_by_role('dialog',name='资料库存储',exact=True)).to_contain_text('当前目录')
 page.get_by_role('button',name='关闭',exact=True).click()
 # Saved annotations are separate on disk and composed for API clients.
 endpoint=BASE+'/api/graphs/sample/draft'
 did=page.request.post(endpoint,data={'operation':{'action':'read'}},headers=headers).json()['draftId']
 assert edit({'action':'describe','edits':[{'targetType':'node','id':'root','description':'独立保存的说明'}]}).ok
 assert edit({'action':'save'}).ok
 info=page.request.get(BASE+'/api/storage').json();root=Path(info['root'])
 raw=json.loads((root/'sample.json').read_text(encoding='utf-8'))
 assert not raw['nodes'][0].get('description')
 notes=json.loads((root/'.annotations-sample'/(raw['_annotations']+'.json')).read_text(encoding='utf-8'))
 assert notes['nodes']['root']['description']=='独立保存的说明'
 assert page.request.get(BASE+'/api/graphs/sample').json()['nodes'][0]['description']=='独立保存的说明'
 assert edit({'action':'describe','edits':[{'targetType':'node','id':'root','description':wire['nodes'][0].get('description','')}]}).ok
 assert edit({'action':'save'}).ok
 assert edit({'action':'discard'}).ok
 assert page.request.put(BASE+'/api/graphs/sample/title',data={'title':'sample'},headers=headers).ok
 library({'action':'renameDirectory','projectId':'alpha','name':'alpha'})
 library({'action':'deleteGroup','projectId':'alpha','groupId':'test-empty'})
 assert not errors,errors
 browser.close()
print('Home grouping/search, lazy graph load, source, history, bookmarks, scenes, themes and mobile PASS')
