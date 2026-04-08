// Passthrough Shader - samples the source frame unchanged

cbuffer PerFrameBuffer : register(b0)
{
    float4 resolution;
    float time;
    float param0;
};

Texture2D InputTexture : register(t0);
SamplerState InputSampler : register(s0);

struct PS_INPUT
{
    float4 position : SV_POSITION;
    float2 texcoord : TEXCOORD0;
};

float4 PSMain(PS_INPUT input) : SV_Target
{
    return InputTexture.Sample(InputSampler, input.texcoord);
}
