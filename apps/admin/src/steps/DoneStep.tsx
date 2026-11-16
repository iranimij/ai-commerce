import { Alert, Button, Card, Spinner } from '@aicommerce/ui'
import { useEffect, useRef, useState } from 'react'
import { action, type Result } from '../api'
import { moduleText, type T } from '../i18n'
import { useCall } from './shared'

export interface DoneStepProps {
  t: T
  locale: string
  /** What setup just switched on; null when setup was already finished before this visit. */
  enabled: string[] | null
  /** The owner asked for sample products: add them now that the catalog is on. */
  sample?: boolean
}

export function DoneStep({ t, locale, enabled, sample = false }: DoneStepProps) {
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
        {sample && <SampleData t={t} />}
        <p>{t('done.next')}</p>
        {/* A plain link: the dashboard is M1, until then /api/me shows the signed-in owner. */}
        <a href="/api/me" className="font-semibold text-accent underline">
          {t('done.me')}
        </a>
      </div>
    </Card>
  )
}

interface Counts {
  attributes: number
  categories: number
  products: number
  variants: number
  images: number
}

// The server switches the chosen modules on a moment after setup.finish; until then the action
// is unknown, so not_found is waited out (up to about 15 seconds).
async function installSample(): Promise<Result<Counts>> {
  for (let tries = 1; ; tries++) {
    const result = await action<Counts>('catalog.install-sample', {})
    if (result.ok || result.error.code !== 'not_found' || tries === 30) return result
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

function SampleData({ t }: { t: T }) {
  const { busy, error, run } = useCall()
  const [counts, setCounts] = useState<Counts | null>(null)
  const install = () => run(installSample, setCounts)
  // Once, even when React runs the effect twice in development.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void install()
  })

  if (counts) return <Alert tone="success">{t('done.sampleAdded', { ...counts })}</Alert>
  if (error && !busy) {
    return (
      <Alert tone="danger">
        <p>{t('done.sampleFailed')}</p>
        <Button variant="secondary" onClick={install} className="mt-2">
          {t('common.retry')}
        </Button>
      </Alert>
    )
  }
  return <Spinner label={t('done.sampleBusy')} />
}
