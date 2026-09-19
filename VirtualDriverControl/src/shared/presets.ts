export interface ResolutionPreset {
  width: number
  height: number
  label: string
  category: 'Standard' | 'HD' | 'QHD' | '4K & Beyond' | 'Ultrawide' | 'Portable & Tablet'
}

/** Curated subset of the upstream option.txt preset list (640x480 - 10240x4320). */
export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { width: 640, height: 480, label: 'VGA', category: 'Standard' },
  { width: 800, height: 600, label: 'SVGA', category: 'Standard' },
  { width: 1024, height: 768, label: 'XGA', category: 'Standard' },
  { width: 1280, height: 1024, label: 'SXGA', category: 'Standard' },
  { width: 1400, height: 1050, label: 'SXGA+', category: 'Standard' },
  { width: 1600, height: 1200, label: 'UXGA', category: 'Standard' },

  { width: 1280, height: 720, label: 'HD 720p', category: 'HD' },
  { width: 1366, height: 768, label: 'WXGA', category: 'HD' },
  { width: 1600, height: 900, label: 'HD+', category: 'HD' },
  { width: 1920, height: 1080, label: 'Full HD 1080p', category: 'HD' },
  { width: 1920, height: 1200, label: 'WUXGA', category: 'HD' },

  { width: 2560, height: 1440, label: 'QHD 1440p', category: 'QHD' },
  { width: 2560, height: 1600, label: 'WQXGA', category: 'QHD' },
  { width: 2880, height: 1620, label: 'QHD+ 3K', category: 'QHD' },
  { width: 3200, height: 1800, label: 'WQXGA+', category: 'QHD' },

  { width: 3840, height: 2160, label: '4K UHD', category: '4K & Beyond' },
  { width: 4096, height: 2160, label: 'DCI 4K', category: '4K & Beyond' },
  { width: 5120, height: 2880, label: '5K', category: '4K & Beyond' },
  { width: 6016, height: 3384, label: '6K', category: '4K & Beyond' },
  { width: 7680, height: 4320, label: '8K UHD', category: '4K & Beyond' },

  { width: 2560, height: 1080, label: 'UW-FHD 21:9', category: 'Ultrawide' },
  { width: 3440, height: 1440, label: 'UW-QHD 21:9', category: 'Ultrawide' },
  { width: 3840, height: 1600, label: 'UW-QHD+ 24:10', category: 'Ultrawide' },
  { width: 5120, height: 1440, label: 'Super UW 32:9', category: 'Ultrawide' },
  { width: 5120, height: 2160, label: '5K2K 21:9', category: 'Ultrawide' },

  { width: 1280, height: 800, label: 'WXGA Tablet', category: 'Portable & Tablet' },
  { width: 2048, height: 1536, label: 'iPad Retina 4:3', category: 'Portable & Tablet' },
  { width: 2160, height: 1440, label: 'Surface 3:2', category: 'Portable & Tablet' },
  { width: 2256, height: 1504, label: 'Surface Laptop 3:2', category: 'Portable & Tablet' },
  { width: 2736, height: 1824, label: 'Surface Pro 3:2', category: 'Portable & Tablet' },
  { width: 2880, height: 1920, label: 'Surface Pro 8+ 3:2', category: 'Portable & Tablet' }
]

/** Common refresh-rate chips offered in the editor. */
export const REFRESH_RATE_PRESETS: number[] = [24, 30, 50, 59.94, 60, 75, 90, 100, 120, 144, 165, 175, 200, 240, 360]

export function aspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(width, height)
  let w = width / g
  let h = height / g
  // Render familiar marketing ratios.
  if (w === 8 && h === 5) [w, h] = [16, 10]
  if (w === 7 && h === 3) [w, h] = [21, 9]
  if (w === 64 && h === 27) [w, h] = [21, 9]
  if (w === 43 && h === 18) [w, h] = [21, 9]
  if (w === 12 && h === 5) [w, h] = [21, 9]
  if (w === 32 && h === 10) [w, h] = [32, 10]
  if (w > 40) return `${(width / height).toFixed(2)}:1`
  return `${w}:${h}`
}
