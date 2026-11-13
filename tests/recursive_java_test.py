"""Optional real JDT LS recursion regression test; uses isolated source and workspace."""
import json,os,subprocess,tempfile,socket,time
from urllib.request import Request,urlopen
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='recursive-java-',dir=ROOT/'target') as tmp:
 root=Path(tmp);source=root/'project/src';source.mkdir(parents=True)
 (source/'Main.java').write_text('public class Main {\n public static void main(String[] args) { direct(2); a(2); }\n static void direct(int n) { if (n > 0) { direct(n - 1); direct(n - 1); } }\n static void a(int n) { if (n > 0) { b(n - 1); } }\n static void b(int n) { if (n > 0) { a(n - 1); } }\n}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(source.parent)}]}),encoding='utf-8')
 launch=json.loads(Path(os.environ.get('CALLGRAPH_LSP_CONFIG',ROOT/'callgraph.lsp.local.json')).read_text(encoding='utf-8'))
 launch['java']['workspaceRoot']=str(root/'workspace');settings=root/'lsp.json';settings.write_text(json.dumps(launch),encoding='utf-8')
 graphs=root/"graphs";graphs.mkdir()
 identities={}
 for kind,line in [('direct',3),('mutual',4)]:
  for direction in ['outgoing','incoming']:
   output=graphs/f'{kind}-{direction}.json'
   result=subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/Main.java','--line',str(line),'--column','14','--direction',direction,'--max-depth','100','--request-budget','200','--output',str(output)],cwd=ROOT,env={**os.environ,'CALLGRAPH_LSP_CONFIG':str(settings)},capture_output=True,timeout=210)
   assert result.returncode==0, result.stderr.decode('utf-8',errors='replace')
   graph=json.loads(output.read_text(encoding='utf-8'))
   expected=(1,2) if kind=='direct' else (2,2)
   if direction=='incoming': expected=(expected[0]+1,expected[1]+1)
   assert (len(graph['nodes']),len(graph['edges']))==expected,graph
   report=graph['analysis']
   assert not report['pendingNodes'] and not report['issues'],report
   assert len(report['queriedNodes'])==expected[0],report
   assert len({edge['id'] for edge in graph['edges']})==expected[1]
   assert all(node['line'] in [2,3,4,5] for node in graph['nodes'])
   current={node['label']:node['id'] for node in graph['nodes']}
   for label,identity in current.items():
    assert identities.get(label,identity)==identity, (label,identities,current)
   identities.update(current)
   print(f'Real JDT recursion PASS: {kind} {direction}, {expected[0]} nodes, {expected[1]} call sites')
 with socket.socket() as sock:
  sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 server=subprocess.Popen([str(BINARY),'serve','--port',str(port),'--config',str(config),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],cwd=ROOT,env={**os.environ,'CALLGRAPH_LSP_CONFIG':str(settings)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   try:
    with urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  for output in graphs.glob('*.json'):
   initial=output.read_bytes();graph=json.loads(initial)
   def op(draft,action,**extra):
    body={**({'draftId':draft} if draft else {}),'operation':{'action':action,**extra}}
    request=Request(base+f'/api/graphs/{output.stem}/draft',data=json.dumps(body).encode(),headers={'Origin':base,'Content-Type':'application/json'})
    with urlopen(request,timeout=180) as response:return json.load(response)
   draft=op(None,'read')['draftId']
   for node in graph['nodes']:
    op(draft,'analyze',request={'nodeId':node['id'],'requestBudget':200})
    deadline=time.monotonic()+180
    while time.monotonic()<deadline:
     task=op(draft,'analysisStatus')['result']
     if task['status']!='running':break
     time.sleep(.1)
    assert task['status']=='finished',task
    assert task['addedNodes']==0 and task['addedEdges']==0,task
    preview=op(draft,'read')['graph']
    assert not preview['analysis']['issues'],preview['analysis']
    assert len(preview['nodes'])==len(graph['nodes']) and len(preview['edges'])==len(graph['edges'])
    assert output.read_bytes()==initial
   op(draft,'discard')
   print(f'Recursive continuation PASS: {output.stem}, every node, no duplicate facts or disk writes')
 finally:
  if os.name=='nt':
   subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
  else:
   server.terminate()
  server.wait(timeout=15)
