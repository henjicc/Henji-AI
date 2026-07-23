import type {
  FrontendToolAcknowledgement,
  FrontendToolCancel,
  FrontendToolRequest,
  FrontendToolResult,
  HostContextSnapshot,
} from '@/core/assistant/hostContracts'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'

export async function publishHostContext(snapshot: HostContextSnapshot): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.publishHostContext(snapshot)
}

export async function acknowledgeFrontendTool(acknowledgement: FrontendToolAcknowledgement): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.acknowledgeFrontendTool(acknowledgement)
}

export async function completeFrontendTool(result: FrontendToolResult): Promise<void> {
  if (!isDesktopRuntime()) return
  await getPlatform().assistant.completeFrontendTool(result)
}

export function onFrontendToolRequest(handler: (request: FrontendToolRequest) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.onFrontendToolRequest(handler)
}

export function onFrontendToolCancel(handler: (cancel: FrontendToolCancel) => void): () => void {
  if (!isDesktopRuntime()) return () => undefined
  return getPlatform().assistant.onFrontendToolCancel(handler)
}
