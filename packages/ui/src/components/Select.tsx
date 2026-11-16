import * as RadixSelect from '@radix-ui/react-select'
import { useId, type ReactNode } from 'react'
import { describedBy, FieldMessages } from './field.js'
import { useDirection } from './provider.js'

export interface SelectProps {
  label: ReactNode
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  hint?: ReactNode
  error?: ReactNode
  disabled?: boolean
}

export function Select({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  hint,
  error,
  disabled,
}: SelectProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <RadixSelect.Root
        value={value}
        onValueChange={onValueChange}
        dir={useDirection()}
        {...(disabled !== undefined && { disabled })}
      >
        <RadixSelect.Trigger
          id={id}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error !== undefined || undefined}
          className="inline-flex items-center justify-between gap-2 rounded-ui border border-border bg-surface px-3 py-2 text-start text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <RadixSelect.Value {...(placeholder !== undefined && { placeholder })} />
          <RadixSelect.Icon aria-hidden="true">▾</RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            className="z-50 rounded-ui border border-border bg-surface text-fg shadow-lg"
          >
            <RadixSelect.Viewport className="p-1">
              {options.map((o) => (
                <RadixSelect.Item
                  key={o.value}
                  value={o.value}
                  className="cursor-pointer rounded-ui px-3 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg"
                >
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  )
}
