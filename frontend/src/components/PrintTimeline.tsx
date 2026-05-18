import { useEffect, useMemo, useRef } from 'react'
import {
  formatTimelineTick,
  scheduleTimeBounds,
  type PrinterLane,
  type TimelineClip,
} from '../lib/printerSchedule'

const PX_PER_HOUR = 120
const LANE_HEIGHT = 44
const HEADER_HEIGHT = 28

type Props = {
  lanes: PrinterLane[]
  clips: TimelineClip[]
  nowMs?: number
  showNowLine?: boolean
  emptyMessage?: string
}

function statusClass(status: TimelineClip['status']): string {
  switch (status) {
    case 'printing':
      return 'timeline-clip--printing'
    case 'queued':
      return 'timeline-clip--queued'
    case 'done':
      return 'timeline-clip--done'
    case 'draft':
      return 'timeline-clip--draft'
    default:
      return 'timeline-clip--other'
  }
}

export function PrintTimeline({
  lanes,
  clips,
  nowMs = Date.now(),
  showNowLine = true,
  emptyMessage = 'Nothing scheduled yet.',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const { startMs, endMs, widthPx, ticks, laneIndex } = useMemo(() => {
    const bounds = scheduleTimeBounds(clips, nowMs)
    const spanMs = Math.max(bounds.endMs - bounds.startMs, 3600 * 1000)
    const widthPx = (spanMs / 3600000) * PX_PER_HOUR
    const tickStepMs = spanMs > 24 * 3600 * 1000 ? 6 * 3600 * 1000 : 3600 * 1000
    const ticks: number[] = []
    let t = Math.ceil(bounds.startMs / tickStepMs) * tickStepMs
    while (t <= bounds.endMs) {
      ticks.push(t)
      t += tickStepMs
    }
    const laneIndex = new Map(lanes.map((l, i) => [l.key, i]))
    return { ...bounds, widthPx, ticks, laneIndex }
  }, [clips, lanes, nowMs])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nowX = ((nowMs - startMs) / (endMs - startMs)) * widthPx
    el.scrollLeft = Math.max(0, nowX - el.clientWidth * 0.35)
  }, [startMs, endMs, widthPx, nowMs])

  if (lanes.length === 0) {
    return <p className="muted">{emptyMessage}</p>
  }

  const totalHeight = HEADER_HEIGHT + lanes.length * LANE_HEIGHT

  function msToX(ms: number): number {
    return ((ms - startMs) / (endMs - startMs)) * widthPx
  }

  const nowX = msToX(nowMs)

  return (
    <div className="print-timeline">
      <div className="print-timeline-legend muted small">
        <span>
          <span className="timeline-swatch timeline-swatch--done" /> Done
        </span>
        <span>
          <span className="timeline-swatch timeline-swatch--printing" /> Printing
        </span>
        <span>
          <span className="timeline-swatch timeline-swatch--queued" /> Queued
        </span>
        <span>
          <span className="timeline-swatch timeline-swatch--draft" /> Draft / unassigned
        </span>
      </div>

      <div className="print-timeline-shell">
        <div className="print-timeline-labels" style={{ paddingTop: HEADER_HEIGHT }}>
          {lanes.map((lane) => (
            <div key={lane.key} className="print-timeline-label" style={{ height: LANE_HEIGHT }}>
              {lane.label}
            </div>
          ))}
        </div>

        <div ref={scrollRef} className="print-timeline-scroll">
          <div className="print-timeline-canvas" style={{ width: widthPx, height: totalHeight }}>
            <div className="print-timeline-axis" style={{ height: HEADER_HEIGHT }}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="print-timeline-tick"
                  style={{ left: msToX(t) }}
                >
                  {formatTimelineTick(t)}
                </span>
              ))}
            </div>

            {lanes.map((lane, row) => (
              <div
                key={lane.key}
                className="print-timeline-lane"
                style={{ top: HEADER_HEIGHT + row * LANE_HEIGHT, height: LANE_HEIGHT }}
              />
            ))}

            {clips.map((clip) => {
              const row = laneIndex.get(clip.laneKey)
              if (row == null) return null
              const left = msToX(clip.startMs)
              const w = Math.max(msToX(clip.endMs) - left, 4)
              const top = HEADER_HEIGHT + row * LANE_HEIGHT + 6
              return (
                <div
                  key={clip.id}
                  className={`timeline-clip ${statusClass(clip.status)}${clip.missingDuration ? ' timeline-clip--missing-duration' : ''}`}
                  style={{ left, width: w, top, height: LANE_HEIGHT - 12 }}
                  title={
                    clip.missingDuration
                      ? `${clip.label} — estimated duration missing`
                      : `${clip.label} (${clip.status})`
                  }
                >
                  <span className="timeline-clip-label">{clip.label}</span>
                </div>
              )
            })}

            {showNowLine ? (
              <div className="print-timeline-now" style={{ left: nowX, height: totalHeight }} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
