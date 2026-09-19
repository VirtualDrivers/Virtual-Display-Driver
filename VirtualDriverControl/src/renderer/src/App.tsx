import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SaveBar } from './components/SaveBar'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { AudioPage } from './pages/AudioPage'
import { ConsolePage } from './pages/ConsolePage'
import { ColorPage } from './pages/ColorPage'
import { DashboardPage } from './pages/DashboardPage'
import { DisplaysPage } from './pages/DisplaysPage'
import { EdidPage } from './pages/EdidPage'
import { GpuPage } from './pages/GpuPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAudio } from './stores/audio'
import { useDriver } from './stores/driver'
import { useLogs } from './stores/logs'
import { useSettings } from './stores/settings'
import { useUi, type PageId } from './stores/ui'

const PAGES: Record<PageId, () => React.JSX.Element> = {
  dashboard: DashboardPage,
  displays: DisplaysPage,
  color: ColorPage,
  edid: EdidPage,
  gpu: GpuPage,
  audio: AudioPage,
  console: ConsolePage,
  settings: SettingsPage
}

export default function App(): React.JSX.Element {
  const page = useUi((s) => s.page)
  const initPrefs = useUi((s) => s.initPrefs)
  const setMaximized = useUi((s) => s.setMaximized)

  useEffect(() => {
    document.body.dataset.backdrop = window.vdd.env.backdrop
    // Audio init waits for prefs so saved routes can be re-armed.
    void initPrefs().then(() => useAudio.getState().init())
    void useDriver.getState().init()
    void useSettings.getState().load()
    void useLogs.getState().init()
    const unsubscribe = window.vdd.events.onMaximized(setMaximized)
    return unsubscribe
  }, [initPrefs, setMaximized])

  const Page = PAGES[page]

  return (
    <div className="app-shell">
      <TitleBar />
      <Sidebar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className="page-scroll"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.25, 1] }}
          >
            <Page />
          </motion.div>
        </AnimatePresence>
        <SaveBar />
      </main>
      <Toasts />
    </div>
  )
}
