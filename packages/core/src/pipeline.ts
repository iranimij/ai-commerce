/** A named, ordered extension point, e.g. 'price.calculate'. `T` is the value that flows through. */
export interface PipelineDefinition<T> {
  name: string
  /** Type marker only; never set at runtime. */
  readonly __type?: T
}

export function definePipeline<T>(name: string): PipelineDefinition<T> {
  return { name }
}

export interface Step<T> {
  pipeline: PipelineDefinition<T>
  name: string
  module: string
  /** Lower runs first. Ties are broken by module name, then step name. */
  order: number
  run: (value: T) => Promise<T> | T
}

export interface TraceEntry<T> {
  step: string
  module: string
  before: T
  after: T
}

export interface Pipelines {
  addStep<T>(step: Step<T>): void
  run<T>(pipeline: PipelineDefinition<T>, initial: T): Promise<{ value: T; trace: TraceEntry<T>[] }>
  steps(pipelineName: string): { step: string; module: string; order: number }[]
}

function compare(a: Step<unknown>, b: Step<unknown>): number {
  return a.order - b.order || a.module.localeCompare(b.module) || a.name.localeCompare(b.name)
}

export function createPipelines(): Pipelines {
  const byPipeline = new Map<string, Step<unknown>[]>()

  return {
    addStep(step) {
      const list = byPipeline.get(step.pipeline.name) ?? []
      if (list.some((s) => s.module === step.module && s.name === step.name)) {
        throw new Error(
          `Step "${step.name}" of module "${step.module}" is already in pipeline "${step.pipeline.name}"`,
        )
      }
      list.push(step as Step<unknown>)
      list.sort(compare)
      byPipeline.set(step.pipeline.name, list)
    },

    async run<T>(pipeline: PipelineDefinition<T>, initial: T) {
      const trace: TraceEntry<T>[] = []
      let value = initial
      for (const step of (byPipeline.get(pipeline.name) ?? []) as Step<T>[]) {
        // Copy before running, so a step that mutates its input cannot rewrite the trace.
        const before = structuredClone(value)
        value = await step.run(value)
        trace.push({ step: step.name, module: step.module, before, after: structuredClone(value) })
      }
      return { value, trace }
    },

    steps: (pipelineName) =>
      (byPipeline.get(pipelineName) ?? []).map((s) => ({
        step: s.name,
        module: s.module,
        order: s.order,
      })),
  }
}
