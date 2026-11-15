import { describe, expect, test } from 'vitest'
import { createPipelines, definePipeline, type Step } from './pipeline.js'

interface Price {
  amount: number
}
const price = definePipeline<Price>('price.calculate')

const addTen: Step<Price> = {
  pipeline: price,
  name: 'add-ten',
  module: 'tax',
  order: 10,
  run: (v) => ({ amount: v.amount + 10 }),
}
const double: Step<Price> = {
  pipeline: price,
  name: 'double',
  module: 'promo',
  order: 20,
  run: (v) => Promise.resolve({ amount: v.amount * 2 }),
}

describe('pipelines', () => {
  test('steps run by order and the value flows through', async () => {
    const pipelines = createPipelines()
    pipelines.addStep(double)
    pipelines.addStep(addTen)
    const { value } = await pipelines.run(price, { amount: 100 })
    expect(value).toEqual({ amount: 220 })
  })

  test('equal order is resolved by module then step name', () => {
    const steps: Step<Price>[] = [
      { pipeline: price, name: 'b', module: 'zeta', order: 0, run: (v) => v },
      { pipeline: price, name: 'b', module: 'alpha', order: 0, run: (v) => v },
      { pipeline: price, name: 'a', module: 'alpha', order: 0, run: (v) => v },
    ]
    const forward = createPipelines()
    steps.forEach((s) => {
      forward.addStep(s)
    })
    const backward = createPipelines()
    ;[...steps].reverse().forEach((s) => {
      backward.addStep(s)
    })
    const expected = [
      { step: 'a', module: 'alpha', order: 0 },
      { step: 'b', module: 'alpha', order: 0 },
      { step: 'b', module: 'zeta', order: 0 },
    ]
    expect(forward.steps('price.calculate')).toEqual(expected)
    expect(backward.steps('price.calculate')).toEqual(expected)
  })

  test('trace records before and after for every step', async () => {
    const pipelines = createPipelines()
    pipelines.addStep(addTen)
    pipelines.addStep(double)
    const { trace } = await pipelines.run(price, { amount: 100 })
    expect(trace).toEqual([
      { step: 'add-ten', module: 'tax', before: { amount: 100 }, after: { amount: 110 } },
      { step: 'double', module: 'promo', before: { amount: 110 }, after: { amount: 220 } },
    ])
  })

  test('a step that mutates its input does not corrupt the trace', async () => {
    const pipelines = createPipelines()
    pipelines.addStep({
      pipeline: price,
      name: 'mutate',
      module: 'bad',
      order: 0,
      run: (v) => {
        v.amount = 999
        return v
      },
    })
    const { trace } = await pipelines.run(price, { amount: 1 })
    expect(trace[0]?.before).toEqual({ amount: 1 })
    expect(trace[0]?.after).toEqual({ amount: 999 })
  })

  test('a pipeline with no steps returns the initial value', async () => {
    const pipelines = createPipelines()
    expect(await pipelines.run(price, { amount: 5 })).toEqual({ value: { amount: 5 }, trace: [] })
  })

  test('adding the same step twice throws', () => {
    const pipelines = createPipelines()
    pipelines.addStep(addTen)
    expect(() => {
      pipelines.addStep(addTen)
    }).toThrow('Step "add-ten" of module "tax" is already in pipeline "price.calculate"')
  })
})
