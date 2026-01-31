#pragma once

// --- ADC ---
#define ADC_PIN             36

// ADC mode selection
// NOTE: I2S ADC mode has issues with attenuation - readings are incorrect
// Stick with analogRead for now (10kHz sample rate, adequate for 60Hz-2kHz signals)
#define USE_I2S_ADC         0  // 0=analogRead polling, 1=I2S DMA

// I2S DMA configuration (when USE_I2S_ADC=1)
// NOTE: ESP32 I2S ADC mode has clock divider limitations.
// Achievable sample rates with APB clock (80MHz):
//   Requested  | Actual
//   -----------|---------
//   50000 Hz   | ~96 kHz  (high-speed, requires binary protocol to avoid heap exhaustion)
//   25000 Hz   | ~48 kHz
//   20000 Hz   | ~39 kHz
//   12000 Hz   | ~24 kHz  (recommended for HVAC/60Hz - excellent waveform fidelity)
// Use actualSampleRate from JSON for true rate
#define I2S_SAMPLE_RATE_HZ  12000  // Request 12kHz -> Actual ~24kHz
#define I2S_DMA_BUF_COUNT   4      // Number of DMA buffers
#define I2S_DMA_BUF_LEN     512    // Samples per DMA buffer

// Sample rate - depends on mode
#if USE_I2S_ADC
#define SAMPLE_RATE_HZ      I2S_SAMPLE_RATE_HZ
#else
#define SAMPLE_RATE_HZ      12000  // Realistic target with analogRead() polling (actual: ~11.6kHz)
#endif

// Samples per frame - increase for high sample rates to reduce frame rate
// At 96 kHz: 2000 samples = 48 fps (too fast, causes heap exhaustion with JSON)
// At 24 kHz: 1000 samples = 24 fps (good balance for HVAC/60Hz)
// At 24 kHz: 2000 samples = 12 fps (smoother but slower updates)
#define SAMPLES_PER_FRAME   1000

// --- WiFi Mode ---
// Set to true for Station mode (connect to your router)
// Set to false for AP mode (ESP32 creates its own network)
#define WIFI_STA_MODE       true

// Station mode: your home WiFi credentials
#define WIFI_STA_SSID       "ssid"
#define WIFI_STA_PASSWORD   "pwd"

// AP mode: ESP32 creates this network
#define WIFI_AP_SSID        "ProbeMonkey"
#define WIFI_AP_PASSWORD    "monkey"
#define WIFI_AP_CHANNEL     1

// mDNS hostname (used in STA mode: http://probemonkey.local)
#define MDNS_HOSTNAME       "probemonkey"

// --- WebSocket ---
#define WS_PORT             81
#define WS_MAX_CLIENTS      2
#define WS_PATH             "/ws"

// --- LED ---
#define LED_PIN             2

// --- JSON ---
// JSON buffer size must fit: {"sampleRate":xxxxx,"samples":[...]}
// With 1000 samples: ~5KB needed (1000 samples × ~5 chars each)
// With 2000 samples: ~10KB needed (2000 samples × ~5 chars each)
#define JSON_BUFFER_SIZE    8192   // 8 KB (reduced to match smaller frame size)

// --- FreeRTOS Tasks ---
#define SAMPLING_TASK_STACK     4096
#define SAMPLING_TASK_PRIORITY  5
#define SAMPLING_TASK_CORE      1

#define WS_SEND_TASK_STACK      12288  // 12 KB (increased for larger JSON frames)
#define WS_SEND_TASK_PRIORITY   3
#define WS_SEND_TASK_CORE       0

// --- Test Signal Output ---
#define TEST_SIGNAL_PIN             25      // GPIO25 (also DAC1 for sine wave)
#define TEST_SIGNAL_DEFAULT_FREQ    1000    // 1kHz default
#define TEST_SIGNAL_LEDC_CHANNEL    2       // LEDC channel for square wave
#define TEST_SIGNAL_LEDC_RESOLUTION 8       // 8-bit PWM resolution

// --- ADC Calibration (DAC sweep) ---
#define CALIBRATE_STEPS         256
#define CALIBRATE_SAMPLES_PER   32
#define CALIBRATE_SETTLE_US     1000
#define CALIBRATE_TASK_STACK    4096

// --- Debug ---
#define DEBUG_INTERVAL_MS   5000
#define WS_CLEANUP_INTERVAL_MS  1000
