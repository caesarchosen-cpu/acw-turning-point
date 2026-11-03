/* Historical unit visuals + combat stats: line infantry, skirmish detachments, cavalry, Napoleon guns, officers, engineers */
(function (global) {
  'use strict';

  const TEAM = { UNION: 'union', CSA: 'csa' };
  // Always-visible overhead markers: Union solid blue, CSA solid red (never gray)
  const TEAM_MARKER = { union: 0x1e5aaf, csa: 0xcc1a1a };

  // Line infantry = heavy hitter (highest HP + DPS). Artillery longest range but lower sustained DPS.
  // Skirmisher TYPE used for detached companies AND for dismounted cavalry (derived).
  const TYPE = {
    infantry: {
      label: 'Line Infantry',
      shortLabel: 'Line',
      speed: 10,
      radius: 3.0,
      hp: 140,
      ammoMax: 80,
      range: 22,
      damage: 20,
      reload: 1.55, // DPS ≈ 12.9 — highest
      spacing: 0.55,
      ranks: 3,
      files: 6,
      rangedTaken: 1.0,
      combatRole: 'line',
      skirmishFraction: 0.1, // ~10% detachable company
    },
    skirmisher: {
      label: 'Skirmishers',
      shortLabel: 'Skirm',
      speed: 13,
      radius: 3.4,
      hp: 55,
      ammoMax: 50,
      range: 26,
      damage: 8,
      reload: 1.8, // DPS ≈ 4.4
      spacing: 1.35, // loose / spread
      ranks: 2,
      files: 4,
      rangedTaken: 0.5, // half damage from musket + artillery
      combatRole: 'skirmish',
    },
    artillery: {
      label: 'Artillery',
      shortLabel: 'Guns',
      speed: 6,
      radius: 2.0,
      hp: 100,
      ammoMax: 30,
      range: 48, // longest
      damage: 32,
      reload: 4.0, // DPS = 8.0 — below line
      spacing: 1.0,
      ranks: 1,
      files: 1,
      rangedTaken: 1.0,
      combatRole: 'artillery',
      minRange: 8, // weak / inaccurate up close
    },
    cavalry: {
      label: 'Cavalry',
      shortLabel: 'Cav',
      speed: 18, // fastest mounted
      radius: 1.6,
      hp: 55,
      ammoMax: 40,
      range: 20, // Sharps carbine reach (mounted)
      damage: 14, // Sharps baseline; revolver/saber override in combat
      reload: 1.3,
      spacing: 1.3,
      ranks: 1,
      files: 3,
      rangedTaken: 1.25, // fragile vs volleys when mounted
      combatRole: 'cavalry',
      chargeBonus: 16, // saber/revolver close burst
      mountDelay: 1.4,
      closeRangeFrac: 0.25, // within 25% of max → revolver/saber
      sharpsDamage: 14,
      revolverDamage: 18,
      saberDamage: 28,
      revolverReload: 0.9,
      saberReload: 0.7,
    },
    engineer: {
      label: 'Engineer',
      shortLabel: 'Eng',
      speed: 11,
      radius: 1.0,
      hp: 50,
      ammoMax: 20,
      range: 12,
      damage: 6,
      reload: 2.2,
      spacing: 0.6,
      ranks: 1,
      files: 3,
      rangedTaken: 1.0,
      combatRole: 'support',
    },
    officer: {
      label: 'Officer',
      shortLabel: 'Off',
      speed: 14,
      radius: 1.0,
      hp: 70,
      ammoMax: 20,
      range: 14,
      damage: 10,
      reload: 1.6,
      spacing: 0.8,
      ranks: 1,
      files: 1,
      rangedTaken: 1.0,
      combatRole: 'command',
    },
  };

  /** Dismounted cavalry = skirmisher stats, reload ~50% of skirmisher. */
  function dismountedCavalryStats() {
    const s = TYPE.skirmisher;
    return {
      speed: s.speed,
      radius: s.radius,
      range: s.range,
      damage: s.damage,
      reload: s.reload * 0.5,
      spacing: s.spacing,
      rangedTaken: s.rangedTaken,
      hpRef: s.hp,
    };
  }

  function dpsOf(def) {
    return def.damage / def.reload;
  }

  function uni(team) {
    if (team === TEAM.UNION) {
      return {
        coat: 0x1e3a6e,
        trousers: 0x7ba3c9,
        hat: 0x1a1a22,
        accent: 0xc4a35a,
        flagField: 0x1a2a6a,
        flagStripe: 0xb03030,
      };
    }
    return {
      coat: 0x6e6a5a,
      trousers: 0x8a8068,
      hat: 0x3a3428,
      accent: 0xb03030,
      flagField: 0x8b1a1a,
      flagSaltire: 0x1a2a6a,
    };
  }

  function makeMan(team, opts) {
    opts = opts || {};
    const c = uni(team);
    const g = new THREE.Group();
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.55, 0.22),
      new THREE.MeshLambertMaterial({ color: c.trousers })
    );
    legs.position.y = 0.35;
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.55, 0.24),
      new THREE.MeshLambertMaterial({ color: opts.coat || c.coat })
    );
    torso.position.y = 0.85;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xd4b090 })
    );
    head.position.y = 1.22;
    let hat;
    if (team === TEAM.UNION && !opts.slouch) {
      hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 0.16, 8),
        new THREE.MeshLambertMaterial({ color: c.hat })
      );
      hat.position.y = 1.36;
      const bill = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.03, 0.12),
        new THREE.MeshLambertMaterial({ color: 0x111118 })
      );
      bill.position.set(0, 1.30, 0.12);
      g.add(bill);
    } else {
      hat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.22, 0.1, 8),
        new THREE.MeshLambertMaterial({ color: c.hat })
      );
      hat.position.y = 1.34;
      hat.rotation.z = 0.15;
    }
    g.add(legs, torso, head, hat);
    if (opts.musket) {
      const musket = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 1.35),
        new THREE.MeshLambertMaterial({ color: 0x2a2018 })
      );
      musket.position.set(0.22, 0.95, 0.35);
      musket.name = 'musket';
      g.add(musket);
    }
    if (opts.sword) {
      const sword = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.7),
        new THREE.MeshLambertMaterial({ color: 0xc0c0c8 })
      );
      sword.position.set(-0.28, 0.9, 0.2);
      g.add(sword);
    }
    if (opts.skirmishMark) {
      // green kepi band so skirmish companies read differently at a glance
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.05, 0.22),
        new THREE.MeshLambertMaterial({ color: 0x3a8a4a })
      );
      band.position.y = 1.42;
      g.add(band);
    }
    return g;
  }

  function makeHorse(team) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.65, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
    );
    body.position.y = 0.85;
    const neck = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.55, 0.28),
      new THREE.MeshLambertMaterial({ color: 0x3a2a1a })
    );
    neck.position.set(0.7, 1.2, 0);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.25, 0.22),
      new THREE.MeshLambertMaterial({ color: 0x2a1a10 })
    );
    head.position.set(0.95, 1.35, 0);
    [[-0.45, -0.18], [-0.45, 0.18], [0.45, -0.18], [0.45, 0.18]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.7, 0.12),
        new THREE.MeshLambertMaterial({ color: 0x2a1a10 })
      );
      leg.position.set(x, 0.35, z);
      g.add(leg);
    });
    g.add(body, neck, head);
    return g;
  }

  function makeFlag(team, isArtillery) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x888880 })
    );
    pole.position.y = 1.3;
    const c = uni(team);
    let flag;
    if (team === TEAM.UNION) {
      flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.9),
        new THREE.MeshLambertMaterial({ color: isArtillery ? 0x1a2a6a : c.flagField, side: THREE.DoubleSide })
      );
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.18),
        new THREE.MeshLambertMaterial({ color: c.flagStripe, side: THREE.DoubleSide })
      );
      stripe.position.set(0, -0.25, 0.01);
      flag.add(stripe);
    } else {
      flag = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 1.2),
        new THREE.MeshLambertMaterial({ color: c.flagField, side: THREE.DoubleSide })
      );
      const s1 = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.14),
        new THREE.MeshLambertMaterial({ color: c.flagSaltire, side: THREE.DoubleSide })
      );
      s1.rotation.z = Math.PI / 4;
      s1.position.z = 0.01;
      const s2 = s1.clone();
      s2.rotation.z = -Math.PI / 4;
      flag.add(s1, s2);
    }
    flag.position.set(0.7, 2.1, 0);
    g.add(pole, flag);
    return g;
  }

  function addLineMen(g, team, ranks, files, spacing, opts) {
    opts = opts || {};
    const men = [];
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        const man = makeMan(team, { musket: true, skirmishMark: !!opts.skirmishMark });
        man.position.set((f - (files - 1) / 2) * spacing, 0, r * spacing);
        man.name = 'man';
        g.add(man);
        men.push(man);
      }
    }
    return men;
  }

  function createUnitMesh(type, team, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const def = TYPE[type] || TYPE.infantry;
    const c = uni(team);

    if (type === 'infantry') {
      const ranks = opts.ranks != null ? opts.ranks : def.ranks;
      const files = opts.files != null ? opts.files : def.files;
      const spacing = opts.spacing != null ? opts.spacing : def.spacing;
      addLineMen(g, team, ranks, files, spacing, {});
      const flag = makeFlag(team, false);
      flag.position.set(-(files * spacing) * 0.55 - 0.4, 0, 0.2);
      flag.name = 'flag';
      g.add(flag);
    } else if (type === 'skirmisher') {
      const ranks = opts.ranks != null ? opts.ranks : def.ranks;
      const files = opts.files != null ? opts.files : def.files;
      const spacing = opts.spacing != null ? opts.spacing : def.spacing;
      addLineMen(g, team, ranks, files, spacing, { skirmishMark: true });
      // no colors — green band marks them
    } else if (type === 'cavalry') {
      const horses = new THREE.Group();
      horses.name = 'horses';
      const riders = new THREE.Group();
      riders.name = 'riders';
      for (let i = 0; i < 3; i++) {
        const horse = makeHorse(team);
        horse.position.set((i - 1) * 1.3, 0, 0);
        horses.add(horse);
        const rider = makeMan(team, { musket: false, sword: true, slouch: team === TEAM.CSA });
        rider.position.set((i - 1) * 1.3, 0.85, 0);
        rider.scale.setScalar(0.95);
        // Sharps carbine slung/held
        const carbine = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.06, 1.05),
          new THREE.MeshLambertMaterial({ color: 0x2a2018 })
        );
        carbine.position.set(0.28, 0.15, 0.15);
        carbine.rotation.x = 0.15;
        carbine.name = 'carbine';
        rider.add(carbine);
        // saber already from sword:true; tag it
        rider.children.forEach((ch) => {
          if (ch.geometry && ch.geometry.parameters && ch.geometry.parameters.depth === 0.7) ch.name = 'saber';
        });
        riders.add(rider);
      }
      g.add(horses, riders);
      const dismountMen = new THREE.Group();
      dismountMen.name = 'dismountMen';
      dismountMen.visible = false;
      addLineMen(dismountMen, team, TYPE.skirmisher.ranks, TYPE.skirmisher.files, TYPE.skirmisher.spacing, { skirmishMark: true });
      g.add(dismountMen);
      const flag = makeFlag(team, false);
      flag.position.set(-2.0, 0, 0);
      flag.scale.setScalar(0.85);
      flag.name = 'flag';
      g.add(flag);
    } else if (type === 'artillery') {
      const carriage = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.45, 1.1),
        new THREE.MeshLambertMaterial({ color: 0x2a2a20 })
      );
      carriage.position.y = 0.45;
      const wheelL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.12, 12),
        new THREE.MeshLambertMaterial({ color: 0x3a2a18 })
      );
      wheelL.rotation.z = Math.PI / 2;
      wheelL.position.set(0, 0.55, 0.65);
      const wheelR = wheelL.clone();
      wheelR.position.z = -0.65;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, 2.4, 10),
        new THREE.MeshLambertMaterial({ color: 0x2a2a28 })
      );
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0.5, 0.85, 0);
      const limber = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.7, 0.9),
        new THREE.MeshLambertMaterial({ color: 0x3a3a30 })
      );
      limber.position.set(-2.2, 0.5, 0);
      g.add(carriage, wheelL, wheelR, tube, limber);
      for (let i = 0; i < 3; i++) {
        const crew = makeMan(team, { musket: false });
        crew.position.set(-0.8 + i * 0.7, 0, 1.2);
        g.add(crew);
      }
      const flag = makeFlag(team, true);
      flag.position.set(-3.0, 0, 0.5);
      flag.scale.setScalar(0.75);
      g.add(flag);
    } else if (type === 'officer') {
      const horse = makeHorse(team);
      g.add(horse);
      const off = makeMan(team, {
        sword: true,
        slouch: true,
        coat: team === TEAM.UNION ? 0x1a2a50 : 0x5a5648,
      });
      off.position.y = 0.85;
      const plume = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshLambertMaterial({ color: c.accent })
      );
      plume.position.set(0, 1.5, 0);
      off.add(plume);
      g.add(off);
    } else {
      for (let i = 0; i < 3; i++) {
        const man = makeMan(team, { musket: false, coat: 0xb8954a });
        man.position.set((i - 1) * 0.6, 0, 0);
        const shovel = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.9, 0.08),
          new THREE.MeshLambertMaterial({ color: 0x666660 })
        );
        shovel.position.set(0.3, 0.7, 0);
        man.add(shovel);
        g.add(man);
      }
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.radius * 0.92, def.radius * 1.02, 48),
      new THREE.MeshBasicMaterial({
        color: 0xc4a35a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.18;
    ring.renderOrder = 2;
    ring.visible = false;
    ring.name = 'selectionRing';
    g.add(ring);

    // Always-visible team marker over the unit (Union blue / CSA solid red)
    const teamColor = TEAM_MARKER[team] || TEAM_MARKER.csa;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 10),
      new THREE.MeshBasicMaterial({ color: teamColor })
    );
    marker.position.set(0, 3.6, 0);
    marker.name = 'teamMarker';
    marker.visible = true;
    marker.userData.teamColor = teamColor;
    marker.userData.team = team;
    g.add(marker);
    return g;
  }

  let _id = 1;

  function applyCombatStats(unit, def) {
    unit.speed = def.speed;
    unit.radius = def.radius;
    unit.range = def.range;
    unit.damage = def.damage;
    unit.reload = def.reload;
    unit.spacing = def.spacing;
    unit.rangedTaken = def.rangedTaken != null ? def.rangedTaken : 1;
    unit.minRange = def.minRange || 0;
    unit.chargeBonus = def.chargeBonus || 0;
  }

  function spawnUnit(scene, { type, team, x, z, facing, parentId }) {
    const def = TYPE[type] || TYPE.infantry;
    const mesh = createUnitMesh(type, team);
    mesh.position.set(x, 0, z);
    if (facing != null) mesh.rotation.y = facing;
    mesh.name = team + '_' + type + '_' + _id;
    const menCount = (def.ranks || 1) * (def.files || 1);
    const unit = {
      id: _id++,
      type,
      team,
      label: def.label,
      mesh,
      speed: def.speed,
      radius: def.radius,
      hp: def.hp,
      maxHp: def.hp,
      ammo: def.ammoMax,
      ammoMax: def.ammoMax,
      range: def.range,
      damage: def.damage,
      reload: def.reload,
      reloadT: 0,
      spacing: def.spacing,
      rangedTaken: def.rangedTaken != null ? def.rangedTaken : 1,
      minRange: def.minRange || 0,
      chargeBonus: def.chargeBonus || 0,
      menCount,
      maxMen: menCount,
      startMen: menCount,
      startMaxHp: def.hp,
      lastCombatAt: -9999,
      target: null,
      attackTarget: null,
      buildTarget: null,
      selected: false,
      alive: true,
      // cavalry mount state
      mounted: type === 'cavalry',
      mountBusy: 0,
      // line <-> skirmish company
      hasSkirmishCompany: type === 'infantry',
      skirmishDetached: false,
      skirmishChildId: null,
      parentId: parentId || null,
      skirmishHp: null, // reserved when attached; set on detach
    };
    applyCombatStats(unit, def);
    mesh.userData.unit = unit;
    if (type === 'officer' && window.RTSCasualties && RTSCasualties.assignOfficerName) {
      RTSCasualties.assignOfficerName(unit);
    }
    scene.add(mesh);
    return unit;
  }

  function setSelected(unit, on) {
    unit.selected = !!on;
    const ring = unit.mesh.getObjectByName('selectionRing');
    if (ring) ring.visible = !!on;
  }

  /** Rebuild line infantry men after detach/rejoin. menFraction 0..1 of full ranks*files. */
  function rebuildInfantryVisual(unit, menFraction) {
    if (unit.type !== 'infantry' && unit.type !== 'skirmisher') return;
    const def = TYPE[unit.type];
    const full = def.ranks * def.files;
    const keep = Math.max(1, Math.round(full * Math.max(0.05, Math.min(1, menFraction))));
    // remove existing men
    const toRemove = [];
    unit.mesh.children.forEach((ch) => {
      if (ch.name === 'man' && !ch.userData.fallen && !ch.userData.falling) toRemove.push(ch);
    });
    toRemove.forEach((ch) => unit.mesh.remove(ch));
    const spacing = def.spacing;
    // approximate ranks/files for remaining
    let ranks = def.ranks;
    let files = Math.max(1, Math.ceil(keep / ranks));
    if (keep < def.files) {
      ranks = 1;
      files = keep;
    } else {
      files = def.files;
      ranks = Math.max(1, Math.ceil(keep / files));
    }
    let placed = 0;
    for (let r = 0; r < ranks && placed < keep; r++) {
      for (let f = 0; f < files && placed < keep; f++) {
        const man = makeMan(unit.team, {
          musket: true,
          skirmishMark: unit.type === 'skirmisher',
        });
        man.position.set((f - (files - 1) / 2) * spacing, 0, r * spacing);
        man.name = 'man';
        unit.mesh.add(man);
        placed++;
      }
    }
    unit.menCount = keep;
  }

  function setCavalryMounted(unit, mounted) {
    if (unit.type !== 'cavalry') return;
    unit.mounted = !!mounted;
    const horses = unit.mesh.getObjectByName('horses');
    const riders = unit.mesh.getObjectByName('riders');
    const dis = unit.mesh.getObjectByName('dismountMen');
    if (horses) horses.visible = unit.mounted;
    if (riders) riders.visible = unit.mounted;
    if (dis) dis.visible = !unit.mounted;
    if (unit.mounted) {
      applyCombatStats(unit, TYPE.cavalry);
      unit.label = TYPE.cavalry.label;
    } else {
      const d = dismountedCavalryStats();
      unit.speed = d.speed;
      unit.radius = d.radius;
      unit.range = d.range;
      unit.damage = d.damage;
      unit.reload = d.reload;
      unit.spacing = d.spacing;
      unit.rangedTaken = d.rangedTaken;
      unit.minRange = 0;
      unit.chargeBonus = 0;
      unit.label = 'Cavalry (dismounted)';
    }
  }

  function measureSpacing(unit) {
    const men = unit.mesh.children.filter((c) => c.name === 'man');
    if (unit.type === 'cavalry' && !unit.mounted) {
      const dis = unit.mesh.getObjectByName('dismountMen');
      if (dis) {
        const dm = dis.children.filter((c) => c.name === 'man');
        if (dm.length >= 2) {
          let min = 1e9;
          for (let i = 0; i < dm.length; i++) {
            for (let j = i + 1; j < dm.length; j++) {
              const d = Math.hypot(dm[i].position.x - dm[j].position.x, dm[i].position.z - dm[j].position.z);
              if (d > 0.05 && d < min) min = d;
            }
          }
          return min === 1e9 ? unit.spacing : min;
        }
      }
    }
    if (men.length < 2) return unit.spacing;
    let min = 1e9;
    for (let i = 0; i < men.length; i++) {
      for (let j = i + 1; j < men.length; j++) {
        const d = Math.hypot(men[i].position.x - men[j].position.x, men[i].position.z - men[j].position.z);
        if (d > 0.05 && d < min) min = d;
      }
    }
    return min === 1e9 ? unit.spacing : min;
  }

  function spawnDay1Armies(scene) {
    const units = [];
    // Union — Buford cavalry screen + Reynolds I Corps (line majority)
    [[-52, -8], [-48, -2], [-50, 6], [-46, 12]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.UNION, x, z, facing: -Math.PI / 2 }));
    });
    [[-30, -6], [-26, 0], [-28, 8], [-22, 4], [-24, -10], [5, 5], [10, 10]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.UNION, x, z, facing: -Math.PI / 2 }));
    });
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x: -44, z: 2, facing: -Math.PI / 2 }));
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x: 40, z: 26, facing: -Math.PI / 2 }));
    [[-42, -6], [-40, 2], [38, 18]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.UNION, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: -47, z: 0, facing: -Math.PI / 2 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 36, z: 24, facing: -Math.PI / 2 }));

    // CSA
    [[-90, -12], [-88, -4], [-92, 4]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.CSA, x, z, facing: Math.PI / 2 }));
    });
    [[-95, -8], [-93, 0], [-96, 8], [-100, -4], [-98, 12], [-85, 15], [-82, -18]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 2 }));
    });
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x: -100, z: 0, facing: Math.PI / 2 }));
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x: -97, z: -14, facing: Math.PI / 2 }));
    [[-88, -8], [-86, 2], [-84, 6]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.CSA, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: -91, z: -2, facing: Math.PI / 2 }));

    return units;
  }

  function spawnDay2Armies(scene) {
    const units = [];
    [[36, 54], [33, 57], [38, 52]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.UNION, x, z, facing: Math.PI }));
    });
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x: 34, z: 58, facing: Math.PI }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 35, z: 56, facing: Math.PI }));
    [[24, 48], [20, 44], [26, 42], [18, 48]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.UNION, x, z, facing: Math.PI * 0.9 }));
    });
    [[28, 34], [22, 36], [30, 30], [26, 38], [32, 32], [20, 32]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.UNION, x, z, facing: -Math.PI * 0.7 }));
    });
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x: 27, z: 33, facing: -Math.PI * 0.7 }));
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x: 42, z: 26, facing: -Math.PI / 2 }));
    [[40, 48], [45, 40]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.UNION, x, z, facing: Math.PI }));
    });
    [[30, 28], [38, 50], [24, 36]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.UNION, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 26, z: 34, facing: -Math.PI * 0.7 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 44, z: 28, facing: -Math.PI / 2 }));

    [[5, 28], [8, 34], [2, 32], [10, 30], [0, 36], [6, 38]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 4 }));
    });
    [[12, 42], [8, 46], [14, 48], [10, 50], [4, 44], [16, 40]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 5 }));
    });
    [[20, 58], [18, 55], [22, 60], [15, 56]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 6 }));
    });
    [[8, 40], [12, 52], [4, 50]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.CSA, x, z, facing: Math.PI / 4 }));
    });
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x: 2, z: 30, facing: Math.PI / 4 }));
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x: 6, z: 48, facing: Math.PI / 5 }));
    units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x: -2, z: 42, facing: Math.PI / 4 }));
    [[4, 34], [10, 44], [14, 54]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.CSA, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: 6, z: 36, facing: Math.PI / 4 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: 16, z: 52, facing: Math.PI / 6 }));
    return units;
  }

  function spawnDay3Armies(scene) {
    const units = [];
    const uInf = [
      [22, 30], [24, 32], [26, 34], [28, 32], [30, 30], [27, 36], [25, 38],
      [20, 34], [32, 34], [29, 38], [23, 36], [31, 28], [21, 28], [33, 32],
      [19, 36], [34, 36], [26, 28], [28, 40],
    ];
    uInf.forEach(([x, z]) => units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.UNION, x, z, facing: -Math.PI * 0.65 })));
    [[24, 34], [30, 33], [27, 30], [22, 38]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.UNION, x, z, facing: -Math.PI * 0.65 }));
    });
    [[36, 40], [40, 28], [18, 42]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.UNION, x, z, facing: -Math.PI / 2 }));
    });
    [[25, 31], [29, 35], [32, 29]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.UNION, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 27, z: 33, facing: -Math.PI * 0.65 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 24, z: 36, facing: -Math.PI * 0.65 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.UNION, x: 42, z: 26, facing: -Math.PI / 2 }));

    const cInfPickett = [
      [-32, 20], [-28, 18], [-30, 24], [-26, 22], [-34, 16], [-24, 26], [-36, 22], [-22, 18],
    ];
    cInfPickett.forEach(([x, z]) => units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 3 })));
    const cInfPettigrew = [
      [-40, 8], [-36, 6], [-38, 12], [-34, 4], [-42, 10], [-30, 2], [-44, 6], [-28, 8], [-46, 12],
    ];
    cInfPettigrew.forEach(([x, z]) => units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 3.2 })));
    const cInfTrimble = [
      [-38, 28], [-34, 30], [-36, 34], [-32, 32], [-40, 26], [-30, 36], [-42, 32],
    ];
    cInfTrimble.forEach(([x, z]) => units.push(spawnUnit(scene, { type: 'infantry', team: TEAM.CSA, x, z, facing: Math.PI / 2.8 })));
    [[-45, 10], [-42, 18], [-40, 26], [-48, 14], [-38, 6], [-46, 22]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'artillery', team: TEAM.CSA, x, z, facing: Math.PI / 3 }));
    });
    [[-50, 8], [-35, 38], [-28, 14]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'cavalry', team: TEAM.CSA, x, z, facing: Math.PI / 3 }));
    });
    [[-36, 14], [-40, 24], [-32, 10]].forEach(([x, z]) => {
      units.push(spawnUnit(scene, { type: 'engineer', team: TEAM.CSA, x, z }));
    });
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: -30, z: 20, facing: Math.PI / 3 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: -38, z: 8, facing: Math.PI / 3 }));
    units.push(spawnUnit(scene, { type: 'officer', team: TEAM.CSA, x: -36, z: 30, facing: Math.PI / 3 }));
    return units;
  }

  function spawnArmies(scene, day) {
    if (day === 3) return spawnDay3Armies(scene);
    if (day === 2) return spawnDay2Armies(scene);
    return spawnDay1Armies(scene);
  }

  /** Pick cavalry weapon by distance; returns { weapon, damage, reload, consumesAmmo, kind }. */
  function cavalryWeaponAt(unit, dist) {
    const def = TYPE.cavalry;
    const maxR = unit.mounted ? (unit.range || def.range) : (unit.range || TYPE.skirmisher.range);
    const close = maxR * (def.closeRangeFrac || 0.25);
    if (!unit.mounted) {
      return {
        weapon: 'Sharps carbine',
        damage: TYPE.skirmisher.damage,
        reload: unit.reload,
        consumesAmmo: true,
        kind: 'musket',
      };
    }
    if (dist > close) {
      return {
        weapon: 'Sharps carbine',
        damage: def.sharpsDamage || def.damage,
        reload: def.reload,
        consumesAmmo: true,
        kind: 'musket',
      };
    }
    // Close: revolver then saber — prefer saber on contact (< 2.5)
    if (dist <= 2.5) {
      return {
        weapon: 'Saber',
        damage: (def.saberDamage || 28) + (def.chargeBonus || 0) * 0.25,
        reload: def.saberReload || 0.7,
        consumesAmmo: false,
        kind: 'melee',
      };
    }
    return {
      weapon: 'Revolver',
      damage: def.revolverDamage || 18,
      reload: def.revolverReload || 0.9,
      consumesAmmo: true,
      kind: 'musket',
    };
  }

  function teamMarkerColor(team) {
    return TEAM_MARKER[team] || TEAM_MARKER.csa;
  }

  global.RTSUnits = {
    TEAM,
    TEAM_MARKER,
    teamMarkerColor,
    TYPE,
    dpsOf,
    dismountedCavalryStats,
    cavalryWeaponAt,
    spawnUnit,
    setSelected,
    setCavalryMounted,
    rebuildInfantryVisual,
    measureSpacing,
    applyCombatStats,
    spawnDay1Armies,
    spawnDay2Armies,
    spawnDay3Armies,
    spawnArmies,
  };
})(window);
