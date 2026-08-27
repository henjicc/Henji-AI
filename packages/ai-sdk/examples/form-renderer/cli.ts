import { createAIClient, type RuntimeContext } from '@henjicc/ai-sdk'

import { renderMinimalModelForm } from './index.js'

const runtime: RuntimeContext = {
  transport: { fetch: async () => { throw new Error('form-renderer does not access the network') } },
  credentials: { get: () => undefined },
  media: { read: async () => { throw new Error('form-renderer does not read media') } },
}

const modelIds = [
  'volcengine-seedream-5.0-lite',
  'apimart-gemini-omni-flash',
  'ppio-wan-2.7',
  'apimart-midjourney',
  'ppio-minimax-speech',
] as const

const client = createAIClient({ runtime })
try {
  const forms = modelIds.map((modelId) => renderMinimalModelForm(client, modelId))
  console.log(JSON.stringify(forms.map((form) => ({
    modelId: form.modelId,
    controlCount: form.controls.length,
    mediaKinds: [...new Set(form.controls.map((control) => control.mediaKind).filter(Boolean))],
    customControlIds: form.customControlIds,
    html: form.html,
  })), null, 2))
} finally {
  client.dispose()
}
