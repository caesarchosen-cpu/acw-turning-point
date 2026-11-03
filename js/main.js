/* Boot: level + side select, Start button launches; expose window.__RTS__ */
(function () {
  'use strict';

  let selectedDay = 1;
  let selectedSide = 'union';
  let game = null;
  let bootError = null;

  function highlightDay(day) {
    selectedDay = (day === 2 || day === 3) ? day : 1;
    document.querySelectorAll('.levelBtn').forEach((btn) => {
      const d = parseInt(btn.getAttribute('data-day'), 10);
      if (btn.disabled) return;
      btn.style.outline = d === selectedDay ? '2px solid #c4a35a' : '';
      btn.style.outlineOffset = d === selectedDay ? '3px' : '';
    });
  }

  function highlightSide(side) {
    selectedSide = side === 'csa' ? 'csa' : 'union';
    const bu = document.getElementById('btnUnion');
    const bc = document.getElementById('btnCsa');
    if (bu) {
      bu.style.outline = selectedSide === 'union' ? '2px solid #c4a35a' : '';
      bu.style.outlineOffset = selectedSide === 'union' ? '3px' : '';
    }
    if (bc) {
      bc.style.outline = selectedSide === 'csa' ? '2px solid #c4a35a' : '';
      bc.style.outlineOffset = selectedSide === 'csa' ? '3px' : '';
    }
  }

  function startSide(side) {
    if (!game) {
      console.error('[RTS] Start ignored — game failed to boot:', bootError);
      const btn = document.getElementById('btnStart');
      if (btn) btn.textContent = 'Load failed — reload';
      return false;
    }
    const s = side === 'csa' ? 'csa' : 'union';
    selectedSide = s;
    try {
      // Start battle FIRST so music/voice failures cannot block launch
      game.start(s, selectedDay);
      try { if (window.RTSMusic) RTSMusic.start(s); } catch (err) { console.warn('[RTS] music', err); }
      try { if (window.RTSVoice) RTSVoice.briefingStart(s, selectedDay); } catch (err) { console.warn('[RTS] voice', err); }
      // Hide touch HUD chrome was already under menu; ensure menu gone
      return true;
    } catch (err) {
      console.error('[RTS] start failed', err);
      return false;
    }
  }

  let lastStartAt = 0;
  function startSelected(ev) {
    if (ev) {
      try { ev.preventDefault(); ev.stopPropagation(); } catch (_) {}
    }
    const now = Date.now();
    if (now - lastStartAt < 450) return false; // debounce click+touchend
    lastStartAt = now;
    return startSide(selectedSide);
  }

  // Global entry used by inline onclick (survives if addEventListener wiring races)
  window.__acwStart = startSelected;

  // Boot game engine
  try {
    const container = document.getElementById('game');
    if (!container) throw new Error('#game missing');
    if (!window.RTSGame || !RTSGame.createGame) throw new Error('RTSGame not loaded');
    game = RTSGame.createGame(container);
  } catch (err) {
    bootError = err;
    console.error('[RTS] boot failed', err);
  }

  try { if (window.RTSMusic) RTSMusic.bind(); } catch (_) {}
  try { if (window.RTSVoice) RTSVoice.bind(); } catch (_) {}
  const bv = document.getElementById('btnVoiceMute');
  if (bv) bv.addEventListener('click', (e) => { e.stopPropagation(); try { RTSVoice.toggleVoiceMute(); } catch (_) {} });

  const day1 = document.getElementById('btnDay1');
  const day2 = document.getElementById('btnDay2');
  const day3 = document.getElementById('btnDay3');
  if (day1) day1.addEventListener('click', () => highlightDay(1));
  if (day2) day2.addEventListener('click', () => highlightDay(2));
  if (day3) day3.addEventListener('click', () => highlightDay(3));

  // Side buttons select only — Start launches
  const bu = document.getElementById('btnUnion');
  const bc = document.getElementById('btnCsa');
  if (bu) bu.addEventListener('click', () => highlightSide('union'));
  if (bc) bc.addEventListener('click', () => highlightSide('csa'));

  function bindStart(el) {
    if (!el || el.dataset.acwBound === '1') return;
    el.dataset.acwBound = '1';
    const go = (e) => { startSelected(e); };
    el.addEventListener('click', go);
    el.addEventListener('pointerup', (e) => {
      // Primary pointer only; avoid duplicate with click on desktop
      if (e.pointerType === 'touch' || e.pointerType === 'pen') go(e);
    });
    el.addEventListener('touchend', (e) => {
      // iOS Safari fallback if click is suppressed
      if (e.cancelable) e.preventDefault();
      go(e);
    }, { passive: false });
  }

  const btnStart = document.getElementById('btnStart');
  bindStart(btnStart);

  window.addEventListener('keydown', (e) => {
    if (game && game.running) {
      if (e.code === 'Space' && game.barrageActive) {
        e.preventDefault();
        game.skipBarrage();
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      startSelected(e);
    }
  });
  const skipBtn = document.getElementById('btnSkipBarrage');
  if (skipBtn) skipBtn.addEventListener('click', () => { if (game && game.skipBarrage) game.skipBarrage(); });

  highlightDay(1);
  highlightSide('union');
  if (btnStart) {
    try { btnStart.focus(); } catch (_) {}
    if (bootError) btnStart.textContent = 'Reload (boot error)';
  }

  // Hide on-screen touch chrome while the start menu is up (prevents pad stealing taps)
  try {
    const style = document.createElement('style');
    style.textContent = 'body.touch-ui #menu:not(.hidden) ~ #touchHUD{display:none!important}';
    document.head.appendChild(style);
  } catch (_) {}

  window.__RTS__ = {
    auditFacing: () => game && game.auditFacing && game.auditFacing(),
    facingAudit: () => game && game.facingAudit && game.facingAudit(),
    forceCasualty(killed) {
      if (!game) return null;
      const list = game.units || [];
      const side = game.playerSide;
      const u = (game.selected && game.selected[0]) || list.find((x) => x.alive && x.team === side);
      if (!u || !game.casualtySys) return null;
      return game.casualtySys.hitFigure(u, { killed: !!killed, selected: game.selected });
    },
    music: () => window.RTSMusic,
    voice: () => window.RTSVoice,
    game,
    start: startSide,
    setDay: highlightDay,
    getDay: () => selectedDay,
    setSide: highlightSide,
    getSide: () => selectedSide,
    units: () => (game ? game.units : []),
    selected: () => (game ? game.selected : []),
    side: () => (game ? game.playerSide : selectedSide),
    day: () => (game ? game.day : selectedDay),
    TYPE: () => RTSUnits.TYPE,
    dps: (t) => RTSUnits.dpsOf(RTSUnits.TYPE[t]),
    dismountedCav: () => RTSUnits.dismountedCavalryStats(),
    logistics: () => window.RTSLogistics,
    wagons: () => (game ? game.wagons : []),
    depots: () => (game ? game.depots : []),
    cavalryWeaponAt: (u, d) => RTSUnits.cavalryWeaponAt(u, d),
    measureSpacing: (u) => RTSUnits.measureSpacing(u),
    fireAtWill: () => game && game.fireAtWill,
    commence: () => game && game.commenceFiringSelection(),
    fireDirect: (u) => game && game.fireUnitDirect(u),
    toggleMount: () => game && game.toggleMountSelected(),
    toggleSkirmish: () => game && game.toggleSkirmishSelected(),
    toggleFireMode: () => game && game.toggleFireMode(),
    cameraState: () => game && game.cameraState,
    objectives: RTSHUD.OBJECTIVES,
    selectByType(type) {
      const list = game.units.filter((u) => u.alive && u.team === game.playerSide && u.type === type);
      game.selectUnits(list, false);
      return list.length;
    },
    selectAllPlayer() {
      const list = game.units.filter((u) => u.alive && u.team === game.playerSide);
      game.selectUnits(list, false);
      return list.length;
    },
    moveSelectedTo(x, z) {
      game.issueMove({ x, z, y: 0 });
    },
    buildWallAt(x, z) {
      const eng = game.selected.filter((u) => u.type === 'engineer');
      if (!eng.length) {
        game.selectUnits(
          game.units.filter((u) => u.alive && u.team === game.playerSide && u.type === 'engineer'),
          false
        );
      }
      game.setBuildMode(true);
      game.issueBuild({ x, z, y: 0 });
    },
    forceHoldObjectives(n) {
      if (game.objectives) RTSObjectives.debugHoldThrough(game.objectives, n);
      RTSHUD.updateObjectiveProgress(RTSObjectives.getHud(game.objectives));
    },
    captureActive() {
      const o = game.objectives;
      if (!o) return null;
      return o.chain.find((p) => p.state === 'active') || null;
    },
    moveSelectedToPoint(pt) {
      if (!pt) return;
      game.issueMove({ x: pt.x, z: pt.z, y: 0 });
    },
    setCamera(partial) {
      partial = partial || {};
      const s = game.cameraState;
      if (partial.target) {
        const t = partial.target;
        if (s.target && s.target.isVector3) s.target.set(t.x || 0, t.y || 0, t.z || 0);
        else s.target = new THREE.Vector3(t.x || 0, t.y || 0, t.z || 0);
      }
      if (partial.yaw != null) s.yaw = partial.yaw;
      if (partial.pitch != null) s.pitch = partial.pitch;
      if (partial.distance != null) s.distance = partial.distance;
      if (window.RTSCamera && RTSCamera.clampCameraState) RTSCamera.clampCameraState(s);
      else {
        s.pitch = Math.max(s.minPitch, Math.min(s.maxPitch, s.pitch));
        s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
      }
      const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
      const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
      game.camera.position.set(
        s.target.x + s.distance * cp * sy,
        s.target.y + s.distance * sp,
        s.target.z + s.distance * cp * cy
      );
      game.camera.lookAt(s.target);
    },
  };

  window.__acwBootOk = true;
  console.log('[RTS] American Civil War Turning Point ready (Day 1–3, combat). window.__RTS__ exposed.', bootError ? '(BOOT ERROR)' : '');
})();
