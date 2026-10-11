/**
 * Starts the yt-dlp audio proxy and Vite together, so `npm run dev` gives
 * full-length playback out of the box. The proxy is optional: if yt-dlp is
 * missing the frontend simply falls back to YouTube's IFrame player.
 */
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

// `pip install --user yt-dlp` drops the binary in ~/.local/bin, which is not on
// PATH in this environment; without it the proxy cannot stream full songs. Add
// it here so `npm run dev` finds yt-dlp regardless of the caller's PATH.
const userBin = join(homedir(), '.local', 'bin')
const env = {
  ...process.env,
  PATH: `${userBin}:${process.env.PATH ?? ''}`,
}

// Full playback and SoundCloud search are both dead without yt-dlp, and the
// failure is silent (every resolve just logs "yt-dlp not found"). A fresh box
// therefore looks broken until someone runs pip by hand, so self-heal here.
function ensureYtDlp() {
  const probe = spawnSync('python3', ['-m', 'yt_dlp', '--version'], { env, encoding: 'utf8' })
  if (probe.status === 0) return
  console.log('[monochrome] yt-dlp missing — installing it (pip install --user yt-dlp)')
  const install = spawnSync('python3', ['-m', 'pip', 'install', '--user', '--quiet', 'yt-dlp'], {
    env,
    stdio: 'inherit',
  })
  if (install.status !== 0) {
    console.warn('[monochrome] could not install yt-dlp; full playback will fall back to previews')
  }
}
ensureYtDlp()

const children = []
function start(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env })
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
