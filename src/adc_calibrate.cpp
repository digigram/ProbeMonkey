#include "adc_calibrate.h"
#include "config.h"
#include "adc_sampler.h"
#include "test_signal.h"
#include "websocket_server.h"

#include <driver/dac.h>
#include <esp_adc_cal.h>
#include <ArduinoJson.h>

static volatile bool calibrationRunning = false;
static esp_adc_cal_characteristics_t adcChars;
static bool adcCharsValid = false;

static void calibrateTask(void *param) {
    calibrationRunning = true;

    // 1. Stop test signal if running
    testSignalEnable(false);

    // 2. Pause ADC sampler
    adcSamplerPause();

    // 3. Notify clients that calibration is running
    {
        const char *msg = "{\"calibration\":{\"status\":\"running\"}}";
        websocketBroadcast(msg, strlen(msg));
    }

    // 4. Enable DAC output on GPIO25 (DAC_CHANNEL_1)
    dac_output_enable(DAC_CHANNEL_1);

    // 5. Sweep 0..255, averaging CALIBRATE_SAMPLES_PER reads per step
    uint16_t results[CALIBRATE_STEPS];
    uint16_t refMv[CALIBRATE_STEPS];
    for (int step = 0; step < CALIBRATE_STEPS; step++) {
        dac_output_voltage(DAC_CHANNEL_1, step);
        delayMicroseconds(CALIBRATE_SETTLE_US);

        uint32_t sum = 0;
        for (int s = 0; s < CALIBRATE_SAMPLES_PER; s++) {
            sum += analogRead(ADC_PIN);
        }
        uint16_t avgRaw = (uint16_t)(sum / CALIBRATE_SAMPLES_PER);
        results[step] = avgRaw;

        // Convert averaged raw reading to millivolts using ESP-IDF factory calibration
        if (adcCharsValid) {
            refMv[step] = (uint16_t)esp_adc_cal_raw_to_voltage(avgRaw, &adcChars);
        } else {
            // Fallback: assume linear ADC (3300 mV full scale at 4095)
            refMv[step] = (uint16_t)((uint32_t)avgRaw * 3300 / 4095);
        }
    }

    // 6. Disable DAC
    dac_output_disable(DAC_CHANNEL_1);

    // 7. Float GPIO25 so test signal can reclaim it
    pinMode(TEST_SIGNAL_PIN, INPUT);

    // 8. Resume ADC sampler
    adcSamplerResume();

    // 9. Build JSON result and broadcast
    {
        JsonDocument doc;
        JsonObject cal = doc["calibration"].to<JsonObject>();
        cal["status"] = "complete";
        JsonArray lut = cal["adcLut"].to<JsonArray>();
        for (int i = 0; i < CALIBRATE_STEPS; i++) {
            lut.add(results[i]);
        }
        JsonArray mv = cal["refMv"].to<JsonArray>();
        for (int i = 0; i < CALIBRATE_STEPS; i++) {
            mv.add(refMv[i]);
        }

        size_t needed = measureJson(doc) + 1;
        char *buf = (char *)malloc(needed);
        if (buf) {
            size_t len = serializeJson(doc, buf, needed);
            websocketBroadcast(buf, len);
            free(buf);
        }
    }

    calibrationRunning = false;

    // 10. Delete one-shot task
    vTaskDelete(NULL);
}

void adcCalibrateInit() {
    esp_adc_cal_value_t calType = esp_adc_cal_characterize(
        ADC_UNIT_1, ADC_ATTEN_DB_12, ADC_WIDTH_BIT_12, 1100, &adcChars);
    adcCharsValid = (calType != ESP_ADC_CAL_VAL_NOT_SUPPORTED);
    if (adcCharsValid) {
        Serial.printf("[CAL] ADC characterized (type=%d)\n", calType);
    } else {
        Serial.println("[CAL] ADC calibration not available, using linear fallback");
    }
}

void adcCalibrateStart() {
    if (calibrationRunning) return;

    xTaskCreatePinnedToCore(
        calibrateTask,
        "adc_cal",
        CALIBRATE_TASK_STACK,
        NULL,
        2,  // Priority below WS send task
        NULL,
        0   // Core 0 (same as WS)
    );
}

bool adcCalibrateIsRunning() {
    return calibrationRunning;
}
