import { UiIconButton } from '@/components/ui';
import { getImageEditorTools } from '../tools/registry';
import { useImageEditorUiStore } from '../store/imageEditorUiStore';

export function ImageToolRail(): JSX.Element {
  const activeToolId = useImageEditorUiStore((state) => state.activeInspectorToolId);
  const setActiveToolId = useImageEditorUiStore((state) => state.setActiveInspectorToolId);
  const tools = getImageEditorTools();

  return (
    <nav aria-label="图片编辑工具" className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-r border-border-dark p-2">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <UiIconButton
            key={tool.id}
            type="button"
            active={activeToolId === tool.id}
            title={tool.label}
            aria-label={tool.label}
            onClick={() => setActiveToolId(tool.id)}
          >
            <Icon className="h-4 w-4" />
          </UiIconButton>
        );
      })}
    </nav>
  );
}
