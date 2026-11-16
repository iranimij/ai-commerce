// The production image's entry point: runs the processes AICOMMERCE_ROLE asks for, forwards
// SIGTERM to them, and exits non-zero if one dies so the container restarts as a whole.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface Child {
  name: string
  command: string
  args: string[]
  /** Added to this process's environment. */
  env?: Record<string, string>
}

/**
 * The processes for AICOMMERCE_ROLE. With the admin (`admin` is its server.js), the admin takes
 * the public PORT and proxies /api to the server on the next port; a worker serves no HTTP.
 */
export function processes(
  env: Record<string, string | undefined>,
  main: string,
  admin: string | null,
): Child[] {
  const server = { name: 'server', command: process.execPath, args: [main] }
  if (env.AICOMMERCE_ROLE === 'worker' || admin === null) return [{ ...server, env: {} }]
  const port = Number(env.PORT ?? 3000)
  const internal = String(port + 1)
  return [
    { ...server, env: { PORT: internal } },
    {
      name: 'admin',
      command: process.execPath,
      args: [admin],
      // Next.js listens on HOSTNAME, which Docker sets to the container id.
      env: {
        PORT: String(port),
        HOSTNAME: '0.0.0.0',
        AICOMMERCE_SERVER_URL: `http://127.0.0.1:${internal}`,
      },
    },
  ]
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
  const spawned = children.map((child) => {
    const proc = spawn(child.command, child.args, {
      stdio: 'inherit',
      env: { ...process.env, ...child.env },
    })
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
    for (const proc of spawned) if (proc.exitCode === null) proc.kill(signal)
  }
  return { stop, done }
}

if (import.meta.main) {
  // The admin's standalone server, copied here by the image's admin stage.
  const admin = fileURLToPath(new URL('../../admin/server.js', import.meta.url))
  const children = processes(
    process.env,
    fileURLToPath(new URL('main.js', import.meta.url)),
    existsSync(admin) ? admin : null,
  )
  const { stop, done } = supervise(children)
  process.once('SIGTERM', () => {
    stop('SIGTERM')
  })
  process.once('SIGINT', () => {
    stop('SIGTERM')
  })
  process.exitCode = await done
}
