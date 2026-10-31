from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='edge-menu-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fixture=page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
  fixture['root']='a'
  fixture['nodes']=[dict(fixture['nodes'][0],id=id,label=id) for id in ['a','b','c']]
  fixture['edges']=[dict(fixture['edges'][0],id=f'call{i}',line=10+i*10,**{'from':'a','to':target}) for i,target in enumerate(['b','c','b'])]
  requests=[]
  page.on('request',lambda r:requests.append(r.post_data_json) if r.url.endswith('/api/preview') else None)
  page.route('**/api/graphs/callgraph-v2-validation',lambda r:r.fulfill(json=fixture))
  page.route('**/api/preview',lambda r:r.fulfill(json={'lines':[{'number':10,'text':'call();','focus':True}]}))
  page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  page.goto(BASE+'/?graph=callgraph-v2-validation');expect(page.locator('#fit')).to_be_enabled()
  click_branch(page,'a','collapse');expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','1')
  def root():
   page.locator('#canvas').click(position={'x':5,'y':5})
   page.evaluate("window.__testGraph.emit('node:click',{target:{id:'a'}})")
   expect(page.locator('#relations')).to_contain_text('直接调用点 3 个')
  root()
  page.locator('#relations > button').filter(has_text='调用点 30').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','2')
  expect(page.locator('#selection-title')).to_have_text('a → b')
  expect(page.locator('#source .focus')).to_be_visible()
  assert requests[-1]['id']=='call2'
  root();page.locator('#relations > button').filter(has_text='调用点 10').click()
  expect(page.locator('#canvas')).to_have_attribute('data-displayed-nodes','3')
  expect(page.locator('#source .focus')).to_be_visible()
  assert requests[-1]['id']=='call0'
  assert page.evaluate("window.__testGraph.getNodeData().filter(n=>n.data.sourceId==='b').length")==2
  assert not errors,errors
  b.close();print('Complete direct-call list: collapsed calls discoverable, exact repeated call source, only chosen occurrence revealed PASS')
