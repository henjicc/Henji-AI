import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { showAlertDialog } from '@/stores/alertDialogStore';

interface NodeGenerationErrorProps {
  message: string;
}

/**
 * 结果节点内的生成失败展示。
 *
 * 失败信息长短不可控（接口原样返回的报文可能很长），所以节点内只截断显示，
 * 完整内容交给统一弹窗，并在那里提供「复制错误详情」。
 */
export function NodeGenerationError({ message }: NodeGenerationErrorProps) {
  const { t } = useTranslation();

  return (
    /* 底色必须不透明：节点底层还在渲染"等待输出结果"占位，半透明会让两层文字叠在一起 */
    <div
      role="button"
      tabIndex={0}
      className="nodrag absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 bg-bg-dark px-4 text-center"
      onClick={(event) => {
        event.stopPropagation();
        showAlertDialog({
          title: t('common:error'),
          message,
          type: 'error',
          detail: message,
        });
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-red-500/10" />
      <AlertTriangle className="relative h-6 w-6 shrink-0 text-red-400" />
      <span className="relative line-clamp-3 text-[12px] leading-5 text-red-300">{message}</span>
      <span className="relative text-2xs text-red-400/70">{t('node.generationError.viewDetail')}</span>
    </div>
  );
}
