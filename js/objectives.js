/* Sequential capture points (1->2->3). Locked until previous held. */
(function (global) {
  'use strict';

  const CAPTURE_SECONDS = 8.0;
  const RADIUS = 10;

  /** Day 1 chains per side — landmark names match map. */
  const DAY1 = {
    union: [
      { id: 'u1', name: 'McPherson Ridge', x: -55, z: 5, radius: RADIUS },
      { id: 'u2', name: 'Seminary Ridge', x: -28, z: 12, radius: RADIUS },
      { id: 'u3', name: 'Cemetery Hill', x: 48, z: 28, radius: 12 },
    ],
    csa: [
      { id: 'c1', name: 'Herr Ridge / McPherson Ridge', x: -70, z: 0, radius: 12 },
      { id: 'c2', name: 'Seminary Ridge', x: -28, z: 12, radius: RADIUS },
      { id: 'c3', name: 'Town Square', x: 8, z: 8, radius: 11 },
    ],
  };

  /** Day 2 chains — Longstreet's assault / fishhook defense */
  const DAY2 = {
    union: [
      { id: 'd2u1', name: 'Little Round Top', x: 35, z: 55, radius: 11 },
      { id: 'd2u2', name: "Devil's Den / Wheatfield", x: 22, z: 46, radius: 12 },
      { id: 'd2u3', name: 'Cemetery Ridge center', x: 25, z: 35, radius: 12 },
    ],
    csa: [
      { id: 'd2c1', name: 'Peach Orchard', x: 12, z: 32, radius: 11 },
      { id: 'd2c2', name: "Devil's Den / Wheatfield", x: 22, z: 46, radius: 12 },
      { id: 'd2c3', name: 'Little Round Top', x: 35, z: 55, radius: 11 },
    ],
  };

  /** Day 3 — Pickett's Charge */
  const DAY3 = {
    union: [
      { id: 'd3u1', name: 'Emmitsburg Road line', x: 18, z: 36, radius: 12 },
      { id: 'd3u2', name: 'The Angle', x: 26, z: 34, radius: 10 },
      { id: 'd3u3', name: 'Copse of Trees', x: 28, z: 32, radius: 9 },
    ],
    csa: [
      { id: 'd3c1', name: 'Emmitsburg Road', x: 18, z: 36, radius: 12 },
      { id: 'd3c2', name: 'The Angle', x: 26, z: 34, radius: 10 },
      { id: 'd3c3', name: 'Copse of Trees', x: 28, z: 32, radius: 9 },
    ],
  };

  const BY_DAY = { 1: DAY1, 2: DAY2, 3: DAY3 };

  const STATE = { LOCKED: 'locked', ACTIVE: 'active', HELD: 'held' };

  function createObjectives(scene, world, side, day) {
    day = (day === 2 || day === 3) ? day : 1;
    const table = BY_DAY[day] || DAY1;
    const chain = (table[side] || table.union).map((p, i) => ({
      ...p,
      index: i + 1,
      state: i === 0 ? STATE.ACTIVE : STATE.LOCKED,
      progress: 0, // 0..1
      marker: null,
      labelSprite: null,
    }));

    chain.forEach((pt) => {
      pt.marker = makeMarker(pt);
      scene.add(pt.marker);
      placeMarker(pt, world);
    });

    return {
      side,
      day,
      chain,
      captureSeconds: CAPTURE_SECONDS,
      allHeld: false,
    };
  }

  function makeMarker(pt) {
    const g = new THREE.Group();
    g.name = 'obj_' + pt.id;
    // Subtle capture zone: thin stroke, distinct from unit range rings (brass range vs muted parchment zone)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(pt.radius * 0.985, pt.radius, 96),
      new THREE.MeshBasicMaterial({
        color: 0x6a6248,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        depthTest: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    ring.renderOrder = 1;
    ring.name = 'ring';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.25, 4.5, 8),
      new THREE.MeshLambertMaterial({ color: 0xcccccc })
    );
    pole.position.y = 2.25;
    pole.name = 'pole';
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.2),
      new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    banner.position.set(0, 4.6, 0);
    banner.name = 'banner';
    // Number disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide })
    );
    disc.position.set(0, 5.4, 0.05);
    disc.name = 'disc';
    g.add(ring, pole, banner, disc);
    g.userData.pointId = pt.id;
    return g;
  }

  function placeMarker(pt, world) {
    const y = world.heightAt ? world.heightAt(pt.x, pt.z) : 0;
    pt.marker.position.set(pt.x, y + 0.08, pt.z);
  }

  function colorForState(state) {
    if (state === STATE.HELD) return { ring: 0x6bcf8e, pole: 0x4a9a60, banner: 0x2a5a38 };
    if (state === STATE.ACTIVE) return { ring: 0xc4a35a, pole: 0xd4b45a, banner: 0x6a5020 };
    return { ring: 0x666660, pole: 0x555550, banner: 0x333330 };
  }

  function refreshMarkerVisuals(pt) {
    const c = colorForState(pt.state);
    const ring = pt.marker.getObjectByName('ring');
    const pole = pt.marker.getObjectByName('pole');
    const banner = pt.marker.getObjectByName('banner');
    if (ring) ring.material.color.setHex(c.ring);
    if (pole) pole.material.color.setHex(c.pole);
    if (banner) banner.material.color.setHex(c.banner);
    // Capture rings: ACTIVE only (subtle pulse). HELD faint. LOCKED hidden — avoids map clutter.
    if (ring) {
      if (pt.state === STATE.ACTIVE) {
        ring.visible = true;
        ring.material.opacity = 0.2 + 0.18 * (pt.progress || 0);
      } else if (pt.state === STATE.HELD) {
        ring.visible = true;
        ring.material.opacity = 0.1;
      } else {
        ring.visible = false;
      }
    }
  }

  function countInRadius(units, pt, team) {
    let n = 0;
    units.forEach((u) => {
      if (!u.alive || u.team !== team) return;
      const d = Math.hypot(u.mesh.position.x - pt.x, u.mesh.position.z - pt.z);
      if (d <= pt.radius) n++;
    });
    return n;
  }

  function updateObjectives(obj, units, playerSide, dt) {
    if (!obj || obj.allHeld) return getHud(obj);

    const active = obj.chain.find((p) => p.state === STATE.ACTIVE);
    if (!active) {
      obj.allHeld = obj.chain.every((p) => p.state === STATE.HELD);
      return getHud(obj);
    }

    const friends = countInRadius(units, active, playerSide);
    const enemies = countInRadius(units, active, playerSide === 'union' ? 'csa' : 'union');
    active.contested = friends > 0 && enemies > 0;
    active.empty = friends === 0;

    if (friends > 0 && enemies === 0) {
      // Uncontested friendly presence — accumulate toward 8s flip
      active.progress = Math.min(1, active.progress + dt / obj.captureSeconds);
      if (active.progress >= 1) {
        active.state = STATE.HELD;
        active.progress = 1;
        active.contested = false;
        refreshMarkerVisuals(active);
        const next = obj.chain.find((p) => p.state === STATE.LOCKED);
        if (next) {
          next.state = STATE.ACTIVE;
          next.progress = 0;
          next.contested = false;
          refreshMarkerVisuals(next);
        } else {
          obj.allHeld = true;
        }
      }
    } else if (active.contested) {
      // Contested: freeze progress (no advance, no decay, no flip)
    } else if (friends === 0) {
      // Empty: gentle decay
      active.progress = Math.max(0, active.progress - dt / (obj.captureSeconds * 0.75));
    }

    obj.chain.forEach(refreshMarkerVisuals);
    updateContestedLabel(active);
    return getHud(obj);
  }

  /** Over-point "Contested" sprite — parchment/amber with dark outline (no white/light-blue). */
  function ensureContestedLabel(pt) {
    if (pt.contestedLabel) return pt.contestedLabel;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold 36px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = '#111111';
    g.strokeText('Contested', 128, 32);
    g.fillStyle = '#d9b44a'; // parchment/amber (was #e8e8e8 white/light gray)
    g.fillText('Contested', 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(8, 2, 1);
    spr.position.set(0, 7.2, 0);
    spr.name = 'contestedLabel';
    spr.visible = false;
    pt.marker.add(spr);
    pt.contestedLabel = spr;
    return spr;
  }

  function updateContestedLabel(pt) {
    if (!pt || !pt.marker) return;
    const spr = ensureContestedLabel(pt);
    spr.visible = !!pt.contested && pt.state === STATE.ACTIVE;
  }

  function getHud(obj) {
    if (!obj) return { text: '', pct: 0, index: 0, total: 0, allHeld: false };
    const total = obj.chain.length;
    const held = obj.chain.filter((p) => p.state === STATE.HELD).length;
    const active = obj.chain.find((p) => p.state === STATE.ACTIVE);
    if (obj.allHeld || !active) {
      return {
        text: `Objectives complete — ${total}/${total} held`,
        pct: 100,
        index: total,
        total,
        allHeld: true,
        contested: false,
        chain: obj.chain,
      };
    }
    const pct = Math.floor(active.progress * 100);
    const contested = !!active.contested;
    // Contested label: neutral light gray wording in HUD (color via CSS class, not blue/red)
    const text = contested
      ? `Objective ${active.index}/${total}: Take ${active.name} — Contested`
      : `Objective ${active.index}/${total}: Take ${active.name} — ${pct}%`;
    return {
      text,
      pct,
      index: active.index,
      total,
      allHeld: false,
      contested,
      name: active.name,
      chain: obj.chain,
    };
  }

  /** Test helper: force-hold points 1..n (unlocks next). */
  function debugHoldThrough(obj, count) {
    for (let i = 0; i < count && i < obj.chain.length; i++) {
      obj.chain[i].state = STATE.HELD;
      obj.chain[i].progress = 1;
      refreshMarkerVisuals(obj.chain[i]);
    }
    const next = obj.chain.find((p) => p.state === STATE.LOCKED);
    if (next) {
      next.state = STATE.ACTIVE;
      next.progress = 0;
      refreshMarkerVisuals(next);
    } else {
      obj.allHeld = true;
    }
    obj.chain.forEach(refreshMarkerVisuals);
  }

  global.RTSObjectives = {
    DAY1,
    DAY2,
    DAY3,
    BY_DAY,
    STATE,
    CAPTURE_SECONDS,
    createObjectives,
    updateObjectives,
    getHud,
    debugHoldThrough,
  };
})(window);
