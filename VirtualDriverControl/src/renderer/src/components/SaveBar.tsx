import { AnimatePresence, motion } from 'motion/react'
import { Loader2, RotateCcw, Save, Zap } from 'lucide-react'
import { useDriver } from '@renderer/stores/driver'
import { useSettings } from '@renderer/stores/settings'

export function SaveBar(): React.JSX.Element {
  const dirty = useSettings((s) => s.dirty)
  const discard = useSettings((s) => s.discard)
  const save = useSettings((s) => s.save)
  const busy = useDriver((s) => s.busy)
  const online = useDriver((s) => s.status?.pipeConnected === true)
  const saveAndApply = useDriver((s) => s.saveAndApply)

  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          className="save-bar"
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: [0.2, 0.9, 0.25, 1] }}
        >
          <span className="save-bar-text">Unsaved configuration changes</span>
          <button type="button" className="btn ghost small" disabled={busy !== null} onClick={discard}>
            <RotateCcw size={13} />
            Discard
          </button>
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => void save()}>
            <Save size={13} />
            Save
          </button>
          <button
            type="button"
            className="btn primary small"
            disabled={busy !== null}
            title={online ? 'Write vdd_settings.xml and reload the driver' : 'Driver offline - will only save the file'}
            onClick={() => void saveAndApply()}
          >
            {busy !== null ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
            Save & Apply
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
