#include "led_status.h"
#include "config.h"

static const uint32_t FAST_BLINK_MS = 250;  // No WebSocket client
static const uint32_t SLOW_BLINK_MS = 1000; // Client connected, streaming

static uint32_t lastToggle = 0;
static bool ledState = false;

void ledStatusInit() {
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
}

void ledStatusUpdate(bool hasClients) {
    uint32_t interval = hasClients ? SLOW_BLINK_MS : FAST_BLINK_MS;
    uint32_t now = millis();

    if (now - lastToggle >= interval) {
        lastToggle = now;
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
}
