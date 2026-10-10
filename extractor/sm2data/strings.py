"""Localization tables (texts/strings_<lang>.str) and description rendering."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .pak import PakIndex

_LINE = re.compile(r'^(?P<key>[^\t]+)\t+"(?P<val>.*)"\s*$')
_KEY_OK = re.compile(r"^[A-Za-z0-9_.\-]+$")
_PLACEHOLDER = re.compile(r"\{STRING(\d*)\}")
_TAG = re.compile(r"\[(/?)(\w+)\]")


@dataclass
class StringTable:
    lang: str
    values: dict[str, str] = field(default_factory=dict)
    malformed: list[dict] = field(default_factory=list)  # lines whose key is not a valid identifier

    def get(self, key: str | None) -> str | None:
        return self.values.get(key) if key else None

    def recover(self, key: str) -> dict | None:
        """Guess the text for a missing ``*_DESC`` key from a malformed line.

        A known data bug replaces a DESC key with literal text, e.g.
        ``Rapid Recharge  "Reaching the maximum..."`` right after the matching
        ``..._NAME`` line. Returns the malformed entry if it fits that pattern.
        """
        if not key.endswith("_DESC"):
            return None
        name_key = key[: -len("_DESC")] + "_NAME"
        for bad in self.malformed:
            if bad["prev_key"] == name_key:
                return bad
        return None


def load_strings(pak: PakIndex, lang: str = "english") -> StringTable:
    raw = pak.read(f"texts/strings_{lang}.str").decode("utf-16")
    table = StringTable(lang)
    prev_key = None
    for lineno, line in enumerate(raw.splitlines(), 1):
        m = _LINE.match(line)
        if not m:
            continue
        key, val = m.group("key"), m.group("val")
        if not _KEY_OK.match(key):
            table.malformed.append({"line": lineno, "key": key, "text": val, "prev_key": prev_key})
        table.values[key] = val
        prev_key = key
    return table


def render_description(template: str, params: list[dict], presence: list[str] | None = None) -> dict:
    """Fill a localized template with perk parameters.

    Returns ``{"text": plain text, "parts": [...]}`` where parts is a list of
    ``{"t": "text"}``, ``{"v": "40%", "kind": "POSITIVE"|None}`` (parameter value),
    ``{"enemy": "MAJORIS"}`` (enemy tier icon) and ``{"tag": "majoris", "t": "Majoris"}``
    (styled run) so the UI can render values and icons like the game does.

    For enemy-presence perks, ``{STRING1}`` is the enemy tier icon and the
    regular parameters fill ``{STRING2}`` onward.
    """
    presence = presence or []
    values: dict[int, dict] = {}
    offset = 1
    if presence:
        values[1] = {"enemy": presence[0]}
        offset = 2
    for i, p in enumerate(params):
        values[i + offset] = p

    parts: list[dict] = []
    pos = 0
    style: str | None = None

    def emit_text(s: str) -> None:
        if not s:
            return
        if style:
            parts.append({"tag": style, "t": s})
        else:
            parts.append({"t": s})

    tokens = sorted(
        [(m.start(), m.end(), "ph", m) for m in _PLACEHOLDER.finditer(template)]
        + [(m.start(), m.end(), "tag", m) for m in _TAG.finditer(template)],
        key=lambda x: x[0],
    )
    for start, end, kind, m in tokens:
        emit_text(template[pos:start])
        pos = end
        if kind == "tag":
            style = None if m.group(1) else m.group(2)
            continue
        idx = int(m.group(1) or 1)
        val = values.get(idx)
        if val is None:
            parts.append({"v": m.group(0), "missing": True})
        elif "enemy" in val:
            parts.append(dict(val))
        else:
            parts.append({"v": val["text"], "kind": val.get("type")})
    emit_text(template[pos:])

    text = "".join(p.get("t") or p.get("v") or "" for p in parts)
    return {"text": re.sub(r"\s+", " ", text).strip(), "parts": parts}
