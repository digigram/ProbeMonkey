// ---------------------------------------------------------------------------
// ProbeMonkey Web UI — Scope screen
// (ported from ProbeMonkey/app/(tabs)/index.tsx + WaveformCanvas.tsx)
// ---------------------------------------------------------------------------

(function() {
  // DOM elements
  var canvas = document.getElementById('scope-canvas');
  var ctx = canvas.getContext('2d');
  var wrapper = document.getElementById('canvas-wrapper');
  var freezeBtn = document.getElementById('freeze-btn');
  var statusDot = document.getElementById('status-dot');
  var statusLabel = document.getElementById('status-label');
  var measureOverlay = document.getElementById('measure-overlay');
  var measureMin = document.getElementById('measure-min');
  var measureMax = document.getElementById('measure-max');
  var measurePeriod = document.getElementById('measure-period');
  var measureFreq = document.getElementById('measure-freq');

  var vdivSlider = document.getElementById('vdiv-slider');
  var vdivValue = document.getElementById('vdiv-value');
  var msdivSlider = document.getElementById('msdiv-slider');
  var msdivValue = document.getElementById('msdiv-value');
  var offsetRow = document.getElementById('offset-row');
  var offsetSlider = document.getElementById('offset-slider');
  var offsetValue = document.getElementById('offset-value');

  var testSignalRow = document.getElementById('test-signal-row');
  var testToggleBtn = document.getElementById('test-toggle-btn');
  var testWaveBtn = document.getElementById('test-wave-btn');
  var testFreqBtn = document.getElementById('test-freq-btn');

  var rangeBtns = document.querySelectorAll('.range-btn');

  // State
  var currentRange = '3.3V';
  var voltsPerDiv = PM.VOLTS_PER_DIV_STEPS['3.3V'][2]; // 0.5
  var msPerDiv = PM.MS_PER_DIV_STEPS[3]; // 10

  var frozen = false;
  var frozenData = null; // { samples, sampleRate }
  var crosshairX = null;
  var sampleOffset = 0;

  var canvasW = 300, canvasH = 200;
  var dpr = window.devicePixelRatio || 1;

  // Colors
  var BG_COLOR = '#0a0a0a';
  var GRID_COLOR = '#333333';
  var CENTER_COLOR = '#555555';
  var WAVE_COLOR = '#00ff00';
  var CROSSHAIR_COLOR = '#ffff00';

  // ---- Canvas sizing ----
  function resizeCanvas() {
    var rect = wrapper.getBoundingClientRect();
    canvasW = rect.width;
    canvasH = rect.height;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', resizeCanvas);
  // Initial size after DOM ready
  setTimeout(resizeCanvas, 0);

  // ---- Grid drawing ----
  function drawGrid() {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    for (var i = 0; i <= PM.GRID_DIVISIONS_X; i++) {
      var x = (i / PM.GRID_DIVISIONS_X) * canvasW;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasH); ctx.stroke();
    }
    for (var j = 0; j <= PM.GRID_DIVISIONS_Y; j++) {
      var y = (j / PM.GRID_DIVISIONS_Y) * canvasH;
      var isCenter = (j === PM.GRID_DIVISIONS_Y / 2);
      ctx.strokeStyle = isCenter ? CENTER_COLOR : GRID_COLOR;
      ctx.lineWidth = isCenter ? 1.5 : 1;
      if (isCenter) ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasW, y); ctx.stroke();
      if (isCenter) ctx.setLineDash([4, 4]);
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
    }
    ctx.setLineDash([]);
  }

  // ---- Waveform drawing ----
  function drawWaveform(samples, sampleRate) {
    if (!samples || samples.length === 0 || sampleRate === 0) return;

    var range = PM.voltageRanges[currentRange];
    var totalTimeMs = msPerDiv * PM.GRID_DIVISIONS_X;
    var totalVRange = voltsPerDiv * PM.GRID_DIVISIONS_Y;
    var midY = canvasH / 2;
    var visibleSamples = Math.min(
      Math.floor((totalTimeMs / 1000) * sampleRate),
      Math.max(0, samples.length - sampleOffset)
    );
    if (visibleSamples <= 0) return;

    ctx.strokeStyle = WAVE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (var i = 0; i < visibleSamples; i++) {
      var idx = sampleOffset + i;
      if (idx >= samples.length) break;
      var x = (i / visibleSamples) * canvasW;
      var adcV = PM.adcLut[samples[idx]] || (samples[idx] / PM.ADC_MAX) * PM.ADC_VREF;
      var voltage = (adcV - PM.ADC_VREF / 2) * range.dividerRatio;
      var y = midY - (voltage / totalVRange) * canvasH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ---- Crosshair drawing ----
  function drawCrosshair(samples, sampleRate) {
    if (crosshairX == null || !samples || samples.length === 0 || sampleRate === 0) return;

    var range = PM.voltageRanges[currentRange];
    var totalTimeMs = msPerDiv * PM.GRID_DIVISIONS_X;
    var totalVRange = voltsPerDiv * PM.GRID_DIVISIONS_Y;
    var midY = canvasH / 2;
    var visibleSamples = Math.min(
      Math.floor((totalTimeMs / 1000) * sampleRate),
      Math.max(0, samples.length - sampleOffset)
    );
    if (visibleSamples <= 0) return;

    var clampedX = Math.max(0, Math.min(canvasW, crosshairX));
    var idx = Math.round((clampedX / canvasW) * (visibleSamples - 1)) + sampleOffset;
    if (idx < 0 || idx >= samples.length) return;

    var timeMs = ((idx - sampleOffset) / sampleRate) * 1000;
    var adcV = PM.adcLut[samples[idx]] || (samples[idx] / PM.ADC_MAX) * PM.ADC_VREF;
    var voltage = (adcV - PM.ADC_VREF / 2) * range.dividerRatio;
    var pixelY = Math.max(0, Math.min(canvasH, midY - (voltage / totalVRange) * canvasH));

    // Dashed lines
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(clampedX, 0); ctx.lineTo(clampedX, canvasH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, pixelY); ctx.lineTo(canvasW, pixelY); ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    ctx.fillStyle = CROSSHAIR_COLOR;
    ctx.beginPath(); ctx.arc(clampedX, pixelY, 4, 0, Math.PI * 2); ctx.fill();

    // Readout box (top-left)
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    var bx = 6, by = 6, bw = 140, bh = 36, br = 4;
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + bw - br, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + br, br);
    ctx.lineTo(bx + bw, by + bh - br);
    ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
    ctx.lineTo(bx + br, by + bh);
    ctx.arcTo(bx, by + bh, bx, by + bh - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = CROSSHAIR_COLOR;
    ctx.font = '12px monospace';
    ctx.fillText('T: ' + PM.formatTime(timeMs), 12, 22);
    ctx.fillText('V: ' + PM.formatVoltage(voltage), 12, 36);
  }

  // ---- Main render ----
  function render() {
    var samples, sampleRate;
    if (frozen && frozenData) {
      samples = frozenData.samples;
      sampleRate = frozenData.sampleRate;
    } else {
      samples = PM.ws.samples;
      sampleRate = PM.ws.sampleRate;
    }

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasW, canvasH);

    drawGrid();
    drawWaveform(samples, sampleRate);
    if (frozen) drawCrosshair(samples, sampleRate);
  }

  // ---- Animation loop ----
  var lastRenderTime = 0;
  var FRAME_INTERVAL = 1000 / 30;

  function animLoop(timestamp) {
    if (timestamp - lastRenderTime >= FRAME_INTERVAL) {
      lastRenderTime = timestamp;
      render();
    }
    requestAnimationFrame(animLoop);
  }
  requestAnimationFrame(animLoop);

  // ---- Freeze toggle ----
  freezeBtn.addEventListener('click', function() {
    if (!frozen) {
      frozenData = {
        samples: PM.ws.samples.slice(),
        sampleRate: PM.ws.sampleRate,
      };
      sampleOffset = 0;
      crosshairX = null;
      frozen = true;
      freezeBtn.textContent = 'FROZEN';
      freezeBtn.classList.add('frozen');
      updateOffsetSlider();
      updateMeasurements();
    } else {
      frozen = false;
      frozenData = null;
      crosshairX = null;
      sampleOffset = 0;
      freezeBtn.textContent = 'LIVE';
      freezeBtn.classList.remove('frozen');
      offsetRow.classList.add('hidden');
      measureOverlay.classList.add('hidden');
    }
  });

  // ---- Pointer events for crosshair ----
  canvas.addEventListener('pointerdown', function(e) {
    if (!frozen) return;
    var rect = canvas.getBoundingClientRect();
    crosshairX = e.clientX - rect.left;
  });
  canvas.addEventListener('pointermove', function(e) {
    if (!frozen || e.buttons === 0) return;
    var rect = canvas.getBoundingClientRect();
    crosshairX = e.clientX - rect.left;
  });

  // ---- Range selector ----
  rangeBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      currentRange = btn.dataset.range;
      rangeBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      // Reset V/div to middle step
      var steps = PM.VOLTS_PER_DIV_STEPS[currentRange];
      var midIdx = Math.floor(steps.length / 2);
      voltsPerDiv = steps[midIdx];
      vdivSlider.max = steps.length - 1;
      vdivSlider.value = midIdx;
      vdivValue.textContent = voltsPerDiv + 'V';
      if (frozen) updateMeasurements();
    });
  });

  // ---- V/div slider ----
  vdivSlider.addEventListener('input', function() {
    var steps = PM.VOLTS_PER_DIV_STEPS[currentRange];
    var idx = Math.round(parseFloat(vdivSlider.value));
    voltsPerDiv = steps[idx];
    vdivValue.textContent = voltsPerDiv + 'V';
  });

  // ---- ms/div slider ----
  msdivSlider.addEventListener('input', function() {
    var idx = Math.round(parseFloat(msdivSlider.value));
    msPerDiv = PM.MS_PER_DIV_STEPS[idx];
    msdivValue.textContent = msPerDiv + 'ms';
    if (frozen) updateOffsetSlider();
  });

  // ---- Time offset slider ----
  offsetSlider.addEventListener('input', function() {
    sampleOffset = Math.round(parseFloat(offsetSlider.value));
    var activeSR = (frozen && frozenData) ? frozenData.sampleRate : PM.ws.sampleRate;
    offsetValue.textContent = ((sampleOffset / activeSR) * 1000).toFixed(1) + 'ms';
  });

  function updateOffsetSlider() {
    if (!frozen || !frozenData) {
      offsetRow.classList.add('hidden');
      return;
    }
    var activeSR = frozenData.sampleRate;
    var totalTimeMs = msPerDiv * PM.GRID_DIVISIONS_X;
    var desiredVisible = Math.floor((totalTimeMs / 1000) * activeSR);
    var maxOffset = Math.max(0, frozenData.samples.length - desiredVisible);
    if (maxOffset <= 0) {
      offsetRow.classList.add('hidden');
      sampleOffset = 0;
      return;
    }
    offsetSlider.max = maxOffset;
    if (sampleOffset > maxOffset) sampleOffset = maxOffset;
    offsetSlider.value = sampleOffset;
    offsetValue.textContent = ((sampleOffset / activeSR) * 1000).toFixed(1) + 'ms';
    offsetRow.classList.remove('hidden');
  }

  // ---- Measurements ----
  function updateMeasurements() {
    if (!frozen || !frozenData) {
      measureOverlay.classList.add('hidden');
      return;
    }
    var range = PM.voltageRanges[currentRange];
    var m = PM.computeMeasurements(frozenData.samples, frozenData.sampleRate, PM.adcLut, range.dividerRatio);
    if (!m) {
      measureOverlay.classList.add('hidden');
      return;
    }
    measureMin.textContent = 'Min: ' + PM.formatVoltage(m.min);
    measureMax.textContent = 'Max: ' + PM.formatVoltage(m.max);
    measurePeriod.textContent = m.periodMs != null ? 'Per: ' + PM.formatTime(m.periodMs) : '';
    measureFreq.textContent = m.freqHz != null ? 'Freq: ' + PM.formatFrequency(m.freqHz) : '';
    measureOverlay.classList.remove('hidden');
  }

  // ---- Test signal controls ----
  testToggleBtn.addEventListener('click', function() {
    PM.wsSendCommand({ cmd: 'testSignal', enabled: !PM.ws.testSignal.enabled });
  });
  testWaveBtn.addEventListener('click', function() {
    var next = PM.ws.testSignal.wave === 'square' ? 'sine' : 'square';
    PM.wsSendCommand({ cmd: 'testSignal', wave: next });
  });
  testFreqBtn.addEventListener('click', function() {
    var opts = PM.TEST_FREQ_OPTIONS;
    var idx = opts.indexOf(PM.ws.testSignal.freq);
    var next = opts[(idx + 1) % opts.length];
    PM.wsSendCommand({ cmd: 'testSignal', freq: next });
  });

  function updateTestSignalUI() {
    var ts = PM.ws.testSignal;
    var isConnected = PM.ws.status === 'connected' && PM.ws.connectionMode != null;

    if (isConnected) {
      testSignalRow.classList.remove('hidden');
    } else {
      testSignalRow.classList.add('hidden');
      return;
    }

    if (ts.enabled) {
      testToggleBtn.classList.add('active');
      testWaveBtn.classList.remove('hidden');
      testFreqBtn.classList.remove('hidden');
      testWaveBtn.textContent = ts.wave;
      testFreqBtn.textContent = ts.freq >= 1000 ? (ts.freq / 1000) + 'kHz' : ts.freq + 'Hz';
    } else {
      testToggleBtn.classList.remove('active');
      testWaveBtn.classList.add('hidden');
      testFreqBtn.classList.add('hidden');
    }
  }

  // ---- Status updates ----
  function updateStatusUI() {
    var s = PM.ws.status;
    var mode = PM.ws.connectionMode;
    var color;
    switch (s) {
      case 'connected': color = '#4caf50'; break;
      case 'connecting': color = '#ff9800'; break;
      case 'error': color = '#f44336'; break;
      default: color = '#9e9e9e';
    }
    statusDot.style.background = color;
    statusLabel.style.color = color;

    var label;
    if (mode === 'station') label = 'Station - probemonkey.local';
    else if (mode === 'ap') label = 'AP - 192.168.4.1';
    else if (s === 'connecting') label = 'connecting...';
    else label = s;
    statusLabel.textContent = label;
  }

  // Hook into WebSocket events
  PM.wsOn('status', function() {
    updateStatusUI();
    updateTestSignalUI();
  });
  PM.wsOn('testSignal', updateTestSignalUI);

  // Initialize slider state
  (function initSliders() {
    var vSteps = PM.VOLTS_PER_DIV_STEPS[currentRange];
    vdivSlider.max = vSteps.length - 1;
    var vIdx = vSteps.indexOf(voltsPerDiv);
    vdivSlider.value = vIdx >= 0 ? vIdx : 2;
    vdivValue.textContent = voltsPerDiv + 'V';

    msdivSlider.max = PM.MS_PER_DIV_STEPS.length - 1;
    var mIdx = PM.MS_PER_DIV_STEPS.indexOf(msPerDiv);
    msdivSlider.value = mIdx >= 0 ? mIdx : 3;
    msdivValue.textContent = msPerDiv + 'ms';
  })();

  // Initial status
  updateStatusUI();

})();
