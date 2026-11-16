# Design system (`@aicommerce/ui`)

Tokens, a Tailwind 4 preset and accessible React components for the admin and the setup page.

## Use it

```css
/* app/globals.css */
@import '@aicommerce/ui/tailwind.css';
```

```tsx
import { directionOf } from '@aicommerce/i18n'
import { Button, TextField, UiProvider } from '@aicommerce/ui'

;<UiProvider dir={directionOf(locale)} theme="system">
  <TextField label={t('shop.name')} hint={t('shop.name.hint')} error={errors.name} />
  <Button onClick={save} busyLabel={t('common.saving')}>
    {t('common.save')}
  </Button>
</UiProvider>
```

## Rules

- **No text inside.** Every visible or spoken string is a prop, so it comes from the translator.
  The package holds no English.
- **Logical properties only** (`ps-4`, `ms-2`, `text-start`, `border-s`). Right-to-left then needs
  no extra rules: `UiProvider dir="rtl"` is enough, and Radix keyboard handling follows it.
- **Themes.** Light by default, dark with `theme="dark"`, and `theme="system"` follows the
  operating system. The provider sets `data-theme` on its own element.
- **Contrast.** Text tokens are at least 4.5:1 on the backgrounds they sit on, in both themes.
  `src/tokens.test.ts` checks the values, so a token change that breaks it fails CI.
- **Accessibility.** Every component is checked with axe in light, dark and right-to-left
  (`src/components.test.tsx`). Fields link their label, hint and error with `aria-describedby`.

## Changing the brand

The logo is "Orbit a" (proposal C, chosen on 2026-11-16): a lowercase a with a dot orbiting its
bowl.

- **The mark:** the `Logo` component in apps, and `assets/logo.svg`, `logo-dark.svg`,
  `app-icon.svg` and `favicon.svg` (exported as `@aicommerce/ui/assets/*`). The dotted orbit trail
  shows only above 64 px.
- **The colours:** `src/brand.css` holds the palette and font, and is the one file to change.
  `src/tokens.css` maps it to roles such as background, text and accent.

## Components

| Component     | Notes                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `Button`      | `primary`, `secondary`, `danger`. Busy while its `onClick` promise runs; extra clicks are ignored |
| `TextField`   | Label, hint, error; `aria-invalid` with an error                                                  |
| `Select`      | Radix Select, with a label, hint and error                                                        |
| `Checkbox`    | Radix Checkbox                                                                                    |
| `RadioCards`  | Radix RadioGroup shown as cards; arrow keys move and choose                                       |
| `Alert`       | `info` and `success` are polite; `warning` and `danger` interrupt                                 |
| `Card`        | A titled section with an optional footer                                                          |
| `Stepper`     | Marks the current step with `aria-current="step"`                                                 |
| `Logo`        | The mark, with an optional wordmark; named by its `label`                                         |
| `Spinner`     | A status with a spoken label; still for people who reduce motion                                  |
| `EmptyState`  | What to show when a list has nothing yet                                                          |
| `ThemeToggle` | Light, dark or system                                                                             |
