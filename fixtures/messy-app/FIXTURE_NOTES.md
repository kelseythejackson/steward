# messy-app: planted inconsistencies

This is the Steward test target. It is a small React + Tailwind app
("Acme Metrics": Dashboard, Settings and Billing pages) written to look like
a startup codebase that has drifted for a year. Every inconsistency below is
deliberate. Tests in `packages/*` assert against the tables in this file, so
**update this file whenever you change the fixture**.

Counts were taken with `grep -ohE '#[0-9a-f]{6}\b' -r src tailwind.config.ts`
and similar. A hex value appearing in a `hover:` class counts once per
occurrence, the same as the scanner will see it.

It typechecks (`pnpm -F @steward/fixture-messy-app typecheck`) but is not
meant to be run. There is no bundler and `/logo.svg` does not exist.

## 1. Colors

### Grays (14 distinct, plus white)

| Hex       | Uses | Where                                                   | Role in the drift                                    |
|-----------|-----:|---------------------------------------------------------|------------------------------------------------------|
| `#9ca3af` |   12 | App, Card, Panel, Modal, TextField, Dashboard, Settings, Billing, styles.css `body` | **Most used gray. Body text. 2.54:1 on white, fails AA 4.5:1.** |
| `#6b7280` |    9 | Button, Modal, Dialog, Navbar, Dashboard, Billing, tailwind.config `muted` | Secondary text                                      |
| `#374151` |    9 | Button, TextField, Settings, Billing, styles.css `td`    | Labels and headings                                  |
| `#1f2937` |    8 | Panel, Dialog, Button, Modal, Navbar, Billing, tailwind.config `ink` | Hover text and dark headings                 |
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
| `#3b82f6` |    7 | Button primary, CTAButton hover, TextField focus, Navbar active, Billing bar and link, styles.css `.badge-blue` |
| `#3a81f5` |    3 | PrimaryBtn, Dashboard "Extend trial", styles.css `a`      |
| `#3b83f7` |    2 | CTAButton, styles.css `a:hover`                           |
| `#2563eb` |    2 | Button primary hover, tailwind.config `brand`             |

Expected merge: `#3a81f5` and `#3b83f7` → `#3b82f6`. `#2563eb` is a real
darker shade and should stay separate.

Contrast note: white text on any of the three blues is about 3.7:1, which
passes AA for large text and UI components but fails 4.5:1 for normal text.
All three button components use white text on blue at `text-sm`.

### Tailwind theme colors nobody uses consistently

`tailwind.config.ts` defines `brand`, `ink` and `muted`. No component uses
the `bg-brand`, `text-ink` or `text-muted` classes. The same hex values are
pasted as arbitrary values instead.

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

Also `w-[91%]` in Billing (a percentage, should **not** be flagged as spacing drift).

Raw CSS in `src/styles.css`: `padding: 9px 13px`, `padding: 11px 13px`,
`padding: 2px 7px`, `width: 302px`.

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
| `src/pages/Billing.tsx`        |   71 | "Download all invoices" ghost-style button          |
| `src/components/Navbar.tsx`    |   25 | Navigation items rendered as raw buttons            |
| `src/components/Modal.tsx`     |   34 | Icon-only close button (also an a11y failure, below)|

Line numbers are correct as of this commit; tests should prefer matching on
file plus a distinctive attribute over exact line numbers.

## 5. Accessibility problems

| Rule                                   | File                          | Line | Detail                                                                 |
|----------------------------------------|-------------------------------|-----:|------------------------------------------------------------------------|
| Body text contrast                     | many, see grays table         |      | `#9ca3af` on white is 2.54:1. Needs 4.5:1. Nearest passing gray in the same family: `#6b7280` at 4.83:1. |
| Button text contrast (secondary)       | Button, PrimaryBtn, CTAButton |      | White on `#3b82f6` is 3.68:1 at `text-sm`. Passes 3:1 for UI, fails 4.5:1 for normal text. |
| `<img>` without `alt`                  | `src/components/Navbar.tsx`   |   19 | Logo image has `src`, `width`, `height`, no `alt`.                     |
| Icon-only button with no accessible name | `src/components/Modal.tsx`  |   34 | Close button contains only an inline SVG. No `aria-label`, no text.    |
| `<input>` without a label              | `src/pages/Dashboard.tsx`     |   22 | Search input has a `placeholder` but no `<label>`, `aria-label` or `aria-labelledby`. |
| Click handler on non-interactive element | `src/pages/Billing.tsx`     |   56 | `<div onClick>` used to select an invoice. No `role`, `tabIndex` or key handler. |
| Focus outline removed, no replacement  | `src/components/TextField.tsx`|   18 | `outline-none` with only `focus:border-[#3b82f6]`. Border color change alone is not a sufficient focus indicator. |
| Focus outline removed, no replacement  | `src/styles.css`              |   40 | `.legacy-input:focus { outline: none; }` with nothing else. Applied to the Dashboard search input. |

Things that are **correct** and must not be flagged (negative test cases):

- `src/components/TextField.tsx` renders a real `<label htmlFor>` when `label` is given. Both uses in Settings pass `id` and `label`.
- `src/pages/Settings.tsx` checkbox inputs are wrapped in `<label>`.
- `src/components/Dialog.tsx` has `role="dialog"`, `aria-modal="true"` and `aria-labelledby` pointing at a real id.
- `src/components/Button.tsx` and `src/components/CTAButton.tsx` set `type="button"`.
- Navbar links have visible text content, so they do have an accessible name even though they are raw buttons.

## 6. Quick reference for tests

```
distinct hex values:         19 (14 grays + white + 3 near blues + #2563eb)
most-used gray:              #9ca3af (12 uses, fails AA)
expected gray merges:        5 pairs
expected blue merges:        2 → #3b82f6
arbitrary px spacing classes: 9 distinct, 26 occurrences
button components:           3 (Button, PrimaryBtn, CTAButton)
container duplicates:        Card ≈ Panel
overlay near-duplicates:     Modal ~ Dialog (behaviour differs)
raw <button> outside button components: 5
a11y static findings:        6 distinct rule hits (7 locations) + 1 contrast failure on body text
```
