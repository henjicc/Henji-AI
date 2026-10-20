const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildPremiereMigration, sourceTime } = require('./premiereMigration.cjs')
const TICKS = 254016000000n
const tick = seconds => String(BigInt(seconds) * TICKS)
const file = path.resolve(path.sep, 'media', 'music.wav')
const clip = (id, start, end, extra = {}) => ({ id, name: '音乐', type: 'AudioClipTrackItem', start: tick(start), end: tick(end), in: tick(0), out: tick(end - start), mediaId: 'media', speed: '1', reverse: false, preservePitch: false, muted: false, effects: [], ...extra })
const track = (clips, transitions = []) => ({ id: 'audio-track', index: 0, name: '音乐', kind: 'audio', xml: '<Track/>', effects: [], clips, transitions })
const seq = (id, tracks) => ({ id, name: '同名序列', frameRect: '0,0,3840,2160', frameTicks: '4233600000', markers: [], tracks })
function build(sequences, media = [{ id: 'media', name: 'music.wav', path: file, streams: {} }], probes = new Map([[file, { streams: [{ codec_type: 'audio' }], format: { duration: '30' } }]])) {
  return buildPremiereMigration({ mainSequenceId: sequences[0].id, sequences, media, source: { sha256: 'test' } }, probes, { name: '迁移', documentId: 'migration' })
}

test('source ticks retain exact fractional microseconds', () => {
  const result = sourceTime('12345678912345')
  const actual = BigInt(result.sourceInUs) * TICKS * BigInt(result.sourceRemainder.denominator) + BigInt(result.sourceRemainder.numerator) * TICKS
  assert.equal(actual, 12345678912345n * 1000000n * BigInt(result.sourceRemainder.denominator))
  assert.ok(result.sourceRemainder.denominator <= 1000000)
})

test('Lumetri basic correction uses the existing color grader and preserves source values', () => {
  const effects = [{ id: 'lumetri', matchName: 'AE.ADBE Lumetri', parameters: [
    { ParameterID: '11', StartKeyframe: '0,0.7999998927116394,0', CurrentValue: '2' },
    { ParameterID: '12', StartKeyframe: '0,-19,0' },
    { ParameterID: '16', StartKeyframe: '0,-3,0' },
    { ParameterID: '20', StartKeyframe: '0,110,0' },
  ] }]
  const result = build([seq('main', [{ ...track([clip('graded', 0, 5, { type: 'VideoClipTrackItem', effects })]), kind: 'video' }])],
    [{ id: 'media', name: 'source.mp4', path: file, streams: {} }],
    new Map([[file, { streams: [{ codec_type: 'video', width: 3840, height: 2160, avg_frame_rate: '60/1' }], format: { duration: '30' } }]]))
  const grade = result.document.sequences[0].clips[0].effects[0]
  assert.equal(grade.builtin.id, 'color_grade')
  assert.deepEqual(grade.builtin.params, { temperature: 0, tint: 0, exposure: .7999998927116394, contrast: -19, highlights: 0, shadows: 0, whites: 0, blacks: -3, saturation: 10 })
  assert.ok(!result.evidence.limitations.some(item => item.text.includes('待适配画面效果')))
})

test('same-name music sequence becomes editable grouped clips with its transition', () => {
  const transition = { id: 'fade', start: tick(4), end: tick(6), alignment: tick(1), matchName: 'Constant Power' }
  const nested = seq('music', [track([clip('a', 0, 5, { tailTransition: 'fade' }), clip('b', 5, 10, { headTransition: 'fade' })], [transition])])
  const parent = seq('main', [track([clip('parent', 10, 18, { sequenceId: 'music', mediaId: undefined })])])
  const result = build([parent, nested]), main = result.document.sequences[0]
  assert.equal(result.document.sequences.length, 1)
  assert.deepEqual(main.clips.map(clip => [clip.start, clip.duration]), [[600, 300], [900, 180]])
  assert.equal(main.clips[0].groupId, main.clips[1].groupId)
  assert.equal(main.transitions.length, 1)
  assert.equal(main.transitions[0].leftClipId, main.clips[0].id)
  assert.equal(main.transitions[0].rightClipId, main.clips[1].id)
  assert.equal(main.transitions[0].durationFrames, 120)
  assert.ok(result.evidence.limitations.some(item => item.text.includes('试听')))
})

test('AudioFader mute survives direct tracks and flattened audio nesting', () => {
  const muted = { ...track([clip('sound', 0, 5)]), effects: [{ matchName: 'AudioFader', parameters: [{ Name: '静音', StartKeyframe: '0,true,0' }] }] }
  const direct = build([seq('main', [muted])])
  assert.equal(direct.document.sequences[0].tracks[0].muted, true)
  const nested = build([seq('main', [track([clip('parent', 0, 5, { sequenceId: 'nested', mediaId: undefined })])]), seq('nested', [muted])])
  assert.equal(nested.document.sequences[0].clips[0].volume, 0)
})

test('virtual carrier creates an explicit pending range, not a missing-file error', () => {
  const raw = { ...clip('black', 0, 5), type: 'VideoClipTrackItem', name: '黑场载体' }
  const result = build([seq('main', [{ ...track([raw]), kind: 'video' }])], [{ id: 'media', name: '虚拟', path: '1112293707', streams: {} }], new Map())
  assert.equal(result.document.media.length, 0)
  assert.equal(result.document.sequences[0].clips.length, 0)
  assert.equal(result.document.sequences[0].annotations[0].status, 'open')
  assert.match(result.document.sequences[0].annotations[0].text, /待重建/)
})

test('video and extracted sound share one file; visual clips do not double sound', () => {
  const video = clip('v', 0, 5, { type: 'VideoClipTrackItem' })
  const rawTrack = track([clip('a', 0, 5)])
  const result = build([seq('main', [{ ...track([video]), id: 'v', kind: 'video' }, rawTrack])], [{ id: 'media', name: 'source.mp4', path: file, streams: {} }], new Map([[file, { streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '60000/1001' }, { codec_type: 'audio' }], format: { duration: '30' } }]]))
  const clips = result.document.sequences[0].clips
  assert.equal(result.document.media.length, 1)
  assert.deepEqual(clips.map(clip => clip.sourceComponent), ['video', 'audio'])
  assert.equal(clips[0].scale, .5, 'PR original pixel size must be converted from native contain-fit')
  assert.deepEqual(result.document.media[0].frameRate, { numerator: 60000, denominator: 1001 })
})

test('extractor follows UUID references and ignores nested view-state ObjectID collisions', () => {
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const code = `import sys, gzip, struct, base64, xml.etree.ElementTree as E\nsys.path.insert(0, 'scripts/lib')\nfrom premiereMigrationExtract import ProjectGraph\nx=b'''<PremiereData><View ObjectID="view"><Nested ObjectID="1"/></View><Sequence ObjectUID="main"><Name>Same</Name><TrackGroups><TrackGroup><Second ObjectRef="1"/></TrackGroup></TrackGroups></Sequence><Sequence ObjectUID="backup"><Name>Same</Name></Sequence><VideoTrackGroup ObjectID="1"><TrackGroup><Tracks/><FrameRate>4233600000</FrameRate></TrackGroup><FrameRect>0,0,3840,2160</FrameRect></VideoTrackGroup></PremiereData>'''\ng=ProjectGraph(gzip.compress(x))\nresult=g.extract('main')\nassert len(result['sequences']) == 1\nassert result['sequences'][0]['frameRect'] == '0,0,3840,2160'\ndef string(s):\n b=s.encode('utf-8'); chunk=struct.pack('<I',len(b))+b+b'\\0'; return chunk+b'\\0'*((-len(chunk))%4)\nblock=E.fromstring('<Block><FormattedTextData/></Block>')\ng.ids['caption']=block\nitem=E.fromstring('<CaptionDataClipTrackItem ObjectID="caption-item"><BlockVector><BlockVectorItem ObjectRef="caption"/></BlockVector></CaptionDataClipTrackItem>')\ntext='字幕 text'\nblock[0].text=base64.b64encode(string(text)+string('HarmonyOS Sans')).decode()\nassert g.caption(item)==text\nblock[0].text=base64.b64encode(string(text)+string('另一句')).decode()\ntry:\n g.caption(item)\n raise AssertionError('Ambiguous caption must fail')\nexcept ValueError:\n pass\n`
  execFileSync(python, ['-B', '-c', code], { windowsHide: true })
})
