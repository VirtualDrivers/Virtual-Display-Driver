import { XMLParser } from 'fast-xml-parser'
import { promises as fs } from 'fs'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_VDD_SETTINGS } from '@shared/defaults'
import type { BackupInfo, ResolutionEntry, SaveResult, SettingsLoadResult, VddSettings } from '@shared/types'

const MAX_BACKUPS = 20

type Raw = Record<string, unknown>

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  if (typeof value === 'boolean') return value
  return fallback
}

function toNum(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function toStr(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number') return String(value)
  return fallback
}

function asRaw(value: unknown): Raw {
  return typeof value === 'object' && value !== null ? (value as Raw) : {}
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(Math.round(rate * 1000) / 1000)
}

export class SettingsService {
  constructor(private readonly getBaseDir: () => string) {}

  get settingsPath(): string {
    return join(this.getBaseDir(), 'vdd_settings.xml')
  }

  get backupsDir(): string {
    return join(this.getBaseDir(), 'Backups')
  }

  get edidDir(): string {
    return join(this.getBaseDir(), 'EDID')
  }

  /**
   * Creates the driver folder and a default vdd_settings.xml when missing,
   * so the driver always finds a valid configuration at its lookup path.
   */
  async ensureDefaults(): Promise<void> {
    try {
      mkdirSync(this.getBaseDir(), { recursive: true })
      if (!existsSync(this.settingsPath)) {
        await fs.writeFile(this.settingsPath, this.serialize(DEFAULT_VDD_SETTINGS))
      }
    } catch {
      // folder not writable without elevation - app keeps working offline
    }
  }

  async load(): Promise<SettingsLoadResult> {
    try {
      if (!existsSync(this.settingsPath)) {
        return { ok: true, settings: structuredClone(DEFAULT_VDD_SETTINGS), isDefault: true }
      }
      const rawXml = await fs.readFile(this.settingsPath, 'utf8')
      const settings = this.parse(rawXml)
      return { ok: true, settings, rawXml, isDefault: false }
    } catch (error) {
      return {
        ok: false,
        isDefault: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async rawXml(): Promise<string | null> {
    try {
      return await fs.readFile(this.settingsPath, 'utf8')
    } catch {
      return null
    }
  }

  async save(settings: VddSettings): Promise<SaveResult> {
    try {
      const xml = this.serialize(settings)
      const backupCreated = await this.backupCurrent()
      const tmpPath = `${this.settingsPath}.tmp`
      mkdirSync(this.getBaseDir(), { recursive: true })
      await fs.writeFile(tmpPath, xml, 'utf8')
      await fs.rm(this.settingsPath, { force: true })
      await fs.rename(tmpPath, this.settingsPath)
      return { ok: true, backupCreated }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async listBackups(): Promise<BackupInfo[]> {
    try {
      const entries = await fs.readdir(this.backupsDir)
      const backups: BackupInfo[] = []
      for (const fileName of entries) {
        if (!/^vdd_settings_[\d\-_]+\.xml$/.test(fileName)) continue
        const fullPath = join(this.backupsDir, fileName)
        const stat = await fs.stat(fullPath)
        backups.push({ fileName, fullPath, createdAt: stat.mtimeMs, sizeBytes: stat.size })
      }
      return backups.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  async restoreBackup(fileName: string): Promise<SaveResult> {
    try {
      if (!/^vdd_settings_[\d\-_]+\.xml$/.test(fileName)) {
        return { ok: false, error: 'Invalid backup file name' }
      }
      const source = join(this.backupsDir, fileName)
      if (!existsSync(source)) return { ok: false, error: 'Backup not found' }
      const backupCreated = await this.backupCurrent()
      await fs.copyFile(source, this.settingsPath)
      return { ok: true, backupCreated }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async saveMonitorProfile(profileXml: string, edidBytes?: Uint8Array): Promise<SaveResult> {
    try {
      mkdirSync(this.edidDir, { recursive: true })
      await fs.writeFile(join(this.edidDir, 'monitor_profile.xml'), profileXml, 'utf8')
      if (edidBytes && edidBytes.length >= 128) {
        await fs.writeFile(join(this.getBaseDir(), 'user_edid.bin'), Buffer.from(edidBytes))
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async backupCurrent(): Promise<string | undefined> {
    if (!existsSync(this.settingsPath)) return undefined
    mkdirSync(this.backupsDir, { recursive: true })
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .replace(/\..+/, '')
    const fileName = `vdd_settings_${stamp}.xml`
    await fs.copyFile(this.settingsPath, join(this.backupsDir, fileName))
    await this.pruneBackups()
    return fileName
  }

  private async pruneBackups(): Promise<void> {
    const backups = await this.listBackups()
    for (const old of backups.slice(MAX_BACKUPS)) {
      try {
        await fs.rm(old.fullPath, { force: true })
      } catch {
        // best effort
      }
    }
  }

  // -------------------------------------------------------------------------
  // XML <-> model
  // -------------------------------------------------------------------------

  parse(xml: string): VddSettings {
    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      trimValues: true,
      isArray: (name) => name === 'resolution' || name === 'g_refresh_rate' || name === 'refresh_rate'
    })
    const doc = asRaw(asRaw(parser.parse(xml)).vdd_settings)
    const d = DEFAULT_VDD_SETTINGS

    const globalNode = asRaw(doc.global)
    const resolutionsNode = asRaw(doc.resolutions)
    const loggingNode = asRaw(doc.logging)
    const colourNode = asRaw(doc.colour)
    const cursorNode = asRaw(doc.cursor)
    const edidNode = asRaw(doc.edid)
    const integrationNode = asRaw(doc.edid_integration)
    const hdrNode = asRaw(doc.hdr_advanced)
    const hdr10Node = asRaw(hdrNode.hdr10_static_metadata)
    const primariesNode = asRaw(hdrNode.color_primaries)
    const colorSpaceNode = asRaw(hdrNode.color_space)
    const autoNode = asRaw(doc.auto_resolutions)
    const filterNode = asRaw(autoNode.edid_mode_filtering)
    const preferredNode = asRaw(autoNode.preferred_mode)
    const advNode = asRaw(doc.color_advanced)
    const bitDepthNode = asRaw(advNode.bit_depth_management)
    const extFormatNode = asRaw(advNode.color_format_extended)

    const resolutions: ResolutionEntry[] = asArray(resolutionsNode.resolution)
      .map((node) => {
        const r = asRaw(node)
        const rates = asArray(r.refresh_rate)
          .map((v) => toNum(v, NaN))
          .filter((v) => Number.isFinite(v) && v > 0)
        return {
          width: toNum(r.width, 0),
          height: toNum(r.height, 0),
          refreshRates: rates.length > 0 ? rates : [60]
        }
      })
      .filter((r) => r.width > 0 && r.height > 0)

    const colourFormatRaw = toStr(colourNode.ColourFormat, d.colour.colourFormat)
    const colourFormat = (['RGB', 'YCbCr444', 'YCbCr422', 'YCbCr420'] as const).find(
      (f) => f.toLowerCase() === colourFormatRaw.toLowerCase()
    )

    return {
      monitors: { count: toNum(asRaw(doc.monitors).count, d.monitors.count) },
      gpu: { friendlyName: toStr(asRaw(doc.gpu).friendlyname, d.gpu.friendlyName) },
      global: {
        refreshRates: asArray(globalNode.g_refresh_rate)
          .map((v) => toNum(v, NaN))
          .filter((v) => Number.isFinite(v) && v > 0)
      },
      resolutions: resolutions.length > 0 ? resolutions : structuredClone(d.resolutions),
      logging: {
        sendLogsThroughPipe: toBool(loggingNode.SendLogsThroughPipe, d.logging.sendLogsThroughPipe),
        logging: toBool(loggingNode.logging, d.logging.logging),
        debugLogging: toBool(loggingNode.debuglogging, d.logging.debugLogging)
      },
      colour: {
        sdr10bit: toBool(colourNode.SDR10bit, d.colour.sdr10bit),
        hdrPlus: toBool(colourNode.HDRPlus, d.colour.hdrPlus),
        colourFormat: colourFormat ?? d.colour.colourFormat
      },
      cursor: {
        hardwareCursor: toBool(cursorNode.HardwareCursor, d.cursor.hardwareCursor),
        cursorMaxX: toNum(cursorNode.CursorMaxX, d.cursor.cursorMaxX),
        cursorMaxY: toNum(cursorNode.CursorMaxY, d.cursor.cursorMaxY),
        alphaCursorSupport: toBool(cursorNode.AlphaCursorSupport, d.cursor.alphaCursorSupport),
        xorCursorSupportLevel: toNum(cursorNode.XorCursorSupportLevel, d.cursor.xorCursorSupportLevel)
      },
      edid: {
        customEdid: toBool(edidNode.CustomEdid, d.edid.customEdid),
        preventSpoof: toBool(edidNode.PreventSpoof, d.edid.preventSpoof),
        edidCeaOverride: toBool(edidNode.EdidCeaOverride, d.edid.edidCeaOverride)
      },
      edidIntegration: {
        enabled: toBool(integrationNode.enabled, d.edidIntegration.enabled),
        autoConfigureFromEdid: toBool(integrationNode.auto_configure_from_edid, d.edidIntegration.autoConfigureFromEdid),
        edidProfilePath: toStr(integrationNode.edid_profile_path, d.edidIntegration.edidProfilePath),
        overrideManualSettings: toBool(integrationNode.override_manual_settings, d.edidIntegration.overrideManualSettings),
        fallbackOnError: toBool(integrationNode.fallback_on_error, d.edidIntegration.fallbackOnError)
      },
      hdrAdvanced: {
        hdr10StaticMetadata: {
          enabled: toBool(hdr10Node.enabled, d.hdrAdvanced.hdr10StaticMetadata.enabled),
          maxDisplayMasteringLuminance: toNum(
            hdr10Node.max_display_mastering_luminance,
            d.hdrAdvanced.hdr10StaticMetadata.maxDisplayMasteringLuminance
          ),
          minDisplayMasteringLuminance: toNum(
            hdr10Node.min_display_mastering_luminance,
            d.hdrAdvanced.hdr10StaticMetadata.minDisplayMasteringLuminance
          ),
          maxContentLightLevel: toNum(hdr10Node.max_content_light_level, d.hdrAdvanced.hdr10StaticMetadata.maxContentLightLevel),
          maxFrameAvgLightLevel: toNum(
            hdr10Node.max_frame_avg_light_level,
            d.hdrAdvanced.hdr10StaticMetadata.maxFrameAvgLightLevel
          )
        },
        colorPrimaries: {
          enabled: toBool(primariesNode.enabled, d.hdrAdvanced.colorPrimaries.enabled),
          redX: toNum(primariesNode.red_x, d.hdrAdvanced.colorPrimaries.redX),
          redY: toNum(primariesNode.red_y, d.hdrAdvanced.colorPrimaries.redY),
          greenX: toNum(primariesNode.green_x, d.hdrAdvanced.colorPrimaries.greenX),
          greenY: toNum(primariesNode.green_y, d.hdrAdvanced.colorPrimaries.greenY),
          blueX: toNum(primariesNode.blue_x, d.hdrAdvanced.colorPrimaries.blueX),
          blueY: toNum(primariesNode.blue_y, d.hdrAdvanced.colorPrimaries.blueY),
          whiteX: toNum(primariesNode.white_x, d.hdrAdvanced.colorPrimaries.whiteX),
          whiteY: toNum(primariesNode.white_y, d.hdrAdvanced.colorPrimaries.whiteY)
        },
        colorSpace: {
          enabled: toBool(colorSpaceNode.enabled, d.hdrAdvanced.colorSpace.enabled),
          gammaCorrection: toNum(colorSpaceNode.gamma_correction, d.hdrAdvanced.colorSpace.gammaCorrection),
          primaryColorSpace: toStr(colorSpaceNode.primary_color_space, d.hdrAdvanced.colorSpace.primaryColorSpace),
          enableMatrixTransform: toBool(colorSpaceNode.enable_matrix_transform, d.hdrAdvanced.colorSpace.enableMatrixTransform)
        }
      },
      autoResolutions: {
        enabled: toBool(autoNode.enabled, d.autoResolutions.enabled),
        sourcePriority: toStr(autoNode.source_priority, d.autoResolutions.sourcePriority),
        edidModeFiltering: {
          minRefreshRate: toNum(filterNode.min_refresh_rate, d.autoResolutions.edidModeFiltering.minRefreshRate),
          maxRefreshRate: toNum(filterNode.max_refresh_rate, d.autoResolutions.edidModeFiltering.maxRefreshRate),
          excludeFractionalRates: toBool(
            filterNode.exclude_fractional_rates,
            d.autoResolutions.edidModeFiltering.excludeFractionalRates
          ),
          minResolutionWidth: toNum(filterNode.min_resolution_width, d.autoResolutions.edidModeFiltering.minResolutionWidth),
          minResolutionHeight: toNum(filterNode.min_resolution_height, d.autoResolutions.edidModeFiltering.minResolutionHeight),
          maxResolutionWidth: toNum(filterNode.max_resolution_width, d.autoResolutions.edidModeFiltering.maxResolutionWidth),
          maxResolutionHeight: toNum(filterNode.max_resolution_height, d.autoResolutions.edidModeFiltering.maxResolutionHeight)
        },
        preferredMode: {
          useEdidPreferred: toBool(preferredNode.use_edid_preferred, d.autoResolutions.preferredMode.useEdidPreferred),
          fallbackWidth: toNum(preferredNode.fallback_width, d.autoResolutions.preferredMode.fallbackWidth),
          fallbackHeight: toNum(preferredNode.fallback_height, d.autoResolutions.preferredMode.fallbackHeight),
          fallbackRefresh: toNum(preferredNode.fallback_refresh, d.autoResolutions.preferredMode.fallbackRefresh)
        }
      },
      colorAdvanced: {
        bitDepthManagement: {
          autoSelectFromColorSpace: toBool(
            bitDepthNode.auto_select_from_color_space,
            d.colorAdvanced.bitDepthManagement.autoSelectFromColorSpace
          ),
          forceBitDepth: toNum(bitDepthNode.force_bit_depth, d.colorAdvanced.bitDepthManagement.forceBitDepth),
          fp16SurfaceSupport: toBool(bitDepthNode.fp16_surface_support, d.colorAdvanced.bitDepthManagement.fp16SurfaceSupport)
        },
        colorFormatExtended: {
          sdrWhiteLevel: toNum(extFormatNode.sdr_white_level, d.colorAdvanced.colorFormatExtended.sdrWhiteLevel)
        }
      }
    }
  }

  serialize(s: VddSettings): string {
    const b = (v: boolean): string => (v ? 'true' : 'false')
    const lines: string[] = []
    lines.push(`<?xml version='1.0' encoding='utf-8'?>`)
    lines.push(`<!-- Virtual Display Driver configuration`)
    lines.push(`     Written by Virtual Driver Control on ${new Date().toISOString()} -->`)
    lines.push(`<vdd_settings>`)
    lines.push(``)
    lines.push(`    <!-- === BASIC DRIVER CONFIGURATION === -->`)
    lines.push(`    <monitors>`)
    lines.push(`        <count>${Math.max(0, Math.min(99, Math.floor(s.monitors.count)))}</count>`)
    lines.push(`    </monitors>`)
    lines.push(``)
    lines.push(`    <gpu>`)
    lines.push(`        <friendlyname>${escapeXml(s.gpu.friendlyName || 'default')}</friendlyname>`)
    lines.push(`    </gpu>`)
    lines.push(``)
    lines.push(`    <!-- === RESOLUTION CONFIGURATION === -->`)
    lines.push(`    <global>`)
    for (const rate of s.global.refreshRates) {
      lines.push(`        <g_refresh_rate>${formatRate(rate)}</g_refresh_rate>`)
    }
    lines.push(`    </global>`)
    lines.push(``)
    lines.push(`    <resolutions>`)
    for (const res of s.resolutions) {
      lines.push(`        <resolution>`)
      lines.push(`            <width>${Math.floor(res.width)}</width>`)
      lines.push(`            <height>${Math.floor(res.height)}</height>`)
      for (const rate of res.refreshRates) {
        lines.push(`            <refresh_rate>${formatRate(rate)}</refresh_rate>`)
      }
      lines.push(`        </resolution>`)
    }
    lines.push(`    </resolutions>`)
    lines.push(``)
    lines.push(`    <!-- === LOGGING CONFIGURATION === -->`)
    lines.push(`    <logging>`)
    lines.push(`        <SendLogsThroughPipe>${b(s.logging.sendLogsThroughPipe)}</SendLogsThroughPipe>`)
    lines.push(`        <logging>${b(s.logging.logging)}</logging>`)
    lines.push(`        <debuglogging>${b(s.logging.debugLogging)}</debuglogging>`)
    lines.push(`    </logging>`)
    lines.push(``)
    lines.push(`    <!-- === COLOR FORMAT CONFIGURATION === -->`)
    lines.push(`    <colour>`)
    lines.push(`        <SDR10bit>${b(s.colour.sdr10bit)}</SDR10bit>`)
    lines.push(`        <HDRPlus>${b(s.colour.hdrPlus)}</HDRPlus>`)
    lines.push(`        <ColourFormat>${s.colour.colourFormat}</ColourFormat>`)
    lines.push(`    </colour>`)
    lines.push(``)
    lines.push(`    <!-- === CURSOR CONFIGURATION === -->`)
    lines.push(`    <cursor>`)
    lines.push(`        <HardwareCursor>${b(s.cursor.hardwareCursor)}</HardwareCursor>`)
    lines.push(`        <CursorMaxX>${Math.floor(s.cursor.cursorMaxX)}</CursorMaxX>`)
    lines.push(`        <CursorMaxY>${Math.floor(s.cursor.cursorMaxY)}</CursorMaxY>`)
    lines.push(`        <AlphaCursorSupport>${b(s.cursor.alphaCursorSupport)}</AlphaCursorSupport>`)
    lines.push(`        <XorCursorSupportLevel>${Math.floor(s.cursor.xorCursorSupportLevel)}</XorCursorSupportLevel>`)
    lines.push(`    </cursor>`)
    lines.push(``)
    lines.push(`    <!-- === CUSTOM EDID CONFIGURATION === -->`)
    lines.push(`    <edid>`)
    lines.push(`        <CustomEdid>${b(s.edid.customEdid)}</CustomEdid>`)
    lines.push(`        <PreventSpoof>${b(s.edid.preventSpoof)}</PreventSpoof>`)
    lines.push(`        <EdidCeaOverride>${b(s.edid.edidCeaOverride)}</EdidCeaOverride>`)
    lines.push(`    </edid>`)
    lines.push(``)
    lines.push(`    <!-- === EDID INTEGRATION SYSTEM === -->`)
    lines.push(`    <edid_integration>`)
    lines.push(`        <enabled>${b(s.edidIntegration.enabled)}</enabled>`)
    lines.push(`        <auto_configure_from_edid>${b(s.edidIntegration.autoConfigureFromEdid)}</auto_configure_from_edid>`)
    lines.push(`        <edid_profile_path>${escapeXml(s.edidIntegration.edidProfilePath)}</edid_profile_path>`)
    lines.push(`        <override_manual_settings>${b(s.edidIntegration.overrideManualSettings)}</override_manual_settings>`)
    lines.push(`        <fallback_on_error>${b(s.edidIntegration.fallbackOnError)}</fallback_on_error>`)
    lines.push(`    </edid_integration>`)
    lines.push(``)
    lines.push(`    <!-- === HDR CONFIGURATION === -->`)
    lines.push(`    <hdr_advanced>`)
    lines.push(`        <hdr10_static_metadata>`)
    lines.push(`            <enabled>${b(s.hdrAdvanced.hdr10StaticMetadata.enabled)}</enabled>`)
    lines.push(
      `            <max_display_mastering_luminance>${s.hdrAdvanced.hdr10StaticMetadata.maxDisplayMasteringLuminance.toFixed(1)}</max_display_mastering_luminance>`
    )
    lines.push(
      `            <min_display_mastering_luminance>${s.hdrAdvanced.hdr10StaticMetadata.minDisplayMasteringLuminance}</min_display_mastering_luminance>`
    )
    lines.push(
      `            <max_content_light_level>${Math.floor(s.hdrAdvanced.hdr10StaticMetadata.maxContentLightLevel)}</max_content_light_level>`
    )
    lines.push(
      `            <max_frame_avg_light_level>${Math.floor(s.hdrAdvanced.hdr10StaticMetadata.maxFrameAvgLightLevel)}</max_frame_avg_light_level>`
    )
    lines.push(`        </hdr10_static_metadata>`)
    lines.push(`        <color_primaries>`)
    lines.push(`            <enabled>${b(s.hdrAdvanced.colorPrimaries.enabled)}</enabled>`)
    lines.push(`            <red_x>${s.hdrAdvanced.colorPrimaries.redX.toFixed(3)}</red_x>`)
    lines.push(`            <red_y>${s.hdrAdvanced.colorPrimaries.redY.toFixed(3)}</red_y>`)
    lines.push(`            <green_x>${s.hdrAdvanced.colorPrimaries.greenX.toFixed(3)}</green_x>`)
    lines.push(`            <green_y>${s.hdrAdvanced.colorPrimaries.greenY.toFixed(3)}</green_y>`)
    lines.push(`            <blue_x>${s.hdrAdvanced.colorPrimaries.blueX.toFixed(3)}</blue_x>`)
    lines.push(`            <blue_y>${s.hdrAdvanced.colorPrimaries.blueY.toFixed(3)}</blue_y>`)
    lines.push(`            <white_x>${s.hdrAdvanced.colorPrimaries.whiteX.toFixed(4)}</white_x>`)
    lines.push(`            <white_y>${s.hdrAdvanced.colorPrimaries.whiteY.toFixed(4)}</white_y>`)
    lines.push(`        </color_primaries>`)
    lines.push(`        <color_space>`)
    lines.push(`            <enabled>${b(s.hdrAdvanced.colorSpace.enabled)}</enabled>`)
    lines.push(`            <gamma_correction>${s.hdrAdvanced.colorSpace.gammaCorrection}</gamma_correction>`)
    lines.push(`            <primary_color_space>${escapeXml(s.hdrAdvanced.colorSpace.primaryColorSpace)}</primary_color_space>`)
    lines.push(`            <enable_matrix_transform>${b(s.hdrAdvanced.colorSpace.enableMatrixTransform)}</enable_matrix_transform>`)
    lines.push(`        </color_space>`)
    lines.push(`    </hdr_advanced>`)
    lines.push(``)
    lines.push(`    <!-- === AUTO RESOLUTION SYSTEM === -->`)
    lines.push(`    <auto_resolutions>`)
    lines.push(`        <enabled>${b(s.autoResolutions.enabled)}</enabled>`)
    lines.push(`        <source_priority>${escapeXml(s.autoResolutions.sourcePriority)}</source_priority>`)
    lines.push(`        <edid_mode_filtering>`)
    lines.push(`            <min_refresh_rate>${formatRate(s.autoResolutions.edidModeFiltering.minRefreshRate)}</min_refresh_rate>`)
    lines.push(`            <max_refresh_rate>${formatRate(s.autoResolutions.edidModeFiltering.maxRefreshRate)}</max_refresh_rate>`)
    lines.push(
      `            <exclude_fractional_rates>${b(s.autoResolutions.edidModeFiltering.excludeFractionalRates)}</exclude_fractional_rates>`
    )
    lines.push(
      `            <min_resolution_width>${Math.floor(s.autoResolutions.edidModeFiltering.minResolutionWidth)}</min_resolution_width>`
    )
    lines.push(
      `            <min_resolution_height>${Math.floor(s.autoResolutions.edidModeFiltering.minResolutionHeight)}</min_resolution_height>`
    )
    lines.push(
      `            <max_resolution_width>${Math.floor(s.autoResolutions.edidModeFiltering.maxResolutionWidth)}</max_resolution_width>`
    )
    lines.push(
      `            <max_resolution_height>${Math.floor(s.autoResolutions.edidModeFiltering.maxResolutionHeight)}</max_resolution_height>`
    )
    lines.push(`        </edid_mode_filtering>`)
    lines.push(`        <preferred_mode>`)
    lines.push(`            <use_edid_preferred>${b(s.autoResolutions.preferredMode.useEdidPreferred)}</use_edid_preferred>`)
    lines.push(`            <fallback_width>${Math.floor(s.autoResolutions.preferredMode.fallbackWidth)}</fallback_width>`)
    lines.push(`            <fallback_height>${Math.floor(s.autoResolutions.preferredMode.fallbackHeight)}</fallback_height>`)
    lines.push(`            <fallback_refresh>${formatRate(s.autoResolutions.preferredMode.fallbackRefresh)}</fallback_refresh>`)
    lines.push(`        </preferred_mode>`)
    lines.push(`    </auto_resolutions>`)
    lines.push(``)
    lines.push(`    <!-- === ADVANCED COLOR PROCESSING === -->`)
    lines.push(`    <color_advanced>`)
    lines.push(`        <bit_depth_management>`)
    lines.push(
      `            <auto_select_from_color_space>${b(s.colorAdvanced.bitDepthManagement.autoSelectFromColorSpace)}</auto_select_from_color_space>`
    )
    lines.push(`            <force_bit_depth>${Math.floor(s.colorAdvanced.bitDepthManagement.forceBitDepth)}</force_bit_depth>`)
    lines.push(
      `            <fp16_surface_support>${b(s.colorAdvanced.bitDepthManagement.fp16SurfaceSupport)}</fp16_surface_support>`
    )
    lines.push(`        </bit_depth_management>`)
    lines.push(`        <color_format_extended>`)
    lines.push(`            <sdr_white_level>${s.colorAdvanced.colorFormatExtended.sdrWhiteLevel.toFixed(1)}</sdr_white_level>`)
    lines.push(`        </color_format_extended>`)
    lines.push(`    </color_advanced>`)
    lines.push(``)
    lines.push(`</vdd_settings>`)
    lines.push(``)
    return lines.join('\n')
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
