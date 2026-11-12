// ===== Table app =====
(() => {
  const $view = document.getElementById('view');
  const $levels = document.getElementById('levels');
  const $toast = document.getElementById('toast');
  const TEAM = ['Red', 'Blue'];
  const TEAM_VAR = ['var(--team-r)', 'var(--team-b)'];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let G = null;            // table state as the server shows it to this player
  let status = 'home';     // home | connecting | ready | notfound
  let mode = 'online';     // online | solo
  let tableId = '';
  let ws = null, connected = false, retry = 0, busyTimer = null;
  const myId = 'me', canWrite = true, profileName = '';
  let sel = new Set();
  let choice = null;
  let busy = false;
  let confirmReset = false;
  let toastTimer = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  function flash(msg) {
    $toast.textContent = msg; $toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $toast.hidden = true; }, 3600);
  }

  const mySeat = () => {
    if (!G) return -1;
    if (mode === 'solo') return G.phase === 'tribute' && G.returns.length ? G.returns[0].from : G.turn;
    return G.seats.findIndex((s) => s && s.uid === myId);
  };
  const L = () => GD.curLevel(G);

  // ---------- talking to the server ----------
  function makeToken() {
    let t = store.get('gd-token');
    if (t && /^[A-Za-z0-9-]{16,64}$/.test(t)) return t;
    try { t = crypto.randomUUID(); } catch (e) { t = Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join(''); }
    store.set('gd-token', t);
    return t;
  }
  const token = makeToken();

  function sendRaw(m) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
    return false;
  }

  // send a table action; in the practice game apply it right here
  function act(a) {
    if (busy) return;
    if (mode === 'solo') {
      const base = clone(G);
      const err = GD.applyAction(base, { uid: 'solo', seat: mySeat() }, a);
      if (err) { flash(err); return; }
      base.v += 1; G = base; sel.clear(); choice = null; render();
      return;
    }
    if (!sendRaw({ type: 'act', a })) { flash('Not connected. Reconnecting…'); return; }
    busy = true; render();
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { busy = false; render(); }, 5000);
  }

  function onState(table, st) {
    const prevRound = G && G.round, prevPhase = G && G.phase;
    tableId = table;
    G = st;
    if (location.hash.slice(1) !== table) history.replaceState(null, '', '#' + table);
    if (G.round !== prevRound || G.phase !== prevPhase) { sel.clear(); choice = null; }
    const me = mySeat();
    const hand = me >= 0 ? G.hands[me] : [];
    for (const c of [...sel]) if (!hand.includes(c)) sel.delete(c);
  }

  // ---------- actions ----------
  const nickInput = () => {
    const el = document.getElementById('nick');
    const v = (el ? el.value : store.get('gd-nick') || profileName || '').trim().slice(0, 18);
    return v;
  };

  const actions = {
    sit(seat) {
      const nick = nickInput();
      if (!nick) { flash('Enter a name first.'); document.getElementById('nick')?.focus(); return; }
      store.set('gd-nick', nick);
      act({ type: 'sit', seat, nick });
    },
    leave() { act({ type: 'leave' }); },
    kick(seat) { act({ type: 'kick', seat }); },
    start() { act({ type: 'start' }); },
    next() { act({ type: 'next' }); },
    toLobby() {
      if (!confirmReset && G.phase !== 'over') { confirmReset = true; render(); return; }
      confirmReset = false;
      if (mode === 'solo') { actions.solo(); return; }
      act({ type: 'lobby' });
    },
    cancelReset() { confirmReset = false; render(); },
    play() { act({ type: 'play', cards: [...sel], choice }); },
    pass() { act({ type: 'pass' }); },
    giveBack() { const [card] = [...sel]; act({ type: 'return', card }); },
    create() {
      const nick = nickInput();
      if (nick) store.set('gd-nick', nick);
      status = 'connecting'; render();
      pending = { type: 'create', token };
      connect();
    },
    copyLink() {
      const link = location.href;
      const done = () => flash('Link copied. Send it to your friends.');
      try {
        navigator.clipboard.writeText(link).then(done, () => { selectLink(); });
      } catch (e) { selectLink(); }
    },
    clear() { sel.clear(); choice = null; render(); },
    makeGroup() { groupOps.makeGroup(); },
    ungroup() { groupOps.ungroup(); },
    groupLeft() { groupOps.moveGroup(-1); },
    groupRight() { groupOps.moveGroup(1); },
    solo() {
      mode = 'solo';
      G = GD.newState();
      G.seats = ['South', 'East', 'North', 'West'].map((n, i) => ({ uid: 'solo' + i, nick: n }));
      GD.deal(G);
      render();
    },
    leaveSolo() { mode = 'online'; G = null; sel.clear(); boot(); },
    home() { history.replaceState(null, '', location.pathname); tableId = ''; G = null; status = 'home'; if (ws) ws.close(); render(); }
  };

  document.addEventListener('click', (e) => {
    if (Date.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); return; }
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const a = el.dataset.a;
    if (a === 'card') {
      const c = el.dataset.c;
      if (G.phase === 'tribute') { const had = sel.has(c); sel.clear(); if (!had) sel.add(c); }
      else if (sel.has(c)) sel.delete(c); else sel.add(c);
      choice = null; render(); return;
    }
    if (a === 'choice') { choice = JSON.parse(el.dataset.v); render(); return; }
    if (a === 'sit') return actions.sit(+el.dataset.s);
    if (a === 'kick') return actions.kick(+el.dataset.s);
    if (a === 'sort') { sortMode = el.dataset.m; store.set('gd-sort', sortMode); render(); return; }
    if (a === 'pickGroup') return groupOps.pickGroup(+el.dataset.g);
    if (actions[a]) actions[a]();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'nick') store.set('gd-nick', e.target.value.trim().slice(0, 18));
  });

  // ---------- drag and drop in Sortiermodus ----------
  let drag = null;
  let suppressUntil = 0;
  let dropEl = null;
  function setDropEl(el) {
    if (dropEl === el) return;
    if (dropEl) dropEl.classList.remove('drop-on');
    dropEl = el;
    if (dropEl) dropEl.classList.add('drop-on');
  }
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-drop]') : null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (sortMode !== 'custom' || !G || mySeat() < 0 || busy) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const card = e.target.closest('.card[data-c]');
    const gl = e.target.closest('[data-gdrag]');
    if (!card && !gl) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, card: card ? card.dataset.c : null, group: gl ? +gl.dataset.gdrag : null, active: false, ghost: null, cards: [] };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
      const hand = G.hands[mySeat()] || [];
      if (drag.group !== null) drag.cards = (myGroups(hand)[drag.group] || []).slice();
      else drag.cards = sel.has(drag.card) ? hand.filter((c) => sel.has(c)) : [drag.card];
      if (!drag.cards.length) { drag = null; return; }
      drag.active = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'ghost';
      drag.ghost.innerHTML = minis(drag.cards);
      document.body.appendChild(drag.ghost);
      document.body.classList.add('dragging');
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    setDropEl(targetAt(e.clientX, e.clientY));
  }, { passive: false });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.active) return;
    suppressUntil = Date.now() + 350;
    d.ghost.remove();
    document.body.classList.remove('dragging');
    setDropEl(null);
    if (cancelled) return;
    const t = targetAt(e.clientX, e.clientY);
    if (!t) return;
    const kind = t.dataset.drop;
    const hand = G.hands[mySeat()] || [];
    let gs = myGroups(hand);
    if (d.group !== null) {
      // group onto group: merge
      if (!kind.startsWith('g:')) return;
      const j = +kind.slice(2);
      if (j === d.group || !gs[j]) return;
      gs[j] = gs[j].concat(gs[d.group]);
      gs.splice(d.group, 1);
    } else {
      const moving = new Set(d.cards);
      const tgt = kind.startsWith('g:') ? gs[+kind.slice(2)] : null;
      gs = gs.map((g) => {
        const kept = g.filter((c) => !moving.has(c));
        if (g === tgt) {
          const off = parseFloat(getComputedStyle(t).getPropertyValue('--off')) || 20;
          const rect = t.getBoundingClientRect();
          // position inside the stack from where the pointer let go, counted against the original stack
          let idx = Math.round((e.clientY - rect.top) / off);
          const before = g.slice(0, Math.max(0, idx)).filter((c) => !moving.has(c)).length;
          kept.splice(Math.min(before, kept.length), 0, ...d.cards);
        }
        return kept;
      }).filter((g) => g.length);
      if (kind === 'new') gs.push(d.cards.slice());
    }
    gstore[groupKey()] = gs;
    saveGroups(); sel.clear(); choice = null; render();
  }
  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));

  // ---------- rendering helpers ----------
  function mini(c) {
    const { s, r } = GD.parse(c);
    if (r >= 16) return `<span class="mc${r === 17 ? ' red' : ''}"><span class="han">${r === 17 ? '大王' : '小王'}</span></span>`;
    const red = s === 'H' || s === 'D';
    const wild = GD.isWild(c, L());
    return `<span class="mc${red ? ' red' : ''}${wild ? ' wild' : ''}">${GD.rankLbl(r)}${GD.SUIT_SYM[s]}</span>`;
  }
  const minis = (cards, lg) => `<div class="played${lg ? ' lg' : ''}">${GD.sortHand(cards, L()).map(mini).join('')}</div>`;

  function bigCard(c, i, opts) {
    const { s, r } = GD.parse(c);
    const red = s === 'H' || s === 'D' || r === 17;
    const wild = GD.isWild(c, L());
    let ix;
    if (r >= 16) ix = `<span class="ix"><span class="han">${r === 17 ? '大王' : '小王'}</span></span><span class="pip han">王</span>`;
    else ix = `<span class="ix">${GD.rankLbl(r)}<i>${GD.SUIT_SYM[s]}</i></span><span class="pip">${GD.SUIT_SYM[s]}</span>`;
    const label = GD.cardName(c) + (wild ? ', wild card' : '');
    return `<button class="card${red ? ' red' : ''}${sel.has(c) ? ' sel' : ''}${opts.dim ? ' dim' : ''}" style="top:calc(var(--off) * ${i})" data-a="card" data-c="${c}" aria-pressed="${sel.has(c)}" aria-label="${esc(label)}"${opts.disabled ? ' disabled' : ''}>${ix}${wild ? '<span class="wb">配</span>' : ''}</button>`;
  }

  let sortMode = ['suit', 'custom'].includes(store.get('gd-sort')) ? store.get('gd-sort') : 'rank';
  const SUIT_ORDER = ['S', 'H', 'C', 'D'];

  // own arrangement (Sortiermodus): groups the player builds, kept per round and seat on this device
  let gstore = {};
  try { gstore = JSON.parse(store.get('gd-groups') || '{}') || {}; } catch (e) { gstore = {}; }
  const groupKey = () => `${mode}:${tableId}:${G.round}:${mySeat()}`;
  function myGroups(hand) {
    const k = groupKey();
    const hs = new Set(hand);
    gstore[k] = (gstore[k] || []).map((g) => GD.sortHand(g.filter((c) => hs.has(c)), L())).filter((g) => g.length);
    return gstore[k];
  }
  function saveGroups() {
    const k = groupKey();
    gstore = { [k]: gstore[k] || [] };
    if (mode === 'online') store.set('gd-groups', JSON.stringify(gstore));
  }
  const groupOps = {
    makeGroup() {
      const hand = G.hands[mySeat()] || [];
      const picked = hand.filter((c) => sel.has(c));
      if (!picked.length) return;
      const gs = myGroups(hand).map((g) => g.filter((c) => !sel.has(c))).filter((g) => g.length);
      gs.push(GD.sortHand(picked, L()));
      gstore[groupKey()] = gs; saveGroups(); sel.clear(); choice = null; render();
    },
    ungroup() {
      const hand = G.hands[mySeat()] || [];
      gstore[groupKey()] = myGroups(hand).map((g) => g.filter((c) => !sel.has(c))).filter((g) => g.length);
      saveGroups(); sel.clear(); choice = null; render();
    },
    moveGroup(dir) {
      const gs = myGroups(G.hands[mySeat()] || []);
      const i = gs.findIndex((g) => g.some((c) => sel.has(c)));
      const j = i + dir;
      if (i < 0 || j < 0 || j >= gs.length) return;
      [gs[i], gs[j]] = [gs[j], gs[i]];
      saveGroups(); render();
    },
    pickGroup(i) {
      const gs = myGroups(G.hands[mySeat()] || []);
      if (!gs[i]) return;
      sel = new Set(gs[i]); choice = null; render();
    }
  };

  const colHTML = (cs, opts, drop) => `<div class="col"${drop ? ` data-drop="${drop}"` : ''} style="height:calc(var(--off) * ${cs.length - 1} + var(--ch))">${cs.map((c, i) => bigCard(c, i, { disabled: opts.disabled, dim: opts.dimFn && opts.dimFn(c) })).join('')}</div>`;

  function rankColumns(cards, lv) {
    const groups = new Map();
    for (const c of GD.sortHand(cards, lv)) {
      const key = GD.isWild(c, lv) ? 'w' : String(GD.cardVal(c, lv));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    return [...groups.keys()].sort((x, y) => (x === 'w' ? 99 : +x) - (y === 'w' ? 99 : +y)).map((k) => groups.get(k));
  }

  function handHTML(hand, opts = {}) {
    const lv = L();
    let body = '';
    let tools = '';
    if (sortMode === 'suit') {
      // one column per suit in natural rank order, for spotting straight flushes
      const groups = new Map();
      const sorted = hand.slice().sort((x, y) => GD.parse(x).r - GD.parse(y).r || x.localeCompare(y));
      for (const c of sorted) {
        const key = GD.isWild(c, lv) ? 'w' : c[0] === 'X' ? 'x' : c[0];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      body = [...SUIT_ORDER, 'x', 'w'].filter((k) => groups.has(k)).map((k) => colHTML(groups.get(k), opts)).join('');
    } else if (sortMode === 'custom') {
      const gs = myGroups(hand);
      const inGroup = new Set(gs.flat());
      const rest = hand.filter((c) => !inGroup.has(c));
      const selInGroup = gs.findIndex((g) => g.some((c) => sel.has(c)));
      body = gs.map((g, i) => `<div class="gcol">${colHTML(g, opts, 'g:' + i)}<button class="glbl" data-a="pickGroup" data-g="${i}" data-gdrag="${i}" aria-label="Select group ${i + 1}">Group ${i + 1}</button></div>`).join('')
        + '<div class="col newslot" data-drop="new" style="height:var(--ch)">new<br>group</div>'
        + (rest.length ? '<div class="gsep" aria-hidden="true"></div>' : '')
        + rankColumns(rest, lv).map((cs) => colHTML(cs, opts, 'rest')).join('');
      tools = `<div class="bar sortbar">
        <button class="btn sm" data-a="makeGroup"${!sel.size ? ' disabled' : ''}>Group selection</button>
        <button class="btn sm" data-a="ungroup"${selInGroup < 0 ? ' disabled' : ''}>Remove from group</button>
        <button class="btn sm" data-a="groupLeft" aria-label="Move group left"${selInGroup <= 0 ? ' disabled' : ''}>◀</button>
        <button class="btn sm" data-a="groupRight" aria-label="Move group right"${selInGroup < 0 || selInGroup >= gs.length - 1 ? ' disabled' : ''}>▶</button>
        <span class="hint">Hold and drag cards with the mouse or your finger: onto a group, onto “new group”, or back to the rest. Cards inside a group stay sorted by rank. Drag a “Group” label onto another group to merge them. Selected cards move together.</span>
      </div>`;
    } else {
      body = rankColumns(hand, lv).map((cs) => colHTML(cs, opts)).join('');
    }
    const chip = (m, t) => `<button class="chip${sortMode === m ? ' on' : ''}" data-a="sort" data-m="${m}" aria-pressed="${sortMode === m}">${t}</button>`;
    const toggle = `<div class="bar sortbar"><span class="hint">Sort:</span><div class="chips">${chip('rank', 'By rank')}${chip('suit', 'By suit')}${chip('custom', 'Arrange')}</div></div>`;
    return toggle + tools + `<div class="hand${sortMode === 'custom' ? ' custom' : ''}" role="group" aria-label="Your cards">${body}</div>`;
  }

  const nameOf = (seat) => esc(GD.nick(G, seat));
  const teamDot = (seat) => `<span class="tdot" style="background:${TEAM_VAR[GD.teamOf(seat)]}"></span>`;
  const isOnline = (seat) => !!(G.seats[seat] && G.seats[seat].online);

  function seatHTML(seat, pos) {
    const fin = G.finished.indexOf(seat);
    const turn = G.phase === 'play' && G.turn === seat && fin < 0;
    const p = G.plays[seat];
    let act = '';
    if (p === 'pass') act = '<span class="pass">passed</span>';
    else if (p) act = minis(p.cards);
    return `<div class="seat s-${pos}${turn ? ' turn' : ''}">
      <div class="who">${teamDot(seat)}<span class="n">${nameOf(seat)}</span>${mode === 'online' && isOnline(seat) ? '<span class="on-dot" title="online"></span>' : ''}</div>
      ${fin >= 0 ? `<div class="place" title="${GD.PLACE_DE[fin]}">${GD.PLACE[fin]}</div>` : `<div class="back"><i></i><b>${G.hands[seat].length}</b></div>`}
      ${turn ? '<div class="badge">to play</div>' : `<div class="meta">${pos === 'top' ? 'Partner' : 'Opponent'}</div>`}
      ${act}
    </div>`;
  }

  function midHTML() {
    if (G.phase === 'tribute') {
      return `<div class="mid"><div class="lbl">进贡 · Tribute</div>${G.tribute.map((t) => `<div>${nameOf(t.from)} → ${nameOf(t.to)}: ${mini(t.card)}${t.back ? ` · back ${mini(t.back)}` : ''}</div>`).join('')}
        ${G.returns.length ? `<div class="lbl">${nameOf(G.returns[0].from)} returns a card up to 10</div>` : ''}</div>`;
    }
    if (G.trick) {
      return `<div class="mid"><div class="lbl">Played by ${nameOf(G.trick.by)}</div>${minis(G.trick.cards, true)}<div class="big">${esc(GD.describe(G.trick.cb, L()))}</div></div>`;
    }
    return `<div class="mid"><div class="lbl">New trick</div><div class="big">${nameOf(G.turn)} leads</div></div>`;
  }

  function levelsHTML() {
    if (!G || G.phase === 'lobby') { $levels.innerHTML = ''; return; }
    $levels.innerHTML = [0, 1].map((t) => `<div class="lv${G.levelTeam === t ? ' on' : ''}"><span class="dot" style="background:${TEAM_VAR[t]}"></span><div><small>Team ${TEAM[t]}</small><br><b>${GD.rankLbl(G.levels[t])}</b>${G.levels[t] === 14 ? ` <span class="muted">· try ${((G.aceTries || [0, 0])[t]) + 1}/3</span>` : ''}</div></div>`).join('')
      + `<div class="lv"><div><small>playing</small><br><b>${GD.rankLbl(L())}</b> <span class="muted">· ${GD.rankLbl(L())}♥ = 配</span></div></div>`;
  }

  // ---------- views ----------
  function lobbyHTML() {
    const me = mySeat();
    const ro = canWrite === false;
    const nickVal = esc(store.get('gd-nick') || profileName || '');
    const full = G.seats.every(Boolean);
    const slot = (i) => {
      const s = G.seats[i];
      const t = GD.teamOf(i);
      return `<div class="slot${s ? ' taken' : ''}">
        <div class="t" style="color:${TEAM_VAR[t]}">Team ${TEAM[t]} · Seat ${i + 1}</div>
        ${s ? `<div class="nm">${esc(s.nick)}${s.uid === myId ? ' (you)' : ''}</div>${s.uid === myId ? '<button class="btn" data-a="leave">Stand up</button>' : s.online ? '<div class="muted">seated · online</div>' : `<div class="muted">seated · offline</div><button class="btn sm" data-a="kick" data-s="${i}">Free this seat</button>`}`
          : `<div class="muted">open</div><button class="btn" data-a="sit" data-s="${i}"${ro || busy ? ' disabled' : ''}>Sit here</button>`}
      </div>`;
    };
    return `<section class="panel">
      <h2>Table for four</h2>
      <p class="muted">Partners sit across from each other: seats 1 and 3 are Team Red, seats 2 and 4 are Team Blue. Once all four are seated, anyone can start the match.</p>
      ${ro ? '<p><b>You can only watch.</b> To play, the owner of this page needs to invite you as an editor.</p>' : `<div class="field"><label for="nick">Your name at the table</label><input id="nick" maxlength="18" value="${nickVal}" placeholder="e.g. Alex" autocomplete="nickname"></div>`}
      <div class="field invite"><label for="invite">Invite link: send it to your friends</label><div class="bar"><input id="invite" readonly value="${esc(location.href)}"><button class="btn" data-a="copyLink">Copy link</button></div></div>
      <div class="seats">${[0, 1, 2, 3].map(slot).join('')}</div>
      <div class="bar">
        <button class="btn primary" data-a="start"${!full || me < 0 || busy ? ' disabled' : ''}>Start match</button>
        <button class="btn" data-a="home">Leave table</button>
      </div>
    </section>`;
  }

  function tableHTML() {
    const me = mySeat();
    const view = me >= 0 ? me : 0;
    const lv = L();
    let html = `<section class="felt" aria-label="Spieltisch">${seatHTML((view + 2) % 4, 'top')}${seatHTML((view + 3) % 4, 'left')}${midHTML()}${seatHTML((view + 1) % 4, 'right')}</section>`;

    if (G.phase === 'roundEnd' || G.phase === 'over') {
      const r = G.result;
      html += `<section class="panel"><h2>${G.phase === 'over' ? `Team ${TEAM[G.winner]} wins the match!` : `Round ${G.round} over`}</h2>
        <div class="result">${r.order.map((s, i) => `<div class="row"><span class="place">${GD.PLACE[i]}</span>${teamDot(s)}<span>${nameOf(s)}</span><span class="muted">${GD.PLACE_DE[i]}</span></div>`).join('')}</div>
        ${G.phase === 'over' ? '<p>The ace has been played through.</p>' : `<p>Team ${TEAM[r.team]} goes up ${r.up} ${r.up === 1 ? 'level' : 'levels'}: ${GD.rankLbl(r.from)} → <b>${GD.rankLbl(r.to)}</b>. Next round plays ${GD.rankLbl(G.levels[G.levelTeam])}.</p>${r.aceTeam >= 0 ? `<p>${r.aceDrop ? `Team ${TEAM[r.aceTeam]} failed the ace three times and drops back to 2.` : `Team ${TEAM[r.aceTeam]} failed the ace: attempt ${r.aceTry} of 3.`}</p>` : ''}`}
        <div class="bar">${G.phase === 'over' ? `<button class="btn primary" data-a="toLobby"${me < 0 && mode === 'online' ? ' disabled' : ''}>New match</button>` : `<button class="btn primary" data-a="next"${(me < 0 && mode === 'online') || busy ? ' disabled' : ''}>Deal next round</button>`}</div>
      </section>`;
    }

    if (me < 0) {
      html += `<section class="panel"><p><b>You're watching.</b> Players' cards stay hidden.</p></section>`;
      return html;
    }

    const hand = G.hands[me];
    const myTurn = G.phase === 'play' && G.turn === me;
    const returning = G.phase === 'tribute' && G.returns.length && G.returns[0].from === me;
    const done = G.finished.includes(me);
    let statusTxt, sub = '', controls = '', hint = '';
    if (G.phase === 'tribute') {
      if (returning) {
        const to = G.returns[0].to;
        statusTxt = `还贡: Return a card to ${nameOf(to)}`;
        sub = 'Any card up to 10, but not a level card. Tap one.';
        const c = [...sel][0];
        const ok = sel.size === 1 && GD.canReturn(c, hand, lv);
        controls = `<button class="btn primary" data-a="giveBack"${!ok || busy ? ' disabled' : ''}>Return card</button>`;
      } else {
        statusTxt = 'Tribute in progress';
        sub = `Waiting for ${nameOf(G.returns[0].from)}.`;
      }
    } else if (G.phase === 'play') {
      if (done) { statusTxt = `You finished ${GD.PLACE_DE[G.finished.indexOf(me)]} (${GD.PLACE[G.finished.indexOf(me)]})`; sub = 'Watch your team play on.'; }
      else if (myTurn) {
        statusTxt = G.trick ? 'Your turn: beat it or pass' : 'Your lead';
        sub = G.trick ? `To beat: ${esc(GD.describe(G.trick.cb, lv))}` : 'Play any combination.';
        const opts = sel.size ? GD.options([...sel], lv, G.trick ? G.trick.cb : null) : [];
        const byType = [];
        for (const o of opts) if (!byType.some((x) => x.t === o.t)) byType.push(o);
        const picked = (choice && byType.find((o) => o.t === choice.t && o.v === choice.v && (o.p || 0) === (choice.p || 0))) || byType[0];
        if (sel.size) {
          if (picked) hint = `<div class="hint">Selection: <b>${esc(GD.describe(picked, lv))}</b></div>`;
          else {
            const any = GD.analyze([...sel], lv);
            hint = `<div class="hint bad">Selection: <b>${any.length ? esc(GD.describe(any.sort((a, b) => b.v - a.v)[0], lv)) + " doesn't beat it" : 'not a valid combination'}</b></div>`;
          }
          if (byType.length > 1) hint += `<div class="chips">${byType.map((o) => `<button class="chip${o === picked ? ' on' : ''}" data-a="choice" data-v='${esc(JSON.stringify({ t: o.t, v: o.v, p: o.p || 0 }))}'>${esc(GD.describe(o, lv))}</button>`).join('')}</div>`;
        }
        if (picked) choice = { t: picked.t, v: picked.v, p: picked.p || 0 };
        controls = `<button class="btn primary" data-a="play"${!picked || busy ? ' disabled' : ''}>Play</button>
          <button class="btn" data-a="pass"${!G.trick || busy ? ' disabled' : ''}>Pass</button>
          <button class="btn" data-a="clear"${!sel.size ? ' disabled' : ''}>Clear selection</button>`;
      } else {
        statusTxt = `${nameOf(G.turn)} is playing`;
        sub = 'You can already pick your cards.';
        controls = sel.size ? '<button class="btn" data-a="clear">Clear selection</button>' : '';
      }
    } else {
      statusTxt = `${hand.length} cards in hand`;
    }
    const dimFn = returning ? (c) => !GD.canReturn(c, hand, lv) : null;
    html += `<section class="me${myTurn || returning ? ' turn' : ''}">
      <div class="bar"><div class="grow status">${teamDot(me)} ${statusTxt}<small>${sub}</small></div>${controls}</div>
      ${hint}
      ${hand.length ? handHTML(hand, { disabled: busy, dimFn }) : ''}
    </section>`;
    return html;
  }

  function footerHTML() {
    const rules = `<details class="rules"><summary>Guan Dan (掼蛋) quick rules</summary><ul>
      <li>Four players in two teams; partners sit across from each other. Two decks with jokers are used, and everyone gets 27 cards.</li>
      <li>Goal: get rid of all your cards first. Play goes around the table; on your turn, beat the current play with a higher combination of the same type, or pass.</li>
      <li>Combinations: single, pair, triple, full house (3+2), straight of exactly 5 cards, three pairs in a row, two triples in a row. The ace can be high or low in runs.</li>
      <li>Order: 2 up to ace, then the level card, then the small and big joker. The heart level card (配) is wild and stands in for any card except jokers.</li>
      <li>Bombs beat everything else: 4 of a kind &lt; 5 &lt; straight flush &lt; 6 &lt; 7 &lt; 8 … &lt; four jokers.</li>
      <li>If a player goes out and nobody beats their last play, their partner leads next (接风).</li>
      <li>The winning team goes up: partner 2nd +3, 3rd +2, last +1. A team wins the match by winning a round while playing its ace, with the partner not finishing last. A team that fails the ace three times drops back to 2.</li>
      <li>From round 2 on, the last player gives their highest card to the winner and gets back a card up to 10, not a level card (进贡/还贡). Whoever holds both big jokers doesn't have to give (抗贡).</li>
    </ul></details>`;
    const log = G && G.log && G.log.length && G.phase !== 'lobby'
      ? `<details class="log"><summary>History</summary><ul class="logl">${G.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : '';
    const tools = G && G.phase !== 'lobby' && (mode === 'solo' || mySeat() >= 0)
      ? `<div class="bar">${mode === 'solo' ? '<button class="btn" data-a="leaveSolo">End practice game</button><span class="hint">Practice game: you play all four seats in turn.</span>'
        : confirmReset ? '<span class="hint">End the match and go back to choosing seats?</span><button class="btn" data-a="toLobby">Yes, end it</button><button class="btn" data-a="cancelReset">Keep playing</button>'
          : '<button class="btn" data-a="toLobby">End match</button>'}</div>` : '';
    return log + tools + rules;
  }

  function render() {
    levelsHTML();
    let html = '';
    if (mode === 'online' && status === 'home') {
      html = `<section class="panel"><h2>Play Guan Dan with friends</h2>
        <p>Create a table, then send the link to three friends. Nobody needs an account.</p>
        <div class="field"><label for="nick">Your name at the table</label><input id="nick" maxlength="18" value="${esc(store.get('gd-nick') || '')}" placeholder="e.g. Alex" autocomplete="nickname"></div>
        <div class="bar"><button class="btn primary" data-a="create">Create table</button><button class="btn" data-a="solo">Try it alone</button></div></section>`;
    } else if (mode === 'online' && status === 'connecting') {
      html = `<section class="panel"><p>Connecting to the table… If the server was asleep, this can take up to a minute.</p></section>`;
    } else if (mode === 'online' && status === 'notfound') {
      html = `<section class="panel"><h2>Table not found</h2>
        <p>This table doesn't exist anymore. Tables close when the server restarts or after a few hours without players.</p>
        <div class="bar"><button class="btn primary" data-a="home">Create a new table</button></div></section>`;
    } else {
      if (!G) G = GD.newState();
      const banner = mode === 'online' && !connected ? '<section class="panel"><p><b>Connection lost.</b> Reconnecting…</p></section>' : '';
      html = banner + (G.phase === 'lobby' ? lobbyHTML() : tableHTML());
    }
    const focusId = document.activeElement && document.activeElement.id;
    const nickVal = document.getElementById('nick') && document.getElementById('nick').value;
    $view.innerHTML = html + footerHTML();
    if (nickVal !== undefined && nickVal !== null && document.getElementById('nick')) document.getElementById('nick').value = nickVal;
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  }

  // ---------- connection ----------
  let pending = null;
  function selectLink() { const el = document.getElementById('invite'); if (el) { el.focus(); el.select(); } flash('Copy the link from the field above.'); }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
      if (ws.readyState === 1 && pending) { sendRaw(pending); pending = null; }
      return;
    }
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    ws = new WebSocket(url);
    ws.onopen = () => {
      connected = true; retry = 0;
      if (pending) { sendRaw(pending); pending = null; }
      else if (tableId) sendRaw({ type: 'hello', table: tableId, token });
      render();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'state') {
        busy = false; clearTimeout(busyTimer);
        status = 'ready';
        if (mode === 'online') { onState(m.table, m.state); render(); }
      } else if (m.type === 'error') {
        busy = false; clearTimeout(busyTimer);
        flash(m.msg); render();
      } else if (m.type === 'notfound') {
        tableId = ''; status = 'notfound'; render();
      }
    };
    ws.onclose = () => {
      connected = false; ws = null;
      if (mode === 'online' && !tableId && status === 'connecting') { status = 'home'; flash("Couldn't reach the server. Try again."); render(); return; }
      if (mode !== 'online' || !tableId) return;
      render();
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 500 * retry);
    };
  }
  // keeps the connection (and a sleeping free server) awake while the page is open
  setInterval(() => { sendRaw({ type: 'ping' }); }, 45000);

  function boot() {
    const code = location.hash.slice(1).toUpperCase();
    if (/^[A-Z0-9]{4,8}$/.test(code)) {
      tableId = code; status = 'connecting'; render();
      pending = { type: 'hello', table: code, token };
      connect();
    } else {
      status = 'home'; render();
    }
  }
  window.addEventListener('hashchange', () => { if (mode === 'online' && location.hash.slice(1).toUpperCase() !== tableId) { G = null; if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); connected = false; } boot(); } });

  render();
  boot();
})();
