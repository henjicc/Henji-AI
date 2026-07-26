import { UiEmpty } from '@/components/ui';
import { getImageEditorTool } from '../tools/registry';
import { useImageEditorUiStore } from '../store/imageEditorUiStore';

export function ImageToolInspector(): JSX.Element {
  const activeToolId = useImageEditorUiStore((state) => state.activeInspectorToolId);
  const definition = getImageEditorTool(activeToolId);
  if (!definition) {
    return <UiEmpty className="flex-1" size="sm" title="暂无参数面板" />;
  }
  const Inspector = definition.inspector;
  return <Inspector />;
}
