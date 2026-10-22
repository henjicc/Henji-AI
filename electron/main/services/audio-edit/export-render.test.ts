import { expect, it } from 'vitest'
import { buildAudioEditConcatFilter } from './export-render'

const span = (start: number, end: number, muted = false) => ({ sourceStartFrame: start, sourceEndFrame: end, outputStartFrame: 0, outputEndFrame: end - start, muted })

it('导出按采样数在删除拼接点使用线性淡变，首尾不加淡变', () => {
  expect(buildAudioEditConcatFilter([span(100, 1100), span(2000, 3000)], '0:a:0', 48000)).toBe([
    '[0:a:0]atrim=start_sample=100:end_sample=1100,asetpts=PTS-STARTPTS,afade=t=out:ss=760:ns=240:curve=tri[a0]',
    '[0:a:0]atrim=start_sample=2000:end_sample=3000,asetpts=PTS-STARTPTS,afade=t=in:ss=0:ns=240:curve=tri[a1]',
    '[a0][a1]concat=n=2:v=0:a=1[out]',
  ].join(';\n'))
})

it('短片段缩短两侧淡变，静音仍保持为真零', () => {
  const graph = buildAudioEditConcatFilter([span(0, 1000), span(1000, 1005, true), span(1005, 2000)], '0:a', 48000)
  expect(graph.split(';\n')[1]).toBe('[0:a]atrim=start_sample=1000:end_sample=1005,asetpts=PTS-STARTPTS,afade=t=in:ss=0:ns=2:curve=tri,afade=t=out:ss=3:ns=2:curve=tri,aeval=0:c=same[a1]')
  expect(graph.split(';\n')[0]).toContain('afade=t=out:ss=760:ns=240')
  expect(graph.split(';\n')[2]).toContain('afade=t=in:ss=0:ns=240')
  expect(buildAudioEditConcatFilter([span(0, 1), span(2, 3)], '0:a', 48000)).not.toContain('afade')
})

it('连续片段和单片段不添加淡变，采样率决定淡变帧数', () => {
  expect(buildAudioEditConcatFilter([span(0, 1000), span(1000, 2000)], '0:a', 48000)).not.toContain('afade')
  expect(buildAudioEditConcatFilter([span(100, 1100)], '0:a', 48000)).not.toContain('afade')
  expect(buildAudioEditConcatFilter([span(0, 1000), span(2000, 3000)], '0:a', 44100)).toContain('afade=t=out:ss=779:ns=221:curve=tri')
})
