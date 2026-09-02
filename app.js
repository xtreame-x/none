'use strict';

(function () {
  /* =====================================================================
     Lis-N prototype
     - Demo tracks show off the full UI (art, lyrics, EQ) with a simulated
       progress clock, no audio file required.
     - Import a real local file via the header button and it plays through
       an actual <audio> element routed through a 3-band Web Audio EQ.
     ===================================================================== */

  // ---------- Design tokens mirrored from styles.css ----------
  const MOOD_COLORS = {
    chill: '#4fb7b3',
    energetic: '#e8763f',
    melancholic: '#8d86c9',
    focus: '#d9b23c',
    warm: '#d98a5f',
  };

  const EQ_PRESETS = {
    flat: [0, 0, 0],
    bass: [7, 1, -1],
    vocal: [-3, 4, 1],
    treble: [-1, 0, 6],
    warm: [3, 1, -2],
  };
  const EQ_LABELS = {
    flat: 'Flat',
    bass: 'Bass Boost',
    vocal: 'Vocal',
    treble: 'Treble Boost',
    warm: 'Warm',
  };

  // ---------- Demo data ----------
  function placeholderArt(mood) {
    const color = MOOD_COLORS[mood] || '#e8a94a';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + color + '" stop-opacity="0.95"/>'
      + '<stop offset="1" stop-color="#121110" stop-opacity="0.95"/>'
      + '</linearGradient></defs>'
      + '<rect width="300" height="300" fill="#121110"/>'
      + '<rect width="300" height="300" fill="url(#g)"/>'
      + '<circle cx="205" cy="95" r="70" fill="' + color + '" opacity="0.18"/>'
      + '<circle cx="90" cy="230" r="46" fill="' + color + '" opacity="0.14"/>'
      + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const songs = [
    {
      id: 'demo-1', title: 'Morning Static', artist: 'Nell Wren',
      duration: 48, art: placeholderArt('chill'), moods: ['chill', 'focus'],
      src: null, isDemo: true,
      lyrics: [
        { t: 2, text: 'Morning light through the window' },
        { t: 8, text: 'Coffee steam and quiet streets' },
        { t: 14, text: 'Nothing loud, nothing waiting' },
        { t: 20, text: 'Just the hum beneath my feet' },
        { t: 27, text: 'Some days move like static' },
        { t: 33, text: 'Some days move like tape' },
        { t: 39, text: 'I let the slow ones settle' },
        { t: 44, text: 'and find my own shape' },
      ],
    },
    { id: 'demo-2', title: 'Copper Wire', artist: 'Aiden Vale', duration: 212, art: placeholderArt('energetic'), moods: ['energetic'], src: null, isDemo: true, lyrics: null },
    { id: 'demo-3', title: 'Low Tide', artist: 'Marisol Byrne', duration: 187, art: placeholderArt('melancholic'), moods: ['melancholic', 'chill'], src: null, isDemo: true, lyrics: null },
    { id: 'demo-4', title: 'Amber Room', artist: 'Nell Wren', duration: 165, art: placeholderArt('warm'), moods: ['warm'], src: null, isDemo: true, lyrics: null },
    { id: 'demo-5', title: 'Signal Path', artist: 'Ossian Cray', duration: 201, art: placeholderArt('focus'), moods: ['focus', 'energetic'], src: null, isDemo: true, lyrics: null },
  ];

  const playlists = [
    { id: 'pl-1', name: 'Late Night Coding', songIds: ['demo-1', 'demo-5'] },
    { id: 'pl-2', name: 'Sunday Reset', songIds: ['demo-3', 'demo-4'] },
  ];

  // ---------- Playback state ----------
  let currentSongId = null;
  let isPlaying = false;
  let audioCtx = null;
  let eqFilters = [];
  let audioGraphReady = false;
  let currentEqPreset = 'flat';
  let demoTimer = null;
  let demoElapsed = 0;
  let demoDuration = 0;
  let addMenuTargetSongId = null;

  const audio = document.getElementById('audio');

  // ---------- Small helpers ----------
  function $(id) { return document.getElementById(id); }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  function firstLetter(title) {
    const c = (title || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function getCurrentSong() {
    return songs.find(function (s) { return s.id === currentSongId; }) || null;
  }

  // ---------- Song list rendering (shared by Library / Search / Playlist detail) ----------
  function songRowHTML(song) {
    return '<li class="song-row" data-id="' + escapeHtml(song.id) + '" role="button" tabindex="0" aria-label="Play ' + escapeHtml(song.title) + '">'
      + '<img class="row-art" src="' + song.art + '" alt="" />'
      + '<div class="row-meta">'
      + '<span class="row-title">' + escapeHtml(song.title) + '</span>'
      + '<span class="row-artist">' + escapeHtml(song.artist) + '</span>'
      + '</div>'
      + '<span class="row-duration">' + formatTime(song.duration) + '</span>'
      + '<button class="row-add-btn" data-add-id="' + escapeHtml(song.id) + '" aria-label="Add ' + escapeHtml(song.title) + ' to a playlist"><svg class="icon"><use href="#icon-plus"/></svg></button>'
      + '</li>';
  }

  function renderSongListInto(containerEl, list, opts) {
    const grouped = opts && opts.grouped;
    containerEl.innerHTML = '';
    if (!list.length) return;
    if (!grouped) {
      containerEl.innerHTML = list.map(songRowHTML).join('');
      return;
    }
    const sorted = list.slice().sort(function (a, b) { return a.title.localeCompare(b.title); });
    let lastLetter = null;
    let html = '';
    sorted.forEach(function (song) {
      const letter = firstLetter(song.title);
      if (letter !== lastLetter) {
        html += '<li class="section-label" id="letter-' + letter + '">' + letter + '</li>';
        lastLetter = letter;
      }
      html += songRowHTML(song);
    });
    containerEl.innerHTML = html;
    buildAlphaIndex(sorted);
    highlightPlayingRow(currentSongId);
  }

  function renderLibrary() {
    renderSongListInto($('library-list'), songs, { grouped: true });
  }

  function attachListListeners(containerEl) {
    containerEl.addEventListener('click', function (e) {
      const addBtn = e.target.closest('.row-add-btn');
      if (addBtn) {
        e.stopPropagation();
        openAddMenu(addBtn.dataset.addId, addBtn);
        return;
      }
      const row = e.target.closest('.song-row');
      if (row) loadSong(row.dataset.id, { autoplay: true });
    });
    containerEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.song-row');
      if (row) { e.preventDefault(); loadSong(row.dataset.id, { autoplay: true }); }
    });
  }

  function highlightPlayingRow(id) {
    document.querySelectorAll('.song-row').forEach(function (row) {
      row.classList.toggle('playing', row.dataset.id === id);
    });
  }

  // ---------- Alphabetical index scrubber ----------
  function buildAlphaIndex(sortedSongs) {
    const el = $('alpha-index');
    el.innerHTML = '';
    const present = new Set(sortedSongs.map(function (s) { return firstLetter(s.title); }));
    '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (letter) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = letter;
      btn.dataset.letter = letter;
      if (present.has(letter)) btn.classList.add('has-songs');
      el.appendChild(btn);
    });
  }
  function jumpToLetter(letter) {
    const target = document.getElementById('letter-' + letter);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  (function wireAlphaScrub() {
    const el = $('alpha-index');
    let scrubbing = false;
    function handle(e) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit && hit.dataset && hit.dataset.letter) {
        el.querySelectorAll('.active-touch').forEach(function (b) { b.classList.remove('active-touch'); });
        hit.classList.add('active-touch');
        jumpToLetter(hit.dataset.letter);
      }
    }
    el.addEventListener('pointerdown', function (e) { scrubbing = true; handle(e); });
    window.addEventListener('pointermove', function (e) { if (scrubbing) handle(e); });
    window.addEventListener('pointerup', function () {
      scrubbing = false;
      el.querySelectorAll('.active-touch').forEach(function (b) { b.classList.remove('active-touch'); });
    });
  })();

  // ---------- Playlists ----------
  function playlistColor(pl) {
    const palette = [MOOD_COLORS.chill, MOOD_COLORS.energetic, MOOD_COLORS.melancholic, MOOD_COLORS.focus, MOOD_COLORS.warm];
    let hash = 0;
    for (let i = 0; i < pl.name.length; i++) hash = (hash * 31 + pl.name.charCodeAt(i)) >>> 0;
    return palette[hash % palette.length];
  }
  function renderPlaylists() {
    const grid = $('playlist-grid');
    grid.innerHTML = '';
    playlists.forEach(function (pl) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'playlist-card';
      btn.style.setProperty('--playlist-color', playlistColor(pl));
      btn.dataset.id = pl.id;
      btn.innerHTML = '<span class="pl-name">' + escapeHtml(pl.name) + '</span>'
        + '<span class="pl-count">' + pl.songIds.length + (pl.songIds.length === 1 ? ' song' : ' songs') + '</span>';
      li.appendChild(btn);
      grid.appendChild(li);
    });
  }
  function createPlaylist(name) {
    const pl = { id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name: name, songIds: [] };
    playlists.push(pl);
    return pl;
  }
  function togglePlaylistMembership(plId, songId) {
    const pl = playlists.find(function (p) { return p.id === plId; });
    if (!pl || !songId) return;
    const i = pl.songIds.indexOf(songId);
    if (i === -1) pl.songIds.push(songId); else pl.songIds.splice(i, 1);
  }
  function openPlaylistDetail(id) {
    const pl = playlists.find(function (p) { return p.id === id; });
    if (!pl) return;
    $('playlist-detail-title').textContent = pl.name;
    const list = pl.songIds.map(function (sid) { return songs.find(function (s) { return s.id === sid; }); }).filter(Boolean);
    renderSongListInto($('playlist-detail-list'), list, { grouped: false });
    showView('playlist-detail');
  }

  // ---------- Add-to-playlist popover ----------
  function openAddMenu(songId, anchorEl) {
    addMenuTargetSongId = songId;
    renderAddMenu();
    const menu = $('add-menu');
    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = 200;
    let left = rect.right - menuWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 200);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.remove('hidden');
  }
  function closeAddMenu() {
    $('add-menu').classList.add('hidden');
    addMenuTargetSongId = null;
  }
  function renderAddMenu() {
    const menu = $('add-menu');
    menu.innerHTML = '';
    if (!playlists.length) {
      const p = document.createElement('div');
      p.className = 'add-menu-empty';
      p.textContent = 'No playlists yet — create one from the Playlists tab.';
      menu.appendChild(p);
      return;
    }
    playlists.forEach(function (pl) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const inPl = pl.songIds.indexOf(addMenuTargetSongId) !== -1;
      btn.innerHTML = '<span>' + escapeHtml(pl.name) + '</span>' + (inPl ? '<span class="check">✓</span>' : '');
      btn.addEventListener('click', function () {
        togglePlaylistMembership(pl.id, addMenuTargetSongId);
        renderAddMenu();
        renderPlaylists();
      });
      menu.appendChild(btn);
    });
  }

  // ---------- Mood chips / lyrics panel ----------
  function renderMoodChips(container, moods) {
    container.innerHTML = '';
    (moods || []).forEach(function (m) {
      const chip = document.createElement('span');
      chip.className = 'mood-chip';
      chip.textContent = m.charAt(0).toUpperCase() + m.slice(1);
      chip.style.setProperty('--chip-color', MOOD_COLORS[m] || '');
      container.appendChild(chip);
    });
  }
  function renderLyricsPanel(lyrics) {
    const el = $('lyrics-panel');
    el.innerHTML = '';
    if (!lyrics || !lyrics.length) {
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = 'No synced lyrics for this track yet.';
      el.appendChild(p);
      return;
    }
    lyrics.forEach(function (line) {
      const p = document.createElement('p');
      p.className = 'lyric-line';
      p.dataset.time = String(line.t);
      p.textContent = line.text;
      el.appendChild(p);
    });
  }
  function updateActiveLyric(currentTime) {
    const lines = document.querySelectorAll('#lyrics-panel .lyric-line');
    if (!lines.length) return;
    let activeIdx = -1;
    lines.forEach(function (el, i) {
      const t = parseFloat(el.dataset.time);
      if (!Number.isNaN(t) && t <= currentTime) activeIdx = i;
    });
    lines.forEach(function (el, i) { el.classList.toggle('current', i === activeIdx); });
    if (activeIdx >= 0) {
      lines[activeIdx].scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }

  // ---------- Now-playing UI ----------
  function updateMiniPlayerUI(song) {
    $('mini-art').src = song.art;
    $('mini-title').textContent = song.title;
    $('mini-artist').textContent = song.artist;
    $('mini-player').classList.remove('hidden');
  }
  function updateFullPlayerUI(song) {
    $('full-art').src = song.art;
    $('full-player-bg').style.backgroundImage = 'url("' + song.art + '")';
    $('full-title').textContent = song.title;
    $('full-artist').textContent = song.artist;
    renderMoodChips($('mood-chips'), song.moods);
    renderLyricsPanel(song.lyrics);
    $('demo-note').classList.toggle('hidden', !!song.src);
    updateProgressUI(0, song.duration || 0);
  }
  function updateProgressUI(currentTime, duration) {
    const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    const seekBar = $('seek-bar');
    seekBar.value = String(pct);
    seekBar.style.setProperty('--seek-pct', pct + '%');
    $('time-elapsed').textContent = formatTime(currentTime);
    $('time-duration').textContent = formatTime(duration);
    updateActiveLyric(currentTime);
    updateMediaSessionPosition(currentTime, duration);
  }
  function updatePlayPauseIcons() {
    const iconId = isPlaying ? '#icon-pause' : '#icon-play';
    const label = isPlaying ? 'Pause' : 'Play';
    ['mini-playpause', 'playpause-btn'].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', iconId);
      btn.setAttribute('aria-label', label);
    });
    updateMediaSessionPlaybackState();
  }

  // ---------- Web Audio EQ ----------
  function ensureAudioGraph() {
    if (audioGraphReady) return;
    audioGraphReady = true; // set first so a failure never retries in a loop
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const low = audioCtx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 150;
      const mid = audioCtx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
      const high = audioCtx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000;
      eqFilters = [low, mid, high];
      const source = audioCtx.createMediaElementSource(audio);
      source.connect(low); low.connect(mid); mid.connect(high); high.connect(audioCtx.destination);
      applyEqPreset(currentEqPreset);
    } catch (err) {
      console.warn('Web Audio EQ unavailable, playback will still work without it:', err);
      eqFilters = [];
    }
  }
  function applyEqPreset(name) {
    currentEqPreset = EQ_PRESETS[name] ? name : 'flat';
    const gains = EQ_PRESETS[currentEqPreset];
    eqFilters.forEach(function (filter, i) {
      try {
        filter.gain.setTargetAtTime(gains[i], audioCtx.currentTime, 0.05);
      } catch (err) {
        filter.gain.value = gains[i];
      }
    });
    renderEqRow();
  }
  function renderEqRow() {
    const el = $('eq-row');
    el.innerHTML = '';
    Object.keys(EQ_PRESETS).forEach(function (name) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'eq-chip' + (name === currentEqPreset ? ' active' : '');
      btn.textContent = EQ_LABELS[name];
      btn.dataset.preset = name;
      el.appendChild(btn);
    });
  }

  // ---------- Playback engine ----------
  function loadSong(id, opts) {
    const song = songs.find(function (s) { return s.id === id; });
    if (!song) return;
    clearInterval(demoTimer);
    const prev = getCurrentSong();
    if (prev && prev.src) { try { audio.pause(); } catch (err) { /* no-op */ } }
    currentSongId = id;
    demoElapsed = 0;
    demoDuration = song.duration || 0;
    updateMiniPlayerUI(song);
    updateFullPlayerUI(song);
    highlightPlayingRow(id);
    updateMediaSessionMetadata(song);
    if (song.src && audio.src !== song.src) audio.src = song.src;
    const autoplay = opts && 'autoplay' in opts ? opts.autoplay : true;
    if (autoplay) play(); else { isPlaying = false; updatePlayPauseIcons(); }
  }
  function play() {
    const song = getCurrentSong();
    if (!song) return;
    if (song.src) {
      ensureAudioGraph();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function (err) {
          console.warn('Playback was blocked or failed:', err);
          isPlaying = false;
          updatePlayPauseIcons();
        });
      }
    } else {
      clearInterval(demoTimer);
      demoTimer = setInterval(tick, 250);
    }
    isPlaying = true;
    updatePlayPauseIcons();
  }
  function pause() {
    const song = getCurrentSong();
    if (song && song.src) audio.pause(); else clearInterval(demoTimer);
    isPlaying = false;
    updatePlayPauseIcons();
  }
  function togglePlay() { if (isPlaying) pause(); else play(); }
  function tick() {
    demoElapsed += 0.25;
    if (demoElapsed >= demoDuration) {
      demoElapsed = demoDuration;
      updateProgressUI(demoElapsed, demoDuration);
      handleTrackEnded();
      return;
    }
    updateProgressUI(demoElapsed, demoDuration);
  }
  function handleTrackEnded() { nextSong(); }
  function nextSong() {
    if (!songs.length) return;
    const idx = songs.findIndex(function (s) { return s.id === currentSongId; });
    const next = songs[(idx + 1 + songs.length) % songs.length];
    loadSong(next.id, { autoplay: isPlaying });
  }
  function prevSong() {
    if (!songs.length) return;
    const idx = songs.findIndex(function (s) { return s.id === currentSongId; });
    const prevTrack = songs[(idx - 1 + songs.length) % songs.length];
    loadSong(prevTrack.id, { autoplay: isPlaying });
  }

  audio.addEventListener('timeupdate', function () {
    const song = getCurrentSong();
    if (!song || !song.src) return;
    updateProgressUI(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : song.duration);
  });
  audio.addEventListener('ended', handleTrackEnded);
  audio.addEventListener('error', function () {
    console.error('Playback error on the current track.');
    isPlaying = false;
    updatePlayPauseIcons();
  });

  // ---------- File import ----------
  function parseFilename(name) {
    const base = name.replace(/\.[^/.]+$/, '');
    const parts = base.split(' - ');
    if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    return { title: base.trim() || 'Untitled', artist: 'Unknown Artist' };
  }
  function primeDuration(song) {
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function () {
      song.duration = probe.duration || 0;
      if (document.querySelector('.view.active') === $('view-library')) renderLibrary();
    }, { once: true });
    probe.addEventListener('error', function () { /* leave duration at 0 — non-fatal */ }, { once: true });
    probe.src = song.src;
  }
  function addImportedFile(file) {
    try {
      const url = URL.createObjectURL(file);
      const meta = parseFilename(file.name);
      const song = {
        id: 'song-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        title: meta.title, artist: meta.artist,
        duration: 0, art: placeholderArt('warm'), moods: [], lyrics: null,
        src: url, isDemo: false,
      };
      songs.push(song);
      primeDuration(song);
      // Note: object URLs aren't revoked — there's no remove-song flow yet.
      // Revoke with URL.revokeObjectURL(song.src) if/when one is added.
    } catch (err) {
      console.error('Could not import file', file && file.name, err);
    }
  }

  // ---------- View / nav switching ----------
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.dataset.view === name); });
  }
  function setActiveNav(name) {
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    showView(name);
  }

  // ---------- Full player open / close ----------
  function openFullPlayer() {
    if (!currentSongId) return;
    const fp = $('full-player');
    fp.classList.remove('hidden');
    fp.setAttribute('aria-hidden', 'false');
    void fp.offsetHeight; // force reflow so translateY(100%) applies before animating
    requestAnimationFrame(function () { fp.classList.add('open'); });
  }
  function closeFullPlayer() {
    const fp = $('full-player');
    fp.classList.remove('open');
    fp.setAttribute('aria-hidden', 'true');
    const onEnd = function () { fp.classList.add('hidden'); fp.removeEventListener('transitionend', onEnd); };
    fp.addEventListener('transitionend', onEnd);
    setTimeout(function () { fp.classList.add('hidden'); }, 500);
  }

  // Drag-to-dismiss on the sheet's grabber header — matches HIG's "drag the
  // grabber" sheet convention. A near-zero-movement release is treated as a
  // tap (so the grabber is a click target too, not drag-only).
  (function wireSheetDrag() {
    const header = $('full-player-header');
    const fp = $('full-player');
    let drag = null;

    function start(e) {
      if (!fp.classList.contains('open')) return;
      drag = { startY: e.clientY, delta: 0 };
      fp.classList.add('dragging');
      if (header.setPointerCapture) {
        try { header.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
      }
    }
    function move(e) {
      if (!drag) return;
      drag.delta = Math.max(0, e.clientY - drag.startY);
      fp.style.transform = 'translateY(' + drag.delta + 'px)';
    }
    function end() {
      if (!drag) return;
      const shouldClose = drag.delta > 140 || drag.delta < 4;
      fp.classList.remove('dragging');
      fp.style.transform = '';
      if (shouldClose) closeFullPlayer();
      drag = null;
    }
    header.addEventListener('pointerdown', start);
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
    header.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeFullPlayer(); }
    });
  })();

  // Spacebar toggles play/pause while the full player is open, as long as
  // focus isn't inside a text input.
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (!$('full-player').classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    togglePlay();
  });

  // ---------- MediaSession — surfaces Now Playing on the lock screen,
  // Control Center, and hardware/Bluetooth media keys ----------
  function updateMediaSessionMetadata(song) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: 'Lis-N',
        artwork: [{ src: song.art, sizes: '300x300', type: 'image/svg+xml' }],
      });
    } catch (err) { console.warn('MediaSession metadata failed', err); }
  }
  function updateMediaSessionPlaybackState() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (err) { /* no-op */ }
  }
  function updateMediaSessionPosition(currentTime, duration) {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration: duration, position: Math.min(currentTime, duration), playbackRate: 1 });
    } catch (err) { /* some browsers reject edge-case values — non-fatal */ }
  }
  function wireMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: function () { play(); },
      pause: function () { pause(); },
      previoustrack: function () { prevSong(); },
      nexttrack: function () { nextSong(); },
      seekto: function (details) {
        const song = getCurrentSong();
        if (!song || !details || details.seekTime == null) return;
        if (song.src) { audio.currentTime = details.seekTime; }
        else { demoElapsed = Math.min(details.seekTime, demoDuration); updateProgressUI(demoElapsed, demoDuration); }
      },
      seekbackward: function (details) {
        const song = getCurrentSong(); if (!song) return;
        const skip = (details && details.seekOffset) || 10;
        if (song.src) audio.currentTime = Math.max(0, audio.currentTime - skip);
        else { demoElapsed = Math.max(0, demoElapsed - skip); updateProgressUI(demoElapsed, demoDuration); }
      },
      seekforward: function (details) {
        const song = getCurrentSong(); if (!song) return;
        const skip = (details && details.seekOffset) || 10;
        const dur = song.src ? (Number.isFinite(audio.duration) ? audio.duration : song.duration) : demoDuration;
        if (song.src) audio.currentTime = Math.min(dur, audio.currentTime + skip);
        else { demoElapsed = Math.min(dur, demoElapsed + skip); updateProgressUI(demoElapsed, demoDuration); }
      },
    };
    Object.keys(handlers).forEach(function (action) {
      try {
        navigator.mediaSession.setActionHandler(action, function (details) {
          try { handlers[action](details); } catch (err) { console.warn('MediaSession "' + action + '" handler failed', err); }
        });
      } catch (err) { /* some browsers throw on unsupported actions — safe to ignore */ }
    });
  }

  // ---------- Wire everything up ----------
  function init() {
    attachListListeners($('library-list'));
    attachListListeners($('search-list'));
    attachListListeners($('playlist-detail-list'));

    renderLibrary();
    renderPlaylists();
    renderEqRow();
    wireMediaSessionHandlers();

    $('bottom-nav').addEventListener('click', function (e) {
      const btn = e.target.closest('.nav-btn');
      if (btn) setActiveNav(btn.dataset.view);
    });
    $('playlist-back-btn').addEventListener('click', function () { setActiveNav('playlists'); });

    $('playlist-grid').addEventListener('click', function (e) {
      const card = e.target.closest('.playlist-card');
      if (card) openPlaylistDetail(card.dataset.id);
    });
    $('new-playlist-btn').addEventListener('click', function () {
      const form = $('new-playlist-form');
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) $('new-playlist-name').focus();
    });
    $('new-playlist-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('new-playlist-name');
      const name = input.value.trim();
      if (!name) return;
      createPlaylist(name);
      input.value = '';
      $('new-playlist-form').classList.add('hidden');
      renderPlaylists();
    });

    $('search-input').addEventListener('input', debounce(function (e) {
      const q = e.target.value.trim().toLowerCase();
      const results = !q ? [] : songs.filter(function (s) {
        return s.title.toLowerCase().indexOf(q) !== -1 || s.artist.toLowerCase().indexOf(q) !== -1;
      });
      renderSongListInto($('search-list'), results, { grouped: false });
      $('search-empty').classList.toggle('hidden', !q || results.length > 0);
    }, 120));

    $('import-btn').addEventListener('click', function () { $('file-input').click(); });
    $('file-input').addEventListener('change', function (e) {
      Array.from(e.target.files || []).forEach(addImportedFile);
      e.target.value = '';
      renderLibrary();
    });

    $('mini-player-surface').addEventListener('click', openFullPlayer);
    $('mini-player-surface').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFullPlayer(); }
    });
    $('mini-playpause').addEventListener('click', togglePlay);
    $('playpause-btn').addEventListener('click', togglePlay);
    $('prev-btn').addEventListener('click', prevSong);
    $('next-btn').addEventListener('click', nextSong);

    $('seek-bar').addEventListener('input', function (e) {
      const song = getCurrentSong();
      if (!song) return;
      const duration = song.src ? (Number.isFinite(audio.duration) ? audio.duration : song.duration) : demoDuration;
      const newTime = (parseFloat(e.target.value) / 100) * duration;
      if (song.src) { try { audio.currentTime = newTime; } catch (err) { /* metadata not ready yet */ } }
      else demoElapsed = newTime;
      updateProgressUI(newTime, duration);
    });

    $('eq-row').addEventListener('click', function (e) {
      const btn = e.target.closest('.eq-chip');
      if (btn) applyEqPreset(btn.dataset.preset);
    });

    document.addEventListener('pointerdown', function (e) {
      const menu = $('add-menu');
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || e.target.closest('.row-add-btn')) return;
      closeAddMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAddMenu(); });

    if (songs.length) loadSong(songs[0].id, { autoplay: false });
  }

  document.addEventListener('DOMContentLoaded', function () {
    try { init(); } catch (err) { console.error('Lis-N failed to start:', err); }
  });
})();
