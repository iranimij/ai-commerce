import { Alert, Card } from '@aicommerce/ui'
import { moduleText, type T } from '../i18n'

export interface DoneStepProps {
  t: T
  locale: string
  /** What setup just switched on; null when setup was already finished before this visit. */
  enabled: string[] | null
}

export function DoneStep({ t, locale, enabled }: DoneStepProps) {
  if (enabled === null) {
    return (
      <Card title={t('setup.finishedTitle')}>
        <p>{t('setup.finishedBody')}</p>
      </Card>
    )
  }
  const names = enabled.map((name) => moduleText(t, { name, label: name, description: '' }).label)
  return (
    <Card title={t('done.title')}>
      <div className="flex flex-col gap-4">
        <Alert tone="success">
          {t('done.enabled', {
            modules: new Intl.ListFormat(locale, { type: 'conjunction' }).format(names),
          })}
        </Alert>
        <p>{t('done.next')}</p>
        {/* A plain link: the dashboard is M1, until then /api/me shows the signed-in owner. */}
        <a href="/api/me" className="font-semibold text-accent underline">
          {t('done.me')}
        </a>
      </div>
    </Card>
  )
}
