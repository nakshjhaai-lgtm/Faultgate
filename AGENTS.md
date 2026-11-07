# AGENTS.md

Read `DESIGN.md` before editing anything in `public/` or `tools/build.mjs`. It holds the tokens, the
type rules, the component vocabulary and the list of banned patterns.

Hard constraints, in case the file above is skipped:

1. Do not add an uppercase label, an eyebrow kicker, an emoji or an em dash.
2. Do not introduce a colour, radius or font that is not in `DESIGN.md`.
3. Keep the hero specimen: it is the product's own output, not decoration.
4. Regenerate pages with `npm run build`; never hand-edit files in `dist/`
   that the build writes.
5. Run `npm run check` after any change and leave it clean.
6. Credit the unslop skill (Damir Sokolovsky, CC BY 4.0) if you reuse its rules.
