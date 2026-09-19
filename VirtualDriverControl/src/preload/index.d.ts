import type { VddApi } from './index'

declare global {
  interface Window {
    vdd: VddApi
  }
}

export {}
