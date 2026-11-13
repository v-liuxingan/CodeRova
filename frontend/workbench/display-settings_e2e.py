"""Production toolbar panel text clicks and view controls on isolated graph data."""
import json,os,socket,subprocess,tempfile,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tests"))
from browser_controls import select_option
ROOT=Path(__file__).resolve().parents[2]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/workbench-e2e/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='display-settings-',dir=ROOT/'target') as directory:
 root=Path(directory);graphs=root/'graphs';graphs.mkdir();source=root/'source';source.mkdir()
 (source/'main.rs').write_text('fn main() {}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'Fixture','root':str(source)}]}))
 graph={'schemaVersion':'0.4','projectId':'fixture','title':'Viewport fixture','root':'n0',
  'nodes':[{'id':f'n{i}','kind':'function','role':'','label':f'function{i}','file':'main.rs','line':1} for i in range(12)],
  'edges':[{'id':f'e{i}','from':f'n{(i-1)//4}','to':f'n{i}','kind':'static-call','file':'main.rs','line':1} for i in range(1,12)]}
 graphfile=graphs/'fixture.json';graphfile.write_text(json.dumps(graph));original=graphfile.read_bytes()
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   for _ in range(60):
    try:
     if page.request.get(base+'/api/health').ok:break
    except Exception:pass
    time.sleep(.1)
   page.goto(base+'/?graph=fixture')
   try:expect(page.locator('#fit')).to_be_enabled(timeout=15000)
   except AssertionError:raise AssertionError((errors,page.locator('#status').inner_text()))
   for theme,width in [('light',1440),('dark',1440),('light',390),('dark',390)]:
    page.set_viewport_size({'width':width,'height':960});select_option(page,'#appearance',theme)
    panel=page.locator('#display-settings');trigger=panel.locator(':scope > summary')
    trigger.click();expect(panel).to_have_attribute('open','')
    for selector in ['#settings-title','#window-help','.settings-shortcuts h3','#batch-selection-info dd','#canvas-keyboard-help dd']:
     panel.locator(selector).first.click(timeout=3000)
     expect(panel).to_have_attribute('open','')
     assert page.evaluate('document.querySelector("#display-settings").contains(document.activeElement)')
    panel.locator('#window-size').fill('3');select_option(page,'#window-unit','nodes')
    expect(panel).to_have_attribute('open','')
    box=panel.locator('.settings-body').bounding_box()
    assert box['x']>=0 and box['x']+box['width']<=width+1,box
    artifacts=ROOT/'target/display-settings';artifacts.mkdir(exist_ok=True)
    page.screenshot(path=str(artifacts/f'{theme}-{width}.png'))
    page.keyboard.press('Escape');expect(panel).not_to_have_attribute('open','');expect(trigger).to_be_focused()
    trigger.click();panel.locator('#apply-window').click();expect(panel).not_to_have_attribute('open','')
    expect(page.locator('#fit')).to_be_enabled()
    expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','3')
    trigger.click();page.locator('#title').click();expect(panel).not_to_have_attribute('open','')
   assert not errors,errors
   assert graphfile.read_bytes()==original
   browser.close()
  print('Display settings PASS: text clicks stay responsive, focus containment, units, reset, Escape, outside click, themes and narrow layout')
 finally:
  if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:server.terminate()
  server.wait(timeout=10)
