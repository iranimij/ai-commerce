import { Button, Card, Checkbox } from '@aicommerce/ui'
import { useState } from 'react'
import { action, errorText } from '../api'
import type { T } from '../i18n'
import { FormError, useCall, withToken } from './shared'

export interface ExtrasStepProps {
  t: T
  token: string | null
  /** The catalog is among the chosen modules, so sample products can be added. */
  offerSample: boolean
  /** `sample`: the owner asked for sample products; the done screen adds them. */
  onFinished: (enabled: string[], sample: boolean) => void
}

/** Import is announced, not built: it arrives in M3. */
export function ExtrasStep({ t, token, offerSample, onFinished }: ExtrasStepProps) {
  const { busy, error, run } = useCall()
  const [sample, setSample] = useState(false)
  const finish = () =>
    run(
      () => action<{ enabled: string[] }>('setup.finish', withToken(token, {})),
      (output) => {
        onFinished(output.enabled, offerSample && sample)
      },
    )
  return (
    <Card
      title={t('extras.title')}
      footer={
        <Button onClick={finish} busy={busy} busyLabel={t('common.saving')}>
          {t('extras.finish')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError
          message={
            error ? (error.code === 'conflict' ? t('extras.blocked') : errorText(t, error)) : null
          }
        />
        <Checkbox
          label={t('extras.import')}
          hint={t('extras.importHint')}
          checked={false}
          onCheckedChange={() => undefined}
          disabled
        />
        {offerSample && (
          <Checkbox
            label={t('extras.sample')}
            hint={t('extras.sampleHint')}
            checked={sample}
            onCheckedChange={setSample}
          />
        )}
      </div>
    </Card>
  )
}
