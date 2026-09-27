import { useEffect, useMemo, useState } from 'react'
import type { AudioEditProjectDocument } from '@/core/audioEdit/types'
import { findAudioEditText, previewAudioEditText, replaceAudioEditText, resolveAudioEditReplacement } from '@/core/audioEdit/text'
import { editAudioEditProject } from './application/audioEditProjectInstances'

export function useAudioEditTextSearch(project: AudioEditProjectDocument | null) {
  const [isOpen, setIsOpen] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [index, setIndex] = useState(0)
  const [navigationVersion, setNavigationVersion] = useState(0)
  const [focusVersion, setFocusVersion] = useState(0)
  const [message, setMessage] = useState('')
  const projectId = project?.id
  useEffect(() => { setIsOpen(false); setQuery(''); setRegex(false); setShowReplace(false); setReplacement(''); setPreviewing(false); setMessage(''); setIndex(0) }, [projectId])
  const result = useMemo(() => {
    try { return { matches: isOpen ? findAudioEditText(project?.transcript ?? [], query, regex) : [], error: '' } }
    catch { return { matches: [], error: '正则表达式无效，请检查括号、转义或字符范围。' } }
  }, [project?.transcript, query, regex, isOpen])
  const currentIndex = Math.min(index, Math.max(0, result.matches.length - 1))
  const currentMatch = result.matches[currentIndex]
  const preview = isOpen && showReplace && previewing && !result.error
  const fragments = useMemo(() => previewAudioEditText(project?.transcript ?? [], result.matches, preview ? replacement : undefined), [project?.transcript, result.matches, replacement, preview])
  const lockedIds = useMemo(() => new Set(project?.transcript.filter((block) => block.locked).map((block) => block.id)), [project?.transcript])
  const sourceText = useMemo(() => project?.transcript.map((block) => block.text).join('') ?? '', [project?.transcript])
  const changes = useMemo(() => result.matches.filter((match) => !match.blockIds.some((id) => lockedIds.has(id)) && resolveAudioEditReplacement(match, replacement, sourceText) !== match.value), [result.matches, lockedIds, replacement, sourceText])
  const confirm = (all: boolean) => {
    if (!project || !preview) return
    const targets = all ? changes : changes.filter((match) => match === currentMatch)
    if (!targets.length) return
    try {
      editAudioEditProject(project.id, (document) => {
        if (document.transcript !== project.transcript) throw new Error('文字已更新，请查看最新预览后再确认。')
        return { ...document, transcript: replaceAudioEditText(document.transcript, targets, replacement) }
      })
      setMessage(`已确认替换 ${targets.length} 处，可撤销`)
      setPreviewing(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : '替换未完成，请重试') }
  }
  return {
    isOpen, showReplace, query, regex, replacement, preview, fragments, currentIndex, currentMatch, focusVersion,
    matches: result.matches, error: result.error, message, changeCount: changes.length,
    currentCanChange: Boolean(currentMatch && changes.includes(currentMatch)),
    lockedCount: result.matches.filter((match) => match.blockIds.some((id) => lockedIds.has(id))).length,
    navigationKey: currentMatch ? `${projectId}:${query}:${regex}:${currentIndex}:${currentMatch.start}:${currentMatch.end}:${navigationVersion}` : '',
    open: (replace = false) => { setIsOpen(true); if (replace) setShowReplace(true); setNavigationVersion((value) => value + 1); setFocusVersion((value) => value + 1) },
    close: () => { setIsOpen(false); setPreviewing(false) },
    toggleReplace: () => { setShowReplace(!showReplace); setPreviewing(false) },
    setQuery: (value: string) => { setQuery(value); setIndex(0); setMessage('') },
    toggleRegex: () => { setRegex(!regex); setIndex(0); setMessage('') },
    setReplacement: (value: string) => { setReplacement(value); setPreviewing(true); setMessage('') },
    startPreview: () => { setPreviewing(true); setMessage('') },
    cancelPreview: () => { setPreviewing(false); setMessage('') },
    navigate: (direction: number) => { if (result.matches.length) { setIndex((currentIndex + direction + result.matches.length) % result.matches.length); setNavigationVersion((value) => value + 1) } },
    confirm,
  }
}

export type AudioEditTextSearch = ReturnType<typeof useAudioEditTextSearch>
