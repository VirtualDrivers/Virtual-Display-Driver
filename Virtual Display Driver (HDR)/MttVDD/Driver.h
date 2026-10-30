#pragma once

#define NOMINMAX
#include <windows.h>
#include <bugcodes.h>
#include <wudfwdm.h>
#include <wdf.h>
#include <IddCx.h>

#include <dxgi1_5.h>
#include <d3d11_2.h>
#include <avrt.h>
#include <wrl.h>

#include <memory>
#include <vector>
#include <map>
#include <mutex>
#include <string>
#include <sstream>

#include "Trace.h"

// Utility function declarations
std::vector<std::string> split(std::string& input, char delimiter);
std::string WStringToString(const std::wstring& wstr);

// Phase 5: Final Integration function declarations
NTSTATUS ValidateEdidIntegration();
NTSTATUS PerformanceMonitor();
NTSTATUS CreateFallbackConfiguration();
NTSTATUS ValidateAndSanitizeConfiguration();
NTSTATUS RunComprehensiveDiagnostics();
NTSTATUS InitializePhase5Integration();

namespace Microsoft
{
    namespace WRL
    {
        namespace Wrappers
        {
            // Adds a wrapper for thread handles to the existing set of WRL handle wrapper classes
            typedef HandleT<HandleTraits::HANDLENullTraits> Thread;
        }
    }
}

namespace Microsoft
{
    namespace IndirectDisp
    {
        /// <summary>
        /// Manages the creation and lifetime of a Direct3D render device.
        /// </summary>
        struct Direct3DDevice
        {
            Direct3DDevice(LUID AdapterLuid);
            Direct3DDevice();
            HRESULT Init();

            LUID AdapterLuid;
            Microsoft::WRL::ComPtr<IDXGIFactory5> DxgiFactory;
            Microsoft::WRL::ComPtr<IDXGIAdapter1> Adapter;
            Microsoft::WRL::ComPtr<ID3D11Device> Device;
            Microsoft::WRL::ComPtr<ID3D11DeviceContext> DeviceContext;
        };

        /// <summary>
        /// Manages a thread that consumes buffers from an indirect display swap-chain object.
        /// The Direct3D device is obtained on that thread, not in the IddCx DDI callback, because IddCx reports a
        /// driver failure and terminates the host process if AssignSwapChain/UnassignSwapChain exceed its watchdog
        /// timeout (5 s by default).
        /// </summary>
        class SwapChainProcessor
        {
        public:
            SwapChainProcessor(IDDCX_SWAPCHAIN hSwapChain, LUID RenderAdapter, HANDLE NewFrameEvent);
            ~SwapChainProcessor();

            // Signals the processing thread to stop without waiting for it. The thread keeps ownership of the
            // swap-chain and deletes it when it exits.
            void RequestStop();
            // For EvtIddCxMonitorUnassignSwapChain: hands the swap-chain back to IddCx (which deletes it after the
            // callback) and returns once the thread no longer uses it, waiting at most LoopExitBudgetMs.
            void StopForUnassign();
            // True once the processing thread has exited (or was never started).
            bool HasExited() const;

        private:
            static DWORD CALLBACK RunThread(LPVOID Argument);

            void Run();
            void RunCore();
            // Deletes the swap-chain unless it was handed back to IddCx, and signals loop exit and release.
            void ReleaseSwapChain();

            // StopForUnassign() waits for at most one of these; both are well below the IddCx DDI watchdog
            // (5000 ms by default).
            static constexpr DWORD LoopExitBudgetMs = 3000;
            static constexpr DWORD ReleaseBudgetMs = 3000;

        public:
            IDDCX_SWAPCHAIN m_hSwapChain;
            LUID m_RenderAdapter;
            std::shared_ptr<Direct3DDevice> m_Device;
            HANDLE m_hAvailableBufferEvent;
            Microsoft::WRL::Wrappers::Thread m_hThread;
            Microsoft::WRL::Wrappers::Event m_hTerminateEvent;

        private:
            std::mutex m_StateLock;
            bool m_Revoked = false;        // swap-chain handed back to IddCx by StopForUnassign()
            bool m_InLoop = false;         // thread may be calling IddCx swap-chain functions
            bool m_SelfReleasing = false;  // thread decided to delete the swap-chain itself
            Microsoft::WRL::Wrappers::Event m_hLoopExitedEvent;
            Microsoft::WRL::Wrappers::Event m_hReleasedEvent;
        };

        /// <summary>
        /// Custom comparator for LUID to be used in std::map
        /// </summary>
        struct LuidComparator
        {
            bool operator()(const LUID& a, const LUID& b) const
            {
                if (a.HighPart != b.HighPart)
                    return a.HighPart < b.HighPart;
                return a.LowPart < b.LowPart;
            }
        };

        /// <summary>
        /// Provides a sample implementation of an indirect display driver.
        /// </summary>
        class IndirectDeviceContext
        {
        public:
            IndirectDeviceContext(_In_ WDFDEVICE WdfDevice);
            virtual ~IndirectDeviceContext();

            void InitAdapter();
            void FinishInit();

            void CreateMonitor(unsigned int index);

            void AssignSwapChain(IDDCX_MONITOR Monitor, IDDCX_SWAPCHAIN SwapChain, LUID RenderAdapter, HANDLE NewFrameEvent);
            void UnassignSwapChain(IDDCX_MONITOR Monitor);

        protected:
            // Keeps a stopped processor until its thread has exited, without joining it.
            void RetireProcessor(std::unique_ptr<SwapChainProcessor> Processor);
            // Destroys retired processors whose threads have exited. Caller holds m_ProcessingThreadsMutex.
            void ReapRetiredProcessors();

            WDFDEVICE m_WdfDevice;
            IDDCX_ADAPTER m_Adapter;
            IDDCX_MONITOR m_Monitor;
            IDDCX_MONITOR m_Monitor2;

            std::map<IDDCX_MONITOR, std::unique_ptr<SwapChainProcessor>> m_ProcessingThreads;
            // Stopped processors whose threads may still be running; reaped once they have exited, joined on teardown.
            std::vector<std::unique_ptr<SwapChainProcessor>> m_RetiredProcessors;
            std::mutex m_ProcessingThreadsMutex;

        public:
            static const DISPLAYCONFIG_VIDEO_SIGNAL_INFO s_KnownMonitorModes[];
            static std::vector<BYTE> s_KnownMonitorEdid;

        private:
            // The processing thread obtains its render device from the cache (see SwapChainProcessor::Run()).
            friend class SwapChainProcessor;

            static std::map<LUID, std::shared_ptr<Direct3DDevice>, LuidComparator> s_DeviceCache;
            static std::mutex s_DeviceCacheMutex;
            static std::shared_ptr<Direct3DDevice> GetOrCreateDevice(LUID RenderAdapter);
            static void CleanupExpiredDevices();
        };
    }
}
