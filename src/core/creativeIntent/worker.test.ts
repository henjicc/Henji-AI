import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'

// Real worker_threads runs the exact portable kernel. Bundling is test tooling, not a second executor.
const workerSource = `
  import { parentPort } from 'node:worker_threads';
  import { createMotionFixture } from './src/core/creativeIntent/fixtures/motionFixtures';
  import { optimizeMotionBatches, optimizeMotionDraft } from './src/core/creativeIntent/candidates';
  for (let i=0;i<5;i++) optimizeMotionDraft(createMotionFixture('S02').input);
  parentPort.postMessage({kind:'ready'});
  parentPort.on('message', async ({count, flag}) => {
    const atomic=new Int32Array(flag); const before=process.memoryUsage(); let peakHeap=before.heapUsed; let peakRss=before.rss; const checkpoints=[]; let samples=0; let completed=0; let tail=-1;
    const started=performance.now();
    async function* inputs() {
      for(let i=0;i<count;i++) {
        const f=createMotionFixture('S02'); const frameOffset=i*180; const monoOffset=i*3000000;
        for(const s of f.input.samples) {s.monoUs+=monoOffset;s.seq+=i*361;s.timeline.frame+=frameOffset;}
        const t=f.input.draft.takes[0];t.monoSpanUs=[monoOffset,monoOffset+3000000];t.timelineRange=[frameOffset,frameOffset+180];
        f.input.draft.clockSegments[0].monoSpanUs=[monoOffset,monoOffset+3000000];
        samples+=f.input.samples.length; yield f.input;
      }
    }
    try {
      for await(const partial of optimizeMotionBatches(inputs(),{cancelled:()=>Atomics.load(atomic,0)!==0,checkpoint:()=>new Promise(r=>setImmediate(r))})) {
        completed++;tail=partial.result.candidates[0].motions[0].range[1];
        const usage=process.memoryUsage();peakHeap=Math.max(peakHeap,usage.heapUsed);peakRss=Math.max(peakRss,usage.rss);
        if(completed===1)parentPort.postMessage({kind:'progress'});
        if(completed===600||completed===1200)checkpoints.push({completed,heap:usage.heapUsed,rss:usage.rss});
      }
      parentPort.postMessage({kind:'done',completed,samples,tail,elapsedMs:performance.now()-started,heapIncrement:peakHeap-before.heapUsed,rssIncrement:peakRss-before.rss,checkpoints});
    } catch(error) {parentPort.postMessage({kind:'cancelled',completed,elapsedMs:performance.now()-started,message:error.message});}
  });
`
const entry = '\0creative-intent-worker-benchmark'
const built = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'creative-intent-worker-benchmark', resolveId: id => id === entry ? entry : null, load: id => id === entry ? workerSource : null }], build: { ssr: true, write: false, minify: false, rollupOptions: { input: entry, output: { format: 'cjs', inlineDynamicImports: true } } } })
const bundle = Array.isArray(built) ? built[0] : built
if (!('output' in bundle)) throw new Error('Worker benchmark requires a bundled output')
const chunk = bundle.output.find(output => output.type === 'chunk')
if (!chunk || chunk.type !== 'chunk') throw new Error('Worker benchmark entry missing')
const workerCode = chunk.code

interface WorkerReport { kind: string; completed?: number; samples?: number; tail?: number; elapsedMs?: number; heapIncrement?: number; rssIncrement?: number; checkpoints?: { completed: number; heap: number; rss: number }[]; message?: string }
async function runWorker(count: number, cancel: boolean): Promise<{ report: WorkerReport; cancellationMs: number }> {
  // Dedicated process makes RSS attributable to this workload instead of all Vitest worker threads.
  const child = spawn(process.execPath, ['-'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const script = `const {Worker}=require('node:worker_threads');const w=new Worker(${JSON.stringify(workerCode)},{eval:true});const flag=new SharedArrayBuffer(4);let at=0;
    w.on('error',e=>{process.stderr.write(e.stack);w.terminate().then(()=>process.exit(1));});
    w.on('message',r=>{if(r.kind==='ready')w.postMessage({count:${count},flag});if(${cancel}&&r.kind==='progress'){at=performance.now();Atomics.store(new Int32Array(flag),0,1);}if(r.kind==='done'||r.kind==='cancelled'){const result={report:r,cancellationMs:at?performance.now()-at:0};w.terminate().then(()=>process.stdout.write(JSON.stringify(result)));}});`
  let stdout = ''; let stderr = ''
  const result = new Promise<{ report: WorkerReport; cancellationMs: number }>((resolve, reject) => {
    child.on('error', reject); child.stdout.on('data', (b: Buffer) => { stdout += b.toString() }); child.stderr.on('data', (b: Buffer) => { stderr += b.toString() })
    child.on('close', code => { if (code !== 0) reject(new Error(stderr || `worker process exit ${code}`)); else { try { resolve(JSON.parse(stdout) as { report: WorkerReport; cancellationMs: number }) } catch (e) { reject(e) } } })
  })
  child.stdin.end(script)
  return result
}

describe('portable kernel in a real Worker', () => {
  it('S18 streams 1h/1200 takes through the tail without accumulating raw pages', async () => {
    const result = await runWorker(1200, false)
    expect(result.report.kind).toBe('done'); expect(result.report.completed).toBe(1200); expect(result.report.samples).toBe(433200); expect(result.report.tail).toBe(216000)
    expect(result.report.heapIncrement).toBeLessThanOrEqual(256 * 1024 ** 2)
    expect(result.report.rssIncrement).toBeLessThanOrEqual(256 * 1024 ** 2)
    if (process.env.HENJI_P1_BENCH_DIR) writeFileSync(join(process.env.HENJI_P1_BENCH_DIR, 'worker-long.json'), JSON.stringify(result, null, 2))
  }, 60000)
  it('SharedArrayBuffer cancellation interrupts bounded computation without a completed partial draft', async () => {
    const result = await runWorker(1200, true)
    expect(result.report.kind).toBe('cancelled'); expect(result.report.message).toContain('取消'); expect(result.report.completed).toBeLessThan(1200); expect(result.cancellationMs).toBeLessThanOrEqual(100)
    if (process.env.HENJI_P1_BENCH_DIR) writeFileSync(join(process.env.HENJI_P1_BENCH_DIR, 'worker-cancel.json'), JSON.stringify(result, null, 2))
  }, 15000)
})
