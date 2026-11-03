/* Ammo logistics: per-man rounds, wagons, finite depots with trickle regen */
(function (global) {
  'use strict';

  const ROUNDS_PER_MAN = {
    infantry: 40,
    skirmisher: 40,
    cavalry: 40, // dismounted burns via faster reload; mounted uses same pool
    artillery: 0, // shells handled separately
    engineer: 20,
    officer: 20,
  };
  const ARTILLERY_SHELLS = 24; // limited shells per gun section
  const WAGON_CAPACITY = 2400;
  const WAGON_SPEED = 7;
  const WAGON_RADIUS = 2.2;
  const REFILL_RADIUS = 5.5;
  const GUARD_RADIUS = 10;
  const UNIT_REFILL_PER_SEC = 18; // rounds/sec into a waiting unit
  const WAGON_FROM_DEPOT_PER_SEC = 40;
  const LOW_FRAC = 0.25;

  // One line-infantry regiment full load per minute
  function lineFullLoad() {
    const t = RTSUnits.TYPE.infantry;
    const men = (t.ranks || 3) * (t.files || 6);
    return men * ROUNDS_PER_MAN.infantry;
  }
  function depotTricklePerMin() {
    return lineFullLoad(); // adjustable single setting derived from constants
  }
  function depotTricklePerSec() {
    return depotTricklePerMin() / 60;
  }

  const WAGONS_BY_DAY = { 1: 5, 2: 4, 3: 3 };

  /** Depot layouts per day: mix of forward (low) and rear (high) stocks. */
  const DEPOTS_BY_DAY = {
    1: [
      { id: 'd1_u_rear', x: 58, z: 34, stock: 6000, team: 'union', rear: true },
      { id: 'd1_u_cem', x: 40, z: 20, stock: 3500, team: 'union', rear: true },
      { id: 'd1_u_fwd', x: -40, z: -14, stock: 1600, team: 'union', rear: false },
      { id: 'd1_c_rear', x: -105, z: -10, stock: 6000, team: 'csa', rear: true },
      { id: 'd1_c_west', x: -82, z: 10, stock: 3200, team: 'csa', rear: true },
      { id: 'd1_c_fwd', x: -70, z: 4, stock: 1500, team: 'csa', rear: false },
    ],
    2: [
      { id: 'd2_u_rear', x: 52, z: 18, stock: 5500, team: 'union', rear: true },
      { id: 'd2_u_ridge', x: 30, z: 30, stock: 3000, team: 'union', rear: true },
      { id: 'd2_u_lrt', x: 38, z: 50, stock: 1400, team: 'union', rear: false },
      { id: 'd2_u_den', x: 22, z: 44, stock: 1200, team: 'neutral', rear: false },
      { id: 'd2_c_rear', x: -18, z: 58, stock: 5500, team: 'csa', rear: true },
      { id: 'd2_c_orch', x: 6, z: 28, stock: 1800, team: 'csa', rear: false },
    ],
    3: [
      { id: 'd3_u_rear', x: 52, z: 14, stock: 5000, team: 'union', rear: true },
      { id: 'd3_u_ridge', x: 32, z: 28, stock: 2800, team: 'union', rear: true },
      { id: 'd3_u_angle', x: 24, z: 36, stock: 1100, team: 'union', rear: false },
      { id: 'd3_mid', x: 8, z: 30, stock: 900, team: 'neutral', rear: false },
      { id: 'd3_c_rear', x: -52, z: 6, stock: 5000, team: 'csa', rear: true },
      { id: 'd3_c_sem', x: -36, z: 16, stock: 2000, team: 'csa', rear: false },
    ],
  };

  function ammoCapacityForType(type, menCount) {
    if (type === 'artillery') return ARTILLERY_SHELLS;
    const rpm = ROUNDS_PER_MAN[type] != null ? ROUNDS_PER_MAN[type] : 20;
    return Math.max(1, Math.round((menCount || 1) * rpm));
  }

  function applyUnitAmmoCaps(unit) {
    const cap = ammoCapacityForType(unit.type, unit.startMen || unit.maxMen || unit.menCount || 1);
    unit.ammoMax = cap;
    if (unit.ammo == null || unit.ammo > cap) unit.ammo = cap;
    unit.ammo = Math.min(unit.ammo, cap);
  }

  function ammoFrac(unit) {
    if (!unit.ammoMax) return 1;
    return unit.ammo / unit.ammoMax;
  }

  function ensureAmmoMarker(unit) {
    let m = unit.mesh.getObjectByName('ammoMarker');
    if (!m) {
      m = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe8d040 })
      );
      m.position.set(0, 3.2, 0);
      m.name = 'ammoMarker';
      m.visible = false;
      unit.mesh.add(m);
    }
    return m;
  }

  function updateAmmoMarker(unit) {
    const m = ensureAmmoMarker(unit);
    if (!unit.alive) { m.visible = false; return; }
    const f = ammoFrac(unit);
    if (f <= 0 || unit.ammo <= 0) {
      m.visible = true;
      m.material.color.setHex(0xc03030); // OUT red
    } else if (f < LOW_FRAC) {
      m.visible = true;
      m.material.color.setHex(0xe8d040); // LOW yellow
    } else {
      m.visible = false;
    }
  }

  function makeMule() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.5, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x5a4030 })
    );
    body.position.y = 0.7;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.28, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x4a3020 })
    );
    head.position.set(0.55, 0.95, 0);
    [[-0.35, -0.12], [-0.35, 0.12], [0.35, -0.12], [0.35, 0.12]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.55, 0.1),
        new THREE.MeshLambertMaterial({ color: 0x3a2818 })
      );
      leg.position.set(x, 0.28, z);
      g.add(leg);
    });
    g.add(body, head);
    return g;
  }

  function createWagonMesh(team) {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.1, 1.9),
      new THREE.MeshLambertMaterial({ color: team === 'union' ? 0x4a6a9c : 0x8a4840 })
    );
    bed.position.y = 1.0;
    const canvas = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 1.1, 1.7),
      new THREE.MeshLambertMaterial({ color: 0xc8b888 })
    );
    canvas.position.y = 1.95;
    canvas.name = 'canvas';
    // 4-mule team ahead
    for (let i = 0; i < 4; i++) {
      const mule = makeMule();
      const row = Math.floor(i / 2);
      const col = i % 2;
      mule.position.set(2.2 + row * 1.3, 0, (col - 0.5) * 0.9);
      g.add(mule);
    }
    // wheels
    [[-1.1, 1.05], [1.0, 1.05], [-1.1, -1.05], [1.0, -1.05]].forEach(([x, z]) => {
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.14, 10),
        new THREE.MeshLambertMaterial({ color: 0x3a2a18 })
      );
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.55, z);
      g.add(w);
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(WAGON_RADIUS * 0.85, WAGON_RADIUS * 1.05, 24),
      new THREE.MeshBasicMaterial({
        color: 0xc4a35a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    ring.name = 'selectionRing';
    g.add(bed, canvas, ring);
    const teamCol = team === 'union' ? 0x1e5aaf : 0xcc1a1a;
    const tm = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 10),
      new THREE.MeshBasicMaterial({ color: teamCol })
    );
    tm.position.set(0, 3.2, 0);
    tm.name = 'teamMarker';
    tm.visible = true;
    g.add(tm);
    return g;
  }

  function createDepotMesh(def) {
    const g = new THREE.Group();
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 2.2, 3.2),
      new THREE.MeshLambertMaterial({ color: 0x6a5a40 })
    );
    crate.position.y = 1.1;
    crate.name = 'crate';
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 0.35, 3.6),
      new THREE.MeshLambertMaterial({ color: 0x4a4030 })
    );
    roof.position.y = 2.4;
    // fill bar (vertical)
    const barBg = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 2.4, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x222218 })
    );
    barBg.position.set(3.2, 1.3, 0);
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 2.2, 0.28),
      new THREE.MeshBasicMaterial({ color: 0x6bcf8e })
    );
    bar.position.set(3.2, 1.3, 0);
    bar.name = 'fillBar';
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(8.2, 64),
      new THREE.MeshBasicMaterial({
        color: 0x4a4838, side: THREE.DoubleSide, transparent: true, opacity: 0.07,
        depthWrite: false, depthTest: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    ring.renderOrder = 0;
    ring.name = 'depotRing';
    g.add(crate, roof, barBg, bar, ring);
    return g;
  }

  function setDepotFillBar(depot) {
    const bar = depot.mesh.getObjectByName('fillBar');
    const crate = depot.mesh.getObjectByName('crate');
    if (!bar) return;
    const frac = depot.startStock > 0 ? depot.stock / depot.startStock : 0;
    bar.scale.y = Math.max(0.02, frac);
    bar.position.y = 0.2 + 1.1 * frac;
    bar.material.color.setHex(frac <= 0 ? 0x555550 : frac < 0.25 ? 0xe8d040 : 0x6bcf8e);
    if (crate) {
      crate.material.color.setHex(frac <= 0 ? 0x3a3a38 : 0x6a5a40);
    }
    const ring = depot.mesh.getObjectByName('depotRing');
    if (ring) {
      // Soft fill only — no stroke ring (those read as fake range arcs)
      const col = depot.controller === 'union' ? 0x2a4060 : depot.controller === 'csa' ? 0x5a4030 : 0x4a4838;
      ring.material.color.setHex(col);
      ring.material.opacity = frac <= 0 ? 0.02 : 0.05;
    }
  }

  let _wid = 1;

  function spawnWagon(scene, world, { team, x, z, ammo }) {
    const mesh = createWagonMesh(team);
    const y = world.heightAt ? world.heightAt(x, z) : 0;
    mesh.position.set(x, y, z);
    mesh.name = team + '_wagon_' + _wid;
    const wagon = {
      id: 'w' + (_wid++),
      kind: 'wagon',
      type: 'wagon',
      label: 'Ammo Wagon',
      team,
      mesh,
      speed: WAGON_SPEED,
      radius: WAGON_RADIUS,
      hp: 40,
      maxHp: 40,
      ammo: ammo != null ? ammo : WAGON_CAPACITY,
      ammoMax: WAGON_CAPACITY,
      target: null,
      selected: false,
      alive: true,
      isWagon: true,
      lastCombatAt: -9999,
    };
    mesh.userData.unit = wagon;
    mesh.userData.wagon = wagon;
    scene.add(mesh);
    return wagon;
  }

  function spawnDayWagons(scene, world, day) {
    day = (day === 2 || day === 3) ? day : 1;
    const n = WAGONS_BY_DAY[day] || 5;
    const list = [];
    const spots = {
      1: {
        union: [[60, 36], [56, 30], [50, 40], [44, 24], [58, 44]],
        csa: [[-106, -4], [-102, -12], [-110, 2], [-100, 8], [-108, -16]],
      },
      2: {
        union: [[54, 16], [48, 24], [50, 34], [42, 20]],
        csa: [[-16, 56], [-10, 50], [-22, 48], [-8, 60]],
      },
      3: {
        union: [[54, 12], [48, 20], [50, 26]],
        csa: [[-54, 4], [-48, 12], [-58, 10]],
      },
    };
    const daySpots = spots[day] || spots[1];
    ['union', 'csa'].forEach((team) => {
      (daySpots[team] || []).slice(0, n).forEach(([x, z]) => {
        list.push(spawnWagon(scene, world, { team, x, z }));
      });
    });
    return list;
  }

  function spawnDayDepots(scene, world, day) {
    day = (day === 2 || day === 3) ? day : 1;
    const defs = DEPOTS_BY_DAY[day] || DEPOTS_BY_DAY[1];
    return defs.map((d) => {
      const mesh = createDepotMesh(d);
      const y = world.heightAt ? world.heightAt(d.x, d.z) : 0;
      mesh.position.set(d.x, y, d.z);
      mesh.name = d.id;
      const depot = {
        id: d.id,
        kind: 'depot',
        x: d.x,
        z: d.z,
        stock: d.stock,
        startStock: d.stock,
        team: d.team, // initial
        controller: d.team === 'neutral' ? null : d.team,
        rear: !!d.rear,
        radius: 8,
        mesh,
        isDepot: true,
      };
      mesh.userData.depot = depot;
      scene.add(mesh);
      setDepotFillBar(depot);
      return depot;
    });
  }

  function countNear(units, x, z, radius, team) {
    let n = 0;
    units.forEach((u) => {
      if (!u.alive || u.isWagon) return;
      if (team && u.team !== team) return;
      if (Math.hypot(u.mesh.position.x - x, u.mesh.position.z - z) <= radius) n++;
    });
    return n;
  }

  function updateDepotControl(depot, units) {
    const uN = countNear(units, depot.x, depot.z, depot.radius, 'union');
    const cN = countNear(units, depot.x, depot.z, depot.radius, 'csa');
    if (uN > 0 && cN === 0) depot.controller = 'union';
    else if (cN > 0 && uN === 0) depot.controller = 'csa';
    // contested or empty: keep previous controller but mark contested
    depot.contested = uN > 0 && cN > 0;
    setDepotFillBar(depot);
  }

  function updateDepotTrickle(depot, dt) {
    // Pause while contested or… trickle only for the controlling side's benefit;
    // stock regenerates toward startStock when NOT contested and has a controller.
    // Spec: "pause while contested/enemy-held" — enemy-held means from a given side's view;
    // globally: trickle whenever not contested and controller set (the holders restock).
    if (depot.contested || !depot.controller) return;
    if (depot.stock >= depot.startStock) return;
    depot.stock = Math.min(depot.startStock, depot.stock + depotTricklePerSec() * dt);
    setDepotFillBar(depot);
  }

  global.RTSLogistics = {
    ROUNDS_PER_MAN,
    ARTILLERY_SHELLS,
    WAGON_CAPACITY,
    WAGONS_BY_DAY,
    DEPOTS_BY_DAY,
    LOW_FRAC,
    REFILL_RADIUS,
    GUARD_RADIUS,
    UNIT_REFILL_PER_SEC,
    WAGON_FROM_DEPOT_PER_SEC,
    lineFullLoad,
    depotTricklePerMin,
    depotTricklePerSec,
    ammoCapacityForType,
    applyUnitAmmoCaps,
    ammoFrac,
    updateAmmoMarker,
    spawnDayWagons,
    spawnDayDepots,
    spawnWagon,
    updateDepotControl,
    updateDepotTrickle,
    setDepotFillBar,
    countNear,
  };
})(window);
