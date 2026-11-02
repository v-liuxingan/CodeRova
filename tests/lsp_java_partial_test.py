"""Java partial implementation failure and shared document-symbol regression."""
import json,os,sys,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def peer(log):
 uri=''
 def span(i):return {'start':{'line':i,'character':0},'end':{'line':i,'character':40}}
 def item(i):return {'name':['root','good','bad','leaf'][i],'kind':6,'uri':uri,'range':span(i),'selectionRange':span(i)}
 while True:
  n=0
  while True:
   line=sys.stdin.buffer.readline()
   if not line:return
   if line==b'\r\n':break
   if line.lower().startswith(b'content-length:'):n=int(line.split(b':')[1])
  q=json.loads(sys.stdin.buffer.read(n));m=q.get('method');r=None;e=None
  with open(log,'a') as f:f.write(m+'\n')
  if m=='initialize':r={'capabilities':{'callHierarchyProvider':True}}
  elif m=='textDocument/didOpen':
   uri=q['params']['textDocument']['uri'];body=json.dumps({'jsonrpc':'2.0','method':'language/status','params':{'type':'Started'}}).encode();sys.stdout.buffer.write(f'Content-Length: {len(body)}\r\n\r\n'.encode()+body);sys.stdout.buffer.flush();continue
  elif m=='textDocument/prepareCallHierarchy':
   i=q['params']['position']['line']
   if i==2:e={'code':-32603,'message':'fixture candidate failure'}
   else:r=[item(i)]
  elif m=='textDocument/documentSymbol':
   r=[{'name':'Service','kind':11,'range':{'start':{'line':0,'character':0},'end':{'line':4,'character':0}},'selectionRange':span(0),'children':[{'name':item(i)['name'],'kind':6,'range':span(i),'selectionRange':span(i)} for i in range(4)]}]
  elif m=='textDocument/implementation':r=[{'uri':uri,'range':span(i)} for i in [1,2]] if q['params']['position']['line']==0 else []
  elif m=='callHierarchy/outgoingCalls':r=[{'to':item(3),'fromRanges':[{'start':{'line':0,'character':1},'end':{'line':0,'character':2}}]}] if q['params']['item']['name']=='root' else []
  elif m=='exit':return
  elif 'id' not in q:continue
  value={'jsonrpc':'2.0','id':q['id'],**({'error':e} if e else {'result':r})};body=json.dumps(value).encode();sys.stdout.buffer.write(f'Content-Length: {len(body)}\r\n\r\n'.encode()+body);sys.stdout.buffer.flush()
def run():
 with tempfile.TemporaryDirectory(dir=ROOT/'target',prefix='java-partial-') as d:
  p=Path(d);(p/'Service.java').write_text('\n'.join(['void root() {}','void good() {}','void bad() {}','void leaf() {}'])+'\n')
  cfg=p/'projects.json';cfg.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(p)}]}))
  log=p/'rpc.log';local=p/'lsp.json';local.write_text(json.dumps({'java':{'command':sys.executable,'args':[str(Path(__file__).resolve()),'--peer',str(log)],'workspaceRoot':str(p/'workspace')},'collection':{'maxRetries':0}}))
  env=os.environ.copy();env['CALLGRAPH_LSP_CONFIG']=str(local)
  out=p/'graph.json';subprocess.run([os.environ['CALLGRAPH_TEST_BINARY'],'analyze','--config',str(cfg),'--project','fixture','--file','Service.java','--line','1','--column','1','--max-depth','3','--request-budget','10','--output',str(out)],env=env,check=True,capture_output=True,timeout=20)
  g=json.loads(out.read_text());nodes={n['id']:n['label'] for n in g['nodes']}
  assert any('good' in n for n in nodes.values()),g
  assert any('leaf' in n for n in nodes.values()),g
  queried=[nodes[n] for n in g['analysis']['queriedNodes']]
  assert not any('root' in n or 'good' in n for n in queried),queried
  assert g['analysis']['issues']
  assert log.read_text().splitlines().count('textDocument/documentSymbol')==2  # entry validation + one shared collector cache
 print('Java partial candidates, no false single-implementation traversal and shared file symbols PASS')
if __name__=='__main__':
 if '--peer' in sys.argv:peer(sys.argv[-1])
 else:run()
