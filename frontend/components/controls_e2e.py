"""Dropdown synchronization must not expose Tom Select's synthetic empty option."""
import os
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(os.environ.get('CALLGRAPH_TEST_URL', 'http://127.0.0.1:4324') + '/')
    wrapper = page.locator('[data-select-id="appearance"]')
    for value in ['dark', 'light', 'dark', 'light']:
        wrapper.locator('.ts-control').click()
        expect(wrapper.locator('.ts-dropdown [data-selectable]')).to_have_text(['亮色', '深色'])
        wrapper.locator(f'.ts-dropdown [data-value="{value}"]').click()
        expect(page.locator('html')).to_have_attribute('data-theme', value)
    wrapper.locator('.ts-control').click()
    expect(wrapper.locator('.ts-dropdown [data-selectable]')).to_have_count(2)
    page.keyboard.press('Escape')
    page.evaluate('''() => {
        const select = document.createElement('select');
        select.id = 'placeholder-fixture'; select.dataset.search = 'false';
        select.innerHTML = '<option value="a">项目 A</option><option value="b">项目 B</option>';
        document.body.append(select);
    }''')
    fixture = page.locator('[data-select-id="placeholder-fixture"]')
    expect(fixture).to_be_visible()
    # Replacing options later must still allow an explicitly labeled placeholder.
    page.evaluate('''() => {
        document.getElementById('placeholder-fixture').innerHTML =
            '<option value="">请选择项目</option><option value="a">项目 A</option>';
    }''')
    for value in ['a', '', 'a', '']:
        fixture.locator('.ts-control').click()
        expect(fixture.locator('.ts-dropdown [data-selectable]')).to_have_text(['请选择项目', '项目 A'])
        fixture.locator(f'.ts-dropdown [data-value="{value}"]').click()
        expect(page.locator('#placeholder-fixture')).to_have_value(value)
    browser.close()
print('Dropdown PASS: repeated theme changes, no blank option, dynamic labeled placeholder retained')
