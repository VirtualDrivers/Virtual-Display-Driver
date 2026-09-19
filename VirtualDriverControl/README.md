# Virtual Driver Control

A modern control panel for the [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) (MttVDD).
Electron + React + TypeScript, talking to the driver over its native named pipe.

## What it does

- **Dashboard** — live driver status (PING heartbeat), an animated monitor stage, and one-click add/remove of
  virtual displays via `SETDISPLAYCOUNT`. Quick toggles for HDR+, SDR 10-bit, hardware cursor, custom EDID and logging
  apply instantly through the pipe.
- **Driver lifecycle** — download & install the latest signed [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases)
  and [Virtual Audio Driver](https://github.com/VirtualDrivers/Virtual-Audio-Driver/releases) releases: checksum-verified
  download, signer trust, `pnputil` staging and SetupAPI device-node creation, plus restart-device and uninstall —
  one UAC prompt per operation. The audio driver supports **multiple instances** (1-4 independent speaker + mic pairs).
- **Audio** — Windows endpoint control (volume, mute, default device for every playback/recording endpoint via Core
  Audio) and a live **routing matrix**: pump any microphone or the system output mix into any output device with
  per-route gain and level meters. Routes persist and re-arm on launch. Covers mic → speaker, speaker → speaker
  (System audio source) and speaker → mic (route into the virtual speaker; apps hear it on the virtual microphone).
- **Displays** — a live, to-scale **desktop arrangement map** of every attached monitor (physical and virtual, with
  real placement, resolution, refresh rate and scale - virtual displays are flagged via PnP parent lookup), plus a
  full editor for `vdd_settings.xml` resolutions: preset gallery (VGA → 8K, ultrawides, tablets), per-resolution and
  global refresh rates (fractional rates supported), preferred/fallback mode, and a to-scale size comparison.
- **HDR & Color** — color format (RGB / YCbCr), HDR10 static metadata, gamma and color space, plus an interactive
  CIE 1931 chromaticity diagram with draggable R/G/B/white points.
- **EDID Lab** — drag-and-drop EDID decoder (pure TypeScript: identity, timings, chromaticity, CEA-861, HDR metadata).
  One click exports an IddCx `monitor_profile.xml` + `user_edid.bin` and enables EDID integration.
- **GPU** — adapter list from the driver (`GETALLGPUS`) with WMI fallback, one-click `SETGPU` assignment.
- **Console** — unified live feed: driver file logs (tailed), every pipe command's streamed response, and app events.
  Filterable by severity/source, with a raw command input for power users.
- **Settings** — cursor, logging and auto-resolution options, a line-diff preview before every save, automatic
  timestamped backups with restore, themes (dark/light/system) and accent colors.

## Driver integration

| Mechanism | Use |
| --- | --- |
| `\\.\pipe\MTTVirtualDisplayPipe` | Live control. Commands are sent UTF-16LE on one-shot connections; responses are read until disconnect. All calls are serialized with timeouts and a reload cooldown. |
| `C:\VirtualDisplayDriver\vdd_settings.xml` | Full typed read/write of every section, with atomic writes and automatic backups. |
| `C:\VirtualDisplayDriver\Logs\` | Daily log files are tailed into the console feed. |
| PowerShell / WMI | Fallbacks for driver presence and GPU enumeration when the pipe is down. |
| GitHub releases API | Driver lifecycle for both drivers: fetches the latest driver package (x64/ARM64 picked automatically), verifies its published SHA-256, then installs through an elevated PowerShell script (signer → TrustedPublisher, `pnputil /add-driver`, SetupAPI root-device creation). Uninstall removes the devices and driver package but keeps your configuration. |
| Core Audio (COM interop) | Audio endpoint enumeration, volume/mute (`IAudioEndpointVolume`) and default-device switching (`IPolicyConfig`) - no elevation needed. |
| WebAudio + WASAPI loopback | The in-app routing engine: capture any input device or the system mix and play it to any output. Routes are active while the app runs. |
| Electron `screen` API | Desktop arrangement map with real bounds, scale, rotation and refresh rate for every display. |

`RELOAD_DRIVER` is intentionally **never sent** (upstream undefined behavior). Saving applies changes by writing the
XML and issuing `SETDISPLAYCOUNT <current count>`, which makes the driver reload its configuration safely.

The app runs fully offline as well: with no driver installed you can still edit, preview and save configuration.

## Development

```bash
npm install
npm run dev          # hot-reloading dev session
npm run typecheck    # strict TS for main + preload + renderer
npm run test:generated # render embedded PowerShell/C# for syntax checks
npm run build        # production bundles into out/
npm run build-portable  # portable .exe via electron-builder (admin elevation)
npm run build-portable:x64    # architecture-specific release executable
npm run build-portable:arm64  # architecture-specific release executable
```

Requires Windows and Node 18+. Run elevated if you want to write to `C:\VirtualDisplayDriver`.

## Architecture

```
src/
  main/       Electron main process: PipeClient, SettingsService, DriverService, LogService, IPC
  preload/    contextBridge API (window.vdd) - the only door between renderer and system
  renderer/   React UI: pages, components, zustand stores, design tokens
  shared/     Types, vdd_settings schema defaults, EDID parser - imported by all processes
```

Security: `contextIsolation` + `sandbox` enabled, no `nodeIntegration`, every IPC input validated in the main process,
raw pipe commands restricted to a conservative charset, external links limited to https.
