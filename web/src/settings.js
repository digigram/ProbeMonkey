// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — Settings screen
// (ported from ProbeMonkey/app/(tabs)/settings.tsx + CalibrationContext.tsx)
// ---------------------------------------------------------------------------

(function() {
  var RES_STORAGE_KEY = 'resistor_calibration';
  var ADC_STORAGE_KEY = 'adc_calibration';

  // DOM elements
  var settingsStatusDot = document.getElementById('settings-status-dot');
  var settingsStatusText = document.getElementById('settings-status-text');
  var connInfo = document.getElementById('conn-info');
  var connMode = document.getElementById('conn-mode');
  var connUrl = document.getElementById('conn-url');

  var r2Input = document.getElementById('r2-input');
  var r1Inputs = document.querySelectorAll('.r1-input');
  var resetCalBtn = document.getElementById('reset-cal-btn');

  var adcStatusText = document.getElementById('adc-status-text');
  var runAdcBtn = document.getElementById('run-adc-btn');
  var clearAdcBtn = document.getElementById('clear-adc-btn');

  // ---- Resistor calibration state ----
  var calibration = { r2: null, r1: { '3.3V': null, '5V': null, '18V': null, '38V': null, '79V': null } };

  function loadResistorCal() {
    try {
      var raw = localStorage.getItem(RES_STORAGE_KEY);
      if (raw) calibration = JSON.parse(raw);
    } catch (e) { /* use defaults */ }
  }

  function saveResistorCal() {
    localStorage.setItem(RES_STORAGE_KEY, JSON.stringify(calibration));
  }

  function updateVoltageRanges() {
    PM.voltageRanges = PM.buildVoltageRanges(calibration);
    // Update the computed info displays
    for (var i = 0; i < PM.VOLTAGE_RANGE_KEYS.length; i++) {
      var key = PM.VOLTAGE_RANGE_KEYS[i];
      var cfg = PM.voltageRanges[key];
      var el = document.getElementById('cal-' + key + '-info');
      if (el) {
        el.textContent = 'Ratio: ' + cfg.dividerRatio.toFixed(2) + '   Max: ' + cfg.maxPeak.toFixed(1) + 'V';
      }
    }
  }

  function populateResistorInputs() {
    r2Input.value = (calibration.r2 != null) ? (calibration.r2 / 1000) : '';
    r1Inputs.forEach(function(input) {
      var range = input.dataset.range;
      var val = calibration.r1[range];
      input.value = (val != null) ? (val / 1000) : '';
    });
  }

  // R2 input
  r2Input.addEventListener('input', function() {
    var text = r2Input.value.trim();
    if (text === '') {
      calibration.r2 = null;
    } else {
      var parsed = parseFloat(text);
      if (!isNaN(parsed) && parsed > 0) calibration.r2 = parsed * 1000;
    }
    saveResistorCal();
    updateVoltageRanges();
  });

  // R1 inputs
  r1Inputs.forEach(function(input) {
    input.addEventListener('input', function() {
      var range = input.dataset.range;
      var text = input.value.trim();
      if (text === '') {
        calibration.r1[range] = null;
      } else {
        var parsed = parseFloat(text);
        if (!isNaN(parsed) && parsed > 0) calibration.r1[range] = parsed * 1000;
      }
      saveResistorCal();
      updateVoltageRanges();
    });
  });

  // Reset to nominal
  resetCalBtn.addEventListener('click', function() {
    calibration = { r2: null, r1: { '3.3V': null, '5V': null, '18V': null, '38V': null, '79V': null } };
    saveResistorCal();
    populateResistorInputs();
    updateVoltageRanges();
  });

  // ---- ADC calibration state ----
  var adcCalibration = null;

  function loadAdcCal() {
    try {
      var raw = localStorage.getItem(ADC_STORAGE_KEY);
      if (raw) {
        adcCalibration = JSON.parse(raw);
        PM.adcLut = PM.buildAdcLut(adcCalibration);
      }
    } catch (e) { /* use defaults */ }
  }

  function saveAdcCal() {
    if (adcCalibration) {
      localStorage.setItem(ADC_STORAGE_KEY, JSON.stringify(adcCalibration));
    } else {
      localStorage.removeItem(ADC_STORAGE_KEY);
    }
  }

  function updateAdcUI() {
    var isConnected = PM.ws.status === 'connected' && PM.ws.connectionMode != null;
    var isRunning = PM.ws.calibrationStatus === 'running';

    runAdcBtn.disabled = !isConnected || isRunning;

    if (isRunning) {
      adcStatusText.textContent = 'Calibrating...';
      adcStatusText.style.color = '#ff9800';
    } else if (adcCalibration) {
      var d = new Date(adcCalibration.timestamp);
      adcStatusText.textContent = 'Calibrated ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      adcStatusText.style.color = '#4caf50';
      clearAdcBtn.classList.remove('hidden');
    } else {
      adcStatusText.textContent = 'Not calibrated';
      adcStatusText.style.color = '#9e9e9e';
      clearAdcBtn.classList.add('hidden');
    }
  }

  runAdcBtn.addEventListener('click', function() {
    PM.wsSendCommand({ cmd: 'calibrate' });
  });

  clearAdcBtn.addEventListener('click', function() {
    adcCalibration = null;
    PM.adcLut = PM.buildAdcLut(null);
    saveAdcCal();
    updateAdcUI();
  });

  // ---- Connection status in settings ----
  function updateSettingsStatus() {
    var s = PM.ws.status;
    var mode = PM.ws.connectionMode;
    var color;
    switch (s) {
      case 'connected': color = '#4caf50'; break;
      case 'connecting': color = '#ff9800'; break;
      case 'error': color = '#f44336'; break;
      default: color = '#9e9e9e';
    }
    settingsStatusDot.style.background = color;
    settingsStatusText.style.color = color;
    settingsStatusText.textContent = s;

    if (s === 'connected') {
      connInfo.classList.remove('hidden');
      connMode.textContent = mode === 'station' ? 'Station' : mode === 'ap' ? 'AP Mode' : '\u2014';
      var host = location.hostname || '192.168.4.1';
      connUrl.textContent = 'ws://' + host + ':81/ws';
    } else {
      connInfo.classList.add('hidden');
    }

    updateAdcUI();
  }

  // ---- Hook into WS events ----
  PM.wsOn('status', updateSettingsStatus);
  PM.wsOn('calibrationStatus', function(status) {
    updateAdcUI();
  });
  PM.wsOn('calibrationComplete', function(data) {
    adcCalibration = data;
    PM.adcLut = PM.buildAdcLut(data);
    saveAdcCal();
    updateAdcUI();
  });
  PM.wsOn('adcCalibrationReceived', function(data) {
    // Hardcoded calibration from ESP32 - apply immediately
    adcCalibration = data;
    PM.adcLut = PM.buildAdcLut(data);
    updateAdcUI();
    console.log('[Settings] Applied hardcoded ADC calibration from ESP32');
  });

  // ---- Tab switching ----
  var tabs = document.querySelectorAll('.tab');
  var views = document.querySelectorAll('.view');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      tabs.forEach(function(t) { t.classList.remove('active'); });
      views.forEach(function(v) { v.classList.remove('active'); });
      tab.classList.add('active');
      var target = document.getElementById(tab.dataset.tab + '-view');
      if (target) target.classList.add('active');
    });
  });

  // ---- Init ----
  loadResistorCal();
  populateResistorInputs();
  updateVoltageRanges();
  loadAdcCal();
  updateAdcUI();
  updateSettingsStatus();

  // Connect WebSocket after all callbacks are registered
  PM.wsConnect();

})();
