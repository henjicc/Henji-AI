import { useImageEditorUiStore } from '../store/imageEditorUiStore';
import { ImageToolInspector } from './ImageToolInspector';
import { ImageToolRail } from './ImageToolRail';

export function ImageToolPanel(): JSX.Element {
  const collapsed = useImageEditorUiStore((state) => state.inspectorCollapsed);
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ImageToolRail />
      {!collapsed && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ImageToolInspector />
        </div>
      )}
    </div>
  );
}
