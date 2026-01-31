#include "websocket_server.h"
#include "config.h"
#include "adc_sampler.h"
#include "test_signal.h"
#include "adc_calibrate.h"
#include "adc_calibrate_data.h"

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

static AsyncWebServer server(WS_PORT);
static AsyncWebSocket ws(WS_PATH);

// Send current test signal state as JSON to a specific client (or all)
static void sendTestSignalState(AsyncWebSocketClient *client) {
    char buf[128];
    snprintf(buf, sizeof(buf),
             "{\"testSignal\":{\"enabled\":%s,\"freq\":%u,\"wave\":\"%s\"}}",
             testSignalIsEnabled() ? "true" : "false",
             testSignalGetFrequency(),
             testSignalIsSine() ? "sine" : "square");
    if (client) {
        client->text(buf);
    } else {
        ws.textAll(buf);
    }
}

// Handle incoming JSON commands from a client
static void handleCommand(const char *json, AsyncWebSocketClient *client) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        Serial.printf("[WS] Bad JSON from #%u: %s\n", client->id(), err.c_str());
        return;
    }

    const char *cmd = doc["cmd"];
    if (!cmd) return;

    if (strcmp(cmd, "testSignal") == 0) {
        if (doc["wave"].is<const char *>()) {
            const char *wave = doc["wave"];
            testSignalSetWaveform(strcmp(wave, "sine") == 0);
        }
        if (doc["freq"].is<uint32_t>()) {
            testSignalSetFrequency(doc["freq"].as<uint32_t>());
        }
        if (doc["enabled"].is<bool>()) {
            testSignalEnable(doc["enabled"].as<bool>());
        }
        // Broadcast updated state to all clients
        sendTestSignalState(nullptr);
    } else if (strcmp(cmd, "calibrate") == 0) {
        if (!adcCalibrateIsRunning()) {
            adcCalibrateStart();
        }
    }
}

static void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                       AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
        case WS_EVT_CONNECT:
            Serial.printf("[WS] Client #%u connected from %s\n",
                          client->id(), client->remoteIP().toString().c_str());
            {
                char welcome[256];
                snprintf(welcome, sizeof(welcome),
                         "{\"status\":\"connected\",\"sampleRate\":%d,"
                         "\"testSignal\":{\"enabled\":%s,\"freq\":%u,\"wave\":\"%s\"}}",
                         SAMPLE_RATE_HZ,
                         testSignalIsEnabled() ? "true" : "false",
                         testSignalGetFrequency(),
                         testSignalIsSine() ? "sine" : "square");
                client->text(welcome);

                // Send hardcoded ADC calibration data
                JsonDocument calDoc;
                calDoc["adcCalibration"]["timestamp"] = millis();
                JsonArray lutArray = calDoc["adcCalibration"]["adcLut"].to<JsonArray>();
                for (int i = 0; i < 256; i++) {
                    lutArray.add(ADC_CAL_LUT[i]);
                }
                JsonArray mvArray = calDoc["adcCalibration"]["refMv"].to<JsonArray>();
                for (int i = 0; i < 256; i++) {
                    mvArray.add(ADC_CAL_REF_MV[i]);
                }

                size_t needed = measureJson(calDoc) + 1;
                char *calBuf = (char *)malloc(needed);
                if (calBuf) {
                    size_t len = serializeJson(calDoc, calBuf, needed);
                    client->text(calBuf, len);
                    free(calBuf);
                }
            }
            break;
        case WS_EVT_DISCONNECT:
            Serial.printf("[WS] Client #%u disconnected\n", client->id());
            break;
        case WS_EVT_ERROR:
            Serial.printf("[WS] Client #%u error\n", client->id());
            break;
        case WS_EVT_DATA:
            {
                AwsFrameInfo *info = (AwsFrameInfo *)arg;
                if (info->final && info->index == 0 && info->len == len
                    && info->opcode == WS_TEXT) {
                    // Complete text message - copy to null-terminated buffer
                    char buf[256];
                    size_t copyLen = len < sizeof(buf) - 1 ? len : sizeof(buf) - 1;
                    memcpy(buf, data, copyLen);
                    buf[copyLen] = '\0';
                    handleCommand(buf, client);
                }
            }
            break;
        case WS_EVT_PONG:
            break;
    }
}

// FreeRTOS task: serializes ADC frames to JSON and broadcasts
static void wsSendTask(void *param) {
    // Pre-allocated JSON serialization buffer
    static char jsonBuf[JSON_BUFFER_SIZE];
    static uint32_t lastSendMs = 0;
    const uint32_t MIN_SEND_INTERVAL_MS = 100;  // Max 10 fps to prevent WebSocket buffer overflow

    for (;;) {
        // Throttle: only send if enough time has passed since last send
        uint32_t now = millis();
        bool canSend = (now - lastSendMs) >= MIN_SEND_INTERVAL_MS;

        if (adcFrameReady() && ws.count() > 0 && canSend) {
            lastSendMs = now;
            uint16_t *samples = adcGetReadyBuffer();
            uint32_t actualRate = adcGetActualSampleRate();

            // Build JSON - manually to avoid ArduinoJson memory issues
            // Format: {"sampleRate":xxxxx,"samples":[s0,s1,...,sN]}
            char *p = jsonBuf;
            char *end = jsonBuf + JSON_BUFFER_SIZE;

            // Write opening and sampleRate
            p += snprintf(p, end - p, "{\"sampleRate\":%u,\"samples\":[", actualRate);

            // Write samples array
            for (int i = 0; i < SAMPLES_PER_FRAME && p < end - 20; i++) {
                if (i > 0) *p++ = ',';
                p += snprintf(p, end - p, "%u", samples[i]);
            }

            // Write closing
            if (p < end - 3) {
                *p++ = ']';
                *p++ = '}';
                *p = '\0';
            }

            size_t len = p - jsonBuf;

            if (len > 0 && len < JSON_BUFFER_SIZE) {
                ws.textAll(jsonBuf, len);

                // Give WiFi stack time to actually transmit before queueing next frame
                vTaskDelay(pdMS_TO_TICKS(20));
            } else {
                Serial.printf("[WS] JSON overflow: %d bytes\n", len);
            }

            adcFrameConsumed();
        } else if (adcFrameReady()) {
            // No clients connected, discard the frame
            adcFrameConsumed();
        }

        vTaskDelay(1); // Yield to avoid starving other tasks
    }
}

void websocketInit() {
    // Mount LittleFS and serve the self-hosted web UI
    if (!LittleFS.begin(false)) {
        Serial.println("[WS] LittleFS mount failed - web UI unavailable");
    } else {
        Serial.println("[WS] LittleFS mounted - serving web UI");
        server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
    }

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    server.begin();

    Serial.printf("[WS] Server started on port %d, path %s\n", WS_PORT, WS_PATH);

    // Create the WS send task on Core 0
    xTaskCreatePinnedToCore(
        wsSendTask,
        "ws_send",
        WS_SEND_TASK_STACK,
        NULL,
        WS_SEND_TASK_PRIORITY,
        NULL,
        WS_SEND_TASK_CORE
    );
}

void websocketCleanup() {
    ws.cleanupClients(WS_MAX_CLIENTS);
}

uint8_t websocketGetClientCount() {
    return ws.count();
}

bool websocketHasClients() {
    return ws.count() > 0;
}

void websocketBroadcast(const char *msg, size_t len) {
    ws.textAll(msg, len);
}
