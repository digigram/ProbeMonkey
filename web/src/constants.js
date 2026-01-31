// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — Constants (ported from ProbeMonkey/constants/scope.ts)
// ---------------------------------------------------------------------------

var PM = window.PM || {};
window.PM = PM;

// ADC
PM.ADC_MAX = 4095;
PM.ADC_VREF = 3.3;
PM.ADC_MIDPOINT = 2048;

// Grid
PM.GRID_DIVISIONS_X = 10;
PM.GRID_DIVISIONS_Y = 8;

// Defaults
PM.DEFAULT_VOLTS_PER_DIV = 1.0;
PM.DEFAULT_MS_PER_DIV = 5.0;

// Nominal resistor values (ohms)
PM.NOMINAL_R2 = 9800;
PM.NOMINAL_R1 = {
  '3.3V': 9900,
  '5V':   21600,
  '18V':  97400,
  '38V':  222000,
  '79V':  468000,
};

PM.VOLTAGE_RANGE_KEYS = ['3.3V', '5V', '18V', '38V', '79V'];

// Slider steps
PM.VOLTS_PER_DIV_STEPS = {
  '3.3V': [0.1, 0.2, 0.5, 1.0],
  '5V':   [0.2, 0.5, 1.0, 2.0],
  '18V':  [0.5, 1.0, 2.0, 5.0],
  '38V':  [1.0, 2.0, 5.0, 10.0],
  '79V':  [2.0, 5.0, 10.0, 20.0],
};

PM.MS_PER_DIV_STEPS = [1, 2, 5, 10, 20, 50, 100];

PM.TEST_FREQ_OPTIONS = [60, 500, 1000, 2000, 5000];

// Helpers
PM.dividerRatio = function(r1, r2) {
  return (r1 + r2) / r2;
};

PM.buildVoltageRanges = function(cal) {
  var r2 = (cal && cal.r2 != null) ? cal.r2 : PM.NOMINAL_R2;
  var ranges = {};
  for (var i = 0; i < PM.VOLTAGE_RANGE_KEYS.length; i++) {
    var key = PM.VOLTAGE_RANGE_KEYS[i];
    var r1 = (cal && cal.r1[key] != null) ? cal.r1[key] : PM.NOMINAL_R1[key];
    var ratio = PM.dividerRatio(r1, r2);
    ranges[key] = {
      label: key,
      maxPeak: (PM.ADC_VREF / 2) * ratio,
      dividerRatio: ratio,
    };
  }
  return ranges;
};

PM.DEFAULT_CALIBRATION = {
  r2: null,
  r1: { '3.3V': null, '5V': null, '18V': null, '38V': null, '79V': null },
};

PM.voltageRanges = PM.buildVoltageRanges(PM.DEFAULT_CALIBRATION);

// Formatting helpers
PM.formatVoltage = function(v) {
  if (Math.abs(v) < 1 && v !== 0) return (v * 1000).toFixed(1) + 'mV';
  return v.toFixed(3) + 'V';
};

PM.formatTime = function(ms) {
  if (Math.abs(ms) < 1) return (ms * 1000).toFixed(1) + 'us';
  return ms.toFixed(2) + 'ms';
};

PM.formatFrequency = function(hz) {
  if (hz >= 1000) return (hz / 1000).toFixed(2) + 'kHz';
  return hz.toFixed(1) + 'Hz';
};
