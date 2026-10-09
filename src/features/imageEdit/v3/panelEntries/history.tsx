import { ImageEditorHistoryPanelV3 } from '../panels/history/ImageEditorHistoryPanelV3'
import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'

const panels: readonly ImageEditorPanelDefinitionV3[] = [{
  id: 'history', titleKey: 'imageEditor.v3.history.title', title: '历史', order: 2,
  defaultPlacement: 'tab', component: ImageEditorHistoryPanelV3,
}]
export default panels
