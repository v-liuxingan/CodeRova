"""Responsive toolbar disclosure, persistence and focus without graph writes."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4324')
SLUG='sample' if 'CALLGRAPH_TEST_URL' in os.environ else 'recursive-calls'
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1440,'height':960});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/?graph='+SLUG,wait_until='networkidle')
 panel=page.locator('#graph-toolbar');button=page.locator('#toggle-toolbar')
 expect(panel).to_be_visible();before=page.locator('#canvas').bounding_box()['height']
 button.click();expect(panel).to_be_hidden();page.wait_for_timeout(150)
 assert page.locator('#canvas').bounding_box()['height']>before+60
 expect(button).to_have_attribute('aria-expanded','false')
 page.reload(wait_until='networkidle');expect(panel).to_be_hidden()
 button.focus();page.keyboard.press('Enter');expect(panel).to_be_visible()
 page.set_viewport_size({'width':390,'height':844});expect(panel).to_be_hidden()
 collapsed=page.locator('#canvas').bounding_box()['height']
 button.click();expect(panel).to_be_visible();page.wait_for_timeout(150)
 assert page.locator('#canvas').bounding_box()['height']<collapsed-60
 # Search remains available after reopening; collapsing closes body-portaled UI.
 page.locator('#symbols-ts-control').click();expect(page.get_by_placeholder('方法名、类名或文件名')).to_be_visible()
 button.click();expect(page.get_by_placeholder('方法名、类名或文件名')).not_to_be_visible()
 page.screenshot(path=str(Path(__file__).resolve().parents[2]/'target/toolbar-compact.png'))
 page.set_viewport_size({'width':1440,'height':960});expect(panel).to_be_visible()
 page.set_viewport_size({'width':1440,'height':600});expect(panel).to_be_hidden()
 page.set_viewport_size({'width':1440,'height':960});expect(panel).to_be_visible()
 assert not errors,errors
 b.close()
print('Toolbar disclosure PASS: compact defaults, viewport gain, separate preferences, keyboard and search cleanup')
