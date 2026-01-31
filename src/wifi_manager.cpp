#include "wifi_manager.h"
#include "config.h"
#include <WiFi.h>
#include <ESPmDNS.h>

static bool staMode = WIFI_STA_MODE;
static bool autoReconnect = true;  // Enable auto-reconnect by default
static unsigned long lastReconnectAttempt = 0;
static const unsigned long RECONNECT_INTERVAL = 5000;  // Try reconnecting every 5 seconds

// WiFi event handler for auto-reconnect
static void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case SYSTEM_EVENT_STA_DISCONNECTED:
            Serial.println("[WiFi] Disconnected from network");
            if (autoReconnect && staMode) {
                Serial.println("[WiFi] Will attempt reconnection...");
            }
            break;
        case SYSTEM_EVENT_STA_CONNECTED:
            Serial.println("[WiFi] Connected to network");
            break;
        case SYSTEM_EVENT_STA_GOT_IP:
            Serial.print("[WiFi] Got IP: ");
            Serial.println(WiFi.localIP());
            break;
        default:
            break;
    }
}

static void initAP() {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD, WIFI_AP_CHANNEL);

    Serial.println("[WiFi] AP started");
    Serial.print("[WiFi] SSID: ");
    Serial.println(WIFI_AP_SSID);
    Serial.print("[WiFi] IP:   ");
    Serial.println(WiFi.softAPIP());
}

static void initSTA() {
    WiFi.mode(WIFI_STA);
    WiFi.onEvent(onWiFiEvent);  // Register WiFi event handler for auto-reconnect
    WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);

    Serial.printf("[WiFi] Connecting to \"%s\"", WIFI_STA_SSID);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    Serial.println();

    if (WiFi.status() == WL_CONNECTED) {
        Serial.print("[WiFi] Connected! IP: ");
        Serial.println(WiFi.localIP());

        // Start mDNS so the device is reachable at probemonkey.local
        if (MDNS.begin(MDNS_HOSTNAME)) {
            MDNS.addService("ws", "tcp", WS_PORT);
            Serial.printf("[WiFi] mDNS started: %s.local\n", MDNS_HOSTNAME);
        } else {
            Serial.println("[WiFi] mDNS failed to start");
        }
    } else {
        Serial.println("[WiFi] STA connection failed, falling back to AP mode");
        staMode = false;
        initAP();
    }
}

void wifiInit() {
    if (staMode) {
        initSTA();
    } else {
        initAP();
    }
}

bool wifiIsClientConnected() {
    if (staMode) {
        return WiFi.status() == WL_CONNECTED;
    }
    return WiFi.softAPgetStationNum() > 0;
}

uint8_t wifiGetClientCount() {
    if (staMode) {
        return WiFi.status() == WL_CONNECTED ? 1 : 0;
    }
    return WiFi.softAPgetStationNum();
}

IPAddress wifiGetIP() {
    if (staMode) {
        return WiFi.localIP();
    }
    return WiFi.softAPIP();
}

bool wifiIsStaMode() {
    return staMode;
}

void wifiMonitor() {
    // Auto-reconnect logic for STA mode
    if (staMode && autoReconnect && WiFi.status() != WL_CONNECTED) {
        unsigned long now = millis();
        if (now - lastReconnectAttempt >= RECONNECT_INTERVAL) {
            lastReconnectAttempt = now;
            Serial.println("[WiFi] Attempting to reconnect...");
            WiFi.disconnect();
            WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
        }
    }
}
