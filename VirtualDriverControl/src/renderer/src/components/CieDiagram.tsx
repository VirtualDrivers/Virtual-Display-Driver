import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Interactive CIE 1931 xy chromaticity diagram.
 * Canvas renders the spectral horseshoe with approximate sRGB colors;
 * an SVG overlay draws the gamut triangle with draggable R/G/B/white handles.
 */

// CIE 1931 2-degree observer spectral locus (wavelength, x, y), 380-700nm.
const SPECTRAL_LOCUS: Array<[number, number, number]> = [
  [380, 0.1741, 0.005], [390, 0.1738, 0.0049], [400, 0.1733, 0.0048], [410, 0.1726, 0.0048],
  [420, 0.1714, 0.0051], [430, 0.1689, 0.0069], [440, 0.1644, 0.0109], [450, 0.1566, 0.0177],
  [460, 0.144, 0.0297], [465, 0.1355, 0.0399], [470, 0.1241, 0.0578], [475, 0.1096, 0.0868],
  [480, 0.0913, 0.1327], [485, 0.0687, 0.2007], [490, 0.0454, 0.295], [495, 0.0235, 0.4127],
  [500, 0.0082, 0.5384], [505, 0.0039, 0.6548], [510, 0.0139, 0.7502], [515, 0.0389, 0.812],
  [520, 0.0743, 0.8338], [525, 0.1142, 0.8262], [530, 0.1547, 0.8059], [535, 0.1929, 0.7816],
  [540, 0.2296, 0.7543], [545, 0.2658, 0.7243], [550, 0.3016, 0.6923], [555, 0.3373, 0.6589],
  [560, 0.3731, 0.6245], [565, 0.4087, 0.5896], [570, 0.4441, 0.5547], [575, 0.4788, 0.5202],
  [580, 0.5125, 0.4866], [585, 0.5448, 0.4544], [590, 0.5752, 0.4242], [595, 0.6029, 0.3965],
  [600, 0.627, 0.3725], [605, 0.6482, 0.3514], [610, 0.6658, 0.334], [620, 0.6915, 0.3083],
  [630, 0.7079, 0.292], [640, 0.719, 0.2809], [650, 0.726, 0.274], [660, 0.73, 0.27],
  [680, 0.7334, 0.2666], [700, 0.7347, 0.2653]
]

const X_MAX = 0.8
const Y_MAX = 0.9

export interface CiePoints {
  redX: number
  redY: number
  greenX: number
  greenY: number
  blueX: number
  blueY: number
  whiteX: number
  whiteY: number
}

type HandleId = 'red' | 'green' | 'blue' | 'white'

function pointInPolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function xyToRgb(x: number, y: number): [number, number, number] {
  if (y <= 0.0001) return [0, 0, 0]
  const Y = 1
  const X = (x * Y) / y
  const Z = ((1 - x - y) * Y) / y
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z
  r = Math.max(0, r)
  g = Math.max(0, g)
  b = Math.max(0, b)
  const max = Math.max(r, g, b)
  if (max > 0) {
    r /= max
    g /= max
    b /= max
  }
  const encode = (c: number): number => Math.round(255 * Math.pow(c, 1 / 2.2))
  return [encode(r), encode(g), encode(b)]
}

const HANDLE_META: Record<HandleId, { label: string; fill: string }> = {
  red: { label: 'R', fill: '#ff5d5d' },
  green: { label: 'G', fill: '#4ade80' },
  blue: { label: 'B', fill: '#60a5fa' },
  white: { label: 'W', fill: '#ffffff' }
}

export function CieDiagram(props: {
  value: CiePoints
  onChange: (patch: Partial<CiePoints>) => void
  disabled?: boolean
  width?: number
}): React.JSX.Element {
  const width = props.width ?? 380
  const height = Math.round((width * Y_MAX) / X_MAX)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<HandleId | null>(null)

  const toPx = useMemo(
    () => ({
      x: (cx: number) => (cx / X_MAX) * width,
      y: (cy: number) => height - (cy / Y_MAX) * height
    }),
    [width, height]
  )

  // Render the horseshoe once per size.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const polygon: Array<[number, number]> = SPECTRAL_LOCUS.map(([, x, y]) => [x, y])
    const image = ctx.createImageData(width, height)
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const cx = (px / width) * X_MAX
        const cy = ((height - py) / height) * Y_MAX
        if (!pointInPolygon(cx, cy, polygon)) continue
        const [r, g, b] = xyToRgb(cx, cy)
        const idx = (py * width + px) * 4
        image.data[idx] = r
        image.data[idx + 1] = g
        image.data[idx + 2] = b
        image.data[idx + 3] = 235
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [width, height])

  // Pointer dragging on the SVG overlay.
  useEffect(() => {
    if (!dragging) return
    const svg = svgRef.current
    if (!svg) return

    const onMove = (event: PointerEvent): void => {
      const rect = svg.getBoundingClientRect()
      const cx = Math.max(0.001, Math.min(X_MAX, ((event.clientX - rect.left) / rect.width) * X_MAX))
      const cy = Math.max(0.001, Math.min(Y_MAX, ((rect.bottom - event.clientY) / rect.height) * Y_MAX))
      const rx = Math.round(cx * 10000) / 10000
      const ry = Math.round(cy * 10000) / 10000
      if (dragging === 'red') props.onChange({ redX: rx, redY: ry })
      else if (dragging === 'green') props.onChange({ greenX: rx, greenY: ry })
      else if (dragging === 'blue') props.onChange({ blueX: rx, blueY: ry })
      else props.onChange({ whiteX: rx, whiteY: ry })
    }
    const onUp = (): void => setDragging(null)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, props])

  const v = props.value
  const handles: Array<{ id: HandleId; x: number; y: number }> = [
    { id: 'red', x: v.redX, y: v.redY },
    { id: 'green', x: v.greenX, y: v.greenY },
    { id: 'blue', x: v.blueX, y: v.blueY },
    { id: 'white', x: v.whiteX, y: v.whiteY }
  ]

  const trianglePoints = `${toPx.x(v.redX)},${toPx.y(v.redY)} ${toPx.x(v.greenX)},${toPx.y(v.greenY)} ${toPx.x(v.blueX)},${toPx.y(v.blueY)}`
  // sRGB reference triangle for comparison.
  const srgbPoints = `${toPx.x(0.64)},${toPx.y(0.33)} ${toPx.x(0.3)},${toPx.y(0.6)} ${toPx.x(0.15)},${toPx.y(0.06)}`

  return (
    <div style={{ position: 'relative', width, height, opacity: props.disabled ? 0.45 : 1 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, borderRadius: 10, filter: 'saturate(0.9)' }}
      />
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
        role="application"
        aria-label="Chromaticity diagram"
      >
        <polygon points={srgbPoints} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1} strokeDasharray="4 4" />
        <polygon points={trianglePoints} fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
        {handles.map((h) => (
          <g
            key={h.id}
            transform={`translate(${toPx.x(h.x)}, ${toPx.y(h.y)})`}
            style={{ cursor: props.disabled ? 'default' : 'grab' }}
            onPointerDown={(e) => {
              if (props.disabled) return
              e.preventDefault()
              setDragging(h.id)
            }}
          >
            <circle r={9} fill="rgba(0,0,0,0.45)" />
            <circle r={6.5} fill={HANDLE_META[h.id].fill} stroke="#0a0d13" strokeWidth={1.5} />
            <text y={-13} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" style={{ userSelect: 'none' }}>
              {HANDLE_META[h.id].label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
