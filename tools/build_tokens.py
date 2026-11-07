#!/usr/bin/env python3
"""Export the design tokens from public/style.css as CSS and JSON.

The stylesheet is the single source of truth. This script only reads it, so the
exports cannot drift from what the browser actually renders.
"""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "public" / "style.css"
OUT = ROOT / "tokens"

VAR = re.compile(r"(--[a-z0-9-]+)\s*:\s*([^;]+);")


def block(text, start_marker, from_index=0):
    """Return the body of the first `{...}` following start_marker."""
    i = text.index(start_marker, from_index)
    depth = 0
    j = text.index("{", i)
    k = j
    while True:
        if text[k] == "{":
            depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0:
                return text[j + 1 : k]
        k += 1


def pairs(body):
    out = {}
    for name, value in VAR.findall(body):
        out[name] = " ".join(value.split())
    return out


def main():
    css = CSS.read_text()

    light = pairs(block(css, ":root {"))

    media = pairs(block(css, "@media (prefers-color-scheme: dark)"))
    forced = pairs(block(css, ":root[data-theme='dark']"))
    shared = set(media.items()) & set(forced.items())
    if len(shared) != len(media) or len(shared) != len(forced):
        print("warning: the two dark blocks disagree; using the forced one")
    dark = forced or media

    # The dark blocks override colour only. Type, spacing, radius and motion are
    # mode-independent, so they are declared once in the base block.
    unknown = sorted(set(dark) - set(light))
    if unknown:
        raise SystemExit(f"dark block declares tokens absent from :root: {unknown}")
    resolved_dark = {**light, **dark}

    OUT.mkdir(exist_ok=True)

    def declare(tokens, indent="  "):
        return "\n".join(f"{indent}{k}: {v};" for k, v in tokens.items())

    parts = [
        "/* FaultGate design tokens.",
        "   Generated from public/style.css by tools/build_tokens.py. Do not edit by hand. */",
        "",
        ":root {",
        "  color-scheme: light dark;",
        declare(light),
        "}",
        "",
        "@media (prefers-color-scheme: dark) {",
        "  :root:not([data-theme='light']) {",
        declare(dark, "    "),
        "  }",
        "}",
        "",
        ":root[data-theme='dark'] {",
        declare(dark),
        "}",
        "",
    ]
    (OUT / "tokens.css").write_text("\n".join(parts))

    doc = {
        "meta": {
            "name": "FaultGate",
            "generated": str(date.today()),
            "source": "public/style.css",
            "count": len(light),
            "overridden_in_dark": len(dark),
            "note": "light is the base set; dark is light with the colour overrides applied.",
        },
        "light": light,
        "dark": resolved_dark,
        "dark_overrides": dark,
    }
    (OUT / "tokens.json").write_text(json.dumps(doc, indent=2) + "\n")

    groups = {}
    for name in light:
        key = name.split("-")[2] if name.startswith("--") else "other"
        groups[key] = groups.get(key, 0) + 1
    print(f"tokens: {len(light)} total, {len(dark)} overridden in dark mode")
    print("groups:", ", ".join(f"{k} {v}" for k, v in sorted(groups.items())))
    for f in ("tokens.css", "tokens.json"):
        print(f"  {(OUT / f).relative_to(ROOT)}  {(OUT / f).stat().st_size} bytes")


if __name__ == "__main__":
    main()
