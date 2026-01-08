#pragma once

#include <wrl/client.h>
#include <dxgi1_6.h>
#include <setupapi.h>
#include <devguid.h>
#include <string>
#include <vector>
#include <optional>
#include <algorithm>
#include <fstream>
#include <cwchar>
#include <iomanip>
#include <cctype> 
#include <locale> 

#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "setupapi.lib")

using namespace std;
using namespace Microsoft::WRL;



// DEVPKEY_Device_Luid: {60b193cb-5276-4d0f-96fc-f173ab17af69}, 2
static const DEVPROPKEY DEVPKEY_Device_Luid_Custom = {
    { 0x60b193cb, 0x5276, 0x4d0f, { 0x96, 0xfc, 0xf1, 0x73, 0xab, 0xad, 0x3e, 0xc6 } },
    2
};

struct GPUInfo {
    wstring name;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC desc;
};

class GpuMapper {
public:
    static void Log(const wstring& msg) {
        
        wofstream logFile("gpu_debug.log", ios::app);
        if (logFile.is_open()) {
            logFile << msg << endl;
        }
    }

public: 
    static bool ContainsCaseInsensitive(const wstring& source, const wstring& substring) {
        if (substring.empty()) return true;
        auto it = search(
            source.begin(), source.end(),
            substring.begin(), substring.end(),
            [](wchar_t c1, wchar_t c2) { return towlower(c1) == towlower(c2); }
        );
        return it != source.end();
    }

    static vector<GPUInfo> getAvailableGPUs() {
        vector<GPUInfo> gpus;
        ComPtr<IDXGIFactory1> factory;
        if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return gpus;

        for (UINT i = 0;; i++) {
            ComPtr<IDXGIAdapter> adapter;
            if (FAILED(factory->EnumAdapters(i, &adapter))) break;
            DXGI_ADAPTER_DESC desc;
            adapter->GetDesc(&desc);
            gpus.push_back({ desc.Description, adapter, desc });
        }
        return gpus;
    }

    static std::optional<LUID> resolveLuidFromBus(uint32_t targetBusIndex, const wstring& nameHint = L"") {
        Log(L"--- Starting Bus Resolution ---");
        Log(L"Target Bus: " + to_wstring(targetBusIndex));
        Log(L"Name Hint: " + nameHint);

        HDEVINFO devInfo = SetupDiGetClassDevsW(&GUID_DEVCLASS_DISPLAY, nullptr, nullptr, DIGCF_PRESENT);
        if (devInfo == INVALID_HANDLE_VALUE) {
            Log(L"Error: Failed to get device list.");
            return std::nullopt;
        }

        SP_DEVINFO_DATA devData = {};
        devData.cbSize = sizeof(devData);
        std::optional<LUID> result = std::nullopt;

        for (DWORD i = 0; SetupDiEnumDeviceInfo(devInfo, i, &devData); ++i) {
            
            WCHAR location[256]; // old crap
            location[0] = L'\0'; // old crap
            uint32_t currentBus = -1;
            if (!SetupDiGetDeviceRegistryPropertyW(devInfo, &devData, SPDRP_BUSNUMBER,
                nullptr, (PBYTE)&currentBus, sizeof(currentBus), nullptr)) {
                 continue;
            }

            WCHAR friendlyName[256];
            SetupDiGetDeviceRegistryPropertyW(devInfo, &devData, SPDRP_DEVICEDESC, 
                nullptr, (PBYTE)friendlyName, sizeof(friendlyName), nullptr);

            wstring locStr = location;
            
            wstring logMsg = L"Found: [" + wstring(friendlyName) + L"] at [" + std::to_wstring(currentBus) + L"]";
            Log(logMsg);

            size_t pos = locStr.find(L"PCI bus "); // old crap
            {
    
                if (currentBus == targetBusIndex) {
                    Log(L"-> BUS MATCHED!");

                    if (!nameHint.empty()) {
                        if (!ContainsCaseInsensitive(friendlyName, nameHint) && 
                            !ContainsCaseInsensitive(nameHint, friendlyName)) {
                            Log(L"-> Name mismatch, ignoring (Safety check).");
                            continue; 
                        }
                    }

                    LUID deviceLuid = {};
                    DEVPROPTYPE propType;
                    ULONG propSize = 0;

                    if (SetupDiGetDevicePropertyW(devInfo, &devData, &DEVPKEY_Device_Luid_Custom, 
                        &propType, (PBYTE)&deviceLuid, sizeof(deviceLuid), &propSize, 0)) {
                        
                        Log(L"-> LUID Retrieved successfully.");
                        result = deviceLuid;
                        break; 
                    } else {
                        Log(L"-> Failed to retrieve LUID property.");
                    }
                }
            }
        }

        SetupDiDestroyDeviceInfoList(devInfo);
        
        if (!result.has_value()) Log(L"Result: FAILED to find matching LUID.");
        else Log(L"Result: SUCCESS.");
        
        return result;
    }
};

class AdapterOption {
public:
    bool hasTargetAdapter{};
    LUID adapterLuid{};
    wstring target_name{};

    wstring selectBestGPU() {
        auto gpus = GpuMapper::getAvailableGPUs();
        if (gpus.empty()) return L"";
        sort(gpus.begin(), gpus.end(), [](const GPUInfo& a, const GPUInfo& b) {
            return a.desc.DedicatedVideoMemory > b.desc.DedicatedVideoMemory;
        });
        return gpus.front().name;
    }

    void load(const wchar_t* path) {
        ifstream ifs{ path };
        if (!ifs.is_open()) {
            GpuMapper::Log(L"WARN: Configuration file not found. Falling back to Best GPU.");
            setBestAvailableAdapter();
            target_name = L""; 
            return;
        } 
        
        string line;
        getline(ifs, line);
        target_name.assign(line.begin(), line.end());


        if (target_name.empty()) {
            GpuMapper::Log(L"WARN: Configuration file was empty. Falling back to Best GPU.");
            setBestAvailableAdapter();
            return;
        }

        findAndSetAdapter(target_name);
    }

    void xmlprovide(const wstring& xtarg) {
        target_name = xtarg;

        wstring lowerTarget = target_name;
        transform(lowerTarget.begin(), lowerTarget.end(), lowerTarget.begin(), ::towlower);
        
        if (lowerTarget == L"default") { 
            setBestAvailableAdapter();
            return; 
        }
        
        findAndSetAdapter(target_name);
    }

    // Replace IDDCX_ADAPTER with a dummy type if IDD headers aren't available
    void apply(const IDDCX_ADAPTER& adapter) {
        if (hasTargetAdapter && IDD_IS_FUNCTION_AVAILABLE(IddCxAdapterSetRenderAdapter)) {
            IDARG_IN_ADAPTERSETRENDERADAPTER arg{};
            arg.PreferredRenderAdapter = adapterLuid;
            IddCxAdapterSetRenderAdapter(adapter, &arg);
        }
    }

private:
    bool setBestAvailableAdapter() {
        auto gpus = GpuMapper::getAvailableGPUs();
        if (gpus.empty()) {
            GpuMapper::Log(L"ERROR: No available GPUs found for best GPU selection.");
            hasTargetAdapter = false;
            return false;
        }

        sort(gpus.begin(), gpus.end(), [](const GPUInfo& a, const GPUInfo& b) {
            return a.desc.DedicatedVideoMemory > b.desc.DedicatedVideoMemory;
        });
        
        adapterLuid = gpus.front().desc.AdapterLuid;
        hasTargetAdapter = true;
        GpuMapper::Log(L"INFO: Falling back/Defaulting to Best GPU: " + gpus.front().name);
        return true;
    }


    bool findAndSetAdapter(const wstring& adapterSpec) {
        size_t comma = adapterSpec.find(L',');
        
        if (comma != wstring::npos) {
            wstring namePart = adapterSpec.substr(0, comma);
            wstring busPart = adapterSpec.substr(comma + 1);
            
            busPart.erase(remove_if(busPart.begin(), busPart.end(), iswspace), busPart.end());

            uint32_t bus = wcstoul(busPart.c_str(), nullptr, 10);
            
            auto luidOpt = GpuMapper::resolveLuidFromBus(bus, namePart);
            if (luidOpt.has_value()) {
                adapterLuid = luidOpt.value();
                hasTargetAdapter = true;
                return true; 
            }
        } 
        
        auto gpus = GpuMapper::getAvailableGPUs();
        wstring searchTarget = (comma == wstring::npos) ? adapterSpec : adapterSpec.substr(0, comma);
        
        for (const auto& gpu : gpus) {
            if (GpuMapper::ContainsCaseInsensitive(gpu.name, searchTarget)) {
                adapterLuid = gpu.desc.AdapterLuid;
                hasTargetAdapter = true;
                return true; 
            }
        }
        
        GpuMapper::Log(L"WARN: Specified adapter '" + adapterSpec + L"' not found by name/bus.");
        return setBestAvailableAdapter();
    }
};