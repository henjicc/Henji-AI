/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanoramaViewerModal } from './PanoramaViewerModal';

const mocks = vi.hoisted(() => ({
  resource: {
    status: 'ready' as const,
    displayUrl: 'panorama.png',
    image: {} as HTMLImageElement,
    width: 2048,
    height: 1024,
    isEquirectangular: true,
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

vi.mock('./usePanoramaImageResource', () => ({
  usePanoramaImageResource: () => mocks.resource,
}));

vi.mock('./PanoramaSphereCanvas', () => ({
  PanoramaSphereCanvas: () => <div data-testid="sphere-canvas" />,
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
});

describe('PanoramaViewerModal', () => {
  it('以球面模式打开，并可切换平面、导航和关闭', async () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    render(
      <PanoramaViewerModal
        open
        imageUrl="panorama.png"
        imageList={['panorama.png', 'next.png']}
        currentIndex={0}
        onClose={onClose}
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByRole('dialog', { name: 'viewer.panorama.title' })).toBeTruthy();
    expect(screen.getByTestId('sphere-canvas')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'viewer.panorama.flat' }));
    expect(screen.getByAltText('viewer.panorama.flatAlt')).toBeTruthy();

    fireEvent.click(screen.getByTitle('viewer.next'));
    expect(onNavigate).toHaveBeenCalledWith('next');
    fireEvent.click(screen.getByTitle('viewer.panorama.fullscreen'));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle('common.close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
