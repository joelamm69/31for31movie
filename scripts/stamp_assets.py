"""Add a content fingerprint to every local script/stylesheet link.

    <script src="assets/js/auth.js">  ->  <script src="assets/js/auth.js?v=3f9a12c0">

The ?v= value is a short hash of the file's contents, so it changes only when
that file changes. Browsers and Hostinger's CDN treat a new ?v= as a new file
and fetch it, instead of serving a stale cached copy after a deploy.

Run from the repo root:  python3 scripts/stamp_assets.py
The "Stamp asset versions" GitHub Action runs this on every push to main,
and build_blog.py stamps the blog pages it writes.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# src="..." or href="..." pointing at a local assets/ js or css file,
# optionally already carrying a ?v= stamp.
ASSET_REF = re.compile(
    r'(?P<attr>\b(?:src|href)=")(?P<path>(?:\.\./)*assets/(?:js|css)/[^"?#]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"'
)


def fingerprint(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()[:8]


def stamp_html(html: str, html_dir: Path) -> str:
    def replace(m: re.Match) -> str:
        target = (html_dir / m["path"]).resolve()
        if not target.is_file():
            # e.g. tmdb-config.js, which only exists on the host: leave as is.
            return m.group(0)
        return f'{m["attr"]}{m["path"]}?v={fingerprint(target)}"'

    return ASSET_REF.sub(replace, html)


def stamp_file(path: Path) -> bool:
    """Stamp one HTML file in place. Returns True if it changed."""
    original = path.read_text(encoding="utf-8")
    stamped = stamp_html(original, path.parent)
    if stamped != original:
        path.write_text(stamped, encoding="utf-8")
        return True
    return False


def html_files():
    for path in sorted(ROOT.rglob("*.html")):
        rel = path.relative_to(ROOT)
        if rel.parts[0] in {".git", "node_modules"}:
            continue
        yield path


def main() -> int:
    changed = [p.relative_to(ROOT) for p in html_files() if stamp_file(p)]
    for p in changed:
        print(f"stamped {p}")
    if not changed:
        print("All asset links already up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
