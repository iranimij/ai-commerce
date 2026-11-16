import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { defineService } from '@aicommerce/core'

/** Where uploaded files live. Replace it (S3, for example) by providing `files` from a module. */
export interface FileStore {
  put(key: string, data: Uint8Array): Promise<void>
  /** `null` when there is no such file. */
  get(key: string): Promise<Uint8Array | null>
  /** Deleting a missing file is not an error. */
  delete(key: string): Promise<void>
}

export const files = defineService<FileStore>('media.files')

/** Files under `dir`, created on the first write. A key that would leave `dir` throws. */
export function createDiskFileStore(dir: string): FileStore {
  const root = resolve(dir)
  const pathOf = (key: string) => {
    const path = resolve(root, key)
    const rel = relative(root, path)
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`File key "${key}" is outside the files directory`)
    }
    return path
  }
  return {
    async put(key, data) {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    async delete(key) {
      const path = pathOf(key)
      await rm(path, { force: true })
      // The key's folder goes once it is empty; a folder with files left in it stays.
      if (dirname(path) !== root) await rmdir(dirname(path)).catch(() => undefined)
    },
  }
}
