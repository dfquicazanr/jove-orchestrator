import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../api/client'

const DROP_MAX = 60

type Props = {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  maxLength?: number
  placeholder?: string
  /** Loads the entity list whenever this becomes true (e.g. parent modal opens). */
  active: boolean
}

export function HaEntityCombobox({
  id,
  value,
  onChange,
  disabled,
  maxLength = 256,
  placeholder,
  active,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<string[] | null>(null)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const blurSkipRef = useRef(false)

  useEffect(() => {
    setHighlight(0)
  }, [value])

  useEffect(() => {
    if (!active) {
      setCatalog(null)
      setCatalogErr(null)
      setOpen(false)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchCatalog() {
      setCatalog(null)
      setCatalogErr(null)
      setLoading(true)
      try {
        const res = await apiFetch<{ entity_ids: string[] }>('/settings/home-assistant/entities')
        const ids = Array.isArray(res.entity_ids) ? res.entity_ids.filter((x) => typeof x === 'string') : []
        ids.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        if (cancelled) return
        setCatalog(ids)
        if (ids.length === 0) {
          setCatalogErr('No switch, light, input_boolean, or fan entities reported by Home Assistant.')
        }
      } catch (err) {
        if (cancelled) return
        const msg =
          err instanceof Error ? err.message : 'Could not load Home Assistant entities from the server.'
        setCatalog([])
        setCatalogErr(`${msg} You can still type an entity id manually.`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchCatalog()
    return () => {
      cancelled = true
    }
  }, [active])

  useEffect(() => {
    function onDocPointer(ev: PointerEvent) {
      if (!wrapRef.current?.contains(ev.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('pointerdown', onDocPointer)
      return () => document.removeEventListener('pointerdown', onDocPointer)
    }
  }, [open])

  const trimmed = value.trim().toLowerCase()

  const options = useMemo(() => {
    if (!catalog || catalog.length === 0) return []
    if (!trimmed) return catalog.slice(0, DROP_MAX)
    return catalog.filter((eid) => eid.toLowerCase().includes(trimmed)).slice(0, DROP_MAX)
  }, [catalog, trimmed])

  const noMatches = Boolean(catalog && catalog.length > 0 && trimmed.length > 0 && options.length === 0)

  const showDropdown =
    open && !disabled && (loading || Boolean(catalogErr) || options.length > 0 || noMatches)

  const listboxId = `${id ?? 'ha-entity'}-listbox`

  function chooseEntity(eid: string) {
    blurSkipRef.current = true
    onChange(eid)
    setOpen(false)
    requestAnimationFrame(() => {
      blurSkipRef.current = false
    })
  }

  useEffect(() => {
    setHighlight((h) => {
      if (options.length === 0) return 0
      return Math.min(h, options.length - 1)
    })
  }, [options.length])

  return (
    <div ref={wrapRef} className="ha-entity-combobox">
      <div className="ha-entity-combobox-input-row">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={value}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(ev) => onChange(ev.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (blurSkipRef.current) return
            window.setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={(ev) => {
            if (disabled) return

            if (ev.key === 'ArrowDown') {
              ev.preventDefault()
              if (!showDropdown) setOpen(true)
              setHighlight((i) => (options.length === 0 ? i : Math.min(i + 1, options.length - 1)))
            } else if (ev.key === 'ArrowUp') {
              ev.preventDefault()
              if (!showDropdown) setOpen(true)
              setHighlight((i) => (options.length === 0 ? i : Math.max(i - 1, 0)))
            } else if (ev.key === 'Enter' && showDropdown && options.length > 0) {
              ev.preventDefault()
              chooseEntity(options[highlight] ?? options[0])
            } else if (ev.key === 'Escape' && showDropdown) {
              ev.preventDefault()
              setOpen(false)
            }
          }}
        />
        <button
          type="button"
          className="btn ghost sm ha-entity-combobox-toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Show Home Assistant entities"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          onMouseDown={(e) => {
            e.preventDefault()
          }}
          onClick={() => {
            setOpen((o) => !o)
            window.setTimeout(() => document.getElementById(id ?? '')?.focus(), 0)
          }}
        >
          {loading ? '…' : '▾'}
        </button>
      </div>

      {showDropdown ? (
        <ul id={listboxId} role="listbox" className="ha-entity-combobox-dropdown" aria-label="Home Assistant entities">
          {loading ? (
            <li role="presentation" className="ha-entity-combobox-hint">
              Loading entities from Home Assistant…
            </li>
          ) : null}
          {!loading && catalogErr ? (
            <li role="presentation" className="ha-entity-combobox-hint ha-entity-combobox-warn">
              {catalogErr}
            </li>
          ) : null}
          {!loading && noMatches ? (
            <li role="presentation" className="ha-entity-combobox-hint">
              No entities match <strong>{value.trim()}</strong> — refine your search or type the full{' '}
              <code className="inline-code">domain.object_id</code>.
            </li>
          ) : null}
          {options.map((eid, i) => (
            <li key={eid} role="option" aria-selected={i === highlight} className="ha-entity-combobox-option-li">
              <div
                className={`ha-entity-combobox-option${i === highlight ? ' highlighted' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  chooseEntity(eid)
                }}
              >
                <code>{eid}</code>
              </div>
            </li>
          ))}
          {!loading && catalog && !trimmed && catalog.length > DROP_MAX ? (
            <li role="presentation" className="ha-entity-combobox-hint">
              Showing the first {DROP_MAX} alphabetically — type to narrow.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
