import fs from 'node:fs'
import path from 'node:path'
import { getProgramDataDir } from './appBasePaths'

/*
 * 助手命令行与模型验证进程有意与带窗口的主应用并存，共用同一份数据库和程序目录。
 * 它们运行期间各留一个以进程号命名的标记文件，主应用据此避开整库压缩这类假设只有自己在用数据的维护。
 * 异常退出不会删标记，所以读到标记时按进程号判断：进程已不在就是陈旧标记，顺手删掉。
 */

function markerDirectory(): string {
  return path.join(getProgramDataDir(), 'command-line-processes')
}

export function holdCommandLineMarker(): void {
  const directory = markerDirectory()
  const marker = path.join(directory, String(process.pid))
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(marker, '')
  process.once('exit', () => { fs.rmSync(marker, { force: true }) })
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

/** 此刻是否有其他命令行进程在用数据。读不了目录时按“有”处理，宁可跳过维护。 */
export function isCommandLineProcessRunning(): boolean {
  let names: string[]
  try { names = fs.readdirSync(markerDirectory()) }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT' }
  for (const name of names) {
    const pid = Number(name)
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue
    if (processAlive(pid)) return true
    fs.rmSync(path.join(markerDirectory(), name), { force: true })
  }
  return false
}
