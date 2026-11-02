"""Smoke test the distributed ZIP, without relying on Rust/Node on PATH."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
archive = max((root / 'target/packages').glob('*.zip'), key=lambda p: p.stat().st_mtime)
assert hashlib.sha256(archive.read_bytes()).hexdigest() == Path(str(archive) + '.sha256').read_text().split()[0]
with tempfile.TemporaryDirectory(prefix='portable space-', dir=root / 'target') as temp:
    with ZipFile(archive) as zipped:
        zipped.extractall(temp)
    package = next(Path(temp).iterdir())
    assert json.loads((package / 'callgraph.projects.local.json').read_text())['projects'] == []
    assert not list((package / 'graphs').glob('*.json'))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {key.upper(): value for key, value in os.environ.items()}
    env['PATH'] = str(Path(env['SYSTEMROOT']) / 'System32')
    powershell = Path(env['SYSTEMROOT']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    log = Path(temp) / 'startup.log'
    with log.open('w') as output:
        proc = subprocess.Popen([str(powershell), '-NoProfile', '-File', str(package / 'start.ps1'),
                                 '-NoBrowser', '-Port', str(port)], cwd=temp, env=env,
                                stdout=output, stderr=output)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise AssertionError(log.read_text())
                try:
                    with urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                        assert response.status == 200
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise AssertionError('Packaged server did not become ready')
            for path in ['/', '/brand/coderova-mark.svg', '/vendor/workbench/workbench.js']:
                with urlopen(f'http://127.0.0.1:{port}{path}') as response:
                    assert response.status == 200
            print('Windows ZIP smoke test PASS (no Rust or Node on PATH)')
        finally:
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], check=False, capture_output=True)
            proc.wait(timeout=10)
