#pragma once

#include <Arduino.h>

void adcSamplerInit();
void adcSamplerPause();
void adcSamplerResume();
bool adcFrameReady();
uint16_t *adcGetReadyBuffer();
void adcFrameConsumed();
uint32_t adcGetActualSampleRate();
