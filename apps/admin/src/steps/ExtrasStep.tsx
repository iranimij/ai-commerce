import { Button, Card, Checkbox } from '@aicommerce/ui'
import { action, errorText } from '../api'
import type { T } from '../i18n'
import { FormError, useCall, withToken } from './shared'

export interface ExtrasStepProps {
  t: T
  token: string | null
  onFinished: (enabled: string[]) => void
}

/** Import and sample data are announced, not built: they arrive in M3 and M1. */
export function ExtrasStep({ t, token, onFinished }: ExtrasStepProps) {
  const { busy, error, run } = useCall()
  const finish = () =>
    run(
      () => action<{ enabled: string[] }>('setup.finish', withToken(token, {})),
      (output) => {
        onFinished(output.enabled)
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
        <Checkbox
          label={t('extras.sample')}
          hint={t('extras.sampleHint')}
          checked={false}
          onCheckedChange={() => undefined}
          disabled
        />
      </div>
    </Card>
  )
}
