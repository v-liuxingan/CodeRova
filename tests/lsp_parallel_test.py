"""Deterministic stdio concurrency, timeout, late-response and retry regression.
Runs the real CLI/common collector at widths 4, 8 and 16; no external LSP required.
"""
import collections
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
LEAVES = 48


def peer(mode, log):
    lock = threading.Lock()
    counts = collections.Counter()
    uri = ''
    def record(value):
        with lock:
            with open(log, 'a', encoding='utf-8') as stream:
                stream.write(json.dumps(value) + '\n')
    def send(value):
        body = json.dumps({'jsonrpc': '2.0', **value}).encode()
        with lock:
            sys.stdout.buffer.write(f'Content-Length: {len(body)}\r\n\r\n'.encode() + body)
            sys.stdout.buffer.flush()
    def item(index):
        span = {'start': {'line': index, 'character': 0}, 'end': {'line': index, 'character': 20}}
        return {'name': f'f{index}', 'kind': 12, 'uri': uri, 'range': span, 'selectionRange': span, 'data': {'identity': index}}
    def delayed(req, index, attempt):
        if mode == 'broken' and index == 2:
            time.sleep(.2)
            with lock:
                sys.stdout.buffer.write(b'Content-Length: invalid\r\n\r\n');sys.stdout.buffer.flush()
            return
        if mode == 'failures':
            if index == 1:
                return  # Never replies, including to cancellation.
            if index == 2 and attempt == 1:
                time.sleep(1.4)
                # A late first response must never add this invented edge.
                send({'id': req['id'], 'result': [{'to': item(48), 'fromRanges': [{'start': {'line': index, 'character': 2}, 'end': {'line': index, 'character': 3}}]}]})
                record({'end': req['id']})
                return
            if index == 3 or (index == 4 and attempt == 1):
                send({'id': req['id'], 'error': {'code': -32603, 'message': 'fixture transient/internal error'}})
                record({'end': req['id']})
                return
        time.sleep(.05 + (index % 4) * .015)  # Deliberate out-of-order completion.
        if index == 0:
            result = [{'to': item(n), 'fromRanges': [{'start': {'line': 0, 'character': 2}, 'end': {'line': 0, 'character': 3}}]} for n in range(1, LEAVES+1)]
        elif mode == 'failures' and index == 5:
            result = {'invalid': 'calls'}
        else:
            result = []
        send({'id': req['id'], 'result': result})
        record({'end': req['id']})
    while True:
        length = 0
        while True:
            line = sys.stdin.buffer.readline()
            if not line:
                return
            if line == b'\r\n':
                break
            if line.lower().startswith(b'content-length:'):
                length = int(line.split(b':')[1])
        req = json.loads(sys.stdin.buffer.read(length))
        method = req.get('method')
        if method == 'initialize':
            send({'id': req['id'], 'result': {'capabilities': {'callHierarchyProvider': True}}})
        elif method == 'textDocument/didOpen':
            uri = req['params']['textDocument']['uri']
            send({'method': 'experimental/serverStatus', 'params': {'quiescent': True}})
        elif method == 'textDocument/prepareCallHierarchy':
            send({'id': req['id'], 'result': [item(req['params']['position']['line'])]})
        elif method == 'callHierarchy/outgoingCalls':
            index = req['params']['item']['data']['identity']
            counts[index] += 1
            record({'start': req['id'], 'node': index, 'attempt': counts[index]})
            threading.Thread(target=delayed, args=(req, index, counts[index]), daemon=True).start()
        elif method == '$/cancelRequest':
            record({'cancel': req['params']['id']})
        elif method == 'shutdown':
            send({'id': req['id'], 'result': None})
        elif method == 'exit':
            return


def run():
    binary = Path(os.environ['CALLGRAPH_TEST_BINARY']).resolve()
    results = []
    with tempfile.TemporaryDirectory(prefix='lsp-parallel-', dir=ROOT/'target') as directory:
        root = Path(directory)
        (root/'main.rs').write_text(''.join(f'fn f{i}() {{}}        \n' for i in range(LEAVES+1)), encoding='utf-8')
        projects = root/'projects.json'
        projects.write_text(json.dumps({'schemaVersion': '0.1', 'projects': [{'id': 'fixture', 'name': 'Fixture', 'root': str(root)}]}), encoding='utf-8')
        baseline = {}
        for mode in ['normal', 'failures', 'broken']:
            for width in ([4] if mode == 'broken' else [4, 8, 16]):
                config, log, output = (root/f'{mode}-{width}.{suffix}' for suffix in ['config.json', 'jsonl', 'graph.json'])
                config.write_text(json.dumps({'collection': {'concurrency': width, 'requestTimeoutSeconds': 1, 'maxRetries': 3}}), encoding='utf-8')
                env = os.environ.copy()
                env['CALLGRAPH_LSP_CONFIG'] = str(config)
                start = time.perf_counter()
                args = [str(binary), 'analyze', '--config', str(projects), '--project', 'fixture', '--file', 'main.rs', '--line', '1', '--column', '4', '--max-depth', '3', '--request-budget', '64', '--server', sys.executable]
                for value in [str(Path(__file__).resolve()), '--peer', mode, str(log)]:
                    args.extend(['--server-arg', value])
                proc = subprocess.run(args+['--output', str(output)], env=env, capture_output=True, timeout=30)
                assert proc.returncode == 0, proc.stderr.decode('utf-8')
                graph = json.loads(output.read_text(encoding='utf-8'))
                assert len(graph['nodes']) == LEAVES+1 and len(graph['edges']) == LEAVES
                if mode in baseline:
                    assert graph == baseline[mode], 'concurrency changed result semantics/order'
                baseline[mode] = graph
                records = [json.loads(line) for line in log.read_text().splitlines()]
                active, peak = set(), 0
                for row in records:
                    if 'start' in row:
                        active.add(row['start']);peak = max(peak, len(active))
                    if 'end' in row:
                        active.discard(row['end'])
                    if 'cancel' in row:
                        active.discard(row['cancel'])
                assert peak <= width and peak >= width-1, (width, peak)
                counts = collections.Counter(row['node'] for row in records if 'start' in row)
                if mode == 'broken':
                    assert graph['analysis']['pendingNodes'] and graph['analysis']['queriedNodes']
                    assert any('连接中断' in issue for issue in graph['analysis']['issues'])
                elif mode == 'failures':
                    assert counts[1] == 4 and counts[3] == 4 and counts[2] == 2 and counts[4] == 2, counts
                    failed = {n['label'] for n in graph['nodes'] if n['id'] in graph['analysis']['pendingNodes']}
                    assert failed == {'f1', 'f3', 'f5'}, failed
                    assert len(graph['analysis']['queriedNodes']) == LEAVES-2
                    assert sum('cancel' in row for row in records) >= 5
                else:
                    assert not graph['analysis']['pendingNodes']
                    assert all(count == 1 for count in counts.values())
                results.append({'mode': mode, 'concurrency': width, 'peak': peak, 'seconds': round(time.perf_counter()-start, 3)})
    (ROOT/'target/lsp-parallel-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print('LSP parallel PASS: identical results at 4/8/16, bounded concurrency, 3 retries, cancellation, late replies, partial success')
    print(json.dumps(results))


if __name__ == '__main__':
    peer(sys.argv[2], sys.argv[3]) if len(sys.argv)>1 and sys.argv[1]=='--peer' else run()
