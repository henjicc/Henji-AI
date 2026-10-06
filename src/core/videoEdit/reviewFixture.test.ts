import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { videoEditDocumentSchema } from './document'

const require = createRequire(import.meta.url)
const { buildVideoEditReviewProject } = require('../../../scripts/lib/uiReviewVideoEditFixture.cjs') as {
  buildVideoEditReviewProject: (options: { id: string; name: string; source: string; captions: number }) => unknown
}

/** 界面核对步骤 `seedVideoEdit` 写出的剪辑必须是剪辑能打开的合法剪辑（5.5 第三批）。 */
describe('剪辑核对夹具剪辑', () => {
  it('满足剪辑文档结构', () => {
    const project = buildVideoEditReviewProject({ id: 'review-fixture', name: '核对-剪辑', source: 'C:/tmp/review-av.mp4', captions: 6 })
    const parsed = videoEditDocumentSchema.safeParse(project)
    expect(parsed.success ? 'ok' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe('ok')
  })
})
