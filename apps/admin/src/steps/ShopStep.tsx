import { SUPPORTED_LOCALES } from '@aicommerce/i18n'
import { Button, Card, Select, TextField } from '@aicommerce/ui'
import { useMemo, useState, type SubmitEvent } from 'react'
import { action, errorText, invalidFields } from '../api'
import type { T } from '../i18n'
import { FormError, formFields, useCall, withToken } from './shared'

// ISO 3166-1 alpha-2. The names come from the browser, in the page's language.
const COUNTRIES =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ
BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC
EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM
HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI
LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE
NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC
SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW
TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/)

function options(
  locale: string,
  type: 'region' | 'currency' | 'language',
  codes: readonly string[],
) {
  const names = new Intl.DisplayNames([locale], { type })
  return codes
    .map((value) => {
      const name = names.of(value) ?? value
      return { value, label: type === 'currency' ? `${name} (${value})` : name }
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale))
}

export interface ShopStepProps {
  t: T
  token: string | null
  locale: string
  onSaved: () => void
}

export function ShopStep({ t, token, locale, onSaved }: ShopStepProps) {
  const [country, setCountry] = useState('')
  const [currency, setCurrency] = useState('')
  const [language, setLanguage] = useState(locale)
  const { busy, error, run } = useCall()
  const bad = error ? invalidFields(error) : new Set<string>()
  const lists = useMemo(
    () => ({
      countries: options(locale, 'region', COUNTRIES),
      currencies: options(locale, 'currency', Intl.supportedValuesOf('currency')),
      languages: options(locale, 'language', SUPPORTED_LOCALES),
    }),
    [locale],
  )

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    const field = formFields(event)
    const aiKey = field('aiKey')
    const input = {
      name: field('name'),
      country,
      currency,
      language,
      ...(aiKey && { aiKey }),
    }
    void run(() => action('setup.save-shop', withToken(token, input)), onSaved)
  }

  return (
    <Card title={t('shop.title')}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormError message={error && bad.size === 0 ? errorText(t, error) : null} />
        <TextField
          label={t('shop.name')}
          name="name"
          autoComplete="organization"
          {...(bad.has('name') && { error: t('shop.nameInvalid') })}
        />
        <Select
          label={t('shop.country')}
          value={country}
          onValueChange={setCountry}
          options={lists.countries}
          placeholder={t('shop.choose')}
          {...(bad.has('country') && { error: t('shop.countryInvalid') })}
        />
        <Select
          label={t('shop.currency')}
          value={currency}
          onValueChange={setCurrency}
          options={lists.currencies}
          placeholder={t('shop.choose')}
          {...(bad.has('currency') && { error: t('shop.currencyInvalid') })}
        />
        <Select
          label={t('shop.language')}
          value={language}
          onValueChange={setLanguage}
          options={lists.languages}
          {...(bad.has('language') && { error: t('shop.languageInvalid') })}
        />
        <TextField
          label={t('shop.aiKey')}
          name="aiKey"
          type="password"
          autoComplete="off"
          hint={t('shop.aiKeyHint')}
          {...(bad.has('aiKey') && { error: t('shop.aiKeyInvalid') })}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={busy} busyLabel={t('common.saving')}>
            {t('shop.submit')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
