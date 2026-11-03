/* Pointer + keyboard: LMB select/box, RMB orders. Camera via keys (see camera.js). */
(function (global) {
  'use strict';

  function createInput(domElement, hooks) {
    const input = {
      keys: Object.create(null),
      pointer: { x: 0, y: 0 },
      pointerInWindow: true,
      wheelDelta: 0,
      mmbDragging: false,
      mmbDelta: { x: 0, y: 0 },
      lmbDown: false,
      boxSelecting: false,
      boxStart: null,
      boxEnd: null,
    };

    const el = domElement;

    window.addEventListener('keydown', (e) => {
      input.keys[e.code] = true;
      if (hooks && hooks.onKeyDown) hooks.onKeyDown(e);
    });
    window.addEventListener('keyup', (e) => {
      input.keys[e.code] = false;
    });

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      input.pointer.x = e.clientX;
      input.pointer.y = e.clientY;
      // Middle mouse ignored for camera (rotation is R/G). Still prevent autoscroll.
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        input.lmbDown = true;
        input.boxSelecting = false;
        input.boxStart = { x: e.clientX, y: e.clientY };
        input.boxEnd = { x: e.clientX, y: e.clientY };
        if (hooks && hooks.onLmbDown) hooks.onLmbDown(e);
      }
      if (e.button === 2) {
        e.preventDefault();
        if (hooks && hooks.onRmb) hooks.onRmb(e);
      }
    });

    el.addEventListener('pointermove', (e) => {
      input.pointer.x = e.clientX;
      input.pointer.y = e.clientY;
      if (input.lmbDown && input.boxStart) {
        input.boxEnd = { x: e.clientX, y: e.clientY };
        const dx = input.boxEnd.x - input.boxStart.x;
        const dy = input.boxEnd.y - input.boxStart.y;
        if (Math.hypot(dx, dy) > 6) {
          input.boxSelecting = true;
          if (hooks && hooks.onBoxDrag) hooks.onBoxDrag(input.boxStart, input.boxEnd);
        }
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        const wasBox = input.boxSelecting;
        const start = input.boxStart;
        const end = input.boxEnd || start;
        input.lmbDown = false;
        input.boxSelecting = false;
        if (hooks && hooks.onLmbUp) hooks.onLmbUp(e, wasBox, start, end);
        input.boxStart = null;
        input.boxEnd = null;
        if (hooks && hooks.onBoxEnd) hooks.onBoxEnd();
      }
    });

    el.addEventListener('wheel', (e) => {
      input.wheelDelta += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('blur', () => {
      input.keys = Object.create(null);
      input.lmbDown = false;
      input.boxSelecting = false;
    });
    document.addEventListener('mouseleave', () => { input.pointerInWindow = false; });
    document.addEventListener('mouseenter', () => { input.pointerInWindow = true; });

    return input;
  }

  global.RTSInput = { createInput };
})(window);
