"""Verify painted node coordinates, not just container sizes; no graph writes."""
import os
from playwright.sync_api import sync_playwright
BASE=os.environ.get("CALLGRAPH_TEST_URL","http://127.0.0.1:4324")
SLUG="sample" if "CALLGRAPH_TEST_URL" in os.environ else "recursive-calls"
with sync_playwright() as p:
 b=p.chromium.launch();page=b.new_page(viewport={'width':1600,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(BASE+'/?graph='+SLUG);page.wait_for_load_state('networkidle');page.wait_for_timeout(500)
 def box():
  return page.evaluate("""()=>{for(const c of document.querySelectorAll('#canvas canvas')){const ctx=c.getContext('2d');if(!ctx)continue;const {data}=ctx.getImageData(0,0,c.width,c.height);let minX=Infinity,minY=Infinity,maxX=0,maxY=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(data[i]===249&&data[i+1]===240&&data[i+2]===255&&data[i+3]===255){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}if(minX!==Infinity){const r=c.getBoundingClientRect();return [minX+r.left,minY+r.top,maxX+r.left,maxY+r.top];}}throw Error('No root pixels');}""")
 page.locator('#node-center').click();page.wait_for_timeout(200)
 initial=box();print('initial',initial)
 for selector in ['#toggle-library','#toggle-library','#toggle-inspector','#toggle-inspector','#toggle-toolbar','#toggle-toolbar']:
  page.locator(selector).click();page.wait_for_timeout(300);current=box();print(selector,current);assert max(abs(a-b) for a,b in zip(initial,current))<=2
 handle=page.locator('#resize-library').bounding_box();x=handle['x']+handle['width']/2;y=handle['y']+90;page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+80,y,steps=10);page.wait_for_timeout(150);print('drag',box());assert max(abs(a-b) for a,b in zip(initial,box()))<=2;page.mouse.up();page.wait_for_timeout(200);print('release',box());assert max(abs(a-b) for a,b in zip(initial,box()))<=2
 # Explicit pan must still work; subsequent layout changes retain the new position.
 canvas=page.locator('#canvas').bounding_box();x=canvas['x']+40;y=canvas['y']+40
 page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+45,y+35,steps=8);page.mouse.up();page.wait_for_timeout(200)
 panned=box();assert abs(panned[0]-initial[0]-45)<=2 and abs(panned[1]-initial[1]-35)<=2
 page.locator('#resize-inspector').focus();page.keyboard.press('ArrowLeft');page.wait_for_timeout(200)
 assert max(abs(a-b) for a,b in zip(panned,box()))<=2
 page.set_viewport_size({'width':1500,'height':900});page.wait_for_timeout(200)
 assert max(abs(a-b) for a,b in zip(panned,box()))<=2
 page.locator('#node-center').click();page.wait_for_timeout(200);assert box()!=panned
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200)
 page.locator('#toggle-library').click();page.wait_for_timeout(200)
 if page.locator('#graph-toolbar').is_hidden():page.locator('#toggle-toolbar').click()
 page.locator('#node-center').click();page.wait_for_timeout(200)
 compact=box()
 page.locator('#toggle-toolbar').click();page.wait_for_timeout(200)
 assert max(abs(a-b) for a,b in zip(compact,box()))<=2
 page.locator('#toggle-toolbar').click();page.wait_for_timeout(200)
 assert max(abs(a-b) for a,b in zip(compact,box()))<=2
 assert not errors,errors;page.screenshot(path='target/viewport-anchor.png');b.close();print('Screen coordinates stable across both sidebars and live drag PASS')
