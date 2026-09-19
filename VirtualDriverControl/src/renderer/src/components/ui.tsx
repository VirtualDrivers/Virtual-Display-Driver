import { AnimatePresence, motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card(props: {
  icon?: LucideIcon
  title?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <section className={`card ${props.className ?? ''}`}>
      {props.title && (
        <header className="card-header">
          {Icon && (
            <span className="card-icon">
              <Icon size={16} />
            </span>
          )}
          <div>
            <h3>{props.title}</h3>
            {props.subtitle && <div className="card-sub">{props.subtitle}</div>}
          </div>
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      <div className="card-body">{props.children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

export function Toggle(props: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  sublabel?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={`toggle ${props.checked ? 'on' : ''} ${props.disabled ? 'disabled' : ''}`}
      onClick={() => !props.disabled && props.onChange(!props.checked)}
      style={{ background: 'none', border: 'none', font: 'inherit', color: 'inherit', textAlign: 'left' }}
    >
      <span className="track">
        <span className="knob" />
      </span>
      {props.label && (
        <span>
          <span className="toggle-label">{props.label}</span>
          {props.sublabel && <span className="toggle-sub">{props.sublabel}</span>}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Field wrappers
// ---------------------------------------------------------------------------

export function Field(props: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function NumberField(props: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Field label={props.label} hint={props.hint}>
      <input
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={props.disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) props.onChange(n)
        }}
      />
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export function Segmented<T extends string>(props: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented">
      {props.options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={opt.value === props.value ? 'active' : ''}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal(props: {
  open: boolean
  title: string
  icon?: LucideIcon
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <AnimatePresence>
      {props.open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) props.onClose()
          }}
        >
          <motion.div
            className="modal"
            style={props.wide ? { width: 'min(1020px, 100%)' } : undefined}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.2, 0.9, 0.25, 1] }}
          >
            <div className="modal-header">
              {Icon && <Icon size={17} style={{ color: 'var(--accent-text)' }} />}
              <h3>{props.title}</h3>
            </div>
            <div className="modal-body">{props.children}</div>
            {props.footer && <div className="modal-footer">{props.footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
