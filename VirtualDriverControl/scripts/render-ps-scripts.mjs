// Dev-only helper: renders the InstallerService PowerShell templates to temp
// files so their syntax can be validated without running Electron.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'main', 'services', 'installer-service.ts'), 'utf8').replace(/\r\n/g, '\n')

// Driver specs mirrored from the service (keep in sync when validating).
const SPECS = {
  display: {
    title: 'Virtual Display Driver',
    infName: 'MttVDD.inf',
    signedBinary: 'MttVDD.dll',
    hardwareId: 'Root\\MttVDD',
    hardwareIdPattern: '^Root\\\\MttVDD$',
    className: 'Display',
    classGuid: '4D36E968-E325-11CE-BFC1-08002BE10318',
    copyToBaseDir: true,
    preserveFiles: ['vdd_settings.xml'],
    maxInstances: 1
  },
  audio: {
    title: 'Virtual Audio Driver',
    infName: 'VirtualAudioDriver.inf',
    signedBinary: 'VirtualAudioDriver.sys',
    hardwareId: 'Root\\VirtualAudioDriver',
    hardwareIdPattern: '^Root\\\\VirtualAudioDriver$',
    className: 'MEDIA',
    classGuid: '4D36E96C-E325-11CE-BFC1-08002BE10318',
    copyToBaseDir: false,
    preserveFiles: [],
    maxInstances: 4
  }
}

function extractTemplate(afterMarker, openMarker = 'return `') {
  const start = source.indexOf(afterMarker)
  if (start === -1) throw new Error(`marker not found: ${afterMarker}`)
  const open = source.indexOf(openMarker, start) + openMarker.length
  const close = source.indexOf('`\n  }', open)
  return source.slice(open, close)
}

function render(template, vars) {
  const cleaned = template.replaceAll('this.getBaseDir()', 'getBaseDir()')
  const keys = Object.keys(vars)
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `return \`${cleaned}\``)(...keys.map((k) => vars[k]))
}

const outDir = join(here, '..', 'out-ps-check')
mkdirSync(outDir, { recursive: true })

const installTemplate = extractTemplate('private buildInstallScript(')
const copyBlockTemplate = extractTemplate('const copyBlock = spec.copyToBaseDir', '? `')
const uninstallTemplate = extractTemplate('private buildUninstallScript(')
const restartTemplate = extractTemplate('private buildRestartScript(')
const instancesTemplate = extractTemplate('private buildSetInstancesScript(')

for (const [id, spec] of Object.entries(SPECS)) {
  const copyBlock = spec.copyToBaseDir
    ? render(copyBlockTemplate.slice(0, copyBlockTemplate.indexOf('`\n      : ')), {
        spec,
        getBaseDir: () => 'C:\\VirtualDisplayDriver'
      })
    : ''
  const nefconPath = 'C:\\Tools\\nefcon\\nefconc.exe'
  const installFlags = spec.maxInstances === 1 ? '--no-duplicates --remove-duplicates' : '--no-duplicates'
  const common = { spec, nefconPath, getBaseDir: () => 'C:\\VirtualDisplayDriver' }
  writeFileSync(
    join(outDir, `install-${id}.ps1`),
    render(installTemplate, { ...common, packageDir: 'C:\\Temp\\pkg', instances: 2, copyBlock, installFlags })
  )
  writeFileSync(join(outDir, `uninstall-${id}.ps1`), render(uninstallTemplate, common))
  writeFileSync(join(outDir, `restart-${id}.ps1`), render(restartTemplate, common))
  writeFileSync(join(outDir, `instances-${id}.ps1`), render(instancesTemplate, { ...common, target: 2 }))
}

console.log('rendered to', outDir)
