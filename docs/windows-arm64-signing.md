# Windows ARM64 signing and maintainer handoff

This runbook describes how Virtual Display Driver maintainers can produce a **Microsoft-signed ARM64 preview** that installs on HVCI-enabled Windows on ARM systems (for example Surface Laptop 7 with Snapdragon X), and how to graduate that package to WHCP certification later.

## Background

- RealWarp and other consumers detect `MttVDD` through `Root\MttVDD` and `\\.\pipe\MTTVirtualDisplayPipe`.
- The upstream ARM64 release payload is architecturally correct (`NTARM64`, native `MttVDD.dll`), but SignPath/GlobalSign catalogs are rejected by the Driver Store on systems with Memory Integrity enabled (`0x800B0109` / untrusted root).
- `PnpLockdown=1` in `MttVDD.inf` is **installed-file protection** and should remain enabled; it is not a WHQL-only switch.

Related issues:

- [#465](https://github.com/VirtualDrivers/Virtual-Display-Driver/issues/465) — ARM64 package trust failure on install
- [#483](https://github.com/VirtualDrivers/Virtual-Display-Driver/issues/483) — post-install display attachment on ARM

## Repository automation

| Script | Purpose |
| --- | --- |
| `scripts/Test-Arm64DriverPackage.ps1` | Validates folder or CAB payloads (`CI` or `Release` policy) |
| `scripts/New-AttestationCab.ps1` | Builds a Partner Center-ready attestation CAB from ARM64 Release output |
| `scripts/Invoke-Arm64AcceptanceTest.ps1` | Surface acceptance harness (Secure Boot/HVCI + Release signature gate + optional install) |

GitHub Actions (`.github/workflows/ci-validation.yml`) builds ARM64 Release output, runs **CI** validation, creates the attestation CAB, round-trip validates the CAB, and uploads:

- `VDD-ARM64-Release` — raw build output
- `VDD-ARM64-Attestation-CAB` — submission CAB (unsigned; EV signing happens offline)

## Maintainer workflow

### 1. Build and validate locally or from CI

```powershell
# After ARM64 Release build output exists:
./scripts/Test-Arm64DriverPackage.ps1 `
  -PackagePath "Virtual Display Driver (HDR)\ARM64\Release\MttVDD" `
  -Policy CI

./scripts/New-AttestationCab.ps1 `
  -InputDirectory "Virtual Display Driver (HDR)\ARM64\Release\MttVDD" `
  -OutputDirectory "artifacts\VDD\ARM64"
```

Expected payload inside the CAB subfolder:

- `MttVDD.inf`
- `MttVDD.dll` (PE machine `0xAA64`)
- `MttVDD.pdb`
- `MttVDD.cat` (company catalog for verification; Microsoft replaces it)

Requirements from Microsoft attestation signing:

- Driver files must live in a **single subfolder** inside the CAB (never at CAB root).
- Subfolder name must be **fewer than 40 characters** and use no UNC paths during packaging.
- See [Attestation sign Windows drivers](https://learn.microsoft.com/windows-hardware/drivers/dashboard/code-signing-attestation).

### 2. EV-sign the CAB offline

Use the organization EV certificate and SignTool (SHA-256):

```cmd
SignTool sign /s MY /n "Company Name" /fd sha256 /tr http://timestamp.digicert.com /td sha256 /v MttVDD-ARM64-Attestation.cab
```

Do **not** store EV credentials in GitHub Actions.

### 3. Submit attestation preview in Partner Center

1. Open the [Partner Center hardware dashboard](https://partner.microsoft.com/dashboard/hardware/Search).
2. Choose **Submit new hardware**.
3. Upload the **EV-signed CAB**.
4. Leave test-signing options **unchecked** for the production-preview path on HVCI systems.
5. Request the Windows Desktop signatures needed for ARM64 user-mode driver attestation.
6. Download Microsoft’s returned package when processing completes.

Reference: [Driver signing options and best practices — attestation for testing scenarios](https://learn.microsoft.com/windows-hardware/drivers/dashboard/driver-signing-offerings#attestation-signed-drivers-for-testing-scenarios).

### 4. Validate the returned package (Release policy)

```powershell
./scripts/Test-Arm64DriverPackage.ps1 `
  -PackagePath ".\downloads\MttVDD-ARM64-MicrosoftSigned.cab" `
  -Policy Release
```

Release policy requires a catalog subject containing **Microsoft Windows Hardware Compatibility Publisher** and rejects SignPath-only catalogs.

Optional Surface preflight:

```powershell
./scripts/Invoke-Arm64AcceptanceTest.ps1 `
  -PackagePath ".\downloads\MttVDD-ARM64-MicrosoftSigned.cab" `
  -Mode Preflight
```

### 5. Publish an ARM64 preview release

1. Extract the Microsoft-signed package into a clearly named release asset, for example `VirtualDisplayDriver-ARM64.Driver.Only.zip`.
2. Mark the release as **ARM64 preview / attestation-signed** in release notes.
3. Link issues #465 and #483 and note that WHCP certification is the follow-up for broad retail/Windows Update distribution.

### 6. Graduate to WHCP (later)

Reuse the same validated ARM64 payload for HLK/WHCP submission when an ARM64 HLK lab is available. Attestation preview unblocks HVCI-enabled test machines; WHCP remains the supported public-release path.

## Acceptance criteria on Windows on ARM

Run with Secure Boot and Memory Integrity **enabled** (no test-signing boot configuration or trust-store workarounds):

1. **Static gate** — `Test-Arm64DriverPackage.ps1 -Policy Release` passes.
2. **Install gate** — `Invoke-Arm64AcceptanceTest.ps1 -Mode Install` installs `Root\MttVDD` with device status OK and no Code Integrity rejection.
3. **Display gate** — one free-tier virtual display attaches to extended topology (DisplayConfig / `EnumDisplayMonitors` / DXGI).
4. **RealWarp gate** — RealWarp 0.38.0 (x64 emulation) detects MttVDD, connects to `MTTVirtualDisplayPipe`, captures desktop, and renders on XREAL One / One Pro.

If signing succeeds but topology fails, treat that as issue #483 (IddCx attachment) rather than changing signing policy.

## Evidence captured on Surface (SignPath baseline)

The current public ARM64 package (`25.7.23`) fails Release validation because the catalog chains to **SignPath Foundation / GlobalSign**, not Microsoft WHCP. On HVCI-enabled systems this surfaces as Driver Store staging error **`0x800B0109`** (*A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider*).

That failure occurs **before** UMDF/IddCx load; replacing RealWarp’s bundled x64 Parsec driver with a **Microsoft-signed ARM64 MttVDD** package is the required production path.
