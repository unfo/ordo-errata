"""Parser for Swarm engine "SSL" text data files (.sso, .cls, .prop ...).

The format is a nested key/value notation:

    key   =   "string"
    flag   =   True
    obj   =   {
       nested   =   12.5
       __type   =   "TypeName"
    }
    list   =   [
       "a",
       { x   =   1 }
    ]

Embedded script blocks (``#ssl_begin`` ... ``#ssl_end``) are skipped.

Objects parse to dicts (insertion ordered, ``__type`` kept as a regular key),
lists to lists, ``True``/``False`` to bools, numerics to int/float and any other
bare word to str.
"""

from __future__ import annotations

import re
from typing import Any

_TOKEN = re.compile(
    r"""
    \s*(?:
        "(?P<str>(?:[^"\\]|\\.)*)"     # quoted string
      | (?P<punct>[{}\[\],=])          # structure
      | (?P<word>[^\s{}\[\],="]+)      # bare word / number / key
    )
    """,
    re.VERBOSE,
)
_SCRIPT_BLOCK = re.compile(r"^[ \t]*#ssl_begin\b.*?^[ \t]*#ssl_end[^\n]*$", re.DOTALL | re.MULTILINE)
_INT = re.compile(r"[+-]?\d+\Z")
_FLOAT = re.compile(r"[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?\Z")


class SslParseError(ValueError):
    pass


def _tokens(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    pos, end = 0, len(text)
    while pos < end:
        m = _TOKEN.match(text, pos)
        if not m:
            if text[pos:].strip() == "":
                break
            raise SslParseError(f"unexpected input at offset {pos}: {text[pos:pos + 40]!r}")
        pos = m.end()
        if m.group("str") is not None:
            out.append(("str", _unescape(m.group("str"))))
        elif m.group("punct"):
            out.append(("punct", m.group("punct")))
        elif m.group("word"):
            out.append(("word", m.group("word")))
    return out


def _unescape(s: str) -> str:
    if "\\" not in s:
        return s
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), s)


def _scalar(word: str) -> Any:
    if word == "True":
        return True
    if word == "False":
        return False
    if _INT.match(word):
        return int(word)
    if _FLOAT.match(word):
        return float(word)
    return word


class _Parser:
    def __init__(self, toks: list[tuple[str, str]]):
        self.toks = toks
        self.i = 0

    def peek(self) -> tuple[str, str] | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self) -> tuple[str, str]:
        if self.i >= len(self.toks):
            raise SslParseError("unexpected end of input")
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def value(self) -> Any:
        kind, v = self.take()
        if kind == "punct":
            if v == "{":
                return self.obj("}")
            if v == "[":
                return self.lst()
            raise SslParseError(f"unexpected {v!r} at token {self.i}")
        return v if kind == "str" else _scalar(v)

    def lst(self) -> list[Any]:
        out: list[Any] = []
        while True:
            tok = self.peek()
            if tok is None:
                raise SslParseError("unterminated list")
            if tok == ("punct", "]"):
                self.i += 1
                return out
            if tok == ("punct", ","):
                self.i += 1
                continue
            out.append(self.value())

    def obj(self, end: str | None) -> dict[str, Any]:
        out: dict[str, Any] = {}
        while True:
            tok = self.peek()
            if tok is None:
                if end is None:
                    return out
                raise SslParseError("unterminated object")
            if tok == ("punct", end):
                self.i += 1
                return out
            if tok == ("punct", ","):
                self.i += 1
                continue
            kind, key = self.take()
            if kind == "punct":
                raise SslParseError(f"expected key, got {key!r} at token {self.i}")
            if self.take() != ("punct", "="):
                raise SslParseError(f"expected '=' after key {key!r}")
            out[key] = self.value()


def loads(text: str | bytes) -> dict[str, Any]:
    if isinstance(text, bytes):
        text = text.decode("utf-8-sig")
    text = _SCRIPT_BLOCK.sub("", text)
    return _Parser(_tokens(text)).obj(None)
