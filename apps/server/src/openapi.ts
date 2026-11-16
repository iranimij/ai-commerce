import { VERSION, type App } from '@aicommerce/core'
import { z } from 'zod'

const ERRORS: Record<string, string> = {
  '400': 'Invalid input',
  '401': 'Sign-in required',
  '403': 'Not allowed',
  '404': 'Unknown action or record',
  '409': 'Conflict, such as a stale version',
  '428': 'Confirmation required: send `confirmed: true`',
  '429': 'Too many requests; see Retry-After',
  '500': 'The action failed',
}

const jsonSchema = (schema: z.ZodType, io: 'input' | 'output') => {
  const json: Record<string, unknown> = z.toJSONSchema(schema, { io, unrepresentable: 'any' })
  delete json.$schema
  return json
}

/** OpenAPI 3.1 for every enabled action, generated from the registry. */
export function createOpenApi(app: App): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  const actions = [...app.registry.list()].sort((a, b) => a.name.localeCompare(b.name))
  for (const action of actions) {
    paths[`/api/actions/${action.name}`] = {
      post: {
        operationId: action.name,
        summary: action.description,
        tags: [action.name.split('.')[0]],
        'x-aicommerce-permission': action.permission,
        'x-aicommerce-risk': action.risk,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                // Strict, as the registry runs it.
                properties: {
                  input: jsonSchema(action.input.strict(), 'input'),
                  confirmed: { type: 'boolean' },
                },
                required: ['input'],
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The action ran',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { const: true }, output: jsonSchema(action.output, 'output') },
                  required: ['ok', 'output'],
                },
              },
            },
          },
          ...Object.fromEntries(
            Object.entries(ERRORS).map(([status, description]) => [
              status,
              {
                description,
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
            ]),
          ),
        },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'AI Commerce', version: VERSION },
    paths,
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            ok: { const: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                issues: { type: 'array', items: { type: 'object' } },
              },
              required: ['code', 'message'],
            },
          },
          required: ['ok', 'error'],
        },
      },
    },
  }
}
