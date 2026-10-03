import json, os, shutil, time
from playwright.sync_api import sync_playwright

ROOT = r"C:\Users\hh121\Desktop\aipro\yt32"
EXT = os.path.join(ROOT, "_tools", "bili-probe")
PROFILE = os.path.join(ROOT, "_pwprofile_probe")
DL = os.path.join(ROOT, "_probe_downloads")
URL = "https://www.bilibili.com/video/BV1Q7aq6MEpc/"


def seed_profile():
    shutil.rmtree(PROFILE, ignore_errors=True)
    shutil.rmtree(DL, ignore_errors=True)
    os.makedirs(os.path.join(PROFILE, "Default"), exist_ok=True)
    os.makedirs(DL, exist_ok=True)
    prefs = {
        "download": {
            "default_directory": DL,
            "prompt_for_download": False,
            "directory_upgrade": True,
        },
        "savefile": {"default_directory": DL},
        "profile": {"default_content_setting_values": {"automatic_downloads": 1}},
    }
    with open(os.path.join(PROFILE, "Default", "Preferences"), "w", encoding="utf-8") as fh:
        json.dump(prefs, fh)


def main():
    seed_profile()
    args = [
        f"--disable-extensions-except={EXT}",
        f"--load-extension={EXT}",
        "--disable-blink-features=AutomationControlled",
        "--window-position=-32000,-32000",
        "--window-size=1400,900",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, headless=False, args=args, viewport={"width": 1400, "height": 900}
        )
        time.sleep(3)
        workers = [w.url for w in ctx.service_workers]
        print("SERVICE_WORKERS:", json.dumps(workers))

        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        errors = []
        console = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        page.on(
            "console",
            lambda m: console.append(f"[{m.type}] {m.text[:400]}")
            if "PROBE" in m.text
            else None,
        )
        page.goto(URL, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(6000)

        button = page.locator('button[data-kind="attach"]')
        try:
            button.wait_for(state="visible", timeout=20000)
            print("BUTTON_VISIBLE: True")
        except Exception as exc:
            print("BUTTON_VISIBLE: False", str(exc)[:200])
            print("PAGE_ERRORS:", json.dumps(errors))
            print("CONSOLE:", json.dumps(console, ensure_ascii=False))
            ctx.close()
            return

        button.click()
        print("CLICKED")
        page.wait_for_timeout(14000)
        status = page.locator(".status")
        try:
            print("STATUS:", status.inner_text(timeout=3000))
        except Exception as exc:
            print("STATUS_ERR:", str(exc)[:160])

        print("PAGE_ERRORS:", json.dumps(errors))
        print("CONSOLE:", json.dumps(console, ensure_ascii=False))
        ctx.close()

    files = []
    for base, _dirs, names in os.walk(DL):
        for name in names:
            path = os.path.join(base, name)
            files.append((os.path.relpath(path, DL), os.path.getsize(path)))
    print("DOWNLOADED:", json.dumps(files, ensure_ascii=False, indent=2))

    captured = os.path.join(ROOT, "_tools", "probe-captures")
    landed = []
    if os.path.isdir(captured):
        for name in sorted(os.listdir(captured)):
            path = os.path.join(captured, name)
            landed.append((name, os.path.getsize(path)))
    print("LOOPBACK_CAPTURES:", json.dumps(landed, ensure_ascii=False))


if __name__ == "__main__":
    main()
