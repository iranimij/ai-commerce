import * as RadioGroup from '@radix-ui/react-radio-group'
import { useId, type ReactNode } from 'react'
import { useDirection } from './provider.js'

export interface RadioCardsProps {
  label: ReactNode
  value: string
  onValueChange: (value: string) => void
  options: { value: string; title: ReactNode; description?: ReactNode; disabled?: boolean }[]
}

/** A choice between a few options shown as cards, such as the module presets. */
export function RadioCards({ label, value, onValueChange, options }: RadioCardsProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={`${id}-label`}
        value={value}
        onValueChange={onValueChange}
        dir={useDirection()}
        loop
        className="grid gap-3 sm:grid-cols-2"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            {...(o.disabled !== undefined && { disabled: o.disabled })}
            aria-describedby={
              o.description === undefined ? undefined : `${id}-${o.value}-description`
            }
            className="flex flex-col items-start gap-1 rounded-ui-lg border border-border bg-surface p-4 text-start focus-visible:outline-2 focus-visible:outline-focus data-[state=checked]:border-accent data-[state=checked]:ring-2 data-[state=checked]:ring-accent disabled:opacity-60"
          >
            <span className="font-semibold">{o.title}</span>
            {o.description !== undefined && (
              <span id={`${id}-${o.value}-description`} className="text-sm text-muted">
                {o.description}
              </span>
            )}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  )
}
