import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { RecordingCollector } from './RecordingCollector'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { recordingUncertaintyP95, correlateRecordingClock } from '@/core/audioEdit/recordingClock'

it('E09 延长墙钟与100000个事件分批封页，全尾部读回；记录合成时钟与吞吐证据',async()=>{
  const count=100_000;let records=0;let bytes=0;let pages=0;let lastSeq=-1;let maxPage=0
  const collector=new RecordingCollector(recordingFixtureSession(),async page=>{
    pages++;records+=page.count;bytes+=Buffer.byteLength(JSON.stringify(page));maxPage=Math.max(maxPage,page.count);lastSeq=Math.max(lastSeq,page.seqSpan[1])
  },()=>{})
  const rssStart=process.memoryUsage().rss;const started=performance.now();collector.start(0)
  for(let i=1;i<=count;i++){collector.record(i*36_000,{kind:'control',action:'property-mode'});if(i%2048===0)await collector.flush()}
  collector.stop(count*36_000+1);await collector.flush()
  const durationMs=performance.now()-started
  const errors=Array.from({length:1000},(_,i)=>Math.abs(Math.round(i*1_000_000/48000)-i*1_000_000/48000))
  const calibration=correlateRecordingClock({originMs:0,beforeMs:200,afterMs:200.2,currentSeconds:1,timestamp:{contextTime:1,performanceTime:1000},sampleRate:48000,baseLatency:.01,inputLatency:.02})
  const metrics={fixture:'synthetic-software-clock-only',events:records,pages,bytes,maxPage,count,wallSpanUs:count*36_000,durationMs,eventsPerSecond:records*1000/durationMs,rssStart,rssEnd:process.memoryUsage().rss,sampleRate:48000,sampleQuantizationP95Us:recordingUncertaintyP95(errors),declaredLatencyEstimatedUncertaintyP95Us:calibration.uncertaintyUs,physicalInputAndDisplayP95Us:null}
  fs.writeFileSync(path.join(os.tmpdir(),'henji-t148-recording-metrics.json'),JSON.stringify(metrics,null,2))
  expect(records).toBe(count+2);expect(lastSeq).toBe(count+1);expect(maxPage).toBeLessThanOrEqual(256);expect(pages).toBeGreaterThan(390);expect(metrics.sampleQuantizationP95Us).toBeLessThanOrEqual(.5)
})
