"""Render and exercise the production settings DOM in isolated Chromium."""
import json
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("BILI_QA_OUTPUT", str(Path(tempfile.gettempdir()) / "bili-product-qa")))
OUT.mkdir(exist_ok=True, parents=True)
BUNDLE = subprocess.check_output(["node", "tests/build-fixture.mjs"], cwd=ROOT, encoding="utf-8")
HTML = """<!doctype html><html><head><meta charset=utf-8>
<title>Bilibili settings regression</title><style>
body { margin:0; background:#f1f2f3; font-family:Arial,sans-serif; }
#app { margin:60px auto; width:min(100%,1000px); }
.bpx-player-container { position:relative; background:#18191c; min-height:400px; }
video { width:100%; height:360px; }
.bpx-player-control-bottom-right { display:flex; justify-content:flex-end; padding:12px; }
input#danmaku { margin:20px; }
</style></head><body><main id=app><div id=playerWrap><div id=bilibili-player>
<div class=bpx-player-container data-screen=normal><div class=bpx-player-primary-area>
<div class=bpx-player-video-area><div class=bpx-player-video-wrap><video></video></div>
<div class=bpx-player-control-bottom-right><button class=bpx-player-ctrl-setting>Settings</button></div>
</div></div></div></div></div><input id=danmaku><textarea id=editable></textarea>
<div id=rich contenteditable=true><span>Editable</span></div></main></body></html>"""
BOOT = """() => {
  const data = JSON.parse(localStorage.getItem('qa-settings') || '{}');
  window.qaStorage = data;
  window.chrome = {runtime:{id:'qa',getURL:p=>p,getManifest:()=>({version:'2.38.17'})},
    storage:{local:{
      get:(keys,cb)=>cb(Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]))),
      set:(values,cb)=>{Object.assign(data,values);localStorage.setItem('qa-settings',JSON.stringify(data));cb?.();},
      remove:(keys,cb)=>{keys.forEach(k=>delete data[k]);cb?.();},
      onChanged:{addListener(){},removeListener(){}}
    }}};
}"""

passed = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1280, "height": 720}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("https://fixture.test/**", lambda route: route.fulfill(body=HTML, content_type="text/html"))
    def boot():
        page.goto("https://fixture.test/video/BVqa")
        page.evaluate(BOOT)
        page.add_style_tag(path=str(ROOT / "dist/styles/content.css"))
        page.add_script_tag(content=BUNDLE)
        page.evaluate("window.fixtureReady")
    def check(name, expression):
        assert page.evaluate(expression), name
        passed.append(name)
    def open_menu():
        page.locator(".bpx-ambientlight-settings-button").click()
        page.locator(".bpx-ambientlight-settings-menu").wait_for(state="visible")
    boot()
    open_menu()
    check("Real config creates every available setting", """() => fixture.SettingsConfig.every(s =>
      s.type === 'section' || document.getElementById('setting-' + s.name))""")
    page.screenshot(path=str(OUT / "menu-light-basic.png"))
    page.locator("#setting-advancedSettings").click()
    page.screenshot(path=str(OUT / "menu-light-advanced.png"))
    check("Advanced state is saved", "() => fixture.menu.advancedSettings && qaStorage['setting-advancedSettings'] !== false")
    check("Optional blend dependency", "() => !fixture.menu.frameBlending && getComputedStyle(document.querySelector('#setting-frameBlendingSmoothness')).display === 'none'")
    page.locator("#setting-resolution-range").fill("2")
    page.locator("#setting-resolution-range").dispatch_event("change")
    page.locator("#setting-resolution").click(button="right")
    page.wait_for_timeout(150)
    check("Right-click restores real range default", "() => fixture.menu.resolution === fixture.SettingsConfig.find(s=>s.name==='resolution').default")
    page.locator(".ytpa-preset-btn[data-preset=soft]").click()
    page.wait_for_timeout(200)
    check("Preset applies real values", "() => fixture.menu.blur2===45 && fixture.menu.brightness===85")
    for dark in [True, False]:
        page.evaluate("(dark)=>document.documentElement.classList.toggle('night-mode',dark)", dark)
        for width, height, label in [(1280,720,"desktop"), (1920,1080,"large"), (360,740,"narrow"), (1024,576,"scaled125")]:
            page.set_viewport_size({"width":width,"height":height})
            check(f"Panel fits {label} {'dark' if dark else 'light'}", """() => {
              const r=fixture.menu.menuElem.getBoundingClientRect();
              return r.left>=15 && r.right<=innerWidth-15 && r.top>=15 && r.bottom<=innerHeight-15;
            }""")
            check(f"No panel overflow {label} {'dark' if dark else 'light'}", """() =>
              fixture.menu.scrollElem.scrollWidth <= fixture.menu.scrollElem.clientWidth""")
            check(f"Sync labels fit {label}", """() => {
              const list = document.querySelector('#snap-points-frameSync');
              const rect = list.getBoundingClientRect();
              return [...list.children].every(e => {
                const r=e.getBoundingClientRect();
                return r.width>20 && r.left>=rect.left && r.right<=rect.right+1;
              });
            }""")
            page.screenshot(path=str(OUT / f"menu-{label}-{'dark' if dark else 'light'}.png"))
    page.set_viewport_size({"width":1280,"height":720})
    check("Owned page CSS is restored without overwriting external changes", """() => {
      const owner = Object.create(fixture.Ambientlight.prototype);
      const style = document.documentElement.style;
      style.setProperty('--qa-original', 'original', 'important');
      owner.setPageAmbientProperty('--qa-original', 'light');
      owner.setPageAmbientProperty('--qa-external', 'light');
      style.setProperty('--qa-external', 'external');
      owner.restorePageAmbientProperties();
      const valid = style.getPropertyValue('--qa-original')==='original' &&
        style.getPropertyPriority('--qa-original')==='important' &&
        style.getPropertyValue('--qa-external')==='external';
      style.removeProperty('--qa-original'); style.removeProperty('--qa-external');
      return valid;
    }""")
    header_top = page.locator(".bili-settings-header").bounding_box()["y"]
    page.evaluate("fixture.menu.scrollElem.scrollTop = 350")
    check("Independent scroll retains fixed header", f"() => Math.abs(document.querySelector('.bili-settings-header').getBoundingClientRect().top - {header_top}) < 1")
    page.evaluate("fixture.menu.scrollElem.scrollTop = 0")
    page.keyboard.press("Escape")
    page.locator(".bpx-ambientlight-settings-menu").wait_for(state="hidden")
    check("Escape returns focus", "() => document.activeElement === fixture.menu.menuBtn")
    open_menu()
    page.keyboard.press("g")
    check("G closes menu, backdrop and expanded state", """() =>
      fixture.menu.menuElem.hidden && fixture.menu.modalBackdropElem.hidden &&
      fixture.menu.menuBtn.getAttribute('aria-expanded')==='false' && !fixture.menu.enabled""")
    page.keyboard.press("g")
    check("G restores light without menu", "() => fixture.menu.enabled && fixture.menu.menuElem.hidden")
    for selector in ["#danmaku", "#editable", "#rich"]:
        page.locator(selector).focus()
        page.keyboard.press("g")
        check(f"G ignored in {selector}", "() => fixture.menu.enabled")
    open_menu()
    page.locator(".ytpa-close-settings-btn").focus()
    page.keyboard.press("Tab")
    check("Tab stays inside dialog", "() => fixture.menu.menuElem.contains(document.activeElement)")
    page.locator(".bpx-ambientlight-modal-backdrop").click(position={"x":10,"y":10})
    page.locator(".bpx-ambientlight-settings-menu").wait_for(state="hidden")
    open_menu()
    page.evaluate("""() => {
      const m=fixture.menu; m.onCloseMenu({target:document.body,stopPropagation(){}});
      return m.onSettingsBtnClicked();
    }""")
    page.wait_for_timeout(600)
    check("Rapid reopen is stable", "() => !fixture.menu.menuElem.hidden")
    page.evaluate("fixture.menu.closeMenuImmediately()")
    page.evaluate("fixture.menu.flushPendingStorageEntries()")
    boot()
    check("Actual settings survive page reload", "() => fixture.menu.advancedSettings && fixture.menu.brightness===85")
    assert not errors, errors
    passed.append("No page runtime errors")
    (OUT / "results.json").write_text(json.dumps({"passed":passed,"errors":errors}, indent=2), encoding="utf-8")
    print(json.dumps({"checks":len(passed),"output":str(OUT),"passed":passed}, indent=2))
    browser.close()
