/**
 * Starts the yt-dlp audio proxy and Vite together, so `npm run dev` gives
 * full-length playback out of the box. The proxy is optional: if yt-dlp is
 * missing the frontend simply falls back to YouTube's IFrame player.
 */
import { spawn } from 'node:child_process'

const children = []
function start(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env })
  child.on('exit', (code) => {
    if (code) console.error(`[monochrome] ${name} exited with ${code}`)
  })
  children.push(child)
  return child
}

start('audio-proxy', process.execPath, ['server/index.mjs'])
start('vite', 'npx', ['vite', '--host', '0.0.0.0', '--port', '12000'])

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
