import { getImageEditorTool } from '../tools/registry';
import { useImageEditorUiStore } from '../store/imageEditorUiStore';

export function ImageToolInspector(): JSX.Element {
  const activeToolId = useImageEditorUiStore((state) => state.activeInspectorToolId);
  const definition = getImageEditorTool(activeToolId);
  if (!definition) {
    return <div className="flex flex-1 items-center justify-center p-4 text-xs text-text-muted">暂无参数面板</div>;
  }
  const Inspector = definition.inspector;
  return <Inspector />;
}
