"""Builds demo/index.html from ui/index.html.

    python flip/demo/sync.py

The demo is the real interface with a fake backend (mock.js) instead of Tauri,
so it runs in any browser. This script only rewrites the asset paths to point at
../ui and drops the mock in front of the app scripts; rerun it after changing
ui/index.html. Everything else comes straight from the app.
"""

from pathlib import Path
import re

here = Path(__file__).resolve().parent
ui = here.parent / "ui"

html = (ui / "index.html").read_text(encoding="utf-8")
html = re.sub(r'(href|src)="([\w.-]+\.(?:css|js))"', r'\1="../ui/\2"', html)
html = html.replace(
    '<script src="../ui/i18n.js" defer></script>',
    '<script src="mock.js" defer></script>\n  <script src="../ui/i18n.js" defer></script>',
)

(here / "index.html").write_text(html, encoding="utf-8")
print("demo/index.html written from ui/index.html")
