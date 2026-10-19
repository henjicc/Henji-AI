const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditProjectCard, leaveVideoEditProject, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')

/** Explicit developer migration, opt-in only; never overwrites an existing document. */
function createPremiereMigrationScene() {
  return { id: 'video-edit-premiere-migration', surface: '剪辑', name: '剪辑-真实PR工程原生迁移与重开', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const input = process.env.HENJI_PREMIERE_MIGRATION_DOCUMENT
      assert.ok(input, '必须显式指定已经审查的迁移文档')
      const { videoEditDocumentSchema } = loadTypeScript('scripts/lib/premiereMigrationModel.ts')
      const model = videoEditDocumentSchema.parse(JSON.parse(fs.readFileSync(input, 'utf8')))
      const extraction = JSON.parse(fs.readFileSync(process.env.HENJI_PREMIERE_MIGRATION_SOURCE, 'utf8'))
      const sourceHash = () => crypto.createHash('sha256').update(fs.readFileSync(extraction.source.path)).digest('hex')
      assert.equal(sourceHash(), extraction.source.sha256, '源PR工程在提取后发生变化，应重新调查')
      for (const media of model.media) assert.ok(fs.existsSync(media.path), `缺少素材：${media.name}`)
      const { format: _format, version: _version, id, name, revision: _revision, ...content } = model
      const release = await blockPaidGeneration(app)
      let created
      try {
        created = await page.evaluate(async ({ id, name, content }) => {
          const documents = window.henjiNative.documents
          const existing = (await documents.listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: false })).find(meta => meta.id === id)
          if (existing) {
            // Allow read-only verification on retry, but never replace user edits.
            const project = (await documents.listProjects({ includeDrafts: true })).find(project => project.id === existing.container.projectId)
            return { projectId: project.id, projectPath: project.path, documentId: existing.id, file: existing.path, reused: true }
          }
          const project = await documents.createProject({ name })
          const result = await documents.createDocument({ id, kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name, content })
          await documents.setProjectMainDocument({ projectId: project.id, documentId: result.meta.id })
          return { projectId: project.id, projectPath: project.path, documentId: result.meta.id, file: result.meta.path, reused: false }
        }, { id, name, content })
        const read = () => {
          const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...saved } = readVideoEditFile(created.file)
          return saved
        }
        assert.deepEqual(read(), content, '落盘内容不一致；重试不会覆盖已有工程，请检查用户是否已有修改')
        await openVideoEditProjectCard(page, created.projectId)
        await presented(page, 0)
        await capture('premiere-native-migration-open')
        const clock = page.getByRole('spinbutton', { name: '当前时间码', exact: true })
        await clock.press('Enter')
        const timeInput = page.getByRole('textbox', { name: '当前时间码（输入时间）', exact: true })
        await timeInput.fill('00:01:40:00'); await timeInput.press('Enter')
        await presented(page, 6000)
        await capture('premiere-native-migration-footage')
        await leaveVideoEditProject(page, null)
        await openVideoEditProjectCard(page, created.projectId)
        assert.deepEqual(read(), content, '关闭重开后改变了工程内容')
        assert.equal(sourceHash(), extraction.source.sha256, '迁移不得改变原PR工程')
        const file = path.resolve(process.env.HENJI_PREMIERE_MIGRATION_RESULT || '.tmp/premiere-migration-created.json')
        fs.writeFileSync(file, JSON.stringify({ ...created, sourceUnchanged: true, reopened: true, statistics: { media: model.media.length, sequences: model.sequences.length, mainClips: model.sequences[0].clips.length, captions: model.sequences[0].captions?.length ?? 0 } }, null, 2))
      } finally { await release() }
    },
  }
}
module.exports = { createPremiereMigrationScene }
