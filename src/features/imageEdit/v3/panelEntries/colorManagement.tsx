import type { ImageEditorPanelDefinitionV3 } from '../panelFramework/panelRegistry';
import { ColorManagementPanelV3 } from '../panels/colorManagement/ColorManagementPanelV3';
const panels: readonly ImageEditorPanelDefinitionV3[] = [{ id: 'color', titleKey: 'imageEditor.v3.colorManagement.title', title: '颜色', order: 5, defaultPlacement: 'tab',
  component: ({ controller }) => <ColorManagementPanelV3 controller={controller} /> }];
export default panels;
