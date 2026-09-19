// Dev-only helper: renders the AudioService C# interop to a file so it can be
// compile-tested with Add-Type outside Electron.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'main', 'services', 'audio-service.ts'), 'utf8').replace(/\r\n/g, '\n')

const start = source.indexOf('const CORE_AUDIO_CSHARP = `') + 'const CORE_AUDIO_CSHARP = `'.length
const end = source.indexOf('`.trim()', start)
const template = source.slice(start, end)
// eslint-disable-next-line no-new-func
const rendered = new Function(`return \`${template}\``)().trim()

const outDir = join(here, '..', 'out-ps-check')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'core-audio-interop.cs'), rendered)
console.log('rendered to', join(outDir, 'core-audio-interop.cs'))
