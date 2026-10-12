const { test } = require('node:test')
const assert = require('node:assert/strict')
const { violations } = require('./check-media-recycle.cjs')
test('reject direct managed media deletion; accept collector and documented temporary cleanup', () => {
  assert.equal(violations('electron/main/services/example.ts', 'const root = getGeneratedMediaDir();\nawait fs.rm(file)').length, 1)
  assert.deepEqual(violations('electron/main/services/example.ts', 'const root = getGeneratedMediaDir();\nenqueueMediaCandidates([file])'), [])
  assert.deepEqual(violations('electron/main/services/example.ts', 'getUploadsDir();\n// media-recycle-allow: unpublished temporary staging file only.\nawait fs.unlink(temporary)'), [])
  for (const file of ['image-editor-v3/resource-store', 'audio-edit/media', 'media/content-disk-cache', 'documents/covers', 'documents/session-state']) {
    assert.equal(violations(`electron/main/services/${file}.ts`, 'await fs.rm(file)').length, 1)
    assert.deepEqual(violations(`electron/main/services/${file}.ts`, 'await removeUnmanagedCachePath(file)'), [])
  }
})
