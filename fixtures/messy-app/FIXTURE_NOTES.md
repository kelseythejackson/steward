# messy-app: planted inconsistencies

This is the Steward test target. It is a small React + Tailwind app
("Acme Metrics": Dashboard, Settings and Billing pages) written to look like
a startup codebase that has drifted for a year. Every inconsistency below is
deliberate. Tests in `packages/*` assert against the tables in this file, so
**update this file whenever you change the fixture**.

Counts were taken with `grep -ohE '#[0-9a-f]{6}\b' -r src` and similar. A hex
value appearing in a `hover:` class counts once per occurrence, the same as
the scanner will see it. Colors in `tailwind.config.ts` are **definitions**,
not uses, and are listed separately below.

The color tables are machine-read by `packages/scanner` tests: keep the
first two columns as `` `#hex` `` and a plain number.

It typechecks (`pnpm -F @steward/fixture-messy-app typecheck`) but is not
meant to be run. There is no bundler and `/logo.svg` does not exist.

## 1. Colors

### Grays (14 distinct, plus white)

| Hex       | Uses | Where                                                   | Role in the drift                                    |
|-----------|-----:|---------------------------------------------------------|------------------------------------------------------|
| `#9ca3af` |   12 | App, Card, Panel, Modal, TextField, Dashboard, Settings, Billing, styles.css `body` | **Most used gray. Body text. 2.54:1 on white, fails AA 4.5:1.** |
| `#6b7280` |    8 | Button, Modal, Dialog, Navbar, Dashboard, Billing        | Secondary text. Also defined as `muted` in config.   |
| `#374151` |    9 | Button, TextField, Settings, Billing, styles.css `td`    | Labels and headings                                  |
| `#1f2937` |    7 | Panel, Dialog, Button, Modal, Navbar, Billing            | Hover text and dark headings. Also defined as `ink` in config. |
| `#111827` |    8 | Card, Modal, TextField, Navbar, Dashboard, Settings, Billing | Headings                                         |
| `#e5e7eb` |    4 | Card, Navbar, Billing, styles.css `td`                   | Borders                                              |
| `#f3f4f6` |    3 | Button, Dashboard, Billing                               | Subtle backgrounds                                   |
| `#e4e4e7` |    3 | Panel, Settings, styles.css `th`                         | Near-duplicate of `#e5e7eb`                          |
| `#d1d5db` |    3 | Button, TextField, Dashboard                             | Input borders                                        |
| `#6b7380` |    3 | Dialog, Dashboard, styles.css `th`                       | Near-duplicate of `#6b7280` (one digit off)          |
| `#334155` |    1 | Settings "Danger zone" heading                           | Near-duplicate of `#374151` (slate vs gray)          |
| `#f4f4f5` |    1 | styles.css `.sidebar`                                    | Near-duplicate of `#f3f4f6`                          |
| `#f9fafb` |    1 | App page background                                      | Page background                                      |
| `#fafafa` |    1 | styles.css `body`                                        | Near-duplicate of `#f9fafb`                          |
| `#ffffff` |    1 | styles.css `.badge-blue`                                 | White, as a raw hex instead of `text-white`          |

Expected merges (near-duplicate pairs the scanner should suggest):

- `#6b7380` → `#6b7280`
- `#e4e4e7` → `#e5e7eb`
- `#f4f4f5` → `#f3f4f6`
- `#fafafa` → `#f9fafb`
- `#334155` → `#374151`

A sensible merged scale is around six grays.

### Blues (3 near-identical, plus one distinct)

| Hex       | Uses | Where                                                    |
|-----------|-----:|----------------------------------------------------------|
| `#3b82f6` |    7 | Button primary, CTAButton hover, TextField focus, Navbar active, Billing link, Billing usage bar (inline style), styles.css `.badge-blue` |
| `#3a81f5` |    3 | PrimaryBtn, Dashboard "Extend trial", styles.css `a`      |
| `#3b83f7` |    2 | CTAButton, styles.css `a:hover`                           |
| `#2563eb` |    1 | Button primary hover. Also defined as `brand` in config.  |

Expected merge: `#3a81f5` and `#3b83f7` → `#3b82f6`. `#2563eb` is a real
darker shade and should stay separate.

Contrast note: white text on any of the three blues is about 3.7:1, which
passes AA for large text and UI components but fails 4.5:1 for normal text.
All three button components use white text on blue at `text-sm`.

### Tailwind theme colors nobody uses consistently

`tailwind.config.ts` defines `brand`, `ink` and `muted`. No component uses
the `bg-brand`, `text-ink` or `text-muted` classes. The same hex values are
pasted as arbitrary values instead.

| Definition | Hex       | Config line |
|------------|-----------|------------:|
| `brand`    | `#2563eb` |          10 |
| `ink`      | `#1f2937` |          11 |
| `muted`    | `#6b7280` |          12 |

### Where colors hide (extraction coverage)

| Form                                   | Example in the fixture                                   |
|----------------------------------------|----------------------------------------------------------|
| Plain `className` string               | most components                                          |
| Template literal `className`           | `Card.tsx`, `TextField.tsx`, `PrimaryBtn.tsx`            |
| Class strings in a variable or map     | `Button.tsx` `variants`, `CTAButton.tsx` `base`          |
| `cn()` call with object keys           | `Navbar.tsx` active and inactive link classes            |
| Inline `style={{ ... }}` object        | `Billing.tsx` usage bar, `backgroundColor: "#3b82f6"`    |
| CSS file                               | `src/styles.css`                                         |
| Tailwind config (definition, not use)  | `tailwind.config.ts`                                     |

## 2. Spacing off the scale

Tailwind arbitrary values in TSX:

| Class        | Uses | Nearest scale value                      |
|--------------|-----:|------------------------------------------|
| `gap-[10px]` |    7 | `gap-2.5` (10px) exists; or `gap-2`/`gap-3` |
| `mt-[7px]`   |    5 | `mt-2` (8px)                             |
| `mt-[22px]`  |    4 | `mt-6` (24px) or `mt-5` (20px)           |
| `px-[18px]`  |    3 | `px-4` (16px) or `px-5` (20px)           |
| `p-[13px]`   |    2 | `p-3` (12px)                             |
| `mb-[7px]`   |    2 | `mb-2` (8px)                             |
| `py-[9px]`   |    1 | `py-2` (8px)                             |
| `py-[13px]`  |    1 | `py-3` (12px)                            |
| `h-[42px]`   |    1 | `h-10` (40px) or `h-11` (44px)           |

The Billing usage bar sets its width with an inline style (`width: `${usagePct}%``), which is dynamic and should **not** be flagged as spacing drift.

Raw CSS in `src/styles.css`: `padding: 9px 13px`, `padding: 11px 13px`,
`padding: 2px 7px`, `width: 302px`.

`h-[42px]` and `width: 302px` are sizes, not spacing: the scanner lists them
but doesn't snap them to the spacing scale. Expected snaps on the default
scale (4, 8, 12, 16, 24, 32, 48, 64; halfway values round up): 2→4, 7/9→8,
10/11/13→12, 18→16, 20/22→24, 28→32.

## 3. Duplicate components

### Three buttons doing the same job

| Component    | File                           | API differences                                             |
|--------------|--------------------------------|-------------------------------------------------------------|
| `Button`     | `src/components/Button.tsx`    | The "official" one. `variant` prop, spreads button attributes, `type="button"`. |
| `PrimaryBtn` | `src/components/PrimaryBtn.tsx`| `label` prop instead of children, `fullWidth`, no `type` attribute, different blue and padding. |
| `CTAButton`  | `src/components/CTAButton.tsx` | `size` prop, pill shape, renders `<a>` when `href` is set, third blue. |

Expected suggestion: merge `PrimaryBtn` and `CTAButton` into `Button`.

### Card and Panel

`src/components/Card.tsx` and `src/components/Panel.tsx` are the same
container with different radius (`rounded-lg` vs `rounded-xl`), padding
(`p-6` vs `p-[13px]`), border gray and heading prop name (`title` vs
`heading`). Expected suggestion: merge.

### Modal and Dialog (similar look, different behaviour)

`src/components/Modal.tsx` and `src/components/Dialog.tsx` share a centered
white panel over a dark backdrop, but:

- Modal closes on backdrop click and Escape, has no focus trap, no `role="dialog"`.
- Dialog traps focus, sets `role="dialog"` and `aria-modal`, and can only be closed via its own buttons.

These are a **judgement call**, not a clear duplicate. The scanner may surface
them as "similar"; it should not auto-suggest a merge with the same confidence
as Card/Panel. Useful for testing how suggestions explain their confidence.

## 4. Raw `<button>` elements

Places where a `Button` should have been used (excluding the three button
components themselves):

| File                           | Line | What it is                                          |
|--------------------------------|-----:|-----------------------------------------------------|
| `src/pages/Dashboard.tsx`      |   74 | "Extend trial" inline link-style button, no `type`  |
| `src/pages/Settings.tsx`       |   43 | "Delete workspace" danger button, no `type`         |
| `src/pages/Billing.tsx`        |   74 | "Download all invoices" ghost-style button          |
| `src/components/Navbar.tsx`    |   26 | Navigation items rendered as raw buttons            |
| `src/components/Modal.tsx`     |   34 | Icon-only close button (also an a11y failure, below)|

Line numbers are correct as of this commit; tests should prefer matching on
file plus a distinctive attribute over exact line numbers.

## 5. Accessibility problems

| Rule                                   | File                          | Line | Detail                                                                 |
|----------------------------------------|-------------------------------|-----:|------------------------------------------------------------------------|
| Body text contrast                     | many, see grays table         |      | `#9ca3af` on white is 2.54:1. Needs 4.5:1. Nearest passing gray in the same family: `#6b7280` at 4.83:1. |
| Button text contrast (secondary)       | Button, PrimaryBtn, CTAButton |      | White on `#3b82f6` is 3.68:1 at `text-sm`. Passes 3:1 for UI, fails 4.5:1 for normal text. |
| `<img>` without `alt`                  | `src/components/Navbar.tsx`   |   20 | Logo image has `src`, `width`, `height`, no `alt`.                     |
| Icon-only button with no accessible name | `src/components/Modal.tsx`  |   34 | Close button contains only an inline SVG. No `aria-label`, no text.    |
| `<input>` without a label              | `src/pages/Dashboard.tsx`     |   22 | Search input has a `placeholder` but no `<label>`, `aria-label` or `aria-labelledby`. |
| Click handler on non-interactive element | `src/pages/Billing.tsx`     |   59 | `<div onClick>` used to select an invoice. No `role`, `tabIndex` or key handler. |
| Focus outline removed, no replacement  | `src/components/TextField.tsx`|   18 | `outline-none` with only `focus:border-[#3b82f6]`. Border color change alone is not a sufficient focus indicator. |
| Focus outline removed, no replacement  | `src/styles.css`              |   40 | `.legacy-input:focus { outline: none; }` with nothing else. Applied to the Dashboard search input. |

Things that are **correct** and must not be flagged (negative test cases):

- `src/components/TextField.tsx` renders a real `<label htmlFor>` when `label` is given. Both uses in Settings pass `id` and `label`.
- `src/pages/Settings.tsx` checkbox inputs are wrapped in `<label>`.
- `src/components/Dialog.tsx` has `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at a real id.
- `src/components/Button.tsx` and `src/components/CTAButton.tsx` set `type="button"`.
- Navbar links have visible text content, so they do have an accessible name even though they are raw buttons.

## 5b. Contrast pairs (colors actually used together)

Machine-read by `packages/scanner` contrast tests: keep the first three
columns as `` `#fg` ``, `` `#bg` `` and the expected fix `` `#hex` ``.
Colors are the **token** values after the expected merges (so `#3a81f5` and
`#3b83f7` count as `#3b82f6`, `#fafafa` as `#f9fafb`). Where no background
is set in the same file, white is assumed. Lines point at the element's `className`
attribute (or the element itself when it has none). Ratios computed with culori's
`wcagContrast`.

Pairs that fail WCAG AA (every one should get a contrast suggestion):

| Foreground | Background | Fix       | Use        | Ratio  | Where (file:line)                                                                                                                                                   |
|------------|------------|-----------|------------|-------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `#9ca3af`  | `#ffffff`  | `#6b7280` | text       | 2.54:1 | Card.tsx:13, Panel.tsx:13, TextField.tsx:21, Modal.tsx:34 (icon), Dashboard.tsx:40, Dashboard.tsx:49, Dashboard.tsx:53, Dashboard.tsx:57, Billing.tsx:24, Billing.tsx:31, Billing.tsx:66, Settings.tsx:42 |
| `#9ca3af`  | `#f3f4f6`  | `#374151` | text       | 2.31:1 | Billing.tsx:66 (selected row)                                                                                                                                       |
| `#9ca3af`  | `#f9fafb`  | `#6b7280` | text       | 2.46:1 | styles.css:9 (`body`)                                                                                                                                               |
| `#ffffff`  | `#3b82f6`  | `#2563eb` | text       | 3.68:1 | Button.tsx:21, CTAButton.tsx:20, CTAButton.tsx:26, PrimaryBtn.tsx:16, styles.css:45 (`.badge-blue`)                                                                 |
| `#3b82f6`  | `#ffffff`  | `#2563eb` | text       | 3.68:1 | Navbar.tsx:29 (active link), Billing.tsx:59                                                                                                                         |
| `#3b82f6`  | `#f3f4f6`  | `#2563eb` | text       | 3.34:1 | Billing.tsx:59 (selected row), Dashboard.tsx:74 ("Extend trial")                                                                                                    |
| `#6b7280`  | `#f3f4f6`  | `#f9fafb` | text       | 4.39:1 | Dashboard.tsx:72 (trial banner; the fix lightens the background)                                                                                                    |
| `#dc2626`  | `#fef2f2`  | `#dc2626` | text       | 4.42:1 | Settings.tsx:45 (`hover:bg-red-50` on the delete button; neither color is a token yet, so the fix is a computed shade, not checked by hex)                           |
| `#d1d5db`  | `#ffffff`  | `#6b7280` | ui         | 1.47:1 | TextField.tsx:18, Dashboard.tsx:28 (input borders, need 3:1)                                                                                                        |

Fixes prefer a token already in the system in the same color family, then
the nearest computed shade (same OKLCH hue and chroma, only lightness
changes). When the foreground can't be fixed (white text), the background
is changed instead.

Pairs that pass and must **not** be flagged include `#6b7280` on white
(4.83:1), `#374151` on white, `#111827` on white, white on `#2563eb`
(Button primary hover, 5.17:1) and `#dc2626` on white (4.83:1).

### Focus styles

Expected focus findings (from the table above): `TextField.tsx:18`
(`outline-none`, only `focus:border-[#3b82f6]`) and `styles.css:40`
(`.legacy-input:focus { outline: none; }`). No other element removes its
focus outline.

## 6. Quick reference for tests

```
distinct hex values used:    19 (14 grays + white + 3 near blues + #2563eb)
color uses:                  78 (excludes 3 config definitions)
most-used gray:              #9ca3af (12 uses, fails AA)
expected gray merges:        5 pairs
expected blue merges:        2 → #3b82f6
arbitrary px spacing classes: 9 distinct, 26 occurrences
button components:           3 (Button, PrimaryBtn, CTAButton)
container duplicates:        Card ≈ Panel
overlay near-duplicates:     Modal ~ Dialog (behaviour differs)
raw <button> outside button components: 5
a11y static findings:        6 distinct rule hits (7 locations) + 1 contrast failure on body text
failing contrast pairs:      9 (see 5b)
```
