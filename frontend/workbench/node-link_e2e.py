import os
from playwright.sync_api import sync_playwright,expect
BASE=os.environ['CALLGRAPH_TEST_URL']
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':960},permissions=['clipboard-read','clipboard-write'])
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 url=BASE+'/?graph=sample&node=child'
 page.goto(url);expect(page.locator('#canvas')).to_have_attribute('data-selection','child',timeout=20000)
 page.get_by_role('button',name='复制节点链接',exact=True).click()
 assert page.evaluate('navigator.clipboard.readText()')==url
 page.reload();expect(page.locator('#canvas')).to_have_attribute('data-selection','child',timeout=20000)
 page.evaluate("history.pushState({}, '', '?graph=sample&node=root');dispatchEvent(new PopStateEvent('popstate'))")
 expect(page.locator('#canvas')).to_have_attribute('data-selection','root')
 page.go_back();expect(page.locator('#canvas')).to_have_attribute('data-selection','child')
 page.goto(BASE+'/?graph=sample&node=not-present');expect(page.locator('#status')).to_contain_text('节点不存在',timeout=20000)
 assert not errors,errors
 browser.close()
 print('Node links PASS: deep link, copy, reload, same-graph history and missing node')
