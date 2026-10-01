/**
 * Replay player: walks a recording on a data-time cursor (pure logic, no I/O).
 *
 * - Display: the latest frame with t_s <= cursor drives the twin (sample-and-hold, no
 *   interpolation — interpolating would smooth sensor noise the AI's rolling-std features use).
 * - AI: every frame flagged ai_input is handed out exactly once, in order, so the AI scores the
 *   recorded stream at its recorded timestamps regardless of playback speed.
 * - A seek or a segment boundary means the AI and golden twin must start a fresh session.
 */
export const SPEEDS = [0.5, 1, 2, 5, 10];

export class ReplayPlayer {
  constructor(frames) {
    if (!frames.length) throw new Error('recording has no frames');
    this.frames = frames;
    this.endT = frames[frames.length - 1].t_s;
    this.speed = 1;
    this.playing = false;
    this._seekTo(0);
  }

  _seekTo(t) {
    this.cursor = Math.min(Math.max(0, t), this.endT);
    // next = first frame with t_s >= cursor (frames exactly at the cursor are still delivered)
    let lo = 0, hi = this.frames.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.frames[mid].t_s < this.cursor) lo = mid + 1; else hi = mid; }
    this.next = lo;
    this.aiSegment = undefined;   // the first AI frame after load/seek always starts a fresh session
  }

  play() { if (this.cursor >= this.endT) this._seekTo(0); this.playing = true; }
  pause() { this.playing = false; }
  setSpeed(s) { if (SPEEDS.includes(s)) this.speed = s; }
  get ended() { return this.cursor >= this.endT && this.next >= this.frames.length; }

  /** Jump to time t. The caller must reset the AI session and golden twin. */
  seek(t) { this._seekTo(t); return this.current(); }

  current() { return this.frames[Math.max(0, this.next - 1)]; }

  /**
   * Advance by wallDtS * speed (when playing and not held back by the AI queue).
   * Returns { frame, aiDue: [{frame, newSegment}], ended }.
   */
  tick(wallDtS, { hold = false } = {}) {
    const aiDue = [];
    if (this.playing && !hold) {
      const target = Math.min(this.endT, this.cursor + wallDtS * this.speed);
      while (this.next < this.frames.length && this.frames[this.next].t_s <= target) {
        const f = this.frames[this.next++];
        if (!f.ai_input) continue;
        aiDue.push({ frame: f, newSegment: f.segment !== this.aiSegment });
        this.aiSegment = f.segment;
      }
      this.cursor = target;
      if (this.ended) this.playing = false;
    }
    return { frame: this.current(), aiDue, ended: this.ended };
  }
}
