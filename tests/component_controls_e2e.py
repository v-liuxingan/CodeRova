"""Visible component behavior under project/list updates and modal lifecycles."""
import os, json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from browser_controls import select_option
BASE=os.environ['CALLGRAPH_TEST_URL']
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':900})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto(BASE+'/')
 theme=page.locator('[data-select-id="appearance"] .ts-control')
 expect(theme).to_be_visible();before=theme.bounding_box();theme.click()
 assert before==theme.bounding_box()
 expect(page.locator('[data-select-id="appearance"] .ts-dropdown input')).to_have_count(0)
 page.keyboard.press('Escape')
 page.evaluate('''() => {
   const dialog=document.createElement('dialog');dialog.id='component-fixture';dialog.className='tree-dialog';
   dialog.innerHTML='<label for="fixture-project">选择项目</label><select id="fixture-project" name="project"><option value="a">项目甲</option><option value="b">项目乙</option></select>';
   document.body.append(dialog);dialog.showModal();
 }''')
 page.wait_for_selector('[data-select-id="fixture-project"] .ts-control')
 for width in [1280,390]:
  page.set_viewport_size({'width':width,'height':900})
  control=page.locator('[data-select-id="fixture-project"] .ts-control')
  before=control.bounding_box();control.click()
  after=control.bounding_box()
  assert abs(before['height']-after['height'])<1,(before,after)
  expect(control.locator('.item')).to_be_visible()
  expect(page.locator('[data-select-id="fixture-project"] .dropdown-input')).to_be_visible()
  page.keyboard.press('Escape')
 select_option(page,'#fixture-project','b')
 # A queued search refresh must not reopen the popup after choosing an item.
 page.wait_for_timeout(350)
 expect(page.locator('.ts-dropdown:visible')).to_have_count(0)
 # Programmatic navigation and refreshed options must update the visible selection.
 page.evaluate("document.querySelector('#fixture-project').value='a'")
 expect(page.locator('[data-select-id="fixture-project"] .item')).to_have_text('项目甲')
 expect(page.locator('.ts-dropdown:visible')).to_have_count(0)
 page.evaluate("document.querySelector('#fixture-project').replaceChildren(new Option('新项目丙','c'),new Option('入口 · 第 1 行','d'))")
 select_option(page,'#fixture-project','d')
 expect(page.locator('[data-select-id="fixture-project"] .option')).not_to_contain_text(['项目甲','项目乙'])
 page.evaluate("document.querySelector('#fixture-project').disabled=true")
 expect(page.get_by_role('combobox',name='选择项目',exact=True)).to_be_disabled()
 page.evaluate("document.querySelector('#fixture-project').disabled=false")
 field=page.locator('[data-select-id="fixture-project"] .dropdown-input')
 expect(field).to_be_enabled()
 page.locator('[data-select-id="fixture-project"] .ts-control').click();field.fill('不存在的项目')
 expect(page.locator('.ts-dropdown .no-results:visible')).to_have_text('没有匹配项')
 field.press('Escape');expect(page.locator('.ts-dropdown:visible')).to_have_count(0)
 assert page.locator('#component-fixture').evaluate('(el)=>el.open')
 # A second Escape closes the modal normally; removed controls leave no popups behind.
 page.keyboard.press('Escape');expect(page.locator('#component-fixture')).not_to_be_visible()
 page.evaluate("document.querySelector('#component-fixture').remove()")
 expect(page.locator('[data-select-id="fixture-project"]')).to_have_count(0)
 # Sidebar actions use a single trailing menu and preserve folder/row geometry.
 page.set_viewport_size({'width':1440,'height':960})
 page.goto(BASE+'/?view=workbench&graph=sample')
 expect(page.locator('#fit')).to_be_enabled()
 project=page.locator('.tree-project[data-folder="alpha"]')
 summary=project.locator(':scope > summary');before=summary.bounding_box()
 project.locator(':scope > summary .tree-menu > button').click()
 expect(project.locator(':scope > summary [popover]')).to_be_visible()
 assert project.evaluate('(el)=>el.open')
 after=summary.bounding_box();assert before==after,(before,after)
 page.get_by_role('button',name='在 alpha 新建目录',exact=True).click()
 dialog=page.get_by_role('dialog',name='新建目录',exact=True)
 expect(dialog.locator('select')).to_have_value('alpha')
 dialog.get_by_label('目录名称',exact=True).fill('界面验收目录')
 dialog.get_by_role('button',name='创建',exact=True).click()
 expect(page.get_by_role('button',name='目录操作 界面验收目录',exact=True)).to_be_visible()
 page.reload();expect(page.get_by_role('button',name='目录操作 界面验收目录',exact=True)).to_be_visible()
 project.locator(':scope > summary .tree-menu > button').click()
 page.get_by_role('button',name='在 alpha 新建图',exact=True).click()
 expect(page.locator('#new-graph-project')).to_have_value('alpha')
 page.get_by_role('dialog',name='新建图',exact=True).get_by_role('button',name='取消',exact=True).click()
 # Mock only the native picker and registration; no real OS dialog/user projects.
 health=page.request.get(BASE+'/api/health').json();registered=[]
 page.route('**/api/projects/select-directory',lambda r:r.fulfill(json={'selectionId':'picker-token','name':'新增项目','root':'D:/测试源码'}))
 def register(route):
  assert route.request.post_data_json=={'selectionId':'picker-token','name':'新增项目'}
  item={'id':'ui-project','name':'新增项目','root':'D:/测试源码','rootExists':True}
  registered.append(item);route.fulfill(json=item)
 page.route('**/api/projects',register)
 page.route('**/api/health',lambda r:r.fulfill(json={**health,'projects':health['projects']+registered}))
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.get_by_role('button',name='新建项目',exact=True).click()
 dialog=page.get_by_role('dialog',name='接入项目',exact=True)
 expect(dialog.get_by_label('项目名称')).to_have_value('新增项目')
 dialog.get_by_role('button',name='接入项目',exact=True).click()
 expect(page.get_by_role('button',name='项目操作 新增项目',exact=True)).to_be_visible()
 page.locator('button[data-slug="other"]').click()
 expect(page.locator('#title')).to_have_text('other')
 expect(page.get_by_role('button',name='项目操作 新增项目',exact=True)).to_be_visible()
 page.get_by_role('button',name='资料库操作',exact=True).click()
 page.screenshot(path=str(Path(__file__).resolve().parents[1]/'target/sidebar-actions.png'))
 page.keyboard.press('Escape');expect(page.locator('[popover]:popover-open')).to_have_count(0)
 assert not errors,errors
 browser.close()
print('Components: searchable selection, programmatic sync, replaced options, disabled state, empty search and Escape lifecycle PASS')
