/* Side-specific looping fife-and-drum via <audio> (file:// safe). */
(function (global) {
  'use strict';

  const TRACKS = {
    union: 'assets/music/union_yankee_doodle_fife_drum.wav',
    csa: 'assets/music/csa_dixie_fife_drum.wav',
  };

  let started = false;
  let muted = false;
  let side = 'union';

  function el() {
    return document.getElementById('bgMusic');
  }

  function syncBtn() {
    const b = document.getElementById('btnMute');
    if (b) b.textContent = muted ? 'Unmute (M)' : 'Mute (M)';
  }

  function setTrack(nextSide) {
    side = nextSide === 'csa' ? 'csa' : 'union';
    const a = el();
    if (!a) return;
    const src = TRACKS[side];
    // Avoid reload if already correct
    const abs = new URL(src, window.location.href).href;
    if (!a.src || a.src !== abs) {
      const wasPlaying = !a.paused && started;
      a.src = src;
      a.loop = true;
      a.load();
      if (wasPlaying && !muted) {
        const p = a.play();
        if (p && p.then) p.catch(() => {});
      }
    }
  }

  function start(forSide) {
    if (forSide) setTrack(forSide);
    else setTrack(side);
    const a = el();
    if (!a) return;
    a.muted = muted;
    a.volume = muted ? 0 : 0.45;
    const p = a.play();
    if (p && p.then) p.catch(() => {});
    started = true;
    syncBtn();
  }

  function toggleMute() {
    muted = !muted;
    const a = el();
    if (a) {
      a.muted = muted;
      a.volume = muted ? 0 : 0.45;
      if (!muted && started) {
        const p = a.play();
        if (p && p.then) p.catch(() => {});
      }
    }
    syncBtn();
    return muted;
  }

  function bind() {
    const b = document.getElementById('btnMute');
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) toggleMute();
    });
  }

  global.RTSMusic = {
    TRACKS,
    start,
    setTrack,
    toggleMute,
    bind,
    get muted() { return muted; },
    get started() { return started; },
    get side() { return side; },
  };
})(window);
