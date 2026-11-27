/* 測試模式：出勤在瀏覽器裡模擬（規則和正式版共用 att-core.js），不會寫入正式資料。
 * opts：people() 回傳人員（含 id、role）；cal(year)；me(token) 回傳目前登入的人；notify(toId, text) 測試通知；
 * persistKey：有給的話，測試資料存在這台電腦的瀏覽器裡（重新整理不會不見，換身分也看得到同一份）。 */
var ATT_MOCK = function (opts) {
  var DB = { Punches: [], Requests: [], CalOverrides: [], seq: 0 };
  try {
    var saved = opts.persistKey && JSON.parse(localStorage.getItem(opts.persistKey) || 'null');
    if (saved && saved.Punches) DB = saved;
  } catch (e) { }
  function persist() { if (opts.persistKey) try { localStorage.setItem(opts.persistKey, JSON.stringify(DB)); } catch (e) { } }
  var seq = DB.seq || 0;
  var FILES = {};
  var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
  var store = {
    all: function (t) { return DB[t].map(copy); },
    insert: function (t, o) { DB[t].push(copy(o)); DB.seq = seq; persist(); },
    update: function (t, o) { DB[t] = DB[t].map(function (x) { return x.id === o.id ? copy(o) : x; }); DB.seq = seq; persist(); }
  };
  // 「模擬時間」：測試列可以指定現在是幾點，方便測遲到、早退、缺卡
  function now() {
    var el = document.getElementById('simNow');
    var d;
    if (el && el.value) {
      var v = el.value; // yyyy-MM-ddTHH:mm
      return { date: v.slice(0, 10), time: v.slice(11, 16) + ':00', stamp: v.slice(0, 16) + ':00' };
    }
    d = new Date();
    var t = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var date = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    var time = p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
    return { date: date, time: time, stamp: date + 'T' + time };
  }
  var calMemo = {};
  var svc = ATT.service(store, {
    now: now,
    people: opts.people,
    // 測試資料從第一筆打卡那天開始判斷（之前的日子不會一片「異常」）
    startDate: function () {
      var ds = DB.Punches.map(function (p) { return p.date; }).sort();
      return ds[0] || now().date;
    },
    cal: function (y) {
      var base = opts.cal(y) || { days: {}, overrides: [] };
      return { days: base.days || {}, overrides: (base.overrides || []).concat(DB.CalOverrides.filter(function (o) { return o.date.slice(0, 4) === String(y) && !o.voided; })) };
    },
    audit: function () { },
    canExport: function (m) { return m.role === 'manager' || m.dept === '行政'; },
    adjust: function (id, y, k) { return ((DB.Adj || {})[id] || {})[y] && DB.Adj[id][y][k] || 0; },
    notify: function (toId, text) { if (opts.notify) opts.notify(toId, text); },
    uid: function () { return 'm' + (++seq) + Date.now().toString(36); }
  });
  function me(d) { var m = opts.me(d.token); if (!m) { var e = new Error('登入已失效，請重新登入'); e.auth = true; throw e; } return m; }
  function calView(y) {
    var c = svc && opts.cal(y) || { days: {}, overrides: [] };
    return { year: y, days: c.days || {}, overrides: (c.overrides || []).concat(DB.CalOverrides.filter(function (o) { return o.date.slice(0, 4) === y && !o.voided; })), sheetUrl: '' };
  }
  return {
    service: svc,
    handlers: {
      attToday: function (d) { return svc.today(me(d)); },
      attPunch: function (d) { return svc.punch(me(d), d.kind, !!d.overwrite); },
      attMonth: function (d) {
        var m = me(d);
        var r = String(d.staffId) === 'all' ? svc.monthAll(m, String(d.ym || '')) : svc.month(m, String(d.ym || ''), String(d.staffId || ''));
        r.people = svc.people(m);
        return r;
      },
      attBalances: function (d) {
        if (d.staffId) return svc.balancesFor(me(d), String(d.staffId), String(d.year || ''));
        return { balances: svc.balances(me(d), String(d.year || '')), types: svc.leaveTypes() };
      },
      // 測試附件：只存在這個分頁的記憶體裡
      attUpload: function (d) {
        me(d);
        var id = 'f' + (++seq) + Date.now().toString(36);
        FILES[id] = { name: d.name, mime: d.mimeType, base64: d.base64 };
        return { id: id, name: d.name, mime: d.mimeType };
      },
      attFile: function (d) {
        svc.reqById(me(d), String(d.id || ''));
        var f = FILES[d.fileId];
        if (!f) throw new Error('測試附件只在上傳的那個分頁看得到');
        return f;
      },
      attSaveFix: function (d) { return svc.saveFix(me(d), String(d.id || ''), d.data || {}); },
      attSaveLeave: function (d) { return svc.saveLeave(me(d), String(d.id || ''), d.data || {}); },
      attSaveOt: function (d) { return svc.saveOt(me(d), String(d.id || ''), d.data || {}); },
      attReq: function (d) { return svc.reqById(me(d), String(d.id || '')); },
      attTodos: function (d) { return svc.todos(me(d)); },
      attAdjust: function (d) {
        var id = String(d.staffId || ''), y = String(d.year || now().date.slice(0, 4));
        DB.Adj = DB.Adj || {}; DB.Adj[id] = DB.Adj[id] || {}; DB.Adj[id][y] = DB.Adj[id][y] || {};
        var adj = d.adj || {};
        ['annual', 'comp'].forEach(function (k) { if (d[k] !== undefined && d[k] !== '') adj[k] = d[k]; });
        Object.keys(adj).forEach(function (k) { var v = Math.round(Number(adj[k]) || 0); if (v) DB.Adj[id][y][k] = v; else delete DB.Adj[id][y][k]; });
        persist();
        return DB.Adj[id][y];
      },
      attCancel: function (d) { return svc.cancel(me(d), String(d.id || '')); },
      attMyReqs: function (d) { return svc.myRequests(me(d)); },
      attReview: function (d) { return svc.review(me(d)); },
      attDecide: function (d) { return svc.decide(me(d), String(d.id || ''), !!d.approve, d.note); },
      attCalendar: function (d) { return calView(String(d.year || now().date.slice(0, 4))); },
      attCalSave: function (d) {
        var o = d.override || {};
        DB.CalOverrides.forEach(function (x) { if (x.date === o.date && x.region === o.region) x.voided = true; });
        DB.CalOverrides.push({ id: 'c' + (++seq), date: o.date, region: o.region, off: !!o.off, note: o.note });
        DB.seq = seq; persist();
        return calView(String(d.year));
      },
      attCalRemove: function (d) { DB.CalOverrides.forEach(function (x) { if (x.id === d.id) x.voided = true; }); persist(); return calView(String(d.year)); },
      attCalRefresh: function (d) { return calView(String(d.year)); }
    },
    home: function (token) {
      var m = opts.me(token);
      if (!m) return { att: null, pendingAtt: 0, todos: [], review: [], mine: [] };
      var rv = svc.review(m).todo;
      return {
        att: svc.today(m), pendingAtt: rv.length,
        review: rv.map(function (r) { return { kind: 'att', id: r.id, title: r.staff + '・' + r.title }; }),
        todos: svc.todos(m),
        mine: svc.myRequests(m).slice(0, 5).map(function (r) { return { id: r.id, title: r.label || r.title, status: r.status, mode: r.mode }; })
      };
    }
  };
};
