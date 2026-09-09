(() => {
  'use strict';

  const state = {
    records: [],
    selected: 0,
  };

  const els = {
    stage: document.getElementById('stage'),
    statusCount: document.getElementById('status-count'),
    nowTitle: document.getElementById('now-title'),
    nowSub: document.getElementById('now-sub'),
    wheel: document.getElementById('click-wheel'),
    wheelCenter: document.getElementById('wheel-center'),
    overlay: document.getElementById('detail-overlay'),
    detailClose: document.getElementById('detail-close'),
    detailCover: document.getElementById('detail-cover'),
    detailAlbum: document.getElementById('detail-album'),
    detailArtist: document.getElementById('detail-artist'),
    detailMeta: document.getElementById('detail-meta'),
    detailNotesSection: document.getElementById('detail-notes-section'),
    detailNotes: document.getElementById('detail-notes'),
    detailTracklistSection: document.getElementById('detail-tracklist-section'),
    detailTracklist: document.getElementById('detail-tracklist'),
    detailCondition: document.getElementById('detail-condition'),
    detailPriceValue: document.getElementById('detail-price-value'),
    detailPriceSub: document.getElementById('detail-price-sub'),
    detailDiscogsLink: document.getElementById('detail-discogs-link'),
    nowPrice: document.getElementById('now-price'),
    collectionTotal: document.getElementById('collection-total'),
    searchToggle: document.getElementById('search-toggle'),
    searchPanel: document.getElementById('search-panel'),
    searchInput: document.getElementById('search-input'),
    searchResults: document.getElementById('search-results'),
  };

  let coverEls = [];

  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    return res.json();
  }

  async function loadData() {
    const [collection, details, covers, prices] = await Promise.all([
      loadJson('data/collection.json'),
      loadJson('data/details.json'),
      loadJson('data/covers.json'),
      loadJson('data/prices.json'),
    ]);
    return collection.map((rec) => ({
      ...rec,
      details: details[rec.id] || null,
      cover: covers[rec.id] || null,
      price: prices[rec.id] || null,
    }));
  }

  function placeholderGradient(seedText) {
    let hash = 0;
    for (let i = 0; i < seedText.length; i += 1) hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
    const h1 = hash % 360;
    const h2 = (h1 + 55) % 360;
    return `linear-gradient(155deg, hsl(${h1}, 45%, 32%), hsl(${h2}, 40%, 16%))`;
  }

  function buildCoverEl(record) {
    const el = document.createElement('div');
    el.className = 'cover';
    el.dataset.id = record.id;

    if (record.cover && record.cover.imagePath) {
      el.style.backgroundImage = `url("${record.cover.imagePath}")`;
    } else {
      el.style.backgroundImage = placeholderGradient(record.id);
      const text = document.createElement('div');
      text.className = 'cover-placeholder-text';
      text.textContent = `${record.artist}\n${record.album}`;
      el.appendChild(text);
      const peek = document.createElement('div');
      peek.className = 'cover-vinyl-peek';
      el.appendChild(peek);
    }

    el.addEventListener('click', () => {
      const idx = state.records.indexOf(record);
      if (idx === state.selected) {
        openDetail(record);
      } else {
        selectIndex(idx);
      }
    });

    return el;
  }

  function renderCovers() {
    els.stage.innerHTML = '';
    coverEls = state.records.map((record) => {
      const el = buildCoverEl(record);
      els.stage.appendChild(el);
      return el;
    });
    updateTransforms();
  }

  function updateTransforms() {
    const spacing = 96;
    const sideSkew = 14;
    const visibleWindow = 10;

    coverEls.forEach((el, i) => {
      const offset = i - state.selected;
      const abs = Math.abs(offset);

      if (abs > visibleWindow) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }

      el.style.pointerEvents = 'auto';

      let transform;
      let opacity = 1;
      let zIndex = 1000 - abs;

      if (offset === 0) {
        transform = 'translateX(0) scale(1.08)';
      } else {
        const dir = offset > 0 ? 1 : -1;
        const x = dir * (spacing * 0.75 + (abs - 1) * spacing * 0.42);
        transform = `translateX(${x}px) skewY(${-dir * sideSkew}deg) scale(0.5, 0.82)`;
        if (abs > 5) opacity = Math.max(0, 1 - (abs - 5) / 5);
      }

      el.style.transform = transform;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(zIndex);
    });

    const current = state.records[state.selected];
    if (current) {
      const year = displayYear(current);
      els.nowTitle.textContent = current.album;
      els.nowSub.textContent = `${current.artist}${year ? ' · ' + year : ''}`;
      els.nowPrice.textContent = formatPriceShort(current.price);
    }
    els.statusCount.textContent = `${state.selected + 1} / ${state.records.length}`;
  }

  function selectIndex(idx) {
    if (!state.records.length) return;
    const clamped = Math.max(0, Math.min(state.records.length - 1, idx));
    if (clamped === state.selected) return;
    state.selected = clamped;
    updateTransforms();
  }

  function step(delta) {
    selectIndex(state.selected + delta);
  }

  function displayYear(record) {
    return record.albumYear;
  }

  // Two distinct years can apply to a record: the album's first-ever release
  // (albumYear, from the sheet) and the specific pressing/edition Discogs
  // matched via catalog number (details.released). Only show both when they
  // actually differ, so an original pressing just shows one year.
  function cardYears(record) {
    const original = record.albumYear || null;
    const editionRaw = record.details?.released;
    const edition = editionRaw ? Number(String(editionRaw).slice(0, 4)) : null;
    if (original && edition && edition !== original) {
      return `${original} · ${edition} pressing`;
    }
    return original ? String(original) : edition ? String(edition) : null;
  }

  function estimatedValue(price) {
    if (!price) return null;
    if (typeof price.estimatedValue === 'number') return price.estimatedValue;
    if (typeof price.lowestPrice === 'number') return price.lowestPrice;
    return null;
  }

  // Best-to-worst grade scale, matching scripts/estimate-price.mjs.
  const CONDITION_ORDER = ['S', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];

  // Sheet values are "sleeve/media" grades, e.g. "VG+/VG+" — the worse of the
  // two drives the color, same heuristic as the price multiplier.
  function worseGrade(raw) {
    if (!raw) return null;
    const grades = raw
      .split('/')
      .map((g) => g.trim().toUpperCase())
      .filter((g) => CONDITION_ORDER.includes(g));
    if (!grades.length) return null;
    return grades.reduce((worst, g) =>
      CONDITION_ORDER.indexOf(g) > CONDITION_ORDER.indexOf(worst) ? g : worst
    );
  }

  // Green at/above the VG+ anchor (a typical marketplace-listing grade),
  // orange/red below it — richer/redder the further from the anchor.
  const ANCHOR_INDEX = CONDITION_ORDER.indexOf('VG+');

  function conditionColors(grade) {
    const idx = CONDITION_ORDER.indexOf(grade);
    if (idx === -1) return null;
    let hue;
    let light;
    if (idx <= ANCHOR_INDEX) {
      const t = idx / ANCHOR_INDEX;
      hue = 150;
      light = 30 + t * 12;
    } else {
      const t = (idx - ANCHOR_INDEX) / (CONDITION_ORDER.length - 1 - ANCHOR_INDEX);
      hue = 38 - t * 28;
      light = 42 - t * 8;
    }
    return {
      bg: `hsl(${hue}, 55%, 90%)`,
      fg: `hsl(${hue}, 60%, ${light}%)`,
    };
  }

  function formatPriceValue(price) {
    const est = estimatedValue(price);
    if (est == null) return 'Not priced';
    const currency = price.currency || 'USD';
    return `${price.condition ? 'Est. ' : ''}${est.toFixed(2)} ${currency}`;
  }

  function formatPriceSub(price) {
    if (!price) return '';
    const currency = price.currency || 'USD';
    const parts = [];
    if (price.lowestPrice == null) {
      parts.push('no current listings — default estimate');
    } else if (price.condition) {
      parts.push(`Discogs lowest ${price.lowestPrice.toFixed(2)} ${currency}`);
    } else {
      parts.push('unadjusted, no condition set');
    }
    if (price.numForSale) parts.push(`${price.numForSale} for sale`);
    return parts.join(' · ');
  }

  function formatPriceShort(price) {
    const est = estimatedValue(price);
    if (est == null) return 'not priced';
    return `$${est.toFixed(2)}`;
  }

  function renderCollectionTotal() {
    const priced = state.records.filter((r) => estimatedValue(r.price) != null);
    const total = priced.reduce((sum, r) => sum + estimatedValue(r.price), 0);
    els.collectionTotal.textContent = priced.length
      ? `Collection value: $${total.toFixed(2)}`
      : 'Collection value: not estimated yet';
  }

  function openDetail(record) {
    const d = record.details;
    els.detailAlbum.textContent = record.album;
    els.detailArtist.textContent = record.artist;

    const metaParts = [];
    const years = cardYears(record);
    if (years) metaParts.push(years);
    if (d?.label) metaParts.push(d.label);
    if (d?.country) metaParts.push(d.country);
    if (d?.genres?.length) metaParts.push(d.genres.join(', '));
    els.detailMeta.textContent = metaParts.length ? metaParts.join(' · ') : 'Not enriched yet — run /enrich-details';

    if (record.cover?.imagePath) {
      els.detailCover.src = record.cover.imagePath;
      els.detailCover.alt = `${record.album} cover`;
    } else {
      els.detailCover.removeAttribute('src');
      els.detailCover.alt = 'No cover yet';
    }

    const grade = worseGrade(record.condition);
    const colors = grade ? conditionColors(grade) : null;
    els.detailCondition.textContent = record.condition || 'Ungraded';
    els.detailCondition.style.background = colors ? colors.bg : '';
    els.detailCondition.style.color = colors ? colors.fg : '';

    if (d?.notes) {
      els.detailNotesSection.style.display = '';
      els.detailNotes.textContent = d.notes;
    } else {
      els.detailNotesSection.style.display = 'none';
    }

    els.detailTracklist.innerHTML = '';
    if (d?.tracklist?.length) {
      els.detailTracklistSection.style.display = '';
      d.tracklist.forEach((t) => {
        const li = document.createElement('li');
        const pos = t.position ? `${t.position}. ` : '';
        const dur = t.duration ? ` (${t.duration})` : '';
        li.textContent = `${pos}${t.title}${dur}`;
        els.detailTracklist.appendChild(li);
      });
    } else {
      els.detailTracklistSection.style.display = 'none';
    }

    els.detailPriceValue.textContent = formatPriceValue(record.price);
    els.detailPriceSub.textContent = formatPriceSub(record.price);

    if (d?.discogsUrl) {
      els.detailDiscogsLink.href = d.discogsUrl;
      els.detailDiscogsLink.style.display = '';
    } else {
      els.detailDiscogsLink.style.display = 'none';
    }

    els.overlay.classList.add('open');
    els.overlay.setAttribute('aria-hidden', 'false');
  }

  function closeDetail() {
    els.overlay.classList.remove('open');
    els.overlay.setAttribute('aria-hidden', 'true');
  }

  function jumpToRecord(idx) {
    const record = state.records[idx];
    if (!record) return;
    state.selected = Math.max(0, Math.min(state.records.length - 1, idx));
    updateTransforms();
    openDetail(record);
    closeSearch();
  }

  const SEARCH_MIN_LENGTH = 3;
  const MAX_RESULTS_PER_GROUP = 8;

  function searchRecords(term) {
    const q = term.toLowerCase();
    const artists = [];
    const seenArtists = new Set();
    const records = [];
    const songs = [];

    state.records.forEach((record, idx) => {
      if (!seenArtists.has(record.artist) && record.artist.toLowerCase().includes(q)) {
        seenArtists.add(record.artist);
        artists.push({ label: record.artist, idx });
      }
      if (record.album.toLowerCase().includes(q)) {
        records.push({ label: record.album, sub: record.artist, idx });
      }
      record.details?.tracklist?.forEach((t) => {
        if (t.title && t.title.toLowerCase().includes(q)) {
          songs.push({ label: t.title, sub: `${record.artist} — ${record.album}`, idx });
        }
      });
    });

    return { artists, records, songs };
  }

  function buildResultItem({ label, sub, idx }) {
    const li = document.createElement('li');
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const title = document.createElement('span');
    title.className = 'search-result-title';
    title.textContent = label;
    item.appendChild(title);

    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'search-result-sub';
      subEl.textContent = sub;
      item.appendChild(subEl);
    }

    item.addEventListener('click', () => jumpToRecord(idx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        jumpToRecord(idx);
      }
    });

    li.appendChild(item);
    return li;
  }

  function buildGroup(title, items) {
    if (!items.length) return null;
    const group = document.createElement('div');
    group.className = 'search-group';
    const h4 = document.createElement('h4');
    h4.textContent = title;
    group.appendChild(h4);
    const ul = document.createElement('ul');
    items.slice(0, MAX_RESULTS_PER_GROUP).forEach((item) => ul.appendChild(buildResultItem(item)));
    group.appendChild(ul);
    return group;
  }

  function renderSearchResults(term) {
    els.searchResults.innerHTML = '';
    const trimmed = term.trim();
    if (!trimmed) return;

    if (trimmed.length < SEARCH_MIN_LENGTH) {
      const hint = document.createElement('div');
      hint.className = 'search-empty';
      hint.textContent = `Type at least ${SEARCH_MIN_LENGTH} characters`;
      els.searchResults.appendChild(hint);
      return;
    }

    const { artists, records, songs } = searchRecords(trimmed);
    const groups = [
      buildGroup('Artist', artists),
      buildGroup('Record', records),
      buildGroup('Song', songs),
    ].filter(Boolean);

    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = 'No matches found';
      els.searchResults.appendChild(empty);
      return;
    }

    groups.forEach((group) => els.searchResults.appendChild(group));
  }

  function openSearch() {
    els.searchPanel.classList.add('open');
    els.searchPanel.setAttribute('aria-hidden', 'false');
    els.searchInput.value = '';
    els.searchResults.innerHTML = '';
    els.searchInput.focus();
  }

  function closeSearch() {
    els.searchPanel.classList.remove('open');
    els.searchPanel.setAttribute('aria-hidden', 'true');
  }

  function setupSearch() {
    els.searchToggle.addEventListener('click', () => {
      if (els.searchPanel.classList.contains('open')) closeSearch();
      else openSearch();
    });

    els.searchInput.addEventListener('input', () => {
      renderSearchResults(els.searchInput.value);
    });
  }

  function setupWheel() {
    let dragging = false;
    let lastAngle = 0;
    let accum = 0;
    const stepDeg = 16;

    function angleFromEvent(e) {
      const rect = els.wheel.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    }

    function onPointerDown(e) {
      if (e.target === els.wheelCenter || e.target.classList.contains('wheel-label')) return;
      dragging = true;
      els.wheel.classList.add('dragging');
      lastAngle = angleFromEvent(e);
      els.wheel.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const angle = angleFromEvent(e);
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      accum += delta;
      lastAngle = angle;
      while (accum >= stepDeg) {
        step(1);
        accum -= stepDeg;
      }
      while (accum <= -stepDeg) {
        step(-1);
        accum += stepDeg;
      }
    }

    function onPointerUp(e) {
      dragging = false;
      accum = 0;
      els.wheel.classList.remove('dragging');
      els.wheel.releasePointerCapture?.(e.pointerId);
    }

    els.wheel.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    els.wheelCenter.addEventListener('click', () => {
      const record = state.records[state.selected];
      if (record) openDetail(record);
    });

    document.querySelector('.wheel-label-left').addEventListener('click', () => step(-1));
    document.querySelector('.wheel-label-right').addEventListener('click', () => step(1));
    document.querySelector('.wheel-label-top').addEventListener('click', () => {
      closeSearch();
      selectIndex(0);
    });
    document.querySelector('.wheel-label-bottom').addEventListener('click', () => {
      closeSearch();
      selectIndex(state.records.length - 1);
    });
  }

  function setupKeyboardAndScroll() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.searchPanel.classList.contains('open')) closeSearch();
        else closeDetail();
        return;
      }
      if (document.activeElement === els.searchInput) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Enter') {
        const record = state.records[state.selected];
        if (record) openDetail(record);
      }
    });

    let wheelAccum = 0;
    document.getElementById('stage-viewport').addEventListener(
      'wheel',
      (e) => {
        if (els.searchPanel.classList.contains('open')) return;
        e.preventDefault();
        wheelAccum += e.deltaY || e.deltaX;
        const threshold = 40;
        while (wheelAccum >= threshold) {
          step(1);
          wheelAccum -= threshold;
        }
        while (wheelAccum <= -threshold) {
          step(-1);
          wheelAccum += threshold;
        }
      },
      { passive: false }
    );
  }

  function setupOverlay() {
    els.detailClose.addEventListener('click', closeDetail);
    els.overlay.addEventListener('click', (e) => {
      if (e.target === els.overlay) closeDetail();
    });
  }

  async function init() {
    try {
      state.records = await loadData();
    } catch (err) {
      els.statusCount.textContent = 'Failed to load data';
      console.error(err);
      return;
    }
    renderCovers();
    renderCollectionTotal();
    setupWheel();
    setupKeyboardAndScroll();
    setupOverlay();
    setupSearch();
  }

  init();
})();
