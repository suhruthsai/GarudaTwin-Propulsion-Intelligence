/**
 * GarudaTwin MALE UAV - Mission Replay Engine
 * High-precision variable speed VCR time-travel driver
 * Synchronizes 3D CAD Blueprint, Gauges, Prognostics, and RL Map.
 */

export class ReplayEngine {
  constructor() {
    this.sortie = null;
    this.frames = [];
    this.currentIndex = 0;
    this.currentTimeMs = 0;
    this.startTimeMs = 0;
    this.endTimeMs = 0;
    this.playbackRate = 1.0;
    this.isPlaying = false;
    this.isLooping = false;
    this.loopA = null;
    this.loopB = null;
    this.rafId = null;
    this.lastWallTime = null;
    this.listeners = new Set();
  }

  /**
   * Load a flight mission sortie for playback
   */
  loadSortie(sortie) {
    this.pause();
    this.sortie = sortie;
    this.frames = sortie?.frames || [];
    if (this.frames.length > 0) {
      this.startTimeMs = this.frames[0].timestamp;
      this.endTimeMs = this.frames[this.frames.length - 1].timestamp;
      this.currentTimeMs = this.startTimeMs;
      this.currentIndex = 0;
      this.loopA = null;
      this.loopB = null;
    } else {
      this.startTimeMs = 0;
      this.endTimeMs = 0;
      this.currentTimeMs = 0;
      this.currentIndex = 0;
    }
    this._broadcastFrame();
    this._notifyListeners({ type: 'SORTIE_LOADED', sortie });
  }

  play() {
    if (this.isPlaying || this.frames.length === 0) return;
    // If at end, loop back to beginning
    if (this.currentTimeMs >= this.endTimeMs) {
      this.currentTimeMs = this.startTimeMs;
      this.currentIndex = 0;
    }
    this.isPlaying = true;
    this.lastWallTime = performance.now();
    this._tick();
    this._notifyListeners({ type: 'PLAY_STATE_CHANGED', isPlaying: true });
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastWallTime = null;
    this._notifyListeners({ type: 'PLAY_STATE_CHANGED', isPlaying: false });
  }

  togglePlayPause() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  setPlaybackRate(rate) {
    this.playbackRate = Math.max(0.1, Math.min(60.0, rate));
    this._notifyListeners({ type: 'RATE_CHANGED', rate: this.playbackRate });
  }

  /**
   * Seek to specific timestamp in milliseconds
   */
  seekToTime(targetTimeMs) {
    if (this.frames.length === 0) return;
    const clampedTime = Math.max(this.startTimeMs, Math.min(this.endTimeMs, targetTimeMs));
    this.currentTimeMs = clampedTime;
    this.currentIndex = this._findFrameIndex(clampedTime);
    this._broadcastFrame();
  }

  /**
   * Seek to percentage of total mission duration (0.0 to 1.0)
   */
  seekToRatio(ratio) {
    if (this.frames.length === 0) return;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const targetTime = this.startTimeMs + clampedRatio * (this.endTimeMs - this.startTimeMs);
    this.seekToTime(targetTime);
  }

  /**
   * Step forward or backward by single frame
   */
  stepFrame(direction = 1) {
    if (this.frames.length === 0) return;
    this.pause();
    const newIndex = Math.max(0, Math.min(this.frames.length - 1, this.currentIndex + direction));
    this.currentIndex = newIndex;
    this.currentTimeMs = this.frames[newIndex].timestamp;
    this._broadcastFrame();
  }

  /**
   * Set A-B Loop boundaries
   */
  setLoopPoints(aTimeMs, bTimeMs) {
    if (aTimeMs != null && bTimeMs != null && bTimeMs > aTimeMs) {
      this.loopA = aTimeMs;
      this.loopB = bTimeMs;
      this.isLooping = true;
    } else {
      this.loopA = null;
      this.loopB = null;
      this.isLooping = false;
    }
    this._notifyListeners({ type: 'LOOP_CHANGED', isLooping: this.isLooping, loopA: this.loopA, loopB: this.loopB });
  }

  clearLoop() {
    this.setLoopPoints(null, null);
  }

  /**
   * Main RAF tick loop with microsecond accuracy
   */
  _tick = () => {
    if (!this.isPlaying) return;

    const now = performance.now();
    const deltaWallMs = this.lastWallTime ? (now - this.lastWallTime) : 16.6;
    this.lastWallTime = now;

    const deltaSimMs = deltaWallMs * this.playbackRate;
    let nextTimeMs = this.currentTimeMs + deltaSimMs;

    // Handle A-B loop
    if (this.isLooping && this.loopA != null && this.loopB != null) {
      if (nextTimeMs >= this.loopB) {
        nextTimeMs = this.loopA;
      }
    } else if (nextTimeMs >= this.endTimeMs) {
      nextTimeMs = this.endTimeMs;
      this.currentTimeMs = nextTimeMs;
      this.currentIndex = this.frames.length - 1;
      this._broadcastFrame();
      this.pause();
      return;
    }

    this.currentTimeMs = nextTimeMs;
    this.currentIndex = this._findFrameIndex(nextTimeMs);
    this._broadcastFrame();

    this.rafId = requestAnimationFrame(this._tick);
  };

  /**
   * Binary search for closest frame index at or preceding target time
   */
  _findFrameIndex(targetTimeMs) {
    let low = 0;
    let high = this.frames.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const time = this.frames[mid].timestamp;

      if (time === targetTimeMs) return mid;
      if (time < targetTimeMs) low = mid + 1;
      else high = mid - 1;
    }

    return Math.max(0, Math.min(this.frames.length - 1, high));
  }

  /**
   * Interpolate between frames for sub-millisecond precision rendering
   */
  getCurrentInterpolatedFrame() {
    if (this.frames.length === 0) return null;
    const k = this.currentIndex;
    const f0 = this.frames[k];
    const f1 = this.frames[Math.min(this.frames.length - 1, k + 1)];

    if (f0 === f1 || f1.timestamp === f0.timestamp) return f0;

    const alpha = Math.max(0, Math.min(1, (this.currentTimeMs - f0.timestamp) / (f1.timestamp - f0.timestamp)));

    // Smoothly interpolate analog gauges and position
    return {
      ...f0,
      timestamp: this.currentTimeMs,
      mission: {
        ...f0.mission,
        altitudeFt: Math.round(f0.mission.altitudeFt + alpha * (f1.mission.altitudeFt - f0.mission.altitudeFt)),
        airspeedKts: Math.round(f0.mission.airspeedKts + alpha * (f1.mission.airspeedKts - f0.mission.airspeedKts)),
        lat: Number((f0.mission.lat + alpha * (f1.mission.lat - f0.mission.lat)).toFixed(4)),
        lng: Number((f0.mission.lng + alpha * (f1.mission.lng - f0.mission.lng)).toFixed(4))
      },
      engine: {
        ...f0.engine,
        rpm: Math.round(f0.engine.rpm + alpha * (f1.engine.rpm - f0.engine.rpm)),
        throttlePct: Number((f0.engine.throttlePct + alpha * (f1.engine.throttlePct - f0.engine.throttlePct)).toFixed(1)),
        egt: f0.engine.egt.map((val, idx) => Number((val + alpha * (f1.engine.egt[idx] - val)).toFixed(1))),
        cht: f0.engine.cht.map((val, idx) => Number((val + alpha * (f1.engine.cht[idx] - val)).toFixed(1))),
        mapBar: Number((f0.engine.mapBar + alpha * (f1.engine.mapBar - f0.engine.mapBar)).toFixed(3)),
        oilPressBar: Number((f0.engine.oilPressBar + alpha * (f1.engine.oilPressBar - f0.engine.oilPressBar)).toFixed(2)),
        oilTempC: Number((f0.engine.oilTempC + alpha * (f1.engine.oilTempC - f0.engine.oilTempC)).toFixed(1)),
        vibrationGrms: Number((f0.engine.vibrationGrms + alpha * (f1.engine.vibrationGrms - f0.engine.vibrationGrms)).toFixed(3))
      },
      health: {
        ...f0.health,
        index: Number((f0.health.index + alpha * (f1.health.index - f0.health.index)).toFixed(1))
      }
    };
  }

  _broadcastFrame() {
    const frame = this.getCurrentInterpolatedFrame();
    if (!frame) return;
    this._notifyListeners({
      type: 'FRAME_UPDATE',
      frame,
      currentTimeMs: this.currentTimeMs,
      progressRatio: (this.endTimeMs > this.startTimeMs) ? (this.currentTimeMs - this.startTimeMs) / (this.endTimeMs - this.startTimeMs) : 0,
      currentIndex: this.currentIndex,
      totalFrames: this.frames.length
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notifyListeners(data) {
    this.listeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error(e); }
    });
  }
}

export const globalReplayEngine = new ReplayEngine();
