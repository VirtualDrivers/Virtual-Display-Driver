// Wave Shader - Animated wave with bottom bar effect
// Vertex and Pixel Shaders for Virtual Display Driver

cbuffer PerFrameBuffer : register(b0)
{
    float4 resolution;
    float time;
    float amplitude;
};

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

// Pixel shader - White bar at bottom + animated wave
float4 PSMain(PS_INPUT input) : SV_Target
{
    float2 uv = input.texcoord;

    // Get screen dimensions for pixel-perfect calculations
    float screenHeight = resolution.y;
    float screenWidth = resolution.x;

    // Convert UV coordinates to pixel coordinates
    float2 pixelPos = uv * resolution.xy;

    // White horizontal bar at the bottom (3 pixels tall)
    float barHeight = 3.0;
    float barStart = screenHeight - barHeight;

    float4 finalColor = float4(0.0, 0.0, 0.0, 1.0); // Black background

    // Draw bottom bar
    if (pixelPos.y >= barStart)
    {
        finalColor = float4(1.0, 1.0, 1.0, 1.0); // White
    }
    else
    {
        // Animated wave that travels side-to-side
        // Wave position based on time and UV coordinates
        float waveFrequency = 0.05; // How many waves across screen
        float waveSpeed = 2.0; // How fast wave moves

        // Calculate wave position
        float wavePos = sin(uv.x * 6.28318 * waveFrequency + time * waveSpeed);

        // Wave center line (middle of screen)
        float waveCenter = 0.5;

        // Wave thickness (controls how thick wave line is)
        float waveThickness = 0.02;

        // Distance from wave center
        float distanceFromWave = abs(uv.y - waveCenter - wavePos * amplitude * 0.1);

        // If pixel is within wave thickness, make it white
        if (distanceFromWave < waveThickness)
        {
            finalColor = float4(1.0, 1.0, 1.0, 1.0); // White wave
        }
    }

    return finalColor;
};
