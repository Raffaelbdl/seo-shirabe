# Fixtures

Synthetic HTML reproducing the pages of the myanimetrip audit (handover §9).
They are hand-written from the audit notes, not copies of the real pages:
the dev container cannot reach those sites. Placeholders such as
`{{NG_STATE:880000}}` are expanded by `tests/helpers/fixtures.ts` so the repo
does not carry megabytes of filler.

`real/` (git-ignored) holds the real pages fetched with
`pnpm fixtures:fetch`; `tests/unit/real.test.ts` runs against them when present.
