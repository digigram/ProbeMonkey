#include "adc_sampler.h"
#include "config.h"

#if USE_I2S_ADC
#include "driver/i2s.h"
#include "driver/adc.h"
#endif


// Double buffer: two frames of SAMPLES_PER_FRAME x uint16_t
static uint16_t bufferA[SAMPLES_PER_FRAME];
static uint16_t bufferB[SAMPLES_PER_FRAME];

// Pointers: fillBuffer is being written to, readyBuffer is available for WS send
static volatile uint16_t *fillBuffer = bufferA;
static volatile uint16_t *readyBuffer = bufferB;
static volatile bool frameReady = false;

// Pause flag for calibration etc.
static volatile bool samplingActive = true;

// Actual sample rate measurement
static volatile uint32_t actualSampleRate = SAMPLE_RATE_HZ;

// Critical section spinlock
static portMUX_TYPE bufferMux = portMUX_INITIALIZER_UNLOCKED;

#if USE_I2S_ADC
// I2S DMA state
static uint16_t fillIndex = 0;  // Current position in fillBuffer
static uint16_t i2sTempBuffer[I2S_DMA_BUF_LEN];  // Temporary read buffer
#endif

// Swap fill and ready buffers atomically
static void swapBuffers() {
    portENTER_CRITICAL(&bufferMux);
    volatile uint16_t *tmp = readyBuffer;
    readyBuffer = fillBuffer;
    fillBuffer = tmp;
    frameReady = true;
    portEXIT_CRITICAL(&bufferMux);
}

#if USE_I2S_ADC
// I2S DMA initialization
static void initI2SADC() {
    // Note: ESP32 I2S ADC mode has clock divider limitations
    // Actual sample rate may differ from requested due to hardware constraints
    // With use_apll=false and 80MHz APB clock, actual rates will be:
    //   Requested 50kHz  -> Actual ~96.4kHz
    //   Requested 25kHz  -> Actual ~48.2kHz
    //   Requested 20kHz  -> Actual ~38.6kHz
    // Use actualSampleRate measurement for accurate rate reporting

    // Configure ADC BEFORE I2S driver install (ESP32 I2S ADC quirk)
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ADC1_CHANNEL_0, ADC_ATTEN_DB_12);

    i2s_config_t i2s_config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_ADC_BUILT_IN),
        .sample_rate = I2S_SAMPLE_RATE_HZ,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = I2S_DMA_BUF_COUNT,
        .dma_buf_len = I2S_DMA_BUF_LEN,
        .use_apll = false,  // APB clock (80MHz) - simple but limited rate options
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    ESP_ERROR_CHECK(i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL));
    ESP_ERROR_CHECK(i2s_set_adc_mode(ADC_UNIT_1, ADC1_CHANNEL_0));
    ESP_ERROR_CHECK(i2s_adc_enable(I2S_NUM_0));

    Serial.printf("[ADC] I2S DMA mode initialized: %d Hz on GPIO%d\n",
                  I2S_SAMPLE_RATE_HZ, ADC_PIN);
}

// I2S read task - replaces tight-loop sampling
static void i2sReadTask(void *param) {
    size_t bytes_read = 0;
    uint32_t frameStartUs = 0;

    for (;;) {
        if (!samplingActive) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        // Read from I2S DMA (blocks until data available)
        esp_err_t ret = i2s_read(I2S_NUM_0, i2sTempBuffer,
                                 sizeof(i2sTempBuffer), &bytes_read,
                                 portMAX_DELAY);

        if (ret != ESP_OK || bytes_read == 0) {
            continue;
        }

        size_t samples_read = bytes_read / sizeof(uint16_t);
        uint16_t *buf = const_cast<uint16_t*>(fillBuffer);

        if (fillIndex == 0) {
            frameStartUs = micros();  // Start timing frame
        }

        // Process each sample
        for (size_t i = 0; i < samples_read && fillIndex < SAMPLES_PER_FRAME; i++) {
            // Extract 12-bit ADC value from I2S 16-bit format
            // Format: [15:4]=ADC data, [3:0]=channel
            uint16_t adc_value = (i2sTempBuffer[i] >> 4) & 0xFFF;
            buf[fillIndex++] = adc_value;
        }

        // Frame complete?
        if (fillIndex >= SAMPLES_PER_FRAME) {
            // Calculate actual sample rate
            uint32_t elapsedUs = micros() - frameStartUs;
            if (elapsedUs > 0) {
                actualSampleRate = (uint32_t)((uint64_t)SAMPLES_PER_FRAME * 1000000ULL / elapsedUs);
            }

            fillIndex = 0;
            swapBuffers();

            // Brief yield for watchdog
            vTaskDelay(1);
        }
    }
}
#endif

// Tight-loop sampling task on dedicated core
static void samplingTask(void *param) {
    const uint32_t intervalUs = 1000000 / SAMPLE_RATE_HZ;

    for (;;) {
        if (!samplingActive) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        uint16_t *buf = const_cast<uint16_t *>(fillBuffer);
        uint32_t frameStart = micros();
        uint32_t nextSample = frameStart;

        for (uint16_t i = 0; i < SAMPLES_PER_FRAME; i++) {
            // Busy-wait until next sample time (no-op if ADC read took longer)
            while ((int32_t)(nextSample - micros()) > 0) {}

            buf[i] = (uint16_t)analogRead(ADC_PIN);
            nextSample += intervalUs;
        }

        // Measure actual sample rate
        uint32_t elapsed = micros() - frameStart;
        if (elapsed > 0) {
            actualSampleRate = (uint32_t)((uint64_t)SAMPLES_PER_FRAME * 1000000ULL / elapsed);
        }

        swapBuffers();

        // Yield briefly between frames to feed watchdog / let idle task run
        vTaskDelay(1);
    }
}

void adcSamplerInit() {
#if USE_I2S_ADC
    initI2SADC();
    xTaskCreatePinnedToCore(
        i2sReadTask,
        "i2s_adc",
        SAMPLING_TASK_STACK,
        NULL,
        SAMPLING_TASK_PRIORITY,
        NULL,
        SAMPLING_TASK_CORE
    );
#else
    analogSetAttenuation(ADC_11db);
    analogReadResolution(12);

    xTaskCreatePinnedToCore(
        samplingTask,
        "adc_sample",
        SAMPLING_TASK_STACK,
        NULL,
        SAMPLING_TASK_PRIORITY,
        NULL,
        SAMPLING_TASK_CORE
    );

    Serial.printf("[ADC] Tight-loop sampling on GPIO%d targeting %d Hz\n", ADC_PIN, SAMPLE_RATE_HZ);
#endif
}

void adcSamplerPause() {
    samplingActive = false;
}

void adcSamplerResume() {
    samplingActive = true;
}

bool adcFrameReady() {
    portENTER_CRITICAL(&bufferMux);
    bool ready = frameReady;
    portEXIT_CRITICAL(&bufferMux);
    return ready;
}

uint16_t *adcGetReadyBuffer() {
    return const_cast<uint16_t *>(readyBuffer);
}

void adcFrameConsumed() {
    portENTER_CRITICAL(&bufferMux);
    frameReady = false;
    portEXIT_CRITICAL(&bufferMux);
}

uint32_t adcGetActualSampleRate() {
    return actualSampleRate;
}
