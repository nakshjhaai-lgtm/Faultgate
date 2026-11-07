# FaultGate — DESIGN.md

Machine-readable design reference for this repository. If you are an agent
editing this site, read this before changing a colour, a size, a radius or a
word. The values below are mirrored from `public/style.css`; change the token
there and this file follows.

## What this site is

A browser tool that checks a host vehicle's bus fault-protection table against a
payload or autonomy command envelope and reports the reachable states where both
documents are satisfied and the vehicle still cannot recover. The audience is
integration and systems engineers. The tone follows from that: exact, sober,
procedural. It is not a SaaS marketing page and must not drift into one.

## Character

`exact, sober, slightly severe`. The world is a mission-control console at 03:00
and the paper procedure taped beside it. If a decision would make the page
friendlier, it is probably the wrong decision.

## Colour

One neutral ramp tinted cold, one accent, one severity ramp that never borrows
from the accent. No hue-to-hue gradients, no glows, no coloured shadows, no
glass, no noise, no blobs.

| token | light | dark |
| --- | --- | --- |
| `--paper` | `#fbfbfa` | `#0c1012` |
| `--surface` | `#ffffff` | `#141b1e` |
| `--surface-2` | `#f3f5f5` | `#192225` |
| `--surface-3` | `#eaeeee` | `#1e272b` |
| `--ink` | `#0f1517` | `#e9eef0` |
| `--ink-2` | `#47555c` | `#a5b2b8` |
| `--ink-3` | `#5c6b73` | `#7e8c93` |
| `--rule` | `#d7dee1` | `#253035` |
| `--rule-soft` | `#e7ecee` | `#1b2327` |
| `--accent` | `#0d5c63` | `#6fb3b4` |
| `--accent-ink` | `#094a50` | `#8cc6c7` |
| `--accent-wash` | `#eef4f4` | `#12262a` |
| `--on-accent` | `#ffffff` | `#06222a` |
| `--critical` | `#8c1d18` | `#f08b85` |
| `--critical-wash` | `#fbeeed` | `#291412` |
| `--major` | `#6f4a08` | `#e0b46a` |
| `--major-wash` | `#fbf2e2` | `#2a2011` |
| `--minor` | `#3c4a52` | `#a9b6bc` |
| `--pass` | `#1c5533` | `#7fc39b` |
| `--pass-wash` | `#ebf3ee` | `#12251b` |

Rules:

- The accent covers a few percent of a screen: the primary action, the current
  nav item, the selected table.
- Severity is always a word plus a dot. Never colour alone.
- Muted text (`--ink-3`) is measured at 5.3:1 on paper and 5.0:1 on the second
  surface. Do not lighten it; it was already darkened once to pass WCAG AA.

## Type

- Interface: **Archivo** (400, 500, 600), self-hosted woff2, `font-display: swap`.
- Data and identifiers: **IBM Plex Mono** (400, 500).
- No third family. No script or display face. Inter and Geist are deliberately
  not used.

Scale: `--t-hero` clamp(2rem, 4.1vw, 2.875rem), `--t-h1` clamp(1.75rem, 2.6vw, 2.25rem),
`--t-h2` 1.25rem, `--t-h3` 1.0625rem, body 1rem/1.6, small 0.9375rem, micro 0.8125rem.

Rules:

- Headings 600. Body 400. Nothing at 700-900.
- **No uppercase prose labels.** Uppercase is reserved for identifiers that are
  uppercase in the data (`RADIO_OFF`, `BUS-FDIR-14`). `text-transform: uppercase`
  appears zero times in the stylesheet, on purpose.
- No letterspacing on labels. Heading tracking is -0.011em to -0.024em only.
- Prose max width 68ch. Numbers use tabular figures.
- Mono is a signal, not decoration: identifiers, guards, counts, traces.

## Space and shape

- 4px grid: 4, 8, 12, 16, 24, 32, 40, 48, 64, 96. No one-off values.
- Radii: `--r1` 3px for controls, `--r2` 6px for surfaces. Two values only.
  Nested radii subtract by the padding between them.
- Borders over shadows. There is exactly one shadow in the whole stylesheet, and
  it is the inset accent edge on the selected template card.
- Page shell max 1120px, padding 24 to 32.

## Components

- **Specimen** (hero, right column): one real finding from template A, laid out
  the way the verifier prints it. This is the site's single rich moment. Do not
  replace it with an illustration, a 3D render, a device mockup or a stock image.
- **Trace**: hairline spine, numbered nodes, mono text. The signature detail.
  It appears in the specimen and in every finding, and nowhere else.
- **Verdict bar**: 3px left rule carrying severity, label in words, figures in
  tabular digits, background at 6% severity tint.
- **Finding card**: 2px left edge carries severity; `BG-01` in mono; title in
  600; four labelled blocks inside.
- **Severity**: dot plus word, no pill, no border, no badge.
- Buttons: 44px tall, radius 3px, one primary per view. Never pills.

## Motion

- One easing curve, `cubic-bezier(0.2, 0, 0.1, 1)`, one duration, 140ms.
- Animate colour, border, opacity, transform. Never `transition: all`, never
  width, height, top or left.
- No pulsing, shimmer, parallax, scroll reveals, hover lift or entrance
  animation. The only retained animation is the run-button spinner, because it
  reports real state, and `prefers-reduced-motion` zeroes it.

## Copy

- Sentence case everywhere, including headings and buttons.
- No em dashes. No exclamation marks. No emoji, ever.
- No "seamless", "robust", "supercharge", "unlock", "transform your workflow".
- One negative-parallelism construction ("X, not Y") per page at most.
- Numbers must be traceable to the tables in `site/templates/` or to a run of the
  checker. Never invent a figure, a customer, a testimonial or a logo.
- State what the tool does not do, in plain words, on the page that claims the
  most.

## Things that are banned outright

Purple or indigo gradients. Glows. Glassmorphism, including a translucent
blurred header. Card-in-card nesting. Bento grids. Pills. Uppercase tracked
labels. Eyebrow kickers above headings. Emoji. Three feature cards with icons on
top. Star ratings. "Trusted by" logo walls. Fake dashboards. AI-generated
photography. Testimonials that nobody said. Placeholder copy. Animated grids.
Mouse-following spotlights.

## Known good state

- `npm run build` regenerates every page from `tools/build.mjs`.
- `tokens/tokens.css` and `tokens/tokens.json` carry the 45 tokens as CSS custom
  properties and as JSON; `notes/build_tokens.py` regenerates them from
  `public/style.css`.
- `npm run check` runs the build self-audit: titles, descriptions, headings,
  contrast tokens, CSP, dead links, prose tells.
- Every text pair in the token table is above 4.5:1.
