/* Gettysburg field: heightmap ridges, instanced woods, rocks, fences, crops, town */
(function (global) {
  'use strict';

  const COLORS = {
    ground: 0x4a6a3e,
    road: 0x6b5a42,
    treeTrunk: 0x4a3422,
    treeCanopy: 0x2d5a28,
    supplyUnion: 0x4a6a9c,
    supplyCsa: 0x8a4840,
    unionBase: 0x3a5a8c,
    confedCamp: 0x6b3030,
    wall: 0x7a7568,
    rock: 0x6a6860,
    wheat: 0xc2a84a,
    orchard: 0x3d6b32,
  };

  /** Procedural height at world XZ — McPherson, Seminary, Cemetery Hill, Round Tops, Den */
  function heightAt(x, z) {
    let h = 0;
    // McPherson Ridge (west)
    h += 2.4 * Math.exp(-Math.pow((x + 55) / 18, 2) - Math.pow((z - 5) / 28, 2));
    // Seminary Ridge
    h += 1.8 * Math.exp(-Math.pow((x + 28) / 12, 2) - Math.pow((z - 12) / 22, 2));
    // Cemetery Hill
    h += 3.4 * Math.exp(-Math.pow((x - 48) / 14, 2) - Math.pow((z - 28) / 14, 2));
    // Cemetery Ridge (south of hill)
    h += 1.4 * Math.exp(-Math.pow((x - 25) / 16, 2) - Math.pow((z - 38) / 12, 2));
    // Little Round Top
    h += 5.0 * Math.exp(-Math.pow((x - 35) / 8, 2) - Math.pow((z - 55) / 7, 2));
    // Big Round Top
    h += 6.2 * Math.exp(-Math.pow((x - 48) / 9, 2) - Math.pow((z - 62) / 8, 2));
    // Gentle noise
    h += 0.25 * Math.sin(x * 0.08) * Math.cos(z * 0.07);
    return h;
  }

  function createWorld(scene) {
    const group = new THREE.Group();
    group.name = 'world';
    scene.add(group);

    const seg = 100;
    const groundGeo = new THREE.PlaneGeometry(220, 180, seg, seg);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.name = 'ground';
    ground.receiveShadow = true;
    group.add(ground);

    // Sample height helper for placing props
    function yAt(x, z) {
      return heightAt(x, z);
    }

    // Roads (Chambersburg Pike, Emmitsburg Rd-ish)
    addRoad(group, -90, -8, 50, 10, 5, yAt);
    addRoad(group, 8, 8, 35, 55, 4, yAt);

    // Instanced trees / woods
    const trees = addInstancedTrees(group, yAt);

    // Devil's Den rocks (dense boulder field SW of LRT)
    const rocks = addDevilsDenRocks(group, yAt);

    // Rail fences
    addRailFences(group, yAt);
    // Emmitsburg Road fence lines — slow movement (Day 3 charge)
    const emmitsburgFences = addEmmitsburgFences(group, yAt);

    // Wheatfield
    addWheatfield(group, yAt);

    // Peach Orchard
    addOrchard(group, yAt);

    // Town buildings (Gettysburg)
    addTown(group, yAt);

    // Ammo supply wagons / depots only
    const supplies = [];
    supplies.push(addSupply(group, -48, -12, 'union', 'union_wagon_mcpherson', yAt));
    supplies.push(addSupply(group, 40, 20, 'union', 'union_depot_cemetery', yAt));
    supplies.push(addSupply(group, -88, -6, 'csa', 'csa_wagon_pike', yAt));
    supplies.push(addSupply(group, -82, 10, 'csa', 'csa_depot_west', yAt));

    const buildings = {
      unionHq: addBuilding(group, 42, 22, COLORS.unionBase, 6, 4, 6, 'union_hq', yAt),
      outpost: addBuilding(group, -50, 0, 0x4a6a9c, 4, 2.5, 4, 'buford_outpost', yAt),
      confedCamp: addBuilding(group, -85, -5, COLORS.confedCamp, 5, 3, 5, 'confed_camp', yAt),
    };

    scene.add(new THREE.AmbientLight(0x889988, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.9);
    sun.position.set(40, 80, 20);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x9a8e72, 0x3a4a30, 0.4)); // was light-blue sky 0x87a0c0

    const walls = [];

    // Ground raycast plane: use invisible flat proxy for reliable picking, snap Y later
    // Keep real ground as visual; add flat pick plane slightly below min height
    const pick = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 180),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    pick.rotation.x = -Math.PI / 2;
    pick.position.y = 0;
    pick.name = 'groundPick';
    group.add(pick);

    return {
      group,
      ground: pick, // for raycasts
      groundVisual: ground,
      heightAt: yAt,
      trees,
      rocks,
      emmitsburgFences,
      supplies,
      walls,
      buildings,
      labels: {
        mcpherson: { x: -55, z: 5 },
        cemetery: { x: 48, z: 28 },
        town: { x: 8, z: 8 },
        devilsDen: { x: 28, z: 50 },
        wheatfield: { x: 18, z: 42 },
      },
    };
  }

  function addRoad(group, x0, z0, x1, z1, width, yAt) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const midX = (x0 + x1) / 2;
    const midZ = (z0 + z1) / 2;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, width),
      new THREE.MeshLambertMaterial({ color: COLORS.road })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(dz, dx);
    mesh.position.set(midX, yAt(midX, midZ) + 0.05, midZ);
    group.add(mesh);
  }

  function addInstancedTrees(group, yAt) {
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 2.0, 5);
    const canopyGeo = new THREE.ConeGeometry(2.0, 3.8, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.treeTrunk });
    const canopyMat = new THREE.MeshLambertMaterial({ color: COLORS.treeCanopy });

    // Wood lots: west of McPherson, Culp's-ish NE, Round Top slopes
    const spots = [];
    function scatter(cx, cz, n, spread) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        spots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    scatter(-70, -20, 40, 22);
    scatter(-60, 30, 35, 18);
    scatter(55, 45, 30, 16); // east woods
    scatter(40, 58, 45, 14); // Round Top woods
    scatter(20, -40, 25, 15);
    scatter(-20, -45, 20, 12);
    // also sprinkle landmarks
    [[-40, -40], [0, -50], [70, 40], [-80, 10], [15, 50]].forEach(([x, z]) => scatter(x, z, 8, 8));

    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const dummyObstacles = [];
    spots.forEach(([x, z], i) => {
      const y = yAt(x, z);
      const sc = 0.75 + Math.random() * 0.5;
      p.set(x, y + 1.0 * sc, z);
      q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, 0));
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      trunk.setMatrixAt(i, m);
      p.set(x, y + 3.2 * sc, z);
      m.compose(p, q, s);
      canopy.setMatrixAt(i, m);
      dummyObstacles.push({ position: { x, y, z }, userData: { radius: 2.2 * sc, obstacle: true } });
    });
    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
    group.add(trunk, canopy);
    return dummyObstacles;
  }

  function addDevilsDenRocks(group, yAt) {
    const geo = new THREE.DodecahedronGeometry(1.2, 0);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.rock });
    const n = 55;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const rocks = [];
    for (let i = 0; i < n; i++) {
      const x = 24 + (Math.random() - 0.5) * 18;
      const z = 48 + (Math.random() - 0.5) * 14;
      const y = yAt(x, z);
      const sc = 0.6 + Math.random() * 1.4;
      m.compose(
        new THREE.Vector3(x, y + 0.5 * sc, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random(), Math.random())),
        new THREE.Vector3(sc, sc * 0.8, sc)
      );
      mesh.setMatrixAt(i, m);
      rocks.push({ position: { x, y, z }, userData: { radius: 1.1 * sc, obstacle: true } });
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return rocks;
  }

  function addRailFences(group, yAt) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x6a5a40 });
    const segments = [
      [-40, -20, -20, -20],
      [-15, 20, 10, 22],
      [30, 30, 45, 35],
      [10, 45, 22, 48],
    ];
    segments.forEach(([x0, z0, x1, z1]) => {
      const posts = 8;
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), mat);
        post.position.set(x, yAt(x, z) + 0.55, z);
        group.add(post);
        if (i < posts - 1) {
          const x2 = x0 + (x1 - x0) * ((i + 1) / (posts - 1));
          const z2 = z0 + (z1 - z0) * ((i + 1) / (posts - 1));
          const mx = (x + x2) / 2;
          const mz = (z + z2) / 2;
          const len = Math.hypot(x2 - x, z2 - z);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.08), mat);
          rail.position.set(mx, yAt(mx, mz) + 0.7, mz);
          rail.rotation.y = -Math.atan2(z2 - z, x2 - x);
          group.add(rail);
          const rail2 = rail.clone();
          rail2.position.y = yAt(mx, mz) + 0.4;
          group.add(rail2);
        }
      }
    });
  }

  function addWheatfield(group, yAt) {
    const geo = new THREE.PlaneGeometry(22, 16);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.wheat });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const x = 18, z = 42;
    mesh.position.set(x, yAt(x, z) + 0.08, z);
    mesh.name = 'wheatfield';
    group.add(mesh);
    // Instanced stalks
    const stalkGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    const stalkMat = new THREE.MeshLambertMaterial({ color: 0xd4b85a });
    const count = 120;
    const inst = new THREE.InstancedMesh(stalkGeo, stalkMat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const sx = x + (Math.random() - 0.5) * 20;
      const sz = z + (Math.random() - 0.5) * 14;
      m.compose(
        new THREE.Vector3(sx, yAt(sx, sz) + 0.45, sz),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 0.7 + Math.random() * 0.6, 1)
      );
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  function addOrchard(group, yAt) {
    const canopyGeo = new THREE.SphereGeometry(1.4, 6, 5);
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.4, 5);
    const canopyMat = new THREE.MeshLambertMaterial({ color: COLORS.orchard });
    const trunkMat = new THREE.MeshLambertMaterial({ color: COLORS.treeTrunk });
    const rows = 4, cols = 5;
    const ox = 12, oz = 32;
    const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, rows * cols);
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, rows * cols);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * 3.5;
        const z = oz + r * 3.5;
        const y = yAt(x, z);
        m.compose(new THREE.Vector3(x, y + 0.7, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        trunk.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(x, y + 2.0, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        canopy.setMatrixAt(i, m);
        i++;
      }
    }
    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
    group.add(trunk, canopy);
  }

  function addTown(group, yAt) {
    const spots = [
      [6, 6, 4, 3.5, 4], [10, 8, 3, 4, 3], [4, 10, 3.5, 3, 3.5],
      [12, 5, 2.5, 2.5, 3], [8, 12, 4, 3, 3], [2, 4, 3, 2.8, 3],
    ];
    spots.forEach(([x, z, w, h, d], i) => {
      const y = yAt(x, z);
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: 0x6a6258 })
      );
      b.position.set(x, y + h / 2, z);
      b.name = 'town_' + i;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(w, d) * 0.65, 1.2, 4),
        new THREE.MeshLambertMaterial({ color: 0x4a3020 })
      );
      roof.position.y = h / 2 + 0.6;
      roof.rotation.y = Math.PI / 4;
      b.add(roof);
      group.add(b);
    });
  }

  function addSupply(group, x, z, team, name, yAt) {
    const g = new THREE.Group();
    g.name = name;
    const y = yAt(x, z);
    g.position.set(x, y, z);
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.2, 1.8),
      new THREE.MeshLambertMaterial({ color: team === 'union' ? COLORS.supplyUnion : COLORS.supplyCsa })
    );
    bed.position.y = 0.9;
    const canvas = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 1.0, 1.6),
      new THREE.MeshLambertMaterial({ color: 0xc8b888 })
    );
    canvas.position.y = 1.8;
    g.add(bed, canvas);
    g.userData.supply = true;
    g.userData.team = team;
    g.userData.ammo = 500;
    g.userData.radius = 4.5;
    group.add(g);
    return g;
  }

  function addBuilding(group, x, z, color, w, h, d, name, yAt) {
    const y = yAt(x, z);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.name = name;
    mesh.userData.building = true;
    mesh.userData.radius = Math.max(w, d) * 0.6;
    group.add(mesh);
    return mesh;
  }


  function addEmmitsburgFences(group, yAt) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a4a32 });
    const zones = [];
    // Two long fence lines along Emmitsburg Road corridor (roughly x=14..22, z=20..48)
    const segs = [
      [14, 22, 16, 48],
      [20, 20, 22, 46],
    ];
    segs.forEach(([x0, z0, x1, z1], si) => {
      const posts = 12;
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const y = yAt(x, z);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), mat);
        post.position.set(x, y + 0.6, z);
        group.add(post);
        if (i < posts - 1) {
          const x2 = x0 + (x1 - x0) * ((i + 1) / (posts - 1));
          const z2 = z0 + (z1 - z0) * ((i + 1) / (posts - 1));
          const mx = (x + x2) / 2, mz = (z + z2) / 2;
          const len = Math.hypot(x2 - x, z2 - z);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.1), mat);
          rail.position.set(mx, yAt(mx, mz) + 0.75, mz);
          rail.rotation.y = -Math.atan2(z2 - z, x2 - x);
          group.add(rail);
        }
        zones.push({ x, z, radius: 2.2, slow: 0.45 });
      }
    });
    return zones;
  }

  function placeWall(world, scene, x, z, yaw) {
    const y = world.heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw || 0;
    const stone = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.6, 0.7),
      new THREE.MeshLambertMaterial({ color: COLORS.wall })
    );
    stone.position.y = 0.3;
    stone.scale.y = 0.15;
    g.add(stone);
    g.name = 'wall_' + world.walls.length;
    g.userData.obstacle = true;
    g.userData.radius = 2.6;
    g.userData.buildingWall = true;
    g.userData.buildProgress = 0;
    g.userData.stone = stone;
    g.userData.blocksMovement = false;
    scene.add(g);
    world.walls.push(g);
    world.group.add(g);
    return g;
  }

  function updateWallBuild(wall, dt) {
    if (wall.userData.buildProgress >= 1) return false;
    wall.userData.buildProgress = Math.min(1, wall.userData.buildProgress + dt / 3.5);
    const p = wall.userData.buildProgress;
    const stone = wall.userData.stone;
    stone.scale.y = 0.15 + 0.85 * p;
    stone.position.y = 0.3 + 0.5 * p;
    if (p >= 1) {
      wall.userData.blocksMovement = true;
      return true;
    }
    return false;
  }


  /** Day-relative HQ positions: far rear of each side. */
  const HQ_BY_DAY = {
    1: {
      union: { x: 62, z: 38, name: "Meade's rear / Taneytown Rd" },
      csa: { x: -108, z: -6, name: 'Herr Ridge rear' },
    },
    2: {
      union: { x: 55, z: 22, name: "Cemetery Ridge rear / Meade HQ" },
      csa: { x: -20, z: 55, name: 'Longstreet rear / Warfield Ridge' },
    },
    3: {
      union: { x: 55, z: 18, name: "Taneytown Rd / Meade's HQ" },
      csa: { x: -55, z: 8, name: 'Seminary Ridge rear' },
    },
  };

  function makeTent(color, w, d, h) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h * 0.55, d),
      new THREE.MeshLambertMaterial({ color: color })
    );
    body.position.y = h * 0.28;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.72, h * 0.55, 4),
      new THREE.MeshLambertMaterial({ color: color })
    );
    roof.position.y = h * 0.75;
    roof.rotation.y = Math.PI / 4;
    g.add(body, roof);
    return g;
  }

  function createHQ(scene, world, side, day) {
    day = (day === 2 || day === 3) ? day : 1;
    const table = HQ_BY_DAY[day] || HQ_BY_DAY[1];
    const loc = table[side] || table.union;
    const g = new THREE.Group();
    g.name = 'hq_' + side;
    const isUnion = side === 'union';
    const canvasColor = isUnion ? 0xc8c4a8 : 0xb8b090;
    // tent cluster
    const t1 = makeTent(canvasColor, 3.2, 2.6, 2.4);
    t1.position.set(-2.5, 0, 0);
    const t2 = makeTent(canvasColor, 2.4, 2.2, 2.0);
    t2.position.set(1.8, 0, 1.5);
    // aid / hospital tent — slightly larger, yellow flag
    const hospital = makeTent(0xd8d0b0, 3.6, 2.8, 2.6);
    hospital.position.set(0.5, 0, -2.8);
    hospital.name = 'hospital';
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x888880 })
    );
    pole.position.set(0.5, 1.7, -2.8);
    const yFlag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshLambertMaterial({ color: 0xe8d040, side: THREE.DoubleSide })
    );
    yFlag.position.set(1.1, 3.0, -2.8);
    // national / battle flag
    const flagPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x777770 })
    );
    flagPole.position.set(-4.2, 2.1, 0.5);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshLambertMaterial({
        color: isUnion ? 0x1a2a6a : 0x8b1a1a,
        side: THREE.DoubleSide,
      })
    );
    flag.position.set(-3.3, 3.5, 0.5);
    // zone ring
    const radius = 14;
    // Soft HQ zone disc only (no thick stroke — was cluttering map as fake "range rings")
    const ring = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshBasicMaterial({
        color: isUnion ? 0x1e3a5a : 0x5a4030,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
        visible: false, // gameplay zone only — no map ring clutter
        depthWrite: false,
        depthTest: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    ring.renderOrder = 0;
    ring.name = 'hqRing';
    ring.visible = false; // hide disc — tents/flag mark HQ
    g.add(t1, t2, hospital, pole, yFlag, flagPole, flag, ring);
    const y = world.heightAt ? world.heightAt(loc.x, loc.z) : 0;
    g.position.set(loc.x, y, loc.z);
    scene.add(g);
    return {
      side,
      day,
      name: loc.name,
      x: loc.x,
      z: loc.z,
      radius,
      mesh: g,
      // not a capture objective
      isHQ: true,
    };
  }

  function createBothHQs(scene, world, day) {
    return {
      union: createHQ(scene, world, 'union', day),
      csa: createHQ(scene, world, 'csa', day),
    };
  }

  global.RTSWorld = {
    HQ_BY_DAY,
    createHQ,
    createBothHQs, createWorld, placeWall, updateWallBuild, heightAt, COLORS };
})(window);
