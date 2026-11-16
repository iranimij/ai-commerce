import { resolveModules } from '@aicommerce/core'
import { Alert, Button, Card, Checkbox, EmptyState, RadioCards, Spinner } from '@aicommerce/ui'
import { useState } from 'react'
import { action, errorText } from '../api'
import { moduleText, type T } from '../i18n'
import { FormError, useCall, withToken } from './shared'

interface Module {
  name: string
  label: string
  description: string
  required: boolean
  depends: string[]
}

export interface Chosen {
  enabled: string[]
  added: { module: string; requiredBy: string | null }[]
}

export interface FeaturesStepProps {
  t: T
  token: string | null
  onChosen: (chosen: Chosen) => void
}

export function FeaturesStep({ t, token, onChosen }: FeaturesStepProps) {
  const [choice, setChoice] = useState('minimal')
  const [modules, setModules] = useState<Module[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const list = useCall()
  const save = useCall()

  // module.list needs the owner's session; the owner signed in on the 2FA step.
  const load = () => list.run(() => action<Module[]>('module.list', {}), setModules)
  const choose = (value: string) => {
    setChoice(value)
    if (value === 'custom' && modules === null) void load()
  }

  // The same resolution the server applies, so what is ticked is what will be enabled.
  const resolved = modules ? resolveModules(modules, picked) : null
  const reasons = new Map(resolved?.added.map((a) => [a.module, a.requiredBy]))
  const label = (name: string) => {
    const m = modules?.find((x) => x.name === name)
    return m ? moduleText(t, m).label : name
  }

  const submit = () =>
    save.run(
      () =>
        action<Chosen>(
          'setup.choose-modules',
          withToken(token, choice === 'custom' ? { modules: picked } : { preset: choice }),
        ),
      onChosen,
    )

  const listError = list.error
    ? list.error.code === 'forbidden'
      ? t('features.signInNeeded')
      : errorText(t, list.error)
    : null

  return (
    <Card
      title={t('features.title')}
      footer={
        <Button
          onClick={submit}
          busy={save.busy}
          busyLabel={t('common.saving')}
          disabled={choice === 'custom' && modules === null}
        >
          {t('common.continue')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError
          message={
            save.error
              ? save.error.code === 'invalid_input'
                ? t('features.invalid')
                : errorText(t, save.error)
              : null
          }
        />
        <RadioCards
          label={t('features.label')}
          value={choice}
          onValueChange={choose}
          options={[
            {
              value: 'minimal',
              title: t('features.minimal'),
              description: t('features.minimalHint'),
            },
            { value: 'full', title: t('features.full'), description: t('features.fullHint') },
            { value: 'custom', title: t('features.custom'), description: t('features.customHint') },
          ]}
        />
        {choice === 'custom' && list.busy && <Spinner label={t('common.loading')} />}
        {choice === 'custom' && listError !== null && (
          <Alert tone={list.error?.code === 'forbidden' ? 'info' : 'danger'}>
            <p>{listError}</p>
            {list.error?.code !== 'forbidden' && (
              <Button variant="secondary" onClick={load} className="mt-2">
                {t('common.retry')}
              </Button>
            )}
          </Alert>
        )}
        {choice === 'custom' && modules?.length === 0 && <EmptyState title={t('features.empty')} />}
        {choice === 'custom' && modules && resolved && (
          <div className="flex flex-col gap-3">
            {modules.map((m) => {
              const on = resolved.enabled.includes(m.name)
              const reason = reasons.get(m.name)
              // Ticked for a reason the owner cannot undo here: always on, or needed by another.
              const locked = reason !== undefined
              return (
                <Checkbox
                  key={m.name}
                  label={moduleText(t, m).label}
                  checked={on}
                  disabled={locked}
                  onCheckedChange={(checked) => {
                    setPicked((p) => (checked ? [...p, m.name] : p.filter((x) => x !== m.name)))
                  }}
                  hint={
                    <>
                      {moduleText(t, m).description}{' '}
                      {locked && (
                        <span className="font-medium">
                          {reason === null
                            ? t('features.alwaysOn')
                            : t('features.neededBy', { module: label(reason) })}
                        </span>
                      )}
                    </>
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
