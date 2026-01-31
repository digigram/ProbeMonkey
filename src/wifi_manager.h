#pragma once

#include <Arduino.h>

void wifiInit();
bool wifiIsClientConnected();
uint8_t wifiGetClientCount();
IPAddress wifiGetIP();
bool wifiIsStaMode();
void wifiMonitor();  // Call periodically to handle auto-reconnect
