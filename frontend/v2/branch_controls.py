from playwright.sync_api import expect

def click_branch(page, id, action):
    # Actual canvas hit testing (including Label text/background), not event injection.
    point=page.evaluate('''({id,action})=>{const g=window.__testGraph,n=g.getNodeData(id),p=g.getElementPosition(id);const both=n.data.canExpand&&n.data.canCollapse,offset=both?(action==='expand'?-16:16):0,h=document.querySelector('#direction input:checked').value==='LR';return g.getViewportByCanvas([p[0]+(h?166:offset),p[1]+(h?offset:n.data.height/2+14)]);}''',{'id':id,'action':action})
    box=page.locator('#canvas').bounding_box()
    page.mouse.click(box['x']+point[0],box['y']+point[1])
    expect(page.locator('#apply-window')).to_be_enabled()
