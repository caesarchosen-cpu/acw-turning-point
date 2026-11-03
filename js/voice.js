/* Spoken briefings: prefer assets/voice/*.mp3 (file://), else speechSynthesis accents. */
(function (global) {
  'use strict';

  let voiceMuted = false;
  let currentAudio = null;
  let speaking = false;

  let currentDay = 1;

  const BRIEFINGS = {
    1: {
      union: {
        start:
          "Right lads, listen up. Day one at Gettysburg — the first of July. Buford's horse is holdin' McPherson Ridge west of town. We're to delay Heth until the First Corps comes up, then fall back orderly to Cemetery Hill. Ammunition's life — stay near the wagons. Move!",
        points: [
          "Objective one: Take and hold McPherson Ridge. Keep the greybacks off the crest until our infantry arrives.",
          "Objective two unlocked: Push onto Seminary Ridge. Don't let 'em turn our flank through the seminary grounds.",
          "Objective three unlocked: Secure Cemetery Hill. That's the high ground east of town — dig in and hold it.",
        ],
        complete: "That's the chain, boys — all three points held. Fine work. Keep your powder dry.",
      },
      csa: {
        start:
          "Gentlemen, gather 'round. It's the first of July, and Gettysburg lies ahead. We'll drive those bluebellies off Herr Ridge and McPherson, then Seminary, and take the town square 'fore sundown. Watch y'all's ammunition at the wagons. Forward, for Virginia and the Cause!",
        points: [
          "First objective: Seize Herr Ridge and McPherson Ridge. Sweep their cavalry aside and plant our colors.",
          "Second objective's open: Take Seminary Ridge. Push hard through them Yankee lines.",
          "Third objective: Capture the town square of Gettysburg. Drive 'em clean through the streets.",
        ],
        complete: "All three points are ours. The town's in reach — keep pressin' them Federals.",
      },
    },
    2: {
      union: {
        start:
          "Listen sharp, lads — day two, the second of July. We're on the fishhook now: Cemetery Ridge to the Round Tops. Longstreet's coming up from the southwest with Hood and McLaws. Hold Little Round Top, then the Den and the Wheatfield, then the ridge center. Not one step back without orders!",
        points: [
          "Objective one: Hold Little Round Top. If that hill falls, the whole left unravels — dig in among the rocks!",
          "Objective two unlocked: Clear and hold Devil's Den and the Wheatfield. It's a butcher's yard — keep the line!",
          "Objective three unlocked: Secure Cemetery Ridge center. Anchor the fishhook and don't let 'em break through!",
        ],
        complete: "Day two chain held, boys. The fishhook stands. Stay on the ammunition wagons.",
      },
      csa: {
        start:
          "Hear me now — second of July. General Longstreet's corps is rollin' up from the southwest. Hood and McLaws will smash their left. Take the Peach Orchard first, drive through Devil's Den and that wheatfield, then plant our flags on Little Round Top. Give 'em the bayonet!",
        points: [
          "First objective: Seize the Peach Orchard. Knock their salient flat and open the road north.",
          "Second objective's open: Drive through Devil's Den and the Wheatfield. Don't let the rocks stop you.",
          "Third objective: Take Little Round Top. From that crest we enfilade their whole line — forward!",
        ],
        complete: "All three points taken. Little Round Top is ours if we held the chain — press the Federals hard.",
      },
    },
    3: {
      union: {
        start:
          "Steady, lads — day three, the third of July. Their guns on Seminary Ridge will open a terrible fire. Hold the ridge through the barrage, then stand the Emmitsburg Road, the Angle, and the Copse of Trees. When Pickett comes, give them canister and cold steel!",
        points: [
          "Objective one: Hold the Emmitsburg Road line. Don't let their columns cross in good order!",
          "Objective two unlocked: Defend the Angle. That's the hinge of the line — not one greyback over the wall!",
          "Objective three unlocked: Hold the Copse of Trees. If that little grove falls, Cemetery Ridge is lost!",
        ],
        complete: "The charge is broken, boys. All three points held. God save the Union.",
      },
      csa: {
        start:
          "Gentlemen — third of July. Our batteries will tear their ridge to pieces. Then Pickett, Pettigrew, and Trimble step off across that open field. Cross the Emmitsburg Road, breach the Angle, and take the Copse of Trees. For Virginia — forward!",
        points: [
          "First objective: Cross the Emmitsburg Road. Those fences will slow you — push through!",
          "Second objective's open: Breach the Angle. Pour over their stone wall and break the hinge!",
          "Third objective: Take the Copse of Trees. Plant the colors among those trees and the ridge is ours!",
        ],
        complete: "All three points taken. If the Copse is ours, we've cracked their center — keep the pressure!",
      },
    },
  };

  function briefingFor(side, day) {
    day = (day === 2 || day === 3) ? day : 1;
    const d = BRIEFINGS[day] || BRIEFINGS[1];
    return d[side] || d.union;
  }

  /** Set true when a real MP3 exists under assets/voice/. Empty = TTS only (no 404s). */
  const HAS_RECORDING = {
    // e.g. 'union_start': true, 'csa_obj1': true
  };

  function fileUrl(side, key) {
    // assets/voice/union_start.mp3, union_obj1.mp3, ... csa_start.mp3, csa_obj1.mp3
    return 'assets/voice/' + side + '_' + key + '.mp3';
  }

  function stop() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (_) {}
      currentAudio = null;
    }
    if (global.speechSynthesis) {
      try { speechSynthesis.cancel(); } catch (_) {}
    }
    speaking = false;
  }

  function pickVoice(side) {
    if (!global.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices() || [];
    if (side === 'union') {
      // Prefer Irish / en-IE
      const ie = voices.find((v) => /en-IE/i.test(v.lang) || /irish|emily|connor|moira|google uk english female/i.test(v.name));
      if (ie) return ie;
      const gb = voices.find((v) => /en-GB/i.test(v.lang));
      if (gb) return gb;
    } else {
      // Southern: no standard TTS — prefer deep en-US male
      const male = voices.find((v) => /en-US/i.test(v.lang) && /male|david|mark|guy|christopher|aaron|google us english/i.test(v.name));
      if (male) return male;
      const us = voices.find((v) => /en-US/i.test(v.lang));
      if (us) return us;
    }
    return voices[0] || null;
  }

  function speakSynth(side, text) {
    if (!global.speechSynthesis || voiceMuted) return;
    stop();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(side);
    if (v) u.voice = v;
    if (side === 'union') {
      u.lang = (v && v.lang) || 'en-IE';
      u.rate = 1.0;
      u.pitch = 1.05;
    } else {
      u.lang = 'en-US';
      u.rate = 0.85; // slower ~ Southern cadence stand-in
      u.pitch = 0.8; // lower
    }
    u.onend = () => { speaking = false; };
    speaking = true;
    speechSynthesis.speak(u);
  }

  function tryPlayFile(side, key, textFallback) {
    if (voiceMuted) return;
    const recKey = side + '_' + key;
    if (!HAS_RECORDING[recKey]) {
      speakSynth(side, textFallback);
      return;
    }
    const src = fileUrl(side, key);
    stop();
    const a = new Audio();
    a.preload = 'auto';
    currentAudio = a;
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      speakSynth(side, textFallback);
    };
    a.addEventListener('canplaythrough', () => {
      if (settled) return;
      settled = true;
      speaking = true;
      a.play().catch(fallback);
    }, { once: true });
    a.addEventListener('error', fallback, { once: true });
    a.addEventListener('ended', () => { speaking = false; });
    // Timeout: if file missing under file://, error may be slow — fallback
    setTimeout(() => { if (!settled) fallback(); }, 600);
    a.src = src;
    a.load();
  }

  function showPanel(text) {
    let panel = document.getElementById('briefingPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'briefingPanel';
      panel.style.cssText = 'position:fixed;left:50%;top:72px;transform:translateX(-50%);max-width:640px;z-index:40;background:linear-gradient(135deg, rgba(31,58,107,.94) 50%, rgba(122,127,134,.94) 50%);border:1px solid rgba(196,163,90,0.45);border-radius:6px;padding:12px 16px;color:#e8e2d4;font-size:14px;line-height:1.45;text-align:center;pointer-events:none;text-shadow:0 1px 2px #000;transition:opacity .3s';
      document.body.appendChild(panel);
    }
    panel.textContent = text;
    panel.style.opacity = '1';
    clearTimeout(showPanel._t);
    showPanel._t = setTimeout(() => { panel.style.opacity = '0'; }, 10000);
  }

  function briefingStart(side, day) {
    if (day != null) currentDay = (day === 2 || day === 3) ? day : 1;
    const b = briefingFor(side, currentDay);
    const key = currentDay === 3 ? 'd3_start' : (currentDay === 2 ? 'd2_start' : 'start');
    showPanel(b.start);
    tryPlayFile(side, key, b.start);
  }

  function briefingObjective(side, index1based, day) {
    if (day != null) currentDay = (day === 2 || day === 3) ? day : 1;
    const b = briefingFor(side, currentDay);
    const text = b.points[index1based - 1] || ('Objective ' + index1based);
    const key = (currentDay === 3 ? 'd3_obj' : (currentDay === 2 ? 'd2_obj' : 'obj')) + index1based;
    showPanel(text);
    tryPlayFile(side, key, text);
  }

  function briefingComplete(side, day) {
    if (day != null) currentDay = (day === 2 || day === 3) ? day : 1;
    const b = briefingFor(side, currentDay);
    const key = currentDay === 3 ? 'd3_complete' : (currentDay === 2 ? 'd2_complete' : 'complete');
    showPanel(b.complete);
    tryPlayFile(side, key, b.complete);
  }

  function setDay(day) { currentDay = (day === 2 || day === 3) ? day : 1; }

  function toggleVoiceMute() {
    voiceMuted = !voiceMuted;
    if (voiceMuted) stop();
    const btn = document.getElementById('btnVoiceMute');
    if (btn) btn.textContent = voiceMuted ? 'Voice On (V)' : 'Voice Off (V)';
    return voiceMuted;
  }

  function bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !e.repeat) toggleVoiceMute();
    });
    // Warm voices list
    if (global.speechSynthesis) {
      speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }
  }

  global.RTSVoice = {
    BRIEFINGS,
    briefingFor,
    briefingStart,
    briefingObjective,
    briefingComplete,
    setDay,
    toggleVoiceMute,
    stop,
    bind,
    showPanel,
    get muted() { return voiceMuted; },
    get speaking() { return speaking; },
    get day() { return currentDay; },
  };
})(window);
