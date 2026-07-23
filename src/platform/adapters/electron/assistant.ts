import type { AssistantPlatform } from '@/platform/contracts/assistant'

const DOMAIN = 'assistant'

function getNativeAssistant(): NonNullable<typeof window.henjiNative>['assistant'] {
  const native = window.henjiNative
  if (!native?.assistant) throw new Error(`[platform:${DOMAIN}] henjiNative.assistant is not available`)
  return native.assistant
}

export function createElectronAssistant(): AssistantPlatform {
  return {
    publishHostContext: (snapshot) => getNativeAssistant().publishHostContext(snapshot),
    acknowledgeFrontendTool: (acknowledgement) => getNativeAssistant().acknowledgeFrontendTool(acknowledgement),
    completeFrontendTool: (result) => getNativeAssistant().completeFrontendTool(result),
    onFrontendToolRequest: (handler) => getNativeAssistant().onFrontendToolRequest(handler),
    onFrontendToolCancel: (handler) => getNativeAssistant().onFrontendToolCancel(handler),
  }
}
