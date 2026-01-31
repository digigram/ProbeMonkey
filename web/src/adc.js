// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — ADC LUT & voltage math
// (ported from ProbeMonkey/constants/scope.ts buildAdcLut)
// ---------------------------------------------------------------------------

(function() {
  /**
   * Build a Float32Array(4096) mapping raw ADC value -> corrected voltage (0-3.3V).
   * Uses 256-step DAC sweep calibration data when available, with binary search +
   * linear interpolation to invert the ADC transfer function.
   * Falls back to linear mapping when no calibration exists.
   */
  PM.buildAdcLut = function(cal) {
    var lut = new Float32Array(4096);
    if (!cal) {
      for (var i = 0; i < 4096; i++) {
        lut[i] = (i / PM.ADC_MAX) * PM.ADC_VREF;
      }
      return lut;
    }

    var adcReadings = cal.adcLut; // length 256
    var refMv = cal.refMv;        // length 256, or undefined

    function stepV(step) {
      if (refMv) return refMv[step] / 1000;
      return (step / 255) * PM.ADC_VREF;
    }

    for (var raw = 0; raw < 4096; raw++) {
      // Below lowest calibration point
      if (raw <= adcReadings[0]) {
        var v0 = stepV(0);
        var v1 = stepV(1);
        if (adcReadings[1] !== adcReadings[0]) {
          var slope = (v1 - v0) / (adcReadings[1] - adcReadings[0]);
          lut[raw] = Math.max(0, v0 + (raw - adcReadings[0]) * slope);
        } else {
          lut[raw] = Math.max(0, v0);
        }
        continue;
      }

      // Above highest calibration point
      if (raw >= adcReadings[255]) {
        lut[raw] = PM.ADC_VREF;
        continue;
      }

      // Binary search for interval [lo, hi] where adcReadings[lo] <= raw < adcReadings[hi]
      var lo = 0, hi = 255;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (adcReadings[mid] <= raw) lo = mid;
        else hi = mid;
      }

      var adcLo = adcReadings[lo];
      var adcHi = adcReadings[hi];
      var t = (adcHi !== adcLo) ? (raw - adcLo) / (adcHi - adcLo) : 0;
      var vLo = stepV(lo);
      var vHi = stepV(hi);
      lut[raw] = vLo + t * (vHi - vLo);
    }

    return lut;
  };

  /**
   * Convert a raw ADC sample to bipolar voltage using the LUT and divider ratio.
   */
  PM.sampleToVoltage = function(raw, adcLut, dividerRatio) {
    var adcV = adcLut[raw] || (raw / PM.ADC_MAX) * PM.ADC_VREF;
    return (adcV - PM.ADC_VREF / 2) * dividerRatio;
  };

  /**
   * Compute measurements from an array of samples.
   * Returns { min, max, periodMs, freqHz } or null fields if not computable.
   */
  PM.computeMeasurements = function(samples, sampleRate, adcLut, dividerRatio) {
    if (!samples || samples.length < 10 || sampleRate === 0) return null;

    var min = Infinity, max = -Infinity;
    var voltages = new Array(samples.length);
    var sum = 0;

    for (var i = 0; i < samples.length; i++) {
      var v = PM.sampleToVoltage(samples[i], adcLut, dividerRatio);
      voltages[i] = v;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    var result = { min: min, max: max, periodMs: null, freqHz: null };

    // Period via rising zero crossings of mean
    var mean = sum / samples.length;
    var crossings = [];
    for (var j = 1; j < voltages.length; j++) {
      if (voltages[j - 1] <= mean && voltages[j] > mean) {
        var frac = (mean - voltages[j - 1]) / (voltages[j] - voltages[j - 1]);
        crossings.push(j - 1 + frac);
      }
    }

    if (crossings.length >= 2) {
      var total = 0;
      for (var k = 1; k < crossings.length; k++) {
        total += crossings[k] - crossings[k - 1];
      }
      var avgPeriodSamples = total / (crossings.length - 1);
      result.periodMs = (avgPeriodSamples / sampleRate) * 1000;
      result.freqHz = 1000 / result.periodMs;
    }

    return result;
  };

  // Initialize default LUT
  PM.adcLut = PM.buildAdcLut(null);

})();
