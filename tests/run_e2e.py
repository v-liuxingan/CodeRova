"""Current workbench gate; mutations use isolated graph directories."""
import json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parents[1]
def main():
 env=os.environ.copy();env['PYTHONUTF8']='1'
 def run(*args):subprocess.run(args,cwd=ROOT,env=env,check=True)
 run('node','--test',*map(str,(ROOT/'frontend/workbench').glob('*.test.mjs')))
 for name in ['content_check_test.mjs','mermaid_scene_test.mjs','scene_render_test.mjs']:run('node',str(ROOT/'tests'/name))
 run('npm.cmd' if os.name=='nt' else 'npm','run','build:frontend')
 target=Path(env.get('CALLGRAPH_E2E_TARGET_DIR',ROOT/'target/workbench-e2e'))
 run('cargo','build','--quiet','--target-dir',str(target))
 binary=(target/'debug'/('coderova.exe' if os.name=='nt' else 'coderova')).resolve()
 env['CALLGRAPH_TEST_BINARY']=str(binary)
 run(sys.executable,str(ROOT/'tests/lsp_analysis_test.py'))
 run(sys.executable,str(ROOT/'tests/lsp_session_test.py'))
 run(sys.executable,str(ROOT/'tests/lsp_parallel_test.py'))
 run(sys.executable,str(ROOT/'tests/lsp_java_partial_test.py'))
 with tempfile.TemporaryDirectory(prefix='workbench-gate-',dir=ROOT/'target') as tmp:
  root=Path(tmp);source=root/'source';source.mkdir();(source/'main.rs').write_text('fn main() { child(); }\nfn child() {}\n',encoding='utf-8')
  (source/'Cargo.toml').write_text('[package]\nname="fixture"\nversion="0.1.0"\nedition="2021"\n[[bin]]\nname="fixture"\npath="main.rs"\n',encoding='utf-8')
  graphs=root/'graphs';graphs.mkdir();config=root/'projects.json'
  config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':id,'name':id,'root':str(source)} for id in ['alpha','beta']]}),encoding='utf-8')
  for slug,pid in [('sample','alpha'),('other','beta')]:
   graph={'schemaVersion':'0.4','projectId':pid,'title':slug,'root':'root','nodes':[{'id':'root','kind':'function','label':'main','file':'main.rs','line':1,'role':'entry'},{'id':'child','kind':'function','label':'child','file':'main.rs','line':2,'role':'work'}],'edges':[{'id':'call','from':'root','to':'child','kind':'static-call','file':'main.rs','line':1}]}
   (graphs/f'{slug}.json').write_text(json.dumps(graph),encoding='utf-8')
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  env['CALLGRAPH_TEST_URL']=f'http://127.0.0.1:{port}'
  server=subprocess.Popen([str(binary),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   for _ in range(100):
    try:
     with urlopen(env['CALLGRAPH_TEST_URL']+'/api/health',timeout=1):break
    except OSError:time.sleep(.1)
   run(sys.executable,str(ROOT/'tests/e2e_visualizer.py'))
   run(sys.executable,str(ROOT/'tests/component_controls_e2e.py'))
   run(sys.executable,str(ROOT/'frontend/workbench/display-settings_e2e.py'))
   run(sys.executable,str(ROOT/'tests/reading_guide_e2e.py'))
   run(sys.executable,str(ROOT/'tests/viewport_performance_e2e.py'))
   run(sys.executable,str(ROOT/'frontend/workbench/viewport-anchor_e2e.py'))
   run(sys.executable,str(ROOT/'frontend/workbench/toolbar-disclosure_e2e.py'))
   run(sys.executable,str(ROOT/'tests/graph_gestures_e2e.py'))
   run(sys.executable,str(ROOT/'tests/batch_node_actions_e2e.py'))
   run(sys.executable,str(ROOT/'tests/incoming_e2e.py'))
  finally:
   if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   else:server.terminate()
   try:server.wait(timeout=10)
   except subprocess.TimeoutExpired:server.kill();server.wait()
 for name in ['drafts_e2e.py','group-delete_e2e.py','collection-draft_e2e.py']:run(sys.executable,str(ROOT/'frontend/workbench'/name))
 print('Current workbench gate PASS')
 return 0
if __name__=='__main__':raise SystemExit(main())
