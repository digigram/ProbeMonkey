// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — WebSocket connection manager
// (ported from ProbeMonkey/contexts/WebSocketContext.tsx)
// ---------------------------------------------------------------------------

(function() {
  var DISPLAY_FPS = 30;
  var RECONNECT_DELAY = 2000;

  var ws = null;
  var displayTimer = null;
  var reconnectTimer = null;

  // Current state
  PM.ws = {
    status: 'disconnected',  // disconnected | connecting | connected | error
    connectionMode: null,    // 'station' | 'ap' | null
    samples: [],
    sampleRate: 10000,
    testSignal: { enabled: false, freq: 1000, wave: 'square' },
    calibrationStatus: 'idle', // idle | running | complete
  };

  // Refs (updated per-message, copied to state at display fps)
  var frameRef = { samples: [], sampleRate: 10000 };
  var testSignalRef = { enabled: false, freq: 1000, wave: 'square' };

  // Callbacks
  var onStatusChange = null;
  var onFrameUpdate = null;
  var onTestSignalUpdate = null;
  var onCalibrationComplete = null;
  var onCalibrationStatusChange = null;
  var onAdcCalibrationReceived = null;

  PM.wsOn = function(event, cb) {
    switch (event) {
      case 'status': onStatusChange = cb; break;
      case 'frame': onFrameUpdate = cb; break;
      case 'testSignal': onTestSignalUpdate = cb; break;
      case 'calibrationComplete': onCalibrationComplete = cb; break;
      case 'calibrationStatus': onCalibrationStatusChange = cb; break;
      case 'adcCalibrationReceived': onAdcCalibrationReceived = cb; break;
    }
  };

  function setStatus(s, mode) {
    PM.ws.status = s;
    if (mode !== undefined) PM.ws.connectionMode = mode;
    if (onStatusChange) onStatusChange(s, PM.ws.connectionMode);
  }

  function cleanup() {
    if (displayTimer) { clearInterval(displayTimer); displayTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  function startDisplayLoop() {
    if (displayTimer) clearInterval(displayTimer);
    displayTimer = setInterval(function() {
      PM.ws.samples = frameRef.samples;
      PM.ws.sampleRate = frameRef.sampleRate;
      PM.ws.testSignal = testSignalRef;
      if (onFrameUpdate) onFrameUpdate(PM.ws.samples, PM.ws.sampleRate);
      if (onTestSignalUpdate) onTestSignalUpdate(PM.ws.testSignal);
    }, 1000 / DISPLAY_FPS);
  }

  function buildWsUrl() {
    // Page is served by the ESP32, so use the same host
    var host = location.hostname || '192.168.4.1';
    return 'ws://' + host + ':81/ws';
  }

  PM.wsConnect = function() {
    cleanup();
    var url = buildWsUrl();
    setStatus('connecting', null);

    ws = new WebSocket(url);

    ws.onopen = function() {
      // Determine mode from hostname
      var mode = (location.hostname === '192.168.4.1') ? 'ap' : 'station';
      setStatus('connected', mode);
      startDisplayLoop();
    };

    ws.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);

        if (data.samples) {
          frameRef.samples = data.samples;
          frameRef.sampleRate = data.sampleRate || frameRef.sampleRate;
        }
        if (data.testSignal) {
          testSignalRef = data.testSignal;
        }
        if (data.calibration) {
          var cal = data.calibration;
          if (cal.status === 'running') {
            PM.ws.calibrationStatus = 'running';
            if (onCalibrationStatusChange) onCalibrationStatusChange('running');
          } else if (cal.status === 'complete' && cal.adcLut) {
            PM.ws.calibrationStatus = 'complete';
            if (onCalibrationStatusChange) onCalibrationStatusChange('complete');
            if (onCalibrationComplete) {
              onCalibrationComplete({
                adcLut: cal.adcLut,
                refMv: cal.refMv,
                timestamp: Date.now(),
              });
            }
          }
        }
        if (data.adcCalibration) {
          // Hardcoded calibration data from ESP32
          if (onAdcCalibrationReceived) {
            onAdcCalibrationReceived(data.adcCalibration);
          }
        }
      } catch (e) {
        // Ignore malformed messages
      }
    };

    ws.onerror = function() {
      setStatus('error', null);
    };

    ws.onclose = function() {
      cleanup();
      setStatus('disconnected', null);
      // Auto-reconnect after delay
      reconnectTimer = setTimeout(function() {
        if (PM.ws.status === 'disconnected') {
          PM.wsConnect();
        }
      }, RECONNECT_DELAY);
    };
  };

  PM.wsDisconnect = function() {
    cleanup();
    setStatus('disconnected', null);
    frameRef = { samples: [], sampleRate: 10000 };
    testSignalRef = { enabled: false, freq: 1000, wave: 'square' };
    PM.ws.samples = [];
    PM.ws.testSignal = testSignalRef;
  };

  PM.wsSendCommand = function(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    }
  };

  // Note: PM.wsConnect() is called at the end of settings.js after all callbacks are registered

})();
