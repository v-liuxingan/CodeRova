"""Read-only browser benchmark. Reports stay under ignored target/; no graph writes.

Run against a running service with --slug and --output. Use --bundle to replay
an instrumented baseline built by a previous run. Timings are local evidence,
not CI thresholds or comparisons with unrelated G6 demos.
"""
import argparse,json,subprocess,time
from collections import Counter
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--base',default='http://127.0.0.1:4324')
parser.add_argument('--slug',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--bundle')
args=parser.parse_args()
output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
bundle=Path(args.bundle) if args.bundle else output.with_suffix('.js')
if not args.bundle:
 injection='''
window.__bench={samples:[],snapshot:()=>({logical:visibleGraph.nodes.length,mounted:renderer.getNodeData().length,edges:renderer.getEdgeData().length,zoom:renderer.getZoom()}),
 fit:fitLogicalGraph, root:()=>current.root, select:id=>select('node',id,true), last:()=>current.nodes.at(-1).id,
 pan:async()=>{for(let i=0;i<30;i++){await renderer.translateBy([i<15?-40:40,0],false);await new Promise(requestAnimationFrame);}await refreshViewport(true);},
 ready:async()=>{await mountPromise;await new Promise(r=>setTimeout(r,250));}};
for(const [owner,key] of [[RenderWindow.prototype,'slice'],[Graph.prototype,'draw'],[Graph.prototype,'setData'],[Graph.prototype,'setElementState']]){
 const original=owner[key];owner[key]=function(...args){const start=performance.now();const result=original.apply(this,args);const done=()=>window.__bench.samples.push({key,ms:performance.now()-start,count:key==='setElementState'?Object.keys(args[0]).length:0});if(result?.then)result.then(done);else done();return result;};
}
'''
 build="""import {build} from 'esbuild';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';await build({stdin:{contents:readFileSync('frontend/workbench/entry.js','utf8')+process.argv[2],resolveDir:resolve('frontend/workbench'),loader:'js'},bundle:true,format:'esm',outfile:process.argv[1]});"""
 subprocess.run(['node','--input-type=module','-e',build,str(bundle.resolve()),injection],cwd=ROOT,check=True,capture_output=True)
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/vendor/workbench/workbench.js',lambda r:r.fulfill(path=str(bundle.resolve()),content_type='application/javascript'))
 page.add_init_script('''window.__frames=[];window.__long=[];new PerformanceObserver(l=>window.__long.push(...l.getEntries().map(x=>x.duration))).observe({type:'longtask',buffered:true});let last;function frame(t){if(last)window.__frames.push(t-last);last=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);''')
 cdp=page.context.new_cdp_session(page);cdp.send('Profiler.enable');cdp.send('Profiler.start')
 start=time.perf_counter();page.goto(args.base+'/?graph='+args.slug);expect(page.locator('#fit')).to_be_enabled(timeout=120000)
 page.evaluate('window.__bench.ready()');load_ms=(time.perf_counter()-start)*1000
 def measure(name,expression):
  page.evaluate('window.__frames=[];window.__long=[];window.__bench.samples=[]')
  start=time.perf_counter();page.evaluate(expression);elapsed=(time.perf_counter()-start)*1000
  page.evaluate('window.__bench.ready()')
  result=page.evaluate('({frames:window.__frames,long:window.__long,samples:window.__bench.samples,...window.__bench.snapshot()})')
  frames=sorted(result.pop('frames'));samples=result.pop('samples')
  result.update(name=name,elapsedMs=round(elapsed,1),frameP95=round(frames[min(len(frames)-1,int(len(frames)*.95))],1) if frames else 0,
    calls=dict(Counter(s['key'] for s in samples)),stateUpdates=sum(s.get('count',0) for s in samples),workMs={key:round(sum(s['ms'] for s in samples if s['key']==key),1) for key in set(s['key'] for s in samples)})
  return result
 initial=page.evaluate('window.__bench.snapshot()')
 phases=[measure('pan-detail','window.__bench.pan()'),measure('fit-overview','window.__bench.fit()'),measure('pan-overview','window.__bench.pan()'),measure('select-distant','window.__bench.select(window.__bench.last())')]
 profile=cdp.send('Profiler.stop')['profile'];nodes={n['id']:n for n in profile['nodes']};counts=Counter(profile.get('samples',[]))
 top=[{'function':nodes[id]['callFrame']['functionName'] or '(anonymous)','samples':count} for id,count in counts.most_common(18)]
 report={'loadMs':round(load_ms,1),'initial':initial,'phases':phases,'cpuHotspots':top,'errors':errors}
 output.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
 browser.close()
 assert not errors,errors
