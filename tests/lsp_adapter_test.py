"""One protocol contract suite for standard and JDT profiles; no installed LSP needed."""
import json, os, subprocess, sys, tempfile
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname
ROOT = Path(__file__).resolve().parents[1]

def peer(profile, mode, log):
 uri = ''
 column = 3 if profile == 'standard' else 12
 kind = 12 if profile == 'standard' else 6
 last_prepared = None
 def span(line, start=0, end=60):
  return {'start':{'line':line,'character':start},'end':{'line':line,'character':end}}
 def item(index, caller=False):
  return {'name':['a','b','c'][index], 'kind':kind, 'uri':uri, 'range':span(index),
          'selectionRange':span(index,20,21) if caller and profile=='jdt' else span(index,column,column+1),
          'data':{'opaque':['token',index], 'uri':'opaque untouched value'}}
 def send(value):
  data=json.dumps({'jsonrpc':'2.0',**value}).encode()
  sys.stdout.buffer.write(f'Content-Length: {len(data)}\r\n\r\n'.encode()+data);sys.stdout.buffer.flush()
 while True:
  length=0
  while True:
   line=sys.stdin.buffer.readline()
   if not line:return
   if line==b'\r\n':break
   if line.lower().startswith(b'content-length:'):length=int(line.split(b':')[1])
  q=json.loads(sys.stdin.buffer.read(length));method=q.get('method');result=None;error=None
  with open(log,'a',encoding='utf-8') as f:f.write(method+'\n')
  if method=='initialize':result={'capabilities':{'callHierarchyProvider':True,'documentSymbolProvider':True},'serverInfo':{'name':'synthetic'}}
  elif method=='textDocument/didOpen':
   uri=q['params']['textDocument']['uri'];send({'method':'language/status','params':{'type':'Started'}});continue
  elif method=='textDocument/prepareCallHierarchy':
   last_prepared=q['params']['position']['line'];result=[item(last_prepared)]
  elif method=='textDocument/documentSymbol':
   result=[{k:v for k,v in item(i).items() if k not in ['uri','data']} for i in range(3)]
   if mode=='ambiguous':result.append(result[0].copy())
   if mode=='flat':result=[{'name':'a','kind':kind,'location':{'uri':uri,'range':span(0)}}]
  elif method=='textDocument/implementation':result=[]
  elif method in ['callHierarchy/outgoingCalls','callHierarchy/incomingCalls']:
   request=q['params']['item'];index=['a','b','c'].index(request['name'])
   assert request['data']==item(index)['data'], 'Opaque handle changed'
   if profile=='jdt' and method.endswith('outgoingCalls'):
    assert last_prepared==index, 'Non-atomic prepare/query sequence'
    assert request['range']['start']==request['selectionRange']['start']
   incoming=method.endswith('incomingCalls')
   pairs=[(0,1,[20,25]),(0,2,[30]),(1,0,[20]),(2,0,[20])]
   result=[]
   for caller,callee,positions in pairs:
    if (callee if incoming else caller)!=index:continue
    other=caller if incoming else callee
    result.append({('from' if incoming else 'to'):item(other,caller=incoming),
                   'fromRanges':[span(caller,pos,pos+1) for pos in positions]})
   if mode=='changed':
    source=Path(url2pathname(urlparse(uri).path))
    source.write_text(source.read_text(encoding='utf-8')+'// changed during collection\n',encoding='utf-8')
   if mode=='null':result=None
   if mode=='empty':result=[]
   if mode=='unsupported':error={'code':-32601,'message':'fixture method unavailable'}
  elif method=='exit':return
  elif 'id' not in q:continue
  send({'id':q['id'],**({'error':error} if error else {'result':result})})

def legacy_id(value):
 # Frozen pre-refactor identity contract, independent of the Rust implementation.
 h=0xcbf29ce484222325
 for byte in value.encode():h=((h^byte)*0x100000001b3)&0xffffffffffffffff
 return f'lsp-{h:016x}'

def run():
 binary=os.environ.get('CALLGRAPH_TEST_BINARY',str(ROOT/'target/library-e2e/debug/coderova.exe'))
 with tempfile.TemporaryDirectory(prefix='adapter-contract-',dir=ROOT/'target') as tmp:
  root=Path(tmp)
  for profile in ['standard','jdt']:
   folder=root/profile;folder.mkdir();file='main.rs' if profile=='standard' else 'Main.java'
   column=3 if profile=='standard' else 12
   (folder/file).write_text(('fn a() { b(); b(); }\nfn b() { a(); }\nfn c() { a(); }\n' if profile=='standard' else 'static void a() { b(); b(); }\nstatic void b() { a(); }\nstatic void c() { a(); }\n'),encoding='utf-8')
   config=folder/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(folder)}]}))
   for mode in ['normal','null','empty','unsupported','ambiguous','flat','changed']:
    for direction in ['outgoing','incoming']:
     (folder/file).write_text(('fn a() { b(); b(); c(); }\nfn b() { a(); }\nfn c() { a(); }\n' if profile=='standard' else 'static void a() { b(); b(); c(); }\nstatic void b() { a(); }\nstatic void c() { a(); }\n'),encoding='utf-8')
     out=folder/f'{mode}-{direction}.json';log=folder/f'{mode}-{direction}.log'
     args=[str(Path(__file__).resolve()),'--peer',profile,mode,str(log)]
     launch=folder/'lsp.json';launch.write_text(json.dumps({'java':{'command':sys.executable,'args':args,'workspaceRoot':str(folder/'workspace')},'collection':{'concurrency':4,'maxRetries':0}}))
     cmd=[binary,'analyze','--config',str(config),'--project','fixture','--file',file,'--line','1','--column',str(column+1),'--direction',direction,'--max-depth','20','--request-budget','40','--output',str(out)]
     if profile=='standard':cmd+=['--server',sys.executable]+[f'--server-arg={arg}' for arg in args]
     result=subprocess.run(cmd,cwd=ROOT,env={**os.environ,'CALLGRAPH_LSP_CONFIG':str(launch)},capture_output=True,timeout=30)
     if profile=='jdt' and mode=='flat':
      assert result.returncode!=0 and not out.exists();continue
     assert result.returncode==0,result.stderr.decode('utf-8',errors='replace')
     graph=json.loads(out.read_text(encoding='utf-8'));report=graph['analysis']
     expected_ids={legacy_id(f'{file}:{i}:{column}:{name}') for i,name in enumerate(['a','b','c'])}
     if mode=='normal' or (profile=='standard' and mode in ['ambiguous','flat']) or (profile=='jdt' and mode=='ambiguous' and direction=='outgoing'):
      assert {n['id'] for n in graph['nodes']}==expected_ids,graph
      assert len(graph['edges'])==5 and len({e['id'] for e in graph['edges']})==5
      assert not report['pendingNodes'] and not report['issues'],report
      expected_edges=set()
      for caller,target,position in [(0,1,20),(0,1,25),(0,2,30),(1,0,20),(2,0,20)]:
       source=legacy_id(f'{file}:{caller}:{column}:{["a","b","c"][caller]}')
       dest=legacy_id(f'{file}:{target}:{column}:{["a","b","c"][target]}')
       expected_edges.add(legacy_id(f'{source}:{dest}:{caller}:{position}'))
      assert {e['id'] for e in graph['edges']}==expected_edges
     elif mode=='empty':assert len(graph['nodes'])==1 and not graph['edges'] and not report['pendingNodes'] and not report['issues']
     else:assert report['issues'] and report['pendingNodes'],graph
     methods=log.read_text().splitlines()
     if profile=='standard':assert 'textDocument/documentSymbol' not in methods
     elif mode=='normal':assert methods.count('textDocument/documentSymbol')==2 # entry + shared collection snapshot
  print('Adapter contract PASS: both profiles/directions, frozen IDs, opaque data, cycles, distinct sites, null/empty/unsupported, ambiguous/flat symbols, changed-source rejection and shared cache')

if __name__=='__main__':
 if '--peer' in sys.argv:peer(*sys.argv[2:])
 else:run()
