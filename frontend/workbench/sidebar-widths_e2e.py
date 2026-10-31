"""Browser-only resize verification; no graph mutations or external editor launch."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4324')
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1600,'height':1000});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''(() => {
   window.canvasResizes = [];
   for (const key of ['width', 'height']) {
     const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
     Object.defineProperty(HTMLCanvasElement.prototype, key, {...descriptor, set(value) {
       if (this.closest('#canvas')) window.canvasResizes.push({key, value});
       descriptor.set.call(this, value);
     }});
   }
 })();''')
 page.goto(BASE+'/?graph=callgraph-v2-validation',wait_until='networkidle')
 def width(id):return round(page.locator(id).bounding_box()['width'])
 def drag(id,delta):
  box=page.locator(id).bounding_box();x=box['x']+box['width']/2;y=box['y']+90
  page.wait_for_timeout(150)
  page.evaluate('() => { window.canvasResizes = []; window.previousCanvas = document.querySelector("#canvas canvas"); }')
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+delta,y,steps=12)
  page.wait_for_timeout(100)
  assert page.evaluate('() => window.canvasResizes.length')==0,'Dragging clears canvas backing buffers'
  assert page.evaluate('() => window.previousCanvas === document.querySelector("#canvas canvas")'),'Canvas replaced during drag'
  page.mouse.up()
  page.wait_for_timeout(150)
  assert page.evaluate('() => window.canvasResizes.length')>0,'Final canvas size was not flushed'
 left=width('#project-library');right=width('#source-inspector')
 drag('#resize-library',100);assert width('#project-library')==left+100
 assert width('#source-inspector')==right
 drag('#resize-inspector',-120);assert width('#source-inspector')==right+120
 assert width('#reader')>=320
 changed=(width('#project-library'),width('#source-inspector'))
 page.reload(wait_until='networkidle');assert (width('#project-library'),width('#source-inspector'))==changed
 page.locator('#toggle-library').click();expect(page.locator('#resize-library')).to_be_hidden()
 page.locator('#toggle-library').click();expect(page.locator('#resize-library')).to_be_visible();assert width('#project-library')==changed[0]
 page.locator('#resize-inspector').focus();page.keyboard.press('ArrowRight');assert width('#source-inspector')==changed[1]-20
 page.keyboard.press('Home');assert width('#source-inspector')==320
 drag('#resize-library',1000);assert width('#reader')>=320
 page.locator('#resize-library').dblclick(position={'x':4,'y':90});assert width('#project-library')==320
 page.set_viewport_size({'width':1000,'height':900});expect(page.locator('#resize-inspector')).to_be_hidden();expect(page.locator('#resize-library')).to_be_visible()
 page.set_viewport_size({'width':500,'height':900});expect(page.locator('#resize-library')).to_be_hidden()
 page.set_viewport_size({'width':1600,'height':1000});expect(page.locator('#resize-inspector')).to_be_visible()
 assert width('#project-library')==320 and width('#source-inspector')==320
 assert not errors,errors
 page.screenshot(path=str(Path(__file__).resolve().parents[2]/'target/sidebar-widths.png'))
 b.close()
print('Both sidebars: drag, sibling stability, persistence, collapse, keyboard, bounds, reset, responsive PASS')
