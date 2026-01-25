#pragma once

#include <wrl/client.h>     // For ComPtr
#include <dxgi.h>           // For IDXGIAdapter, IDXGIFactory1
#include <algorithm>        // For sort
#include <setupapi.h>
#include <devguid.h>
#include <devpropdef.h>
#include <devpkey.h>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>
#include <fstream>

using namespace std;
using namespace Microsoft::WRL;

// DEVPKEY_Device_Luid: {60b193cb-5276-4d0f-96fc-f173ab17af69}, 2
// Define it ourselves to avoid SDK/WDK header differences where DEVPKEY_Device_Luid may not be declared.
static const DEVPROPKEY DEVPKEY_Device_Luid_Custom = {
    { 0x60b193cb, 0x5276, 0x4d0f, { 0x96, 0xfc, 0xf1, 0x73, 0xab, 0xad, 0x3e, 0xc6 } },
    2
};

// Structure to vector gpus
struct GPUInfo {
    wstring name;                // GPU name
    ComPtr<IDXGIAdapter> adapter;// COM pointer to the adapter
    DXGI_ADAPTER_DESC desc;      // Adapter description
};

// Sort function for GPUs by dedicated video memory
bool CompareGPUs(const GPUInfo& a, const GPUInfo& b) {
    return a.desc.DedicatedVideoMemory > b.desc.DedicatedVideoMemory;
}

// Get a enumerate list of available GPUs
vector<GPUInfo> getAvailableGPUs() {
    vector<GPUInfo> gpus; // Vector to hold all GPU's information

    ComPtr<IDXGIFactory1> factory;
    if (!SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
        return gpus;
    }

    // Enumerate all adapters (GPUs)
    for (UINT i = 0;; i++) {
        ComPtr<IDXGIAdapter> adapter;
        if (!SUCCEEDED(factory->EnumAdapters(i, &adapter))) {
            break;
        }

        DXGI_ADAPTER_DESC desc;

        if (!SUCCEEDED(adapter->GetDesc(&desc))) {
            continue;
        }

        // Add the adapter information to the list
        GPUInfo info{ desc.Description, adapter, desc };
        gpus.push_back(info);
    }

    return gpus;
}

// #--- // Find the integrated GPU (iGPU) from available adapters
// #--- // Returns optional LUID if iGPU is found, nullopt otherwise
// #--- inline std::optional<LUID> findiGPU() {
// #---     auto gpus = getAvailableGPUs();
// #---     if (gpus.empty()) {
// #---         return std::nullopt;
// #---     }
// #--- 
// #---     // iGPU detection criteria:
// #---     // 1. Not a software adapter (has dedicated video memory > 0)
// #---     // 2. Low dedicated video memory (typically < 512MB for integrated)
// #---     // 3. Usually Intel HD/UHD graphics (Vendor ID 0x8086) or AMD APU (Vendor ID 0x1002)
// #---     // 4. Often the GPU with least dedicated memory (excluding software adapters)
// #--- 
// #---     const UINT64 iGPUMemoryThreshold = 512ULL * 1024ULL * 1024ULL; // 512MB threshold
// #---     const UINT intelVendorId = 0x8086;  // Intel
// #---     const UINT amdVendorId = 0x1002;    // AMD (for APUs)
// #--- 
// #---     std::optional<LUID> iGPULuid = std::nullopt;
// #---     UINT64 minDedicatedMemory = UINT64_MAX;
// #---     const GPUInfo* candidateGPU = nullptr;
// #--- 
// #---     // First pass: Look for Intel or AMD integrated graphics with low memory
// #---     for (const auto& gpu : gpus) {
// #---         const auto& desc = gpu.desc;
// #--- 
// #---         // Skip software adapters (zero dedicated memory)
// #---         if (desc.DedicatedVideoMemory == 0) {
// #---             continue;
// #---         }
// #--- 
// #---         // Check for integrated GPU characteristics
// #---         bool isLikelyiGPU = false;
// #--- 
// #---         // Check by vendor ID (Intel or AMD APU)
// #---         if (desc.VendorId == intelVendorId || desc.VendorId == amdVendorId) {
// #---             // Intel HD/UHD graphics typically have specific naming patterns
// #---             wstring name = desc.Description;
// #---             if (name.find(L"Intel") != wstring::npos &&
// #---                 (name.find(L"HD") != wstring::npos || name.find(L"UHD") != wstring::npos)) {
// #---                 isLikelyiGPU = true;
// #---             }
// #---             // Check if it has low dedicated memory (typical for iGPU)
// #---             if (desc.DedicatedVideoMemory < iGPUMemoryThreshold) {
// #---                 isLikelyiGPU = true;
// #---             }
// #---         }
// #--- 
// #---         // Track the GPU with least dedicated memory (usually iGPU)
// #---         if (desc.DedicatedVideoMemory < minDedicatedMemory) {
// #---             minDedicatedMemory = desc.DedicatedVideoMemory;
// #---             // Prioritize Intel/AMD candidates, but also consider low memory GPUs
// #---             if (isLikelyiGPU || desc.DedicatedVideoMemory < iGPUMemoryThreshold) {
// #---                 candidateGPU = &gpu;
// #---             }
// #---         }
// #---     }
// #--- 
// #---     // If we found a candidate with Intel/AMD or low memory, return it
// #---     if (candidateGPU != nullptr) {
// #---         return candidateGPU->desc.AdapterLuid;
// #---     }
// #--- 
// #---     // Fallback: If no clear iGPU found by vendor, return the GPU with least memory
// #---     // (assuming discrete GPUs typically have more memory)
// #---     if (minDedicatedMemory != UINT64_MAX && minDedicatedMemory < iGPUMemoryThreshold) {
// #---         for (const auto& gpu : gpus) {
// #---             if (gpu.desc.DedicatedVideoMemory == minDedicatedMemory) {
// #---                 return gpu.desc.AdapterLuid;
// #---             }
// #---         }
// #---     }
// #--- 
// #---     return std::nullopt;
// #--- }

// #--- // Get iGPU name if available
// #--- inline wstring getiGPUName() {
// #---     auto luidOpt = findiGPU();
// #---     if (!luidOpt.has_value()) {
// #---         return L"";
// #---     }
// #--- 
// #---     auto gpus = getAvailableGPUs();
// #---     for (const auto& gpu : gpus) {
// #---         if (gpu.desc.AdapterLuid.LowPart == luidOpt.value().LowPart &&
// #---             gpu.desc.AdapterLuid.HighPart == luidOpt.value().HighPart) {
// #---             return gpu.name;
// #---         }
// #---     }
// #--- 
// #---     return L"";
// #--- }

// Resolve an adapter LUID from a PCI bus number by enumerating display devices (SetupAPI).
// Returns nullopt if no match is found or if the system doesn't expose the LUID property.
inline std::optional<LUID> ResolveAdapterLuidFromPciBus(uint32_t targetBusIndex) {
    HDEVINFO devInfo = SetupDiGetClassDevsW(&GUID_DEVCLASS_DISPLAY, nullptr, nullptr, DIGCF_PRESENT);
    if (devInfo == INVALID_HANDLE_VALUE) {
        return std::nullopt;
    }

    SP_DEVINFO_DATA devData = {};
    devData.cbSize = sizeof(devData);

    std::optional<LUID> result = std::nullopt;

    for (DWORD i = 0; SetupDiEnumDeviceInfo(devInfo, i, &devData); ++i) {
        DWORD currentBus = 0;
        if (!SetupDiGetDeviceRegistryPropertyW(
                devInfo,
                &devData,
                SPDRP_BUSNUMBER,
                nullptr,
                reinterpret_cast<PBYTE>(&currentBus),
                sizeof(currentBus),
                nullptr)) {
            continue;
        }

        if (static_cast<uint32_t>(currentBus) != targetBusIndex) {
            continue;
        }

        // DEVPKEY_Device_Luid is exposed as a UINT64 on Windows; convert into LUID.
        DEVPROPTYPE propType = 0;
        ULONG propSize = 0;
        ULONGLONG luid64 = 0;

        if (!SetupDiGetDevicePropertyW(
                devInfo,
                &devData,
                &DEVPKEY_Device_Luid_Custom,
                &propType,
                reinterpret_cast<PBYTE>(&luid64),
                sizeof(luid64),
                &propSize,
                0)) {
            continue;
        }

        if (propType != DEVPROP_TYPE_UINT64 || propSize != sizeof(luid64)) {
            continue;
        }

        LUID luid{};
        luid.LowPart = static_cast<DWORD>(luid64 & 0xFFFFFFFFull);
        luid.HighPart = static_cast<LONG>((luid64 >> 32) & 0xFFFFFFFFull);
        result = luid;
        break;
    }

    SetupDiDestroyDeviceInfoList(devInfo);
    return result;
}

class AdapterOption {
public:
    bool hasTargetAdapter{}; // Indicates if a target adapter is selected
    LUID adapterLuid{};      // Adapter's unique identifier (LUID)
    wstring target_name{};   // Target adapter name

// #---     // --- iGPU SUPPORT ---
// #---     bool hasiGPU{};          // Indicates if an iGPU was detected
// #---     LUID iGPULuid{};         // Integrated GPU's unique identifier (LUID)
// #---     wstring iGPU_name{};     // Integrated GPU name
// #---     // --- END iGPU SUPPORT ---

    // Select the best GPU based on dedicated video memory
    wstring selectBestGPU() {
        auto gpus = getAvailableGPUs();
        if (gpus.empty()) {
            return L""; // Error check for headless / vm
        }

        // Sort GPUs by dedicated video memory in descending order
        sort(gpus.begin(), gpus.end(), CompareGPUs);
        auto bestGPU = gpus.front(); // Get the GPU with the most memory

        return bestGPU.name;
    }

    // Load friendlyname from a file OR select the best GPU 
    void load(const wchar_t* path) {
        ifstream ifs{ path };

        if (!ifs.is_open()) {
            target_name = selectBestGPU();
        }
        else {
            string line;
            getline(ifs, line);
            target_name.assign(line.begin(), line.end());
        }

        // Find and set the adapter based on the target name
        if (!findAndSetAdapter(target_name)) {
            // If the adapter is not found, select the best GPU and retry
            target_name = selectBestGPU();
            findAndSetAdapter(target_name);
        }
    }

    // Set the target adapter from a given name and validate it
    void xmlprovide(const wstring& xtarg) {
        target_name = xtarg;
        if (!findAndSetAdapter(target_name)) {
            // If the adapter is not found, select the best GPU and retry
            target_name = selectBestGPU();
            findAndSetAdapter(target_name);
        }
    }

    // Apply the adapter settings to the specified adapter
    void apply(const IDDCX_ADAPTER& adapter) {
        if (hasTargetAdapter && IDD_IS_FUNCTION_AVAILABLE(IddCxAdapterSetRenderAdapter)) {
            IDARG_IN_ADAPTERSETRENDERADAPTER arg{};
            arg.PreferredRenderAdapter = adapterLuid;
            IddCxAdapterSetRenderAdapter(adapter, &arg);
        }
    }

// #---     // --- iGPU DETECTION METHODS ---
// #---     // Detect and select the integrated GPU (iGPU)
// #---     // Returns true if iGPU is found and set, false otherwise
// #---     bool selectiGPU() {
// #---         auto luidOpt = findiGPU();
// #---         if (luidOpt.has_value()) {
// #---             iGPULuid = luidOpt.value();
// #---             iGPU_name = getiGPUName();
// #---             hasiGPU = true;
// #---             return true;
// #---         }
// #---         hasiGPU = false;
// #---         return false;
// #---     }
// #---
// #---     // Get the iGPU LUID if available
// #---     std::optional<LUID> getiGPULuid() const {
// #---         if (hasiGPU) {
// #---             return iGPULuid;
// #---         }
// #---         return std::nullopt;
// #---     }
// #---
// #---     // Check if iGPU is available
// #---     bool hasIntegratedGPU() const {
// #---         return hasiGPU;
// #---     }
// #---
// #---     // Get iGPU name
// #---     wstring getiGPUName() const {
// #---         return iGPU_name;
// #---     }
// #---     // --- END iGPU DETECTION METHODS ---

private:
    // Find and set the adapter by name, optionally using "name,bus" where bus is the PCI bus number.
    bool findAndSetAdapter(const wstring& adapterSpec) {
        // If user provides "name,bus", use bus to resolve LUID (more deterministic on multi-GPU setups).
        const size_t comma = adapterSpec.find(L',');
        if (comma != wstring::npos) {
            const wstring namePart = adapterSpec.substr(0, comma);
            wstring busPart = adapterSpec.substr(comma + 1);
            // Trim whitespace in bus part
            busPart.erase(remove_if(busPart.begin(), busPart.end(), iswspace), busPart.end());

            wchar_t* end = nullptr;
            const unsigned long busUl = wcstoul(busPart.c_str(), &end, 10);
            const bool parsedOk = (end != nullptr) && (*end == L'\0') && (end != busPart.c_str());
            if (parsedOk && busUl <= 0xFFFFFFFFul) {
                if (auto luidOpt = ResolveAdapterLuidFromPciBus(static_cast<uint32_t>(busUl)); luidOpt.has_value()) {
                    adapterLuid = luidOpt.value();
                    hasTargetAdapter = true;
                    return true;
                }
            }

            // Fall through to name matching using the name portion.
            return findAndSetAdapter(namePart);
        }

        const wstring& adapterName = adapterSpec;
        auto gpus = getAvailableGPUs();

        // Iterate through all available GPUs
        for (const auto& gpu : gpus) {
            if (_wcsicmp(gpu.name.c_str(), adapterName.c_str()) == 0) {
                adapterLuid = gpu.desc.AdapterLuid; // Set the adapter LUID
                hasTargetAdapter = true; // Indicate that a target adapter is selected
                return true;
            }
        }

        hasTargetAdapter = false; // Indicate that no target adapter is selected
        return false;
    }
};
