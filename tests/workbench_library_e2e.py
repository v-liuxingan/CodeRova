"""Mutating tree tests run only against the runner's isolated graph directory."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
(ROOT/'target/test-artifacts').mkdir(parents=True,exist_ok=True)
directory = Path(os.environ['CALLGRAPH_TEST_GRAPHS']).resolve()
assert directory == (ROOT / 'tests/.tmp-graphs').resolve()
BASE = os.environ['CALLGRAPH_TEST_URL']
slug = 'tree-test-fixture'
original = next(directory.rglob('callgraph-v2-validation.json')).read_bytes()
fixture = directory / (slug + '.json')
fixture.write_bytes(original)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1500, 'height': 950})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE + '/?graph=' + slug)
    expect(page.locator('#fit')).to_be_enabled()
    initial_row = page.locator(f'.tree-file[data-graph="{slug}"]')
    initial_group = initial_row.locator('..')
    initial_project = initial_group.locator('..')
    hierarchy = [initial_project.locator(':scope > summary'), initial_group.locator(':scope > summary'), initial_row]
    positions = [item.bounding_box()['x'] for item in hierarchy]
    assert positions[0] < positions[1] < positions[2], positions
    initial_row.locator('.tree-menu > button').click()
    initial_row.locator('.tree-menu > button').press('Escape')
    expect(initial_row.locator('.tree-menu-actions')).not_to_be_visible()
    graph = json.loads(original)
    page.locator('#symbols').select_option(graph['root'])
    expect(page.locator('#source .focus').first).to_be_visible()
    selection = page.locator('#canvas').get_attribute('data-selection')
    page.get_by_role('button',name='资料库操作',exact=True).click()
    page.get_by_role('button', name='新建目录', exact=True).click()
    page.locator('dialog select').select_option(graph['projectId'])
    page.locator('dialog input').fill('验收分组')
    page.get_by_role('button', name='创建', exact=True).click()
    target = page.locator('.tree-group').filter(has=page.locator('summary', has_text='验收分组'))
    row = page.locator(f'.tree-file[data-graph="{slug}"]')
    row.drag_to(target.locator(':scope > summary'))
    expect(target.locator(f'button[data-slug="{slug}"]')).to_have_count(1)
    expect(page.locator('#catalog')).to_have_attribute('aria-busy', 'false')
    moved = next(directory.rglob(slug + '.json'))
    assert moved != fixture
    contents = moved.read_bytes()
    assert json.loads(contents)['category'] == '验收分组'
    assert page.locator('#canvas').get_attribute('data-selection') == selection
    page.reload()
    expect(page.locator('#fit')).to_be_enabled()
    expect(target.locator(f'button[data-slug="{slug}"]')).to_have_count(1)
    row.locator('.tree-menu > button').click()
    row.get_by_role('button', name='删除 ' + graph['title'], exact=True).click()
    page.get_by_role('button', name='取消', exact=True).click()
    assert moved.exists()
    row.locator('.tree-menu > button').click()
    row.get_by_role('button', name='删除 ' + graph['title'], exact=True).click()
    page.locator('dialog').get_by_role('button', name='移入回收站', exact=True).click()
    trash = page.locator('.tree-trash')
    trash.get_by_role('button',name='回收站操作 '+graph['title'],exact=True).click()
    expect(trash.get_by_role('button', name='恢复 ' + graph['title'], exact=True)).to_be_visible()
    assert not moved.exists() and moved.with_suffix('.deleted').read_bytes() == contents
    trash.get_by_role('button', name='恢复 ' + graph['title'], exact=True).click()
    expect(page.locator(f'button[data-slug="{slug}"]')).to_have_count(1)
    assert moved.read_bytes() == contents
    assert page.request.delete(BASE + '/api/graphs/' + slug).ok
    page.get_by_role('button',name='资料库操作',exact=True).click()
    page.get_by_role('button', name='刷新目录', exact=True).click()
    trash.get_by_role('button',name='回收站操作 '+graph['title'],exact=True).click()
    permanent = trash.get_by_role('button', name='永久删除 ' + graph['title'], exact=True)
    expect(permanent).to_be_visible()
    permanent.click()
    page.get_by_role('button', name='取消', exact=True).click()
    assert moved.with_suffix('.deleted').exists()
    trash.get_by_role('button',name='回收站操作 '+graph['title'],exact=True).click()
    permanent.click()
    page.locator('dialog').get_by_role('button', name='永久删除', exact=True).click()
    expect(permanent).to_have_count(0)
    assert not moved.with_suffix('.deleted').exists()
    assert not page.request.delete(BASE + '/api/graph-trash/callgraph-v2-validation').ok
    assert next(directory.rglob('callgraph-v2-validation.json')).read_bytes() == original
    page.get_by_role('button',name='资料库操作',exact=True).click()
    page.get_by_role('button', name='折叠所有目录', exact=True).click()
    assert page.locator('.tree-project[open]').count() == 0
    page.locator('#filter').fill('validate_graph')
    assert page.locator('.tree-project[open]').count() > 0
    page.screenshot(path=str(ROOT / 'target/test-artifacts/library.png'))
    assert not errors, errors
    browser.close()
print('V2 library: drag, archive, restore, permanent deletion, collapse, search passed')
