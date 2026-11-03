/* Core battle loop: select, move, combat, volleys, skirmish detach, cavalry mount */
(function (global) {
  'use strict';

  const MOVE_MARKER_LIFE = 1.6;
  const COMMENCE_WINDOW = 8.0;

  function createGame(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    // Overcast tan/gray-brown — NO light-blue clear, NO split sky texture (was washing out the scene on real GPUs)
    renderer.setClearColor(0x8a7d65, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Fog removed: light-blue Fog(0x87a0b8, 90, 220) could swallow units on desktop GPUs.
    scene.fog = null;
    // Solid Color background (no CanvasTexture split) — reliable across drivers
    scene.background = new THREE.Color(0x8a7d65);

    const camCtrl = RTSCamera.createCamera(
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight)
    );

    const world = RTSWorld.createWorld(scene);
    let units = [];
    let playerSide = 'union';
    let currentDay = 1;
    let barrageActive = false;
    let barrageT = 0;
    const BARRAGE_DURATION = 60;
    let barrageFx = [];
    let chargeStarted = false;
    let hqs = null;
    let wagons = [];
    let depots = [];
    let selected = [];
    let buildMode = false;
    let poolAmmo = 200;
    let running = false;
    let objectives = null;
    let lastObjIndex = 0;
    let briefedComplete = false;
    let moveMarkers = [];
    let shotFx = [];
    let uFacingAudit = null;
    let casualtySys = (window.RTSCasualties && RTSCasualties.createSystem)
      ? RTSCasualties.createSystem(scene, camCtrl.camera)
      : null;
    let fireAtWill = true; // false = Hold Fire (no autonomous volleys)
    let hoverUnit = null;
    let ringBright = false; // C-key flash brighten
    let ringBrightT = 0;
    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const selectBoxEl = document.getElementById('selectBox');

    function groundHit(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camCtrl.camera);
      const hits = raycaster.intersectObject(world.ground);
      if (hits.length) {
        const pt = hits[0].point.clone();
        if (world.heightAt) pt.y = world.heightAt(pt.x, pt.z);
        return pt;
      }
      return null;
    }

    function unitAtScreen(clientX, clientY, anyTeam) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camCtrl.camera);
      const pool = units.concat(wagons);
      const meshes = pool
        .filter((u) => u.alive && (anyTeam || u.team === playerSide))
        .map((u) => u.mesh);
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length) return null;
      let obj = hits[0].object;
      while (obj && !obj.userData.unit) obj = obj.parent;
      return obj && obj.userData.unit ? obj.userData.unit : null;
    }

    function enemyAtScreen(clientX, clientY) {
      const u = unitAtScreen(clientX, clientY, true);
      if (u && u.team !== playerSide && u.alive) return u;
      // enemy wagons
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camCtrl.camera);
      const meshes = wagons.filter((w) => w.alive && w.team !== playerSide).map((w) => w.mesh);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !obj.userData.wagon) obj = obj.parent;
        if (obj && obj.userData.wagon) return obj.userData.wagon;
      }
      return null;
    }

    function clearSelection() {
      selected.forEach((u) => {
        if (u.isWagon) {
          u.selected = false;
          const ring = u.mesh.getObjectByName('selectionRing');
          if (ring) ring.visible = false;
        } else {
          RTSUnits.setSelected(u, false);
        }
      });
      selected = [];
      refreshSelectionUi();
      setBuildMode(false);
    }

    function selectUnits(list, additive) {
      if (!additive) clearSelection();
      list.forEach((u) => {
        if (u.team !== playerSide || !u.alive) return;
        if (selected.indexOf(u) >= 0) return;
        if (u.isWagon) {
          u.selected = true;
          const ring = u.mesh.getObjectByName('selectionRing');
          if (ring) ring.visible = true;
        } else {
          RTSUnits.setSelected(u, true);
        }
        selected.push(u);
      });
      refreshSelectionUi();
    }

    function refreshSelectionUi() {
      RTSHUD.updateSelection(selected, {
        fireAtWill,
        onFireUnit: fireUnitDirect,
        onToggleFireMode: toggleFireMode,
        onMountToggle: toggleMountSelected,
        onSkirmishToggle: toggleSkirmishSelected,
      });
      updateActionButtons();
      updateRangeRings();
    }

    function updateActionButtons() {
      const cav = selected.filter((u) => u.alive && u.type === 'cavalry');
      const btnM = document.getElementById('btnMountToggle');
      if (btnM) {
        const enable = cav.length > 0 && cav.every((u) => u.mountBusy <= 0);
        btnM.disabled = !enable;
        btnM.classList.toggle('disabled', !enable);
        if (cav.length) {
          const allDismounted = cav.every((u) => !u.mounted);
          btnM.textContent = allDismounted ? 'Mount (F)' : 'Dismount (F)';
        } else {
          btnM.textContent = 'Dismount (F)';
        }
      }
      const canDetach = selected.filter(
        (u) => u.alive && u.type === 'infantry' && u.hasSkirmishCompany && !u.skirmishDetached
      );
      const canRejoin = selected.filter(
        (u) => u.alive && u.type === 'skirmisher' && u.parentId
      );
      const btnK = document.getElementById('btnSkirmishToggle');
      if (btnK) {
        const enable = canDetach.length > 0 || canRejoin.length > 0;
        btnK.disabled = !enable;
        btnK.classList.toggle('disabled', !enable);
        if (canRejoin.length && !canDetach.length) btnK.textContent = 'Rejoin (K)';
        else btnK.textContent = 'Detach Skirmishers (K)';
      }
    }

    function setBuildMode(on) {
      buildMode = !!on && selected.some((u) => u.type === 'engineer');
      RTSHUD.setBuildMode(buildMode);
    }

    function formationOffset(u, i, n, point) {
      const spacing = (u.spacing || 1.2) * 1.8;
      const ang = (i / Math.max(n, 1)) * Math.PI * 2;
      const rad = n > 1 ? spacing * (0.4 + Math.floor(i / 6) * 0.7) : 0;
      return {
        x: point.x + Math.cos(ang) * rad,
        z: point.z + Math.sin(ang) * rad,
      };
    }

    function issueMove(point) {
      if (!selected.length || !point) return;
      const n = selected.length;
      selected.forEach((u, i) => {
        const off = formationOffset(u, i, n, point);
        u.target = { x: off.x, z: off.z };
        u.buildTarget = null;
        u.attackTarget = null;
        u.orderKind = 'move';
      });
      addMoveMarker(point.x, point.z, 0xc4a35a);
      RTSHUD.setStatus(`Move order — ${n} unit${n > 1 ? 's' : ''}`);
    }

    function issueAttack(enemy) {
      if (!selected.length || !enemy) return;
      selected.forEach((u) => {
        u.attackTarget = enemy;
        u.orderKind = 'attack';
        // approach to own weapon range
        const dx = enemy.mesh.position.x - u.mesh.position.x;
        const dz = enemy.mesh.position.z - u.mesh.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        const stop = Math.max(u.minRange || 0, (u.range || 10) * 0.85);
        if (dist > stop) {
          u.target = {
            x: enemy.mesh.position.x - (dx / dist) * stop,
            z: enemy.mesh.position.z - (dz / dist) * stop,
          };
        } else {
          u.target = null;
        }
      });
      addMoveMarker(enemy.mesh.position.x, enemy.mesh.position.z, 0xb03030);
      RTSHUD.setStatus(`Attack — ${enemy.label}`);
    }

    function addMoveMarker(x, z, color) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1.0, 20),
        new THREE.MeshBasicMaterial({
          color: color || 0xc4a35a,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        })
      );
      m.rotation.x = -Math.PI / 2;
      const y = world.heightAt ? world.heightAt(x, z) + 0.08 : 0.08;
      m.position.set(x, y, z);
      scene.add(m);
      moveMarkers.push({ mesh: m, t: MOVE_MARKER_LIFE });
    }

    function issueBuild(point) {
      const eng = selected.filter((u) => u.type === 'engineer' && u.alive);
      if (!eng.length || !point) {
        setBuildMode(false);
        return;
      }
      const wall = RTSWorld.placeWall(world, scene, point.x, point.z, camCtrl.state.yaw);
      eng.forEach((u, i) => {
        const ang = (i / eng.length) * Math.PI * 2;
        u.target = {
          x: point.x + Math.cos(ang) * 2.2,
          z: point.z + Math.sin(ang) * 2.2,
        };
        u.buildTarget = wall;
      });
      setBuildMode(false);
      RTSHUD.setStatus('Engineers raising breastworks');
    }

    function boxSelect(start, end, additive) {
      const x1 = Math.min(start.x, end.x);
      const x2 = Math.max(start.x, end.x);
      const y1 = Math.min(start.y, end.y);
      const y2 = Math.max(start.y, end.y);
      if (x2 - x1 < 4 && y2 - y1 < 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const picked = [];
      units.concat(wagons).forEach((u) => {
        if (!u.alive || u.team !== playerSide) return;
        u.mesh.updateMatrixWorld(true);
        const sp = u.mesh.position.clone().project(camCtrl.camera);
        const sx = (sp.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-sp.y * 0.5 + 0.5) * rect.height + rect.top;
        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2 && sp.z < 1 && isFinite(sx) && isFinite(sy)) picked.push(u);
      });
      selectUnits(picked, !!additive);
    }

    function showBox(start, end) {
      if (!start || !end) {
        selectBoxEl.style.display = 'none';
        return;
      }
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      selectBoxEl.style.display = 'block';
      selectBoxEl.style.left = x + 'px';
      selectBoxEl.style.top = y + 'px';
      selectBoxEl.style.width = w + 'px';
      selectBoxEl.style.height = h + 'px';
    }

    function capturePointAt(clientX, clientY) {
      if (!objectives) return null;
      const pt = groundHit(clientX, clientY);
      if (!pt) return null;
      for (let i = 0; i < objectives.chain.length; i++) {
        const c = objectives.chain[i];
        if (Math.hypot(pt.x - c.x, pt.z - c.z) <= (c.radius || 10) + 2) return c;
      }
      return null;
    }

    function issueContextOrder(e) {
      // Priority: enemy → parent regiment (rejoin) → capture point → ground move
      const enemy = enemyAtScreen(e.clientX, e.clientY);
      if (enemy) {
        issueAttack(enemy);
        return;
      }
      const friend = unitAtScreen(e.clientX, e.clientY, false);
      if (friend && friend.type === 'infantry') {
        const rejoining = selected.filter(
          (u) => u.type === 'skirmisher' && u.parentId === friend.id
        );
        if (rejoining.length) {
          rejoining.forEach((u) => {
            u.target = { x: friend.mesh.position.x, z: friend.mesh.position.z };
            u.rejoinPending = true;
          });
          addMoveMarker(friend.mesh.position.x, friend.mesh.position.z, 0x6bcf8e);
          RTSHUD.setStatus('Skirmishers rejoining regiment');
          return;
        }
      }
      const cap = capturePointAt(e.clientX, e.clientY);
      if (cap) {
        issueMove({ x: cap.x, z: cap.z });
        RTSHUD.setStatus(`Move to capture — ${cap.name}`);
        return;
      }
      const p = groundHit(e.clientX, e.clientY);
      if (p) issueMove(p);
    }

    // ---- Combat -----------------------------------------------------------

    /** Thin full circle ring; radial width scales with camera distance ≈ constant screen stroke. */
    function makeThinRangeRingMesh(name, color, opacity) {
      // Unit ring in local XZ; outer/inner near 1 so scale = world radius.
      // depthTest false + lift avoids terrain z-fight broken arcs.
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.988, 1.0, 96),
        new THREE.MeshBasicMaterial({
          color: color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: opacity,
          depthWrite: false,
          depthTest: false,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.28;
      mesh.name = name;
      mesh.visible = true; // visibility controlled by parent rangeRingGroup
      mesh.renderOrder = 3;
      return mesh;
    }

    function ensureRangeRing(u) {
      let g = u.mesh.getObjectByName('rangeRingGroup');
      if (!g) {
        g = new THREE.Group();
        g.name = 'rangeRingGroup';
        g.visible = false;
        const maxR = makeThinRangeRingMesh('rangeRingMax', 0xa89050, 0.55);
        const effR = makeThinRangeRingMesh('rangeRingEff', 0xa89050, 0.28);
        g.add(maxR, effR);
        u.mesh.add(g);
      }
      // Hide any legacy thick ring leftover
      const legacy = u.mesh.getObjectByName('rangeRing');
      if (legacy) { legacy.visible = false; legacy.parent && legacy.parent.remove(legacy); }
      return g;
    }

    function updateRangeRings() {
      const nSel = selected.filter((u) => u.alive).length;
      // Fade overlaps when many selected
      const baseOp = nSel > 6 ? 0.12 : nSel > 3 ? 0.2 : 0.42;
      const dist = (camCtrl && camCtrl.state && camCtrl.state.distance) || 55;
      // world radial thickness for ~2px screen stroke at this distance/FOV
      const stroke = Math.max(0.05, Math.min(0.4, dist * 0.004));

      // Hard-hide every range group first (selected-only rule)
      units.forEach((u) => {
        if (!u.mesh) return;
        const g0 = u.mesh.getObjectByName('rangeRingGroup');
        if (g0) g0.visible = false;
        const legacy = u.mesh.getObjectByName('rangeRing');
        if (legacy) legacy.visible = false;
      });

      units.forEach((u) => {
        if (!u.alive) return;
        const g = ensureRangeRing(u);
        const show = selected.indexOf(u) >= 0;
        g.visible = show;
        if (!show) return;

        const Rmax = Math.max(2, u.range || 10);
        const Reff = Math.max(1.2, Rmax * 0.7);
        const maxR = g.getObjectByName('rangeRingMax');
        const effR = g.getObjectByName('rangeRingEff');
        // Rebuild geometry edges for stroke width: RingGeometry(inner, outer) with outer=1
        const applyStroke = (mesh, radius) => {
          const inner = Math.max(0.5, 1 - stroke / Math.max(radius, 0.01));
          if (!mesh.userData.strokeInner || Math.abs(mesh.userData.strokeInner - inner) > 0.01) {
            mesh.geometry.dispose();
            mesh.geometry = new THREE.RingGeometry(inner, 1.0, 96);
            mesh.userData.strokeInner = inner;
          }
          mesh.scale.set(radius, radius, 1);
          // Snap ring height to local ground under unit
          const wy = world.heightAt ? world.heightAt(u.mesh.position.x, u.mesh.position.z) : 0;
          mesh.position.y = (wy - u.mesh.position.y) + 0.28;
        };
        applyStroke(maxR, Rmax);
        applyStroke(effR, Reff);

        let color = 0xa89050; // brass — not faction blue (markers already show side)
        let op = baseOp;
        if (hoverUnit === u || ringBright) { op = Math.min(0.75, baseOp + 0.35); color = 0xd4a84a; }
        if (u.attackTarget && u.attackTarget.alive) color = 0xb07050;
        maxR.material.color.setHex(color);
        maxR.material.opacity = op;
        effR.material.color.setHex(color);
        effR.material.opacity = op * 0.45;
      });
    }

    function findNearestEnemy(u, maxRange) {
      let best = null;
      let bestD = maxRange;
      units.forEach((o) => {
        if (!o.alive || o.team === u.team) return;
        const d = Math.hypot(o.mesh.position.x - u.mesh.position.x, o.mesh.position.z - u.mesh.position.z);
        if (d < bestD && d >= (u.minRange || 0)) {
          bestD = d;
          best = o;
        }
      });
      return best ? { unit: best, dist: bestD } : null;
    }

    function applyDamage(attacker, target, amount, kind) {
      if (!target || !target.alive) return 0;
      let dmg = amount;
      const ranged = kind === 'ranged' || kind === 'artillery' || kind === 'musket';
      if (ranged && !target.isWagon) {
        const mod = target.rangedTaken != null ? target.rangedTaken : 1;
        dmg *= mod;
      }
      if (target.isWagon && kind === 'artillery') dmg *= 2.5;
      target.hp -= dmg;
      target.lastHit = { by: attacker && attacker.id, dmg, kind, t: performance.now() };
      target.lastCombatAt = performance.now() / 1000;
      if (attacker) attacker.lastCombatAt = performance.now() / 1000;
      const willDie = target.hp <= 0;
      if (!target.isWagon && casualtySys) {
        casualtySys.onUnitDamaged(target, dmg, willDie, selected);
      }
      if (willDie) {
        if (target.isWagon) destroyWagon(target, kind === 'artillery');
        else killUnit(target);
      } else if (!target.isWagon && target.maxMen) {
        const frac = Math.max(0, target.hp / target.maxHp);
        target.menCount = Math.max(1, Math.round(target.maxMen * frac));
      }
      return dmg;
    }

    function killUnit(u) {
      if (!u.alive) return;
      u.alive = false;
      u.hp = 0;
      u.target = null;
      u.attackTarget = null;
      u.deathAt = performance.now() / 1000;
      // Orphan skirmish children
      if (u.type === 'infantry' && u.skirmishChildId) {
        const child = units.find((x) => x.id === u.skirmishChildId);
        if (child && child.alive) {
          child.parentId = null;
          child.label = 'Skirmishers (independent)';
        }
      }
      // If a skirmisher dies, free parent's company slot as lost
      if (u.type === 'skirmisher' && u.parentId) {
        const parent = units.find((x) => x.id === u.parentId);
        if (parent && parent.alive) {
          parent.skirmishChildId = null;
          parent.skirmishDetached = false;
          parent.hasSkirmishCompany = false; // company destroyed
        }
      }
      // Keep mesh so fallen figures linger; hide selection chrome
      const ring = u.mesh.getObjectByName('selectionRing');
      if (ring) ring.visible = false;
      const marker = u.mesh.getObjectByName('teamMarker');
      if (marker) marker.visible = false;
      const rr = u.mesh.getObjectByName('rangeRingGroup');
      if (rr) rr.visible = false;
      u._corpseUntil = (performance.now() / 1000) + 16;
      const idx = selected.indexOf(u);
      if (idx >= 0) selected.splice(idx, 1);
      refreshSelectionUi();
    }

    function spawnMuzzleFx(from, to, color) {
      const geo = new THREE.SphereGeometry(0.25, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: color || 0x222218 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(from);
      scene.add(mesh);
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x888880, transparent: true, opacity: 0.5 })
      );
      smoke.position.copy(from);
      smoke.position.y += 1.0;
      scene.add(smoke);
      shotFx.push({ mesh, smoke, from: from.clone(), to: to.clone(), t: 0, life: 0.55 });
    }

    function canFireNow(u) {
      if (!u.alive || u.reloadT > 0 || (u.mountBusy > 0)) return false;
      if (u.ammo > 0) return true;
      // Out of ammo: cavalry may still saber-charge if an enemy is in contact range
      if (u.type === 'cavalry') {
        const hit = findNearestEnemy(u, 2.5);
        return !!hit;
      }
      return false;
    }

    /** Direct order: fire immediately if loaded and any enemy within max range. */
    function fireUnitDirect(u) {
      if (!u || !u.alive) return { ok: false, reason: 'dead' };
      if (u.reloadT > 0) return { ok: false, reason: 'reloading' };
      const hit = findNearestEnemy(u, u.range || 10);
      if (u.ammo <= 0) {
        // Only melee saber permitted without ammo
        if (!(u.type === 'cavalry' && hit && hit.dist <= 2.5)) return { ok: false, reason: 'noammo' };
      }
      if (!hit) return { ok: false, reason: 'norange' };
      return resolveShot(u, hit.unit, hit.dist, 'Ordered-direct');
    }

    function resolveShot(u, target, dist, mark) {
      let kind = u.type === 'artillery' ? 'artillery' : 'musket';
      let dmg = u.damage || 8;
      let consumesAmmo = true;
      let weaponName = u.type === 'artillery' ? 'Napoleon' : (u.type === 'infantry' || u.type === 'skirmisher' ? 'Musket' : 'Small arms');
      if (u.type === 'cavalry') {
        const wpn = RTSUnits.cavalryWeaponAt(u, dist);
        kind = wpn.kind;
        dmg = wpn.damage;
        consumesAmmo = wpn.consumesAmmo;
        weaponName = wpn.weapon;
        u.currentWeapon = weaponName;
        u.reload = wpn.reload;
        // Close-range pistol/saber flash
        if (wpn.weapon === 'Revolver' || wpn.weapon === 'Saber') {
          const flash = new THREE.Mesh(
            new THREE.SphereGeometry(wpn.weapon === 'Saber' ? 0.55 : 0.35, 6, 6),
            new THREE.MeshBasicMaterial({
              color: wpn.weapon === 'Saber' ? 0xb8a878 : 0xd4a84a,
              transparent: true,
              opacity: 0.85,
            })
          );
          flash.position.copy(u.mesh.position);
          flash.position.y += 1.5;
          scene.add(flash);
          setTimeout(() => scene.remove(flash), 180);
        }
      } else {
        u.currentWeapon = weaponName;
      }
      const dealt = applyDamage(u, target, dmg, kind);
      if (u.type === 'artillery') {
        wagons.forEach((w) => {
          if (!w.alive || w.team === u.team) return;
          const wd = Math.hypot(w.mesh.position.x - target.mesh.position.x, w.mesh.position.z - target.mesh.position.z);
          if (wd < 6) destroyWagon(w, true);
        });
      }
      if (consumesAmmo) {
        u.ammo = Math.max(0, u.ammo - 1);
        if (window.RTSLogistics) RTSLogistics.updateAmmoMarker(u);
      }
      u.reloadT = u.reload || 1.5;
      u.lastVolley = { mark: mark || 'Cmd', t: performance.now(), targetId: target.id, dealt, weapon: weaponName, consumesAmmo };
      u.mesh.rotation.y = Math.atan2(
        target.mesh.position.x - u.mesh.position.x,
        target.mesh.position.z - u.mesh.position.z
      );
      const from = u.mesh.position.clone(); from.y += 1.4;
      const to = target.mesh.position.clone(); to.y += 1.2;
      if (kind !== 'melee') spawnMuzzleFx(from, to, u.type === 'artillery' ? 0x1a1a14 : 0x333328);
      return { ok: true, dealt, mark: mark || 'Cmd', targetId: target.id, weapon: weaponName, consumesAmmo };
    }

    /**
     * C hotkey:
     *  - 1 selected → Ordered-direct immediate
     *  - many selected → Ordered-discretion commence-firing window (~8s), staggered
     */
    function commenceFiringSelection() {
      const list = selected.filter((u) => u.alive);
      if (!list.length) return;
      ringBright = true;
      ringBrightT = 0.45;
      updateRangeRings();
      if (list.length === 1) {
        const r = fireUnitDirect(list[0]);
        RTSHUD.setStatus(r.ok ? `Ordered-direct volley` : `Cannot fire (${r.reason})`);
        refreshSelectionUi();
        return;
      }
      // Discretionary group order — each commander evaluates with jitter
      list.forEach((u) => {
        u.commenceDeadline = COMMENCE_WINDOW;
        u.commenceDelay = 0.15 + Math.random() * 2.8; // natural commander delay
        u.commenceArmed = true;
        u.commenceMark = 'Ordered-discretion';
      });
      RTSHUD.setStatus(`Commence firing — ${list.length} commanders evaluating`);
    }

    function updateCommence(dt) {
      units.forEach((u) => {
        if (!u.alive || !u.commenceArmed) return;
        u.commenceDelay -= dt;
        u.commenceDeadline -= dt;
        if (u.commenceDelay > 0) return;
        if (u.commenceDeadline <= 0) {
          u.commenceArmed = false;
          return;
        }
        // Commander conditions: loaded + enemy in effective range
        if (!canFireNow(u)) {
          // keep waiting until window ends
          return;
        }
        const hit = findNearestEnemy(u, u.range || 10);
        if (!hit) return; // not yet / never — window may expire
        resolveShot(u, hit.unit, hit.dist, u.commenceMark || 'Ordered-discretion');
        u.commenceArmed = false;
      });
    }

    function updateAutonomousFire(dt) {
      if (barrageActive) return;
      units.forEach((u) => {
        if (!u.alive) return;
        if (u.commenceArmed) return; // under explicit order window
        // Hold Fire only restrains the player's army; enemy AI always fires at will
        if (u.team === playerSide && !fireAtWill) return;
        if (!canFireNow(u)) return;
        const hit = findNearestEnemy(u, u.range || 10);
        if (!hit) return;
        // Prefer attackTarget if ordered
        let target = hit.unit;
        let dist = hit.dist;
        if (u.attackTarget && u.attackTarget.alive) {
          const d = Math.hypot(
            u.attackTarget.mesh.position.x - u.mesh.position.x,
            u.attackTarget.mesh.position.z - u.mesh.position.z
          );
          if (d <= (u.range || 10) && d >= (u.minRange || 0)) {
            target = u.attackTarget;
            dist = d;
          }
        }
        resolveShot(u, target, dist, 'Cmd');
      });
    }

    function toggleFireMode() {
      fireAtWill = !fireAtWill;
      RTSHUD.setStatus(fireAtWill ? 'Fire at Will' : 'Hold Fire');
      refreshSelectionUi();
    }

    // ---- Cavalry mount / dismount (F) ------------------------------------

    function toggleMountSelected() {
      const cav = selected.filter((u) => u.alive && u.type === 'cavalry' && u.mountBusy <= 0);
      if (!cav.length) return false;
      const shouldMount = cav.every((u) => !u.mounted);
      cav.forEach((u) => {
        u.mountBusy = (RTSUnits.TYPE.cavalry.mountDelay || 1.4);
        u._mountTo = shouldMount;
        u.target = null;
      });
      RTSHUD.setStatus(shouldMount ? 'Mounting…' : 'Dismounting…');
      updateActionButtons();
      return true;
    }

    function updateMount(dt) {
      units.forEach((u) => {
        if (u.type !== 'cavalry' || !(u.mountBusy > 0)) return;
        u.mountBusy -= dt;
        if (u.mountBusy <= 0) {
          u.mountBusy = 0;
          RTSUnits.setCavalryMounted(u, !!u._mountTo);
          u._mountTo = undefined;
          refreshSelectionUi();
        }
      });
    }

    // ---- Skirmish detach / rejoin (K) ------------------------------------

    function detachSkirmish(parent) {
      if (!parent || parent.type !== 'infantry' || !parent.hasSkirmishCompany || parent.skirmishDetached) {
        return null;
      }
      const frac = RTSUnits.TYPE.infantry.skirmishFraction || 0.1;
      const skHp = Math.max(20, Math.round(parent.maxHp * frac));
      const skMen = Math.max(1, Math.round(parent.maxMen * frac));
      // Shrink parent
      parent.hp = Math.max(1, parent.hp - skHp);
      parent.maxHp = Math.max(parent.hp, parent.maxHp - skHp);
      RTSUnits.rebuildInfantryVisual(parent, (parent.menCount - skMen) / parent.maxMen);
      parent.skirmishDetached = true;
      parent.hasSkirmishCompany = true;

      const facing = parent.mesh.rotation.y;
      const forwardX = Math.sin(facing);
      const forwardZ = Math.cos(facing);
      const child = RTSUnits.spawnUnit(parent.mesh.parent || scene, {
        type: 'skirmisher',
        team: parent.team,
        x: parent.mesh.position.x + forwardX * 6,
        z: parent.mesh.position.z + forwardZ * 6,
        facing,
        parentId: parent.id,
      });
      // Place into units list
      if (units.indexOf(child) < 0) units.push(child);
      child.hp = skHp;
      child.maxHp = skHp;
      child.parentId = parent.id;
      child.skirmishHp = skHp;
      parent.skirmishChildId = child.id;
      if (window.RTSLogistics) RTSLogistics.applyUnitAmmoCaps(child);
      // Advance ahead of the line
      child.target = {
        x: parent.mesh.position.x + forwardX * 14,
        z: parent.mesh.position.z + forwardZ * 14,
      };
      if (world.heightAt) {
        child.mesh.position.y = world.heightAt(child.mesh.position.x, child.mesh.position.z);
      }
      return child;
    }

    function tryRejoin(skirm) {
      if (!skirm || skirm.type !== 'skirmisher' || !skirm.parentId || !skirm.alive) return false;
      const parent = units.find((x) => x.id === skirm.parentId && x.alive);
      if (!parent) {
        skirm.parentId = null;
        skirm.label = 'Skirmishers (independent)';
        return false;
      }
      const d = Math.hypot(
        skirm.mesh.position.x - parent.mesh.position.x,
        skirm.mesh.position.z - parent.mesh.position.z
      );
      if (d > 3.5) return false;
      // Merge: restore men/HP (casualties carry — only remaining skirm HP returns)
      const addHp = Math.max(0, skirm.hp);
      parent.hp += addHp;
      parent.maxHp += addHp;
      const frac = RTSUnits.TYPE.infantry.skirmishFraction || 0.1;
      const restoreMen = Math.max(1, Math.round(parent.maxMen * frac * (skirm.hp / (skirm.maxHp || skirm.hp || 1))));
      const newMen = Math.min(parent.maxMen, parent.menCount + restoreMen);
      RTSUnits.rebuildInfantryVisual(parent, newMen / parent.maxMen);
      parent.skirmishDetached = false;
      parent.skirmishChildId = null;
      parent.hasSkirmishCompany = true;
      // Remove skirmisher unit
      skirm.alive = false;
      scene.remove(skirm.mesh);
      const si = selected.indexOf(skirm);
      if (si >= 0) selected.splice(si, 1);
      RTSHUD.setStatus('Skirmish company rejoined');
      refreshSelectionUi();
      return true;
    }

    function toggleSkirmishSelected() {
      const rejoining = selected.filter((u) => u.alive && u.type === 'skirmisher' && u.parentId);
      if (rejoining.length) {
        rejoining.forEach((u) => {
          const parent = units.find((x) => x.id === u.parentId && x.alive);
          if (!parent) {
            u.parentId = null;
            u.label = 'Skirmishers (independent)';
            return;
          }
          u.target = { x: parent.mesh.position.x, z: parent.mesh.position.z };
          u.rejoinPending = true;
        });
        RTSHUD.setStatus('Skirmishers marching to rejoin');
        updateActionButtons();
        return true;
      }
      const parents = selected.filter(
        (u) => u.alive && u.type === 'infantry' && u.hasSkirmishCompany && !u.skirmishDetached
      );
      if (!parents.length) return false;
      parents.forEach((p) => detachSkirmish(p));
      RTSHUD.setStatus('Skirmish company detached');
      refreshSelectionUi();
      return true;
    }

    // ---- Input ------------------------------------------------------------

    const input = RTSInput.createInput(renderer.domElement, {
      onKeyDown(e) {
        if (!running) return;
        if (e.code === 'KeyB') {
          if (selected.some((u) => u.type === 'engineer')) setBuildMode(!buildMode);
        }
        if (e.code === 'KeyF') {
          // Cavalry mount/dismount — only if cavalry selected
          toggleMountSelected();
        }
        if (e.code === 'KeyK') {
          toggleSkirmishSelected();
        }
        if (e.code === 'KeyC') {
          commenceFiringSelection();
        }
        if (e.code === 'KeyH') {
          toggleFireMode();
        }
        if (e.code === 'Escape') setBuildMode(false);
      },
      onLmbDown() {},
      onBoxDrag(a, b) { showBox(a, b); },
      onBoxEnd() { showBox(null); },
      onLmbUp(e, wasBox, start, end) {
        if (!running) return;
        if (buildMode) {
          const p = groundHit(e.clientX, e.clientY);
          if (p) issueBuild(p);
          return;
        }
        if (wasBox) {
          boxSelect(start, end, e.shiftKey);
          return;
        }
        const u = unitAtScreen(e.clientX, e.clientY);
        if (u) selectUnits([u], e.shiftKey);
        else if (!e.shiftKey) clearSelection();
      },
      onRmb(e) {
        if (!running) return;
        if (buildMode) {
          setBuildMode(false);
          return;
        }
        issueContextOrder(e);
      },
    });

    // Touch / mobile controls (PWA + Capacitor WebView)
    input.touchPad = { x: 0, y: 0 };
    input.touchPan = { x: 0, y: 0 };
    input.pinchZoom = 1;
    input.touchUi = !!(window.RTSTouch && RTSTouch.isTouchPreferred());
    if (input.touchUi) document.body.classList.add('touch-ui');
    if (window.RTSTouch) {
      RTSTouch.createTouch(renderer.domElement, {
        onLongPress(e) {
          if (!running) return;
          issueContextOrder(e);
        },
        onCancelBox() {
          input.boxSelecting = false;
          input.lmbDown = false;
          input.boxStart = null;
          input.boxEnd = null;
          const box = document.getElementById('selectBox');
          if (box) box.style.display = 'none';
        },
        onPinchPan({ dx, dy, zoom }) {
          input.touchPan.x += dx;
          input.touchPan.y += dy;
          input.pinchZoom *= zoom;
        },
        onPad({ x, y }) {
          input.touchPad.x = x;
          input.touchPad.y = y;
        },
        onAction(act) {
          if (!running) return;
          if (act === 'fire') commenceFiringSelection();
          else if (act === 'hold') toggleFireMode();
          else if (act === 'mount') toggleMountSelected();
          else if (act === 'skirm') toggleSkirmishSelected();
          else if (act === 'zoomIn') { input.wheelDelta -= 180; }
          else if (act === 'zoomOut') { input.wheelDelta += 180; }
        },
      });
    }

    // Hover tracking for ring brighten
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (!running) return;
      const u = unitAtScreen(e.clientX, e.clientY);
      if (u !== hoverUnit) {
        hoverUnit = u;
        updateRangeRings();
      }
    });

    const btnBuild = document.getElementById('btnBuildWall');
    if (btnBuild) {
      btnBuild.addEventListener('click', () => {
        if (selected.some((u) => u.type === 'engineer')) setBuildMode(!buildMode);
      });
    }
    const btnMount = document.getElementById('btnMountToggle');
    if (btnMount) {
      btnMount.addEventListener('click', () => { if (!btnMount.disabled) toggleMountSelected(); });
    }
    const btnSk = document.getElementById('btnSkirmishToggle');
    if (btnSk) {
      btnSk.addEventListener('click', () => { if (!btnSk.disabled) toggleSkirmishSelected(); });
    }
    const btnHold = document.getElementById('btnFireMode');
    if (btnHold) {
      btnHold.addEventListener('click', () => toggleFireMode());
    }

    function obstacles() {
      const list = [];
      world.trees.forEach((t) => list.push(t));
      if (world.rocks) world.rocks.forEach((r) => list.push(r));
      world.walls.forEach((w) => {
        if (w.userData.blocksMovement) list.push(w);
      });
      return list;
    }

    function separate(dt) {
      const alive = units.filter((u) => u.alive);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const dx = b.mesh.position.x - a.mesh.position.x;
          const dz = b.mesh.position.z - a.mesh.position.z;
          const dist = Math.hypot(dx, dz) || 0.0001;
          const minD = a.radius + b.radius + 0.15;
          if (dist < minD) {
            const push = ((minD - dist) / 2) * Math.min(1, dt * 8);
            const nx = dx / dist;
            const nz = dz / dist;
            a.mesh.position.x -= nx * push;
            a.mesh.position.z -= nz * push;
            b.mesh.position.x += nx * push;
            b.mesh.position.z += nz * push;
          }
        }
      }
      const obs = obstacles();
      alive.forEach((u) => {
        obs.forEach((o) => {
          const dx = u.mesh.position.x - o.position.x;
          const dz = u.mesh.position.z - o.position.z;
          const dist = Math.hypot(dx, dz) || 0.0001;
          const minD = u.radius + (o.userData.radius || 2);
          if (dist < minD) {
            const push = (minD - dist) * Math.min(1, dt * 6);
            u.mesh.position.x += (dx / dist) * push;
            u.mesh.position.z += (dz / dist) * push;
          }
        });
      });
    }

    function snapUnitsToTerrain() {
      const h = world.heightAt || (() => 0);
      units.forEach((u) => {
        if (!u.alive) return;
        u.mesh.position.y = h(u.mesh.position.x, u.mesh.position.z);
      });
    }

    function destroyWagon(w, explode) {
      if (!w || !w.alive) return;
      w.alive = false;
      w.ammo = 0;
      if (explode) {
        const boom = new THREE.Mesh(
          new THREE.SphereGeometry(2.5, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xe07030, transparent: true, opacity: 0.7 })
        );
        boom.position.copy(w.mesh.position);
        boom.position.y += 1.5;
        scene.add(boom);
        setTimeout(() => scene.remove(boom), 400);
      }
      scene.remove(w.mesh);
      const i = selected.indexOf(w);
      if (i >= 0) selected.splice(i, 1);
      refreshSelectionUi();
    }

    function captureWagon(w, newTeam) {
      if (!w.alive) return;
      w.team = newTeam;
      // recolor bed roughly
      w.mesh.traverse((ch) => {
        if (ch.isMesh && ch.material && ch.material.color && ch.name !== 'canvas') {
          // skip mules / wheels loosely — bed is first large box; tint all teamish
        }
      });
      const bed = w.mesh.children.find((c) => c.geometry && c.geometry.type === 'BoxGeometry' && c.position.y > 0.8 && c.position.y < 1.3);
      if (bed && bed.material) bed.material.color.setHex(newTeam === 'union' ? 0x4a6a9c : 0x8a4840);
      const tm = w.mesh.getObjectByName('teamMarker');
      if (tm) tm.material.color.setHex(newTeam === 'union' ? 0x1e5aaf : 0xcc1a1a);
      w.label = 'Ammo Wagon (' + (newTeam === 'union' ? 'captured Union' : 'captured CSA') + ')';
      RTSHUD.setStatus('Wagon captured by ' + newTeam.toUpperCase());
    }

    function updateLogistics(dt) {
      const now = performance.now() / 1000;
      // Depot control + trickle
      depots.forEach((d) => {
        RTSLogistics.updateDepotControl(d, units);
        RTSLogistics.updateDepotTrickle(d, dt);
      });

      // Move wagons
      wagons.forEach((w) => {
        if (!w.alive || !w.target) return;
        const dx = w.target.x - w.mesh.position.x;
        const dz = w.target.z - w.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.4) { w.target = null; return; }
        const step = Math.min(dist, w.speed * dt);
        w.mesh.position.x += (dx / dist) * step;
        w.mesh.position.z += (dz / dist) * step;
        w.mesh.rotation.y = Math.atan2(dx, dz);
        if (world.heightAt) w.mesh.position.y = world.heightAt(w.mesh.position.x, w.mesh.position.z);
      });

      // Wagon <-> depot refill
      wagons.forEach((w) => {
        if (!w.alive || w.ammo >= w.ammoMax) return;
        depots.forEach((d) => {
          if (d.stock <= 0) return;
          if (d.controller !== w.team) return;
          const dist = Math.hypot(w.mesh.position.x - d.x, w.mesh.position.z - d.z);
          if (dist > d.radius) return;
          const need = Math.min(w.ammoMax - w.ammo, RTSLogistics.WAGON_FROM_DEPOT_PER_SEC * dt, d.stock);
          w.ammo += need;
          d.stock -= need;
          RTSLogistics.setDepotFillBar(d);
        });
      });

      // Units refill from friendly wagons if idle (no fire ~5s)
      units.forEach((u) => {
        if (!u.alive || u.isWagon) return;
        if (u.ammo >= u.ammoMax) return;
        if ((now - (u.lastCombatAt || -9999)) < 5.0) return;
        wagons.forEach((w) => {
          if (!w.alive || w.team !== u.team || w.ammo <= 0) return;
          const dist = Math.hypot(u.mesh.position.x - w.mesh.position.x, u.mesh.position.z - w.mesh.position.z);
          if (dist > RTSLogistics.REFILL_RADIUS) return;
          const need = Math.min(u.ammoMax - u.ammo, RTSLogistics.UNIT_REFILL_PER_SEC * dt, w.ammo);
          u.ammo += need;
          w.ammo -= need;
          RTSLogistics.updateAmmoMarker(u);
        });
      });

      // Capture unguarded enemy wagons
      wagons.forEach((w) => {
        if (!w.alive) return;
        const enemies = units.filter((u) => u.alive && !u.isWagon && u.team !== w.team
          && Math.hypot(u.mesh.position.x - w.mesh.position.x, u.mesh.position.z - w.mesh.position.z) < 3.5);
        if (!enemies.length) return;
        const guards = RTSLogistics.countNear(units, w.mesh.position.x, w.mesh.position.z, RTSLogistics.GUARD_RADIUS, w.team);
        if (guards === 0) captureWagon(w, enemies[0].team);
      });

      // Simple AI: send damaged/low-ammo units toward friendly wagon or depot; move empty-ish wagons to rear depot
      if (Math.random() < dt * 0.2) {
        const foeTeam = playerSide === 'union' ? 'csa' : 'union';
        const low = units.filter((u) => u.alive && u.team === foeTeam && u.ammo < u.ammoMax * 0.35);
        if (low.length) {
          const u = low[Math.floor(Math.random() * low.length)];
          const w = wagons.find((x) => x.alive && x.team === foeTeam && x.ammo > 0);
          const d = depots.find((x) => x.controller === foeTeam && x.stock > 0);
          if (w) u.target = { x: w.mesh.position.x, z: w.mesh.position.z };
          else if (d) u.target = { x: d.x, z: d.z };
        }
        const hungryWagon = wagons.find((x) => x.alive && x.team === foeTeam && x.ammo < x.ammoMax * 0.4);
        if (hungryWagon) {
          const d = depots.find((x) => x.controller === foeTeam && x.stock > 100);
          if (d) hungryWagon.target = { x: d.x, z: d.z };
        }
      }
    }

    function inHQ(u) {
      if (!hqs) return null;
      const hq = hqs[u.team];
      if (!hq) return null;
      const d = Math.hypot(u.mesh.position.x - hq.x, u.mesh.position.z - hq.z);
      return d <= hq.radius ? hq : null;
    }

    function outOfCombat(u, nowSec) {
      return (nowSec - (u.lastCombatAt || -9999)) >= 5.0;
    }

    function healRate(u) {
      // +1 man / 2s infantry & skirmishers; slower for cav/artillery crews
      if (u.type === 'infantry' || u.type === 'skirmisher') return 0.5; // men per second
      if (u.type === 'cavalry') return 0.25;
      if (u.type === 'artillery') return 0.2;
      if (u.type === 'engineer' || u.type === 'officer') return 0.35;
      return 0.3;
    }

    function updateHQHeal(dt) {
      const now = performance.now() / 1000;
      units.forEach((u) => {
        if (!u.alive) return; // destroyed = permanent for the day
        if (!inHQ(u)) {
          u._hqAcc = 0;
          return;
        }
        if (!outOfCombat(u, now)) {
          u._hqAcc = 0;
          return;
        }
        // Regain men up to startMen / startMaxHp
        const capMen = u.startMen != null ? u.startMen : u.maxMen;
        const capHp = u.startMaxHp != null ? u.startMaxHp : u.maxHp;
        if (u.menCount >= capMen && u.hp >= capHp - 0.01) {
          u._hqAcc = 0;
          return;
        }
        u._hqAcc = (u._hqAcc || 0) + healRate(u) * dt;
        while (u._hqAcc >= 1 && u.menCount < capMen) {
          u._hqAcc -= 1;
          u.menCount += 1;
          // restore a slice of HP with each man
          const hpPer = capHp / Math.max(1, capMen);
          u.hp = Math.min(capHp, u.hp + hpPer);
          u.maxHp = Math.max(u.maxHp, Math.min(capHp, u.maxHp + hpPer * 0.25));
          if (u.type === 'infantry' || u.type === 'skirmisher') {
            RTSUnits.rebuildInfantryVisual(u, u.menCount / Math.max(1, capMen));
          }
        }
        // Soft HP regen even between man ticks
        if (u.hp < capHp) {
          u.hp = Math.min(capHp, u.hp + (capHp * 0.04) * dt);
        }
      });
      // AI: nudge damaged enemy units toward their HQ occasionally
      if (Math.random() < dt * 0.15) {
        const foes = units.filter((u) => u.alive && u.team !== playerSide && u.hp < (u.startMaxHp || u.maxHp) * 0.55);
        foes.slice(0, 1).forEach((u) => {
          const hq = hqs && hqs[u.team];
          if (!hq) return;
          if (!u.attackTarget || !u.attackTarget.alive) {
            u.target = { x: hq.x + (Math.random() - 0.5) * 4, z: hq.z + (Math.random() - 0.5) * 4 };
          }
        });
      }
    }

    function updateUnits(dt) {
      units.forEach((u) => {
        if (!u.alive) return;
        if (u.reloadT > 0) u.reloadT = Math.max(0, u.reloadT - dt);

        // Ammo refill handled by updateLogistics (wagons + depots)
        RTSLogistics.updateAmmoMarker(u);

        if (u.buildTarget && u.buildTarget.userData.buildProgress < 1) {
          const d = Math.hypot(
            u.mesh.position.x - u.buildTarget.position.x,
            u.mesh.position.z - u.buildTarget.position.z
          );
          if (d < 3.5 && u.type === 'engineer') {
            // Breastworks draw a trickle of ammo/tools from the engineer
            if (u.ammo > 0) {
              u.ammo = Math.max(0, u.ammo - 2.5 * dt);
              RTSLogistics.updateAmmoMarker(u);
            }
            const done = RTSWorld.updateWallBuild(u.buildTarget, dt);
            if (done) {
              RTSHUD.setStatus('Breastworks complete');
              u.buildTarget = null;
            }
          }
        }

        if (u.rejoinPending) {
          if (tryRejoin(u)) return;
        }

        if (u.mountBusy > 0) return; // frozen while mounting

        if (!u.target) return;
        const dx = u.target.x - u.mesh.position.x;
        const dz = u.target.z - u.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.35) {
          u.target = null;
          if (u.rejoinPending) tryRejoin(u);
          return;
        }
        let spd = u.speed;
        if (world.emmitsburgFences) {
          for (let fi = 0; fi < world.emmitsburgFences.length; fi++) {
            const f = world.emmitsburgFences[fi];
            if (Math.hypot(u.mesh.position.x - f.x, u.mesh.position.z - f.z) < f.radius) {
              spd *= f.slow || 0.45;
              break;
            }
          }
        }
        if (barrageActive && u.type !== 'artillery') return;
        const step = Math.min(dist, spd * dt);
        u.mesh.position.x += (dx / dist) * step;
        u.mesh.position.z += (dz / dist) * step;
        u.mesh.rotation.y = Math.atan2(dx, dz);
      });
      separate(dt);

      poolAmmo = units
        .filter((u) => u.alive && u.team === playerSide)
        .reduce((s, u) => s + u.ammo, 0);
      RTSHUD.updateAmmo(poolAmmo);
    }

    function updateMarkers(dt) {
      moveMarkers = moveMarkers.filter((m) => {
        m.t -= dt;
        m.mesh.material.opacity = Math.max(0, m.t / MOVE_MARKER_LIFE);
        m.mesh.scale.setScalar(1 + (1 - m.t / MOVE_MARKER_LIFE) * 0.5);
        if (m.t <= 0) {
          scene.remove(m.mesh);
          return false;
        }
        return true;
      });
      shotFx = shotFx.filter((fx) => {
        fx.t += dt;
        const k = Math.min(1, fx.t / fx.life);
        fx.mesh.position.lerpVectors(fx.from, fx.to, k);
        if (fx.smoke) {
          fx.smoke.scale.setScalar(1 + k * 2);
          fx.smoke.material.opacity = 0.5 * (1 - k);
        }
        if (fx.t >= fx.life) {
          scene.remove(fx.mesh);
          if (fx.smoke) scene.remove(fx.smoke);
          return false;
        }
        return true;
      });
      if (ringBright) {
        ringBrightT -= dt;
        if (ringBrightT <= 0) {
          ringBright = false;
          updateRangeRings();
        }
      }
    }

    function clearBarrageFx() {
      barrageFx.forEach((fx) => scene.remove(fx.mesh));
      barrageFx = [];
    }

    function spawnShotFx(from, to, color) {
      const geo = new THREE.SphereGeometry(0.35, 6, 6);
      const mat = new THREE.MeshBasicMaterial({ color: color || 0x222218 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(from);
      scene.add(mesh);
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x888880, transparent: true, opacity: 0.55 })
      );
      smoke.position.copy(from);
      smoke.position.y += 1.2;
      scene.add(smoke);
      barrageFx.push({ mesh, smoke, from: from.clone(), to: to.clone(), t: 0, life: 1.1 });
    }

    function updateBarrage(dt) {
      if (!barrageActive) return;
      barrageT += dt;
      if (Math.random() < dt * 3.5) {
        const csaGuns = units.filter((u) => u.alive && u.team === 'csa' && u.type === 'artillery');
        const uniGuns = units.filter((u) => u.alive && u.team === 'union' && u.type === 'artillery');
        if (csaGuns.length) {
          const g = csaGuns[Math.floor(Math.random() * csaGuns.length)];
          const from = g.mesh.position.clone(); from.y += 1.5;
          const to = new THREE.Vector3(26 + Math.random() * 6, 4, 32 + Math.random() * 6);
          spawnShotFx(from, to, 0x1a1a14);
        }
        if (uniGuns.length && Math.random() < 0.7) {
          const g = uniGuns[Math.floor(Math.random() * uniGuns.length)];
          const from = g.mesh.position.clone(); from.y += 1.5;
          const to = new THREE.Vector3(-40 + Math.random() * 10, 4, 10 + Math.random() * 16);
          spawnShotFx(from, to, 0x2a2a20);
        }
      }
      barrageFx = barrageFx.filter((fx) => {
        fx.t += dt;
        const k = Math.min(1, fx.t / fx.life);
        fx.mesh.position.lerpVectors(fx.from, fx.to, k);
        fx.mesh.position.y += Math.sin(k * Math.PI) * 8;
        if (fx.smoke) {
          fx.smoke.scale.setScalar(1 + k * 2);
          fx.smoke.material.opacity = 0.55 * (1 - k);
        }
        if (fx.t >= fx.life) {
          scene.remove(fx.mesh);
          if (fx.smoke) scene.remove(fx.smoke);
          return false;
        }
        return true;
      });
      const btn = document.getElementById('btnSkipBarrage');
      if (btn) {
        btn.style.display = 'block';
        btn.textContent = 'Skip barrage (Space) — ' + Math.max(0, Math.ceil(BARRAGE_DURATION - barrageT)) + 's';
      }
      if (barrageT >= BARRAGE_DURATION) endBarrage();
    }

    function endBarrage() {
      if (!barrageActive) return;
      barrageActive = false;
      clearBarrageFx();
      const btn = document.getElementById('btnSkipBarrage');
      if (btn) btn.style.display = 'none';
      chargeStarted = true;
      RTSHUD.setStatus(playerSide === 'union'
        ? 'Union — Day 3. The charge is coming — hold the ridge!'
        : "CSA — Day 3. Pickett's Charge — forward across the field!");
      units.filter((u) => u.alive && u.team === 'csa' && u.type === 'infantry').forEach((u, i) => {
        u.target = { x: 18 + (i % 5) * 1.5, z: 34 + Math.floor(i / 5) * 1.2 };
      });
    }

    function skipBarrage() {
      if (!barrageActive) return;
      barrageT = BARRAGE_DURATION;
      endBarrage();
    }

    let aiTimer = 0;
    function updateAI(dt) {
      aiTimer -= dt;
      if (aiTimer > 0) return;
      aiTimer = 2.2 + Math.random() * 1.5;
      if (barrageActive) return;
      const enemies = units.filter((u) => u.alive && u.team !== playerSide);
      if (!enemies.length) return;
      const friends = units.filter((u) => u.alive && u.team === playerSide);
      let objPt = null;
      if (objectives) {
        objPt = objectives.chain.find((p) => p.state === 'active') || objectives.chain.find((p) => p.state === 'locked');
      }
      const batch = enemies.sort(() => Math.random() - 0.5).slice(0, Math.min(5, enemies.length));
      batch.forEach((u) => {
        if (u.buildTarget || u.mountBusy > 0) return;
        let tx, tz;
        let nearest = null;
        let nearestD = 1e9;
        friends.forEach((f) => {
          const d = Math.hypot(f.mesh.position.x - u.mesh.position.x, f.mesh.position.z - u.mesh.position.z);
          if (d < nearestD) { nearestD = d; nearest = f; }
        });
        if (nearest && nearestD < 40) {
          // Close to engage
          const stop = Math.max(u.minRange || 0, (u.range || 10) * 0.8);
          const dx = nearest.mesh.position.x - u.mesh.position.x;
          const dz = nearest.mesh.position.z - u.mesh.position.z;
          const dist = Math.hypot(dx, dz) || 1;
          tx = nearest.mesh.position.x - (dx / dist) * stop + (Math.random() - 0.5) * 3;
          tz = nearest.mesh.position.z - (dz / dist) * stop + (Math.random() - 0.5) * 3;
          u.attackTarget = nearest;
        } else if (objPt) {
          tx = objPt.x + (Math.random() - 0.5) * 8;
          tz = objPt.z + (Math.random() - 0.5) * 8;
        } else if (nearest) {
          tx = nearest.mesh.position.x;
          tz = nearest.mesh.position.z;
        } else {
          return;
        }
        u.target = { x: tx, z: tz };
      });
    }

    function onResize() {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      camCtrl.camera.aspect = w / h;
      camCtrl.camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);

    function tick() {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      if (running) {
        RTSCamera.updateCamera(camCtrl, input, dt, renderer.domElement.clientWidth, renderer.domElement.clientHeight);
        updateMount(dt);
        updateUnits(dt);
        // Keep team markers visible + correctly colored
        units.forEach((u) => {
          if (!u.alive) return;
          const m = u.mesh.getObjectByName('teamMarker');
          if (!m) return;
          m.visible = true;
          const col = (window.RTSUnits && RTSUnits.teamMarkerColor)
            ? RTSUnits.teamMarkerColor(u.team)
            : (u.team === 'union' ? 0x1e5aaf : 0xcc1a1a);
          m.material.color.setHex(col);
        });
        wagons.forEach((w) => {
          if (!w.alive) return;
          let m = w.mesh.getObjectByName('teamMarker');
          if (!m) {
            const col = w.team === 'union' ? 0x1e5aaf : 0xcc1a1a;
            m = new THREE.Mesh(
              new THREE.SphereGeometry(0.42, 10, 10),
              new THREE.MeshBasicMaterial({ color: col })
            );
            m.position.set(0, 3.2, 0);
            m.name = 'teamMarker';
            w.mesh.add(m);
          }
          m.visible = true;
          m.material.color.setHex(w.team === 'union' ? 0x1e5aaf : 0xcc1a1a);
        });
        updateLogistics(dt);
        updateHQHeal(dt);
        if (casualtySys) casualtySys.update(dt, selected);
        const nowS = performance.now() / 1000;
        units.forEach((u) => {
          if (u.alive || !u._corpseUntil) return;
          if (nowS >= u._corpseUntil && u.mesh && u.mesh.parent) {
            scene.remove(u.mesh);
            u._corpseUntil = null;
          }
        });
        updateCommence(dt);
        updateAutonomousFire(dt);
        updateMarkers(dt);
        updateBarrage(dt);
        updateAI(dt);
        if (objectives) {
          const info = RTSObjectives.updateObjectives(objectives, units, playerSide, dt);
          RTSHUD.updateObjectiveProgress(info);
          if (info && info.allHeld && !briefedComplete) {
            briefedComplete = true;
            if (window.RTSVoice) RTSVoice.briefingComplete(playerSide, currentDay);
          } else if (info && !info.allHeld && info.index && info.index !== lastObjIndex) {
            lastObjIndex = info.index;
            if (window.RTSVoice) RTSVoice.briefingObjective(playerSide, info.index, currentDay);
          }
        }
      } else {
        camCtrl.state.yaw += dt * 0.05;
        camCtrl.apply();
      }
      renderer.render(scene, camCtrl.camera);
    }

    function start(side, day) {
      playerSide = side === 'csa' ? 'csa' : 'union';
      currentDay = (day === 2 || day === 3) ? day : 1;
      units.forEach((u) => scene.remove(u.mesh));
      if (casualtySys && casualtySys.clear) casualtySys.clear();
      units = RTSUnits.spawnArmies(scene, currentDay);
      if (window.RTSCasualties && RTSCasualties.auditAllFacing) {
        uFacingAudit = RTSCasualties.auditAllFacing(units);
      }
      if (hqs) {
        if (hqs.union && hqs.union.mesh) scene.remove(hqs.union.mesh);
        if (hqs.csa && hqs.csa.mesh) scene.remove(hqs.csa.mesh);
      }
      hqs = RTSWorld.createBothHQs(scene, world, currentDay);
      // Clear prior logistics
      wagons.forEach((w) => { if (w.mesh) scene.remove(w.mesh); });
      depots.forEach((d) => { if (d.mesh) scene.remove(d.mesh); });
      wagons = RTSLogistics.spawnDayWagons(scene, world, currentDay);
      depots = RTSLogistics.spawnDayDepots(scene, world, currentDay);
      // Disable legacy infinite-ish world supplies (depots replace them)
      if (world.supplies) world.supplies.forEach((s) => { s.userData.ammo = 0; s.visible = false; });
      units.forEach((u) => RTSLogistics.applyUnitAmmoCaps(u));
      snapUnitsToTerrain();
      selected = [];
      buildMode = false;
      fireAtWill = true;
      if (currentDay === 3) {
        camCtrl.state.target.set(10, 0, 30);
        camCtrl.state.yaw = playerSide === 'union' ? 0.5 : -0.4;
        camCtrl.state.distance = 70;
      } else if (currentDay === 2) {
        if (playerSide === 'union') {
          camCtrl.state.target.set(30, 0, 42);
          camCtrl.state.yaw = 0.4;
        } else {
          camCtrl.state.target.set(10, 0, 40);
          camCtrl.state.yaw = -0.6;
        }
        camCtrl.state.distance = 62;
      } else if (playerSide === 'union') {
        camCtrl.state.target.set(-45, 0, 2);
        camCtrl.state.yaw = 0.2;
        camCtrl.state.distance = 55;
      } else {
        camCtrl.state.target.set(-80, 0, 0);
        camCtrl.state.yaw = Math.PI;
        camCtrl.state.distance = 55;
      }
      camCtrl.state.pitch = Math.PI / 2 - 0.08;
      camCtrl.apply();
      if (objectives) {
        objectives.chain.forEach((pt) => { if (pt.marker) scene.remove(pt.marker); });
      }
      objectives = RTSObjectives.createObjectives(scene, world, playerSide, currentDay);
      lastObjIndex = 1;
      briefedComplete = false;
      running = true;
      if (window.RTSVoice) RTSVoice.setDay(currentDay);
      RTSHUD.showBattleHud(playerSide, currentDay);
      RTSHUD.updateObjectiveProgress(RTSObjectives.getHud(objectives));
      refreshSelectionUi();
      poolAmmo = units.filter((u) => u.team === playerSide).reduce((s, u) => s + u.ammo, 0);
      RTSHUD.updateAmmo(poolAmmo);
      const status =
        currentDay === 3
          ? (playerSide === 'union' ? 'Union — Day 3. Artillery barrage — hold the ridge!' : 'CSA — Day 3. Artillery barrage — then the charge!')
          : currentDay === 2
          ? (playerSide === 'union' ? 'Union — Day 2. Hold the fishhook.' : "CSA — Day 2. Longstreet's assault.")
          : (playerSide === 'union' ? 'Union — Day 1. Hold the ridge.' : 'CSA — Day 1. Take the ridges and the town.');
      RTSHUD.setStatus(status);
      clearBarrageFx();
      chargeStarted = false;
      barrageActive = currentDay === 3;
      barrageT = 0;
      const skipBtn = document.getElementById('btnSkipBarrage');
      if (skipBtn) skipBtn.style.display = barrageActive ? 'block' : 'none';
    }

    tick();

    const api = {
      start,
      get playerSide() { return playerSide; },
      get day() { return currentDay; },
      get barrageActive() { return barrageActive; },
      skipBarrage,
      endBarrage,
      get units() { return units; },
      get selected() { return selected; },
      get world() { return world; },
      get camera() { return camCtrl.camera; },
      get cameraState() { return camCtrl.state; },
      get scene() { return scene; },
      get renderer() { return renderer; },
      get running() { return running; },
      get buildMode() { return buildMode; },
      get objectives() { return objectives; },
      get poolAmmo() { return poolAmmo; },
      get fireAtWill() { return fireAtWill; },
      get hqs() { return hqs; },
      get wagons() { return wagons; },
      get depots() { return depots; },
      destroyWagon,
      captureWagon,
      selectUnits,
      clearSelection,
      issueMove,
      issueAttack,
      issueBuild,
      setBuildMode,
      groundHit,
      boxSelect,
      fireUnitDirect,
      commenceFiringSelection,
      casualtySys,
      facingAudit: () => uFacingAudit,
      auditFacing: () => {
        uFacingAudit = window.RTSCasualties ? RTSCasualties.auditAllFacing(units) : null;
        return uFacingAudit;
      },
      toggleFireMode,
      toggleMountSelected,
      toggleSkirmishSelected,
      detachSkirmish,
      tryRejoin,
      applyDamage,
      findNearestEnemy,
      OBJECTIVES: RTSHUD.OBJECTIVES,
    };
    return api;
  }

  global.RTSGame = { createGame };
})(window);
