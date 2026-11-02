"""Unified home and current reader, using runner-owned fixtures."""
import os, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
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
 errors=[];requests=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('request',lambda request:requests.append(request.url))
 page.goto(BASE+'/')
 expect(page.locator('#home-title')).to_have_text('项目资料库')
 expect(page.locator('.home-project')).to_have_count(4)
 assert not any('/vendor/workbench/workbench.js' in url for url in requests)
 assert page.get_by_text('经典工作台',exact=True).count()==0
 search=page.get_by_role('searchbox',name='搜索项目内容')
 search.fill('alpha');expect(page.locator('.home-project')).to_have_count(1)
 search.fill('不存在的项目');expect(page.locator('.home-feedback')).to_contain_text('没有匹配')
 search.fill('');page.locator('a[href="/?graph=sample"]').click()
 expect(page.locator('#fit')).to_be_enabled();expect(page.locator('#canvas canvas').first).to_be_visible()
 page.select_option('#symbols','child');expect(page.locator('#selection-title')).to_have_text('child');expect(page.locator('#source .focus')).to_be_visible()
 page.locator('header a[href="/"]').last.click();expect(page.locator('#home-title')).to_be_visible()
 page.go_back();expect(page.locator('#fit')).to_be_enabled()
 page.goto(BASE+'/v2/?graph=sample')
 expect(page).to_have_url(BASE+'/?graph=sample');expect(page.locator('#fit')).to_be_enabled()
 page.goto(BASE+'/?scene=codex-agent-turn');expect(page).to_have_url(BASE+'/scenes/codex-agent-turn.html')
 page.locator('.project-home-link').first.click();expect(page.locator('#home-title')).to_be_visible()
 page.select_option('#appearance','dark');page.reload();expect(page.locator('html')).to_have_attribute('data-theme','dark')
 for width in [1440,390]:
  page.set_viewport_size({'width':width,'height':900});expect(page.locator('.home-links a').first).to_be_visible()
  assert page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/home-mobile.png'))
 page.set_viewport_size({'width':1440,'height':960})
 page.goto(BASE+'/')
 page.get_by_role('button',name='新建图',exact=True).click()
 assert page.get_by_label('分析器',exact=True).count()==0
 invalid=page.request.post(BASE+'/api/projects/alpha/entry-check',data={'fileId':'unknown','line':1,'engine':'coderova'},headers={'Origin':BASE})
 assert invalid.status==422
 invalid=page.request.post(BASE+'/api/graphs/sample/analysis',data={'requestBudget':1,'nodeId':'root','maxDepth':3},headers={'Origin':BASE})
 assert invalid.status==422
 page.get_by_label('图名称',exact=True).fill('入口验收')
 expect(page.get_by_label('项目',exact=True)).to_have_value('')
 page.get_by_label('项目',exact=True).select_option('alpha')
 page.get_by_role('button',name='选择根节点',exact=True).click()
 picker=page.get_by_role('dialog',name='选择根节点',exact=True)
 expect(picker.get_by_role('button',name='浏览本地文件',exact=True)).to_be_enabled()
 picker.get_by_label('选择本地源文件',exact=True).set_input_files({'name':'not-in-project.java','mimeType':'text/plain','buffer':b'class Missing {}'})
 expect(picker.get_by_role('alert')).to_contain_text('not-in-project.java')
 expect(picker.locator('.entry-picker-status')).to_have_class('entry-picker-status is-error')
 expect(picker.locator('.entry-picker-context')).to_contain_text('项目：')
 picker.get_by_label('选择本地源文件',exact=True).set_input_files({'name':'main.rs','mimeType':'text/plain','buffer':b'fn main() { child(); }\nfn child() {}\n'})
 expect(picker.get_by_label('项目文件',exact=True)).to_have_value('main.rs')
 expect(picker.get_by_role('alert')).to_have_count(0)
 expect(picker.get_by_role('button',name='校验',exact=True)).to_be_enabled(timeout=30000)
 frame=page.frame_locator('iframe.entry-editor-frame')
 editor=frame.locator('.monaco-editor')
 expect(editor).to_be_visible()
 frame.locator('.view-line').filter(has_text='fn child()').click()
 expect(picker.locator('.entry-picker-footer span')).to_contain_text(': 2')
 expect(frame.locator('.line-numbers.active-line-number')).to_have_text('2')
 assert frame.locator('.current-line').last.evaluate('(el)=>getComputedStyle(el).backgroundColor')!='rgba(0, 0, 0, 0)'
 assert {'1','2'} <= set(frame.locator('.line-numbers').all_text_contents()),frame.locator('.line-numbers').all_text_contents()
 frame.locator('.line-numbers').filter(has_text=re.compile('^2$')).click()
 expect(picker.locator('.entry-picker-footer span')).to_contain_text(': 2')
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
 expect(picker.locator('.entry-picker-footer span')).to_contain_text(': 1')
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/entry-editor-fixed.png'))
 first_check_started=time.perf_counter()
 picker.get_by_role('button',name='校验',exact=True).click()
 expect(picker.get_by_role('button',name='创建图',exact=True)).to_be_enabled(timeout=120000)
 first_check_elapsed=time.perf_counter()-first_check_started
 picker.get_by_role('button',name='创建图',exact=True).click()
 expect(page.get_by_role('dialog',name='继续采集',exact=True)).to_be_visible(timeout=30000)
 slug=page.url.split('graph=')[1].split('&')[0]
 graph=page.request.get(BASE+'/api/graphs/'+slug).json()
 task=page.request.get(BASE+'/api/graphs/'+slug+'/analysis').json()
 assert task['addedNodes']==0 and task['addedEdges']==0
 assert len(graph['nodes'])==1 and graph['edges']==[] and graph['analysis']['queriedNodes']==[]
 assert page.request.post(BASE+'/api/graphs',data={'projectId':'alpha','candidateId':'invalid','title':'x'}).status==400
 assert page.request.post(BASE+'/api/graphs',data={'projectId':'alpha','candidateId':'invalid','title':'x','root':'C:/'}).status==422
 assert page.request.get(BASE+'/api/projects/alpha/source-files/invalid').status==400
 page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='取消',exact=True).click()
 page.reload();expect(page.get_by_role('dialog',name='继续采集',exact=True)).not_to_be_visible()
 source_file=next(f for f in page.request.get(BASE+'/api/projects/alpha/source-files').json() if f['name']=='main.rs')
 warm_started=time.perf_counter()
 warm=page.request.post(BASE+'/api/projects/alpha/entry-check',data={'fileId':source_file['id'],'line':1},headers={'Origin':BASE},timeout=120000)
 assert warm.ok,warm.text()
 print(f'Real rust-analyzer entry check: initial UI {first_check_elapsed:.3f}s, reused API {time.perf_counter()-warm_started:.3f}s (small fixture; not a Spring benchmark)')
 page.select_option('#symbols',graph['root'])
 page.locator('#node-actions-panel').get_by_role('button',name='继续采集',exact=True).click()
 page.get_by_role('dialog',name='继续采集',exact=True).get_by_role('button',name='开始采集',exact=True).click()
 expect(page.locator('#resume-accept')).to_be_visible(timeout=120000)
 expect(page.locator('#active-collection-status')).to_contain_text('新增 1 个节点')
 expect(page.locator('#active-collection-status')).not_to_contain_text('请求')
 expect(page.locator('#active-collection-status')).not_to_contain_text('连线')
 page.locator('#resume-accept').click()
 expect(page.locator('#selection-title')).to_have_text('main',timeout=30000)
 expect(page.locator('#active-collection')).not_to_be_visible()
 assert not errors,errors
 browser.close()
print('Home grouping/search, lazy graph load, source, history, bookmarks, scenes, themes and mobile PASS')
