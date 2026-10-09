import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'
import { ImageEditorChannelsPanelV3 } from '../panels/channels/ImageEditorChannelsPanelV3'
const panels: readonly ImageEditorPanelDefinitionV3[] = [{
  id: 'channels', titleKey: 'imageEditor.v3.channels.title', title: '通道', order: 3, defaultPlacement: 'tab',
  component: ({ controller }) => <ImageEditorChannelsPanelV3 controller={controller} />,
}]
export default panels
