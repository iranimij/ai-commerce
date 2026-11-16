import { Button, Card, TextField } from '@aicommerce/ui'
import type { SubmitEvent } from 'react'
import { action, errorText, invalidFields } from '../api'
import type { T } from '../i18n'
import { FormError, formFields, useCall, withToken } from './shared'

export interface Credentials {
  email: string
  password: string
}

export interface OwnerStepProps {
  t: T
  token: string | null
  /** The password is kept in memory only, to turn on 2FA without asking again. */
  onCreated: (credentials: Credentials) => void
}

export function OwnerStep({ t, token, onCreated }: OwnerStepProps) {
  const { busy, error, run } = useCall()
  const bad = error ? invalidFields(error) : new Set<string>()
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    const field = formFields(event)
    const input = { email: field('email'), name: field('name'), password: field('password') }
    void run(
      () => action('setup.create-owner', withToken(token, input)),
      () => {
        onCreated({ email: input.email, password: input.password })
      },
    )
  }
  const formError =
    error && bad.size === 0
      ? error.code === 'conflict'
        ? t('owner.exists')
        : errorText(t, error)
      : null
  return (
    <Card title={t('owner.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('owner.intro')}</p>
        <FormError message={formError} />
        <TextField
          label={t('owner.email')}
          name="email"
          type="email"
          autoComplete="username"
          required
          {...(bad.has('email') && { error: t('owner.emailInvalid') })}
        />
        <TextField
          label={t('owner.name')}
          name="name"
          autoComplete="name"
          required
          {...(bad.has('name') && { error: t('owner.nameInvalid') })}
        />
        <TextField
          label={t('owner.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          hint={t('owner.passwordHint')}
          required
          {...(bad.has('password') && { error: t('owner.passwordInvalid') })}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={busy} busyLabel={t('common.saving')}>
            {t('owner.submit')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
