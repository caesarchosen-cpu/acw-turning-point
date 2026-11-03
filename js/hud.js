/* HUD: ammo, selection, per-unit Fire, Hold Fire toggle, mount/skirmish, objectives */
(function (global) {
  'use strict';

  const OBJECTIVES = {
    1: {
      union:
        'Delay Heth on McPherson Ridge west of town until I Corps arrives, then fall back to Cemetery Hill.',
      csa:
        'Drive Union troops off McPherson and Seminary Ridges and seize the town of Gettysburg.',
    },
    2: {
      union:
        'Hold the fishhook — secure Little Round Top, then Devil\'s Den and the Wheatfield, then Cemetery Ridge center against Longstreet.',
      csa:
        'Longstreet\'s assault: take the Peach Orchard, drive through Devil\'s Den and the Wheatfield, then seize Little Round Top.',
    },
    3: {
      union:
        'Stand on Cemetery Ridge through the bombardment, then hold the Emmitsburg Road line, the Angle, and the Copse of Trees against Pickett\'s Charge.',
      csa:
        'After the barrage, cross the Emmitsburg Road with Pickett, Pettigrew, and Trimble, breach the Angle, and take the Copse of Trees.',
    },
  };

  const DAY_LABEL = {
    1: 'Day 1 — July 1, 1863',
    2: 'Day 2 — July 2, 1863',
    3: 'Day 3 — July 3, 1863',
  };

  let _hooks = {};

  function showBattleHud(side, day) {
    day = (day === 2 || day === 3) ? day : 1;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('hud').classList.add('visible');
    document.getElementById('status').classList.add('visible');
    document.getElementById('dayLabel').textContent = DAY_LABEL[day] || DAY_LABEL[1];
    const table = OBJECTIVES[day] || OBJECTIVES[1];
    document.getElementById('objective').textContent = table[side] || table.union;
  }

  function updateAmmo(poolAmmo) {
    const el = document.getElementById('resAmmo');
    if (el) el.textContent = String(Math.floor(poolAmmo));
  }

  function volleyMark(u) {
    if (!u.lastVolley) return '';
    return ` · ${u.lastVolley.mark}`;
  }

  function updateSelection(units, hooks) {
    if (hooks) _hooks = hooks;
    const list = document.getElementById('selectedList');
    const buildBar = document.getElementById('buildBar');
    const fireBar = document.getElementById('fireBar');
    if (!list) return;
    if (!units || !units.length) {
      list.innerHTML = '<span class="unitChip empty">None</span>';
      if (buildBar) buildBar.classList.remove('visible');
      if (fireBar) fireBar.innerHTML = '';
      syncFireModeBtn();
      return;
    }
    list.innerHTML = units
      .map((u) => {
        const ammo = u.ammo != null ? ` · ${Math.floor(u.ammo)}/${u.ammoMax} rnd` : '';
        const hp = u.hp != null ? ` · HP ${Math.ceil(u.hp)}` : '';
        const mount = u.type === 'cavalry' ? (u.mounted ? ' · mtd' : ' · dismtd') : '';
        const wpn = u.currentWeapon ? ` · ${u.currentWeapon}` : (u.type === 'cavalry' ? ' · Sharps carbine' : '');
        return `<span class="unitChip ${u.type}" data-id="${u.id}">${u.label}${hp}${ammo}${mount}${wpn}${volleyMark(u)}</span>`;
      })
      .join('');

    if (fireBar) {
      fireBar.innerHTML = units
        .map((u) => {
          const ready = u.reloadT <= 0 && u.ammo > 0;
          return `<button type="button" class="btnFireUnit" data-id="${u.id}" ${ready ? '' : 'disabled'} title="Ordered-direct fire">Fire ${u.label.split(' ')[0]}</button>`;
        })
        .join('');
      fireBar.querySelectorAll('.btnFireUnit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.getAttribute('data-id'), 10);
          const u = units.find((x) => x.id === id);
          if (u && _hooks.onFireUnit) _hooks.onFireUnit(u);
          // refresh shortly
          setTimeout(() => updateSelection(units, _hooks), 50);
        });
      });
    }

    const hasEng = units.some((u) => u.type === 'engineer');
    if (buildBar) {
      if (hasEng) buildBar.classList.add('visible');
      else buildBar.classList.remove('visible');
    }
    syncFireModeBtn();
  }

  function syncFireModeBtn() {
    const btn = document.getElementById('btnFireMode');
    if (!btn) return;
    const atWill = _hooks && _hooks.fireAtWill !== false;
    // Prefer live flag from hooks object if provided as property
    const fav = (typeof _hooks.fireAtWill === 'boolean') ? _hooks.fireAtWill : true;
    btn.textContent = fav ? 'Fire at Will (H)' : 'Hold Fire (H)';
    btn.classList.toggle('active', !fav);
  }

  function setBuildMode(on) {
    const btn = document.getElementById('btnBuildWall');
    const hint = document.getElementById('buildHint');
    if (btn) btn.classList.toggle('active', !!on);
    if (hint) {
      hint.textContent = on
        ? 'Click ground to place breastworks (Esc cancel)'
        : 'Select engineers, then B or this button';
    }
  }

  function setStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }

  function updateObjectiveProgress(info) {
    const prog = document.getElementById('objProgress');
    if (prog && info) {
      prog.textContent = info.text || '';
      prog.classList.toggle('contested', !!info.contested);
    }
  }

  global.RTSHUD = {
    updateObjectiveProgress,
    OBJECTIVES,
    DAY_LABEL,
    showBattleHud,
    updateAmmo,
    updateSelection,
    setBuildMode,
    setStatus,
    syncFireModeBtn,
  };
})(window);
