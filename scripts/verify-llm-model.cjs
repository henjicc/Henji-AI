#!/usr/bin/env node
// 无界面运行模型能力验证：npm run llm:verify -- --provider mimo --model mimo-v2.5
const { spawn } = require('node:child_process')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const electron = require('electron')

const child = spawn(electron, [projectRoot, '--verify-model', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 1))
