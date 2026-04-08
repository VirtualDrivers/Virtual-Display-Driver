// Vortex Shader - Blue/Red split screen effect
// Vertex and Pixel Shaders for Virtual Display Driver

cbuffer PerFrameBuffer : register(b0)
{
    float4 resolution;
    float time;
    float padding;
};

Texture2D InputTexture : register(t0);
SamplerState InputSampler : register(s0);

struct VS_INPUT
{
    float4 position : POSITION;
    float2 texcoord : TEXCOORD0;
};

struct PS_INPUT
{
    float4 position : SV_POSITION;
    float2 texcoord : TEXCOORD0;
};

// Standard fullscreen quad vertex shader
PS_INPUT VSMain(VS_INPUT input)
{
    PS_INPUT output;
    output.position = input.position;
    output.texcoord = input.texcoord;
    return output;
};

// Pixel shader - Blue on left half, Red on right half with 40% opacity
float4 PSMain(PS_INPUT input) : SV_Target
{
    float2 uv = input.texcoord;
    float4 sceneColor = InputTexture.Sample(InputSampler, uv);

    // Split screen at center (0.5)
    float4 overlayColor;
    if (uv.x < 0.5)
    {
        // Left half - Blue with 40% opacity
        overlayColor = float4(0.0, 0.0, 1.0, 0.4);
    }
    else
    {
        // Right half - Red with 40% opacity
        overlayColor = float4(1.0, 0.0, 0.0, 0.4);
    }

    return float4(lerp(sceneColor.rgb, overlayColor.rgb, overlayColor.a), 1.0);
};
