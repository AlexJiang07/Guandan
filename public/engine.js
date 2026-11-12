// ===== Guan Dan rules engine (pure, no DOM) =====
const GD = (() => {
  const SUITS = ['S', 'H', 'C', 'D'];
  const SUIT_SYM = { S: '♠', H: '♥', C: '♣', D: '♦' };
  const RANK_LBL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: 'small joker', 17: 'big joker' };
  const BOMB_TYPES = { bomb: 1, sf: 1, jokerbomb: 1 };
  const TYPE_NAME = {
    single: 'Single', pair: 'Pair', triple: 'Triple', full: 'Full house',
    straight: 'Straight', tube: 'Three pairs in a row', plate: 'Two triples in a row',
    bomb: 'Bomb', sf: 'Straight flush', jokerbomb: 'Four jokers'
  };
  const PLACE = ['头游', '二游', '三游', '末游'];
  const PLACE_DE = ['1st', '2nd', '3rd', 'last'];

  const parse = (c) => ({ s: c[0], r: parseInt(c.slice(1), 10) });
  const rankLbl = (r) => RANK_LBL[r] || String(r);
  const isWild = (c, L) => c[0] === 'H' && parseInt(c.slice(1), 10) === L;
  const val = (r, L) => (r >= 16 ? r : r === L ? 15 : r);
  const cardVal = (c, L) => val(parse(c).r, L);
  const cardName = (c) => {
    const { s, r } = parse(c);
    return r >= 16 ? rankLbl(r) : rankLbl(r) + SUIT_SYM[s];
  };
  const valLbl = (v, L) => (v === 15 ? rankLbl(L) : rankLbl(v));
  const isBomb = (cb) => !!BOMB_TYPES[cb.t];

  function newDeck() {
    const d = [];
    for (let k = 0; k < 2; k++) {
      for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(`${s}${r}.${k}`);
      d.push(`X16.${k}`, `X17.${k}`);
    }
    return d;
  }

  function shuffle(a, rnd = Math.random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sortHand(h, L) {
    const so = { S: 0, H: 1, C: 2, D: 3, X: 4 };
    return h.slice().sort((a, b) => {
      const va = cardVal(a, L), vb = cardVal(b, L);
      if (va !== vb) return va - vb;
      return so[a[0]] - so[b[0]];
    });
  }

  // top rank of a run of distinct natural ranks, A may be low; null if not a run
  function seqTop(ranks) {
    const test = (rs) => {
      const s = rs.slice().sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1] + 1) return null;
      return s[s.length - 1];
    };
    let t = test(ranks);
    if (t !== null) return t;
    if (ranks.includes(14)) return test(ranks.map((r) => (r === 14 ? 1 : r)));
    return null;
  }

  function analyzeNatural(list, L) {
    const n = list.length, res = [];
    const cnt = {};
    let jokers = 0;
    for (const c of list) { cnt[c.r] = (cnt[c.r] || 0) + 1; if (c.r >= 16) jokers++; }
    const keys = Object.keys(cnt).map(Number);
    if (n === 1) res.push({ t: 'single', v: val(list[0].r, L) });
    if (n === 2 && keys.length === 1) res.push({ t: 'pair', v: val(keys[0], L) });
    if (n === 3 && keys.length === 1 && !jokers) res.push({ t: 'triple', v: val(keys[0], L) });
    if (n === 4 && jokers === 4 && cnt[16] === 2 && cnt[17] === 2) res.push({ t: 'jokerbomb', p: 100, v: 0 });
    if (n >= 4 && keys.length === 1 && !jokers) res.push({ t: 'bomb', p: n, v: val(keys[0], L) });
    if (n === 5 && keys.length === 2) {
      const tri = keys.find((k) => cnt[k] === 3);
      if (tri !== undefined && tri < 16) res.push({ t: 'full', v: val(tri, L) });
    }
    if (!jokers) {
      if (n === 5 && keys.length === 5) {
        const top = seqTop(keys);
        if (top !== null) {
          res.push({ t: 'straight', v: top });
          if (list.every((c) => c.s === list[0].s)) res.push({ t: 'sf', p: 5.5, v: top });
        }
      }
      if (n === 6 && keys.length === 3 && keys.every((k) => cnt[k] === 2)) {
        const top = seqTop(keys);
        if (top !== null) res.push({ t: 'tube', v: top });
      }
      if (n === 6 && keys.length === 2 && keys.every((k) => cnt[k] === 3)) {
        const top = seqTop(keys);
        if (top !== null) res.push({ t: 'plate', v: top });
      }
    }
    return res;
  }

  // every legal reading of a set of cards; the heart level card is wild (逢人配)
  function analyze(cards, L) {
    if (!cards.length) return [];
    const wild = [], nat = [];
    for (const c of cards) (isWild(c, L) ? wild : nat).push(parse(c));
    const out = new Map();
    const add = (arr) => { for (const cb of arr) out.set(cb.t + ':' + cb.v + ':' + (cb.p || 0), cb); };
    if (!wild.length) { add(analyzeNatural(nat, L)); return [...out.values()]; }
    const subs = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) subs.push({ s, r });
    const rec = (i, acc) => {
      if (i === wild.length) { add(analyzeNatural(acc, L)); return; }
      for (const sb of subs) rec(i + 1, acc.concat([sb]));
    };
    rec(0, nat);
    return [...out.values()];
  }

  function beats(a, cur) {
    if (!cur) return true;
    const ab = isBomb(a), cb = isBomb(cur);
    if (ab && !cb) return true;
    if (!ab && cb) return false;
    if (ab && cb) return a.p !== cur.p ? a.p > cur.p : a.v > cur.v;
    return a.t === cur.t && a.v > cur.v;
  }

  const strength = (cb) => (isBomb(cb) ? 1000 + cb.p * 20 + cb.v : cb.v);

  // legal readings that may be played now, strongest first
  function options(cards, L, cur) {
    return analyze(cards, L).filter((cb) => beats(cb, cur)).sort((a, b) => strength(b) - strength(a));
  }

  function describe(cb, L) {
    if (!cb) return '';
    const name = TYPE_NAME[cb.t];
    if (cb.t === 'jokerbomb') return name;
    if (cb.t === 'bomb') return `${name} · ${cb.p}× ${valLbl(cb.v, L)}`;
    if (cb.t === 'straight' || cb.t === 'sf' || cb.t === 'tube' || cb.t === 'plate') return `${name}, ${rankLbl(cb.v)} high`;
    return `${name} · ${valLbl(cb.v, L)}`;
  }

  // ===== table state =====
  const teamOf = (seat) => seat % 2;
  const partner = (seat) => (seat + 2) % 4;
  const curLevel = (s) => s.levels[s.levelTeam];

  function newState() {
    return {
      v: 0, phase: 'lobby', seats: [null, null, null, null],
      levels: [2, 2], levelTeam: 0, round: 0,
      hands: [[], [], [], []], turn: 0, trick: null, plays: [null, null, null, null],
      passes: 0, finished: [], returns: [], tribute: [], prevFinish: null,
      result: null, winner: null, log: [], aceTries: [0, 0]
    };
  }

  function log(s, msg) { s.log = (s.log || []).concat([msg]).slice(-8); }
  const nick = (s, seat) => (s.seats[seat] && s.seats[seat].nick) || `Seat ${seat + 1}`;
  const active = (s, seat) => !s.finished.includes(seat);
  function nextActive(s, seat) {
    for (let i = 1; i <= 4; i++) { const k = (seat + i) % 4; if (active(s, k)) return k; }
    return seat;
  }

  function highestTribute(hand, L) {
    let best = null;
    for (const c of hand) {
      if (isWild(c, L)) continue;
      if (!best || cardVal(c, L) > cardVal(best, L)) best = c;
    }
    return best;
  }

  function deal(s, rnd = Math.random) {
    const d = shuffle(newDeck(), rnd);
    s.round += 1;
    s.hands = [0, 1, 2, 3].map((i) => d.slice(i * 27, i * 27 + 27));
    s.trick = null; s.plays = [null, null, null, null]; s.passes = 0;
    s.finished = []; s.returns = []; s.tribute = []; s.result = null;
    const L = curLevel(s);
    log(s, `Round ${s.round}: playing ${rankLbl(L)}. ${rankLbl(L)}♥ is wild.`);
    const pf = s.prevFinish;
    if (!pf) {
      s.turn = Math.floor(rnd() * 4);
      s.phase = 'play';
      log(s, `${nick(s, s.turn)} leads.`);
      return s;
    }
    const f1 = pf[0];
    const doubleDown = pf[1] === partner(f1);
    const givers = doubleDown ? [pf[2], pf[3]] : [pf[3]];
    const bigJokers = givers.reduce((n, g) => n + s.hands[g].filter((c) => c.startsWith('X17')).length, 0);
    if (bigJokers === 2) {
      s.turn = f1; s.phase = 'play';
      log(s, `抗贡: ${givers.map((g) => nick(s, g)).join(' & ')} ${givers.length > 1 ? 'hold' : 'holds'} both big jokers, no tribute. ${nick(s, f1)} leads.`);
      return s;
    }
    const gifts = givers.map((g) => ({ from: g, card: highestTribute(s.hands[g], L) }));
    let pairs;
    if (doubleDown) {
      gifts.sort((a, b) => {
        const d = cardVal(b.card, L) - cardVal(a.card, L);
        if (d) return d;
        return ((a.from - f1 + 4) % 4) - ((b.from - f1 + 4) % 4);
      });
      pairs = [{ ...gifts[0], to: f1 }, { ...gifts[1], to: pf[1] }];
    } else {
      pairs = [{ ...gifts[0], to: f1 }];
    }
    for (const g of pairs) {
      s.hands[g.from] = s.hands[g.from].filter((c) => c !== g.card);
      s.hands[g.to] = s.hands[g.to].concat([g.card]);
      log(s, `进贡: ${nick(s, g.from)} gives ${cardName(g.card)} to ${nick(s, g.to)}.`);
    }
    s.tribute = pairs.map((g) => ({ from: g.from, to: g.to, card: g.card, back: null }));
    s.returns = pairs.map((g) => ({ from: g.to, to: g.from }));
    s.turn = pairs[0].from;
    s.phase = 'tribute';
    return s;
  }

  // return card: rank up to 10, never a level card (those rank above the ace)
  function canReturn(card, hand, L) {
    const ok = (c) => { const r = parse(c).r; return r <= 10 && r !== L; };
    if (!hand.some(ok)) return parse(card).r < 16;
    return ok(card);
  }

  function applyReturn(s, seat, card) {
    if (s.phase !== 'tribute' || !s.returns.length) return 'Nothing to return right now.';
    const r = s.returns[0];
    if (r.from !== seat) return "It's not your turn yet.";
    if (!s.hands[seat].includes(card)) return "You don't have that card.";
    if (!canReturn(card, s.hands[seat], curLevel(s))) return 'You can only return a card up to 10, not a level card.';
    s.hands[seat] = s.hands[seat].filter((c) => c !== card);
    s.hands[r.to] = s.hands[r.to].concat([card]);
    const t = s.tribute.find((x) => x.to === seat && x.from === r.to);
    if (t) t.back = card;
    log(s, `还贡: ${nick(s, seat)} returns ${cardName(card)} to ${nick(s, r.to)}.`);
    s.returns = s.returns.slice(1);
    if (!s.returns.length) {
      s.phase = 'play';
      log(s, `${nick(s, s.turn)} leads.`);
    }
    return null;
  }

  function endRound(s) {
    const order = s.finished.slice();
    let k = s.finished[s.finished.length - 1];
    while (order.length < 4) { k = (k + 1) % 4; if (!order.includes(k)) order.push(k); }
    const f1 = order[0], team = teamOf(f1);
    const ppos = order.indexOf(partner(f1));
    const up = [0, 3, 2, 1][ppos];
    const wasLevel = s.levels[team];
    s.prevFinish = order;
    s.result = { order, team, up, from: wasLevel };
    if (s.levelTeam === team && wasLevel === 14 && ppos <= 2) {
      s.phase = 'over'; s.winner = team; s.result.won = true;
      log(s, `Team ${team === 0 ? 'Red' : 'Blue'} plays through the ace and wins the match!`);
      return;
    }
    const aceTeam = s.levels[s.levelTeam] === 14 ? s.levelTeam : -1;
    s.levels[team] = Math.min(14, wasLevel + up);
    s.result.to = s.levels[team];
    s.levelTeam = team;
    s.phase = 'roundEnd';
    log(s, `Round over: Team ${team === 0 ? 'Red' : 'Blue'} goes up ${up} ${up === 1 ? 'level' : 'levels'} to ${rankLbl(s.levels[team])}.`);
    // ace rule: a team that fails to play through its ace three times falls back to 2
    if (aceTeam >= 0) {
      s.aceTries = s.aceTries || [0, 0];
      s.aceTries[aceTeam] += 1;
      s.result.aceTeam = aceTeam; s.result.aceTry = s.aceTries[aceTeam];
      if (s.aceTries[aceTeam] >= 3) {
        s.levels[aceTeam] = 2; s.aceTries[aceTeam] = 0; s.result.aceDrop = true;
        if (team === aceTeam) s.result.to = 2;
        log(s, `Team ${aceTeam === 0 ? 'Red' : 'Blue'} failed the ace for the third time and drops back to 2.`);
      } else {
        log(s, `Team ${aceTeam === 0 ? 'Red' : 'Blue'} failed ace attempt ${s.aceTries[aceTeam]} of 3.`);
      }
    }
  }

  function roundOver(s) {
    const f = s.finished;
    if (f.length >= 3) return true;
    if (f.length === 2 && teamOf(f[0]) === teamOf(f[1])) return true;
    return false;
  }

  function applyPlay(s, seat, cards, choice) {
    if (s.phase !== 'play') return 'No one is playing right now.';
    if (s.turn !== seat) return "It's not your turn.";
    const hand = s.hands[seat];
    const set = new Set(cards);
    if (set.size !== cards.length || !cards.every((c) => hand.includes(c))) return 'Invalid selection.';
    const L = curLevel(s);
    const cur = s.trick ? s.trick.cb : null;
    const opts = options(cards, L, cur);
    if (!opts.length) return cur ? "That doesn't beat the current play." : "That's not a valid combination.";
    const cb = (choice && opts.find((o) => o.t === choice.t && o.v === choice.v && (o.p || 0) === (choice.p || 0))) || opts[0];
    s.hands[seat] = hand.filter((c) => !set.has(c));
    s.trick = { by: seat, cards: cards.slice(), cb };
    s.plays = s.plays.map((p, i) => (i === seat ? { cards: cards.slice(), cb } : p));
    s.passes = 0;
    if (!s.hands[seat].length) {
      s.finished = s.finished.concat([seat]);
      log(s, `${nick(s, seat)} finishes ${PLACE_DE[s.finished.length - 1]} (${PLACE[s.finished.length - 1]}).`);
      if (roundOver(s)) { endRound(s); return null; }
    }
    s.turn = nextActive(s, seat);
    return null;
  }

  function applyPass(s, seat) {
    if (s.phase !== 'play') return 'No one is playing right now.';
    if (s.turn !== seat) return "It's not your turn.";
    if (!s.trick) return "You're leading, so you can't pass.";
    s.plays = s.plays.map((p, i) => (i === seat ? 'pass' : p));
    s.passes += 1;
    const by = s.trick.by;
    const needed = 4 - s.finished.length - (active(s, by) ? 1 : 0);
    if (s.passes >= needed) {
      let leader;
      if (active(s, by)) leader = by;
      else if (active(s, partner(by))) { leader = partner(by); log(s, `接风: ${nick(s, leader)} leads for their partner.`); }
      else leader = nextActive(s, by);
      s.trick = null; s.passes = 0; s.plays = [null, null, null, null];
      s.turn = leader;
      return null;
    }
    s.turn = nextActive(s, seat);
    return null;
  }


  // one entry point for every table action; used by the server and by the practice game
  function applyAction(s, who, a) {
    const t = a && a.type;
    const seat = who.seat;
    const toLobby = (keepSeats) => {
      const v = s.v || 0, seats = s.seats;
      Object.assign(s, newState());
      s.v = v;
      if (keepSeats) s.seats = seats;
    };
    if (t === 'sit') {
      const n = Number(a.seat);
      if (!Number.isInteger(n) || n < 0 || n > 3) return 'Invalid seat.';
      const nickName = String(a.nick || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 18);
      if (!nickName) return 'Enter a name first.';
      if (s.phase !== 'lobby') return 'The game has already started.';
      if (s.seats[n] && s.seats[n].uid !== who.uid) return 'That seat is taken.';
      s.seats = s.seats.map((x) => (x && x.uid === who.uid ? null : x));
      s.seats[n] = { uid: who.uid, nick: nickName };
      return null;
    }
    if (t === 'leave') {
      if (s.phase !== 'lobby') return 'The game has already started.';
      s.seats = s.seats.map((x) => (x && x.uid === who.uid ? null : x));
      return null;
    }
    if (t === 'kick') {
      const n = Number(a.seat);
      if (s.phase !== 'lobby') return 'Seats can only be freed before the match starts.';
      if (!Number.isInteger(n) || n < 0 || n > 3) return 'Invalid seat.';
      s.seats[n] = null;
      return null;
    }
    if (seat < 0) return 'Take a seat first.';
    if (t === 'start') {
      if (s.phase !== 'lobby') return 'The game has already started.';
      if (s.seats.some((x) => !x)) return 'You need four players.';
      deal(s);
      return null;
    }
    if (t === 'next') {
      if (s.phase !== 'roundEnd') return 'The next round has already started.';
      deal(s);
      return null;
    }
    if (t === 'lobby') { toLobby(true); return null; }
    if (t === 'play') {
      if (!Array.isArray(a.cards) || !a.cards.length || a.cards.length > 27 || !a.cards.every((c) => typeof c === 'string')) return 'Invalid selection.';
      const ch = a.choice && typeof a.choice === 'object' ? { t: String(a.choice.t), v: Number(a.choice.v), p: Number(a.choice.p) || 0 } : null;
      return applyPlay(s, seat, a.cards, ch);
    }
    if (t === 'pass') return applyPass(s, seat);
    if (t === 'return') return applyReturn(s, seat, String(a.card || ''));
    return 'Unknown action.';
  }

  return {
    applyAction, SUIT_SYM, PLACE, PLACE_DE, TYPE_NAME, parse, rankLbl, isWild, cardVal, cardName, valLbl,
    isBomb, newDeck, sortHand, analyze, options, beats, describe, teamOf, partner, curLevel,
    newState, deal, applyPlay, applyPass, applyReturn, canReturn, nextActive, nick, log
  };
})();
if (typeof module !== 'undefined') module.exports = GD;
