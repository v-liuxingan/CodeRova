"""Machine-readable local API client. No browser or third-party dependencies."""
import argparse
import json
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, quote


class Client:
    def __init__(self, base):
        parsed = urlsplit(base)
        if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1', '::1') or parsed.path not in ('', '/'):
            raise ValueError('Use the local HTTP service origin')
        self.base = base.rstrip('/')

    def request(self, method, path, data=None):
        if not path.startswith('/api/') or '..' in path or '?' in path:
            raise ValueError('Expected an /api/ path')
        body = None if data is None else json.dumps(data).encode()
        req = Request(self.base + path, data=body, method=method,
                      headers={'Origin': self.base, 'Content-Type': 'application/json'})
        with urlopen(req, timeout=300) as response:
            return json.load(response)

    def collect(self, slug, max_requests, batch, timeout):
        path = '/api/graphs/' + quote(slug, safe='')
        deadline = time.monotonic() + timeout
        attempted = set()
        completed = 0
        while completed < max_requests:
            if time.monotonic() >= deadline:
                return {'finished': False, 'reason': 'deadline', 'completedRequests': completed}
            graph = self.request('GET', path)
            report = graph.get('analysis')
            if report is None:
                raise ValueError('Graph has no LSP analysis checkpoint')
            pending = report['pendingNodes']
            outgoing = {e['from'] for e in graph['edges']}
            leaves = [n for n in pending if n not in outgoing and n not in attempted]
            if not leaves:
                return {'finished': not pending, 'reason': 'noPending' if not pending else 'unresolvedBoundaries',
                        'pendingNodes': pending, 'completedRequests': completed,
                        'prunedNodeIds': report.get('prunedNodeIds', []), 'issues': report['issues'],
                        'validation': self.request('GET', path + '/validation')}
            node = leaves[0]
            attempted.add(node)
            self.request('POST', path + '/analysis', {'nodeId': node, 'requestBudget': min(batch, max_requests-completed)})
            while True:
                state = self.request('GET', path + '/analysis')
                if state['status'] != 'running':
                    break
                if time.monotonic() >= deadline:
                    self.request('DELETE', path + '/analysis')
                    return {'finished': False, 'reason': 'stopRequestedAtDeadline', 'task': state}
                time.sleep(.5)
            completed += state['completed']
            if state['status'] != 'finished':
                return {'finished': False, 'reason': 'taskStopped', 'task': state}
        remaining = self.request('GET', path)['analysis']['pendingNodes']
        return {'finished': not remaining, 'reason': 'requestBudget' if remaining else 'noPending', 'completedRequests': completed,
                'task': self.request('GET', path + '/analysis')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:4323')
    commands = parser.add_subparsers(dest='command', required=True)
    request = commands.add_parser('request', help='Call any documented API operation')
    request.add_argument('method', choices=['GET', 'POST', 'DELETE', 'PUT'])
    request.add_argument('path')
    request.add_argument('--data-file', type=Path, help='UTF-8 JSON request, avoiding shell quoting')
    collect = commands.add_parser('collect', help='Continue eligible leaves, poll checkpoints, report unresolved boundaries')
    collect.add_argument('slug')
    collect.add_argument('--max-requests', type=int, default=1000)
    collect.add_argument('--batch', type=int, default=100)
    collect.add_argument('--timeout', type=int, default=1800)
    args = parser.parse_args()
    try:
        client = Client(args.base)
        if args.command == 'request':
            result = client.request(args.method, args.path, json.loads(args.data_file.read_text(encoding='utf-8')) if args.data_file else None)
        else:
            if args.max_requests < 1 or not 1 <= args.batch <= 1000 or args.timeout < 1:
                raise ValueError('Invalid collection budget or timeout')
            result = client.collect(args.slug, args.max_requests, args.batch, args.timeout)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get('finished', True) else 2
    except Exception as error:
        detail = error.read().decode('utf-8', errors='replace') if hasattr(error, 'read') else str(error)
        print(json.dumps({'error': detail}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
