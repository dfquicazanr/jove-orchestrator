import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  /** Accessible name for the trigger when title alone is not enough. */
  triggerLabel?: string
}

/**
 * Info icon with a styled popover: hover on pointer devices, click to pin (touch / keyboard).
 */
export function InfoTooltip({ title, children, triggerLabel }: Props) {
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popoverId = useId()
  const open = pinned || hover

  useEffect(() => {
    if (!pinned) return
    function onDoc(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setPinned(false)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span
      ref={wrapRef}
      className={`info-tooltip${open ? ' is-open' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={(ev) => {
        const rel = ev.relatedTarget as Node | null
        if (rel && wrapRef.current?.contains(rel)) return
        setHover(false)
      }}
    >
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={triggerLabel ?? `${title} — more info`}
        onClick={(ev) => {
          ev.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        <svg className="info-tooltip-icon" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.35" />
          <path
            d="M10 8.25v5.5M10 5.75h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="info-tooltip-popover" id={popoverId} role="tooltip">
        <span className="info-tooltip-popover-title">{title}</span>
        <div className="info-tooltip-popover-body">{children}</div>
      </div>
    </span>
  )
}
