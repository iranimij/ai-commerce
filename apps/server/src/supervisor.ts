// The production image's entry point: runs the processes AICOMMERCE_ROLE asks for, forwards
// SIGTERM to them, and exits non-zero if one dies so the container restarts as a whole.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface Child {
  name: string
  command: string
  args: string[]
}

/** Starts the children. `done` resolves once all have exited: 0 after `stop`, else the failure. */
export function supervise(children: Child[]): {
  stop: (signal: NodeJS.Signals) => void
  done: Promise<number>
} {
  let stopping = false
  let code = 0
  let running = children.length
  let resolve: (code: number) => void = () => undefined
  const done = new Promise<number>((r) => (resolve = r))
  const processes = children.map((child) => {
    const proc = spawn(child.command, child.args, { stdio: 'inherit' })
    let exited = false
    const exit = (status: number | null, signal: NodeJS.Signals | null) => {
      if (exited) return
      exited = true
      running -= 1
      if (!stopping) {
        console.error(`${child.name} exited (${String(signal ?? status)}): stopping the others`)
        // A long-running process that exits on its own, even with 0, is a failure.
        code = status || 1
        stop('SIGTERM')
      }
      if (running === 0) resolve(code)
    }
    proc.once('exit', exit)
    proc.once('error', (error) => {
      console.error(`${child.name}: ${error.message}`)
      exit(1, null)
    })
    return proc
  })
  function stop(signal: NodeJS.Signals) {
    stopping = true
    for (const proc of processes) if (proc.exitCode === null) proc.kill(signal)
  }
  return { stop, done }
}

if (import.meta.main) {
  const role = process.env.AICOMMERCE_ROLE ?? 'all'
  // main.js serves HTTP and/or runs the job worker, as AICOMMERCE_ROLE says.
  const children: Child[] = [
    {
      name: 'server',
      command: process.execPath,
      args: [fileURLToPath(new URL('main.js', import.meta.url))],
    },
  ]
  // The admin (apps/admin) joins the image in its own Docker stage; until that stage copies its
  // standalone build here, the image runs without it.
  const admin = fileURLToPath(new URL('../../admin/server.js', import.meta.url))
  if (role !== 'worker' && existsSync(admin)) {
    children.push({ name: 'admin', command: process.execPath, args: [admin] })
  }
  const { stop, done } = supervise(children)
  process.once('SIGTERM', () => {
    stop('SIGTERM')
  })
  process.once('SIGINT', () => {
    stop('SIGTERM')
  })
  process.exitCode = await done
}
