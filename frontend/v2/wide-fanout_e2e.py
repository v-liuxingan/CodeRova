from branch_controls import click_branch
import subprocess,tempfile,pathlib,os
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('CALLGRAPH_TEST_URL','http://127.0.0.1:4322')
with tempfile.TemporaryDirectory(prefix='edge-menu-') as d:
 bundle=pathlib.Path(d)/'bundle.js'
 subprocess.run(['node','--input-type=module','-e',"import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/v2/entry.js','utf8').replace('renderer = new Graph(', 'renderer = window.__testGraph = new Graph('),resolveDir:resolve('frontend/v2'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});",str(bundle)],check=True,capture_output=True)
 with sync_playwright() as p:
  b=p.chromium.launch();page=b.new_page(viewport={'width':1500,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  fixture=page.request.get(BASE+'/api/graphs/callgraph-v2-validation').json()
  fixture['root']='root'
  fixture['nodes']=[dict(fixture['nodes'][0],id=id,label=id) for id in ['root']+[f'child{i}' for i in range(21)]]
  fixture['edges']=[dict(fixture['edges'][0],id=f'e{i}',**{'from':'root','to':f'child{i}'}) for i in range(21)]
  page.route('**/api/graphs/callgraph-v2-validation',lambda r:r.fulfill(json=fixture))
  page.route('**/vendor/v2/workbench.js',lambda r:r.fulfill(path=str(bundle),content_type='application/javascript'))
  page.goto(BASE+'/v2/?graph=callgraph-v2-validation');expect(page.locator('#fit')).to_be_enabled()
  for direction in ['TB','LR']:
   page.locator(f'#direction input[value={direction}]').check()
   page.wait_for_timeout(400)
   paths=page.evaluate("window.__testGraph.getEdgeData().map(e=>window.__testGraph.context.element.getElement(e.id).getShape('key').attributes.d)")
   assert len(paths)==21,len(paths)
   assert all([s[0] for s in path]==['M','C'] for path in paths),paths
   assert len({str(path) for path in paths})==21
   labels=page.evaluate("""()=>{const g=window.__testGraph;return g.getEdgeData().map(e=>{const el=g.context.element.getElement(e.id);const [,target]=el.getEndpoints(el.attributes);return {target,transform:el.getShape('label').attributes.transform};});}""")
   for label in labels:
    expected=[label['target'][0]-(14 if direction=='LR' else 10),label['target'][1]-(12 if direction=='LR' else 18)]
    assert label['transform']==[['translate',*expected]],label

  page.evaluate("async()=>{const g=window.__testGraph;await g.zoomTo(1,false);await g.focusElement('root',false);}");page.wait_for_timeout(300)
  page.screenshot(path='tests/artifacts/edge-style-preview/wide-fanout-cubic.png')
  assert not errors,errors
  b.close();print('G6 wide fanout: 21 distinct cubic branches, both orientations, no shared straight spine PASS')
