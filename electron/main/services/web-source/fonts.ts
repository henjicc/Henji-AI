import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { discoverSystemFonts, fontDirectories } from '../fonts/discovery'
import { hashWebSourceFiles } from './hashes'

/** 系统字体全字节进入签名，监视只负责立即作废；发布前再枚举散列，不以 mtime 证明相等。 */
export class WebCacheFonts {
  private readonly watchers: fs.FSWatcher[] = []
  private changed = false
  private changeReason?: string
  private checks: Promise<void> = Promise.resolve()
  private pendingChecks = 0
  private signatureValue = ''
  private constructor(private readonly roots: string[]) {}
  get signature(): string { return this.signatureValue }

  static async begin(signal?: AbortSignal, roots = fontDirectories()): Promise<WebCacheFonts> {
    const snapshot = new WebCacheFonts(roots)
    try {
      const discovered = await discoverSystemFonts(roots)
      if (discovered.failures.length) throw new Error('系统字体枚举不完整')
      const identities = new Map(await Promise.all(discovered.files.map(async file => [file, await fontIdentity(file)] as const)))
      for (const directory of new Set([...roots, ...discovered.files.map(file => path.dirname(file))])) {
        let existing = directory
        while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing)
        const watcher = fs.watch(existing, { recursive: true, persistent: false }, (event, name) => {
          if (!name) { snapshot.changed = true; snapshot.changeReason = event; return }
          const changed = path.resolve(existing, String(name))
          const relative = path.relative(directory, changed)
          if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return
          // libuv 在 Windows 同时订阅 LAST_ACCESS。读字体自身产生的事件只能由不含 atime 的身份排除；最终仍核完整字节。
          snapshot.pendingChecks++
          snapshot.checks = snapshot.checks.then(async () => {
            if (event === 'change' && identities.has(changed) && identities.get(changed) === await fontIdentity(changed)) return
            snapshot.changed = true; snapshot.changeReason = `${event}: ${String(name)}`
          }).catch(error => { snapshot.changed = true; snapshot.changeReason = String(error) }).finally(() => { snapshot.pendingChecks-- })
        })
        watcher.on('error', error => { snapshot.changed = true; snapshot.changeReason = error.message })
        snapshot.watchers.push(watcher)
      }
      const signature = await snapshot.hash(signal)
      await snapshot.checks
      if (!snapshot.current) throw new Error(`系统字体在登记期间变化：${snapshot.changeReason}`)
      snapshot.signatureValue = signature
      return snapshot
    } catch (error) { snapshot.close(); throw error }
  }

  private async hash(signal?: AbortSignal): Promise<string> {
    const result = await discoverSystemFonts(this.roots)
    if (result.failures.length) throw new Error('系统字体枚举不完整')
    return (await hashWebSourceFiles(result.files.sort().map(file => ({ relative: file, file })), signal)).contentHash
  }
  get current(): boolean { return !this.changed && !this.pendingChecks }
  async check(): Promise<boolean> { await this.checks; return this.current }
  async validate(signal?: AbortSignal): Promise<boolean> {
    if (!await this.check()) return false
    const signature = await this.hash(signal)
    await this.checks
    if (signature !== this.signature) this.changed = true
    return this.current
  }
  close(): void { this.changed = true; for (const watcher of this.watchers.splice(0)) watcher.close() }
}

async function fontIdentity(file: string): Promise<string> {
  const stat = await fsp.stat(file, { bigint: true })
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':')
}
