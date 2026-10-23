#!/usr/bin/env node
// 直接驱动独立录音程序，不启动 Electron；临时录音留在系统临时目录供回听。
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const binary = path.resolve(__dirname, `../native/audio-capture/target/release/henji-audio-capture${process.platform === 'win32' ? '.exe' : ''}`)
let child
const pending = new Map()
let buffer = Buffer.alloc(0), next = 0, levels = 0, blocks = 0, previous = -Infinity, frames = 0
let interrupted
function connect() {
  buffer = Buffer.alloc(0)
  child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
  child.stdout.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0)
    if (buffer.length < length + 4) break
    const message = JSON.parse(buffer.subarray(4, length + 4).toString())
    const total = length + 4 + message.binaryBytes
    if (buffer.length < total) break
    if (message.event === 'samples') {
      assert.equal(message.binaryBytes, message.frames * message.channels * 4)
      assert.ok(message.nativeMonoUs > previous, '采样时钟必须单调')
      assert.equal(message.firstFrame, frames, '采样帧必须连续')
      previous = message.nativeMonoUs; frames += message.frames; blocks++
    }
    if (message.event === 'level') levels++
    if (message.event === 'interrupted') interrupted = message.error
    if (message.id) {
      const waiter = pending.get(message.id); pending.delete(message.id)
      if (waiter) { clearTimeout(waiter.timeout); message.ok ? waiter.resolve(message.result) : waiter.reject(new Error(JSON.stringify(message.error))) }
    }
    buffer = buffer.subarray(total)
  }
  })
  child.on('error', error => { console.error(error); process.exitCode = 1 })
  child.on('exit', () => { for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('原生程序退出')) } pending.clear() })
}
connect()
function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++next)
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${type} 超时`)); child.kill() }, 20000)
    pending.set(id, { resolve, reject, timeout }); child.stdin.write(JSON.stringify({ id, type, ...payload }) + '\n')
  })
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const hello = await call('hello'); assert.equal(hello.protocol, 1)
  const inventory = await call('enumerate')
  console.log(JSON.stringify({ hostApis: inventory.hostApis, deviceCount: inventory.devices.length, asioCompiled: inventory.asioCompiled, asioInputs: inventory.devices.filter(d => d.hostApi === 'ASIO' && d.maxInputChannels).map(d => d.name) }, null, 2))
  if (!inventory.devices.some(d => d.hostApi === 'ASIO' && d.maxInputChannels)) console.log('ASIO 已编译，但没有可用 ASIO 输入驱动，未验证驱动录音和控制面板。')
  const requestedHost = process.argv.find(arg => arg.startsWith('--host='))?.slice(7)
  const requestedDevice = process.argv.find(arg => arg.startsWith('--device='))?.slice(9)
  const d = requestedHost || requestedDevice ? inventory.devices.find(d => (!requestedHost || d.hostApi === requestedHost) && (!requestedDevice || d.name.includes(requestedDevice)) && d.maxInputChannels > 0) : inventory.devices.find(d => d.index === inventory.defaultInputDevice)
  assert.ok(d?.maxInputChannels > 0, '本机没有默认输入设备')
  console.log(`测试输入：${d.hostApi} / ${d.name}`)
  const settings = { device: d.index, hostApi: d.hostApi, firstChannel: 0, channels: 1, sampleRate: 48000, bitDepth: 24, bufferFrames: 0, suggestedLatency: d.defaultHighInputLatency, exclusive: process.argv.includes('--exclusive') }
  const probe = await call('probe', { settings })
  const format = probe.formats.find(f => f.sampleRate === 48000 && f.bitDepth === 24 && f.supported) ?? probe.formats.find(f => f.supported)
  assert.ok(format, '默认输入无可用格式'); settings.sampleRate = format.sampleRate; settings.bitDepth = format.bitDepth
  const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-capture-')), '冒烟.wav')
  const sessionId = 'smoke'
  const started = await call('start', { sessionId, outputPath, settings, streamSamples: true })
  if (process.argv.includes('--crash')) {
    await sleep(1350)
    assert.ok(blocks > 0 && levels > 0)
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL') })
    const physicalBytes = fs.statSync(outputPath).size - 92
    connect()
    const recovered = await call('recover', { outputPath })
    const align = settings.channels * settings.bitDepth / 8
    assert.equal(recovered.writtenBytes, Math.floor(physicalBytes / align) * align)
    const h = fs.readFileSync(outputPath)
    assert.equal(h.readUInt32LE(88), recovered.writtenBytes)
    console.log(JSON.stringify({ result: 'crash recovery passed', recovered, levels, blocks, outputPath }, null, 2))
    return
  }
  await sleep(1000); await call('pause', { sessionId }); await sleep(250); await call('resume', { sessionId }); await sleep(1000)
  if (interrupted) throw new Error(JSON.stringify(interrupted))
  const stopped = await call('stop', { sessionId })
  assert.ok(levels > 0 && blocks > 0 && stopped.durationSeconds > 1.5)
  const recovered = await call('recover', { outputPath }); assert.equal(recovered.writtenBytes, stopped.writtenBytes)
  const h = fs.readFileSync(outputPath); assert.equal(h.subarray(0, 4).toString(), 'RIFF'); assert.equal(h.length, 92 + stopped.writtenBytes + stopped.writtenBytes % 2)
  console.log(JSON.stringify({ started, stopped, levels, blocks, streamedFrames: frames, outputPath, result: 'passed' }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => child.stdin.end())
