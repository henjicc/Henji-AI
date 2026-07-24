import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const IMAGE_EDITOR_INSPECTOR_DEFAULT_WIDTH = 320;
export const IMAGE_EDITOR_INSPECTOR_MIN_WIDTH = 248;
export const IMAGE_EDITOR_INSPECTOR_MAX_WIDTH = 460;
export const IMAGE_EDITOR_TOOL_RAIL_WIDTH = 52;

export function clampImageEditorInspectorWidth(width: number): number {
  return Math.min(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH, Math.max(IMAGE_EDITOR_INSPECTOR_MIN_WIDTH, Math.round(width)));
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
