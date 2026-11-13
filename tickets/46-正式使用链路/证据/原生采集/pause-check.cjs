// 暂停对齐核对：事件时钟里的暂停 / 继续控制事件，对照会话文档的暂停与画面条目的空档（由逐帧时刻表推出），单位毫秒。
// 另给出“按下”的近似：暂停事件之前最后一个光标事件（事件输入在按下那一刻就停，光标约每 15 毫秒采一次）。
const fs = require('node:fs'), path = require('node:path')
const [dir, docFile] = process.argv.slice(2)
const doc = JSON.parse(fs.readFileSync(docFile, 'utf8')).content
const media = doc.media.find(m => m.kind === 'screen')
const events = fs.readdirSync(dir).filter(f => /^\d{16}-.*\.capture\.json$/.test(f)).sort().flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries)
const controls = events.filter(e => e.kind === 'control' && (e.action === 'pause' || e.action === 'resume'))
const cursors = events.filter(e => e.kind === 'cursor')
const ms = us => +(us / 1000).toFixed(2)
const rows = []
for (let i = 0; i < (media.gaps ?? []).length; i++) {
  const gap = media.gaps[i], pause = (doc.pauses ?? [])[i]
  const paused = controls.filter(c => c.action === 'pause')[i], resumed = controls.filter(c => c.action === 'resume')[i]
  const lastCursor = [...cursors].reverse().find(c => c.monoUs <= (paused?.monoUs ?? 0)), firstCursor = cursors.find(c => c.monoUs >= (resumed?.monoUs ?? Infinity))
  rows.push({
    gapMs: [ms(gap.startUs), ms(gap.endUs)], docPauseMs: pause && [ms(pause.startUs), ms(pause.endUs)],
    pauseEventMinusGapStartMs: paused && ms(paused.monoUs - gap.startUs), resumeEventMinusGapEndMs: resumed && ms(resumed.monoUs - gap.endUs),
    eventPausedLenMinusGapLenMs: paused && resumed && ms((resumed.monoUs - paused.monoUs) - (gap.endUs - gap.startUs)),
    lastCursorBeforePauseMs: lastCursor && paused && ms(lastCursor.monoUs - paused.monoUs), firstCursorAfterResumeMs: firstCursor && resumed && ms(firstCursor.monoUs - resumed.monoUs),
  })
}
console.log(JSON.stringify({ mediaMonoUs: media.monoUs, pauses: rows }, null, 1))
