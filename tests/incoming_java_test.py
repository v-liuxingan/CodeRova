"""Optional real JDT LS incoming-call test; uses isolated source and workspace."""
import json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('CALLGRAPH_TEST_BINARY',ROOT/'target/debug/coderova.exe')).resolve()
with tempfile.TemporaryDirectory(prefix='incoming-java-',dir=ROOT/'target') as tmp:
 root=Path(tmp);source=root/'project/src';source.mkdir(parents=True)
 (source/'Main.java').write_text('public class Main {\n public static void main(String[] args) { first(); }\n /** @see Main */\n static void first() { Sink.work(); }\n}\n',encoding='utf-8')
 (source/'Sink.java').write_text('public class Sink {\n static void work() {}\n}\n',encoding='utf-8')
 config=root/'projects.json';config.write_text(json.dumps({'schemaVersion':'0.1','projects':[{'id':'fixture','name':'fixture','root':str(source.parent)}]}),encoding='utf-8')
 launch=json.loads(Path(os.environ.get('CALLGRAPH_LSP_CONFIG',ROOT/'callgraph.lsp.local.json')).read_text(encoding='utf-8'))
 launch['java']['workspaceRoot']=str(root/'workspace');settings=root/'lsp.json';settings.write_text(json.dumps(launch),encoding='utf-8')
 output=root/'incoming.json'
 subprocess.run([str(BINARY),'analyze','--config',str(config),'--project','fixture','--file','src/Sink.java','--line','2','--column','14','--direction','incoming','--max-depth','3','--request-budget','10','--output',str(output)],cwd=ROOT,env={**os.environ,'CALLGRAPH_LSP_CONFIG':str(settings)},check=True,timeout=210)
 graph=json.loads(output.read_text(encoding='utf-8'))
 assert len(graph['nodes'])==3 and len(graph['edges'])==2,graph
 assert graph['analysis']['direction']=='incoming' and not graph['analysis']['pendingNodes'],graph['analysis']
 nodes={n['id']:n for n in graph['nodes']}
 assert any(e['target']==graph['root'] for e in graph['edges'])
 assert {e['line'] for e in graph['edges']}=={2,4}
 assert all(e['sourceFile']==nodes[e['source']]['sourceFile']=='src/Main.java' for e in graph['edges'])
print('Real JDT LS incoming PASS: cross-file callers, two levels, Javadoc and exact caller locations')
