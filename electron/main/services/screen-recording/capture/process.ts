import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Fixed supervisor, never caller-supplied code. EOF means the owning application died or stopped. */
const SUPERVISOR = `
const { spawn } = require('node:child_process');
const child = spawn(process.argv[1], process.argv.slice(2), { windowsHide: true, stdio: 'pipe' });
let stopping = false, timer;
function stop() {
  if (stopping) return;
  stopping = true;
  child.stdin.end('q\\n');
  timer = setTimeout(() => child.kill(), 3000);
}
child.stdin.on('error', () => {});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdout.on('error', stop);
process.stderr.on('error', stop);
process.stdin.on('data', bytes => { if (!stopping) child.stdin.write(bytes); });
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('error', error => { process.stderr.write(error.message); });
child.on('close', code => { clearTimeout(timer); process.exitCode = code ?? 1; process.stdin.destroy(); });
`

/** Parent loss closes stdin; the supervisor seals/kills FFmpeg even after a hard application crash. */
export function spawnCaptureProcess(binary: string, args: string[]): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ['-e', SUPERVISOR, binary, ...args], { windowsHide: true, stdio: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const kill = child.kill.bind(child)
  child.kill = (signal): boolean => {
    if (process.platform !== 'win32' || !child.pid) return kill(signal)
    // Windows TerminateProcess does not run SIGTERM handlers. Target only this owned process tree.
    const reaper = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    reaper.on('error', () => { kill() })
    return true
  }
  return child
}
