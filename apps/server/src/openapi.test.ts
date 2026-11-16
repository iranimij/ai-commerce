import { createApp, defineModule, defineSetting } from '@aicommerce/core'
import { access } from '@aicommerce/module-access'
import { sample } from '@aicommerce/module-sample'
import { system } from '@aicommerce/module-system'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { createOpenApi } from './openapi.js'

const pay = defineModule({
  name: 'pay',
  settings: [
    defineSetting({
      key: 'pay.api-key',
      module: 'pay',
      label: 'API key',
      schema: z.string(),
      privacy: 'secret',
      scope: 'global',
    }),
    defineSetting({
      key: 'pay.mode',
      module: 'pay',
      label: 'Mode',
      schema: z.string(),
      default: 'sentinel-default-value',
      privacy: 'internal',
      scope: 'global',
    }),
  ],
})
const app = createApp({
  modules: [system, access, sample, pay],
  enabled: ['system', 'access', 'sample', 'pay'],
})
const doc = createOpenApi(app) as {
  openapi: string
  info: { title: string }
  paths: Record<string, { post: Record<string, unknown> }>
}

test('every enabled action has a path with permission and risk', () => {
  expect(doc.openapi).toBe('3.1.0')
  expect(doc.info.title).toBe('AI Commerce')
  const actions = app.registry.list()
  expect(Object.keys(doc.paths).sort()).toEqual(actions.map((a) => `/api/actions/${a.name}`).sort())
  for (const a of actions) {
    const op = doc.paths[`/api/actions/${a.name}`]?.post
    expect(op).toMatchObject({
      summary: a.description,
      tags: [a.name.split('.')[0]],
      'x-aicommerce-permission': a.permission,
      'x-aicommerce-risk': a.risk,
    })
    expect(Object.keys(op?.responses as object).sort()).toEqual(
      ['200', '400', '401', '403', '404', '409', '428', '429', '500'].sort(),
    )
  }
})

test('the document contains no secret setting value or default', () => {
  const text = JSON.stringify(doc)
  expect(text).not.toContain('sentinel-default-value')
  expect(text).not.toContain('pay.api-key')
})

test('the input schema rejects unknown keys (additionalProperties false)', () => {
  const body = (
    doc.paths['/api/actions/sample.greet']?.post.requestBody as {
      content: Record<
        string,
        {
          schema: {
            additionalProperties: boolean
            properties: Record<string, { additionalProperties: boolean }>
          }
        }
      >
    }
  ).content['application/json']?.schema
  expect(body?.additionalProperties).toBe(false)
  expect(body?.properties.input?.additionalProperties).toBe(false)
})
