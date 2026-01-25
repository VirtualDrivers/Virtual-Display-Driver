#pragma once

#define NOMINMAX
#include <windows.h>
#include <bugcodes.h>
#include <wudfwdm.h>
#include <wdf.h>
#include <IddCx.h>

#include <dxgi1_5.h>
#include <d3d11_2.h>
#include <d3dcompiler.h>
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
            
// #---             // --- SHADER SUPPORT MEMBERS ---
// #---             // Vertex and pixel shaders for frame processing
// #---             // These are created from loaded shader bytecode during Init()
// #---             // Microsoft::WRL::ComPtr<ID3D11VertexShader> VertexShader;
// #---             // Microsoft::WRL::ComPtr<ID3D11PixelShader> PixelShader;
// #---             // Optional: Constant buffers for shader parameters
// #---             // Microsoft::WRL::ComPtr<ID3D11Buffer> PerFrameBuffer;
// #---             // --- END SHADER SUPPORT MEMBERS ---
            
// #---             // --- DXGI SHARED TEXTURE SUPPORT ---
// #---             // Shared texture for cross-GPU shader rendering
// #---             Microsoft::WRL::ComPtr<ID3D11Texture2D> SharedTexture;
// #---             Microsoft::WRL::ComPtr<IDXGIKeyedMutex> SharedKeyedMutex;
// #---             // Render target view for shader output on this device
// #---             Microsoft::WRL::ComPtr<ID3D11RenderTargetView> RenderTargetView;
// #---             // Shader resource view for sampling shared texture
// #---             Microsoft::WRL::ComPtr<ID3D11ShaderResourceView> ShaderResourceView;
// #---             // Vertex and pixel shaders created from bytecode
// #---             Microsoft::WRL::ComPtr<ID3D11VertexShader> VertexShader;
// #---             Microsoft::WRL::ComPtr<ID3D11PixelShader> PixelShader;
// #---             // Input layout for fullscreen quad
// #---             Microsoft::WRL::ComPtr<ID3D11InputLayout> InputLayout;
// #---             // Sampler state for texture sampling
// #---             Microsoft::WRL::ComPtr<ID3D11SamplerState> SamplerState;
// #---             // Constant buffer for shader parameters (time, resolution, etc.)
// #---             Microsoft::WRL::ComPtr<ID3D11Buffer> ConstantBuffer;
// #---             // --- END DXGI SHARED TEXTURE SUPPORT ---
            
// #---             // --- SHADER HELPER METHODS ---
// #---             // Initialize shared texture for cross-GPU rendering
// #---             // HRESULT CreateSharedTexture(UINT width, UINT height, DXGI_FORMAT format);
// #---             // Create shader resource view for sampling
// #---             // HRESULT CreateShaderResourceView(ID3D11Texture2D* texture);
// #---             // Create render target view for output
// #---             // HRESULT CreateRenderTargetView(ID3D11Texture2D* texture);
// #---             // Create vertex and pixel shaders from bytecode
// #---             // HRESULT CreateShaders(const BYTE* vsBytecode, SIZE_T vsSize, const BYTE* psBytecode, SIZE_T psSize);
// #---             // Create input layout for fullscreen quad
// #---             // HRESULT CreateInputLayout();
// #---             // Create sampler state for texture sampling
// #---             // HRESULT CreateSamplerState();
// #---             // Create constant buffer for shader parameters
// #---             // HRESULT CreateConstantBuffer();
// #---             // Update constant buffer with time, resolution, etc.
// #---             // HRESULT UpdateConstantBuffer(float time, float width, float height, float amplitude);
// #---             // Apply shader to shared texture
// #---             // HRESULT ApplyShader(float time);
// #---             // --- END SHADER HELPER METHODS ---

        /// <summary>
        /// Manages a thread that consumes buffers from an indirect display swap-chain object.
        /// </summary>
        class SwapChainProcessor
        {
        public:
            SwapChainProcessor(IDDCX_SWAPCHAIN hSwapChain, std::shared_ptr<Direct3DDevice> Device, HANDLE NewFrameEvent);
            ~SwapChainProcessor();

        private:
            static DWORD CALLBACK RunThread(LPVOID Argument);

            void Run();
            void RunCore();

        public:
            IDDCX_SWAPCHAIN m_hSwapChain;
            std::shared_ptr<Direct3DDevice> m_Device;
            HANDLE m_hAvailableBufferEvent;
            Microsoft::WRL::Wrappers::Thread m_hThread;
            Microsoft::WRL::Wrappers::Event m_hTerminateEvent;
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

            void AssignSwapChain(IDDCX_MONITOR& Monitor, IDDCX_SWAPCHAIN SwapChain, LUID RenderAdapter, HANDLE NewFrameEvent);
            void UnassignSwapChain();

        protected:

            WDFDEVICE m_WdfDevice;
            IDDCX_ADAPTER m_Adapter;
            IDDCX_MONITOR m_Monitor;
            IDDCX_MONITOR m_Monitor2;

            std::unique_ptr<SwapChainProcessor> m_ProcessingThread;

        public:
            static const DISPLAYCONFIG_VIDEO_SIGNAL_INFO s_KnownMonitorModes[];
            static std::vector<BYTE> s_KnownMonitorEdid;

        private:
            static std::map<LUID, std::shared_ptr<Direct3DDevice>, LuidComparator> s_DeviceCache;
            static std::mutex s_DeviceCacheMutex;
            static std::shared_ptr<Direct3DDevice> GetOrCreateDevice(LUID RenderAdapter);
            static void CleanupExpiredDevices();
        };
    }
}