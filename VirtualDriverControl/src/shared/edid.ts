import type { EdidChromaticity, EdidHdrMetadata, EdidTiming, ParsedEdid } from './types'

/**
 * Pure-TypeScript EDID parser (base block + CEA-861 extension) and
 * IddCx monitor_profile.xml generator. No Node APIs - usable in any process.
 */

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]

// Established timings, bytes 35-37 (bit 7 -> bit 0 per byte).
const ESTABLISHED_TIMINGS: Array<[number, number, number] | null>[] = [
  [
    [720, 400, 70],
    [720, 400, 88],
    [640, 480, 60],
    [640, 480, 67],
    [640, 480, 72],
    [640, 480, 75],
    [800, 600, 56],
    [800, 600, 60]
  ],
  [
    [800, 600, 72],
    [800, 600, 75],
    [832, 624, 75],
    [1024, 768, 87], // interlaced
    [1024, 768, 60],
    [1024, 768, 70],
    [1024, 768, 75],
    [1280, 1024, 75]
  ],
  [[1152, 870, 75], null, null, null, null, null, null, null]
]

// CEA-861 VIC table (curated, common codes).
const VIC_TABLE: Record<number, [number, number, number, boolean?]> = {
  1: [640, 480, 60],
  2: [720, 480, 60],
  3: [720, 480, 60],
  4: [1280, 720, 60],
  5: [1920, 1080, 60, true],
  6: [720, 480, 60, true],
  7: [720, 480, 60, true],
  16: [1920, 1080, 60],
  17: [720, 576, 50],
  18: [720, 576, 50],
  19: [1280, 720, 50],
  20: [1920, 1080, 50, true],
  31: [1920, 1080, 50],
  32: [1920, 1080, 24],
  33: [1920, 1080, 25],
  34: [1920, 1080, 30],
  39: [1920, 1080, 50, true],
  60: [1280, 720, 24],
  61: [1280, 720, 25],
  62: [1280, 720, 30],
  63: [1920, 1080, 120],
  64: [1920, 1080, 100],
  90: [2560, 1080, 60],
  91: [2560, 1080, 100],
  92: [2560, 1080, 120],
  93: [3840, 2160, 24],
  94: [3840, 2160, 25],
  95: [3840, 2160, 30],
  96: [3840, 2160, 50],
  97: [3840, 2160, 60],
  98: [4096, 2160, 24],
  99: [4096, 2160, 25],
  100: [4096, 2160, 30],
  101: [4096, 2160, 50],
  102: [4096, 2160, 60],
  103: [3840, 2160, 24],
  104: [3840, 2160, 25],
  105: [3840, 2160, 30],
  106: [3840, 2160, 50],
  107: [3840, 2160, 60],
  117: [3840, 2160, 100],
  118: [3840, 2160, 120],
  219: [4096, 2160, 100],
  220: [4096, 2160, 120]
}

const VIDEO_INTERFACES: Record<number, string> = {
  0: 'Undefined',
  1: 'DVI',
  2: 'HDMI-a',
  3: 'HDMI-b',
  4: 'MDDI',
  5: 'DisplayPort'
}

function decodeManufacturerId(b0: number, b1: number): string {
  const value = (b0 << 8) | b1
  const c1 = ((value >> 10) & 0x1f) + 64
  const c2 = ((value >> 5) & 0x1f) + 64
  const c3 = (value & 0x1f) + 64
  return String.fromCharCode(c1, c2, c3)
}

function chrom10(high: number, low: number): number {
  return Math.round((((high << 2) | low) / 1024) * 10000) / 10000
}

function descriptorText(bytes: Uint8Array, offset: number): string {
  let text = ''
  for (let i = offset + 5; i < offset + 18; i++) {
    const ch = bytes[i]
    if (ch === 0x0a) break
    text += String.fromCharCode(ch)
  }
  return text.trim()
}

function parseDtd(bytes: Uint8Array, o: number): EdidTiming | null {
  const pixelClock = bytes[o] | (bytes[o + 1] << 8)
  if (pixelClock === 0) return null
  const hActive = bytes[o + 2] | ((bytes[o + 4] >> 4) << 8)
  const hBlank = bytes[o + 3] | ((bytes[o + 4] & 0x0f) << 8)
  const vActive = bytes[o + 5] | ((bytes[o + 7] >> 4) << 8)
  const vBlank = bytes[o + 6] | ((bytes[o + 7] & 0x0f) << 8)
  const interlaced = (bytes[o + 17] & 0x80) !== 0
  const totalPixels = (hActive + hBlank) * (vActive + vBlank)
  if (totalPixels === 0 || hActive === 0 || vActive === 0) return null
  const refresh = (pixelClock * 10000) / totalPixels
  return {
    width: hActive,
    height: vActive * (interlaced ? 2 : 1),
    refreshHz: Math.round(refresh * 1000) / 1000,
    interlaced,
    source: 'detailed',
    pixelClockMHz: Math.round(pixelClock / 100) / 100
  }
}

function parseCeaBlock(bytes: Uint8Array, base: number, result: ParsedEdid): void {
  result.hasCeaExtension = true
  const dtdStart = bytes[base + 2]
  const flags = bytes[base + 3]
  result.ceaBasicAudio = (flags & 0x40) !== 0
  result.ceaYcbcr444 = (flags & 0x20) !== 0
  result.ceaYcbcr422 = (flags & 0x10) !== 0

  // Data block collection: from base+4 up to dtdStart.
  let i = base + 4
  const dataEnd = base + Math.max(dtdStart, 4)
  while (i < dataEnd && i < base + 127) {
    const header = bytes[i]
    const tag = (header >> 5) & 0x07
    const length = header & 0x1f
    if (length === 0 && tag === 0) break
    if (tag === 2) {
      // Video data block - list of VICs
      for (let v = 1; v <= length; v++) {
        const raw = bytes[i + v]
        const vic = raw >= 128 && raw <= 192 ? raw & 0x7f : raw
        const native = raw >= 128 && raw <= 192
        const mode = VIC_TABLE[vic]
        if (mode) {
          result.timings.push({
            width: mode[0],
            height: mode[1],
            refreshHz: mode[2],
            interlaced: mode[3] === true,
            source: 'cea-vic',
            vic,
            native
          })
        }
      }
    } else if (tag === 7 && length >= 2) {
      // Extended tag
      const extTag = bytes[i + 1]
      if (extTag === 6) {
        // HDR static metadata data block
        const eotf = bytes[i + 2]
        const hdr: EdidHdrMetadata = {
          eotfSdr: (eotf & 0x01) !== 0,
          eotfHdr: (eotf & 0x02) !== 0,
          eotfPq: (eotf & 0x04) !== 0,
          eotfHlg: (eotf & 0x08) !== 0
        }
        // Coded luminance values (CTA-861.3): L = 50 * 2^(cv/32)
        if (length >= 4 && bytes[i + 4] > 0) hdr.maxLuminance = Math.round(50 * Math.pow(2, bytes[i + 4] / 32))
        if (length >= 5 && bytes[i + 5] > 0) hdr.maxFrameAvgLuminance = Math.round(50 * Math.pow(2, bytes[i + 5] / 32))
        if (length >= 6 && hdr.maxLuminance) {
          const cv = bytes[i + 6]
          hdr.minLuminance = Math.round(hdr.maxLuminance * Math.pow(cv / 255, 2) / 100 * 10000) / 10000
        }
        result.hdr = hdr
      }
    }
    i += length + 1
  }

  // DTDs in the CEA block.
  if (dtdStart >= 4) {
    let o = base + dtdStart
    while (o + 18 <= base + 127) {
      const dtd = parseDtd(bytes, o)
      if (!dtd) break
      result.timings.push(dtd)
      o += 18
    }
  }
}

export function parseEdid(input: Uint8Array): ParsedEdid {
  const bytes = input
  const result: ParsedEdid = {
    valid: false,
    errors: [],
    manufacturerId: '???',
    productCode: 0,
    serialNumber: 0,
    manufactureWeek: 0,
    manufactureYear: 0,
    edidVersion: '?',
    digital: false,
    timings: [],
    extensionCount: 0,
    hasCeaExtension: false,
    checksumOk: false,
    rawBytes: bytes.length
  }

  if (bytes.length < 128) {
    result.errors.push(`EDID must be at least 128 bytes (got ${bytes.length})`)
    return result
  }
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== EDID_HEADER[i]) {
      result.errors.push('Invalid EDID header magic')
      return result
    }
  }

  let checksum = 0
  for (let i = 0; i < 128; i++) checksum = (checksum + bytes[i]) & 0xff
  result.checksumOk = checksum === 0
  if (!result.checksumOk) result.errors.push('Base block checksum mismatch')

  result.manufacturerId = decodeManufacturerId(bytes[8], bytes[9])
  result.productCode = bytes[10] | (bytes[11] << 8)
  result.serialNumber = bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24)
  result.manufactureWeek = bytes[16]
  result.manufactureYear = bytes[17] + 1990
  result.edidVersion = `${bytes[18]}.${bytes[19]}`

  const videoInput = bytes[20]
  result.digital = (videoInput & 0x80) !== 0
  if (result.digital) {
    const depthCode = (videoInput >> 4) & 0x07
    if (depthCode >= 1 && depthCode <= 6) result.bitDepth = 4 + depthCode * 2
    result.videoInterface = VIDEO_INTERFACES[videoInput & 0x0f] ?? 'Unknown'
  }

  if (bytes[21] > 0) result.screenWidthCm = bytes[21]
  if (bytes[22] > 0) result.screenHeightCm = bytes[22]
  if (bytes[23] !== 0xff) result.gamma = Math.round((bytes[23] + 100) / 100 * 100) / 100

  result.chromaticity = {
    redX: chrom10(bytes[27], (bytes[25] >> 6) & 3),
    redY: chrom10(bytes[28], (bytes[25] >> 4) & 3),
    greenX: chrom10(bytes[29], (bytes[25] >> 2) & 3),
    greenY: chrom10(bytes[30], bytes[25] & 3),
    blueX: chrom10(bytes[31], (bytes[26] >> 6) & 3),
    blueY: chrom10(bytes[32], (bytes[26] >> 4) & 3),
    whiteX: chrom10(bytes[33], (bytes[26] >> 2) & 3),
    whiteY: chrom10(bytes[34], bytes[26] & 3)
  }

  // Established timings.
  for (let byteIdx = 0; byteIdx < 3; byteIdx++) {
    const value = bytes[35 + byteIdx]
    for (let bit = 0; bit < 8; bit++) {
      if ((value & (0x80 >> bit)) !== 0) {
        const mode = ESTABLISHED_TIMINGS[byteIdx][bit]
        if (mode) {
          result.timings.push({
            width: mode[0],
            height: mode[1],
            refreshHz: mode[2],
            interlaced: byteIdx === 1 && bit === 3,
            source: 'established'
          })
        }
      }
    }
  }

  // Standard timings (bytes 38-53).
  for (let i = 0; i < 8; i++) {
    const o = 38 + i * 2
    const b1 = bytes[o]
    const b2 = bytes[o + 1]
    if (b1 === 0x01 && b2 === 0x01) continue
    if (b1 === 0x00) continue
    const width = (b1 + 31) * 8
    const aspect = (b2 >> 6) & 3
    let height: number
    switch (aspect) {
      case 0:
        height = Math.round((width * 10) / 16)
        break
      case 1:
        height = Math.round((width * 3) / 4)
        break
      case 2:
        height = Math.round((width * 4) / 5)
        break
      default:
        height = Math.round((width * 9) / 16)
    }
    result.timings.push({
      width,
      height,
      refreshHz: (b2 & 0x3f) + 60,
      source: 'standard'
    })
  }

  // 18-byte descriptors (bytes 54-125).
  for (let d = 0; d < 4; d++) {
    const o = 54 + d * 18
    const isDtd = bytes[o] !== 0 || bytes[o + 1] !== 0
    if (isDtd) {
      const dtd = parseDtd(bytes, o)
      if (dtd) {
        result.timings.push(dtd)
        if (!result.preferred) result.preferred = dtd
      }
    } else {
      switch (bytes[o + 3]) {
        case 0xfc:
          result.displayName = descriptorText(bytes, o)
          break
        case 0xff:
          result.serialString = descriptorText(bytes, o)
          break
      }
    }
  }

  // Extension blocks.
  result.extensionCount = bytes[126]
  for (let ext = 1; ext <= result.extensionCount; ext++) {
    const base = ext * 128
    if (base + 128 > bytes.length) {
      result.errors.push(`Extension block ${ext} declared but missing from file`)
      break
    }
    if (bytes[base] === 0x02) {
      try {
        parseCeaBlock(bytes, base, result)
      } catch {
        result.errors.push(`Failed to parse CEA extension block ${ext}`)
      }
    }
  }

  // Deduplicate timings (prefer detailed > cea-vic > standard > established).
  const priority: Record<string, number> = { detailed: 0, 'cea-vic': 1, standard: 2, established: 3 }
  const seen = new Map<string, EdidTiming>()
  for (const t of result.timings) {
    const key = `${t.width}x${t.height}@${Math.round(t.refreshHz)}${t.interlaced ? 'i' : ''}`
    const existing = seen.get(key)
    if (!existing || priority[t.source] < priority[existing.source]) seen.set(key, t)
  }
  result.timings = Array.from(seen.values()).sort(
    (a, b) => b.width * b.height - a.width * a.height || b.refreshHz - a.refreshHz
  )

  result.valid = result.errors.length === 0 || result.checksumOk
  return result
}

// ---------------------------------------------------------------------------
// monitor_profile.xml generation (IddCxMonitorConfig format)
// ---------------------------------------------------------------------------

function fmt(n: number, decimals: number): string {
  return n.toFixed(decimals)
}

export function generateMonitorProfileXml(edid: ParsedEdid): string {
  const lines: string[] = []
  lines.push(`<?xml version='1.0' encoding='utf-8'?>`)
  lines.push(`<!-- Generated by Virtual Driver Control from EDID`)
  lines.push(`     Monitor: ${edid.displayName ?? 'Unknown'} (${edid.manufacturerId} ${edid.productCode})`)
  lines.push(`     Generated: ${new Date().toISOString()} -->`)
  lines.push(`<IddCxMonitorConfig>`)
  lines.push(`  <MonitorModes>`)

  const modes = edid.timings.filter((t) => !t.interlaced && t.refreshHz > 0)
  for (const mode of modes) {
    const nominal = Math.round(mode.refreshHz)
    const isIntegral = Math.abs(mode.refreshHz - nominal) < 0.001
    lines.push(`    <MonitorMode>`)
    lines.push(`      <Width>${mode.width}</Width>`)
    lines.push(`      <Height>${mode.height}</Height>`)
    lines.push(`      <RefreshRate>${fmt(mode.refreshHz, 3)}</RefreshRate>`)
    lines.push(`      <RefreshRateMultiplier>${isIntegral ? 1000 : 999}</RefreshRateMultiplier>`)
    lines.push(`      <NominalRefreshRate>${nominal}</NominalRefreshRate>`)
    lines.push(`    </MonitorMode>`)
  }

  lines.push(`  </MonitorModes>`)
  lines.push(`  <ColorProfile>`)
  lines.push(`    <PrimaryColorSpace>sRGB</PrimaryColorSpace>`)
  lines.push(`    <Gamma>${fmt(edid.gamma ?? 2.2, 3)}</Gamma>`)
  const c: EdidChromaticity =
    edid.chromaticity ?? {
      redX: 0.64,
      redY: 0.33,
      greenX: 0.3,
      greenY: 0.6,
      blueX: 0.15,
      blueY: 0.06,
      whiteX: 0.3127,
      whiteY: 0.329
    }
  lines.push(`    <Chromaticity>`)
  lines.push(`      <RedX>${fmt(c.redX, 4)}</RedX>`)
  lines.push(`      <RedY>${fmt(c.redY, 4)}</RedY>`)
  lines.push(`      <GreenX>${fmt(c.greenX, 4)}</GreenX>`)
  lines.push(`      <GreenY>${fmt(c.greenY, 4)}</GreenY>`)
  lines.push(`      <BlueX>${fmt(c.blueX, 4)}</BlueX>`)
  lines.push(`      <BlueY>${fmt(c.blueY, 4)}</BlueY>`)
  lines.push(`      <WhiteX>${fmt(c.whiteX, 4)}</WhiteX>`)
  lines.push(`      <WhiteY>${fmt(c.whiteY, 4)}</WhiteY>`)
  lines.push(`    </Chromaticity>`)
  lines.push(`  </ColorProfile>`)

  const preferred = edid.preferred ?? modes[0]
  if (preferred) {
    lines.push(`  <PreferredMode>`)
    lines.push(`    <Width>${preferred.width}</Width>`)
    lines.push(`    <Height>${preferred.height}</Height>`)
    lines.push(`    <RefreshRate>${fmt(preferred.refreshHz, 3)}</RefreshRate>`)
    lines.push(`  </PreferredMode>`)
  }

  lines.push(`</IddCxMonitorConfig>`)
  return lines.join('\n')
}
