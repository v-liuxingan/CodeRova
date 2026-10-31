from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page()
 page.route('**/relation-list-review.js',lambda r:r.fulfill(path=str(ROOT/'frontend/v2/relation-list.js'),content_type='application/javascript'))
 page.goto('http://127.0.0.1:4323/v2/')
 page.evaluate("""async()=>{const {relationList}=await import('/relation-list-review.js');window.createdButtons=0;const items=Array.from({length:10000},(_,id)=>id);const list=relationList('全部证据',items,id=>{window.createdButtons++;const b=document.createElement('button');b.textContent='关系 '+id;return b;});list.id='review-call-list';Object.assign(list.style,{position:'fixed',top:'10px',left:'10px',height:'500px',width:'300px',overflow:'auto',zIndex:1000,background:'white'});document.body.append(list);} """)
 assert page.evaluate('window.createdButtons')==0
 page.locator('#review-call-list > summary').click()
 expect(page.locator('#review-call-list > div > button')).to_have_count(20)
 page.locator('#review-call-list > button').click()
 expect(page.locator('#review-call-list > div > button')).to_have_count(40)
 expect(page.locator('#review-call-list > div > button').last).to_have_text('关系 39')
 expect(page.locator('#review-call-list > button')).to_contain_text('9960')
 page.locator('#review-call-list > summary').click();page.locator('#review-call-list > summary').click()
 assert page.evaluate('window.createdButtons')==40
 browser.close();print('10,000 relationships: lazy disclosure, ordered paging, no repeated DOM creation PASS')
