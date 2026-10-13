import { UI_PANEL_WIDTH } from '@/core/theme/panelSizes'
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const IMAGE_EDITOR_INSPECTOR_DEFAULT_WIDTH = UI_PANEL_WIDTH.inspector.default;
export const IMAGE_EDITOR_INSPECTOR_MIN_WIDTH = UI_PANEL_WIDTH.inspector.min;
export const IMAGE_EDITOR_INSPECTOR_MAX_WIDTH = UI_PANEL_WIDTH.inspector.max;
export const IMAGE_EDITOR_TOOL_RAIL_WIDTH = UI_PANEL_WIDTH.rail;

export function clampImageEditorInspectorWidth(width: number): number {
  return Math.min(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH, Math.max(IMAGE_EDITOR_INSPECTOR_MIN_WIDTH, Math.round(width)));
}

export function clampImageEditorInspectorWidthToViewport(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(
    IMAGE_EDITOR_INSPECTOR_MIN_WIDTH,
    Math.min(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH, viewportWidth - 360)
  );
  return Math.min(viewportMax, clampImageEditorInspectorWidth(width));
}

interface ImageEditorUiState {
  activeInspectorToolId: string;
  inspectorWidth: number;
  inspectorCollapsed: boolean;
  setActiveInspectorToolId: (toolId: string) => void;
  setInspectorWidth: (width: number) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  resetInspector: () => void;
}

export const useImageEditorUiStore = create<ImageEditorUiState>()(
  persist(
    (set) => ({
      activeInspectorToolId: 'geometry',
      inspectorWidth: IMAGE_EDITOR_INSPECTOR_DEFAULT_WIDTH,
      inspectorCollapsed: false,
      setActiveInspectorToolId: (activeInspectorToolId) => set({ activeInspectorToolId }),
      setInspectorWidth: (inspectorWidth) => set({ inspectorWidth: clampImageEditorInspectorWidth(inspectorWidth) }),
      setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),
      resetInspector: () => set({
        inspectorWidth: IMAGE_EDITOR_INSPECTOR_DEFAULT_WIDTH,
        inspectorCollapsed: false,
      }),
    }),
    {
      name: 'henji-image-editor-ui',
      partialize: (state) => ({
        activeInspectorToolId: state.activeInspectorToolId,
        inspectorWidth: state.inspectorWidth,
        inspectorCollapsed: state.inspectorCollapsed,
      }),
    }
  )
);
