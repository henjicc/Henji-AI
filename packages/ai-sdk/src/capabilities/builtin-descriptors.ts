import type { CapabilityDescriptor } from './types'

/** 仅用于统一发现；执行继续由 generation client 持有。 */
export const GENERATION_CAPABILITY_DESCRIPTOR: CapabilityDescriptor = {
  id: 'builtin.media-generation',
  kind: 'media-generation',
  contract: {
    input: [
      { kind: 'text' },
      { kind: 'image', multiple: true },
      { kind: 'video', multiple: true },
      { kind: 'audio', multiple: true },
    ],
    output: [
      { kind: 'image' },
      { kind: 'video' },
      { kind: 'audio' },
    ],
  },
}

/** 仅用于统一发现；执行继续由 LLM/chat client 持有。 */
export const CHAT_CAPABILITY_DESCRIPTOR: CapabilityDescriptor = {
  id: 'builtin.chat',
  kind: 'chat',
  contract: {
    input: [{ kind: 'text', required: true }],
    output: [
      { kind: 'text' },
      { kind: 'structured-data' },
    ],
  },
}
