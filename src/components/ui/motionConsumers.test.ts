import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_LOOP_MS } from './motion';

const root = path.resolve(__dirname, '../../..');
const consumers = [
  'src/components/mediaViewer/AudioViewerModal.tsx',
  'src/components/mediaViewer/VideoViewerModal.tsx',
  'src/components/mediaViewer/ImageViewerModal.tsx',
  'src/features/canvas/ui/specialInterfaces/panorama/PanoramaViewerModal.tsx',
  'src/components/ui/AlertDialog.tsx',
  'src/components/Settings/index.tsx',
  'src/components/ui/Tooltip.tsx',
  'src/components/ui/Dropdown.tsx',
  'src/components/ui/PanelTrigger.tsx',
  'src/contexts/NotificationContext.tsx',
  'src/workspaces/GenerationWorkspace/hooks/useToast.ts',
  'src/workspaces/GenerationWorkspace/components/TaskInputPreview.tsx',
];

describe('进出场单一实现契约', () => {
  it.each(consumers)('%s 委托公共生命周期，不再维护自己的卸载计时器', file => {
    const source = readFileSync(path.join(root, file), 'utf8');
    expect(source).toMatch(/useDialogTransition|useTimedToast/);
    expect(source).not.toMatch(/closeTimerRef|hideTimerRef|exitTimerRef|setTimeout\(finishClose/);
  });
  it('浮层使用具名常量，执行脉冲使用注册循环档与统一缓动', () => {
    for (const file of ['src/components/ui/Dropdown.tsx', 'src/components/ui/PanelTrigger.tsx']) {
      expect(readFileSync(path.join(root, file), 'utf8')).toContain('UI_POPOVER_TRANSITION_MS');
    }
    expect(UI_LOOP_MS).toHaveProperty('executing', 1500);
    const css = readFileSync(path.join(root, 'src/features/canvas/storyboard.css'), 'utf8');
    expect(css).toContain('animation: ui-canvas-node-executing-pulse var(--ui-loop-executing) var(--ui-ease) infinite');
  });
  it('中心页循环档有真实动画样本，并可停止/重放', () => {
    const gallery = readFileSync(path.join(root, 'src/features/devGallery/tokenSections.tsx'), 'utf8');
    expect(gallery).toContain('Object.entries(motion.UI_LOOP_MS)');
    for (const name of ['animate-spin', 'animate-pulse', 'canvas-node-paint-frame--executing']) expect(gallery).toContain(name);
  });
});
