#pragma once

#include <Arduino.h>

void websocketInit();
void websocketCleanup();
uint8_t websocketGetClientCount();
bool websocketHasClients();
void websocketBroadcast(const char *msg, size_t len);
