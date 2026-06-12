import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

import { readImageInfo, type ImageInfoResult } from '@/commands/image';
import { createLogger } from '@/core/logging';
import { UiIconButton } from '@/components/ui';
import { useSettingsStore } from '@/stores/settingsStore';

const logger = createLogger('components.mediaViewer.ImageInfoPanel');

interface ImageInfoPanelProps {
  open: boolean;
  /** 原始图片来源（本地路径或 URL，非 convertFileSrc 结果） */
  imageSource: string;
}

function approximateAspectRatio(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  let bestCandidate: [number, number] = [1, 1];
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let left = 1; left <= 20; left += 1) {
    for (let right = 1; right <= 20; right += 1) {
      const delta = Math.abs(left / right - ratio);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestCandidate = [left, right];
      }
    }
  }

  return `${bestCandidate[0]}:${bestCandidate[1]}`;
}

/** 图片信息浮层（分辨率/大小/比例/创建时间），Tab 或按钮切换折叠 */
export function ImageInfoPanel({ open, imageSource }: ImageInfoPanelProps): JSX.Element | null {
  const { t, i18n } = useTranslation();
  const enabled = useSettingsStore((state) => state.enableImageViewerInfoPanel);
  const collapsed = useSettingsStore((state) => state.imageViewerInfoPanelCollapsed);
  const setCollapsed = useSettingsStore((state) => state.setImageViewerInfoPanelCollapsed);

  const [info, setInfo] = useState<ImageInfoResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!enabled || !open || !imageSource) {
      setInfo(null);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setInfo(null);

    void readImageInfo(imageSource)
      .then((result) => {
        if (cancelled) return;
        setInfo(result);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        logger.warn('[ImageInfoPanel] 读取图片信息失败', error);
        setInfo(null);
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, imageSource, open]);

  // Tab 键切换折叠
  useEffect(() => {
    if (!enabled || !open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collapsed, enabled, open, setCollapsed]);

  const infoRows = useMemo(() => {
    if (!info) {
      return [];
    }
    const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
    const byteFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

    const formatBytes = (value: number): string => {
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${byteFormatter.format(value / 1024)} KB`;
      if (value < 1024 * 1024 * 1024) return `${byteFormatter.format(value / (1024 * 1024))} MB`;
      return `${byteFormatter.format(value / (1024 * 1024 * 1024))} GB`;
    };
    const formatDate = (value: number | null): string =>
      typeof value === 'number' && Number.isFinite(value)
        ? dateFormatter.format(value)
        : t('viewer.unknown', '未知');

    return [
      { label: t('viewer.resolution', '分辨率'), value: `${info.width} x ${info.height} px` },
      { label: t('viewer.fileSize', '文件大小'), value: formatBytes(info.fileSizeBytes) },
      { label: t('viewer.aspectRatio', '宽高比'), value: approximateAspectRatio(info.width, Math.max(1, info.height)) },
      { label: t('viewer.createdAt', '创建时间'), value: formatDate(info.createdAt) },
    ];
  }, [i18n.language, info, t]);

  if (!enabled || !open) {
    return null;
  }

  return (
    <div className="absolute left-5 top-5 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-2">
      <UiIconButton
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="!h-9 !w-9 shrink-0 !rounded-full !border-white/15 !bg-black/55 !text-white backdrop-blur-xl hover:!bg-black/70"
        title={t('viewer.toggleInfo', '显示/隐藏图片信息（Tab）')}
      >
        <Info className="h-4 w-4" />
      </UiIconButton>

      <div
        className={`overflow-hidden rounded-xl border border-white/10 bg-black/45 text-white shadow-lg backdrop-blur-md transition-opacity duration-200 ${
          collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        aria-hidden={collapsed}
      >
        <div className="px-3 py-2.5">
          {status === 'loading' && (
            <p className="text-xs leading-5 text-white/70">{t('viewer.infoLoading', '正在读取图片信息…')}</p>
          )}
          {status === 'error' && (
            <p className="text-xs leading-5 text-white/70">{t('viewer.infoUnavailable', '图片信息不可用')}</p>
          )}
          {status === 'ready' && (
            <div className="space-y-1 text-xs leading-5">
              {infoRows.map((item) => (
                <p key={item.label} className="break-words text-white/85">
                  <span className="mr-2 text-white/50">{item.label}</span>
                  <span>{item.value}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
