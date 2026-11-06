"""Reverse collection through real rust-analyzer and isolated runner-owned data."""
import os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option
BASE=os.environ['CALLGRAPH_TEST_URL']
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/');page.get_by_role('button',name='新建图',exact=True).click()
 page.get_by_label('图名称',exact=True).fill('Reverse fixture')
 select_option(page,'#new-graph-project','alpha')
 page.get_by_role('button',name='选择根节点',exact=True).click()
 picker=page.get_by_role('dialog',name='选择根节点',exact=True)
 expect(picker.locator('.entry-picker-direction')).not_to_be_visible()
 expect(picker.get_by_role('button',name='打开文件',exact=True)).to_be_enabled()
 picker.get_by_label('项目文件',exact=True).fill('main.rs')
 picker.get_by_role('button',name='打开文件',exact=True).click()
 frame=page.frame_locator('iframe.entry-editor-frame')
 frame.locator('.line-numbers').filter(has_text='2').click()
 picker.get_by_role('button',name='校验入口',exact=True).click()
 expect(picker.get_by_role('button',name='创建图',exact=True)).to_be_enabled()
 select_option(page,'#new-graph-files-direction','incoming')
 for theme in ['light','dark']:
  page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
  for width in [1440,390]:
   page.set_viewport_size({'width':width,'height':960})
   assert picker.evaluate('(el)=>el.scrollWidth<=el.clientWidth')
   expect(picker.get_by_role('button',name='创建图',exact=True)).to_be_in_viewport()
   page.screenshot(path=str(ROOT/f'target/incoming-picker-{theme}-{width}.png'))
 page.set_viewport_size({'width':1440,'height':960})
 picker.get_by_role('button',name='创建图',exact=True).click()
 dialog=page.get_by_role('dialog',name='向上采集 · 谁调用它',exact=True)
 expect(dialog).to_be_visible(timeout=30000)
 slug=page.url.split('graph=')[1].split('&')[0];endpoint=BASE+'/api/graphs/'+slug
 before=page.request.get(endpoint).json();assert before['analysis']['direction']=='incoming'
 dialog.locator('#resume-depth').fill('2');dialog.locator('#resume-budget').fill('20')
 dialog.get_by_role('button',name='开始采集',exact=True).click()
 expect(page.locator('#collection-indicator')).to_have_text('待采纳',timeout=210000)
 if not page.locator('#graph-details').evaluate('(el)=>el.open'):page.locator('#graph-details > summary').click()
 page.locator('#resume-accept').click()
 expect(page.locator('#collection-indicator')).not_to_have_text('待采纳',timeout=30000)
 graph=page.request.get(endpoint).json()
 assert len(graph['nodes'])==2 and len(graph['edges'])==1,graph
 edge=graph['edges'][0];assert edge['target']==graph['root'] and edge['line']==1
 caller=next(n for n in graph['nodes'] if n['id']==edge['source'])
 assert caller['label']=='main' and caller['line']==1
 select_option(page,'#symbols',caller['id'])
 expect(page.locator('.reading-origin')).to_contain_text('当前路径调用 child')
 expect(page.locator('.reading-hint')).to_contain_text('未发现调用者')
 page.get_by_role('button',name='查看调用点',exact=True).click()
 expect(page.locator('#selection-title')).to_be_visible()
 expect(page.locator('#fit')).to_be_enabled()
 expect(page.frame_locator('#source iframe').locator('.monaco-source-focus').first).to_be_visible()
 page.locator('#fit').click()
 for theme in ['light','dark']:
  select_option(page,'#appearance',theme)
  expect(page.locator('#appearance')).to_be_enabled()
  page.wait_for_timeout(200)
  page.screenshot(path=str(ROOT/f'target/incoming-graph-{theme}.png'))
 # Repeat from the root: no new facts; save remains explicit.
 headers={'Origin':BASE};draft_endpoint=endpoint+'/draft'
 did=page.request.post(draft_endpoint,headers=headers,data={'operation':{'action':'read'}}).json()['draftId']
 def op(action,**extra):return page.request.post(draft_endpoint,headers=headers,data={'draftId':did,'operation':{'action':action,**extra}})
 assert op('analyze',request={'nodeId':graph['root'],'requestBudget':20,'maxDepth':2}).ok
 for _ in range(1200):
  state=op('analysisStatus').json()['result']
  if state['status']!='running':break
  time.sleep(.1)
 assert state['status']=='finished' and state['addedNodes']==0 and state['addedEdges']==0,state
 assert page.request.get(endpoint).json()==graph
 assert op('discard').ok
 page.reload();expect(page.locator('#fit')).to_be_enabled()
 select_option(page,'#symbols',caller['id']);expect(page.locator('#selection-title')).to_have_text('main')
 assert not errors,errors
 browser.close()
print('Incoming UI, real LSP, caller evidence, draft save, repeat merge and reload PASS')
