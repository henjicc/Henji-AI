import { useImageEditorSessionStoreV3 } from '../store'
import { imageEditorToolRegistry } from '../toolFramework/builtInRegistry'
import type { ToolOptionsProps } from '../toolFramework/types'

/** Shell 02 consumes this slot; tool options have a single declaration in their entry. */
export function ImageEditorToolParametersV3(props: ToolOptionsProps): JSX.Element | null {
  const activeTool = useImageEditorSessionStoreV3(state => state.sessions[props.controller.sessionId]?.activeTool)
  const Options = activeTool ? imageEditorToolRegistry.get(activeTool)?.Options : undefined
  return Options ? <Options {...props} /> : null
}
