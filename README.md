# ProbeMonkey

An ESP32-based single-channel digital oscilloscope for HVAC and low-voltage AC waveform measurements, with real-time WiFi streaming to a browser-based UI.

For full project documentation, circuit design, upgrade paths, and debug notes, see [ProbeMonkey.md](ProbeMonkey.md).

## Quick Start

1. Fill in your WiFi SSID and password in [src/config.h](src/config.h) to use Station mode
2. Build and upload:

```bash
# Install web UI dependencies and build
cd web && npm install && cd ..
node web/build.js

# Build and upload firmware + filesystem
pio run -t upload
pio run -t uploadfs
```

3. Connect to `http://probemonkey.local` (Station mode) or `http://192.168.4.1` (AP mode)

## Key Specs

| Parameter | Value |
|-----------|-------|
| Sample rate | ~12 kHz (analogRead polling) |
| ADC resolution | 12-bit (0-4095) |
| Voltage ranges | 3.3V / 5.3V / 18V / 38V / 79V peak (jumper-selected) |
| Streaming | WebSocket JSON at ~8-10 fps |
| Test signals | Square/sine wave via LEDC/DAC (100Hz-50kHz) |
| WiFi | Station (mDNS) or AP mode |

## Architecture

- **Core 1**: ADC acquisition at ~12 kHz in a tight polling loop
- **Core 0**: WiFi, AsyncWebSocket server, HTTP file server (LittleFS)
- **Double-buffered** sampling with atomic buffer swaps, 1000 samples per frame
- **Built-in web UI** served from LittleFS with real-time waveform display

## Hardware

ESP32-DevKitC with an analog front-end featuring:
- Multi-range voltage divider (jumper-selected)
- AC coupling with 1.65V DC bias
- Input protection (polyfuse + TVS diode + Schottky clamps)
- BNC input connector

See [ProbeMonkey.md](ProbeMonkey.md) for the full schematic, BOM, and build instructions.

## Project Structure

```
src/
  main.cpp              Entry point, task creation
  config.h              Configuration constants
  adc_sampler.cpp       ADC acquisition and buffering
  websocket_server.cpp  WebSocket server and JSON streaming
  wifi_manager.cpp      WiFi setup (AP/Station modes)
  test_signal.cpp       LEDC/DAC signal generation
  adc_calibrate.cpp     DAC sweep calibration
  led_status.cpp        Status LED patterns
web/                    Browser-based oscilloscope UI
```

## License

- **Software/Firmware**: MIT License
- **Hardware Designs**: CERN Open Hardware Licence v2 - Permissive (CERN-OHL-P)

See [LICENSE](LICENSE) for details.

## Credits

**Design & Implementation**: Chris Swart (DigiGram) with Claude Code
