import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry';
import { ImageEditorAdjustmentsPanelV3 } from '../panels/adjustments/ImageEditorAdjustmentsPanelV3';
const panels: readonly ImageEditorPanelDefinitionV3[] = [{
  id: 'adjustments', titleKey: 'imageEditor.v3.filterWorkspace.title', title: '调整与滤镜', order: 4, defaultPlacement: 'tab',
  component: ImageEditorAdjustmentsPanelV3,
}];
export default panels;
