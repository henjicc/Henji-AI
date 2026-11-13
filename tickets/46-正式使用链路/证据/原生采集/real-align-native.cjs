// real-align-crop.cjs 的原生采集版：画面只有一个连续文件，文件位置按会话文档 media.gaps 换到会话时钟；
// 剪辑取光标时按“录制时间 = 片段起点 + 文件位置”（文件与录制时间都不含暂停），再按事件页的 monoUs−recordingUs 换回会话时钟。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs'), path = require('node:path')
const [ff, dir, docFile, flipLog] = process.argv.slice(2)
const doc = JSON.parse(fs.readFileSync(docFile, 'utf8')).content
const media = doc.media.find(m => m.kind === 'screen')
const fps = 60
const flips = fs.readFileSync(flipLog, 'utf8').trim().split(/\r?\n/).map(line => Math.round(Number(line.split(' ')[2]) * 1e6) - doc.originUs)
const events = fs.readdirSync(dir).filter(f => /^\d{16}-.*\.capture\.json$/.test(f)).sort().flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries)
const cursors = events.filter(e => e.kind === 'cursor' && e.point)
const cursorJumps = []
for (let i = 1; i < cursors.length; i++) if (Math.abs(cursors[i].point[0] - cursors[i - 1].point[0]) > 0.2) cursorJumps.push(cursors[i])
const sessionUs = fileUs => { let t = media.monoUs + fileUs; for (const g of media.gaps ?? []) if (t >= g.startUs) t += g.endUs - g.startUs; return t }
const text = execFileSync(ff, ['-v', 'error', '-i', media.path.replace('henji://user/', 'E:/文档/HenjiAI/'), '-vf', (process.env.CROP ? 'crop=' + process.env.CROP + ',' : '') + 'scale=64:36,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const y = [...text.matchAll(/YAVG=([0-9.]+)/g)].map(m => Number(m[1]))
const pictureFlips = []
for (let i = 1; i < y.length; i++) if ((y[i - 1] < 128) !== (y[i] < 128)) { const fileUs = i * 1e6 / fps; pictureFlips.push({ frame: i, fileUs, monoUs: sessionUs(fileUs) }) }
const runs = []
for (const e of events) { const offset = e.monoUs - e.recordingUs; if (runs.at(-1)?.offset !== offset) runs.push({ firstRec: e.recordingUs, lastUs: e.monoUs, offset }); else runs.at(-1).lastUs = e.monoUs }
const recordingStartUs = Math.max(0, media.monoUs - runs[0].offset)
const recToMono = rec => { const run = [...runs].reverse().find(r => r.firstRec <= rec) ?? runs[0]; return rec + run.offset }
const near = (list, t, key = 'monoUs') => list.reduce((best, item) => Math.abs(item[key] - t) < Math.abs(best[key] - t) ? item : best, list[0])
const rows = []
for (const truth of flips) {
  const picture = pictureFlips.length && near(pictureFlips, truth)
  if (!picture || Math.abs(picture.monoUs - truth) > 400_000) continue
  const jump = near(cursorJumps, truth)
  const lookupMonoUs = recToMono(recordingStartUs + picture.fileUs)
  const afterPause = (media.gaps ?? []).some(g => truth >= g.endUs)
  rows.push({ truthMs: +(truth / 1000).toFixed(1), afterPause, pictureMinusTruthMs: +((picture.monoUs - truth) / 1000).toFixed(1), cursorEventMinusTruthMs: jump ? +((jump.monoUs - truth) / 1000).toFixed(1) : null, editLookupMinusCursorEventMs: jump ? +((lookupMonoUs - jump.monoUs) / 1000).toFixed(1) : null, lookupMinusPictureMs: +((lookupMonoUs - picture.monoUs) / 1000).toFixed(3) })
}
const med = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
const stat = (key, filter = () => true) => med(rows.filter(filter).map(r => r[key]).filter(v => v != null))
console.log(JSON.stringify({ media: [media.monoUs, media.durationUs, media.gaps], runs: runs.map(r => [r.firstRec, r.offset]), flipsInPicture: rows.length, median: { editLookupMinusCursorEventMs: stat('editLookupMinusCursorEventMs'), before: stat('editLookupMinusCursorEventMs', r => !r.afterPause), after: stat('editLookupMinusCursorEventMs', r => r.afterPause), pictureMinusTruthMs: stat('pictureMinusTruthMs'), cursorEventMinusTruthMs: stat('cursorEventMinusTruthMs'), lookupMinusPictureMs: stat('lookupMinusPictureMs') }, rows }, null, 1))
