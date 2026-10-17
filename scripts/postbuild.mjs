// Copies the built index.html to 404.html so GitHub Pages serves the SPA for
// deep links. Pages answers unknown paths with 404.html, and a static host
// cannot rewrite URLs the way the bundled server does — without this,
// /search?q=… and every other client-side route returns "404 Not Found".
//
// `.nojekyll` stops Pages from running Jekyll, which would otherwise drop the
// underscore-prefixed asset paths Vite emits.

import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'))
writeFileSync(join(dist, '.nojekyll'), '')
console.log('wrote dist/404.html and dist/.nojekyll')
