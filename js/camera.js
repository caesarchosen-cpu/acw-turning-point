/* Orbital RTS camera — Tristen control scheme:
   W/S forward-back, A/D pan L/R, Q/E strafe L/R, Z/X zoom, R/G rotate.
   Wheel zoom. Edge-pan suppressed while LMB box-dragging. No MMB rotate. */
(function (global) {
  'use strict';

  function createCamera(aspect) {
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.5, 500);
    const state = {
      target: new THREE.Vector3(-40, 0, 0),
      yaw: 0,
      pitch: Math.PI / 2 - 0.08,
      distance: 55,
      // Keep ground filling the view: never tilt down to empty sky (was 15°)
      minPitch: (55 * Math.PI) / 180,
      maxPitch: (89 * Math.PI) / 180,
      minDist: 22,
      maxDist: 95,
      panSpeed: 38,
      rotSpeed: 1.4,
      tiltSpeed: 1.1,
      edgePan: 18,
    };
    apply(camera, state);
    return { camera, state, apply: () => apply(camera, state) };
  }

  function apply(camera, s) {
    const cp = Math.cos(s.pitch);
    const sp = Math.sin(s.pitch);
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    camera.position.set(
      s.target.x + s.distance * cp * sy,
      s.target.y + s.distance * sp,
      s.target.z + s.distance * cp * cy
    );
    camera.lookAt(s.target);
    camera.updateMatrixWorld();
  }

  function updateCamera(ctrl, input, dt, canvasW, canvasH) {
    const s = ctrl.state;
    const keys = input.keys;

    // Camera-relative axes on XZ
    const forwardX = Math.sin(s.yaw);
    const forwardZ = Math.cos(s.yaw);
    const rightX = Math.cos(s.yaw);
    const rightZ = -Math.sin(s.yaw);
    const speed = s.panSpeed * (s.distance / 55);

    let fx = 0; // forward component
    let sx = 0; // strafe / pan lateral component

    // W/S — move camera forward/back (relative to heading)
    if (keys['KeyW']) fx -= 1;
    if (keys['KeyS']) fx += 1;
    // A/D — pan left/right
    if (keys['KeyA']) sx -= 1;
    if (keys['KeyD']) sx += 1;
    // Q/E — strafe left/right (same lateral axis; kept distinct binding)
    if (keys['KeyQ']) sx -= 1;
    if (keys['KeyE']) sx += 1;

    // Edge pan — suppressed while dragging a box select (also off on touch UI)
    const suppressEdge = !!(input.boxSelecting || input.lmbDown || input.touchUi);
    if (input.pointerInWindow && !suppressEdge) {
      const m = input.pointer;
      if (m.x <= s.edgePan) sx -= 1;
      if (m.x >= canvasW - s.edgePan) sx += 1;
      if (m.y <= s.edgePan) fx -= 1;
      if (m.y >= canvasH - s.edgePan) fx += 1;
    }

    // On-screen touch pad (x right, y down → camera forward/strafe)
    if (input.touchPad) {
      const tx = input.touchPad.x || 0;
      const ty = input.touchPad.y || 0;
      if (tx || ty) { sx += tx; fx += ty; }
    }

    if (fx !== 0 || sx !== 0) {
      const len = Math.hypot(fx, sx) || 1;
      fx /= len;
      sx /= len;
      s.target.x += (forwardX * fx + rightX * sx) * speed * dt;
      s.target.z += (forwardZ * fx + rightZ * sx) * speed * dt;
      s.target.x = Math.max(-110, Math.min(90, s.target.x));
      s.target.z = Math.max(-80, Math.min(80, s.target.z));
    }

    // R/G — rotate camera left/right (yaw)
    if (keys['KeyR']) s.yaw += s.rotSpeed * dt;
    if (keys['KeyG']) s.yaw -= s.rotSpeed * dt;

    // Z/X — zoom in/out
    if (keys['KeyZ']) {
      s.distance *= 1 - 0.55 * dt;
      s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
    }
    if (keys['KeyX']) {
      s.distance *= 1 + 0.55 * dt;
      s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
    }

    // Mouse wheel zoom
    if (input.wheelDelta !== 0) {
      s.distance *= 1 + input.wheelDelta * 0.0015;
      s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
      input.wheelDelta = 0;
    }
    // Pinch zoom (touch)
    if (input.pinchZoom && input.pinchZoom !== 1) {
      s.distance *= input.pinchZoom;
      s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
      input.pinchZoom = 1;
    }
    // Two-finger pan deltas (pixels → world)
    if (input.touchPan) {
      const px = input.touchPan.x || 0;
      const py = input.touchPan.y || 0;
      if (px || py) {
        const k = (s.distance / 55) * 0.085;
        s.target.x += (-forwardX * py + rightX * -px) * k;
        s.target.z += (-forwardZ * py + rightZ * -px) * k;
        s.target.x = Math.max(-110, Math.min(90, s.target.x));
        s.target.z = Math.max(-80, Math.min(80, s.target.z));
      }
      input.touchPan.x = 0;
      input.touchPan.y = 0;
    }

    // MMB rotate intentionally removed (Tristen). Clear any residual deltas.
    if (input.mmbDelta) {
      input.mmbDelta.x = 0;
      input.mmbDelta.y = 0;
    }
    input.mmbDragging = false;

    // Hard clamp — ground must remain in view
    s.pitch = Math.max(s.minPitch, Math.min(s.maxPitch, s.pitch));
    s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));

    ctrl.apply();
  }

  function clampCameraState(s) {
    if (!s) return s;
    s.pitch = Math.max(s.minPitch, Math.min(s.maxPitch, s.pitch));
    s.distance = Math.max(s.minDist, Math.min(s.maxDist, s.distance));
    return s;
  }

  global.RTSCamera = { createCamera, updateCamera, clampCameraState };
})(window);
