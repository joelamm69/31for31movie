#!/usr/bin/env python3
"""Build the blog from Markdown.

Each file in blog/_posts/ named YYYY-MM-DD-some-slug.md becomes
blog/posts/some-slug.html, and blog/index.html is rebuilt with every post,
newest first. Files starting with "_" (like _TEMPLATE.md) are skipped.

A post starts with a small header between --- lines:

    ---
    title: My post title
    summary: One sentence shown on the blog page.
    ---

The date comes from the file name. Everything after the header is the post,
written in Markdown (plain HTML is allowed too).

Run locally with:  pip install markdown && python3 scripts/build_blog.py
On GitHub this runs automatically (see .github/workflows/build-blog.yml).
"""
import datetime
import html
import pathlib
import re
import sys

import markdown

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from stamp_assets import stamp_file  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "blog" / "_posts"
OUT = ROOT / "blog" / "posts"
INDEX = ROOT / "blog" / "index.html"
NAME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-([a-z0-9-]+)\.md$")


def page(title, body, prefix):
    """Wrap body in the site's shared header/footer. prefix is the path back to the site root."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(title, quote=False)} — 31 for 31</title>
    <link rel="stylesheet" href="{prefix}assets/css/style.css">
</head>
<body>
    <div class="vhs-overlay"></div>
    <header class="site-header">
        <a href="{prefix}index.html" class="brand"><span class="b1">31</span><span class="b2">FOR</span><span class="b3">31</span></a>
        <nav class="site-nav">
            <a href="{prefix}index.html">Home</a>
            <a href="{prefix}lists.html">My Lists</a>
            <a href="{prefix}community.html">Community</a>
            <a href="{prefix}activity.html">Live Feed</a>
        </nav>
        <div class="nav-auth" id="nav-auth"></div>
    </header>

    <main>
{body}
    </main>

    <footer class="site-footer">
        <span>&copy; {datetime.date.today().year} 31 for 31. Made for horror fans.</span>
        <a href="{prefix}privacy.html">Privacy</a>
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="{prefix}assets/js/config.js"></script>
    <script src="{prefix}assets/js/supabase-client.js"></script>
    <script src="{prefix}assets/js/auth.js"></script>
</body>
</html>
"""


def parse(path):
    m = NAME_RE.match(path.name)
    if not m:
        sys.exit(f"{path.name}: file name must look like 2026-10-31-my-post-title.md "
                 "(date, then lowercase words joined by dashes)")
    date = datetime.date(int(m[1]), int(m[2]), int(m[3]))
    text = path.read_text(encoding="utf-8")
    hm = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not hm:
        sys.exit(f"{path.name}: missing the --- header with title and summary at the top")
    meta = {}
    for line in hm[1].splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip().lower()] = v.strip()
    if not meta.get("title"):
        sys.exit(f"{path.name}: the header needs a 'title:' line")
    body_html = markdown.markdown(text[hm.end():], extensions=["extra", "sane_lists"])
    return {
        "slug": m[4],
        "date": date,
        "title": meta["title"],
        "summary": meta.get("summary", ""),
        "html": body_html,
    }


def nice_date(d):
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def main():
    posts = [parse(p) for p in sorted(SRC.glob("*.md")) if not p.name.startswith("_")]
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)

    OUT.mkdir(parents=True, exist_ok=True)
    wanted = set()
    for p in posts:
        indented = "\n".join("            " + l if l else l for l in p["html"].splitlines())
        body = f"""        <article class="blog-post">
            <h1>{html.escape(p['title'], quote=False)}</h1>
            <div class="date">{nice_date(p['date'])}</div>
{indented}
        </article>"""
        name = f"{p['slug']}.html"
        wanted.add(name)
        (OUT / name).write_text(page(p["title"], body, "../../"), encoding="utf-8")

    # Remove pages whose Markdown file was deleted, so the blog matches _posts/.
    for old in OUT.glob("*.html"):
        if old.name not in wanted:
            old.unlink()

    items = []
    for p in posts:
        url = f"posts/{p['slug']}.html"
        items.append(f"""            <article class="blog-list-item">
                <div class="date">{nice_date(p['date'])}</div>
                <h2><a href="{url}">{html.escape(p['title'], quote=False)}</a></h2>
                <p>{html.escape(p['summary'], quote=False)}</p>
                <a href="{url}">Read more &rarr;</a>
            </article>""")
    body = """        <div class="section-heading">
            <h1>Blog</h1>
        </div>
        <div class="blog-list">
""" + "\n".join(items) + """
        </div>"""
    INDEX.write_text(page("Blog", body, "../"), encoding="utf-8")

    # Version the CSS/JS links so a deploy never serves stale cached files.
    for built in [INDEX, *OUT.glob("*.html")]:
        stamp_file(built)
    print(f"Built {len(posts)} post(s).")


if __name__ == "__main__":
    main()
