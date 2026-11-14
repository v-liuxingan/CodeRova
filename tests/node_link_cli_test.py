"""CLI links use stable graph/node identifiers, encode values and reject invalid targets."""
import json,os,subprocess,tempfile
from pathlib import Path
from urllib.parse import urlparse,parse_qs
ROOT=Path(__file__).resolve().parents[1]
BINARY=os.environ['CALLGRAPH_TEST_BINARY']
with tempfile.TemporaryDirectory(prefix='node-link-',dir=ROOT/'target') as tmp:
 path=Path(tmp)/'fixture.json'
 path.write_text(json.dumps({'schemaVersion':'0.4','projectId':'fixture','title':'fixture','root':'a & b','nodes':[{'id':'a & b','kind':'function','label':'entry','role':'entry','file':'main.rs','line':1}],'edges':[]}),encoding='utf-8')
 args=[BINARY,'link',str(path),'--node','a & b','--base-url','http://127.0.0.1:4317/?collect=1#old']
 result=subprocess.run(args,capture_output=True,text=True,encoding='utf-8');assert result.returncode==0,result.stderr
 url=urlparse(result.stdout.strip());assert parse_qs(url.query)=={'graph':['fixture'],'node':['a & b']} and not url.fragment
 for key,value in [('--node','absent'),('--base-url','file:///tmp'),('--base-url','http://user:password@localhost/')]:
  invalid=args.copy();invalid[invalid.index(key)+1]=value
  assert subprocess.run(invalid,capture_output=True).returncode!=0
print('CLI node link PASS: encoded identifiers, missing node, scheme and credentials')
