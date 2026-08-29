import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistGenerationResult } from './mediaResultPersist';

const mocks = vi.hoisted(() => ({
  saveVideoFromUrl: vi.fn(),
  saveAudioFromUrl: vi.fn(),
  captureVideoPoster: vi.fn(),
  getAudioDuration: vi.fn(),
  prepareNodeImage: vi.fn(),
  releaseManaged: vi.fn(),
}));

vi.mock('@/utils/save', () => ({
  saveVideoFromUrl: mocks.saveVideoFromUrl,
  saveAudioFromUrl: mocks.saveAudioFromUrl,
}));
vi.mock('@/utils/mediaDimensions', () => ({ getAudioDuration: mocks.getAudioDuration }));
vi.mock('../application/imageData', () => ({
  prepareNodeImage: mocks.prepareNodeImage,
  resolveImageDisplayUrl: (value: string) => value,
}));
vi.mock('./videoPoster', () => ({ captureVideoPoster: mocks.captureVideoPoster }));
vi.mock('@/platform', () => ({
  getPlatform: () => ({ image: { releaseManagedGenerationMedia: mocks.releaseManaged } }),
}));

describe('persistGenerationResult 媒体所有权', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseManaged.mockResolvedValue(undefined);
    mocks.getAudioDuration.mockResolvedValue(4.5);
  });

  it('视频返回本次下载文件与新建 poster 的完整所有权', async () => {
    mocks.saveVideoFromUrl.mockResolvedValue({ fullPath: '/data/Media/video.mp4', created: true });
    mocks.captureVideoPoster.mockResolvedValue({
      posterUrl: '/data/Uploads/poster.jpg',
      aspectRatio: '16:9',
      durationSec: 8,
      createdFilePaths: ['/data/Uploads/poster.jpg'],
    });

    await expect(persistGenerationResult('video', 'https://example.test/video')).resolves.toEqual({
      patch: {
        videoUrl: '/data/Media/video.mp4',
        previewImageUrl: '/data/Uploads/poster.jpg',
        aspectRatio: '16:9',
        durationSec: 8,
      },
      createdFilePaths: ['/data/Media/video.mp4', '/data/Uploads/poster.jpg'],
    });
  });

  it('音频返回本次下载文件所有权，本地来源不冒充新建文件', async () => {
    mocks.saveAudioFromUrl.mockResolvedValue({ fullPath: '/data/Media/audio.mp3', created: true });
    await expect(persistGenerationResult('audio', 'https://example.test/audio')).resolves.toMatchObject({
      createdFilePaths: ['/data/Media/audio.mp3'],
    });
    await expect(persistGenerationResult('audio', '/existing/audio.mp3')).resolves.toMatchObject({
      createdFilePaths: [],
    });
    mocks.saveAudioFromUrl.mockResolvedValue({ fullPath: '/data/Media/existing.mp3', created: false });
    await expect(persistGenerationResult('audio', 'https://example.test/existing')).resolves.toMatchObject({
      createdFilePaths: [],
    });
  });

  it('视频已下载但 poster 阶段异常时立即回滚已取得的所有权', async () => {
    mocks.saveVideoFromUrl.mockResolvedValue({ fullPath: '/data/Media/video.mp4', created: true });
    mocks.captureVideoPoster.mockRejectedValue(new Error('poster failed'));

    await expect(persistGenerationResult('video', 'https://example.test/video')).rejects.toThrow('poster failed');
    expect(mocks.releaseManaged).toHaveBeenCalledWith(['/data/Media/video.mp4']);
  });
});
