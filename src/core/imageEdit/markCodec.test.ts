import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  BLACK_HEX,
  WHITE_HEX,
} from '@/core/theme/colorTokens';
import { sanitizeMarkItem } from './markCodec';

describe('标注文字背景兼容', () => {
  it('保留独立文字的纯色背景，旧文字缺省时保持关闭', () => {
    expect(sanitizeMarkItem({
      id: 'text-with-background',
      type: 'text',
      x: 10,
      y: 20,
      text: '说明',
      color: BLACK_HEX,
      fontSize: 28,
      backgroundColor: WHITE_HEX,
    })).toMatchObject({ backgroundColor: WHITE_HEX });

    expect(sanitizeMarkItem({
      id: 'legacy-text',
      type: 'text',
      x: 10,
      y: 20,
      text: '旧文字',
      color: BLACK_HEX,
      fontSize: 28,
    })).not.toHaveProperty('backgroundColor');
  });

  it('保留标注标签背景，并在没有有效标签时不制造孤立背景属性', () => {
    expect(sanitizeMarkItem({
      id: 'callout',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
      label: '重点',
      labelBackgroundColor: WHITE_HEX,
    })).toMatchObject({ label: '重点', labelBackgroundColor: WHITE_HEX });

    expect(sanitizeMarkItem({
      id: 'plain-rect',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
      labelBackgroundColor: WHITE_HEX,
    })).not.toHaveProperty('labelBackgroundColor');
  });
});
