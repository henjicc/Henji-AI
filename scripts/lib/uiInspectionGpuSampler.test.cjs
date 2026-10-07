const assert = require('node:assert/strict')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { startGpuSampler } = require('./uiInspectionGpuSampler.cjs')

function fakeSampler() {
  const child = new EventEmitter()
  child.stdout = new PassThrough(); child.stderr = new PassThrough()
  let launches = 0; let kills = 0; let args; let options
  child.kill = () => { kills++; queueMicrotask(() => child.emit('close', 0)); return true }
  const spawnProcess = (command, values, config) => {
    assert.equal(command, 'nvidia-smi'); launches++; args = values; options = config
    return child
  }
  return { child, spawnProcess, get launches() { return launches }, get kills() { return kills }, get args() { return args }, get options() { return options } }
}

test('GPU 采样只启动一个持续进程，首个读数就绪后才允许开始测量', async () => {
  const fake = fakeSampler(); const readings = []
  let ready = false
  const sampling = startGpuSampler({ spawnProcess: fake.spawnProcess, intervalMs: 500, onReading: value => readings.push(value) }).then(stop => { ready = true; return stop })
  await Promise.resolve(); assert.equal(ready, false)
  fake.child.stdout.write('10, 0, 6000\n')
  const stop = await sampling
  assert.equal(ready, true)
  // Later readings come from that same process; no launch or timer per sample.
  fake.child.stdout.write('11, 20, 6100\n12, 30, 6200\n')
  assert.equal(fake.launches, 1)
  assert.deepEqual(fake.args, ['--query-gpu=utilization.gpu,utilization.decoder,memory.used', '--format=csv,noheader,nounits', '--loop-ms=500'])
  assert.equal(fake.options.windowsHide, true)
  assert.deepEqual(readings.map(value => value.values), ['10, 0, 6000', '11, 20, 6100', '12, 30, 6200'])
  assert.ok(readings.every(value => Number.isFinite(value.at)))
  await stop(); await stop()
  assert.equal(fake.kills, 1)
  fake.child.stdout.write('13, 40, 6300\n')
  assert.equal(readings.length, 3, '结束后不再写测量结果')
})

test('采样解析跨块 CRLF、多卡与诊断输出，允许不同的原生采样周期', async () => {
  const fake = fakeSampler(); const readings = []
  const sampling = startGpuSampler({ spawnProcess: fake.spawnProcess, intervalMs: 1000, onReading: value => readings.push(value) })
  fake.child.stdout.write('diagnostic\n 5, 6, ')
  fake.child.stdout.write('7000\r\n8, 9, 8000\r\ninvalid, data\n')
  const stop = await sampling
  assert.deepEqual(readings.map(value => value.values), ['5, 6, 7000', '8, 9, 8000'])
  assert.equal(fake.args.at(-1), '--loop-ms=1000')
  await stop()
})

test('未安装 NVIDIA 工具或采样进程失败时结束等待并保留原因', async () => {
  for (const missing of [true, false]) {
    const fake = fakeSampler(); const errors = []
    const sampling = startGpuSampler({ spawnProcess: fake.spawnProcess, onReading: () => assert.fail('失败不应伪造采样'), onError: error => errors.push(error.message) })
    if (missing) fake.child.emit('error', new Error('ENOENT'))
    fake.child.emit('close', missing ? -2 : 1)
    const stop = await sampling
    await stop()
    assert.equal(fake.kills, 0)
    assert.ok(errors.includes(missing ? 'ENOENT' : 'nvidia-smi exited with code 1'))
  }
})
