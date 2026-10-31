"""Compatibility entry point for the explicit-acceptance collection regression."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('collection-draft_e2e.py')), run_name='__main__')
