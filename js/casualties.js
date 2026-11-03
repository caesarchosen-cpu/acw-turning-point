/* Total War-style per-figure casualties, callouts, blood/dust FX.
   Ranks/surnames period-plausible; officers keep unit commander names. */
(function (global) {
  'use strict';

  const MAX_CALLOUTS = 4;
  const CALLOUT_LIFE = 1.5;
  const BODY_LINGER = 14.0; // seconds corpse stays before fade
  const BODY_FADE = 3.5;

  const RANKS = [
    { rank: 'Private', w: 70 },
    { rank: 'Corporal', w: 15 },
    { rank: 'Sergeant', w: 10 },
    { rank: 'Lieutenant', w: 3.5 },
    { rank: 'Captain', w: 1.5 },
  ];

  // Mid-19th c. Anglo-American surnames common in Civil War rolls (PD lists / census-era)
  const SURNAMES = [
    'Adams','Allen','Anderson','Bailey','Baker','Barnes','Bell','Bennett','Brooks','Brown',
    'Bryant','Burke','Burns','Campbell','Carter','Clark','Cole','Collins','Cook','Cooper',
    'Cox','Crawford','Davis','Dixon','Edwards','Evans','Fisher','Foster','Fox','Freeman',
    'Gibson','Graham','Grant','Gray','Green','Griffin','Hall','Hamilton','Harris','Harrison',
    'Hayes','Henderson','Hill','Howard','Hughes','Hunt','Jackson','Jenkins','Johnson','Jones',
    'Kelly','Kennedy','King','Lee','Lewis','Long','Martin','Mason','McCarthy','McDonald',
    'Miller','Mitchell','Moore','Morgan','Morris','Murphy','Murray','Nelson','Parker','Patterson',
    'Perry','Peterson','Phillips','Powell','Price','Quinn','Reed','Reynolds','Richards','Riley',
    'Roberts','Robinson','Rogers','Ross','Russell','Ryan','Scott','Shaw','Simpson','Smith',
    'Stewart','Sullivan','Taylor','Thomas','Thompson','Turner','Walker','Walsh','Ward','Warren',
    'Washington','Watson','Webb','Wells','White','Williams','Wilson','Wood','Wright','Young',
  ];

  const OFFICER_NAMES = {
    union: [
      'Buford', 'Reynolds', 'Howard', 'Hancock', 'Slocum', 'Sykes', 'Sedgwick',
      'Doubleday', 'Robinson', 'Wadsworth', 'Birney', 'Hays', 'Gibbon', 'Caldwell',
    ],
    csa: [
      'Hill', 'Ewell', 'Longstreet', 'Heth', 'Pender', 'Rodes', 'Early',
      'Anderson', 'McLaws', 'Hood', 'Pickett', 'Pettigrew', 'Trimble', 'Lane',
    ],
  };

  let _surnameI = 0;
  let _offI = { union: 0, csa: 0 };

  function pickWeightedRank(rng) {
    const r = (rng || Math.random)() * 100;
    let acc = 0;
    for (const row of RANKS) {
      acc += row.w;
      if (r <= acc) return row.rank;
    }
    return 'Private';
  }

  function pickSurname() {
    const s = SURNAMES[_surnameI % SURNAMES.length];
    _surnameI++;
    return s;
  }

  function assignOfficerName(unit) {
    const side = unit.team === 'union' ? 'union' : 'csa';
    const list = OFFICER_NAMES[side];
    const name = list[_offI[side] % list.length];
    _offI[side]++;
    unit.commanderName = name;
    unit.label = (unit.team === 'union' ? 'Gen. ' : 'Gen. ') + name;
    // Keep TYPE label sense in panel via short form
    unit.officerName = name;
    return name;
  }

  function soldierIdentity(unit, isKill) {
    if (unit.type === 'officer' && (unit.officerName || unit.commanderName)) {
      const nm = unit.officerName || unit.commanderName;
      return { rank: 'General', surname: nm, text: 'Gen. ' + nm };
    }
    // Command figures on infantry sometimes get lieutenant/captain when unit nearly dead
    const rank = pickWeightedRank();
    const surname = pickSurname();
    return { rank, surname, text: rank + ' ' + surname };
  }

  // ---- Callout sprites ----
  // Subline painted large on canvas so on-screen Killed/Wounded stays >= ~11px.
  const CALLOUT_CLUSTER_PX = 40;
  const CALLOUT_CLUSTER_WORLD = 6.0; // whole infantry company footprint
  const CALLOUT_STACK_GAP_PX = 2;
  const CALLOUT_LABEL_H_PX = 40; // approximate on-screen label block height used for stacking

  function makeCalloutSprite(text, kind) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fill = kind === 'killed' ? '#e8d4a8' : kind === 'mixed' ? '#e0d3b8' : '#d8c8a0';
    const sub = kind === 'killed' ? '#d07060' : kind === 'wounded' ? '#d4b45a' : '#c4a35a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(8,6,3,0.95)';
    ctx.font = 'bold 38px "Palatino Linotype", Palatino, "Times New Roman", Georgia, serif';
    ctx.fillStyle = fill;
    ctx.strokeText(text, 256, 42);
    ctx.fillText(text, 256, 42);
    // Bigger subline for legibility (~11px+ on screen at typical camera)
    ctx.font = 'bold 30px "Palatino Linotype", Palatino, "Times New Roman", Georgia, serif';
    ctx.lineWidth = 6;
    ctx.fillStyle = sub;
    let tag = 'Wounded';
    if (kind === 'killed') tag = 'Killed';
    else if (kind === 'mixed') tag = 'Casualties';
    ctx.strokeText(tag, 256, 88);
    ctx.fillText(tag, 256, 88);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 1,
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(5.6, 1.25, 1);
    spr.renderOrder = 20;
    spr.userData.isCallout = true;
    return spr;
  }

  function disposeCalloutEntry(scene, c) {
    if (!c || !c.spr) return;
    scene.remove(c.spr);
    if (c.spr.material) {
      if (c.spr.material.map) c.spr.material.map.dispose();
      c.spr.material.dispose();
    }
  }

  // ---- FX ----
  function spawnDust(scene, pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x6a5a40, transparent: true, opacity: 0.55, depthWrite: false })
    );
    mesh.position.copy(pos);
    mesh.position.y = 0.25;
    scene.add(mesh);
    return { mesh, t: 0, life: 0.7, kind: 'dust' };
  }

  function spawnBlood(scene, pos) {
    // Tasteful small dark-red spray — a few droplets, not gore
    const group = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.04, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x4a1010, transparent: true, opacity: 0.85, depthWrite: false })
      );
      d.position.set((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
      d.userData.vx = (Math.random() - 0.5) * 1.2;
      d.userData.vy = 1.2 + Math.random() * 1.5;
      d.userData.vz = (Math.random() - 0.5) * 1.2;
      group.add(d);
    }
    group.position.copy(pos);
    scene.add(group);
    return { mesh: group, t: 0, life: 0.55, kind: 'blood' };
  }

  // ---- Fall poses ----
  function applyFallPose(man, pose) {
    // Reset then apply plausible collapse. Living rifle remains along +Z of man.
    man.rotation.set(0, man.rotation.y, 0);
    if (pose === 'back') {
      man.rotation.x = -Math.PI / 2 + 0.15;
      man.position.y = 0.15;
    } else if (pose === 'side') {
      man.rotation.z = Math.PI / 2;
      man.rotation.x = -0.2;
      man.position.y = 0.18;
    } else {
      // kneel-collapse
      man.rotation.x = -1.0;
      man.position.y = 0.35;
      man.scale.y = 0.85;
    }
    man.userData.fallen = true;
    man.userData.fallPose = pose;
  }

  function createSystem(scene, camera) {
    const callouts = []; // { spr, life, world }
    const fx = [];
    const bodies = []; // { man, unit, age, fade }
    const pendingFalls = []; // stagger then fall

    function prioritizeScore(unit, selectedSet, camPos) {
      let s = 0;
      if (selectedSet && selectedSet.has(unit)) s += 100;
      if (unit.team === (window.__RTS__ && __RTS__.playerSide && __RTS__.playerSide())) s += 40;
      const dx = unit.mesh.position.x - camPos.x;
      const dy = unit.mesh.position.y - camPos.y;
      const dz = unit.mesh.position.z - camPos.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      s += Math.max(0, 60 - dist * 0.6);
      return s;
    }

    function projectCallout(c) {
      const rise = (c.age / c.life) * 1.4;
      const wp = new THREE.Vector3(c.world.x, c.baseY + rise + (c.stackWorldY || 0), c.world.z);
      const sp = wp.clone().project(camera);
      const w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      const h = (typeof window !== 'undefined' && window.innerHeight) || 720;
      return {
        x: (sp.x * 0.5 + 0.5) * w,
        y: (-sp.y * 0.5 + 0.5) * h,
        behind: sp.z > 1,
        world: wp,
      };
    }

    function worldPerScreenPixel(atPos) {
      const dist = camera.position.distanceTo(atPos);
      const vFov = (camera.fov * Math.PI) / 180;
      const h = (typeof window !== 'undefined' && window.innerHeight) || 720;
      return (2 * Math.tan(vFov * 0.5) * dist) / h;
    }

    function enforceCalloutCap(score) {
      while (callouts.length >= MAX_CALLOUTS) {
        let worst = 0;
        for (let i = 1; i < callouts.length; i++) {
          if (callouts[i].score < callouts[worst].score) worst = i;
        }
        if (score <= callouts[worst].score) return false;
        const dead = callouts.splice(worst, 1)[0];
        disposeCalloutEntry(scene, dead);
      }
      return true;
    }

    function retargetGroupSprite(c) {
      let text;
      let gkind;
      if (c.killedN > 0 && c.woundedN === 0) {
        text = c.killedN + ' killed';
        gkind = 'killed';
      } else if (c.woundedN > 0 && c.killedN === 0) {
        text = c.woundedN + ' wounded';
        gkind = 'wounded';
      } else {
        text = (c.killedN + c.woundedN) + ' casualties';
        gkind = 'mixed';
      }
      disposeCalloutEntry(scene, c);
      c.text = text;
      c.kind = gkind;
      c.isGroup = true;
      c.count = c.killedN + c.woundedN;
      c.spr = makeCalloutSprite(text, gkind);
      c.spr.position.set(c.world.x, c.baseY + (c.stackWorldY || 0), c.world.z);
      scene.add(c.spr);
    }

    function tryCallout(unit, worldPos, kind, selected) {
      const id = soldierIdentity(unit, kind === 'killed');
      const camPos = camera.position;
      const selectedSet = new Set(selected || []);
      const score = prioritizeScore(unit, selectedSet, camPos);
      const killAdd = kind === 'killed' ? 1 : 0;
      const woundAdd = kind === 'killed' ? 0 : 1;
      const unitKey = unit && (unit.id != null ? unit.id : unit);

      // Prefer same-unit absorb (company pile), else screen/world cluster
      let near = null;
      let nearDist = Infinity;
      let nearPri = 99;
      for (const c of callouts) {
        const sameUnit = c.unitKey === unitKey;
        const wdx = c.world.x - worldPos.x;
        const wdz = c.world.z - worldPos.z;
        const wd = Math.hypot(wdx, wdz);
        const pr = projectCallout(c);
        const prNew = projectCallout({
          world: worldPos, baseY: worldPos.y + 2.2, age: 0, life: CALLOUT_LIFE, stackWorldY: 0,
        });
        const sd = Math.hypot(pr.x - prNew.x, pr.y - prNew.y);
        const cluster = sameUnit || wd <= CALLOUT_CLUSTER_WORLD || sd <= CALLOUT_CLUSTER_PX;
        if (!cluster) continue;
        const pri = sameUnit ? 0 : 1;
        if (pri < nearPri || (pri === nearPri && wd < nearDist)) {
          nearPri = pri;
          nearDist = wd;
          near = c;
        }
      }

      if (near) {
        const nextTotal = (near.killedN || 0) + (near.woundedN || 0) + 1;
        // Absorb only when already a group, or this hit would push the cluster past 2
        // (≤2 stay as individual nameplates and get stacked by layoutCallouts)
        if (near.isGroup || nextTotal > 2) {
          near.killedN = (near.killedN || 0) + killAdd;
          near.woundedN = (near.woundedN || 0) + woundAdd;
          near.score = Math.max(near.score, score);
          near.age = Math.min(near.age, 0.15);
          near.world.x = near.world.x * 0.75 + worldPos.x * 0.25;
          near.world.z = near.world.z * 0.75 + worldPos.z * 0.25;
          near.world.y = worldPos.y;
          near.baseY = near.world.y + 2.2;
          near.unitKey = unitKey;
          retargetGroupSprite(near);
          layoutCallouts();
          return { entry: near, id, absorbed: true };
        }
        // else fall through and add a second individual for stacking
      }

      if (!enforceCalloutCap(score)) return null;

      const spr = makeCalloutSprite(id.text, kind);
      spr.position.set(worldPos.x, worldPos.y + 2.2, worldPos.z);
      scene.add(spr);
      const entry = {
        spr,
        life: CALLOUT_LIFE,
        age: 0,
        score,
        kind,
        baseY: worldPos.y + 2.2,
        world: worldPos.clone(),
        text: id.text,
        isGroup: false,
        count: 1,
        killedN: killAdd,
        woundedN: woundAdd,
        stackWorldY: 0,
        unitKey,
      };
      callouts.push(entry);
      layoutCallouts();
      return { entry, id };
    }

    /** Screen-space de-overlap: merge >2 within ~40px into group tag; else stack with ~2px gap. */
    function layoutCallouts() {
      if (!callouts.length) return;
      // Refresh projections
      const proj = callouts.map((c, i) => ({ i, c, p: projectCallout(c) }));
      // Union-find clusters by screen distance
      const parent = proj.map((_, i) => i);
      function find(a) { return parent[a] === a ? a : (parent[a] = find(parent[a])); }
      function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
      for (let a = 0; a < proj.length; a++) {
        for (let b = a + 1; b < proj.length; b++) {
          const dx = proj[a].p.x - proj[b].p.x;
          const dy = proj[a].p.y - proj[b].p.y;
          const screenNear = Math.hypot(dx, dy) <= CALLOUT_CLUSTER_PX;
          const wdx = proj[a].c.world.x - proj[b].c.world.x;
          const wdz = proj[a].c.world.z - proj[b].c.world.z;
          const worldNear = Math.hypot(wdx, wdz) <= CALLOUT_CLUSTER_WORLD;
          if (screenNear || worldNear) uni(a, b);
        }
      }
      const groups = new Map();
      proj.forEach((row, idx) => {
        const r = find(idx);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(row);
      });

      const keep = [];
      const removeIdx = new Set();

      groups.forEach((members) => {
        members.sort((a, b) => a.p.y - b.p.y || b.c.score - a.c.score);
        if (members.length > 2 || members.filter((m) => m.c.isGroup).length >= 1 && members.length >= 2) {
          // Merge into one group tag (also collapse stray group + neighbors)
          let killedN = 0;
          let woundedN = 0;
          let score = 0;
          let cx = 0;
          let cy = 0;
          let cz = 0;
          members.forEach((m) => {
            killedN += m.c.killedN || 0;
            woundedN += m.c.woundedN || 0;
            score = Math.max(score, m.c.score);
            cx += m.c.world.x;
            cy += m.c.baseY;
            cz += m.c.world.z;
            removeIdx.add(m.i);
          });
          const n = members.length;
          cx /= n; cy /= n; cz /= n;
          const total = Math.max(1, killedN + woundedN);
          let text;
          let kind;
          if (killedN > 0 && woundedN === 0) {
            text = killedN + ' killed';
            kind = 'killed';
          } else if (woundedN > 0 && killedN === 0) {
            text = woundedN + ' wounded';
            kind = 'wounded';
          } else {
            text = total + ' casualties';
            kind = 'mixed';
          }
          const age = Math.min(...members.map((m) => m.c.age));
          const groundY = members.reduce((s, m) => s + m.c.world.y, 0) / n;
          const baseY = groundY + 2.2;
          const spr = makeCalloutSprite(text, kind);
          spr.position.set(cx, baseY, cz);
          scene.add(spr);
          keep.push({
            spr,
            life: CALLOUT_LIFE,
            age,
            score,
            kind,
            baseY,
            world: new THREE.Vector3(cx, groundY, cz),
            text,
            isGroup: true,
            count: total,
            killedN,
            woundedN,
            stackWorldY: 0,
            unitKey: members[0].c.unitKey,
          });
        } else {
          // Stack vertically in screen space (~2px gap)
          let stackPx = 0;
          members.forEach((m, idx) => {
            const c = m.c;
            const wpp = worldPerScreenPixel(m.p.world);
            // Screen Y grows downward; stack upward on screen => decrease screen Y => raise world Y
            c.stackWorldY = stackPx * wpp;
            stackPx += CALLOUT_LABEL_H_PX + CALLOUT_STACK_GAP_PX;
            keep.push(c);
          });
        }
      });

      // Dispose merged-away entries
      if (removeIdx.size) {
        const next = [];
        callouts.forEach((c, i) => {
          if (removeIdx.has(i)) disposeCalloutEntry(scene, c);
        });
        // rebuild from keep (already has unmerged + new groups)
        callouts.length = 0;
        keep.forEach((c) => callouts.push(c));
        // Cap after merge
        callouts.sort((a, b) => b.score - a.score);
        while (callouts.length > MAX_CALLOUTS) {
          disposeCalloutEntry(scene, callouts.pop());
        }
        callouts.forEach((c) => {
          const rise = (c.age / c.life) * 1.4;
          c.spr.position.set(c.world.x, c.baseY + rise + (c.stackWorldY || 0), c.world.z);
        });
      } else {
        // Only stacking offsets changed; snap sprite positions now
        callouts.forEach((c) => {
          if (c.stackWorldY == null) c.stackWorldY = 0;
          const rise = (c.age / c.life) * 1.4;
          c.spr.position.set(c.world.x, c.baseY + rise + c.stackWorldY, c.world.z);
        });
      }

      // Final pass: collapse any remaining nearby tags into one readable callout
      collapseNearbyCallouts();
    }

    function collapseNearbyCallouts() {
      if (callouts.length <= 1) return;
      let changed = true;
      while (changed) {
        changed = false;
        outer:
        for (let i = 0; i < callouts.length; i++) {
          for (let j = i + 1; j < callouts.length; j++) {
            const a = callouts[i];
            const b = callouts[j];
            const wd = Math.hypot(a.world.x - b.world.x, a.world.z - b.world.z);
            const pa = projectCallout(a);
            const pb = projectCallout(b);
            const sd = Math.hypot(pa.x - pb.x, pa.y - pb.y);
            if (wd > CALLOUT_CLUSTER_WORLD && sd > CALLOUT_CLUSTER_PX) continue;
            const mergedTotal = (a.killedN || 0) + (a.woundedN || 0) + (b.killedN || 0) + (b.woundedN || 0);
            // Only collapse into a group tag when >2; leave pairs for stacking
            if (!(a.isGroup || b.isGroup || mergedTotal > 2)) continue;
            a.killedN = (a.killedN || 0) + (b.killedN || 0);
            a.woundedN = (a.woundedN || 0) + (b.woundedN || 0);
            a.score = Math.max(a.score, b.score);
            a.age = Math.min(a.age, b.age);
            a.world.x = (a.world.x + b.world.x) * 0.5;
            a.world.z = (a.world.z + b.world.z) * 0.5;
            a.world.y = Math.min(a.world.y, b.world.y);
            a.baseY = a.world.y + 2.2;
            if (a.unitKey == null) a.unitKey = b.unitKey;
            disposeCalloutEntry(scene, b);
            callouts.splice(j, 1);
            retargetGroupSprite(a);
            changed = true;
            break outer;
          }
        }
      }
      // If still 2 within cluster after merges of pairs into groups, stack them
      if (callouts.length === 2) {
        const wd = Math.hypot(callouts[0].world.x - callouts[1].world.x, callouts[0].world.z - callouts[1].world.z);
        if (wd <= CALLOUT_CLUSTER_WORLD) {
          const wpp = worldPerScreenPixel(callouts[0].spr.position);
          callouts.sort((a, b) => b.score - a.score);
          callouts[0].stackWorldY = 0;
          callouts[1].stackWorldY = (CALLOUT_LABEL_H_PX + CALLOUT_STACK_GAP_PX) * wpp;
        }
      }
      callouts.forEach((c) => {
        const rise = (c.age / c.life) * 1.4;
        c.spr.position.set(c.world.x, c.baseY + rise + (c.stackWorldY || 0), c.world.z);
      });
    }

    function livingMen(unit) {
      if (!unit || !unit.mesh) return [];
      const out = [];
      unit.mesh.traverse((ch) => {
        if (ch.name === 'man' && ch.visible && !ch.userData.fallen && !ch.userData.falling) out.push(ch);
      });
      return out;
    }

    function pickMan(unit) {
      const men = livingMen(unit);
      if (!men.length) return null;
      return men[Math.floor(Math.random() * men.length)];
    }

    function hitFigure(unit, opts) {
      opts = opts || {};
      const killed = !!opts.killed;
      const man = opts.man || pickMan(unit);
      if (!man) {
        // Still show callout at unit center if no discrete man (artillery/wagon skip figures)
        if (unit.type === 'artillery' || unit.type === 'wagon') return null;
        const wp = unit.mesh.position.clone();
        wp.y += 1.2;
        tryCallout(unit, wp, killed ? 'killed' : 'wounded', opts.selected);
        return null;
      }

      const world = new THREE.Vector3();
      man.getWorldPosition(world);

      tryCallout(unit, world, killed ? 'killed' : 'wounded', opts.selected);
      fx.push(spawnDust(scene, world));
      fx.push(spawnBlood(scene, world));

      // Stagger / clutch then fall if killed; wounded flinch only
      man.userData.falling = true;
      man.userData.fallT = 0;
      man.userData.willDie = killed;
      man.userData.clutch = true;
      man.userData.baseRotX = man.rotation.x;
      man.userData.pose = ['back', 'side', 'kneel'][Math.floor(Math.random() * 3)];
      pendingFalls.push({ man, unit, killed });
      return man;
    }

    function update(dt, selected) {
      // Callouts rise + fade, then de-overlap in screen space
      for (let i = callouts.length - 1; i >= 0; i--) {
        const c = callouts[i];
        c.age += dt;
        const u = c.age / c.life;
        const rise = u * 1.4;
        c.spr.position.set(c.world.x, c.baseY + rise + (c.stackWorldY || 0), c.world.z);
        c.spr.material.opacity = Math.max(0, 1 - u * u);
        if (c.age >= c.life) {
          disposeCalloutEntry(scene, c);
          callouts.splice(i, 1);
        }
      }
      if (callouts.length) layoutCallouts();

      // Pending stagger → fall
      for (let i = pendingFalls.length - 1; i >= 0; i--) {
        const p = pendingFalls[i];
        const man = p.man;
        if (!man.parent) { pendingFalls.splice(i, 1); continue; }
        man.userData.fallT = (man.userData.fallT || 0) + dt;
        const t = man.userData.fallT;
        if (t < 0.18) {
          // stagger back
          man.rotation.x = (man.userData.baseRotX || 0) - t * 1.2;
          man.position.z -= dt * 0.4;
        } else if (t < 0.45) {
          // clutch (lean)
          man.rotation.x = (man.userData.baseRotX || 0) - 0.35;
          man.rotation.z = Math.sin(t * 20) * 0.05;
        } else if (p.killed || t > 0.55) {
          applyFallPose(man, man.userData.pose || 'back');
          man.userData.falling = false;
          bodies.push({ man, unit: p.unit, age: 0 });
          pendingFalls.splice(i, 1);
        } else {
          // wounded recovery
          man.rotation.x *= 0.85;
          man.rotation.z *= 0.85;
          if (t > 0.7) {
            man.rotation.x = 0;
            man.rotation.z = 0;
            man.userData.falling = false;
            man.userData.clutch = false;
            pendingFalls.splice(i, 1);
          }
        }
      }

      // Bodies linger then fade
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        b.age += dt;
        if (b.age > BODY_LINGER) {
          const fadeU = (b.age - BODY_LINGER) / BODY_FADE;
          b.man.traverse((ch) => {
            if (ch.material) {
              if (!ch.material.transparent) {
                ch.material = ch.material.clone();
                ch.material.transparent = true;
              }
              ch.material.opacity = Math.max(0, 1 - fadeU);
            }
          });
          if (fadeU >= 1) {
            if (b.man.parent) b.man.parent.remove(b.man);
            bodies.splice(i, 1);
          }
        }
      }

      // FX
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.t += dt;
        const u = f.t / f.life;
        if (f.kind === 'dust') {
          f.mesh.scale.setScalar(1 + u * 2.5);
          f.mesh.material.opacity = 0.55 * (1 - u);
          f.mesh.position.y += dt * 0.6;
        } else if (f.kind === 'blood') {
          f.mesh.children.forEach((d) => {
            d.position.x += d.userData.vx * dt;
            d.position.y += d.userData.vy * dt;
            d.position.z += d.userData.vz * dt;
            d.userData.vy -= 6 * dt;
            if (d.material) d.material.opacity = 0.85 * (1 - u);
          });
        }
        if (u >= 1) {
          scene.remove(f.mesh);
          fx.splice(i, 1);
        }
      }
    }

    function onUnitDamaged(unit, dmgApplied, killedUnit, selected) {
      if (!unit || unit.isWagon) return;
      // Convert damage into figure events
      const maxMen = Math.max(1, unit.maxMen || livingMen(unit).length || 1);
      const hpPer = (unit.maxHp || 100) / maxMen;
      let events = Math.max(1, Math.round(dmgApplied / Math.max(4, hpPer * 0.65)));
      events = Math.min(events, 3);
      if (killedUnit) {
        // Drop remaining living figures as killed (staggered)
        const men = livingMen(unit);
        men.forEach((man, i) => {
          setTimeout(() => {
            if (!man.parent) return;
            hitFigure(unit, { killed: true, man, selected });
          }, i * 70);
        });
        // One callout guaranteed for commander / random
        return;
      }
      for (let i = 0; i < events; i++) {
        const isKill = Math.random() < 0.45 || dmgApplied > hpPer;
        hitFigure(unit, { killed: isKill, selected });
      }
    }

    function clear() {
      callouts.forEach((c) => disposeCalloutEntry(scene, c));
      callouts.length = 0;
      fx.forEach((f) => scene.remove(f.mesh));
      fx.length = 0;
      pendingFalls.length = 0;
      bodies.length = 0;
    }

    return {
      update,
      onUnitDamaged,
      hitFigure,
      tryCallout,
      clearCallouts() {
        while (callouts.length) disposeCalloutEntry(scene, callouts.pop());
      },
      clear,
      callouts,
      livingMen,
    };
  }

  /** Ensure muskets / rifles point along local +Z (muzzle forward) for living men. */
  function auditAllFacing(units) {
    const report = { checked: 0, fixed: 0, ok: 0, issues: [] };
    (units || []).forEach((u) => {
      if (!u || !u.alive || !u.mesh) return;
      u.mesh.traverse((ch) => {
        if (ch.name !== 'man' || ch.userData.fallen) return;
        report.checked++;
        // Find musket child
        let musket = null;
        ch.traverse((m) => {
          if (m.name === 'musket') musket = m;
        });
        if (!musket) {
          // try unlabeled long box along Z
          ch.children.forEach((c) => {
            if (c.geometry && c.geometry.parameters && c.geometry.parameters.depth >= 1.0) musket = c;
          });
        }
        if (!musket) { report.ok++; return; }
        // Musket should extend in +Z relative to man; position.z > 0 and not rotated oddly
        const okPos = musket.position.z >= 0.15;
        const okRot = Math.abs(musket.rotation.y) < 0.35 && Math.abs(musket.rotation.x) < 0.35;
        if (!okPos || !okRot) {
          musket.rotation.set(0, 0, 0);
          musket.position.set(0.22, 0.95, 0.35);
          musket.name = 'musket';
          report.fixed++;
          report.issues.push({ unit: u.id, type: u.type });
        } else {
          musket.name = 'musket';
          report.ok++;
        }
      });
    });
    report.pass = report.fixed === 0 || report.ok + report.fixed === report.checked;
    return report;
  }

  global.RTSCasualties = {
    createSystem,
    assignOfficerName,
    auditAllFacing,
    pickWeightedRank,
    SURNAMES,
    RANKS,
    MAX_CALLOUTS,
    CALLOUT_LIFE,
  };
})(window);
