# ProbeMonkey - ESP32 Oscilloscope Project Summary

## Overview

An ESP32-based single-channel digital oscilloscope designed for HVAC and low-voltage AC waveform measurements, featuring real-time WiFi streaming to a mobile app.

## What This Project Does

ProbeMonkey is a portable oscilloscope built around the ESP32-DevKitC, capable of measuring AC signals from 3.3V to 79V peak with selectable voltage ranges. It samples analog signals at ~12 kHz using analogRead() polling, streams data over WiFi via WebSocket at 8-10 fps, and includes built-in test signal generation for calibration and verification.

## Getting Started

### Quick Build & Upload

First, configure your WiFi credentials in [src/config.h](src/config.h) (SSID and password for Station mode).

```bash
# Install PlatformIO (if not already installed)
pip install platformio

# Install web UI dependencies
cd web
npm install
cd ..

# Build web UI and generate data files
node web/build.js

# Build and upload firmware
pio run -t upload

# Upload filesystem (web UI)
pio run -t uploadfs
```

Once uploaded, connect to the ProbeMonkey WiFi network or access it at `http://probemonkey.local` if configured for Station mode. Circuit design and assembly instructions are available in [ProbeMonkey_circuit.md](ProbeMonkey_circuit.md).

### Hardware Features
- **Multi-range voltage divider**: Jumper-selectable ranges for 3.3V, 5.3V, 18V, 38V, and 79V peak measurements
- **AC coupling**: 1µF capacitor with DC bias to 1.65V midpoint for centered waveform capture
- **Input protection**: Polyfuse (100mA), TVS diode for transient suppression, Schottky clamp diodes at ADC
- **ADC interface**: ESP32 GPIO36 (ADC1_CH0) with 12-bit resolution, isolated from WiFi interference
- **BNC input connector**: Professional probe connection with screw terminal alternative

### Firmware Architecture
- **Core 1**: ADC acquisition at ~12 kHz using analogRead() polling in tight loop (I2S DMA not currently working)
- **Core 0**: WiFi stack, AsyncWebSocket server, HTTP file server (LittleFS), calibration routines
- **Real-time streaming**: Double-buffered acquisition with atomic buffer swaps, 1000 samples per frame (~8-10 fps)
- **Connectivity**: Dual WiFi modes (Station with mDNS at `probemonkey.local` + auto-reconnect, or AP mode at `192.168.4.1`)
- **Test signal generation**:
  - Square wave via ESP32 LEDC PWM (100Hz - 50kHz)
  - Sine wave via ESP32 DAC cosine wave generator (130Hz - 55kHz)
  - Hardware-driven with zero CPU overhead
- **ADC calibration**: DAC sweep routine using ESP32 factory calibration curves

### Output Format
JSON-streamed samples over WebSocket (port 81, path `/ws`):
```json
{"sampleRate": 12000, "samples": [0, 1024, 2048, ..., 999]}
```
Sample rate reported dynamically based on actual measured performance (~12 kHz typical with analogRead() polling). 1000 samples per frame transmitted at 8-10 fps (throttled to prevent WebSocket buffer overflow).

## Architecture Highlights

### Dual-Core Utilization
- **ADC sampling task (Core 1, Priority 5)**: Tight polling loop calling analogRead(), accumulates 1000-sample frames (~100% CPU usage)
- **WebSocket send task (Core 0, Priority 3)**: Manual JSON serialization, broadcasts to connected clients at 8-10 fps (throttled with post-send delay)
- **Arduino loop (Core 1, Priority 1)**: Housekeeping, WiFi auto-reconnect, LED status updates, serial debug output

### Data Flow
```
GPIO36 → ESP32 ADC → analogRead() polling loop → Double buffer → Atomic swap →
Manual JSON string building → ws.textAll() (throttled 10fps + 20ms delay) → WiFi → WebSocket client
```

### Double Buffer Design
**Application layer**: Two `uint16_t[1000]` buffers (4 KB total). Sampling task calls analogRead() in tight loop, fills active buffer. When 1000 samples collected, atomic pointer swap makes it ready for WebSocket transmission while sampling continues into the other buffer.

## Technical Specifications

| Parameter | Value |
|-----------|-------|
| Sample rate | ~12 kHz (analogRead() polling in tight loop) |
| Samples per frame | 1000 (~83ms of data @ 12kHz) |
| Frame rate | 8-10 fps (100ms throttle + 20ms post-send delay) |
| ADC resolution | 12-bit (0-4095) |
| Sampling method | analogRead() polling (I2S DMA not currently working) |
| CPU usage | Core 1: ~100% (polling loop), Core 0: ~20% (WiFi + WebSocket) |
| Voltage ranges | 3.3V / 5.3V / 18V / 38V / 79V peak |
| Input connector | BNC jack (female, panel mount) |
| WiFi modes | Station (mDNS) or AP (192.168.4.1), auto-reconnect |
| WebSocket protocol | AsyncWebSocket on port 81, path `/ws`, JSON text frames |
| Test signal output | GPIO25 (DAC1), 100Hz - 50kHz square/sine |

## WebSocket Command Protocol

The WebSocket connection (port 81, path `/ws`) is bidirectional. The firmware sends ADC data frames and state updates; the client sends JSON commands.

### Firmware → Client (Outbound Messages)

| Message Type | When Sent | Format |
|--------------|-----------|--------|
| **Welcome** | On client connect | `{"status":"connected","sampleRate":12000,"testSignal":{"enabled":false,"freq":1000,"wave":"square"}}` |
| **ADC Frame** | ~10 fps while streaming | `{"samples":[0,1024,2048,...],"sampleRate":12000}` |
| **Test Signal State** | After any test signal command | `{"testSignal":{"enabled":true,"freq":1000,"wave":"square"}}` |

### Client → Firmware (Inbound Commands)

All commands are JSON with a `"cmd"` field. Optional fields may be omitted to leave that setting unchanged.

**Test Signal Control:**
```json
{"cmd":"testSignal","enabled":true,"freq":1000,"wave":"square"}
```

| Field | Type | Description |
|-------|------|-------------|
| `cmd` | `"testSignal"` | Required command identifier |
| `enabled` | `bool` | Optional. Turn signal on/off |
| `freq` | `uint32` | Optional. Frequency in Hz (100–50000) |
| `wave` | `"square"` or `"sine"` | Optional. Waveform type |

After processing, the firmware broadcasts the updated `testSignal` state to all connected clients.

**Example Usage:**
- Enable test signal: `{"cmd":"testSignal","enabled":true}`
- Change to sine wave: `{"cmd":"testSignal","wave":"sine"}`
- Set frequency: `{"cmd":"testSignal","freq":5000}`
- Full control: `{"cmd":"testSignal","enabled":true,"freq":2000,"wave":"square"}`

## Key Design Strengths

1. **Isolated sampling core**: Core 1 dedicated to ADC acquisition prevents WiFi jitter from affecting sample timing
2. **Hardware-timed test signals**: LEDC and DAC peripherals generate waveforms with zero CPU load
3. **Comprehensive calibration**: DAC sweep against factory-calibrated ADC for linearity correction
4. **Voltage divider calibration**: Firmware stores measured resistor values for accurate voltage calculation
5. **Professional input protection**: Polyfuse + TVS + Schottky clamps prevent damage from transients
6. **Clean bias network**: 1.65V reference with 10µF + 100nF decoupling for stable ADC midpoint
7. **Modular firmware**: Well-organized .h/.cpp modules (wifi_manager, websocket_server, adc_sampler, test_signal, calibration)

## Circuit Design

### Circuit Architecture
```
                             JUMPER BLOCK
                          ┌──[J1]── R1a (10k)  ──┐
                          ├──[J2]── R1b (22k)  ──┤
  INPUT ─── FUSE ─── TVS ─┤──[J3]── R1c (100k) ──┼── NODE A ──┤C1├── NODE B ──── R_s ── ADC (GPIO36)
  (BNC)   (100mA    (36V) ├──[J4]── R1d (220k) ──┤              │                  │
          polyfuse)   │    ├──[J5]── R1e (470k) ──┤             R_b             ┌─┤D1├─┐
                     GND   └───────────────────────┘              │             │  1N5819│
                                   R2 (10k)                    1.65V ref       GND      3.3V
                                 NODE A ──┤R2├── GND                         (clamp  (clamp
                                                                              low)     high)
                                                                               D2=1N5819
```

### Complete Schematic
```
                    3.3V
                     │
                   [100k]
                     │
                     ├──── 1.65V REF ──[100k R_bias]──┐
                     │                                  │
                   [100k]                               │
                     │                                  │
                    GND                                 │
                  (bypass:                              │
                  10uF + 100nF)                         │
                                                        │
                                                        │
  INPUT ──[FUSE]──[TVS]──┬──[R1 selected by jumper]──┬──[C1 1uF]──┤── NODE B
   BNC    100mA   1.5KE  │                           │             │
                  36A    │                          [R2 10k]      [1k R_series]
                   │     │                           │             │
                  GND    │                          GND            │
                         │                                    ┌────┴────┐
                         │                                    │         │
                         │                                 [D1 1N5819]  [D2 1N5819]
                         │                                 K │     │ A  A │     │ K
                         │                                  GND   ADC    ADC   3.3V
                         │                                      GPIO36
                         │                                        │
                         │                                      [1nF]   (charge reservoir
                         │                                        │      for S&H circuit)
                         │                                       GND
                         │
                         └── (jumper header pins for R1 selection)
                              Pin 1: 10k   → 3.3V range
                              Pin 2: 22k   → 5.3V range
                              Pin 3: 100k  → 18V range
                              Pin 4: 220k  → 38V range
                              Pin 5: 470k  → 79V range
```

### Signal Path (detailed)

**Stage 1 - Input Protection**
- Polyfuse (resettable fuse, 100mA) on input to protect against overcurrent
- TVS diode (1.5KE36A): Transient voltage suppressor clamps high-voltage spikes to 36V (protects against inductive kickback, relay switching transients, and ESD common in HVAC environments)
  - Bidirectional 1500W peak power rating
  - Clamping voltage: 36V (safely below the 79V range maximum)
  - Connects between input and GND, after polyfuse
- Input connector: BNC jack (or screw terminal for field wiring)

**Stage 2 - Voltage Divider (jumper-selected)**
- Common bottom resistor R2 = 10k to GND
- Top resistor selected via jumper header:

| Range  | R1 Value | Divider Ratio | Max Peak Input | Notes |
|--------|----------|---------------|----------------|-------|
| 3.3V   | 10k      | 2:1           | 3.30V          | Logic-level signals |
| 5.3V   | 22k      | 3.2:1         | 5.28V          | 5V systems |
| 18V    | 100k     | 11:1          | 18.2V          | 12VAC (17V peak) |
| 38V    | 220k     | 23:1          | 38.0V          | 24VAC (34V peak) |
| 79V    | 470k     | 48:1          | 79.2V          | High voltage / transients |

All resistors: 1% metal film recommended for accuracy. Measure actual values with
a multimeter before assembly and store in firmware for calibration (see Design Decisions §5).
R2 = 10k fixed for all ranges.

**Stage 3 - AC Coupling**
- C1 = 1uF ceramic or film capacitor
- Blocks DC offset from input signal
- Low-frequency cutoff determined by C1 and the AC impedance to ground:
  - AC impedance = R_bias (100k) || (R1 + R2) in parallel
  - **3.3V range** (R1=10k): (10k+10k) || 100k = 16.67k → cutoff = **9.5 Hz**
  - **5.3V range** (R1=22k): (22k+10k) || 100k = 24.2k → cutoff = **6.6 Hz**
  - **18V range** (R1=100k): (100k+10k) || 100k = 52.4k → cutoff = **3.0 Hz**
  - **38V range** (R1=220k): (220k+10k) || 100k = 69.7k → cutoff = **2.3 Hz**
  - **79V range** (R1=470k): (470k+10k) || 100k = 82.8k → cutoff = **1.9 Hz**
  - All cutoffs are well below 60Hz (worst case: 9.5Hz gives only 1.4dB attenuation at 60Hz)
- NOTE: Future DC coupling option = jumper to bypass C1

**Stage 4 - DC Bias (mid-rail reference)**
- Purpose: Shift the AC signal so 0V input = 1.65V at ADC (midpoint of 0-3.3V range)
- R_bias = 100k from NODE B to 1.65V reference
- 1.65V reference generated by:
  - Two 100k resistors: 3.3V ──┤100k├── 1.65V ──┤100k├── GND
  - Decoupled with 10uF electrolytic + 100nF ceramic

**Stage 5 - Output Protection + ADC**
- R_series = 1k in series with ADC pin (limits current through clamp diodes)
- D1, D2 = Two 1N5819 Schottky diodes: clamp signal to safe ADC range
  - **D1** (lower clamp): Cathode to signal, Anode to GND → clamps below -0.4V
  - **D2** (upper clamp): Anode to signal, Cathode to 3.3V → clamps above 3.7V
  - 1N5819 specs: 1A current rating, Vf ≈ 0.4V at 1A (DO-41 package)
  - With 1k series resistor, max clamp current = (3.3V - 0.4V) / 1k = 2.9mA (well within diode rating)
- ADC pin: **GPIO36 (VP)** - ADC1_CH0, input-only, no internal pull-up (ideal for ADC)

### ESP32 Pin Assignment

| Function | GPIO | Notes |
|----------|------|-------|
| ADC Input | GPIO36 (VP) | ADC1_CH0, input-only, no pull-up |
| WiFi | Internal | Built-in, uses ADC2 (hence we use ADC1) |
| USB Serial | TX0/RX0 | Debug output, programming |

### Design Decisions & Trade-offs

**1. No op-amp buffer (simplicity choice)**
- **Pro**: Fewer components, lower cost, simpler build
- **Con**: ESP32 ADC S&H circuit has low input impedance (~13kΩ during sampling)
- **Mitigation**: The 1kΩ series resistor + bias network provides low-enough source impedance for basic measurements. Software calibration handles remaining non-linearity.
- **Future upgrade**: Add MCP6001 (rail-to-rail, single-supply) as unity-gain buffer before ADC if accuracy becomes an issue.

**2. AC coupling only (initially)**
- Simplifies the circuit for the stated 60Hz AC use case
- **Future**: Add a jumper across C1 to bypass it for DC measurements

**3. Manual jumper range selection**
- Simple, no additional ICs needed
- **Future auto-range note**: Replace jumper header with CD4051 analog multiplexer (8:1, 5 of 8 channels used). ESP32 drives three GPIO select lines to switch ranges in software. Would require reading ADC, detecting if signal is clipping, and switching to a higher range automatically.

**4. Using GPIO36 for ADC**
- ADC1_CH0 - guaranteed to work alongside WiFi
- Input-only pin with no internal pull resistors
- Clean analog path on ESP32-DevKitC

**5. Resistor calibration for accuracy**
- Measure each R1 and R2 with a multimeter before assembly, record actual values
- Store actual R1/R2 ratios in firmware as calibration constants per jumper range
- Voltage calculation: `V_input = V_adc × (R1_actual + R2_actual) / R2_actual`
- Eliminates resistor tolerance as an error source (typically ±1-5%) at zero cost
- The ESP32 ADC non-linearity (~3-5%) remains the dominant error, but correcting the divider ratio is free accuracy you'd be leaving on the table otherwise

**6. TVS diode for transient protection**
- **Why it's needed**: HVAC environments have inductive loads (relays, solenoids, motors) that produce high-voltage transients when switched. These can exceed 100V with sub-microsecond rise times.
- **1.5KE36A selection**: 36V clamping voltage is safely below the 79V range maximum while still allowing normal operation up to 24VAC (34V peak). The 1500W peak power rating handles typical HVAC transients.
- **Placement**: After the polyfuse, before the voltage divider. This clamps transients at the input, protecting all downstream components.
- **Limitations**: The TVS protects against brief transients (µs-ms duration). Sustained overvoltage beyond the selected range will still require the polyfuse to trip. For extreme environments, consider adding a gas discharge tube (GDT) for higher energy transients.
- **Cost**: Adds ~$1-2 to the BOM, significantly improves reliability in field deployments

## Use Cases

### Primary Application: HVAC Diagnostics
- Measure 24VAC transformer outputs (thermostat wiring)
- Verify control signals (Y, W, G, etc.)
- Troubleshoot relay switching and valve control
- Capture inductive kickback transients

### Additional Applications
- 60Hz mains analysis (via isolation transformer)
- Power supply ripple measurement
- Audio waveform analysis (low frequency)
- Logic level signal debugging (3.3V/5V)
- Hobby electronics testing

## Current Status

**Classification**: Prototype / Lab Use ✓
**Production Ready**: Yes (with I2S DMA as future enhancement)

### What Works
- Core dual-core architecture validated
- Circuit design functional for 24VAC/60Hz measurements
- Test signal generation verified (square/sine on GPIO25)
- analogRead() polling at ~12kHz (200 samples per 60Hz cycle)
- WiFi streaming stable at ~8-10fps with no heap exhaustion
- ADC calibration routine produces accurate linearity correction
- WiFi auto-reconnect in Station mode (5s retry interval)
- Buffer synchronization stable with atomic pointer swaps

### Known Limitations
- **I2S DMA mode not currently working** - Future enhancement to enable 50-200 kHz hardware-timed sampling with reduced CPU usage. Currently using analogRead() polling which is stable and sufficient for HVAC/60Hz applications.

## Hardware Requirements

### ESP32 Module
- ESP32-DevKitC (or compatible)
- USB cable for programming
- 5V power supply (500mA minimum)

### Bill of Materials (BOM)

| # | Component | Value | Package | Qty | Notes |
|---|-----------|-------|---------|-----|-------|
| 1 | ESP32-DevKitC | - | Module | 1 | Main MCU |
| 2 | BNC Jack | Female, panel mount | Through-hole | 1 | Input connector |
| 3 | Polyfuse | 100mA | Through-hole | 1 | Input overcurrent protection |
| 4 | TVS Diode | 1.5KE36A | DO-201 | 1 | Transient voltage suppressor (36V bidirectional, 1500W peak) |
| 5 | R1a | 10k 1% | 0805 or TH | 1 | 3.3V range divider |
| 6 | R1b | 22k 1% | 0805 or TH | 1 | 5.3V range divider |
| 7 | R1c | 100k 1% | 0805 or TH | 1 | 18V range divider |
| 8 | R1d | 220k 1% | 0805 or TH | 1 | 38V range divider |
| 9 | R1e | 470k 1% | 0805 or TH | 1 | 79V range divider |
| 10 | R2 | 10k 1% | 0805 or TH | 1 | Common bottom divider |
| 11 | R_bias | 100k | 0805 or TH | 1 | AC bias to 1.65V ref |
| 12 | R_ref1 | 100k | 0805 or TH | 1 | 1.65V reference top |
| 13 | R_ref2 | 100k | 0805 or TH | 1 | 1.65V reference bottom |
| 14 | R_series | 1k | 0805 or TH | 1 | ADC protection series R |
| 15 | C1 | 1uF film/ceramic | Through-hole or 0805 | 1 | AC coupling cap (using 3x 100nF in parallel until 1uF part arrives) |
| 16 | C_ref1 | 10uF electrolytic | Through-hole | 1 | Reference bypass |
| 17 | C_ref2 | 100nF ceramic | 0805 or TH | 1 | Reference HF bypass |
| 18 | D1 | 1N5819 | DO-41 | 1 | Schottky clamp to GND (lower clamp) |
| 19 | D2 | 1N5819 | DO-41 | 1 | Schottky clamp to 3.3V (upper clamp) |
| 20 | C_adc | 1nF ceramic | 0805 or TH | 1 | ADC S&H charge reservoir (1nF reduces AC signal attenuation at higher frequencies; τ=1µs with R_series settles well within 100µs sample period) |
| 21 | Jumper header | 1x5 pin header + jumper cap | 2.54mm | 1 | Range selection |
| 22 | Breadboard or perfboard | - | - | 1 | For prototyping |

**Estimated component cost**: ~$8-12 USD (excluding ESP32 module)

## Software Stack

### Firmware
- **Platform**: PlatformIO (ESP32 Arduino framework)
- **Core libraries**:
  - ESP-IDF (low-level ADC, DAC, timer control)
  - AsyncTCP / ESPAsyncWebServer (WebSocket)
  - ArduinoJson v7 (serialization)
  - LittleFS (filesystem for web UI)
- **Build tool**: PlatformIO CLI
- **Target**: ESP32-DevKitC (esp32dev board)

### Client Interface

**Built-in Web UI** (In Development):
- JavaScript web interface served from ESP32's LittleFS filesystem
- Connects directly via WebSocket to ESP32 (no external server required)
- Accessed via browser at `http://probemonkey.local` (Station mode) or `http://192.168.4.1` (AP mode)
- Real-time waveform display with HTML5 Canvas
- Test signal controls (enable/disable, waveform type, frequency)
- Voltage/time scale adjustments
- Works on desktop browsers and mobile devices

**Alternative Options:**
- Web browser WebSocket test client (for protocol debugging)
- Custom app (user's choice)
- Serial monitor for debug output

**Note**: Original React/Expo mobile app design was deprecated in favor of the built-in web UI approach.

## Performance Characteristics

### Measured Performance
- **Sample rate**: ~12 kHz actual (analogRead() polling in tight loop)
- **Frame rate**: 8-10 fps (1000 samples per frame, throttled with post-send delay for heap stability)
- **Samples per 60Hz cycle**: ~200 samples (good waveform fidelity for HVAC diagnostics)
- **WebSocket throughput**: ~32 KB/s (4 KB frames at 8 fps, stable with no heap exhaustion)
- **ADC bias stability**: ±5 counts (1.2mV RMS) with no input signal
- **Sample timing jitter**: Minor jitter from task scheduling (software polling, not hardware-timed)

### Limitations
- **Single channel only**: No multi-channel support
- **AC coupled only**: DC measurements require jumper modification (future feature)
- **ADC non-linearity**: ~3-5% error at extremes (mitigated by calibration LUT)
- **WiFi range**: ~10-20m typical (2.4GHz limitations)

## Safety Considerations

### Electrical Safety
- **NEVER connect to mains voltage directly** - use isolation transformer or CT clamps
- **24VAC limit for direct connection** - only connect isolated low-voltage sources
- **Polyfuse protection**: Auto-resets on overcurrent, but does not protect against overvoltage
- **TVS diode**: Clamps transients, but repeated high-energy spikes may degrade it

### Grounding
- ESP32 ground = USB ground (if powered via USB)
- Ensure proper grounding when measuring isolated circuits
- Use star grounding for analog/digital separation

### ESD Precautions
- Handle circuit with ESD strap when possible
- Avoid touching ADC input traces
- Clamp diodes provide ESD protection, but not unlimited

## Build Instructions

1. **Order components** from BOM above
2. **Measure resistors** with multimeter, record actual values for firmware calibration
3. **Assemble circuit** on breadboard or perfboard following schematic
4. **Verify bias voltage**: Power up, measure GPIO36 with multimeter → should read 1.65V ±0.1V
5. **Flash firmware**:
   ```bash
   cd firmware
   pio run -t upload
   ```
6. **Connect to WiFi**: Join "ProbeMonkey" AP (password: see config.h) or configure Station mode
7. **Test WebSocket**: Browse to `ws://192.168.4.1:81/ws` (AP mode) or `ws://probemonkey.local:81/ws` (Station mode)
8. **Run calibration**: Send `{"cmd":"calibrate"}` via WebSocket, save LUT to LittleFS
9. **Verify test signal**: Enable test signal, connect GPIO25 to BNC input (3.3V range), observe waveform

### Assembly Notes

1. **TVS diode orientation** - The 1.5KE36A is bidirectional, so polarity doesn't matter. Connect one lead to the input (after polyfuse) and the other to GND. Keep leads short for effective transient suppression.
2. **Schottky diode polarity** - D1 (lower clamp): cathode (marked band) to signal, anode to GND. D2 (upper clamp): anode to signal, cathode (marked band) to 3.3V. Double-check before powering up!
3. **Keep analog wiring short** - long wires pick up 60Hz noise (ironic for a 60Hz scope)
4. **Star grounding** - run separate ground paths for analog and digital sections back to a common point - important when adding peripherals
5. **Bypass caps** close to ESP32 3.3V pin (100nF ceramic)
6. **Test without signal first** - verify 1.65V DC bias appears on GPIO36 with no input connected
7. **Never connect mains directly** - use proper isolation transformers or CT clamps for mains measurement. 24VAC from transformers is safe as it's already isolated.

### Verification / Testing Plan

1. **Bias point test**: Power up with no input, read ADC - should read ~2048 (midpoint of 12-bit range = 1.65V)
2. **Known voltage test**: Apply a known DC voltage through a cap (simulate AC) or use a function generator at 60Hz, verify ADC readings match expected values
3. **Range test**: Test each jumper position with appropriate signal levels
4. **Protection test**: Verify clamp diodes limit voltage at GPIO36 to -0.4V to +3.7V range (safe for ESP32)
5. **TVS protection test**: Apply a controlled transient (e.g., from an inductive load or pulse generator) and verify the TVS clamps it to ~36V before reaching the voltage divider
6. **WiFi coexistence**: Confirm ADC1 readings remain stable while WiFi is transmitting data

## Files & Documentation

- `/` - PlatformIO project with complete ESP32 firmware
  - `src/main.cpp` - Entry point, task creation
  - `src/config.h` - All configuration constants
  - `src/adc_sampler.cpp` - ADC acquisition and buffering
  - `src/websocket_server.cpp` - WebSocket server and JSON streaming
  - `src/wifi_manager.cpp` - WiFi setup (AP/Station modes)
  - `src/test_signal.cpp` - LEDC/DAC signal generation
  - `src/adc_calibrate.cpp` - DAC sweep calibration routine
  - `src/led_status.cpp` - Status LED blink patterns

## Future Hardware Improvements

### Current System Performance
The ESP32-DevKitC with internal ADC achieves:
- **Sample rate**: 11.6kHz actual (12kHz target with `analogRead()` polling)
- **Resolution**: 12-bit effective (4096 steps)
- **Linearity**: ±3-5% error at extremes (improved with calibration LUT)
- **Applications**: Excellent for 60Hz AC, HVAC diagnostics, low-frequency signals (<1kHz)

### When to Upgrade

**Stick with current ESP32-DevKitC if:**
- Measuring 60Hz or low-frequency signals (<1kHz)
- 12-bit resolution is adequate
- ±3-5% accuracy acceptable after calibration
- Sample rate of 12kHz sufficient (200+ samples per 60Hz cycle)

**Consider upgrading for:**
- **Higher frequency signals**: Audio (20kHz), ultrasonic, PWM analysis, switching regulators
- **Precision measurements**: High-resolution DC voltage/current monitoring, sensor calibration
- **Multi-channel applications**: Dual-trace oscilloscope, differential measurements
- **Faster sampling**: Capturing transients, edge timing, high-speed digital signals

---

### Upgrade Path 1: ESP32-S3 (Pin-Compatible Drop-In)

**ESP32-S3-DevKitC-1** is a direct replacement for ESP32-DevKitC with improved ADC performance.

**Key Improvements:**
| Feature | ESP32 (current) | ESP32-S3 |
|---------|-----------------|----------|
| ADC resolution | 12-bit | 12-bit |
| ADC linearity (INL) | ±40 LSB (~±3%) | ±12 LSB (~±1%) |
| Sample rate (analogRead) | ~12kHz | ~15-20kHz |
| Sample rate (I2S DMA potential) | Not working | 200kHz+ (if implemented) |
| WiFi | 2.4GHz | 2.4GHz |
| CPU cores | 2× 240MHz | 2× 240MHz |
| USB | UART bridge | Native USB (OTG) |

**Benefits for ProbeMonkey:**
- **Better linearity**: ±1% INL vs ±3%, less calibration needed
- **Faster sampling**: 15-20kHz with `analogRead()`, potential for 200kHz+ with I2S DMA mode (if implemented)
- **Native USB**: Direct USB connection without UART bridge (faster programming, debugging)
- **Pin-compatible**: Same GPIO pinout, minimal firmware changes

**Migration effort**: Low - same Arduino framework, GPIO36 ADC pin unchanged, drop-in replacement

**Cost**: ~$8-12 USD (similar to ESP32-DevKitC)

**Recommendation**: Best first upgrade if you need moderate speed improvement (15-20kHz) and better linearity without circuit redesign.

---

### Upgrade Path 2: External ADC for High Speed (MCP3201)

**MCP3201 Breakout Board** - 12-bit, 100kSPS, SPI interface

**Specifications:**
- **Resolution**: 12-bit (4096 steps)
- **Sample rate**: 100kSPS (100,000 samples/sec)
- **Interface**: SPI (3-wire: CLK, MISO, CS)
- **Input range**: 0-Vref (typically 3.3V or 5V)
- **Linearity**: ±1 LSB (±0.024%)
- **Power**: 500µA typical @ 3.3V
- **Cost**: ~$3-5 USD (chip + breakout board)

**Use Cases:**
- Audio frequency analysis (20Hz - 20kHz)
- Switched-mode power supply ripple measurement
- PWM signal analysis
- Fast transient capture (µs-level events)
- Multiple 60Hz cycles in a single frame (1000 samples = 8× faster frame rate)

**Integration with ProbeMonkey:**
1. **Wiring**:
   - ESP32 SPI pins: CLK (GPIO18), MISO (GPIO19), CS (GPIO5)
   - MCP3201 Vref → 3.3V (sets input range)
   - Signal input: Connect to existing voltage divider output (NODE B, after AC coupling)

2. **Firmware changes**:
   - Replace `analogRead()` with SPI transactions (~2µs per sample)
   - 100kHz sampling achievable in tight loop
   - Same double-buffer architecture, minimal changes to `adc_sampler.cpp`

3. **Circuit impact**:
   - Voltage divider, AC coupling, bias network unchanged
   - MCP3201 replaces ESP32 ADC as the digitizer
   - Can use both: MCP3201 for fast sampling, ESP32 ADC for test signal monitoring

**Advantages over ESP32-S3:**
- 5-8× faster sampling (100kHz vs 15-20kHz)
- Superior linearity (±0.024% vs ±1%)
- Offloads ADC from ESP32 (more CPU for processing)

**Disadvantages:**
- Additional hardware (breakout board, wiring)
- SPI communication overhead (~2µs per sample vs sub-µs for `analogRead()`)
- One more component to assemble/debug

**Recommendation**: Best for high-speed applications (>20kHz signals) where external hardware is acceptable.

---

### Upgrade Path 3: External ADC for High Resolution (MCP3421)

**MCP3421 Breakout Board** - 18-bit, delta-sigma ADC, I2C interface

**Specifications:**
- **Resolution**: 18-bit (262,144 steps)
- **Sample rate**: 3.75 SPS (18-bit mode) to 240 SPS (12-bit mode)
- **Interface**: I2C (SDA, SCL)
- **Input range**: Programmable gain (1×, 2×, 4×, 8×)
- **Linearity**: ±2 LSB typical
- **Input type**: Differential (measure voltage difference between two inputs)
- **Noise**: <5µV RMS (18-bit mode)
- **Cost**: ~$5-8 USD (chip + breakout board)

**Use Cases:**
- **DC precision measurements**: Battery voltage monitoring, sensor calibration
- **Slow-varying signals**: Temperature (via thermistor), pressure, strain gauges
- **Low-noise applications**: High-resolution voltage/current measurement
- **Differential measurements**: Shunt resistor current sensing, bridge circuits

**NOT suitable for:**
- AC waveform capture (too slow: max 240 SPS)
- 60Hz oscilloscope use (would only get 4 samples per cycle at max speed)

**Integration with ProbeMonkey:**
1. **Wiring**:
   - ESP32 I2C pins: SDA (GPIO21), SCL (GPIO22)
   - Differential inputs: IN+ (signal), IN- (ground or reference)
   - Programmable gain allows measuring small voltages directly (bypassing voltage divider for precision)

2. **Firmware changes**:
   - Replace `analogRead()` with I2C reads (blocking, 4-250ms per sample depending on resolution)
   - Incompatible with real-time streaming architecture (too slow for WebSocket frames)
   - Better suited for logging/monitoring mode (periodic samples, not continuous waveforms)

3. **Circuit impact**:
   - Can coexist with ESP32 ADC (I2C is separate bus)
   - Use MCP3421 for DC precision, ESP32 ADC for AC waveforms

**Advantages over ESP32:**
- 64× more resolution (18-bit vs 12-bit)
- Differential input (measure voltage across components)
- Programmable gain (measure mV-level signals accurately)

**Disadvantages:**
- Extremely slow (3.75-240 SPS vs 12kHz)
- Not usable for AC waveform capture
- I2C overhead and blocking reads

**Recommendation**: Only for DC/slow-signal precision measurements. Not a replacement for the oscilloscope function, but a complementary feature for DC voltage monitoring.

---

### Comparison Table: Upgrade Options

| Feature | ESP32 (current) | ESP32-S3 | + MCP3201 | + MCP3421 |
|---------|-----------------|----------|-----------|-----------|
| **Sample rate** | 12kHz | 15-20kHz | 100kHz | 3.75-240 SPS |
| **Resolution** | 12-bit | 12-bit | 12-bit | 18-bit |
| **Linearity** | ±3-5% | ±1% | ±0.024% | ±0.0008% |
| **Best for** | 60Hz AC, HVAC | 60Hz + audio | Audio, fast transients | DC precision |
| **Migration effort** | N/A | Drop-in swap | Moderate (SPI) | Low (I2C), but different use case |
| **Cost** | $0 (current) | +$8-12 | +$3-5 | +$5-8 |
| **Circuit changes** | None | None | Minimal wiring | Minimal wiring |
| **Firmware changes** | None | None | Moderate | Moderate, new mode |

---

### Recommended Upgrade Strategy

**For higher-speed oscilloscope use (audio, PWM, fast AC):**
1. **Phase 1**: Upgrade to **ESP32-S3** for better linearity and 15-20kHz sampling
   - Drop-in replacement, minimal effort
   - Validate performance, then decide if external ADC needed

2. **Phase 2** (if >20kHz required): Add **MCP3201 breakout board**
   - Achieves 100kHz sampling
   - Can implement I2S DMA on ESP32-S3 as alternative (200kHz potential, no external hardware)

**For DC precision measurements (sensor monitoring, calibration):**
- Add **MCP3421** as a parallel feature (separate from oscilloscope mode)
- Use for logging/monitoring, not waveform capture

**For HVAC/60Hz use (current application):**
- **No upgrade needed** - ESP32-DevKitC at 12kHz is excellent for this use case

---

### Implementation Notes

**ESP32-S3 Migration:**
- Update `platformio.ini`: `board = esp32-s3-devkitc-1`
- Test ADC performance (should see ~15-20kHz with existing code)
- Re-run calibration routine (better linearity may reduce LUT correction needed)

**MCP3201 Integration:**
- Add to BOM: MCP3201-BI/P chip or breakout board (e.g., Adafruit, SparkFun)
- Wiring: SPI bus (GPIO18, GPIO19, GPIO5), Vref to 3.3V
- Firmware: Replace `analogRead()` with SPI transactions in `adc_sampler.cpp`
- Expected sample rate: 80-100kHz (limited by SPI overhead, not MCP3201 speed)

**MCP3421 Integration:**
- Add to BOM: MCP3421 chip or breakout board
- Wiring: I2C bus (GPIO21, GPIO22)
- Firmware: Add new "DC monitor mode" separate from oscilloscope streaming
- Use case: Periodic voltage logging, not real-time waveforms

---

### Quick Checklist: Other Future Hardware Enhancements

- [ ] DC coupling option (jumper to bypass C1)
- [ ] Auto-ranging via CD4051 analog multiplexer (software-controlled range switching)
- [ ] Op-amp buffer (MCP6001) for improved input impedance
- [ ] Dual-channel support (second ADC input)
- [ ] External trigger input (GPIO with edge detection)
- [ ] Higher voltage ranges (150V+ with different divider resistors and higher-voltage TVS)
- [ ] Isolated input (opto-isolators or isolation amplifier for mains measurements)

---

## Future Firmware Enhancements

- [x] WiFi auto-reconnect in Station mode (implemented)
- [ ] **WiFi provisioning via web interface** (connect to AP mode, enter SSID/password through web UI, save to NVS/EEPROM - eliminates need to hardcode credentials in config.h)
- [ ] **I2S DMA mode for jitter-free sampling** (not currently working - would enable 50-200 kHz hardware-timed sampling with ~95% CPU reduction on Core 1)
- [x] **Web UI served from LittleFS** (in development - live waveform display in browser)
- [ ] **Binary WebSocket protocol** (60% smaller frames: 2KB vs 5KB, enables 20fps at higher sample rates)
- [ ] **Raw TCP socket streaming** (bypass WebSocket overhead, full control over buffering and backpressure)
- [ ] **UDP streaming** (fire-and-forget, no buffering issues, ideal for real-time waveform viewing where occasional frame loss is acceptable)
- [ ] **Serial over USB streaming** (bypass WiFi entirely, 115200+ baud, rock-solid reliability for lab use)
- [ ] Trigger modes (edge, level, auto)
- [ ] Waveform math (FFT, RMS, frequency counter)
- [ ] Data logging to SD card or LittleFS
- [ ] DC monitor mode for MCP3421 (separate from oscilloscope streaming)

---

## Future Software Enhancements

- [ ] Desktop app (Electron or native)
- [ ] Frequency-domain view (FFT spectrum analyzer)
- [ ] Measurement cursors (V, T, ΔV, ΔT)
- [ ] Screenshot/export to CSV
- [ ] Waveform comparison (overlay multiple captures)
- [ ] Auto-measurement (Vpp, Vrms, frequency, duty cycle)

## License

This project is dual-licensed:
- **Software/Firmware**: MIT License
- **Hardware Designs**: CERN Open Hardware Licence v2 - Permissive (CERN-OHL-P)

See the [LICENSE](LICENSE) file for full details.

This allows maximum freedom to use, modify, and commercialize the project while maintaining attribution.


## Credits

**Design & Implementation**: Chris Swart (DigiGram) with Claude Code
**Code Review**: Claude (Anthropic) - identified critical concurrency bugs and circuit improvements
**Target Application**: HVAC diagnostics and hobby electronics

---

**Last Updated**: 2026-01-31
**Hardware Revision**: v1.0 (prototype)
**Firmware Version**: 1.0 - analogRead() polling with built-in web UI (see `firmware/platformio.ini` for build info)

---

## DEBUG LOG

**Current Status**: ✓ STABLE - analogRead() polling with WebSocket streaming

**Active Implementation**:
- **Sampling method**: analogRead() polling in tight loop on Core 1
- **Sample rate**: ~12 kHz actual (200 samples per 60Hz cycle - good for HVAC diagnostics)
- **Frame size**: 1000 samples in JSON format (~4KB per frame)
- **Frame rate**: ~8 fps effective (100ms throttle + 20ms post-send delay)
- **Data rate**: ~32 KB/s (manageable for WiFi)
- **Heap**: Stable, no crashes
- **CPU usage**: Core 1 ~100% (polling), Core 0 ~20% (WiFi + WebSocket)

**I2S DMA Status** (Not Currently Working):
- I2S DMA would enable 50-200 kHz hardware-timed sampling with ~95% CPU reduction on Core 1
- Attempted implementation had issues with I2S peripheral configuration
- Reverted to analogRead() polling for stable operation
- Future enhancement to revisit I2S DMA implementation

**Next Steps**:
- Fix I2S DMA mode (hardware-timed sampling, lower CPU usage, higher sample rates)
- Binary WebSocket protocol (2KB frames instead of 4KB, enables 20fps)
- UDP streaming (eliminates buffering issues entirely)
- Raw TCP with flow control