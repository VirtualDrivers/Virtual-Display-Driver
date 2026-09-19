import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { useUi, type ToastKind } from '@renderer/stores/ui'

const ICONS: Record<ToastKind, React.JSX.Element> = {
  success: <CheckCircle2 size={17} />,
  error: <XCircle size={17} />,
  info: <Info size={17} />,
  warning: <AlertTriangle size={17} />
}

export function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)

  return (
    <div className="toast-stack">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast ${toast.kind}`}
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.25, 1] }}
            layout
          >
            <span className="toast-icon">{ICONS[toast.kind]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{toast.title}</div>
              {toast.message && <div className="toast-message">{toast.message}</div>}
            </div>
            <button type="button" className="btn ghost small icon-only" onClick={() => dismiss(toast.id)}>
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
