import { Button, Card, TextField } from '@aicommerce/ui'
import { useState, type SubmitEvent } from 'react'
import { encode } from 'uqr'
import { authCall, errorText, type Failure } from '../api'
import type { T } from '../i18n'
import type { Credentials } from './OwnerStep'
import { FormError, formFields, useCall } from './shared'

export interface TwoFactorStepProps {
  t: T
  /** From the owner step; null after a reload, so the owner signs in again. */
  credentials: Credentials | null
  onDone: () => void
}

interface Enabled {
  totpURI: string
  backupCodes: string[]
}

/** Drawn here from the URI, so the secret never leaves the page. */
function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 })
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${String(x)} ${String(y)}h1v1h-1z` : '')))
    .join('')
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-ui"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

const signInText = (t: T, error: Failure | null) =>
  error === null
    ? null
    : /PASSWORD/.test(error.code)
      ? t('twoFactor.wrongPassword')
      : errorText(t, error)

export function TwoFactorStep({ t, credentials, onDone }: TwoFactorStepProps) {
  const [enabled, setEnabled] = useState<Enabled | null>(null)
  const start = useCall()
  const verify = useCall()

  const begin = (event: SubmitEvent<HTMLFormElement>) => {
    const field = formFields(event)
    const email = credentials?.email ?? field('email')
    const password = credentials?.password ?? field('password')
    void start.run(async () => {
      const signedIn = await authCall('sign-in/email', { email, password })
      if (!signedIn.ok) return signedIn
      return authCall<Enabled>('two-factor/enable', { password })
    }, setEnabled)
  }

  const check = (event: SubmitEvent<HTMLFormElement>) => {
    const code = formFields(event)('code').replace(/\s/g, '')
    void verify.run(() => authCall('two-factor/verify-totp', { code }), onDone)
  }

  if (enabled === null) {
    return (
      <Card title={t('twoFactor.title')}>
        <form onSubmit={begin} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-muted">{t('twoFactor.intro')}</p>
          <FormError message={signInText(t, start.error)} />
          {credentials === null && (
            <>
              <p className="text-sm">{t('twoFactor.signIn')}</p>
              <TextField
                label={t('owner.email')}
                name="email"
                type="email"
                autoComplete="username"
              />
              <TextField
                label={t('owner.password')}
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </>
          )}
          <div className="flex justify-end">
            <Button type="submit" busy={start.busy} busyLabel={t('common.loading')}>
              {t('twoFactor.start')}
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  const secret = new URL(enabled.totpURI).searchParams.get('secret') ?? ''
  const wrongCode = verify.error !== null && /CODE|^401$/.test(verify.error.code)
  return (
    <Card title={t('twoFactor.title')}>
      <form onSubmit={check} noValidate className="flex flex-col gap-4">
        <p className="text-sm">{t('twoFactor.scan')}</p>
        <QrCode text={enabled.totpURI} label={t('twoFactor.qr')} />
        <dl className="flex flex-col gap-1 text-sm">
          <dt className="font-medium">{t('twoFactor.secret')}</dt>
          {/* Keys and codes are Latin whatever the page direction. */}
          <dd dir="ltr" className="font-mono break-all text-start">
            {secret.replace(/(.{4})/g, '$1 ').trim()}
          </dd>
        </dl>
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">{t('twoFactor.backupTitle')}</h3>
          <p className="text-sm text-muted">{t('twoFactor.backupHint')}</p>
          <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-3">
            {enabled.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </section>
        <FormError message={verify.error && !wrongCode ? errorText(t, verify.error) : null} />
        <TextField
          label={t('twoFactor.code')}
          name="code"
          hint={t('twoFactor.codeHint')}
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          {...(wrongCode && { error: t('twoFactor.wrongCode') })}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={verify.busy} busyLabel={t('common.loading')}>
            {t('twoFactor.verify')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
