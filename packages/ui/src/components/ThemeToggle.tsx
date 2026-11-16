import { cx, type Theme } from './provider.js'

export interface ThemeToggleProps {
  /** Names the group, e.g. "Theme". */
  label: string
  value: Theme
  onChange: (theme: Theme) => void
  labels: Record<Theme, string>
}

const THEMES: Theme[] = ['light', 'dark', 'system']

export function ThemeToggle({ label, value, onChange, labels }: ThemeToggleProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-ui border border-border bg-surface p-0.5"
    >
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          aria-pressed={value === theme}
          onClick={() => {
            onChange(theme)
          }}
          className={cx(
            'rounded-ui px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-focus',
            value === theme ? 'bg-accent text-accent-fg' : 'text-fg',
          )}
        >
          {labels[theme]}
        </button>
      ))}
    </div>
  )
}
