import { describe, expect, it } from 'vitest'
import { compensateVideoEditPopoutBounds, parseVideoEditPopoutRequest, repairVideoEditPopoutBounds, resolveVideoEditPopoutBounds, resolveVideoEditPopoutTitle } from './video-edit-popout-policy'

const request = (patch: Partial<{ url: string; frameName: string; disposition: string; features: string }> = {}) => ({
  url: 'about:blank', frameName: 'henji-video-edit-popout:effects', disposition: 'new-window', features: 'popup,width=520,height=700', ...patch,
})

describe('parseVideoEditPopoutRequest', () => {
  it('只放行受控前缀的 about:blank 新窗口，并读取有界尺寸', () => {
    expect(parseVideoEditPopoutRequest(request())).toEqual({ panelKey: 'effects', size: { width: 520, height: 700 }, title: '痕迹AI · 剪辑面板' })
    expect(parseVideoEditPopoutRequest(request({ features: 'popup,width=10,height=99999' }))).toEqual({ panelKey: 'effects', size: { width: 320, height: 8192 }, title: '痕迹AI · 剪辑面板' })
    expect(parseVideoEditPopoutRequest(request({ features: '' }))?.size).toEqual({ width: 480, height: 640 })
    expect(parseVideoEditPopoutRequest(request({ features: 'popup,width=400,height=300,left=-1200,top=40,henjiTitle=%E6%95%88%E6%9E%9C%E6%8E%A7%E4%BB%B6' }))).toEqual({ panelKey: 'effects', size: { width: 400, height: 300 }, position: { x: -1200, y: 40 }, title: '痕迹AI · 效果控件' })
    expect(parseVideoEditPopoutRequest(request({ features: 'popup,left=12' }))?.position).toBeUndefined()
    expect(parseVideoEditPopoutRequest(request({ features: 'popup,left=1e9,top=x' }))?.position).toBeUndefined()
  })

  it.each([
    ['外部地址', request({ url: 'https://example.com/' })],
    ['file 页面', request({ url: 'file:///C:/app/index.html' })],
    ['空白但非白名单名称', request({ frameName: 'popup' })],
    ['非法面板键', request({ frameName: 'henji-video-edit-popout:../x' })],
    ['空面板键', request({ frameName: 'henji-video-edit-popout:' })],
    ['标签页语义', request({ disposition: 'foreground-tab' })],
  ])('拒绝%s', (_label, details) => {
    expect(parseVideoEditPopoutRequest(details)).toBeNull()
  })
})

const primary = { workArea: { x: 0, y: 0, width: 2560, height: 1400 } }
const secondary = { workArea: { x: 2560, y: 0, width: 2560, height: 1400 } }

describe('浮窗位置', () => {
  it('首次打开在主窗口所在显示器工作区居中', () => {
    expect(resolveVideoEditPopoutBounds(undefined, { width: 480, height: 640 }, [primary, secondary], secondary.workArea)).toEqual({ x: 3600, y: 380, width: 480, height: 640 })
  })

  it('恢复另一显示器上的上次位置', () => {
    const last = { x: 2760, y: 200, width: 480, height: 320 }
    expect(resolveVideoEditPopoutBounds(last, { width: 480, height: 640 }, [primary, secondary], primary.workArea)).toEqual(last)
  })

  it('上次所在显示器已拔除时回到主窗口显示器', () => {
    const last = { x: 2760, y: 200, width: 480, height: 320 }
    expect(resolveVideoEditPopoutBounds(last, { width: 480, height: 640 }, [primary], primary.workArea)).toEqual({ x: 1040, y: 540, width: 480, height: 320 })
  })

  it('标题栏仍可抓取时保留位置，只收回超出工作区的尺寸', () => {
    expect(repairVideoEditPopoutBounds({ x: 100, y: 100, width: 600, height: 400 }, [primary], primary.workArea)).toBeNull()
    expect(repairVideoEditPopoutBounds({ x: 100, y: 100, width: 3000, height: 400 }, [primary], primary.workArea)).toEqual({ x: 100, y: 100, width: 2560, height: 400 })
  })

  it('标题栏移出所有工作区（例如只露出底边）时重新居中', () => {
    expect(repairVideoEditPopoutBounds({ x: 100, y: -380, width: 600, height: 400 }, [primary], primary.workArea)).toEqual({ x: 980, y: 500, width: 600, height: 400 })
    expect(repairVideoEditPopoutBounds({ x: 2500, y: 100, width: 600, height: 400 }, [primary], primary.workArea)).toEqual({ x: 980, y: 500, width: 600, height: 400 })
  })
})

describe('浮窗标题', () => {
  it('统一为“痕迹AI · 面板名”，永不与主窗口标题“痕迹AI”相同', () => {
    expect(resolveVideoEditPopoutTitle('痕迹AI · 效果控件')).toBe('痕迹AI · 效果控件')
    expect(resolveVideoEditPopoutTitle('时间线')).toBe('痕迹AI · 时间线')
    for (const title of ['', '  ', '痕迹AI', ' 痕迹AI ', '痕迹AI · ', '痕迹AI · 痕迹AI', 'about:blank'.slice(0, 0)]) {
      expect(resolveVideoEditPopoutTitle(title)).toBe('痕迹AI · 剪辑面板')
    }
    expect(resolveVideoEditPopoutTitle('x'.repeat(200))).toHaveLength('痕迹AI · '.length + 64)
  })
})

describe('外框偏差补偿', () => {
  it('一致时不再调整；有偏差时按差值反向补偿请求，且不低于最小尺寸', () => {
    const intended = { x: 3439, y: 241, width: 805, height: 921 }
    expect(compensateVideoEditPopoutBounds(intended, intended, intended)).toBeNull()
    expect(compensateVideoEditPopoutBounds(intended, { ...intended, width: 809, height: 925 }, intended)).toEqual({ ...intended, width: 801, height: 917 })
    expect(compensateVideoEditPopoutBounds({ ...intended, width: 801, height: 917 }, { ...intended, width: 802, height: 918 }, intended)).toEqual({ ...intended, width: 804, height: 920 })
    expect(compensateVideoEditPopoutBounds({ x: 0, y: 0, width: 320, height: 200 }, { x: 0, y: 0, width: 330, height: 210 }, { x: 0, y: 0, width: 320, height: 200 })).toEqual({ x: 0, y: 0, width: 320, height: 200 })
  })
})
