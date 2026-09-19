import type { VddSettings } from './types'

/** Mirrors the upstream default vdd_settings.xml (safe values everywhere). */
export const DEFAULT_VDD_SETTINGS: VddSettings = {
  monitors: { count: 1 },
  gpu: { friendlyName: 'default' },
  global: { refreshRates: [60, 90, 120, 144, 165, 240] },
  resolutions: [
    { width: 1920, height: 1080, refreshRates: [60] },
    { width: 2560, height: 1440, refreshRates: [60] },
    { width: 3840, height: 2160, refreshRates: [60] }
  ],
  logging: {
    sendLogsThroughPipe: true,
    logging: false,
    debugLogging: false
  },
  colour: {
    sdr10bit: false,
    hdrPlus: false,
    colourFormat: 'RGB'
  },
  cursor: {
    hardwareCursor: true,
    cursorMaxX: 128,
    cursorMaxY: 128,
    alphaCursorSupport: true,
    xorCursorSupportLevel: 2
  },
  edid: {
    customEdid: false,
    preventSpoof: false,
    edidCeaOverride: false
  },
  edidIntegration: {
    enabled: false,
    autoConfigureFromEdid: false,
    edidProfilePath: 'EDID/monitor_profile.xml',
    overrideManualSettings: false,
    fallbackOnError: true
  },
  hdrAdvanced: {
    hdr10StaticMetadata: {
      enabled: false,
      maxDisplayMasteringLuminance: 1000.0,
      minDisplayMasteringLuminance: 0.05,
      maxContentLightLevel: 1000,
      maxFrameAvgLightLevel: 400
    },
    colorPrimaries: {
      enabled: false,
      redX: 0.64,
      redY: 0.33,
      greenX: 0.3,
      greenY: 0.6,
      blueX: 0.15,
      blueY: 0.06,
      whiteX: 0.3127,
      whiteY: 0.329
    },
    colorSpace: {
      enabled: false,
      gammaCorrection: 2.2,
      primaryColorSpace: 'sRGB',
      enableMatrixTransform: false
    }
  },
  autoResolutions: {
    enabled: false,
    sourcePriority: 'manual',
    edidModeFiltering: {
      minRefreshRate: 24,
      maxRefreshRate: 240,
      excludeFractionalRates: false,
      minResolutionWidth: 640,
      minResolutionHeight: 480,
      maxResolutionWidth: 7680,
      maxResolutionHeight: 4320
    },
    preferredMode: {
      useEdidPreferred: false,
      fallbackWidth: 1920,
      fallbackHeight: 1080,
      fallbackRefresh: 60
    }
  },
  colorAdvanced: {
    bitDepthManagement: {
      autoSelectFromColorSpace: false,
      forceBitDepth: 8,
      fp16SurfaceSupport: true
    },
    colorFormatExtended: {
      sdrWhiteLevel: 80.0
    }
  }
}

/** Known color space presets for the chromaticity editor. */
export const COLOR_SPACE_PRESETS: Record<
  string,
  { redX: number; redY: number; greenX: number; greenY: number; blueX: number; blueY: number; whiteX: number; whiteY: number }
> = {
  sRGB: { redX: 0.64, redY: 0.33, greenX: 0.3, greenY: 0.6, blueX: 0.15, blueY: 0.06, whiteX: 0.3127, whiteY: 0.329 },
  'DCI-P3': { redX: 0.68, redY: 0.32, greenX: 0.265, greenY: 0.69, blueX: 0.15, blueY: 0.06, whiteX: 0.314, whiteY: 0.351 },
  'Display P3': { redX: 0.68, redY: 0.32, greenX: 0.265, greenY: 0.69, blueX: 0.15, blueY: 0.06, whiteX: 0.3127, whiteY: 0.329 },
  AdobeRGB: { redX: 0.64, redY: 0.33, greenX: 0.21, greenY: 0.71, blueX: 0.15, blueY: 0.06, whiteX: 0.3127, whiteY: 0.329 },
  'Rec. 2020': { redX: 0.708, redY: 0.292, greenX: 0.17, greenY: 0.797, blueX: 0.131, blueY: 0.046, whiteX: 0.3127, whiteY: 0.329 }
}
