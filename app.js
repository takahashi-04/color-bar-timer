'use strict';

/**
 * Color Bar Timer — external libraries are not required.
 * For accurate counting after a hidden tab or sleep, countdown is based on the
 * wall-clock deadline (Date.now()), NOT the number of setInterval callbacks.
 */
(() => {
  const BAR_COUNT = 30;
  const DEFAULT_MS = 30 * 60 * 1000;
  const SETTINGS_KEY = 'colorBarTimer.settings.v1';
  const SESSION_KEY = 'colorBarTimer.session.v1';
  const MAX_MS = ((99 * 3600) + (59 * 60) + 59) * 1000;
  const $ = (id) => document.getElementById(id);
  const els = {
    bars: $('bars'), timeDisplay: $('timeDisplay'), timeSubtext: $('timeSubtext'),
    statusText: $('statusText'), elapsedText: $('elapsedText'),
    barCountText: $('barCountText'), progressA11y: $('progressA11y'),
    form: $('durationForm'), hours: $('hoursInput'), minutes: $('minutesInput'),
    seconds: $('secondsInput'), error: $('inputError'),
    start: $('startButton'), startLabel: $('startLabel'), pause: $('pauseButton'),
    reset: $('resetButton'), presets: Array.from(document.querySelectorAll('.preset')),
    announcement: $('announcement')
  };

  const session = { status: 'idle', totalMs: DEFAULT_MS, remainingMs: DEFAULT_MS, deadline: null };
  let wakeLock = null;
  let previousDisplayedSecond = -1;
  let previousBars = -1;
  let previousStage = '';

  function safeJsonGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function safeJsonSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
  function isValidDuration(ms) { return Number.isSafeInteger(ms) && ms >= 1000 && ms <= MAX_MS; }
  function readInputs() {
    const fields = [els.hours, els.minutes, els.seconds];
    const maximums = [99, 59, 59];
    const values = fields.map((input) => {
      const raw = input.value.trim();
      if (raw === '' || !/^\d+$/.test(raw)) return NaN;
      return Number(raw);
    });
    if (values.some((value, index) => !Number.isSafeInteger(value) || value < 0 || value > maximums[index])) return null;
    const ms = (values[0] * 3600 + values[1] * 60 + values[2]) * 1000;
    return isValidDuration(ms) ? ms : null;
  }
  function writeInputs(ms) {
    const seconds = Math.round(ms / 1000);
    els.hours.value = String(Math.floor(seconds / 3600));
    els.minutes.value = String(Math.floor(seconds % 3600 / 60));
    els.seconds.value = String(seconds % 60);
  }
  function displayTime(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
  }
  function readableDuration(ms) {
    const sec = Math.round(ms / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return [h && `${h}時間`, m && `${m}分`, s && `${s}秒`].filter(Boolean).join('') || '0秒';
  }
  function elapsedFraction() {
    return clamp((session.totalMs - session.remainingMs) / session.totalMs, 0, 1);
  }
  function getStage(ratio) {
    if (ratio >= 0.75) return 'red';
    if (ratio >= 0.5) return 'yellow';
    if (ratio >= 0.25) return 'green';
    return 'blue';
  }
  function countBars(remaining, total) {
    // Exactly 1 bar disappears every total / 30 ms.
    // Using ceil prevents the very first bar from disappearing prematurely.
    return clamp(Math.ceil((remaining / total) * BAR_COUNT - 1e-10), 0, BAR_COUNT);
  }
  function persistSession() {
    safeJsonSet(SESSION_KEY, { ...session });
  }
  function updatePresetSelection() {
    const ms = readInputs();
    els.presets.forEach((button) => {
      const chosen = ms === Number(button.dataset.minutes) * 60000;
      button.classList.toggle('selected', chosen);
      button.setAttribute('aria-pressed', String(chosen));
    });
  }
  function setError(message = '') {
    els.error.hidden = !message;
    els.error.textContent = message;
    for (const input of [els.hours, els.minutes, els.seconds]) {
      input.setAttribute('aria-invalid', String(Boolean(message)));
    }
  }
  function render(force = false) {
    if (session.status === 'running') {
      const remaining = Math.max(0, session.deadline - Date.now());
      if (remaining <= 0) {
        session.remainingMs = 0;
        session.status = 'finished';
        session.deadline = null;
        persistSession();
        releaseWakeLock();
        els.announcement.textContent = '時間になりました。';
      } else {
        session.remainingMs = remaining;
      }
    }

    const progress = elapsedFraction();
    const stage = getStage(progress);
    const visibleBars = countBars(session.remainingMs, session.totalMs);
    const second = Math.ceil(session.remainingMs / 1000);

    if (stage !== previousStage || force) {
      const colors = { blue: '#3478f6', green: '#27a976', yellow: '#edb32d', red: '#ed575c' };
      document.documentElement.style.setProperty('--stage-color', colors[stage]);
      previousStage = stage;
    }
    if (visibleBars !== previousBars || force) {
      Array.from(els.bars.children).forEach((bar, index) => {
        bar.classList.toggle('is-gone', index >= visibleBars);
      });
      previousBars = visibleBars;
    }
    els.bars.classList.toggle('is-finished', session.status === 'finished');
    document.body.dataset.state = session.status;

    if (force || second !== previousDisplayedSecond) {
      els.timeDisplay.textContent = displayTime(session.remainingMs);
      els.timeDisplay.setAttribute('aria-label', `残り時間 ${readableDuration(session.remainingMs)}`);
      els.elapsedText.textContent = `経過 ${Math.floor(progress * 100)}%`;
      els.barCountText.textContent = `${visibleBars} / ${BAR_COUNT} 本`;
      els.progressA11y.setAttribute('aria-valuenow', String(Math.floor(progress * 100)));
      previousDisplayedSecond = second;
    }
    const stateLabels = { idle: '準備完了', running: '計測中', paused: '一時停止中', finished: '時間になりました' };
    els.statusText.textContent = stateLabels[session.status];
    els.timeSubtext.textContent = session.status === 'finished' ? 'お疲れさまでした！' : `${readableDuration(session.totalMs)}のタイマー`;
    els.start.disabled = session.status === 'running';
    els.startLabel.textContent = session.status === 'paused' ? '再開' : session.status === 'finished' ? 'もう一度' : 'スタート';
    els.pause.disabled = session.status !== 'running';
    const editable = session.status === 'idle';
    for (const input of [els.hours, els.minutes, els.seconds]) input.disabled = !editable;
    els.presets.forEach((preset) => { preset.disabled = !editable; });
  }
  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* unsupported or denied */ }
  }
  function releaseWakeLock() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }
  function begin() {
    if (session.status === 'running') return;
    if (session.status === 'idle' || session.status === 'finished') {
      const inputDuration = readInputs();
      if (!isValidDuration(inputDuration)) {
        setError('0秒より長い時間を設定してください（最大99時間59分59秒）。');
        return;
      }
      session.totalMs = inputDuration;
      session.remainingMs = inputDuration;
    }
    setError();
    session.deadline = Date.now() + session.remainingMs;
    session.status = 'running';
    persistSession();
    render(true);
    requestWakeLock();
    els.announcement.textContent = 'タイマーを開始しました。';
  }
  function pause() {
    if (session.status !== 'running') return;
    session.remainingMs = Math.max(0, session.deadline - Date.now());
    session.deadline = null;
    session.status = session.remainingMs === 0 ? 'finished' : 'paused';
    persistSession();
    releaseWakeLock();
    render(true);
    els.announcement.textContent = session.status === 'paused' ? 'タイマーを停止しました。' : '時間になりました。';
  }
  function reset() {
    if (session.status === 'idle') {
      const ms = readInputs();
      if (ms !== null) session.totalMs = ms;
    }
    session.status = 'idle';
    session.deadline = null;
    session.remainingMs = session.totalMs;
    writeInputs(session.totalMs);
    setError();
    previousDisplayedSecond = -1;
    previousBars = -1;
    persistSession();
    safeJsonSet(SETTINGS_KEY, { durationMs: session.totalMs });
    releaseWakeLock();
    updatePresetSelection();
    render(true);
    els.announcement.textContent = 'タイマーをリセットしました。';
  }
  function onDurationEdit() {
    setError();
    updatePresetSelection();
    if (session.status !== 'idle') return;
    const ms = readInputs();
    if (ms === null) return;
    session.totalMs = ms;
    session.remainingMs = ms;
    safeJsonSet(SETTINGS_KEY, { durationMs: ms });
    persistSession();
    previousDisplayedSecond = -1;
    render(true);
  }
  function restore() {
    const savedSettings = safeJsonGet(SETTINGS_KEY);
    const savedDuration = isValidDuration(savedSettings?.durationMs) ? savedSettings.durationMs : DEFAULT_MS;
    session.totalMs = savedDuration;
    session.remainingMs = savedDuration;
    const stored = safeJsonGet(SESSION_KEY);
    const validStatus = ['idle', 'running', 'paused', 'finished'].includes(stored?.status);
    if (validStatus && isValidDuration(stored.totalMs) &&
        Number.isFinite(stored.remainingMs) && stored.remainingMs >= 0 && stored.remainingMs <= stored.totalMs) {
      session.totalMs = stored.totalMs;
      session.remainingMs = stored.remainingMs;
      session.status = stored.status;
      if (session.status === 'running') {
        if (typeof stored.deadline === 'number' && Number.isFinite(stored.deadline)) session.deadline = stored.deadline;
        else session.status = 'paused';
      }
      if (session.status === 'finished') session.remainingMs = 0;
    }
    writeInputs(session.totalMs);
    updatePresetSelection();
  }

  // Create exactly 30 bars, including when the timer has finished.
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < BAR_COUNT; index++) {
    const bar = document.createElement('span');
    bar.className = 'bar';
    fragment.appendChild(bar);
  }
  els.bars.appendChild(fragment);
  restore();
  render(true);
  if (session.status === 'running') requestWakeLock();
  window.setInterval(() => render(), 200);
  els.form.addEventListener('submit', (event) => { event.preventDefault(); begin(); });
  els.pause.addEventListener('click', pause);
  els.reset.addEventListener('click', reset);
  for (const input of [els.hours, els.minutes, els.seconds]) input.addEventListener('input', onDurationEdit);
  for (const preset of els.presets) {
    preset.addEventListener('click', () => {
      if (session.status !== 'idle') return;
      writeInputs(Number(preset.dataset.minutes) * 60000);
      onDurationEdit();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      render(true);
      if (session.status === 'running') requestWakeLock();
    } else releaseWakeLock();
  });
  window.addEventListener('pageshow', () => render(true));
  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
        ['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (session.status === 'running') pause(); else begin();
    } else if (event.key.toLowerCase() === 'r') reset();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    });
  }
})();
