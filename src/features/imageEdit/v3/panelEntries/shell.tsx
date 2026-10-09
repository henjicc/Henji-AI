import { ImageEditorLayersPanelV3 } from '../editor/ImageEditorLayersPanelV3'
import { ImageEditorPropertiesPanelV3 } from '../editor/ImageEditorPropertiesPanelV3'
import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry'

const panels: readonly ImageEditorPanelDefinitionV3[] = [
  {
    id: 'layers',
    titleKey: 'imageEditor.v3.layers.title',
    title: '图层',
    order: 0,
    component: ({ controller }) => <ImageEditorLayersPanelV3 controller={controller} embedded />,
  },
  {
    id: 'properties',
    titleKey: 'imageEditor.v3.properties.title',
    title: '属性',
    order: 1,
    component: ({ controller }) => <ImageEditorPropertiesPanelV3 controller={controller} embedded />,
  },
]

export default panels
