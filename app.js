/*
 * Township Reward System
 * A co-op rewards tracker: township trophies and diamonds, 20 player slots,
 * task logging, a group chat and private chats between players.
 *
 * Storage:
 *  - Opened as a claude.ai artifact with the `db` capability, everything is
 *    shared live between every player who opens the link.
 *  - On GitHub Pages with a Firebase project set in firebase-config.js,
 *    everything is shared live through Firestore. Players are signed in
 *    anonymously, so nobody needs an account or an email address.
 *  - Otherwise it saves to this browser's localStorage and syncs between
 *    tabs on the same device.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  var PLAYER_COUNT = 20;
  var PIDS = [];
  for (var i = 0; i < PLAYER_COUNT; i++) PIDS.push('p' + String(i + 1).padStart(2, '0'));

  var COLORS = ['#2e8b57', '#d9603b', '#2f6fd0', '#b07605', '#8e44ad', '#16a085', '#c0392b', '#2c3e50',
    '#d35400', '#27ae60', '#7f8c8d', '#e84393', '#0984e3', '#6c5ce7', '#00897b', '#a0522d',
    '#5d6d7e', '#c2185b', '#558b2f', '#1565c0'];

  var TASK_TYPES = [
    { id: 'regatta', label: 'Regatta task', trophies: 20 },
    { id: 'helicopter', label: 'Helicopter order', trophies: 5 },
    { id: 'train', label: 'Train shipment', trophies: 8 },
    { id: 'plane', label: 'Airplane cargo', trophies: 12 },
    { id: 'ship', label: 'Ship expedition', trophies: 15 },
    { id: 'zoo', label: 'Zoo task', trophies: 10 },
    { id: 'factory', label: 'Factory batch', trophies: 4 },
    { id: 'other', label: 'Other task', trophies: 5 }
  ];
  var TYPE_BY_ID = {};
  TASK_TYPES.forEach(function (t) { TYPE_BY_ID[t.id] = t; });
  TYPE_BY_ID.adjust = { id: 'adjust', label: 'Manual adjustment', trophies: 0 };

  var TIERS = [
    { name: 'Sprout', min: 0, color: '#6fbf73' },
    { name: 'Bronze', min: 250, color: '#b87333' },
    { name: 'Silver', min: 750, color: '#9aa5ad' },
    { name: 'Gold', min: 1500, color: '#d4a017' },
    { name: 'Platinum', min: 3000, color: '#5fa8b8' },
    { name: 'Diamond', min: 6000, color: '#4d86e0' },
    { name: 'Legend', min: 10000, color: '#9b59b6' }
  ];
  var CHEST_SIZE = 1000; // diamonds per vault chest

  var VIEWS = [
    { id: 'town', label: 'Town', icon: 'home' },
    { id: 'trophies', label: 'Trophies', icon: 'trophy' },
    { id: 'diamonds', label: 'Diamonds', icon: 'diamond' },
    { id: 'players', label: 'Players', icon: 'users' },
    { id: 'tasks', label: 'Tasks', icon: 'task' },
    { id: 'chat', label: 'Chat', icon: 'chat' }
  ];

  var LS_KEY = 'trs-state-v1';
  var ME_KEY = 'trs-me';
  var READ_KEY = 'trs-read';
  var ALERT_KEY = 'trs-alerts';
  var DEFAULT_TOWN = { name: 'Our Township', rate: 1 };

  // ---------------------------------------------------------------- state
  var S = { town: Object.assign({}, DEFAULT_TOWN), players: {}, activity: [], messages: [], agg: null };
  // S.agg (Firebase mode only): { players: {pid: {trophies, tasks, byType, last}}, days: {dayKey: {t, ts, pt: {pid: trophies}}} }
  var mode = 'local';           // local | connecting | live
  var connectSlow = false;
  var isDemo = false;
  var readOnly = false;
  var store = null;
  var me = lsGet(ME_KEY) || null;
  if (me && PIDS.indexOf(me) < 0) me = null;
  var lastRead = {};
  try { lastRead = JSON.parse(lsGet(READ_KEY) || '{}') || {}; } catch (e) { lastRead = {}; }
  var alerts = { sound: true, popup: false };
  try { Object.assign(alerts, JSON.parse(lsGet(ALERT_KEY) || '{}') || {}); } catch (e) { /* defaults */ }
  function saveAlerts() { lsSet(ALERT_KEY, JSON.stringify(alerts)); }

  var ui = {
    view: 'town',
    chatCh: 'group',
    chatOpen: false,
    chatFilter: '',
    playerSort: 'trophies',
    playerLayout: 'cards',
    tableSort: { key: 'trophies', dir: 'desc' },
    range: 14,
    logPlayer: null,
    logType: 'regatta',
    logTrophies: 20,
    logCount: 1,
    modal: null,          // {kind:'player'|'me'|'settings', id}
    editColor: null,
    adjTrophies: 0,
    adjTasks: 0
  };

  // ---------------------------------------------------------------- utils
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }
  function fmt(n) { return Math.round(num(n)).toLocaleString(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function initials(name) {
    var parts = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
    if (parts.length === 1) {
      var w = parts[0] || '?';
      var caps = w.match(/\p{Lu}/gu);
      if (caps && caps.length >= 2) return (caps[0] + caps[1]).toUpperCase();
      return w.slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function ago(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 172800) return 'yesterday';
    if (s < 604800) return Math.round(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function clock(ts) { return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(ts) {
    var k = dayKey(ts);
    if (k === dayKey(Date.now())) return 'Today';
    if (k === dayKey(Date.now() - 86400000)) return 'Yesterday';
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function canWrite() { return !readOnly && mode !== 'connecting'; }

  // ---------------------------------------------------------------- icons
  var ICONS = {
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5.5a2 2 0 0 0 1.8 3.6L8 10M16 6h2.5a2 2 0 0 1-1.8 3.6L16 10"/><path d="M12 13v3.5M8.5 20h7M9.5 16.5h5V20h-5z"/>',
    diamond: '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>',
    task: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9"/>',
    chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 14.3A5 5 0 0 1 22 19"/>',
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    send: '<path d="M4 12 20 4l-5 16-3-7z"/><path d="m12 13 8-9"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    bellOff: '<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8"/><path d="M10 20.5a2 2 0 0 0 4 0M3 3l18 18"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function medal(color) {
    return '<svg class="medal" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path d="M15 3h7l4 14h-7z" fill="#d9603b"/><path d="M33 3h-7l-4 14h7z" fill="#2f6fd0"/>' +
      '<circle cx="24" cy="30" r="14" fill="' + color + '"/><circle cx="24" cy="30" r="10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>' +
      '<path d="m24 23 2.2 4.5 4.8.6-3.5 3.3.9 4.8-4.4-2.4-4.4 2.4.9-4.8-3.5-3.3 4.8-.6z" fill="#fff" fill-opacity=".9"/></svg>';
  }
  var BRAND_MARK = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true">' +
    '<rect width="40" height="40" rx="11" style="fill:var(--accent)"/>' +
    '<path d="M9 31V19l11-8 11 8v12z" style="fill:var(--wall)"/><path d="M6.5 20.5 20 10.5l13.5 10" fill="none" style="stroke:var(--roof)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M16 20h8v3.5a4 4 0 0 1-8 0z" style="fill:var(--gold)"/><path d="M20 27.5v2.5M17.5 31h5" style="stroke:var(--gold)" stroke-width="2" stroke-linecap="round"/></svg>';

  function avatar(p, size) {
    return '<span class="avatar ' + (size || '') + '" style="background:' + esc(p.color) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>';
  }

  // ---------------------------------------------------------------- derived
  function player(id) {
    var o = S.players[id] || {};
    var idx = PIDS.indexOf(id);
    var color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : COLORS[idx % COLORS.length];
    var name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 32) : 'Player ' + (idx + 1);
    return { id: id, name: name, color: color, n: idx + 1 };
  }
  function rate() { var r = num(S.town.rate); return r > 0 ? r : 1; }

  var statCache = null, statVersion = -1, version = 0;
  function stats() {
    if (statVersion === version && statCache) return statCache;
    var by = {};
    PIDS.forEach(function (id) { by[id] = { id: id, trophies: 0, tasks: 0, byType: {}, last: 0, week: 0 }; });
    var weekAgo = Date.now() - 7 * 86400000;
    if (S.agg) {
      var now = new Date(), weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
      PIDS.forEach(function (id) {
        var g = S.agg.players[id] || {}, s = by[id];
        s.trophies = num(g.trophies); s.tasks = num(g.tasks); s.last = num(g.last);
        var bt = g.byType || {};
        Object.keys(bt).forEach(function (k) { if (num(bt[k]) > 0) s.byType[k] = num(bt[k]); });
      });
      Object.keys(S.agg.days).forEach(function (k) {
        var d = S.agg.days[k];
        if (num(d.ts) < weekStart || !d.pt) return;
        Object.keys(d.pt).forEach(function (pid) { if (by[pid]) by[pid].week += num(d.pt[pid]); });
      });
    } else {
      S.activity.forEach(function (a) {
        var s = by[a.pid]; if (!s) return;
        s.trophies += num(a.trophies);
        s.tasks += num(a.count);
        if (a.type !== 'adjust') {
          s.byType[a.type] = (s.byType[a.type] || 0) + num(a.count);
          if (num(a.ts) > s.last) s.last = num(a.ts);
          if (num(a.ts) >= weekAgo) s.week += num(a.trophies);
        }
      });
    }
    var list = PIDS.map(function (id) {
      var s = by[id];
      s.trophies = Math.max(0, s.trophies);
      s.tasks = Math.max(0, s.tasks);
      s.diamonds = s.trophies * rate();
      s.p = player(id);
      return s;
    });
    var ranked = list.slice().sort(function (a, b) { return b.trophies - a.trophies || b.tasks - a.tasks || a.p.n - b.p.n; });
    ranked.forEach(function (s, i) { s.rank = i + 1; });
    var total = { trophies: 0, diamonds: 0, tasks: 0, active: 0 };
    list.forEach(function (s) {
      total.trophies += s.trophies; total.diamonds += s.diamonds; total.tasks += s.tasks;
      if (s.last >= weekAgo) total.active++;
    });
    statCache = { by: by, list: list, ranked: ranked, total: total };
    statVersion = version;
    return statCache;
  }
  function tierFor(trophies) {
    var cur = TIERS[0], next = null;
    for (var i = 0; i < TIERS.length; i++) {
      if (trophies >= TIERS[i].min) { cur = TIERS[i]; next = TIERS[i + 1] || null; }
    }
    var pct = next ? (trophies - cur.min) / (next.min - cur.min) : 1;
    return { cur: cur, next: next, pct: clamp(pct, 0, 1) };
  }
  function sortedActivity() {
    return S.activity.slice().sort(function (a, b) { return num(b.ts) - num(a.ts); });
  }

  // ---------------------------------------------------------------- chat helpers
  function dmId(a, b) { return 'dm-' + [a, b].sort().join('-'); }
  function chanPartner(ch) {
    if (!me || ch.indexOf('dm-') !== 0) return null;
    var parts = ch.slice(3).split('-');
    return parts[0] === me ? parts[1] : parts[0];
  }
  function chanMsgs(ch) { return S.messages.filter(function (m) { return m.ch === ch; }); }
  function unread(ch) {
    var since = num(lastRead[ch]);
    return S.messages.filter(function (m) { return m.ch === ch && num(m.ts) > since && m.from !== me; }).length;
  }
  function myChannels() {
    var chans = ['group'];
    if (me) PIDS.forEach(function (id) { if (id !== me) chans.push(dmId(me, id)); });
    return chans;
  }
  function totalUnread() {
    if (!me) return 0;
    return myChannels().reduce(function (sum, ch) { return sum + unread(ch); }, 0);
  }
  function markRead(ch) {
    var msgs = chanMsgs(ch);
    var latest = msgs.length ? num(msgs[msgs.length - 1].ts) : 0;
    if (latest > num(lastRead[ch])) {
      lastRead[ch] = latest;
      lsSet(READ_KEY, JSON.stringify(lastRead));
    }
  }

  // ---------------------------------------------------------------- demo data (local mode only)
  function demoState() {
    var seed = 20261112;
    function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    var names = ['MapleMira', 'FarmerJo', 'SunnyKai', 'BarnOwl', 'PeachyPat', 'CornCob', 'LilyPad', 'TractorTom', 'HoneyBee', 'RiverRae',
      'AppleAce', 'DaisyDee', 'GoldenOat', 'CloverCat', 'PumpkinPip', 'WillowWes', 'BerryBo', 'MeadowMax', 'SproutSam', 'HarvestHal'];
    var players = {};
    PIDS.forEach(function (id, i) { players[id] = { name: names[i], color: COLORS[i] }; });
    var weights = PIDS.map(function (_, i) { return 0.25 + Math.pow(1 - i / PLAYER_COUNT, 1.6) * (0.6 + rnd()); });
    var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
    function pickPlayer() { var r = rnd() * wsum; for (var i = 0; i < PIDS.length; i++) { r -= weights[i]; if (r <= 0) return PIDS[i]; } return PIDS[0]; }
    var activity = [];
    var now = Date.now();
    for (var d = 13; d >= 0; d--) {
      var n = 5 + Math.floor(rnd() * 9);
      for (var k = 0; k < n; k++) {
        var t = TASK_TYPES[Math.floor(rnd() * TASK_TYPES.length)];
        var ts = now - d * 86400000 - Math.floor(rnd() * 20 * 3600000);
        if (ts > now) ts = now - Math.floor(rnd() * 3600000);
        var count = rnd() < 0.2 ? 2 : 1;
        activity.push({ id: 'demo' + d + '-' + k, pid: pickPlayer(), type: t.id, count: count,
          trophies: count * Math.max(1, Math.round(t.trophies * (0.7 + rnd() * 0.6))), ts: ts, by: null });
      }
    }
    var lines = [
      ['p01', 'Morning all! Regatta just started, let\'s grab the big tasks first.', 26],
      ['p04', 'I took the train shipment one. 8 trophies in the bag.', 25],
      ['p02', 'Anyone have spare nails? Need 3 for the barn upgrade.', 20],
      ['p07', 'Sending you some later today @FarmerJo', 19.5],
      ['p03', 'We\'re close to the next tier! Keep logging your tasks here.', 6],
      ['p10', 'Done with my helicopter orders for today.', 3],
      ['p01', 'Great work everyone, top 3 again this week!', 1]
    ];
    var messages = lines.map(function (l, i) { return { id: 'demo-m' + i, ch: 'group', from: l[0], text: l[1], ts: now - l[2] * 3600000 }; });
    messages.push({ id: 'demo-d1', ch: dmId('p01', 'p02'), from: 'p02', text: 'Hey, can you help me finish the zoo task tonight?', ts: now - 5 * 3600000 });
    messages.push({ id: 'demo-d2', ch: dmId('p01', 'p02'), from: 'p01', text: 'Sure! Ping me after dinner.', ts: now - 4.6 * 3600000 });
    return { town: { name: 'Maple Valley', rate: 1 }, players: players, activity: activity, messages: messages };
  }

  // ---------------------------------------------------------------- stores
  function changed() { version++; scheduleRender(); }

  var localStore = {
    kind: 'local',
    init: function () {
      var raw = lsGet(LS_KEY), loaded = false;
      if (raw) {
        try {
          var d = JSON.parse(raw);
          S.town = Object.assign({}, DEFAULT_TOWN, d.town || {});
          S.players = d.players || {}; S.activity = d.activity || []; S.messages = d.messages || [];
          isDemo = !!d.demo; loaded = true;
        } catch (e) { loaded = false; }
      }
      if (!loaded) { Object.assign(S, demoState()); isDemo = true; this.save(); }
      window.addEventListener('storage', function (e) {
        if (e.key !== LS_KEY || !e.newValue) return;
        try {
          var d = JSON.parse(e.newValue);
          S.town = Object.assign({}, DEFAULT_TOWN, d.town || {});
          S.players = d.players || {}; S.activity = d.activity || []; S.messages = d.messages || [];
          isDemo = !!d.demo; changed();
        } catch (err) { /* ignore */ }
      });
      changed();
    },
    save: function () {
      lsSet(LS_KEY, JSON.stringify({ town: S.town, players: S.players, activity: S.activity, messages: S.messages, demo: isDemo }));
    },
    addActivity: function (a) { S.activity.push(a); this.save(); changed(); return Promise.resolve(); },
    removeActivity: function (id) { S.activity = S.activity.filter(function (a) { return a.id !== id; }); this.save(); changed(); return Promise.resolve(); },
    setPlayer: function (id, data) { S.players[id] = data; this.save(); changed(); return Promise.resolve(); },
    setTown: function (t) { S.town = t; this.save(); changed(); return Promise.resolve(); },
    addMessage: function (m) { S.messages.push(m); this.save(); changed(); return Promise.resolve(); },
    reset: function (withDemo) {
      if (withDemo) { Object.assign(S, demoState()); isDemo = true; }
      else { S.town = Object.assign({}, DEFAULT_TOWN); S.players = {}; S.activity = []; S.messages = []; isDemo = false; }
      this.save(); changed();
    }
  };

  function makeDbStore(db) {
    var loaded = { players: false, activity: false, messages: false, town: false };
    var timer = setTimeout(function () { if (mode === 'connecting') { connectSlow = true; changed(); } }, 10000);
    function arrived(key, snap) {
      if (snap && snap.metadata && !snap.metadata.fromCache) loaded[key] = true;
      if (loaded.players && loaded.activity && loaded.messages && loaded.town && mode !== 'live') {
        mode = 'live'; connectSlow = false; clearTimeout(timer);
      }
      changed();
    }
    function listenErr(e) {
      clearTimeout(timer);
      if (mode === 'connecting') mode = 'live';
      connectSlow = false;
      if (e && e.code === 'revoked') toast('Your access to this township changed. Reload to see the latest.');
      else toast('Live updates stopped. Reload the page to reconnect.');
      changed();
    }
    function writeErr(e) {
      var code = e && e.code;
      if (code === 'invalid_argument' || code === 'not_granted') {
        readOnly = true;
        toast('Your access is view-only, so changes are not saved. Ask the owner for Contributor access.');
        changed();
      } else if (code === 'quota_exceeded') {
        toast('The township\'s storage is full. Remove old activity to make room.');
      } else {
        toast('That change didn\'t save. Check your connection and try again.');
      }
      throw e;
    }
    function attempt(fn) {
      return fn().catch(function (e) {
        if (e && e.code === 'unavailable') {
          return new Promise(function (r) { setTimeout(r, 400 + Math.random() * 800); }).then(fn);
        }
        throw e;
      }).catch(writeErr);
    }
    function clean(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'id' && o[k] !== undefined) c[k] = o[k]; }); return c; }

    return {
      kind: 'db',
      init: function () {
        db.collection('players').onSnapshot(function (snap) {
          var p = {}; snap.docs.forEach(function (d) { if (PIDS.indexOf(d.id) >= 0) p[d.id] = d.data(); });
          S.players = p; arrived('players', snap);
        }, listenErr);
        db.collection('activity').onSnapshot(function (snap) {
          S.activity = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          arrived('activity', snap);
        }, listenErr);
        db.collection('messages').orderBy('ts', 'desc').limit(600).onSnapshot(function (snap) {
          S.messages = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).reverse();
          arrived('messages', snap);
        }, listenErr);
        db.doc('settings/town').onSnapshot(function (d) {
          S.town = Object.assign({}, DEFAULT_TOWN, d.exists ? d.data() : {});
          arrived('town', d);
        }, listenErr);
      },
      addActivity: function (a) { return attempt(function () { return db.collection('activity').doc(a.id).set(clean(a)); }); },
      removeActivity: function (id) { return attempt(function () { return db.collection('activity').doc(id).delete(); }); },
      setPlayer: function (id, data) { return attempt(function () { return db.collection('players').doc(id).set(clean(data)); }); },
      setTown: function (t) { return attempt(function () { return db.doc('settings/town').set(clean(t)); }); },
      addMessage: function (m) { return attempt(function () { return db.collection('messages').doc(m.id).set(clean(m)); }); }
    };
  }

  // Firebase (Firestore) store for the GitHub Pages site. Keeps running totals
  // per player and per day (atomic increments), plus the latest task log and
  // chat messages, so each visit reads a few hundred documents at most.
  var FIREBASE_SDK = '10.12.2';
  var ACTIVITY_WINDOW = 40, MESSAGE_WINDOW = 150;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(el);
    });
  }

  function makeFirebaseStore(cfg) {
    var fs = null, FV = null, timer = null;
    var loaded = { players: false, days: false, activity: false, messages: false, town: false };
    function padKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function dayStart(ts) { var d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function arrived(key) {
      loaded[key] = true;
      if (loaded.players && loaded.days && loaded.activity && loaded.messages && loaded.town && mode !== 'live') {
        mode = 'live'; connectSlow = false; clearTimeout(timer);
      }
      changed();
    }
    function listenErr(e) {
      if (window.console) console.error(e);
      clearTimeout(timer);
      if (mode === 'connecting') mode = 'live';
      connectSlow = false;
      toast(e && e.code === 'permission-denied'
        ? 'The shared database refused access. Check the Firestore rules and that Anonymous sign-in is turned on.'
        : 'Live updates stopped. Reload the page to reconnect.');
      changed();
    }
    function writeErr(e) {
      if (window.console) console.error(e);
      if (e && e.code === 'permission-denied') toast('The database rules blocked that change.');
      else if (e && e.code === 'resource-exhausted') toast('Today\'s free database limit is used up. Changes will save again tomorrow.');
      else toast('That change didn\'t save. Check your connection and try again.');
      throw e;
    }
    function clean(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'id' && o[k] !== undefined) c[k] = o[k]; }); return c; }
    function applyTotals(batch, a, sign) {
      var t = sign * num(a.trophies), c = sign * num(a.count);
      var p = { trophies: FV.increment(t), tasks: FV.increment(c) };
      if (a.type !== 'adjust') {
        p.byType = {}; p.byType[a.type] = FV.increment(c);
        if (sign > 0) p.last = num(a.ts);
        var d = { t: FV.increment(t), ts: dayStart(num(a.ts)), pt: {} };
        d.pt[a.pid] = FV.increment(t);
        batch.set(fs.collection('days').doc(padKey(num(a.ts))), d, { merge: true });
      }
      batch.set(fs.collection('players').doc(a.pid), p, { merge: true });
    }
    function listen() {
      fs.collection('players').onSnapshot(function (snap) {
        var names = {}, totals = {};
        snap.forEach(function (d) {
          if (PIDS.indexOf(d.id) < 0) return;
          var x = d.data();
          names[d.id] = { name: x.name, color: x.color };
          totals[d.id] = x;
        });
        S.players = names; S.agg.players = totals; arrived('players');
      }, listenErr);
      fs.collection('days').where('ts', '>=', dayStart(Date.now() - 31 * 86400000)).onSnapshot(function (snap) {
        var days = {};
        snap.forEach(function (d) { var x = d.data(); days[dayKey(num(x.ts))] = x; });
        S.agg.days = days; arrived('days');
      }, listenErr);
      fs.collection('activity').orderBy('ts', 'desc').limit(ACTIVITY_WINDOW).onSnapshot(function (snap) {
        var list = []; snap.forEach(function (d) { list.push(Object.assign({ id: d.id }, d.data())); });
        S.activity = list; arrived('activity');
      }, listenErr);
      fs.collection('messages').orderBy('ts', 'desc').limit(MESSAGE_WINDOW).onSnapshot(function (snap) {
        var list = []; snap.forEach(function (d) { list.push(Object.assign({ id: d.id }, d.data())); });
        S.messages = list.reverse(); arrived('messages');
      }, listenErr);
      fs.collection('settings').doc('town').onSnapshot(function (d) {
        S.town = Object.assign({}, DEFAULT_TOWN, d.exists ? d.data() : {});
        arrived('town');
      }, listenErr);
    }
    return {
      kind: 'firebase',
      init: function () {
        S.agg = { players: {}, days: {} };
        S.activity = []; S.messages = []; S.players = {};
        timer = setTimeout(function () { if (mode === 'connecting') { connectSlow = true; changed(); } }, 10000);
        var base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK + '/';
        loadScript(base + 'firebase-app-compat.js')
          .then(function () { return Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]); })
          .then(function () {
            var app = firebase.initializeApp(cfg);
            fs = app.firestore(); FV = firebase.firestore.FieldValue;
            try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () { /* cache unavailable: still works online */ }); } catch (e) { /* ignore */ }
            return app.auth().signInAnonymously();
          })
          .then(listen)
          .catch(function (e) {
            if (window.console) console.error(e);
            clearTimeout(timer);
            toast(e && e.code === 'auth/operation-not-allowed'
              ? 'Turn on Anonymous sign-in in Firebase to share data. Saving on this device for now.'
              : 'Couldn\'t reach the shared database. Saving on this device for now.');
            S.agg = null; mode = 'local'; store = localStore; localStore.init();
          });
      },
      addActivity: function (a) {
        var b = fs.batch();
        b.set(fs.collection('activity').doc(a.id), clean(a));
        applyTotals(b, a, 1);
        return b.commit().catch(writeErr);
      },
      removeActivity: function (id) {
        var a = S.activity.filter(function (x) { return x.id === id; })[0];
        if (!a) return Promise.resolve();
        var b = fs.batch();
        b.delete(fs.collection('activity').doc(id));
        applyTotals(b, a, -1);
        return b.commit().catch(writeErr);
      },
      setPlayer: function (id, data) {
        return fs.collection('players').doc(id).set({ name: data.name, color: data.color }, { merge: true }).catch(writeErr);
      },
      setTown: function (t) {
        return fs.collection('settings').doc('town').set({ name: t.name, rate: num(t.rate) || 1 }, { merge: true }).catch(writeErr);
      },
      addMessage: function (m) {
        return fs.collection('messages').doc(m.id).set(clean(m)).catch(writeErr);
      }
    };
  }

  // ---------------------------------------------------------------- actions
  function logTask(pid, type, trophies, count) {
    if (!canWrite()) { toast('Changes are turned off for your access level.'); return; }
    var before = tierFor(stats().total.trophies).cur;
    var a = { id: uid(), pid: pid, type: type, trophies: Math.round(trophies), count: Math.round(count), ts: Date.now(), by: me || null };
    var p = player(pid);
    store.addActivity(a).then(function () {
      var after = tierFor(stats().total.trophies).cur;
      burst(after !== before ? 160 : 60);
      if (type === 'adjust') {
        toast('Adjusted ' + p.name + '\'s totals.');
      } else {
        toast('+' + fmt(a.trophies) + ' trophies and +' + fmt(a.trophies * rate()) + ' diamonds for ' + p.name + '.');
      }
      if (after !== before && TIERS.indexOf(after) > TIERS.indexOf(before)) {
        toast('Township reached ' + after.name + ' tier!', 'gold');
        store.addMessage({ id: uid(), ch: 'group', from: 'system', text: S.town.name + ' reached the ' + after.name + ' tier with ' + fmt(stats().total.trophies) + ' trophies!', ts: Date.now() + 1 }).catch(function () {});
      }
    }).catch(function () {});
  }

  function sendMessage(text) {
    text = String(text || '').trim().slice(0, 500);
    if (!text) return;
    if (!me) { openModal({ kind: 'me' }); return; }
    if (!canWrite()) { toast('Changes are turned off for your access level.'); return; }
    var m = { id: uid(), ch: ui.chatCh, from: me, text: text, ts: Date.now() };
    var input = document.getElementById('chat-input');
    if (input) input.value = '';
    store.addMessage(m).then(function () { markRead(ui.chatCh); }).catch(function () { if (input && !input.value) input.value = text; });
  }

  // ---------------------------------------------------------------- render plumbing
  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    var run = function () { renderQueued = false; renderAll(); };
    if (document.visibilityState === 'hidden') setTimeout(run, 0);
    else requestAnimationFrame(run);
  }

  function swap(el, html) {
    if (!el) return;
    var vals = {};
    el.querySelectorAll('input[id], select[id], textarea[id]').forEach(function (f) { vals[f.id] = f.value; });
    var active = document.activeElement;
    var activeId = active && el.contains(active) ? active.id : null;
    var sel = null;
    if (activeId && active.setSelectionRange && typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd];
    var msgs = el.querySelector('.msgs');
    var stick = !msgs || msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    var msgsKey = msgs && msgs.getAttribute('data-ch');
    var prevTop = msgs ? msgs.scrollTop : 0;
    var scrollers = {};
    el.querySelectorAll('[data-keep-scroll]').forEach(function (s) { scrollers[s.getAttribute('data-keep-scroll')] = s.scrollTop; });

    el.innerHTML = html;

    Object.keys(vals).forEach(function (id) {
      var f = document.getElementById(id);
      if (f && el.contains(f) && f.getAttribute('data-fresh') == null) f.value = vals[id];
    });
    el.querySelectorAll('[data-keep-scroll]').forEach(function (s) { var k = s.getAttribute('data-keep-scroll'); if (k in scrollers) s.scrollTop = scrollers[k]; });
    var newMsgs = el.querySelector('.msgs');
    if (newMsgs) {
      if (stick || newMsgs.getAttribute('data-ch') !== msgsKey) newMsgs.scrollTop = newMsgs.scrollHeight;
      else newMsgs.scrollTop = prevTop;
    }
    if (activeId) {
      var f2 = document.getElementById(activeId);
      if (f2) { f2.focus({ preventScroll: true }); if (sel && f2.setSelectionRange) try { f2.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
    }
  }

  function buildShell(root) {
    root.innerHTML =
      '<header class="topbar"><div class="topbar-inner" id="hdr"></div>' +
      '<div class="tabs-row"><div class="wrap"><nav class="tabs" id="tabs" aria-label="Sections"></nav></div></div></header>' +
      '<main class="wrap" id="main"></main>' +
      '<footer class="footer wrap" id="footer"></footer>' +
      '<div id="modal-root"></div><div class="toasts" id="toasts" role="status" aria-live="polite"></div>' +
      '<canvas id="confetti" aria-hidden="true"></canvas>';
  }

  function renderAll() {
    if (ui.view === 'chat' && ui.chatOpen && document.visibilityState === 'visible') markRead(ui.chatCh);
    swap(document.getElementById('hdr'), renderHeader());
    swap(document.getElementById('tabs'), renderTabs());
    swap(document.getElementById('main'), renderView());
    swap(document.getElementById('modal-root'), renderModal());
    var f = document.getElementById('footer');
    if (f && !f.innerHTML) f.innerHTML = 'A fan-made co-op tracker for township games. Not affiliated with any game publisher.';
    var u = totalUnread();
    document.title = (u ? '(' + (u > 99 ? '99+' : u) + ') ' : '') + (S.town.name ? S.town.name + ' · Township Rewards' : 'Township Rewards');
    checkNewMessages();
  }

  // ---------------------------------------------------------------- header + tabs
  function renderHeader() {
    var sub;
    if (mode === 'connecting') sub = '<span class="dot"></span>Connecting to your township…';
    else if (mode === 'live') sub = '<span class="dot live"></span>Live · shared with your township' + (readOnly ? ' (view only)' : '');
    else sub = '<span class="dot"></span>Saved on this device';
    var mp = me ? player(me) : null;
    return '<div class="brand">' + BRAND_MARK +
      '<div class="brand-text"><div class="brand-name">' + esc(S.town.name) + '</div><div class="brand-sub">' + sub + '</div></div></div>' +
      '<button class="me-chip" data-act="pick-me" aria-label="Choose which player you are">' +
      (mp ? avatar(mp, 'sm') + '<span class="me-name">' + esc(mp.name) + '</span>' : '<span class="avatar sm" style="background:var(--muted)">?</span><span class="me-name">Who are you?</span>') +
      '</button>' +
      '<button class="btn ghost small" data-act="open-settings" aria-label="Township settings">' + icon('gear') + '</button>';
  }
  function renderTabs() {
    var u = totalUnread();
    return VIEWS.map(function (v) {
      var badge = v.id === 'chat' && u ? '<span class="badge">' + (u > 99 ? '99+' : u) + '</span>' : '';
      return '<a class="tab" href="#' + v.id + '"' + (ui.view === v.id ? ' aria-current="page"' : '') + '>' + icon(v.icon) + '<span>' + v.label + '</span>' + badge + '</a>';
    }).join('');
  }

  function notices() {
    var out = '';
    if (mode === 'connecting') {
      out += '<div class="notice info"><span>' + (connectSlow ? 'The shared township can\'t be reached yet. Anything shown may be out of date.' : 'Loading your township…') + '</span></div>';
    }
    if (mode === 'local' && isDemo) {
      out += '<div class="notice"><span><b>You\'re looking at example data.</b> Explore, then start fresh with your own 20 players.</span>' +
        '<button class="btn small" data-act="reset-blank">Start fresh</button></div>';
    }
    if (readOnly) out += '<div class="notice info"><span>You have view-only access. You can browse, but changes and messages aren\'t saved.</span></div>';
    return out;
  }

  function renderView() {
    switch (ui.view) {
      case 'trophies': return notices() + viewTrophies();
      case 'diamonds': return notices() + viewDiamonds();
      case 'players': return notices() + viewPlayers();
      case 'tasks': return notices() + viewTasks();
      case 'chat': return notices() + viewChat();
      default: return notices() + viewTown();
    }
  }

  // ---------------------------------------------------------------- views
  function skyline() {
    return '<svg class="hero-scene" viewBox="0 0 800 130" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
      '<path d="M0 90 Q120 50 260 82 T520 76 T800 70 V130 H0z" style="fill:var(--hill-1)"/>' +
      '<path d="M0 108 Q160 84 330 104 T640 98 T800 100 V130 H0z" style="fill:var(--hill-2)"/>' +
      // barn
      '<rect x="560" y="52" width="64" height="44" style="fill:var(--roof)"/><path d="M552 56 592 28l40 28z" style="fill:var(--roof)"/><path d="M552 56 592 28l40 28" fill="none" style="stroke:var(--wall)" stroke-width="4"/>' +
      '<rect x="580" y="68" width="24" height="28" style="fill:var(--wall)"/><path d="M580 68l24 28M604 68l-24 28" style="stroke:var(--roof)" stroke-width="3"/>' +
      // houses
      '<rect x="420" y="70" width="44" height="32" style="fill:var(--wall)"/><path d="M414 72 442 50l28 22z" style="fill:var(--roof)"/><rect x="436" y="84" width="12" height="18" style="fill:var(--hill-2)"/>' +
      '<rect x="480" y="78" width="34" height="26" style="fill:var(--wall)"/><path d="M475 80 497 62l22 18z" style="fill:var(--accent)"/><rect x="490" y="86" width="10" height="9" style="fill:var(--sky-1)"/>' +
      // windmill
      '<path d="M700 100 708 50h12l8 50z" style="fill:var(--wall)"/><g style="stroke:var(--wall)" stroke-width="5" stroke-linecap="round"><path d="M714 52 690 30M714 52l24-22M714 52l-22 24M714 52l24 22"/></g><circle cx="714" cy="52" r="5" style="fill:var(--roof)"/>' +
      // trees
      '<circle cx="380" cy="86" r="14" style="fill:var(--hill-2)"/><circle cx="396" cy="92" r="10" style="fill:var(--accent)"/><circle cx="660" cy="92" r="11" style="fill:var(--accent)"/>' +
      '<circle cx="760" cy="94" r="12" style="fill:var(--hill-2)"/>' +
      '</svg>';
  }

  function statTile(href, iconName, cls, label, value, foot) {
    return '<a class="stat" href="#' + href + '"><span class="stat-label">' + icon(iconName, cls) + label + '</span>' +
      '<span class="stat-value num">' + value + '</span><span class="stat-foot">' + foot + '</span></a>';
  }

  function leaderRows(list, metric, limit) {
    return '<ul class="list">' + list.slice(0, limit).map(function (s, i) {
      var v = metric === 'diamonds' ? icon('diamond', 'sm c-diamond') + fmt(s.diamonds)
        : metric === 'tasks' ? icon('task', 'sm c-task') + fmt(s.tasks)
          : icon('trophy', 'sm c-gold') + fmt(s.trophies);
      return '<li><button class="row" data-act="open-player" data-id="' + s.id + '"><span class="rank">' + (i + 1) + '</span>' + avatar(s.p) +
        '<span style="min-width:0"><span class="row-name">' + esc(s.p.name) + (s.id === me ? '<span class="you-tag">YOU</span>' : '') + '</span>' +
        '<span class="row-sub"> ' + fmt(s.tasks) + ' tasks</span></span><span class="row-val">' + v + '</span></button></li>';
    }).join('') + '</ul>';
  }

  function feedItems(items, opts) {
    opts = opts || {};
    if (!items.length) {
      return '<div class="empty">' + icon('task', 'lg') + '<strong>No tasks logged yet</strong><span>Log the first completed task to start earning township trophies.</span>' +
        '<a class="btn primary small" href="#tasks">' + icon('plus') + 'Log a task</a></div>';
    }
    return '<ul class="feed">' + items.map(function (a) {
      var p = player(a.pid), t = TYPE_BY_ID[a.type] || TYPE_BY_ID.other;
      var what = a.type === 'adjust'
        ? '<b>' + esc(p.name) + '</b> totals adjusted'
        : '<b>' + esc(p.name) + '</b> completed ' + (num(a.count) > 1 ? fmt(a.count) + '× ' : '') + esc(t.label.toLowerCase());
      var gain = num(a.trophies) >= 0 ? '+' + fmt(a.trophies) : fmt(a.trophies);
      var del = opts.del && canWrite() ? '<button class="btn ghost small" data-act="del-activity" data-id="' + esc(a.id) + '" aria-label="Remove this entry">' + icon('trash') + '</button>' : '';
      return '<li>' + avatar(p, 'sm') + '<span class="what">' + what + ' <span class="gain c-gold">' + icon('trophy', 'sm') + gain + '</span>' +
        (opts.diamonds ? ' <span class="gain c-diamond">' + icon('diamond', 'sm') + (num(a.trophies) >= 0 ? '+' : '') + fmt(num(a.trophies) * rate()) + '</span>' : '') +
        '</span><span class="when">' + ago(num(a.ts)) + del + '</span></li>';
    }).join('') + '</ul>';
  }

  function viewTown() {
    var st = stats(), t = st.total, tier = tierFor(t.trophies);
    var chatPreview = chanMsgs('group').slice(-3);
    var chatHtml = chatPreview.length ? '<ul class="feed">' + chatPreview.map(function (m) {
      var p = m.from === 'system' ? null : player(m.from);
      return '<li>' + (p ? avatar(p, 'sm') : '<span class="avatar sm" style="background:var(--gold)">★</span>') +
        '<span class="what">' + (p ? '<b>' + esc(p.name) + ':</b> ' : '') + esc(m.text) + '</span><span class="when">' + ago(num(m.ts)) + '</span></li>';
    }).join('') + '</ul>' : '<div class="empty"><strong>The town square is quiet</strong><span>Say hello to your township.</span></div>';

    return '<section class="hero">' + skyline() +
      '<div class="hero-content"><span class="hero-eyebrow">Township trophies</span>' +
      '<span class="hero-title num">' + fmt(t.trophies) + ' trophies</span>' +
      '<div class="hero-tier"><span class="tier-pill">' + icon('trophy', 'sm c-gold') + esc(tier.cur.name) + ' tier</span>' +
      (tier.next ? '<span class="muted" style="font-weight:700">' + fmt(tier.next.min - t.trophies) + ' to ' + esc(tier.next.name) + '</span>' : '<span class="muted" style="font-weight:700">Top tier reached</span>') + '</div>' +
      '<div class="progress" style="max-width:360px;margin-top:6px" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(tier.pct * 100) + '" aria-label="Progress to next tier"><span style="width:' + (tier.pct * 100).toFixed(1) + '%"></span></div>' +
      '<a class="btn primary" href="#tasks">' + icon('plus') + 'Log a completed task</a></div></section>' +

      '<div class="stats">' +
      statTile('trophies', 'trophy', 'c-gold', 'Trophies', fmt(t.trophies), 'Earned by the whole township') +
      statTile('diamonds', 'diamond', 'c-diamond', 'Diamonds', fmt(t.diamonds), '1 trophy = ' + fmt(rate()) + ' diamond' + (rate() === 1 ? '' : 's')) +
      statTile('tasks', 'task', 'c-task', 'Tasks done', fmt(t.tasks), 'Completed by all players') +
      statTile('players', 'users', '', 'Active players', t.active + ' / ' + PLAYER_COUNT, 'Logged a task in the last 7 days') +
      '</div>' +

      '<div class="grid grid-2">' +
      '<section class="panel"><h3>Top players <a class="btn small" href="#players">All 20</a></h3>' + leaderRows(st.ranked, 'trophies', 5) + '</section>' +
      '<section class="panel"><h3>Recent activity <a class="btn small" href="#tasks">All tasks</a></h3>' + feedItems(sortedActivity().slice(0, 6), {}) + '</section>' +
      '</div>' +
      '<section class="panel"><h3>Town square chat <a class="btn small" href="#chat" data-act="chan" data-ch="group">Open chat</a></h3>' + chatHtml + '</section>';
  }

  // bar chart of a per-day series (single series: no legend; title names it)
  function dayBars(cls, mult, unit) {
    var days = ui.range, now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
    var bins = [];
    for (var d = 0; d < days; d++) {
      var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - d)).getTime();
      bins.push({ ts: ts, key: dayKey(ts), v: 0 });
    }
    var idx = {}; bins.forEach(function (b, i) { idx[b.key] = i; });
    if (S.agg) {
      Object.keys(S.agg.days).forEach(function (k) {
        var i = idx[k];
        if (i != null) bins[i].v += num(S.agg.days[k].t) * mult;
      });
    } else {
      S.activity.forEach(function (a) {
        if (a.type === 'adjust' || num(a.ts) < start) return;
        var i = idx[dayKey(num(a.ts))];
        if (i != null) bins[i].v += num(a.trophies) * mult;
      });
    }
    var max = Math.max.apply(null, bins.map(function (b) { return b.v; }));
    var step = niceStep(max);
    var top = Math.max(step * 4, step);
    var W = 640, H = 210, L = 40, R = 8, T = 16, B = 28;
    var pw = W - L - R, ph = H - T - B, bw = pw / days, gap = Math.max(2, bw * 0.22);
    var y = function (v) { return T + ph - (v / top) * ph; };
    var g = '';
    for (var k = 0; k <= 4; k++) {
      var gv = step * k, gy = y(gv);
      g += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text class="axis-text" x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + fmt(gv) + '</text>';
    }
    var maxI = -1; bins.forEach(function (b, i) { if (b.v === max && max > 0) maxI = i; });
    var labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : 5;
    var bars = bins.map(function (b, i) {
      var x = L + i * bw + gap / 2, w = bw - gap, h = Math.max(0, (b.v / top) * ph), yy = T + ph - h, r = Math.min(4, w / 2, h);
      var path = h > 0 ? '<path class="bar ' + cls + '" d="M' + x + ',' + (T + ph) + 'V' + (yy + r) + 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + yy + ' ' + (x + w) + ',' + (yy + r) + 'V' + (T + ph) + 'Z"/>' : '';
      var d = new Date(b.ts);
      var lbl = (days - 1 - i) % labelEvery === 0 ? '<text class="axis-text" x="' + (x + w / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + (i === days - 1 ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + '</text>' : '';
      var val = i === maxI ? '<text class="val-text" x="' + (x + w / 2) + '" y="' + (yy - 5) + '" text-anchor="middle">' + fmt(b.v) + '</text>' : '';
      var tip = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' + fmt(b.v) + ' ' + unit;
      return '<rect class="hit" x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + ph + '" data-tip="' + esc(tip) + '"/>' + path + lbl + val;
    }).join('');
    var table = '<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:.85rem;font-weight:700">Show as table</summary><div class="table-wrap"><table class="data"><thead><tr><th>Day</th><th class="n">' + esc(unit) + '</th></tr></thead><tbody>' +
      bins.slice().reverse().map(function (b) { return '<tr><td>' + new Date(b.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</td><td class="n">' + fmt(b.v) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(unit) + ' earned per day, last ' + days + ' days">' + g + bars +
      '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '" style="stroke:var(--muted)"/></svg></div>' + table;
  }
  function niceStep(max) {
    if (max <= 0) return 5;
    var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function rangeSeg() {
    return '<div class="seg" role="group" aria-label="Date range">' + [7, 14, 30].map(function (d) {
      return '<button data-act="range" data-range="' + d + '" aria-pressed="' + (ui.range === d) + '">' + d + ' days</button>';
    }).join('') + '</div>';
  }

  function viewTrophies() {
    var st = stats(), t = st.total, tier = tierFor(t.trophies);
    var weekly = st.list.slice().sort(function (a, b) { return b.week - a.week || a.p.n - b.p.n; }).filter(function (s) { return s.week > 0; });
    return '<div class="view-head"><div><h2>Township trophies</h2><p>Every trophy a player earns counts toward the township total. Climb the tiers together.</p></div></div>' +
      '<div class="stats">' +
      '<div class="stat"><span class="stat-label">' + icon('trophy', 'c-gold') + 'Township total</span><span class="stat-value num">' + fmt(t.trophies) + '</span><span class="stat-foot">' + esc(tier.cur.name) + ' tier</span></div>' +
      '<div class="stat"><span class="stat-label">Next tier</span><span class="stat-value num">' + (tier.next ? fmt(tier.next.min - t.trophies) : '—') + '</span><span class="stat-foot">' + (tier.next ? 'trophies to ' + esc(tier.next.name) : 'Legend reached') + '</span></div>' +
      '<div class="stat"><span class="stat-label">This week</span><span class="stat-value num">' + fmt(st.list.reduce(function (s, x) { return s + x.week; }, 0)) + '</span><span class="stat-foot">trophies in the last 7 days</span></div>' +
      '<div class="stat"><span class="stat-label">Average per player</span><span class="stat-value num">' + fmt(t.trophies / PLAYER_COUNT) + '</span><span class="stat-foot">across ' + PLAYER_COUNT + ' player slots</span></div>' +
      '</div>' +
      '<section class="panel"><h3>Tier road</h3><div class="tiers">' + TIERS.map(function (x) {
        var cls = t.trophies >= x.min ? (x === tier.cur ? 'current' : '') : 'locked';
        return '<div class="tier ' + cls + '">' + medal(x.color) + '<span class="tier-name">' + x.name + '</span><span class="tier-need num">' + (x.min ? fmt(x.min) + ' trophies' : 'Start') + '</span>' +
          (x === tier.cur ? '<span class="tier-need" style="color:var(--gold-text);font-weight:800">Current</span>' : '') + '</div>';
      }).join('') + '</div>' +
      (tier.next ? '<div style="margin-top:14px;display:grid;gap:6px"><div class="muted" style="font-weight:700;font-size:.88rem">' + fmt(t.trophies - tier.cur.min) + ' of ' + fmt(tier.next.min - tier.cur.min) + ' trophies toward ' + esc(tier.next.name) + '</div>' +
        '<div class="progress"><span style="width:' + (tier.pct * 100).toFixed(1) + '%"></span></div></div>' : '') + '</section>' +
      '<div class="grid grid-2">' +
      '<section class="panel"><h3>Trophies per day ' + rangeSeg() + '</h3>' + dayBars('', 1, 'trophies') + '</section>' +
      '<section class="panel"><h3>Top earners this week</h3>' + (weekly.length ? '<ul class="list">' + weekly.slice(0, 8).map(function (s, i) {
        return '<li><button class="row" data-act="open-player" data-id="' + s.id + '"><span class="rank">' + (i + 1) + '</span>' + avatar(s.p) +
          '<span class="row-name">' + esc(s.p.name) + '</span><span class="row-val c-gold">' + icon('trophy', 'sm') + fmt(s.week) + '</span></button></li>';
      }).join('') + '</ul>' : '<div class="empty"><strong>No trophies this week yet</strong><span>Tasks logged in the last 7 days show up here.</span></div>') + '</section>' +
      '</div>';
  }

  function viewDiamonds() {
    var st = stats(), t = st.total;
    var chests = Math.floor(t.diamonds / CHEST_SIZE), into = t.diamonds - chests * CHEST_SIZE;
    var sorted = st.list.slice().sort(function (a, b) { return b.diamonds - a.diamonds || a.p.n - b.p.n; });
    var max = Math.max(1, sorted[0] ? sorted[0].diamonds : 1);
    return '<div class="view-head"><div><h2>Diamond vault</h2><p>Each player\'s diamonds always match their trophies at the township\'s exchange rate, so the vault grows with every task.</p></div></div>' +
      '<section class="vault"><span class="hero-eyebrow">Township diamonds</span>' +
      '<div class="vault-row"><span class="vault-big">' + icon('diamond', 'lg') + ' ' + fmt(t.diamonds) + '</span>' +
      '<span class="rate">' + icon('trophy', 'sm c-gold') + '1 trophy = ' + fmt(rate()) + ' ' + icon('diamond', 'sm c-diamond') + '</span></div>' +
      '<div style="display:grid;gap:6px;max-width:520px;margin-top:8px"><div class="muted" style="font-weight:700;font-size:.88rem">' + chests + ' vault chest' + (chests === 1 ? '' : 's') + ' unlocked · ' + fmt(CHEST_SIZE - into) + ' diamonds to the next chest</div>' +
      '<div class="progress diamond" role="progressbar" aria-valuemin="0" aria-valuemax="' + CHEST_SIZE + '" aria-valuenow="' + Math.round(into) + '" aria-label="Progress to next vault chest"><span style="width:' + (into / CHEST_SIZE * 100).toFixed(1) + '%"></span></div></div>' +
      (canWrite() ? '<div class="toolbar" style="margin-top:10px"><span class="muted" style="font-weight:700;font-size:.85rem">Exchange rate</span><div class="seg" role="group" aria-label="Diamonds per trophy">' + [1, 2, 5, 10].map(function (r) {
        return '<button data-act="set-rate" data-rate="' + r + '" aria-pressed="' + (rate() === r) + '">1 : ' + r + '</button>';
      }).join('') + '</div></div>' : '') + '</section>' +
      '<div class="grid grid-2">' +
      '<section class="panel"><h3>Diamonds by player</h3><div class="hbars">' + sorted.map(function (s) {
        return '<button class="hbar" data-act="open-player" data-id="' + s.id + '" style="border:0;background:none;padding:0;text-align:left;width:100%" title="' + esc(s.p.name) + ': ' + fmt(s.diamonds) + ' diamonds">' +
          '<span class="hbar-label">' + avatar(s.p, 'sm') + '<span>' + esc(s.p.name) + '</span></span>' +
          '<span class="hbar-track"><span class="hbar-fill" style="display:block;width:' + (s.diamonds / max * 100).toFixed(1) + '%"></span></span>' +
          '<span class="hbar-val c-diamond">' + fmt(s.diamonds) + '</span></button>';
      }).join('') + '</div></section>' +
      '<section class="panel"><h3>Diamonds per day ' + rangeSeg() + '</h3>' + dayBars('diamond', rate(), 'diamonds') +
      '<h3 style="margin-top:18px">Latest diamond earnings</h3>' + feedItems(sortedActivity().filter(function (a) { return a.type !== 'adjust'; }).slice(0, 6), { diamonds: true }) + '</section>' +
      '</div>';
  }

  function viewPlayers() {
    var st = stats();
    var key = ui.playerSort;
    var list = st.list.slice().sort(function (a, b) {
      if (key === 'name') return a.p.name.localeCompare(b.p.name);
      if (key === 'slot') return a.p.n - b.p.n;
      return (b[key] - a[key]) || a.p.n - b.p.n;
    });
    var top3 = st.ranked.slice(0, 3);
    var podium = st.total.trophies > 0 ? '<section class="panel"><h3>Podium</h3><div class="podium">' + [1, 0, 2].map(function (i) {
      var s = top3[i]; if (!s) return '<div></div>';
      return '<button class="pod p' + (i + 1) + '" data-act="open-player" data-id="' + s.id + '" style="border:0;background:none;padding:0">' + avatar(s.p, i === 0 ? 'lg' : '') +
        '<span class="pod-name">' + esc(s.p.name) + '</span><span class="pod-score c-gold">' + icon('trophy', 'sm') + fmt(s.trophies) + '</span>' +
        '<span class="pod-block">' + (i + 1) + '</span></button>';
    }).join('') + '</div></section>' : '';

    var sortSeg = '<div class="seg" role="group" aria-label="Sort players">' + [['trophies', 'Trophies'], ['tasks', 'Tasks'], ['name', 'Name'], ['slot', 'Slot']].map(function (o) {
      return '<button data-act="player-sort" data-key="' + o[0] + '" aria-pressed="' + (key === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
    var layoutSeg = '<div class="seg" role="group" aria-label="Layout">' + [['cards', 'Cards'], ['table', 'Table']].map(function (o) {
      return '<button data-act="player-layout" data-layout="' + o[0] + '" aria-pressed="' + (ui.playerLayout === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';

    var body;
    if (ui.playerLayout === 'table') {
      body = '<div class="panel" style="padding:6px"><div class="table-wrap"><table class="data"><thead><tr><th class="n">Rank</th><th>Player</th><th class="n">Trophies</th><th class="n">Diamonds</th><th class="n">Tasks</th><th>Last task</th></tr></thead><tbody>' +
        list.map(function (s) {
          return '<tr data-act="open-player" data-id="' + s.id + '"><td class="n">#' + s.rank + '</td><td><span class="cell-player">' + avatar(s.p, 'sm') + esc(s.p.name) + (s.id === me ? '<span class="you-tag">YOU</span>' : '') + '</span></td>' +
            '<td class="n c-gold">' + fmt(s.trophies) + '</td><td class="n c-diamond">' + fmt(s.diamonds) + '</td><td class="n">' + fmt(s.tasks) + '</td><td class="muted">' + (s.last ? ago(s.last) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    } else {
      body = '<div class="players">' + list.map(function (s) {
        return '<button class="pcard" data-act="open-player" data-id="' + s.id + '"><span class="pcard-top">' + avatar(s.p) +
          '<span style="min-width:0"><span class="pcard-name" style="display:block">' + esc(s.p.name) + (s.id === me ? '<span class="you-tag">YOU</span>' : '') + '</span>' +
          '<span class="pcard-rank">Rank #' + s.rank + ' · ' + (s.last ? 'active ' + ago(s.last) : 'no tasks yet') + '</span></span></span>' +
          '<span class="pcard-stats"><span class="mini"><span class="c-gold">' + icon('trophy', 'sm') + 'Trophy</span><b>' + fmt(s.trophies) + '</b></span>' +
          '<span class="mini"><span class="c-diamond">' + icon('diamond', 'sm') + 'Diamond</span><b>' + fmt(s.diamonds) + '</b></span>' +
          '<span class="mini"><span class="c-task">' + icon('task', 'sm') + 'Tasks</span><b>' + fmt(s.tasks) + '</b></span></span></button>';
      }).join('') + '</div>';
    }
    return '<div class="view-head"><div><h2>Players</h2><p>All ' + PLAYER_COUNT + ' township players. Diamonds match trophies (1 trophy = ' + fmt(rate()) + ' diamond' + (rate() === 1 ? '' : 's') + '). Tap a player to rename, adjust or message them.</p></div></div>' +
      podium + '<div class="toolbar">' + sortSeg + layoutSeg + '</div>' + body;
  }

  function viewTasks() {
    var st = stats();
    if (!ui.logPlayer) ui.logPlayer = me || PIDS[0];
    var typeTotals = {};
    TASK_TYPES.forEach(function (t) { typeTotals[t.id] = 0; });
    st.list.forEach(function (s) { Object.keys(s.byType).forEach(function (k) { if (typeTotals[k] != null) typeTotals[k] += num(s.byType[k]); }); });
    var typeMax = Math.max(1, Math.max.apply(null, TASK_TYPES.map(function (t) { return typeTotals[t.id]; })));
    var byTasks = st.list.slice().sort(function (a, b) { return b.tasks - a.tasks || a.p.n - b.p.n; });
    var taskMax = Math.max(1, byTasks[0] ? byTasks[0].tasks : 1);

    var form = '<form class="form" data-form="log">' +
      '<div class="field"><label for="log-player">Player</label><select class="input" id="log-player" data-fresh data-bind="logPlayer">' +
      PIDS.map(function (id) { var p = player(id); return '<option value="' + id + '"' + (ui.logPlayer === id ? ' selected' : '') + '>' + esc(p.name) + (id === me ? ' (you)' : '') + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><span class="field-label" style="font-size:.8rem;font-weight:800;color:var(--muted)">Task type</span><div class="chips" role="group" aria-label="Task type">' + TASK_TYPES.map(function (t) {
        return '<button type="button" class="chip" data-act="log-type" data-type="' + t.id + '" aria-pressed="' + (ui.logType === t.id) + '">' + esc(t.label) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field-row">' +
      '<div class="field"><label for="log-trophies">Trophies earned (each)</label><div class="stepper"><button type="button" data-act="step" data-field="logTrophies" data-delta="-1" aria-label="Fewer trophies">−</button>' +
      '<input class="input num" id="log-trophies" data-fresh type="number" inputmode="numeric" min="0" max="9999" value="' + ui.logTrophies + '" data-bind="logTrophies">' +
      '<button type="button" data-act="step" data-field="logTrophies" data-delta="1" aria-label="More trophies">+</button></div></div>' +
      '<div class="field"><label for="log-count">How many tasks</label><div class="stepper"><button type="button" data-act="step" data-field="logCount" data-delta="-1" aria-label="Fewer tasks">−</button>' +
      '<input class="input num" id="log-count" data-fresh type="number" inputmode="numeric" min="1" max="99" value="' + ui.logCount + '" data-bind="logCount">' +
      '<button type="button" data-act="step" data-field="logCount" data-delta="1" aria-label="More tasks">+</button></div></div>' +
      '</div>' +
      '<div class="toolbar" style="justify-content:space-between"><span class="muted" style="font-weight:700">Earns <span class="c-gold">' + icon('trophy', 'sm') + fmt(ui.logTrophies * ui.logCount) + '</span> and <span class="c-diamond">' + icon('diamond', 'sm') + fmt(ui.logTrophies * ui.logCount * rate()) + '</span></span>' +
      '<button class="btn primary" type="submit"' + (canWrite() ? '' : ' disabled') + '>' + icon('plus') + 'Log task</button></div></form>';

    return '<div class="view-head"><div><h2>Tasks</h2><p>Log every completed task. Each one adds trophies, and the matching diamonds, to the player and the township.</p></div>' +
      '<div class="stat" style="padding:10px 16px"><span class="stat-label">' + icon('task', 'c-task') + 'Total tasks</span><span class="stat-value num">' + fmt(st.total.tasks) + '</span></div></div>' +
      '<div class="grid grid-2">' +
      '<section class="panel"><h3>Log a completed task</h3>' + form + '</section>' +
      '<section class="panel"><h3>Tasks by type</h3><div class="hbars">' + TASK_TYPES.map(function (t) {
        return '<div class="hbar"><span class="hbar-label"><span>' + esc(t.label) + '</span></span><span class="hbar-track"><span class="hbar-fill task" style="display:block;width:' + (typeTotals[t.id] / typeMax * 100).toFixed(1) + '%"></span></span><span class="hbar-val">' + fmt(typeTotals[t.id]) + '</span></div>';
      }).join('') + '</div></section>' +
      '</div>' +
      '<div class="grid grid-2">' +
      '<section class="panel"><h3>Tasks completed by each player</h3><div class="hbars">' + byTasks.map(function (s) {
        return '<button class="hbar" data-act="open-player" data-id="' + s.id + '" style="border:0;background:none;padding:0;text-align:left;width:100%" title="' + esc(s.p.name) + ': ' + fmt(s.tasks) + ' tasks">' +
          '<span class="hbar-label">' + avatar(s.p, 'sm') + '<span>' + esc(s.p.name) + '</span></span>' +
          '<span class="hbar-track"><span class="hbar-fill task" style="display:block;width:' + (s.tasks / taskMax * 100).toFixed(1) + '%"></span></span><span class="hbar-val">' + fmt(s.tasks) + '</span></button>';
      }).join('') + '</div></section>' +
      '<section class="panel"><h3>Task log</h3><div data-keep-scroll="feed" style="max-height:640px;overflow-y:auto">' + feedItems(sortedActivity().slice(0, 60), { del: true }) + '</div></section>' +
      '</div>';
  }

  function viewChat() {
    var chans = myChannels();
    var filter = ui.chatFilter.trim().toLowerCase();
    var lastBy = {};
    S.messages.forEach(function (m) { lastBy[m.ch] = m; });
    var dms = chans.slice(1).sort(function (a, b) {
      var la = lastBy[a] ? num(lastBy[a].ts) : 0, lb = lastBy[b] ? num(lastBy[b].ts) : 0;
      if (la !== lb) return lb - la;
      return player(chanPartner(a)).n - player(chanPartner(b)).n;
    }).filter(function (ch) { return !filter || player(chanPartner(ch)).name.toLowerCase().indexOf(filter) >= 0; });
    if (ui.chatCh !== 'group' && chans.indexOf(ui.chatCh) < 0) ui.chatCh = 'group';

    function chanBtn(ch) {
      var last = lastBy[ch], u = unread(ch), isGroup = ch === 'group';
      var p = isGroup ? null : player(chanPartner(ch));
      var lastTxt = last ? (last.from === me ? 'You: ' : '') + last.text : (isGroup ? 'All ' + PLAYER_COUNT + ' players' : 'Start a private chat');
      return '<button class="chan" data-act="chan" data-ch="' + ch + '"' + (ui.chatCh === ch ? ' aria-current="true"' : '') + '>' +
        (isGroup ? '<span class="group-ico">' + icon('users') + '</span>' : avatar(p, 'sm')) +
        '<span style="min-width:0"><span class="chan-name" style="display:block">' + (isGroup ? 'Town square' : esc(p.name)) + '</span><span class="chan-last" style="display:block">' + esc(lastTxt) + '</span></span>' +
        (u ? '<span class="badge">' + u + '</span>' : (last ? '<span class="when muted" style="font-size:.7rem">' + ago(num(last.ts)) + '</span>' : '')) + '</button>';
    }

    var side = '<aside class="chat-side"><div class="chat-side-head">' +
      (me ? '<div class="muted" style="font-size:.8rem;font-weight:700;display:flex;flex-wrap:wrap;align-items:center;gap:4px">Chatting as <b style="color:var(--ink)">' + esc(player(me).name) + '</b> · <button class="btn ghost small" style="padding:0 4px" data-act="pick-me">' + icon('swap', 'sm') + 'Switch</button>' +
        '<button class="btn ghost small" style="padding:0 4px;margin-left:auto" data-act="toggle-sound" aria-pressed="' + alerts.sound + '" title="Play a sound for new messages">' + icon(alerts.sound ? 'bell' : 'bellOff', 'sm') + (alerts.sound ? 'Sound on' : 'Sound off') + '</button></div>' : '') +
      '<label class="sr-only" for="chat-filter">Find a player</label><input class="input" id="chat-filter" type="search" placeholder="Find a player…" value="' + esc(ui.chatFilter) + '" data-bind="chatFilter"></div>' +
      '<div class="chan-list" data-keep-scroll="chans">' + chanBtn('group') +
      (me ? '<div class="muted" style="font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:10px 8px 4px">Private chats</div>' + dms.map(chanBtn).join('') : '') + '</div></aside>';

    var main;
    if (!me) {
      main = '<section class="chat-main" style="grid-template-rows:1fr"><div class="empty" style="margin:20px;align-self:center">' + icon('chat', 'lg') +
        '<strong>Choose who you are to start chatting</strong><span>Pick your player slot so your messages show your name, and so private chats reach you.</span>' +
        '<button class="btn primary" data-act="pick-me">Choose my player</button></div></section>';
    } else {
      var isGroup = ui.chatCh === 'group';
      var partner = isGroup ? null : player(chanPartner(ui.chatCh));
      var msgs = chanMsgs(ui.chatCh), lastDay = '', items = '';
      msgs.forEach(function (m) {
        var dk = dayKey(num(m.ts));
        if (dk !== lastDay) { items += '<div class="day-sep">' + dayLabel(num(m.ts)) + '</div>'; lastDay = dk; }
        if (m.from === 'system') { items += '<div class="msg system"><div class="bubble">' + icon('trophy', 'sm c-gold') + ' ' + esc(m.text) + '</div></div>'; return; }
        var p = player(m.from), mine = m.from === me;
        items += '<div class="msg' + (mine ? ' mine' : '') + '">' + (mine ? '' : avatar(p, 'sm')) + '<div class="bubble">' +
          (isGroup && !mine ? '<div class="bubble-who">' + esc(p.name) + '</div>' : '') + esc(m.text) +
          '<span class="bubble-time">' + clock(num(m.ts)) + '</span></div></div>';
      });
      if (!msgs.length) items = '<div class="empty" style="margin:auto">' + (isGroup ? '<strong>No messages yet</strong><span>Say hello to your whole township.</span>' : '<strong>Private chat with ' + esc(partner.name) + '</strong><span>Only the two of you are in this conversation.</span>') + '</div>';
      var quick = isGroup ? ['Great job everyone! 🎉', 'Who can help with a Regatta task?', 'I need a few items, anyone spare?', 'Logged my tasks for today ✅', '👍']
        : ['Hi! 👋', 'Can you help me with an order?', 'Thanks so much!', 'Sending items now', '👍'];
      main = '<section class="chat-main"><div class="chat-head"><button class="close back" data-act="chat-back" aria-label="Back to conversations">' + icon('back') + '</button>' +
        (isGroup ? '<span class="group-ico">' + icon('users') + '</span>' : avatar(partner, 'sm')) +
        '<div style="min-width:0"><div class="chat-title">' + (isGroup ? 'Town square' : esc(partner.name)) + '</div><div class="chat-sub">' + (isGroup ? 'Group chat · all ' + PLAYER_COUNT + ' players' : 'Private chat') + '</div></div>' +
        (isGroup ? '' : '<button class="btn small" style="margin-left:auto" data-act="open-player" data-id="' + partner.id + '">Profile</button>') + '</div>' +
        '<div class="msgs" data-ch="' + esc(ui.chatCh) + '" aria-live="polite">' + items + '</div>' +
        '<form class="composer" data-form="chat"><div class="quick">' + quick.map(function (q) { return '<button type="button" data-act="quick" data-text="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' +
        '<div class="composer-row"><label class="sr-only" for="chat-input">Message</label><input class="input" id="chat-input" autocomplete="off" maxlength="500" placeholder="' + (isGroup ? 'Message the township…' : 'Message ' + esc(partner.name) + '…') + '"' + (canWrite() ? '' : ' disabled') + '>' +
        '<button class="btn primary" type="submit" aria-label="Send"' + (canWrite() ? '' : ' disabled') + '>' + icon('send') + '</button></div></form></section>';
    }
    return '<div class="view-head"><div><h2>Chat</h2><p>Talk with the whole township in the town square, or open a private chat with any player.</p></div></div>' +
      '<div class="chat' + (ui.chatOpen || !me ? ' has-open' : '') + '">' + side + main + '</div>';
  }

  // ---------------------------------------------------------------- modals
  function openModal(m) {
    ui.modal = m;
    if (m.kind === 'player') { ui.editColor = null; ui.adjTrophies = 0; ui.adjTasks = 0; }
    renderAll();
    setTimeout(function () { var f = document.querySelector('.modal [autofocus], .modal .close'); if (f) f.focus(); }, 0);
  }
  function closeModal() { ui.modal = null; renderAll(); }

  function renderModal() {
    var m = ui.modal;
    if (!m) return '';
    var inner = '';
    if (m.kind === 'me') {
      inner = '<div class="modal-head"><h3 id="modal-title">Who are you?</h3><button class="close" data-act="close-modal" aria-label="Close">' + icon('x') + '</button></div>' +
        '<p class="muted" style="margin:0">Pick your player slot. Your chats and messages use this name. This choice is remembered on this device.</p>' +
        '<div class="pick-grid">' + PIDS.map(function (id) {
          var p = player(id);
          return '<button class="pick" data-act="set-me" data-id="' + id + '"' + (me === id ? ' style="border-color:var(--accent);background:var(--accent-soft)"' : '') + '>' + avatar(p, 'sm') + '<span>' + esc(p.name) + '</span></button>';
        }).join('') + '</div>';
    } else if (m.kind === 'settings') {
      inner = '<div class="modal-head"><h3 id="modal-title">Township settings</h3><button class="close" data-act="close-modal" aria-label="Close">' + icon('x') + '</button></div>' +
        '<form class="form" data-form="town"><div class="field"><label for="town-name">Township name</label><input class="input" id="town-name" maxlength="40" value="' + esc(S.town.name) + '"' + (canWrite() ? '' : ' disabled') + '></div>' +
        '<div class="toolbar" style="justify-content:flex-end"><button class="btn primary" type="submit"' + (canWrite() ? '' : ' disabled') + '>Save name</button></div></form>' +
        '<div class="muted" style="font-size:.88rem">' + (mode === 'live' ? 'This township is shared: everyone with the link sees the same trophies, diamonds, tasks and chats, live.'
          : mode === 'local' ? 'This copy saves to this browser only, so other players don\'t see your changes.' : 'Connecting…') + '</div>' +
        '<div class="panel" style="display:grid;gap:10px"><b>New message alerts</b>' +
          '<span class="muted" style="font-size:.85rem">While this page is open, new messages to you show a count in the browser tab' + (me ? '' : ' (choose who you are first)') + '.</span>' +
          '<div class="toolbar"><button class="chip" data-act="toggle-sound" aria-pressed="' + alerts.sound + '">' + icon(alerts.sound ? 'bell' : 'bellOff', 'sm') + 'Sound ' + (alerts.sound ? 'on' : 'off') + '</button>' +
          (popupState() === 'unsupported' ? '' : popupState() === 'blocked'
            ? '<span class="muted" style="font-size:.85rem">Pop-ups are blocked for this site in your browser settings.</span>'
            : '<button class="chip" data-act="toggle-popup" aria-pressed="' + (popupState() === 'on') + '">Pop-ups on this computer ' + (popupState() === 'on' ? 'on' : 'off') + '</button>') +
          '</div></div>' +
        (mode === 'local' ? '<div class="panel" style="display:grid;gap:10px"><b>Data on this device</b>' +
          '<div class="toolbar"><button class="btn danger" data-act="reset-blank">Start fresh (clear everything)</button><button class="btn" data-act="load-demo">Load example data</button></div></div>' : '');
    } else if (m.kind === 'confirm-reset') {
      inner = '<div class="modal-head"><h3 id="modal-title">Start fresh?</h3><button class="close" data-act="close-modal" aria-label="Close">' + icon('x') + '</button></div>' +
        '<p style="margin:0">This clears every player name, task, trophy, diamond and chat message saved on this device. It can\'t be undone.</p>' +
        '<div class="toolbar" style="justify-content:flex-end"><button class="btn" data-act="close-modal">Keep my data</button><button class="btn primary" data-act="confirm-reset" style="background:var(--danger);border-color:var(--danger)">Clear and start fresh</button></div>';
    } else if (m.kind === 'player') {
      var s = stats().by[m.id], p = player(m.id), color = ui.editColor || p.color;
      var types = TASK_TYPES.filter(function (t) { return s.byType[t.id]; });
      var recent = sortedActivity().filter(function (a) { return a.pid === m.id; }).slice(0, 5);
      inner = '<div class="modal-head">' + avatar({ name: p.name, color: color }, 'lg') + '<h3 id="modal-title">' + esc(p.name) + (m.id === me ? ' <span class="you-tag">YOU</span>' : '') +
        '<span class="muted" style="display:block;font-family:var(--font-body);font-size:.85rem;font-weight:700">Rank #' + s.rank + ' of ' + PLAYER_COUNT + ' · Slot ' + p.n + '</span></h3>' +
        '<button class="close" data-act="close-modal" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="pcard-stats"><span class="mini"><span class="c-gold">' + icon('trophy', 'sm') + 'Trophies</span><b>' + fmt(s.trophies) + '</b></span>' +
        '<span class="mini"><span class="c-diamond">' + icon('diamond', 'sm') + 'Diamonds</span><b>' + fmt(s.diamonds) + '</b></span>' +
        '<span class="mini"><span class="c-task">' + icon('task', 'sm') + 'Tasks</span><b>' + fmt(s.tasks) + '</b></span></div>' +
        '<div class="toolbar"><button class="btn primary" data-act="log-for" data-id="' + m.id + '">' + icon('plus') + 'Log task</button>' +
        (me && me !== m.id ? '<button class="btn" data-act="dm" data-id="' + m.id + '">' + icon('chat') + 'Message</button>' : '') +
        (!me ? '<button class="btn" data-act="set-me" data-id="' + m.id + '">This is me</button>' : '') + '</div>' +
        (types.length ? '<div><b style="font-size:.9rem">Tasks by type</b><div class="chips" style="margin-top:6px">' + types.map(function (t) { return '<span class="chip">' + esc(t.label) + ' · ' + fmt(s.byType[t.id]) + '</span>'; }).join('') + '</div></div>' : '') +
        (recent.length ? '<div><b style="font-size:.9rem">Recent tasks</b>' + feedItems(recent, {}) + '</div>' : '') +
        (canWrite() ? '<form class="form panel" data-form="player" data-id="' + m.id + '" style="background:var(--surface-2)"><b>Edit player</b>' +
          '<div class="field"><label for="player-name">Name</label><input class="input" id="player-name" maxlength="32" value="' + esc(p.name) + '"></div>' +
          '<div class="field"><span style="font-size:.8rem;font-weight:800;color:var(--muted)">Color</span><div class="swatches">' + COLORS.map(function (c) {
            return '<button type="button" class="swatch" data-act="swatch" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '" aria-pressed="' + (c === color) + '"></button>';
          }).join('') + '</div></div>' +
          '<div class="toolbar" style="justify-content:flex-end"><button class="btn primary" type="submit">Save player</button></div></form>' +
          '<form class="form panel" data-form="adjust" data-id="' + m.id + '"><b>Correct totals</b><span class="muted" style="font-size:.85rem">Fix a mistake by adding or removing trophies or tasks. Diamonds follow trophies.</span>' +
          '<div class="field-row"><div class="field"><label for="adj-trophies">Trophies (+/−)</label><input class="input num" id="adj-trophies" type="number" inputmode="numeric" value="0" step="1"></div>' +
          '<div class="field"><label for="adj-tasks">Tasks (+/−)</label><input class="input num" id="adj-tasks" type="number" inputmode="numeric" value="0" step="1"></div></div>' +
          '<div class="toolbar" style="justify-content:flex-end"><button class="btn" type="submit">Apply correction</button></div></form>' : '');
    }
    return '<div class="modal-back" data-act="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' + inner + '</div></div>';
  }

  // ---------------------------------------------------------------- message alerts
  // A chime, a line at the bottom of the page and, on computers that allow it, a
  // pop-up from the browser when a new message reaches you. Works while the page is open.
  var seenMsgs = null, audioCtx = null;
  function unlockAudio() {
    if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {}); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioCtx = new AC(); } catch (e) { audioCtx = null; }
  }
  function chime() {
    if (!alerts.sound || !audioCtx) return;
    try {
      var t = audioCtx.currentTime;
      [[880, 0], [1320, 0.12]].forEach(function (n) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.18, t + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.35);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t + n[1]); o.stop(t + n[1] + 0.4);
      });
    } catch (e) { /* sound unavailable */ }
  }
  function popupSupported() {
    return 'Notification' in window && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function popupState() {
    if (!popupSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return alerts.popup && Notification.permission === 'granted' ? 'on' : 'off';
  }
  function systemNotify(title, body) {
    if (popupState() !== 'on') return;
    try {
      var n = new Notification(title, { body: body, tag: 'township-chat' });
      n.onclick = function () { window.focus(); if (location.hash !== '#chat') location.hash = 'chat'; n.close(); };
    } catch (e) { /* this browser only allows pop-ups from installed apps */ }
  }
  function isMyChannel(ch) {
    if (ch === 'group') return true;
    return !!me && ch.indexOf('dm-') === 0 && ch.slice(3).split('-').indexOf(me) >= 0;
  }
  function checkNewMessages() {
    if (mode === 'connecting' || !store) return;
    if (!seenMsgs) { seenMsgs = {}; S.messages.forEach(function (m) { seenMsgs[m.id] = 1; }); return; }
    var fresh = S.messages.filter(function (m) { return !seenMsgs[m.id]; });
    fresh.forEach(function (m) { seenMsgs[m.id] = 1; });
    if (!me) return;
    var viewing = ui.view === 'chat' && ui.chatOpen && document.visibilityState === 'visible';
    var incoming = fresh.filter(function (m) {
      return m.from !== me && isMyChannel(m.ch) && !(viewing && m.ch === ui.chatCh);
    });
    if (!incoming.length) return;
    var last = incoming[incoming.length - 1];
    var who = last.from === 'system' ? S.town.name : player(last.from).name;
    var where = last.ch === 'group' ? 'Town square' : 'private chat';
    var text = String(last.text || '');
    if (text.length > 70) text = text.slice(0, 67) + '…';
    chime();
    if (document.visibilityState === 'visible') toast(who + ' (' + where + '): ' + text, 'msg');
    else systemNotify(who + ' · ' + (last.ch === 'group' ? 'Town square' : 'Private message'), text);
  }

  // ---------------------------------------------------------------- toasts + confetti
  function toast(text, kind) {
    var box = document.getElementById('toasts'); if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { el.remove(); }, 3800);
  }

  var confettiParts = [], confettiRunning = false;
  function burst(n) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = document.getElementById('confetti'); if (!c) return;
    var w = c.width = window.innerWidth, h = c.height = window.innerHeight;
    var cols = ['#d4a017', '#4d86e0', '#2e8b57', '#d9603b', '#9b59b6'];
    for (var i = 0; i < n; i++) {
      confettiParts.push({ x: w / 2 + (Math.random() - .5) * 120, y: h * .35, vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4,
        r: Math.random() * 6 + 4, c: cols[i % cols.length], a: Math.random() * 6, va: (Math.random() - .5) * .4, life: 90 + Math.random() * 50, diamond: i % 3 === 0 });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(tick); }
    function tick() {
      var ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
      confettiParts = confettiParts.filter(function (p) { return p.life > 0; });
      confettiParts.forEach(function (p) {
        p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.a += p.va; p.life--;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.fillStyle = p.c;
        if (p.diamond) { ctx.beginPath(); ctx.moveTo(0, -p.r); ctx.lineTo(p.r * .7, 0); ctx.lineTo(0, p.r); ctx.lineTo(-p.r * .7, 0); ctx.closePath(); ctx.fill(); }
        else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      });
      if (confettiParts.length) requestAnimationFrame(tick); else { confettiRunning = false; ctx.clearRect(0, 0, c.width, c.height); }
    }
  }

  // ---------------------------------------------------------------- events
  function route() {
    var h = (location.hash || '').replace('#', '');
    var v = VIEWS.some(function (x) { return x.id === h; }) ? h : 'town';
    if (v !== ui.view) { ui.view = v; window.scrollTo(0, 0); }
    if (v !== 'chat') ui.chatOpen = false;
    scheduleRender();
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (act === 'backdrop') { if (e.target === el) closeModal(); return; }
    switch (act) {
      case 'pick-me': openModal({ kind: 'me' }); break;
      case 'set-me':
        me = id; lsSet(ME_KEY, id); ui.chatCh = 'group';
        toast('You\'re playing as ' + player(id).name + '.');
        ui.modal = null; changed(); break;
      case 'open-settings': openModal({ kind: 'settings' }); break;
      case 'close-modal': closeModal(); break;
      case 'open-player': openModal({ kind: 'player', id: id }); break;
      case 'log-for': ui.logPlayer = id; ui.modal = null; if (location.hash !== '#tasks') location.hash = 'tasks'; else renderAll(); break;
      case 'dm': ui.chatCh = dmId(me, id); ui.chatOpen = true; ui.modal = null; if (location.hash !== '#chat') location.hash = 'chat'; else renderAll(); break;
      case 'chan':
        var nextCh = el.getAttribute('data-ch');
        if (nextCh !== ui.chatCh) { var ci = document.getElementById('chat-input'); if (ci) ci.value = ''; }
        ui.chatCh = nextCh; ui.chatOpen = true; markRead(ui.chatCh);
        if (ui.view !== 'chat') { location.hash = 'chat'; } else renderAll();
        setTimeout(function () { var i = document.getElementById('chat-input'); if (i && window.innerWidth > 760) i.focus(); }, 0);
        break;
      case 'chat-back': ui.chatOpen = false; renderAll(); break;
      case 'quick': {
        var input = document.getElementById('chat-input');
        if (input) { var t = el.getAttribute('data-text'); input.value = input.value ? input.value.replace(/\s*$/, ' ') + t : t; input.focus(); }
        break;
      }
      case 'log-type': {
        ui.logType = el.getAttribute('data-type');
        ui.logTrophies = (TYPE_BY_ID[ui.logType] || TYPE_BY_ID.other).trophies;
        renderAll(); break;
      }
      case 'step': {
        var f = el.getAttribute('data-field'), d = Number(el.getAttribute('data-delta'));
        ui[f] = clamp(num(ui[f]) + d, f === 'logCount' ? 1 : 0, f === 'logCount' ? 99 : 9999);
        renderAll(); break;
      }
      case 'del-activity': {
        if (!canWrite()) break;
        var a = S.activity.filter(function (x) { return x.id === id; })[0];
        store.removeActivity(id).then(function () { if (a) toast('Removed ' + player(a.pid).name + '\'s entry.'); }).catch(function () {});
        break;
      }
      case 'player-sort': ui.playerSort = el.getAttribute('data-key'); renderAll(); break;
      case 'player-layout': ui.playerLayout = el.getAttribute('data-layout'); renderAll(); break;
      case 'range': ui.range = Number(el.getAttribute('data-range')); renderAll(); break;
      case 'set-rate': {
        var r = Number(el.getAttribute('data-rate'));
        if (!canWrite() || r === rate()) break;
        store.setTown(Object.assign({}, S.town, { rate: r })).then(function () { toast('Exchange rate set: 1 trophy = ' + r + ' diamond' + (r === 1 ? '' : 's') + '.'); }).catch(function () {});
        break;
      }
      case 'swatch': ui.editColor = el.getAttribute('data-color'); renderAll(); break;
      case 'toggle-sound':
        alerts.sound = !alerts.sound; saveAlerts(); unlockAudio(); if (alerts.sound) chime();
        renderAll(); break;
      case 'toggle-popup':
        if (popupState() === 'on') { alerts.popup = false; saveAlerts(); renderAll(); break; }
        try {
          Promise.resolve(Notification.requestPermission()).then(function (perm) {
            alerts.popup = perm === 'granted'; saveAlerts();
            toast(perm === 'granted' ? 'Pop-ups are on. You\'ll see one when a message arrives while this tab is in the background.' : 'Your browser didn\'t allow pop-ups for this site.');
            renderAll();
          }).catch(function () { toast('Your browser didn\'t allow pop-ups for this site.'); });
        } catch (e) { toast('Your browser didn\'t allow pop-ups for this site.'); }
        break;
      case 'reset-blank': openModal({ kind: 'confirm-reset' }); break;
      case 'confirm-reset': if (store && store.reset) { store.reset(false); me = null; lsSet(ME_KEY, ''); lastRead = {}; lsSet(READ_KEY, '{}'); } ui.modal = null; toast('Fresh start. Rename your 20 players from the Players tab.'); renderAll(); break;
      case 'load-demo': if (store && store.reset) store.reset(true); ui.modal = null; renderAll(); break;
    }
  }

  function onSubmit(e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute('data-form');
    if (kind === 'log') {
      var pid = document.getElementById('log-player').value;
      var tr = clamp(Math.round(num(document.getElementById('log-trophies').value)), 0, 9999);
      var ct = clamp(Math.round(num(document.getElementById('log-count').value)), 1, 99);
      ui.logPlayer = pid; ui.logTrophies = tr; ui.logCount = ct;
      logTask(pid, ui.logType, tr * ct, ct);
    } else if (kind === 'chat') {
      var input = document.getElementById('chat-input');
      sendMessage(input ? input.value : '');
    } else if (kind === 'town') {
      if (!canWrite()) return;
      var name = document.getElementById('town-name').value.trim().slice(0, 40) || DEFAULT_TOWN.name;
      store.setTown(Object.assign({}, S.town, { name: name })).then(function () { toast('Township renamed to ' + name + '.'); closeModal(); }).catch(function () {});
    } else if (kind === 'player') {
      var id = form.getAttribute('data-id');
      var nm = document.getElementById('player-name').value.trim().slice(0, 32);
      var cur = player(id);
      var data = { name: nm || ('Player ' + cur.n), color: ui.editColor || cur.color };
      store.setPlayer(id, data).then(function () { toast('Saved ' + data.name + '.'); ui.editColor = null; }).catch(function () {});
    } else if (kind === 'adjust') {
      var pid2 = form.getAttribute('data-id');
      var dt = Math.round(num(document.getElementById('adj-trophies').value));
      var dk = Math.round(num(document.getElementById('adj-tasks').value));
      if (!dt && !dk) { toast('Enter a number above or below zero to correct a total.'); return; }
      var s = stats().by[pid2];
      dt = Math.max(dt, -s.trophies); dk = Math.max(dk, -s.tasks);
      logTask(pid2, 'adjust', dt, dk);
      document.getElementById('adj-trophies').value = '0';
      document.getElementById('adj-tasks').value = '0';
    }
  }

  function onInput(e) {
    var el = e.target, bind = el.getAttribute && el.getAttribute('data-bind');
    if (!bind) return;
    if (bind === 'logTrophies' || bind === 'logCount') {
      ui[bind] = clamp(Math.round(num(el.value)), bind === 'logCount' ? 1 : 0, bind === 'logCount' ? 99 : 9999);
      var summary = el.closest('form'); if (summary) scheduleRender();
    } else {
      ui[bind] = el.value;
      scheduleRender();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape' && ui.modal) closeModal();
  }

  // tooltips for charts
  var tipEl = null;
  function onOver(e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    var chart = t && t.closest('.chart');
    if (!t || !chart) { if (tipEl) { tipEl.remove(); tipEl = null; } return; }
    if (!tipEl || tipEl.parentNode !== chart) { if (tipEl) tipEl.remove(); tipEl = document.createElement('div'); tipEl.className = 'tooltip'; chart.appendChild(tipEl); }
    tipEl.textContent = t.getAttribute('data-tip');
    var cr = chart.getBoundingClientRect(), tr = t.getBoundingClientRect();
    var bar = t.nextElementSibling && t.nextElementSibling.classList.contains('bar') ? t.nextElementSibling.getBoundingClientRect() : null;
    var x = tr.left + tr.width / 2 - cr.left;
    var y = (bar ? bar.top : tr.bottom - 10) - cr.top;
    tipEl.style.left = clamp(x, 60, cr.width - 60) + 'px';
    tipEl.style.top = Math.max(30, y) + 'px';
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    var root = document.getElementById('app');
    if (!root) { root = document.createElement('div'); root.id = 'app'; document.body.appendChild(root); }
    buildShell(root);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') scheduleRender(); });
    window.addEventListener('hashchange', route);
    setInterval(scheduleRender, 60000); // keep "5m ago" labels fresh
    route();

    var claude = window.claude;
    if (claude && typeof claude.use === 'function') {
      mode = 'connecting';
      renderAll();
      var settled = false;
      var fallback = function () {
        if (settled) return; settled = true;
        mode = 'local'; store = localStore; localStore.init();
      };
      claude.use('db').then(function (db) {
        if (settled) return;
        if (!db) { fallback(); return; }
        settled = true; store = makeDbStore(db); store.init();
      }).catch(fallback);
      setTimeout(fallback, 12000);
    } else if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) {
      mode = 'connecting';
      store = makeFirebaseStore(window.FIREBASE_CONFIG);
      renderAll();
      store.init();
    } else {
      store = localStore; localStore.init();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
