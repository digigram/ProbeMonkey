#include "test_signal.h"
#include "config.h"

#include <driver/dac.h>
#include <driver/rtc_io.h>

static bool enabled = false;
static uint32_t frequency = TEST_SIGNAL_DEFAULT_FREQ;
static bool sineMode = false;

static void startSquare() {
    // Ensure DAC is off before using LEDC on this pin
    dac_cw_generator_disable();
    dac_output_disable(DAC_CHANNEL_1);

    // GPIO25 is an RTC/DAC pin. dac_output_disable() internally calls
    // rtc_gpio_init() which locks the pad to the RTC mux, preventing the
    // regular GPIO matrix (and therefore LEDC) from driving it.
    // Deinit RTC to hand the pin back to the GPIO matrix.
    rtc_gpio_deinit(GPIO_NUM_25);

    ledcSetup(TEST_SIGNAL_LEDC_CHANNEL, frequency, TEST_SIGNAL_LEDC_RESOLUTION);
    ledcAttachPin(TEST_SIGNAL_PIN, TEST_SIGNAL_LEDC_CHANNEL);
    ledcWrite(TEST_SIGNAL_LEDC_CHANNEL, 128); // 50% duty = square wave
}

static void startSine() {
    // Below 130Hz the hardware cosine generator doesn't work reliably;
    // fall back to square wave so we still get a usable test signal.
    if (frequency < 130) {
        Serial.printf("[TestSig] %u Hz too low for sine, using square\n", frequency);
        startSquare();
        return;
    }

    // Ensure LEDC is off before using DAC on this pin
    ledcDetachPin(TEST_SIGNAL_PIN);
    ledcWrite(TEST_SIGNAL_LEDC_CHANNEL, 0);

    // Fully stop the DAC before reconfiguring — without this, changing
    // frequency while the cosine generator is running can lock the peripheral.
    dac_cw_generator_disable();
    dac_output_disable(DAC_CHANNEL_1);

    // ESP32 DAC cosine wave generator (hardware, zero CPU)
    uint32_t clampedFreq = frequency;
    if (clampedFreq > 55000) clampedFreq = 55000;

    dac_cw_config_t config = {};
    config.en_ch = DAC_CHANNEL_1;       // GPIO25
    config.scale = DAC_CW_SCALE_1;      // Full amplitude (0-3.3V)
    config.phase = DAC_CW_PHASE_0;
    config.freq  = clampedFreq;
    config.offset = 0;

    dac_cw_generator_config(&config);
    dac_cw_generator_enable();
    dac_output_enable(DAC_CHANNEL_1);
}

static void stopSignal() {
    // Stop both peripherals
    ledcDetachPin(TEST_SIGNAL_PIN);
    ledcWrite(TEST_SIGNAL_LEDC_CHANNEL, 0);
    dac_cw_generator_disable();
    dac_output_disable(DAC_CHANNEL_1);

    // Float the pin
    pinMode(TEST_SIGNAL_PIN, INPUT);
}

void testSignalInit() {
    Serial.printf("[TestSig] Ready on GPIO%d (disabled, default %u Hz square)\n",
                  TEST_SIGNAL_PIN, frequency);
}

void testSignalEnable(bool enable_) {
    enabled = enable_;
    if (enabled) {
        if (sineMode) {
            startSine();
        } else {
            startSquare();
        }
        Serial.printf("[TestSig] ON: %s @ %u Hz\n",
                      sineMode ? "sine" : "square", frequency);
    } else {
        stopSignal();
        Serial.println("[TestSig] OFF");
    }
}

void testSignalSetFrequency(uint32_t freqHz) {
    if (freqHz < 50) freqHz = 50;
    if (freqHz > 50000) freqHz = 50000;
    frequency = freqHz;
    if (enabled) {
        // Restart with new frequency
        if (sineMode) startSine(); else startSquare();
        Serial.printf("[TestSig] Freq -> %u Hz\n", frequency);
    }
}

void testSignalSetWaveform(bool useSine) {
    sineMode = useSine;
    if (enabled) {
        // Restart with new waveform
        if (sineMode) startSine(); else startSquare();
        Serial.printf("[TestSig] Wave -> %s\n", sineMode ? "sine" : "square");
    }
}

bool testSignalIsEnabled() { return enabled; }
uint32_t testSignalGetFrequency() { return frequency; }
bool testSignalIsSine() { return sineMode; }
