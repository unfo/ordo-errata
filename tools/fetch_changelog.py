"""Fetch official Space Marine 2 patch notes from Steam and save them as changelogs/*.md.

Usage:
  uv run tools/fetch_changelog.py --list                      # recent official patch/hotfix posts
  uv run tools/fetch_changelog.py "Hotfix 15.1"               # by title (substring)
  uv run tools/fetch_changelog.py https://store.steampowered.com/news/app/2183900/view/710037059469836892
  uv run tools/fetch_changelog.py 1846018067928881            # by Steam news API id
  options: --out DIR (default changelogs/), --force to overwrite, --stdout

Uses the public Steam news API (no login). Posts are BBCode; they are converted to the
markdown shape the site's changelog parser expects (#/## headings, **bold** sub-headings,
"- " bullets) with front matter linking the official post.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

APP_ID = 2183900
ROOT = Path(__file__).resolve().parent.parent
API = f"https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={APP_ID}&count=100&maxlength=0&format=json&feeds=steam_community_announcements"
UA = {"User-Agent": "sm2-patch-helper (fan tool)"}
PATCH_TITLE = re.compile(r"\b(patch|hotfix)\b", re.I)


def http_get(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def resolve_redirect(url: str) -> str:
    """The API's post url redirects to the public announcement page; return that."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.geturl()
    except Exception:
        return url


def news() -> list[dict]:
    return json.loads(http_get(API))["appnews"]["newsitems"]


def page_title(url: str) -> str:
    """Title of a Steam store/community post page, without the site prefix/suffix."""
    m = re.search(r"<title>([^<]*)</title>", http_get(url))
    t = html.unescape(m.group(1)) if m else ""
    t = re.sub(r"^Steam :: [^:]+:: ", "", t)  # community: "Steam :: Game :: Title"
    t = re.sub(r"^.*? - (.*) - Steam News$", r"\1", t)  # store: "Game - Title - Steam News"
    return t.strip()


def find_post(query: str, items: list[dict]) -> dict:
    if re.fullmatch(r"\d{10,17}", query):
        hits = [n for n in items if n["gid"] == query]
    else:
        title = page_title(query) if query.startswith("http") else query
        hits = [n for n in items if title.lower() in n["title"].lower()]
    if not hits:
        raise SystemExit(f"no Steam post matches {query!r}; try --list")
    return hits[0]


# ----------------------------------------------------------------------------- BBCode -> markdown

_TAG = re.compile(r"\[(/?)([a-z0-9*]+)(?:[ =]([^\]]*))?\]", re.I)


def bbcode_to_markdown(src: str) -> str:
    src = src.replace("​", "").replace("\r", "")
    out: list[str] = []
    line: list[str] = []
    lists: list[list[int]] = []  # stack of [is_ordered, counter]
    heading = ""
    link: list[str] = []
    skip = 0  # inside [img]...[/img]

    def flush() -> None:
        raw = "".join(line)
        text = re.sub(r"[ \t]+", " ", raw).strip()
        if re.match(r" +(?:-|\d+\.) ", raw):  # keep a nested list item's indentation
            text = raw[: len(raw) - len(raw.lstrip(" "))] + text
        line.clear()
        if not text:
            return
        out.append(text)

    pos = 0
    for m in _TAG.finditer(src):
        if not skip:
            line.append(src[pos : m.start()])
        pos = m.end()
        closing, tag, arg = m.group(1) == "/", m.group(2).lower(), m.group(3)
        if tag == "img":
            skip = 0 if closing else 1
            continue
        if skip:
            continue
        if tag in ("h1", "h2", "h3"):
            if closing:
                text = re.sub(r"\*\*(.*?)\*\*", r"\1", "".join(line)).strip()
                line.clear()
                if text:
                    out.append("")
                    out.append(f"{'#' * int(tag[1])} {text}")
                    out.append("")
                heading = ""
            else:
                flush()
                heading = tag
        elif tag == "p":
            if closing:
                flush()
            else:
                if not lists:
                    flush()
        elif tag in ("list", "olist"):
            flush()
            if closing:
                if lists:
                    lists.pop()
                if not lists:
                    out.append("")
            else:
                lists.append([tag == "olist", 0])
        elif tag == "*":
            if not closing:
                flush()
                depth = max(len(lists), 1)
                if lists and lists[-1][0]:
                    lists[-1][1] += 1
                    line.append("    " * (depth - 1) + f"{lists[-1][1]}. ")
                else:
                    line.append("    " * (depth - 1) + "- ")
            else:
                flush()
        elif tag == "b":
            line.append("**")
        elif tag == "i":
            line.append("*")
        elif tag == "strike":
            line.append("~~")
        elif tag == "url":
            # Link text is collected after a \x00 marker, then wrapped as [text](href).
            if not closing:
                link.append((arg or "").strip("\"'"))
                line.append("\x00")
            else:
                href = link.pop() if link else ""
                joined = "".join(line)
                start = joined.rfind("\x00")
                label = joined[start + 1 :] if start >= 0 else ""
                line[:] = [joined[: max(start, 0)], f"[{label}]({href})" if href and label else label]
        elif tag == "hr":
            flush()
        elif tag == "quote":
            flush()
        # other tags (u, spoiler, table...) are dropped, keeping their text
    if not skip:
        line.append(src[pos:])
    flush()

    md = "\n".join(out)
    md = re.sub(r"\*\*\s*\*\*", "", md)  # empty bold
    md = re.sub(r"(?m)^(\s*(?:-|\d+\.) )\s+", r"\1", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


def changelog_id(title: str) -> str | None:
    """'Hotfix 15.1 Patch Notes' -> '15.1-hotfix'; 'Patch Notes 14.0' / 'Patch 15.0' -> '<v>-patch'."""
    m = re.search(r"\b(\d+(?:\.\d+)*)\b", title)
    if not m:
        return None
    version = m.group(1) if "." in m.group(1) else f"{m.group(1)}.0"
    kind = "hotfix" if re.search(r"hotfix", title, re.I) else "patch"
    return f"{version}-{kind}"


def render(post: dict) -> str:
    source = resolve_redirect(post["url"])
    date = datetime.fromtimestamp(post["date"], tz=timezone.utc).date().isoformat()
    front = f"---\nsource: {source}\ntitle: {post['title']}\ndate: {date}\nsteam_news_gid: {post['gid']}\n---\n"
    return front + bbcode_to_markdown(post["contents"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", nargs="?", help="Steam post URL, news id, or title substring")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "changelogs")
    ap.add_argument("--force", action="store_true", help="overwrite an existing changelog file")
    ap.add_argument("--stdout", action="store_true")
    args = ap.parse_args()

    items = news()
    if args.list or not args.query:
        for n in items:
            if PATCH_TITLE.search(n["title"]):
                date = datetime.fromtimestamp(n["date"], tz=timezone.utc).date()
                print(f"{n['gid']}  {date}  {changelog_id(n['title']) or '?':14} {n['title']}")
        return 0

    post = find_post(args.query, items)
    text = render(post)
    if args.stdout:
        sys.stdout.write(text)
        return 0
    cid = changelog_id(post["title"]) or f"steam-{post['gid']}"
    target = args.out / f"{cid}.md"
    if target.exists() and not args.force:
        print(f"{target} exists; use --force to overwrite (or --stdout to compare)")
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    print(f"wrote {target} from '{post['title']}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
