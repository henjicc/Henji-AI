import { describe, expect, it } from 'vitest'

import type { MainLogEvent } from './types'
import { sanitizeImageEditorDiagnosticEvents } from './diagnostic-bundle'

function event(overrides: Partial<MainLogEvent>): MainLogEvent {
  return {
    timestamp: '2026-08-31T00:00:00.000Z',
    level: 'error',
    source: 'frontend',
    domain: 'features.imageEdit.v3.preview',
    event: 'image_editor_v3.preview.failed',
    message: 'failed /Users/private/photo.jpg?token=secret',
    ...overrides,
  }
}

describe('sanitizeImageEditorDiagnosticEvents', () => {
  it('仅保留图片编辑事件及白名单上下文', () => {
    const output = sanitizeImageEditorDiagnosticEvents([
      event({
        requestId: 'request-1',
        context: {
          documentId: 'doc-1',
          revision: 3,
          purpose: 'display',
          reason: 'https://example.test/image?token=secret',
          filePath: '/Users/private/photo.jpg',
          url: 'https://example.test/image?token=secret',
          annotationText: 'private words',
          apiKey: 'secret',
        },
      }),
      event({ domain: 'features.generation', event: 'generation.failed' }),
    ])
    expect(output).toEqual([expect.objectContaining({
      requestId: 'request-1',
      context: {
        documentId: 'doc-1',
        revision: 3,
        purpose: 'display',
        reason: '[redacted-url]',
      },
    })])
    const serialized = JSON.stringify(output)
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('example.test')
    expect(serialized).not.toContain('private words')
    expect(serialized).not.toContain('secret')
  })
})
