# Virtual Display Driver Shaders

This directory contains HLSL shaders for the Virtual Display Driver.

## Shaders

### Vortex Shader (`vortex_shader.hlsl`)
- **Effect**: Split-screen with blue and red colored halves
- **Left half**: Blue with 40% opacity
- **Right half**: Red with 40% opacity
- **Header**: `vortex_shader.h` (compiled bytecode)

### Wave Shader (`wave_shader.hlsl`)
- **Effect**: Animated wave with horizontal bottom bar
- **White bar**: 3 pixels tall at bottom of screen
- **Wave**: Animated sine wave traveling side-to-side
- **Parameters**: Wave amplitude controlled via PerFrameBuffer
- **Header**: `wave_shader.h` (compiled bytecode)

## Compilation

To compile HLSL shaders on Windows using DirectX FX Compiler:

```cmd
:: Vertex shaders
fxc.exe /T vs_5_0 /E VSMain /Fo vortex_vs.cso vortex_shader.hlsl
fxc.exe /T vs_5_0 /E VSMain /Fo wave_vs.cso wave_shader.hlsl

:: Pixel shaders
fxc.exe /T ps_5_0 /E PSMain /Fo vortex_ps.cso vortex_shader.hlsl
fxc.exe /T ps_5_0 /E PSMain /Fo wave_ps.cso wave_shader.hlsl
```

To convert compiled CSO files to hex arrays for headers, use a hex-to-c converter or manually convert the bytecode.

## Usage

Include the shader header in your C++ code:

```cpp
#include "Shaders/vortex_shader.h"  // or "Shaders/wave_shader.h"

// Create shaders
device->CreateVertexShader(VortexShader_VS, VortexShader_VS_size, nullptr, &vs);
device->CreatePixelShader(VortexShader_PS, VortexShader_PS_size, nullptr, &ps);

// Create and update constant buffer
PerFrameBuffer cb;
cb.resolution = DirectX::XMFLOAT4(width, height, 0, 0);
cb.time = currentTime;
cb.padding = 0.0f;  // vortex shader
cb.amplitude = 1.0f; // wave shader
```

## PerFrameBuffer Structure

### Vortex Shader
```cpp
struct PerFrameBuffer
{
    DirectX::XMFLOAT4 resolution;  // Screen resolution (width, height, 0, 0)
    float time;                    // Time elapsed in seconds
    float padding;                 // Padding for alignment
};
```

### Wave Shader
```cpp
struct PerFrameBuffer
{
    DirectX::XMFLOAT4 resolution;  // Screen resolution (width, height, 0, 0)
    float time;                    // Time elapsed in seconds
    float amplitude;               // Wave amplitude control
};
```

## Notes

- Shaders use DirectX 11 Shader Model 5.0 (vs_5_0 / ps_5_0)
- Constant buffer is bound to register b0
- Fullscreen quad geometry is expected as input
- PerFrameBuffer must be 16-byte aligned for DirectX constant buffer requirements
