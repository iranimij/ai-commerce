import * as RadixCheckbox from '@radix-ui/react-checkbox'
import { useId, type ReactNode } from 'react'
import { describedBy, FieldMessages } from './field.js'

export interface CheckboxProps {
  label: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  hint?: ReactNode
  disabled?: boolean
}

export function Checkbox({ label, checked, onCheckedChange, hint, disabled }: CheckboxProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <RadixCheckbox.Root
          id={id}
          checked={checked}
          onCheckedChange={(state) => {
            onCheckedChange(state === true)
          }}
          aria-describedby={describedBy(id, hint)}
          {...(disabled !== undefined && { disabled })}
          className="grid size-5 place-items-center rounded border border-border bg-surface text-accent-fg focus-visible:outline-2 focus-visible:outline-focus data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        >
          <RadixCheckbox.Indicator aria-hidden="true">✓</RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
      </div>
      <FieldMessages id={id} hint={hint} />
    </div>
  )
}
