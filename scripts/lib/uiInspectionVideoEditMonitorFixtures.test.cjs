const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { buildSync } = require('esbuild')
const { dynamicSource, staticSource } = require('./uiInspectionVideoEditCodeControls.cjs')

test('监视器重建当前代码文件引用，保留音画压力样本且不依赖旧内联源码夹具', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-monitor-fixture-'))
  try {
    const output = path.join(root, 'factory.cjs')
    buildSync({ entryPoints: [path.join(__dirname, 'uiInspectionVideoEditMonitorFixtures.ts')], bundle: true, platform: 'node', format: 'cjs',
      // The isolated factory resolves runtime dependencies from this repository.
      nodePaths: [path.resolve('node_modules')], outfile: output })
    const media = [
      { id: 'video', name: 'video.mp4', path: path.join(root, 'video.mp4'), kind: 'video', durationSeconds: 3, width: 3840, height: 2160, hasAudio: false },
      { id: 'image', name: 'image.png', path: path.join(root, 'image.png'), kind: 'image', durationSeconds: 0, width: 3840, height: 2160 },
      { id: 'audio', name: 'audio.wav', path: path.join(root, 'audio.wav'), kind: 'audio', durationSeconds: 3, width: 0, height: 0, hasAudio: true },
    ]
    const original = { ...media[0], id: 'original', durationSeconds: 8 }
    const { project, pressure } = require(output).createMonitorFixtures(root, media, original, [dynamicSource, staticSource])
    for (const [index, definition] of project.codeMaterials.entries()) {
      const version = definition.versions[0]; const source = [dynamicSource, staticSource][index]
      assert.equal(version.entry, 'main.ts'); assert.equal(version.files.length, 1); assert.equal('source' in version, false)
      assert.equal(fs.readFileSync(version.files[0].location, 'utf8'), source)
      assert.equal(version.files[0].hash, createHash('sha256').update(source).digest('hex'))
      assert.ok(project.sequences[0].clips.some(clip => clip.code?.versionId === version.id))
    }
    assert.equal(project.items.find(item => item.code)?.code.parameters.speed, 80)
    assert.equal(project.sequences[0].clips.find(clip => clip.code?.parameters.speed === 80).track, 5)
    assert.deepEqual(project.sequences[0].captions, []); assert.deepEqual(project.sequences[0].markers, [])
    assert.equal(project.sequences[0].tracks[0].kind, 'audio'); assert.equal(project.sequences[0].tracks[1].kind, 'audio')
    assert.equal(pressure.sequences[0].clips.length, 500); assert.equal(pressure.sequences[0].captions.length, 500)
    assert.equal(pressure.sequences[0].tracks.length, 32); assert.equal(pressure.media[0].path, original.path)
    assert.equal(pressure.sequences[0].clips[1].sourceInUs, 1000000)
    assert.equal(media.length, 3)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
