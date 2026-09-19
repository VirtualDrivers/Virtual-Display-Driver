import { execFile } from 'child_process'
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { AudioEndpoint } from '@shared/types'

const execFileAsync = promisify(execFile)

/** MMDevice endpoint id, e.g. {0.0.0.00000000}.{c2f56a7e-...}. */
export const ENDPOINT_ID_PATTERN = /^\{0\.0\.[01]\.00000000\}\.\{[0-9a-fA-F-]{36}\}$/

/**
 * Core Audio interop (C# 5 compatible for Windows PowerShell's compiler).
 * Covers endpoint enumeration, default-device switching (IPolicyConfig),
 * master volume and mute (IAudioEndpointVolume).
 */
const CORE_AUDIO_CSHARP = `
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace VddAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumeratorCom { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    int GetDevice(string id, out IMMDevice device);
  }

  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore properties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }

  [Guid("1BE09788-6894-4089-8586-9A2A6C265AC5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMEndpoint {
    int GetDataFlow(out int dataFlow);
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey { public Guid fmtid; public int pid; }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropVariant {
    public ushort vt;
    public ushort r1; public ushort r2; public ushort r3;
    public IntPtr p;
    public int p2;
  }

  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out int count);
    int GetAt(int index, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
    int SetValue(ref PropertyKey key, ref PropVariant value);
    int Commit();
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out int count);
    int SetMasterVolumeLevel(float levelDb, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float levelDb);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(int ch, float levelDb, ref Guid ctx);
    int SetChannelVolumeLevelScalar(int ch, float level, ref Guid ctx);
    int GetChannelVolumeLevel(int ch, out float levelDb);
    int GetChannelVolumeLevelScalar(int ch, out float level);
    int SetMute(bool mute, ref Guid ctx);
    int GetMute(out bool mute);
  }

  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
  public class PolicyConfigClientCom { }

  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig {
    int GetMixFormat(string id, IntPtr fmt);
    int GetDeviceFormat(string id, bool isDefault, IntPtr fmt);
    int ResetDeviceFormat(string id);
    int SetDeviceFormat(string id, IntPtr a, IntPtr b);
    int GetProcessingPeriod(string id, bool isDefault, IntPtr a, IntPtr b);
    int SetProcessingPeriod(string id, IntPtr a);
    int GetShareMode(string id, IntPtr mode);
    int SetShareMode(string id, IntPtr mode);
    int GetPropertyValue(string id, bool fxStore, IntPtr key, IntPtr pv);
    int SetPropertyValue(string id, bool fxStore, IntPtr key, IntPtr pv);
    int SetDefaultEndpoint(string id, int role);
    int SetEndpointVisibility(string id, bool visible);
  }

  public static class AudioCtl {
    static Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    static IMMDeviceEnumerator Enumerator() {
      return (IMMDeviceEnumerator)(object)(new MMDeviceEnumeratorCom());
    }

    static string DefaultId(IMMDeviceEnumerator en, int flow, int role) {
      IMMDevice dev;
      if (en.GetDefaultAudioEndpoint(flow, role, out dev) != 0) return "";
      string id;
      dev.GetId(out id);
      return id;
    }

    static string FriendlyName(IMMDevice dev) {
      IPropertyStore store;
      if (dev.OpenPropertyStore(0, out store) != 0) return "";
      PropertyKey key = new PropertyKey();
      key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
      key.pid = 14;
      PropVariant pv;
      if (store.GetValue(ref key, out pv) != 0) return "";
      if (pv.vt != 31 || pv.p == IntPtr.Zero) return "";
      return Marshal.PtrToStringUni(pv.p);
    }

    static IAudioEndpointVolume Volume(IMMDevice dev) {
      object o;
      if (dev.Activate(ref IID_IAudioEndpointVolume, 23, IntPtr.Zero, out o) != 0) return null;
      return (IAudioEndpointVolume)o;
    }

    // Tab-separated: id, flow, isDefault, isDefaultComm, volume, muted, name
    public static string ListTsv() {
      IMMDeviceEnumerator en = Enumerator();
      string defRender = DefaultId(en, 0, 1);
      string defRenderComm = DefaultId(en, 0, 2);
      string defCapture = DefaultId(en, 1, 1);
      string defCaptureComm = DefaultId(en, 1, 2);

      StringBuilder sb = new StringBuilder();
      IMMDeviceCollection col;
      // eAll = 2, DEVICE_STATE_ACTIVE = 1
      if (en.EnumAudioEndpoints(2, 1, out col) != 0) return "";
      int count;
      col.GetCount(out count);
      for (int i = 0; i < count; i++) {
        IMMDevice dev;
        if (col.Item(i, out dev) != 0) continue;
        string id;
        dev.GetId(out id);
        int flow = 0;
        ((IMMEndpoint)dev).GetDataFlow(out flow);
        string name = FriendlyName(dev);
        float vol = 0; bool mute = false;
        IAudioEndpointVolume v = Volume(dev);
        if (v != null) {
          v.GetMasterVolumeLevelScalar(out vol);
          v.GetMute(out mute);
        }
        bool isDef = (flow == 0) ? (id == defRender) : (id == defCapture);
        bool isDefComm = (flow == 0) ? (id == defRenderComm) : (id == defCaptureComm);
        sb.Append(id).Append('\\t')
          .Append(flow == 0 ? "render" : "capture").Append('\\t')
          .Append(isDef ? "1" : "0").Append('\\t')
          .Append(isDefComm ? "1" : "0").Append('\\t')
          .Append(vol.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('\\t')
          .Append(mute ? "1" : "0").Append('\\t')
          .Append(name == null ? "" : name.Replace('\\t', ' '))
          .Append('\\n');
      }
      return sb.ToString();
    }

    public static int SetDefault(string id) {
      IPolicyConfig pc = (IPolicyConfig)(object)(new PolicyConfigClientCom());
      int rc = 0;
      // eConsole=0, eMultimedia=1, eCommunications=2
      for (int role = 0; role <= 2; role++) {
        int r = pc.SetDefaultEndpoint(id, role);
        if (r != 0) rc = r;
      }
      return rc;
    }

    public static int SetVolume(string id, float level) {
      IMMDeviceEnumerator en = Enumerator();
      IMMDevice dev;
      int r = en.GetDevice(id, out dev);
      if (r != 0) return r;
      IAudioEndpointVolume v = Volume(dev);
      if (v == null) return -1;
      Guid ctx = Guid.Empty;
      return v.SetMasterVolumeLevelScalar(level, ref ctx);
    }

    public static int SetMute(string id, bool mute) {
      IMMDeviceEnumerator en = Enumerator();
      IMMDevice dev;
      int r = en.GetDevice(id, out dev);
      if (r != 0) return r;
      IAudioEndpointVolume v = Volume(dev);
      if (v == null) return -1;
      Guid ctx = Guid.Empty;
      return v.SetMute(mute, ref ctx);
    }
  }
}
`.trim()

/**
 * Windows audio endpoint control. Each call runs a short PowerShell process
 * compiling the Core Audio interop above - no elevation required (volume,
 * mute and default-device changes are per-user operations).
 */
export class AudioService {
  private interopPath: string | null = null

  /** Writes the interop to a stable temp file once so scripts can dot-source it. */
  private async ensureInterop(): Promise<string> {
    if (this.interopPath) return this.interopPath
    const path = join(app.getPath('userData'), 'core-audio-interop.cs')
    await fs.writeFile(path, CORE_AUDIO_CSHARP, 'utf8')
    this.interopPath = path
    return path
  }

  private async run(psBody: string): Promise<string> {
    const interop = await this.ensureInterop()
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${interop}')`,
      psBody
    ].join('\r\n')
    const scriptPath = join(app.getPath('temp'), `vdd-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
    await fs.writeFile(scriptPath, script, 'utf8')
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
      )
      return stdout
    } finally {
      void fs.rm(scriptPath, { force: true }).catch(() => undefined)
    }
  }

  async listEndpoints(): Promise<AudioEndpoint[]> {
    const stdout = await this.run(`[VddAudio.AudioCtl]::ListTsv() | Write-Output`)
    const endpoints: AudioEndpoint[] = []
    for (const line of stdout.split('\n')) {
      const parts = line.replace(/\r$/, '').split('\t')
      if (parts.length < 7 || !ENDPOINT_ID_PATTERN.test(parts[0])) continue
      const name = parts.slice(6).join(' ')
      endpoints.push({
        id: parts[0],
        flow: parts[1] === 'capture' ? 'capture' : 'render',
        isDefault: parts[2] === '1',
        isDefaultComm: parts[3] === '1',
        volume: Math.min(1, Math.max(0, Number(parts[4]) || 0)),
        muted: parts[5] === '1',
        isVirtual: /virtual audio/i.test(name),
        name
      })
    }
    endpoints.sort((a, b) => (a.flow === b.flow ? a.name.localeCompare(b.name) : a.flow === 'render' ? -1 : 1))
    return endpoints
  }

  async setDefaultEndpoint(id: string): Promise<void> {
    this.assertId(id)
    const out = await this.run(`$rc = [VddAudio.AudioCtl]::SetDefault('${id}'); Write-Output "RC=$rc"`)
    this.assertRc(out, 'set default device')
  }

  async setVolume(id: string, volume: number): Promise<void> {
    this.assertId(id)
    const level = Math.min(1, Math.max(0, volume))
    const out = await this.run(`$rc = [VddAudio.AudioCtl]::SetVolume('${id}', ${level.toFixed(4)}); Write-Output "RC=$rc"`)
    this.assertRc(out, 'set volume')
  }

  async setMute(id: string, muted: boolean): Promise<void> {
    this.assertId(id)
    const out = await this.run(`$rc = [VddAudio.AudioCtl]::SetMute('${id}', $${muted ? 'true' : 'false'}); Write-Output "RC=$rc"`)
    this.assertRc(out, 'set mute')
  }

  private assertId(id: string): void {
    if (!ENDPOINT_ID_PATTERN.test(id)) throw new Error('Invalid audio endpoint id')
  }

  private assertRc(stdout: string, operation: string): void {
    const match = /RC=(-?\d+)/.exec(stdout)
    if (!match || Number(match[1]) !== 0) {
      throw new Error(`Failed to ${operation} (HRESULT ${match ? match[1] : 'unknown'})`)
    }
  }
}
