/* Mobile / touch layer for ACW Turning Point.
   - One finger tap = select; drag = box select (same as mouse)
   - Long-press (~420ms) = context order (same as RMB)
   - Two-finger drag = pan camera; pinch = zoom
   - On-screen: camera pad (bottom-left), action buttons (bottom-right) when coarse pointer
*/
(function (global) {
  'use strict';

  function isTouchPreferred() {
    try {
      return window.matchMedia('(pointer: coarse)').matches ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 1200);
    } catch (_) {
      return navigator.maxTouchPoints > 0;
    }
  }

  function createTouch(domElement, hooks) {
    const state = {
      enabled: isTouchPreferred(),
      fingers: new Map(), // id -> {x,y,t0}
      longPressTimer: null,
      longPressFired: false,
      twoFinger: null, // {midX,midY,dist,yaw0,dist0}
      suppressClick: false,
    };

    function clearLongPress() {
      if (state.longPressTimer) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
    }

    // Dual-finger pan/zoom — attach on window so UI buttons don't steal
    domElement.addEventListener('touchstart', (e) => {
      if (!state.enabled) return;
      for (const t of e.changedTouches) {
        state.fingers.set(t.identifier, { x: t.clientX, y: t.clientY, t0: performance.now() });
      }
      if (state.fingers.size === 1) {
        state.longPressFired = false;
        const [id, f] = [...state.fingers.entries()][0];
        clearLongPress();
        state.longPressTimer = setTimeout(() => {
          if (state.fingers.size !== 1 || !state.fingers.has(id)) return;
          state.longPressFired = true;
          state.suppressClick = true;
          if (hooks && hooks.onLongPress) {
            hooks.onLongPress({ clientX: f.x, clientY: f.y, preventDefault() {} });
          }
          // haptic if available
          if (navigator.vibrate) try { navigator.vibrate(18); } catch (_) {}
        }, 420);
      } else {
        clearLongPress();
      }
      if (state.fingers.size === 2) {
        const pts = [...state.fingers.values()];
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        state.twoFinger = { midX, midY, dist, lastMidX: midX, lastMidY: midY, lastDist: dist };
        // cancel box select when second finger lands
        if (hooks && hooks.onCancelBox) hooks.onCancelBox();
      }
    }, { passive: true });

    domElement.addEventListener('touchmove', (e) => {
      if (!state.enabled) return;
      for (const t of e.changedTouches) {
        const f = state.fingers.get(t.identifier);
        if (f) { f.x = t.clientX; f.y = t.clientY; }
      }
      if (state.fingers.size >= 2 && state.twoFinger) {
        e.preventDefault();
        clearLongPress();
        const pts = [...state.fingers.values()];
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const dx = midX - state.twoFinger.lastMidX;
        const dy = midY - state.twoFinger.lastMidY;
        const zoom = state.twoFinger.lastDist / dist;
        state.twoFinger.lastMidX = midX;
        state.twoFinger.lastMidY = midY;
        state.twoFinger.lastDist = dist;
        if (hooks && hooks.onPinchPan) hooks.onPinchPan({ dx, dy, zoom });
      } else if (state.fingers.size === 1) {
        const f = [...state.fingers.values()][0];
        // cancel long-press if moved too far
        const start = [...state.fingers.values()][0];
        // already updating same object
      }
    }, { passive: false });

    domElement.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) state.fingers.delete(t.identifier);
      if (state.fingers.size < 2) state.twoFinger = null;
      if (state.fingers.size === 0) clearLongPress();
    }, { passive: true });

    domElement.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) state.fingers.delete(t.identifier);
      state.twoFinger = null;
      clearLongPress();
    }, { passive: true });

    function buildHUD() {
      if (document.getElementById('touchHUD')) return;
      const hud = document.createElement('div');
      hud.id = 'touchHUD';
      hud.innerHTML = `
        <div id="touchPad" aria-label="Camera pad">
          <div class="tp-knob" id="touchPadKnob"></div>
          <div class="tp-label">PAN</div>
        </div>
        <div id="touchActions">
          <button type="button" data-act="fire" title="Commence / Fire (C)">FIRE</button>
          <button type="button" data-act="hold" title="Hold / Fire at Will (H)">HOLD</button>
          <button type="button" data-act="mount" title="Mount / Dismount (F)">MOUNT</button>
          <button type="button" data-act="skirm" title="Detach / Rejoin (K)">SKIRM</button>
          <button type="button" data-act="zoomIn" title="Zoom in">＋</button>
          <button type="button" data-act="zoomOut" title="Zoom out">－</button>
        </div>`;
      document.body.appendChild(hud);

      // Virtual pan pad → synthesizes camera key flags via hooks
      const pad = document.getElementById('touchPad');
      const knob = document.getElementById('touchPadKnob');
      let padTouch = null;
      const applyPad = (cx, cy) => {
        const r = pad.getBoundingClientRect();
        const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
        let dx = (cx - ox) / (r.width * 0.45);
        let dy = (cy - oy) / (r.height * 0.45);
        const len = Math.hypot(dx, dy) || 1;
        if (len > 1) { dx /= len; dy /= len; }
        knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
        if (hooks && hooks.onPad) hooks.onPad({ x: dx, y: dy });
      };
      const endPad = () => {
        padTouch = null;
        knob.style.transform = 'translate(0,0)';
        if (hooks && hooks.onPad) hooks.onPad({ x: 0, y: 0 });
      };
      pad.addEventListener('pointerdown', (e) => {
        padTouch = e.pointerId; pad.setPointerCapture(e.pointerId); applyPad(e.clientX, e.clientY); e.preventDefault();
      });
      pad.addEventListener('pointermove', (e) => { if (padTouch === e.pointerId) applyPad(e.clientX, e.clientY); });
      pad.addEventListener('pointerup', endPad);
      pad.addEventListener('pointercancel', endPad);

      document.getElementById('touchActions').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn || !hooks || !hooks.onAction) return;
        hooks.onAction(btn.getAttribute('data-act'));
      });
    }

    function setVisible(on) {
      state.enabled = !!on;
      const hud = document.getElementById('touchHUD');
      if (hud) hud.style.display = on ? 'block' : 'none';
      if (on) buildHUD();
    }

    if (state.enabled) {
      // defer HUD until DOM ready
      if (document.body) buildHUD();
      else window.addEventListener('DOMContentLoaded', buildHUD);
    }

    // Re-evaluate on resize
    window.addEventListener('resize', () => {
      const want = isTouchPreferred();
      if (want !== state.enabled) setVisible(want);
    });

    return { state, setVisible, isTouchPreferred };
  }

  global.RTSTouch = { createTouch, isTouchPreferred };
})(window);
