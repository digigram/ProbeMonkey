#pragma once

#include <Arduino.h>

void testSignalInit();
void testSignalEnable(bool enable);
void testSignalSetFrequency(uint32_t freqHz);
void testSignalSetWaveform(bool useSine);
bool testSignalIsEnabled();
uint32_t testSignalGetFrequency();
bool testSignalIsSine();
