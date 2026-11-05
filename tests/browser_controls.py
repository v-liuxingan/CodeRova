"""Exercise the visible component, rather than force-selecting its hidden form field."""
from playwright.sync_api import expect
import json

def select_option(page, selector, value):
    select=page.locator(selector)
    expect(select).to_be_attached()
    page.wait_for_function('(selector)=>Boolean(document.querySelector(selector)?.tomselect)',arg=selector)
    page.wait_for_function('({selector,value})=>Boolean(document.querySelector(selector).tomselect.options[value])',arg={'selector':selector,'value':value})
    info=select.evaluate('(el,value)=>({input:el.tomselect.control_input.id,label:el.tomselect.options[value]?.text})',value)
    assert info['label'] is not None, (selector,value)
    wrapper=page.locator('[data-select-id="'+select.get_attribute('id')+'"]')
    field=wrapper.locator('.dropdown-input')
    page.locator('[data-select-id="'+select.get_attribute('id')+'"] .ts-control').click()
    if field.count():field.fill(info['label'])
    # Tom Select exposes its listbox through aria-controls, not a browser popup.
    dropdown=wrapper.locator('.ts-dropdown')
    option=dropdown.locator('[data-selectable][data-value='+json.dumps(value,ensure_ascii=False)+']')
    expect(option).to_be_visible()
    option.click()
    expect(select).to_have_value(value)
    expect(dropdown).not_to_be_visible()
