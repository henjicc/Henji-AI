import { expect, it } from 'vitest'
import { spawnCaptureProcess } from './process'
it('parent pipe EOF terminates the owned capture child and waits for its closed output', async () => {
  const child = spawnCaptureProcess(process.execPath, ['-e', 'process.stdout.write("ready\\n"); process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("sealed\\n"));'])
  let output = ''
  const closed = new Promise<number | null>(resolve => child.once('close', resolve))
  child.stdout.on('data', (data: Buffer) => { output += data.toString() })
  try {
    await viWait(() => output.includes('ready'))
    child.stdin.end()
    expect(await closed).toBe(0)
    expect(output).toContain('sealed')
  } finally { if (child.exitCode === null) child.kill() }
}, 10000)
async function viWait(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)) }
  throw new Error('采集看护进程未启动')
}
