import { Alert, Button, Card } from '@aicommerce/ui'
import type { T } from '../i18n'

export interface DatabaseStepProps {
  t: T
  /** null when the status could not be read at all. */
  database: { ok: boolean; version: string | null } | null
  onContinue: () => void
  onRetry: () => Promise<void>
}

export function DatabaseStep({ t, database, onContinue, onRetry }: DatabaseStepProps) {
  if (!database?.ok) {
    return (
      <Card
        title={t('database.title')}
        footer={
          <Button onClick={onRetry} busyLabel={t('common.loading')}>
            {t('common.retry')}
          </Button>
        }
      >
        <Alert tone="danger" title={t('database.failedTitle')}>
          {t('database.failedBody')}
        </Alert>
      </Card>
    )
  }
  return (
    <Card
      title={t('database.title')}
      footer={<Button onClick={onContinue}>{t('common.continue')}</Button>}
    >
      {/* Isolated, so a Latin version string keeps its own order inside right-to-left text. */}
      <Alert tone="success">
        {t('database.ok', { version: `\u2068${database.version ?? ''}\u2069` })}
      </Alert>
    </Card>
  )
}
