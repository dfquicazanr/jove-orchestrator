import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { filamentSpiralColor, filamentSpiralLowContrastOnZone } from '../lib/filamentSpiralColor'

/** Reference spool size for spiral length only (actual grams are shown in text). */
const REF_SPOOL_G = 1000

function archimedeanSpiralPath(cx: number, cy: number, maxR: number, coils: number, steps: number): string {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const theta = u * coils * 2 * Math.PI
    const r = u * maxR
    const x = cx + r * Math.cos(theta)
    const y = cy + r * Math.sin(theta)
    d += (i === 0 ? 'M' : 'L') + `${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d
}

type Props = {
  remainingGrams: number
  /** Free-text loaded color (e.g. ``opaque black``); drives spiral stroke color. */
  loadedColor?: string
}

export function FilamentSpiralGraphic({ remainingGrams, loadedColor = '' }: Props) {
  const d = useMemo(() => archimedeanSpiralPath(50, 50, 38, 5, 120), [])
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLen, setPathLen] = useState(0)
  const spiralColor = useMemo(() => filamentSpiralColor(loadedColor), [loadedColor])
  const lowContrast = useMemo(() => filamentSpiralLowContrastOnZone(spiralColor), [spiralColor])

  useLayoutEffect(() => {
    const el = pathRef.current
    if (!el) return
    setPathLen(el.getTotalLength())
  }, [d])

  const g = Math.max(0, remainingGrams)
  const fill = Math.min(1, g / REF_SPOOL_G)
  const dashOffset = pathLen > 0 ? pathLen * (1 - fill) : 0
  const emphasizeDot = g > 0 && fill < 0.07

  const dashStyle =
    pathLen > 0
      ? {
          strokeDasharray: pathLen,
          strokeDashoffset: emphasizeDot ? pathLen : dashOffset,
          transition: 'stroke-dashoffset 0.45s ease, stroke-width 0.25s ease',
        }
      : undefined

  const haloStroke = 'rgba(232, 238, 247, 0.5)'

  return (
    <svg
      className="filament-spiral-svg"
      viewBox="0 0 100 100"
      aria-hidden
      style={{ color: spiralColor, transition: 'color 0.35s ease' }}
    >
      {lowContrast && !emphasizeDot ? (
        <path
          d={d}
          fill="none"
          stroke={haloStroke}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={dashStyle}
        />
      ) : null}
      <path
        ref={pathRef}
        d={d}
        fill="none"
        className="filament-spiral-path"
        strokeWidth={emphasizeDot ? 0 : 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={dashStyle}
      />
      <circle
        className="filament-spiral-dot"
        cx={50}
        cy={50}
        r={g <= 0 ? 2 : emphasizeDot ? 3.2 : 0}
        fill="currentColor"
        stroke={lowContrast && (emphasizeDot || g <= 0) ? haloStroke : 'none'}
        strokeWidth={lowContrast && (emphasizeDot || g <= 0) ? 1.25 : 0}
        style={{ opacity: g <= 0 ? 0.35 : emphasizeDot ? 1 : 0 }}
      />
    </svg>
  )
}
