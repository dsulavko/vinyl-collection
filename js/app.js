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
    detailPrice: document.getElementById('detail-price'),
    detailDiscogsLink: document.getElementById('detail-discogs-link'),
    nowPrice: document.getElementById('now-price'),
    collectionTotal: document.getElementById('collection-total'),
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
    const sideAngle = 62;
    const sideDepth = -220;
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
        transform = 'translateX(0) translateZ(40px) rotateY(0deg) scale(1.08)';
      } else {
        const dir = offset > 0 ? 1 : -1;
        const x = dir * (spacing * 1.1 + (abs - 1) * spacing * 0.55);
        transform = `translateX(${x}px) translateZ(${sideDepth}px) rotateY(${-dir * sideAngle}deg) scale(0.82)`;
        if (abs > 5) opacity = Math.max(0, 1 - (abs - 5) / 5);
      }

      el.style.transform = transform;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(zIndex);
    });

    const current = state.records[state.selected];
    if (current) {
      els.nowTitle.textContent = current.album;
      els.nowSub.textContent = `${current.artist}${current.year ? ' · ' + current.year : ''}`;
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

  function formatPrice(price) {
    if (!price || typeof price.lowestPrice !== 'number') return 'Not estimated yet';
    const amount = `${price.lowestPrice.toFixed(2)} ${price.currency || 'USD'}`;
    const forSale = price.numForSale ? ` · ${price.numForSale} for sale` : '';
    return `From ${amount}${forSale} (Discogs marketplace, lowest listed)`;
  }

  function formatPriceShort(price) {
    if (!price || typeof price.lowestPrice !== 'number') return 'not priced';
    return `$${price.lowestPrice.toFixed(2)}`;
  }

  function renderCollectionTotal() {
    const priced = state.records.filter((r) => typeof r.price?.lowestPrice === 'number');
    const total = priced.reduce((sum, r) => sum + r.price.lowestPrice, 0);
    els.collectionTotal.textContent = priced.length
      ? `Collection value: $${total.toFixed(2)} (${priced.length} of ${state.records.length} records priced, Discogs lowest listing)`
      : 'Collection value: not estimated yet';
  }

  function openDetail(record) {
    const d = record.details;
    els.detailAlbum.textContent = record.album;
    els.detailArtist.textContent = record.artist;

    const metaParts = [];
    if (record.year) metaParts.push(record.year);
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

    els.detailPrice.textContent = formatPrice(record.price);

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
      if (e.target === els.wheelCenter) return;
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
    document.querySelector('.wheel-label-top').addEventListener('click', () => step(-10));
    document.querySelector('.wheel-label-bottom').addEventListener('click', () => step(10));
  }

  function setupKeyboardAndScroll() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Escape') closeDetail();
      else if (e.key === 'Enter') {
        const record = state.records[state.selected];
        if (record) openDetail(record);
      }
    });

    let wheelAccum = 0;
    document.getElementById('stage-viewport').addEventListener(
      'wheel',
      (e) => {
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
  }

  init();
})();
