#include <Arduino.h>
#include "config.h"
#include "wifi_manager.h"
#include "websocket_server.h"
#include "adc_sampler.h"
#include "led_status.h"
#include "test_signal.h"
#include "adc_calibrate.h"

static uint32_t lastCleanup = 0;
static uint32_t lastDebug = 0;

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println();
    Serial.println("=== ProbeMonkey Firmware ===");

    ledStatusInit();
    wifiInit();
    websocketInit();
    adcSamplerInit();
    testSignalInit();
    adcCalibrateInit();

    Serial.println("[Main] All systems initialized");
    Serial.printf("[Main] Free heap: %u bytes\n", ESP.getFreeHeap());
}

void loop() {
    uint32_t now = millis();

    // WiFi auto-reconnect monitoring (STA mode)
    wifiMonitor();

    // WebSocket client cleanup every 1 second
    if (now - lastCleanup >= WS_CLEANUP_INTERVAL_MS) {
        lastCleanup = now;
        websocketCleanup();
    }

    // LED blink pattern based on WebSocket client status
    ledStatusUpdate(websocketHasClients());

    // Serial debug stats every 5 seconds
    if (now - lastDebug >= DEBUG_INTERVAL_MS) {
        lastDebug = now;
        Serial.printf("[Debug] WiFi clients: %u | WS clients: %u | "
                      "Sample rate: %u Hz | Free heap: %u bytes\n",
                      wifiGetClientCount(),
                      websocketGetClientCount(),
                      adcGetActualSampleRate(),
                      ESP.getFreeHeap());
    }

    delay(10);
}
