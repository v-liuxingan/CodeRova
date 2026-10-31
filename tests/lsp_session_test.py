"""Real HTTP and stdio lifecycle checks against a deterministic Java LSP peer."""
import json, os, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, urlopen
ROOT=Path(__file__).resolve().parents[1]

def peer(log):
 def record(value):
  with open(log,'a',encoding='utf-8') as f:f.write(json.dumps(value)+'\n')
 record({'pid':os.getpid()})
 def send(value):
  body=json.dumps({'jsonrpc':'2.0',**value}).encode();sys.stdout.buffer.write(f'Content-Length: {len(body)}\r\n\r\n'.encode()+body);sys.stdout.buffer.flush()
 uri=''
 span={'start':{'line':0,'character':0},'end':{'line':0,'character':20}}
 selection={'start':{'line':0,'character':5},'end':{'line':0,'character':10}}
 while True:
  length=0
  while True:
   line=sys.stdin.buffer.readline()
   if not line:return
   if line==b'\r\n':break
   if line.lower().startswith(b'content-length:'):length=int(line.split(b':')[1])
  req=json.loads(sys.stdin.buffer.read(length));method=req.get('method');rid=req.get('id');record({'method':method})
  if method=='initialize':send({'id':rid,'result':{'capabilities':{'callHierarchyProvider':True}}})
  elif method=='initialized':send({'method':'language/status','params':{'type':'Started'}})
  elif method=='textDocument/didOpen':uri=req['params']['textDocument']['uri']
  elif method=='textDocument/documentSymbol':send({'id':rid,'result':[{'name':'entry','kind':6,'range':span,'selectionRange':selection}]})
  elif method=='textDocument/prepareCallHierarchy':send({'id':rid,'result':[{'name':'entry','kind':6,'uri':uri,'range':span,'selectionRange':selection,'data':{'session':os.getpid()}}]})
  elif method=='callHierarchy/outgoingCalls':
   assert req['params']['item']['data']['session']==os.getpid()
   if Path(log+'.slow').exists():time.sleep(30)
   send({'id':rid,'result':[]})
  elif method=='textDocument/implementation':send({'id':rid,'result':[]})
  elif method=='shutdown':send({'id':rid,'result':None})
  elif method=='exit':return
  elif rid is not None:send({'id':rid,'result':None})

def run():
 binary=Path(os.environ['CALLGRAPH_TEST_BINARY']).resolve()
 with tempfile.TemporaryDirectory(prefix='lsp-session-',dir=ROOT/'target') as tmp:
  root=Path(tmp);source=root/'src';source.mkdir();file=source/'Entry.java';file.write_text('void entry() {}\n',encoding='utf-8')
  graphs=root/'graphs';graphs.mkdir();log=root/'peer.jsonl'
  projects=root/'projects.json';projects.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'Fixture','root':str(source)},{'id':'other','name':'Other','root':str(root/'other')}]}),encoding='utf-8')
  (root/'other').mkdir();(root/'other'/'Entry.java').write_text('void entry() {}\n',encoding='utf-8')
  config=root/'lsp.json';config.write_text(json.dumps({'java':{'command':sys.executable,'args':[str(Path(__file__).resolve()),'--peer',str(log)],'workspaceRoot':str(root/'workspace'),'settings':{}}}),encoding='utf-8')
  env=os.environ.copy();env['CALLGRAPH_LSP_CONFIG']=str(config)
  with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  base=f'http://127.0.0.1:{port}'
  server=subprocess.Popen([str(binary),'serve','--port',str(port),'--config',str(projects),'--graphs',str(graphs),'--public',str(ROOT/'public'),'--layouts',str(root/'layouts')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  def api(path,data=None,method=None):
   req=Request(base+path,data=None if data is None else json.dumps(data).encode(),method=method,headers={'Content-Type':'application/json','Origin':base})
   with urlopen(req,timeout=15) as response:return json.load(response)
  def records():return [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
  def starts():return sum('pid' in r for r in records())
  def check(project='fixture'):
   fid=api(f'/api/projects/{project}/source-files')[0]['id'];return api(f'/api/projects/{project}/entry-check',{'fileId':fid,'line':1})
  try:
   for _ in range(100):
    try:api('/api/health');break
    except OSError:time.sleep(.1)
   a=check();b=check();assert starts()==1,records()
   assert sum(r.get('method')=='textDocument/didOpen' for r in records())==1
   graph=api('/api/graphs',{'projectId':'fixture','candidateId':b['candidateId'],'title':'test'})
   endpoint='/api/graphs/'+graph['slug']+'/analysis'
   api(endpoint,{'requestBudget':1,'nodeId':graph['nodeId']})
   for _ in range(150):
    status=api(endpoint)
    if status['status']!='running':break
    time.sleep(.05)
   assert status['status']=='finished',status
   assert status['addedNodes']==0 and status['addedEdges']==0,status
   assert starts()==1,records()
   file.write_text('void entry() { }\n',encoding='utf-8');check();assert starts()==2
   check('other');assert starts()==3
   b=check();assert starts()==4
   graph=api('/api/graphs',{'projectId':'fixture','candidateId':b['candidateId'],'title':'cancel'})
   endpoint='/api/graphs/'+graph['slug']+'/analysis';Path(str(log)+'.slow').touch()
   api(endpoint,{'requestBudget':1,'nodeId':graph['nodeId']})
   for _ in range(100):
    if sum(r.get('method')=='callHierarchy/outgoingCalls' for r in records())>=2:break
    time.sleep(.05)
   api(endpoint,method='DELETE')
   for _ in range(100):
    if api(endpoint)['status']!='running':break
    time.sleep(.05)
   Path(str(log)+'.slow').unlink();check();assert starts()==5,records()
   last_pid=[r['pid'] for r in records() if 'pid' in r][-1];os.kill(last_pid,9);time.sleep(.1)
   check();assert starts()==6,records()
   config_data=json.loads(config.read_text());config_data['java']['settings']={'changed':True};config.write_text(json.dumps(config_data),encoding='utf-8')
   check();assert starts()==7,records()
   print('LSP session PASS: check/check/collect share one process; source/project changes and cancellation replace sessions')
  finally:
   server.terminate();server.wait(timeout=10)
   # Forced test-server termination cannot run Rust shutdown hooks.
   for r in records():
    if 'pid' in r:
     try:os.kill(r['pid'],9)
     except OSError:pass
if __name__=='__main__':peer(sys.argv[2]) if len(sys.argv)>1 and sys.argv[1]=='--peer' else run()
