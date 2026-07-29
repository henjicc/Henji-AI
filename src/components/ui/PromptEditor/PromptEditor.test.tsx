/** @vitest-environment jsdom */

import { createRef } from 'react'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TextSelection } from '@tiptap/pm/state'
import { findSuggestionMatch } from '@tiptap/suggestion'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPlainTextPromptDocument,
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

import { PromptEditor } from './PromptEditor'
import { PromptEditor as PublicPromptEditor } from './PromptEditorFacade'
import { MediaReferenceExtension } from './extensions/mediaReference'
import { PROMPT_MEDIA_REFERENCE_ALLOWED_PREFIXES } from './extensions/suggestionConfig'
import { TemplateVariableExtension } from './extensions/templateVariable'
import { fromTiptapContent, toTiptapContent } from './promptEditorDocument'
import { PromptEditorResourceRegistry } from './resourceRegistry'
import type { PromptEditorHandle } from './types'

afterEach(cleanup)

describe('PromptEditor', () => {
  it('媒体引用可在中文等任意字符后触发', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text],
      content: '<p>测试@</p>',
    })
    const match = findSuggestionMatch({
      char: '@',
      allowSpaces: false,
      allowToIncludeChar: false,
      allowedPrefixes: PROMPT_MEDIA_REFERENCE_ALLOWED_PREFIXES,
      startOfLine: false,
      $position: TextSelection.atEnd(editor.state.doc).$from,
    })

    expect(match).toMatchObject({ query: '', text: '@' })
    editor.destroy()
  })

  it('粘贴文本仅把当前存在的媒体标签升级为紧凑引用节点', async () => {
    const ref = createRef<PromptEditorHandle>()
    const references = [{
      resourceId: 'asset:a',
      mediaType: 'image' as const,
      label: '图片1',
      legacyLabels: ['图1', '图 1', '图片 1'],
    }]
    const rendered = render(
      <PromptEditor
        ref={ref}
        value={createPlainTextPromptDocument('')}
        onChange={vi.fn()}
        ariaLabel="粘贴媒体引用"
        preset="media-references"
        references={references}
      />,
    )

    fireEvent.paste(rendered.getByRole('textbox'), {
      clipboardData: {
        getData: (type: string) => type === 'text/plain' ? '参考 图片 1 然后修改' : '',
      },
    })

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-reference-id="asset:a"]')).not.toBeNull()
    })
    expect(ref.current?.getDocument().content[0].content).toEqual([
      { type: 'text', text: '参考' },
      {
        type: 'mediaReference',
        attrs: {
          resourceId: 'asset:a',
          mediaType: 'image',
          fallbackLabel: '图片1',
        },
      },
      { type: 'text', text: '然后修改' },
    ])
    expect(toModelPromptText(ref.current?.getDocument() ?? createPlainTextPromptDocument(''), {
      references,
    })).toBe('参考 图片1 然后修改')
  })

  it('静态模式不创建 contenteditable 或 Tiptap 实例', () => {
    const value = createPlainTextPromptDocument('静态提示词')
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        value={value}
        onChange={vi.fn()}
        ariaLabel="静态提示词"
      />,
    )

    expect(rendered.container.querySelector('[contenteditable]')).toBeNull()
    expect(rendered.getByRole('textbox').textContent).toContain('静态提示词')
  })

  it('静态态与编辑态遵循相同的外层、壳层和内容层样式契约', () => {
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        value={createPlainTextPromptDocument('盒模型一致')}
        onChange={vi.fn()}
        ariaLabel="静态盒模型"
        className="outer-box"
        editorShellClassName="shell-box"
        editorClassName="content-box"
      />,
    )

    const content = rendered.getByRole('textbox')
    const shell = content.parentElement
    const outer = shell?.parentElement
    expect(outer?.classList.contains('outer-box')).toBe(true)
    expect(shell?.classList.contains('shell-box')).toBe(true)
    expect(content.classList.contains('content-box')).toBe(true)
    expect(outer?.classList.contains('content-box')).toBe(false)
    expect(shell?.classList.contains('content-box')).toBe(false)
  })

  it('填充滚动布局在静态态建立单一内容滚动容器', () => {
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        layout="fill-scroll"
        value={createPlainTextPromptDocument('长提示词')}
        onChange={vi.fn()}
        ariaLabel="静态滚动布局"
      />,
    )

    const content = rendered.getByRole('textbox')
    const shell = content.parentElement
    const outer = shell?.parentElement
    expect(outer?.classList.contains('min-h-0')).toBe(true)
    expect(shell?.classList.contains('overflow-hidden')).toBe(true)
    expect(content.classList.contains('overflow-y-auto')).toBe(true)
    expect(content.classList.contains('overscroll-contain')).toBe(true)
    expect(content.classList.contains('min-h-[92px]')).toBe(false)
  })

  it('填充滚动布局在编辑态复用同一尺寸契约', async () => {
    const rendered = render(
      <PublicPromptEditor
        mode="edit"
        layout="fill-scroll"
        value={createPlainTextPromptDocument('长提示词')}
        onChange={vi.fn()}
        ariaLabel="编辑滚动布局"
      />,
    )

    const content = await rendered.findByRole('textbox')
    const shell = content.parentElement
    const outer = shell?.parentElement
    expect(outer?.classList.contains('min-h-0')).toBe(true)
    expect(shell?.classList.contains('overflow-hidden')).toBe(true)
    expect(content.classList.contains('overflow-y-auto')).toBe(true)
    expect(content.classList.contains('min-h-[92px]')).toBe(false)
  })

  it('编辑器完成 Tiptap mount 后通知调用方就绪', async () => {
    const onReady = vi.fn()
    render(
      <PromptEditor
        value={createPlainTextPromptDocument('就绪')}
        onChange={vi.fn()}
        onReady={onReady}
        ariaLabel="编辑器就绪"
      />,
    )

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
  })

  it('静态激活把鼠标点击坐标交给按需挂载的编辑器', () => {
    const onActivate = vi.fn()
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        value={createPlainTextPromptDocument('点击中间')}
        onChange={vi.fn()}
        onActivate={onActivate}
        ariaLabel="点击定位"
      />,
    )

    fireEvent.click(rendered.getByRole('textbox'), { clientX: 126, clientY: 88 })

    expect(onActivate).toHaveBeenCalledWith({ clientX: 126, clientY: 88 })
    expect(rendered.getByRole('textbox').classList.contains('cursor-text')).toBe(true)
  })

  it('受控外部回写更新内容但不重复触发 onChange', () => {
    const onChange = vi.fn()
    const first = createPlainTextPromptDocument('初始')
    const second = createPlainTextPromptDocument('外部载入')
    const rendered = render(
      <PromptEditor value={first} onChange={onChange} ariaLabel="提示词" />,
    )

    rendered.rerender(
      <PromptEditor value={second} onChange={onChange} ariaLabel="提示词" />,
    )

    expect(rendered.getByRole('textbox').textContent).toBe('外部载入')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('程序化替换默认进入实例并同步结构化文档', () => {
    const onChange = vi.fn<[PromptDocumentV1], void>()
    const ref = createRef<PromptEditorHandle>()
    const first = createPlainTextPromptDocument('替换前')
    const second = createPlainTextPromptDocument('替换后')
    render(
      <PromptEditor ref={ref} value={first} onChange={onChange} ariaLabel="提示词" />,
    )

    act(() => ref.current?.replaceDocument(second))

    expect(ref.current?.getDocument()).toEqual(second)
    expect(onChange).toHaveBeenLastCalledWith(second)
  })

  it('提交快捷键避开 composition 并吞掉当前事件', () => {
    const onSubmit = vi.fn()
    const rendered = render(
      <PromptEditor
        value={createPlainTextPromptDocument('中文')}
        onChange={vi.fn()}
        ariaLabel="提示词"
        submitShortcut="mod-enter"
        onSubmit={onSubmit}
      />,
    )
    const editor = rendered.getByRole('textbox')

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('两个实例的程序化替换与撤销历史互不影响', () => {
    const firstRef = createRef<PromptEditorHandle>()
    const secondRef = createRef<PromptEditorHandle>()
    const parentKeyDown = vi.fn()
    const first = createPlainTextPromptDocument('实例 A')
    const second = createPlainTextPromptDocument('实例 B')
    const firstReplacement = createPlainTextPromptDocument('实例 A 已替换')
    const secondReplacement = createPlainTextPromptDocument('实例 B 已替换')
    const rendered = render(
      <div onKeyDown={parentKeyDown}>
        <PromptEditor ref={firstRef} value={first} onChange={vi.fn()} ariaLabel="实例 A" />
        <PromptEditor ref={secondRef} value={second} onChange={vi.fn()} ariaLabel="实例 B" />
      </div>,
    )

    act(() => {
      firstRef.current?.replaceDocument(firstReplacement)
      secondRef.current?.replaceDocument(secondReplacement)
    })
    fireEvent.keyDown(rendered.getByRole('textbox', { name: '实例 A' }), {
      key: 'z',
      ctrlKey: true,
    })

    expect(firstRef.current?.getDocument()).toEqual(first)
    expect(secondRef.current?.getDocument()).toEqual(secondReplacement)
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('媒体和变量以 atom NodeView 渲染，运行时资源变化不改写 JSON', async () => {
    const ref = createRef<PromptEditorHandle>()
    const document: PromptDocumentV1 = {
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '参考 ' },
          {
            type: 'mediaReference',
            attrs: {
              resourceId: 'asset:a',
              mediaType: 'image',
              fallbackLabel: '旧标签',
            },
          },
          { type: 'text', text: ' 风格 ' },
          {
            type: 'templateVariable',
            attrs: { key: 'style', fallbackLabel: '旧变量' },
          },
        ],
      }],
    }
    const rendered = render(
      <PromptEditor
        ref={ref}
        value={document}
        onChange={vi.fn()}
        ariaLabel="结构化提示词"
        preset="structured"
        references={[{
          resourceId: 'asset:a',
          mediaType: 'image',
          label: '图1',
          thumbnailSrc: 'henji-media://asset/a',
        }]}
        variables={[{ key: 'style', label: '电影感' }]}
      />,
    )

    await waitFor(() => {
      expect(rendered.container.innerHTML).toContain('data-reference-id="asset:a"')
    })
    const mediaReference = rendered.container.querySelector('[data-reference-id="asset:a"]')
    const templateVariable = rendered.container.querySelector('[data-variable-key="style"]')
    expect(mediaReference?.textContent).toContain('@图1')
    expect(mediaReference?.classList.contains('text-[length:inherit]')).toBe(true)
    expect(mediaReference?.classList.contains('h-[1lh]')).toBe(true)
    expect(mediaReference?.classList.contains('py-0.5')).toBe(false)
    expect(mediaReference?.querySelector('img')?.classList.contains('h-[1.25em]')).toBe(true)
    expect(templateVariable?.textContent).toContain('{{电影感}}')
    expect(templateVariable?.classList.contains('leading-[inherit]')).toBe(true)
    expect(templateVariable?.classList.contains('h-[1lh]')).toBe(true)
    expect(templateVariable?.classList.contains('py-0.5')).toBe(false)
    expect(JSON.stringify(ref.current?.getDocument())).not.toContain('thumbnailSrc')

    rendered.rerender(
      <PromptEditor
        ref={ref}
        value={document}
        onChange={vi.fn()}
        ariaLabel="结构化提示词"
        preset="structured"
        references={[{
          resourceId: 'asset:a',
          mediaType: 'image',
          label: '图2',
        }]}
        variables={[{ key: 'style', label: '写实' }]}
      />,
    )

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-reference-id="asset:a"]')?.textContent)
        .toContain('@图2')
    })
    expect(ref.current?.getDocument()).toEqual(document)
  })

  it('HTML 复制载体保留原子身份并排除缩略图 URL', () => {
    const document: PromptDocumentV1 = {
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          {
            type: 'mediaReference',
            attrs: {
              resourceId: 'canvas-output:node-1:image:0',
              mediaType: 'image',
              fallbackLabel: '图1',
              sourceNodeId: 'node-1',
            },
          },
          { type: 'templateVariable', attrs: { key: 'style', fallbackLabel: '风格' } },
        ],
      }],
    }
    const registry = new PromptEditorResourceRegistry()
    const extensions = [
      Document,
      Paragraph,
      Text,
      HardBreak,
      MediaReferenceExtension.configure({ registry }),
      TemplateVariableExtension.configure({ registry }),
    ]
    const html = generateHTML(toTiptapContent(document), extensions)

    expect(html).toContain('data-reference-id="canvas-output:node-1:image:0"')
    expect(html).toContain('data-variable-key="style"')
    expect(html).not.toContain('thumbnail')
    expect(fromTiptapContent(generateJSON(html, extensions))).toEqual(document)
  })

  it('静态 renderer 对失效引用降级显示并可随 resolver 恢复', () => {
    const document: PromptDocumentV1 = {
      version: 1,
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mediaReference',
          attrs: {
            resourceId: 'canvas-frame:node-1:frame-1',
            mediaType: 'image',
            fallbackLabel: '原图',
          },
        }],
      }],
    }
    const rendered = render(
      <PublicPromptEditor
        mode="static"
        value={document}
        onChange={vi.fn()}
        ariaLabel="静态引用"
      />,
    )

    expect(rendered.container.querySelector('[data-reference-state="missing"]')?.textContent)
      .toContain('@原图')

    rendered.rerender(
      <PublicPromptEditor
        mode="static"
        value={document}
        onChange={vi.fn()}
        ariaLabel="静态引用"
        references={[{
          resourceId: 'canvas-frame:node-1:frame-1',
          mediaType: 'image',
          label: '图3',
        }]}
      />,
    )

    expect(rendered.container.querySelector('[data-reference-state="resolved"]')?.textContent)
      .toContain('@图3')
  })

})
