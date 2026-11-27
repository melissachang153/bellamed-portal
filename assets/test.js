/* 測試頁：攔截所有 API，改在瀏覽器裡模擬。
 * 起點是正式資料（活動、報名、修正申請、參加紀錄），之後的操作只存在這個分頁，重新整理就回到真實狀態。
 * 唯一會連到後端的寫入動作是「（測試）」LINE 通知，不會改到任何資料。 */
(function () {
  var ADMIN = window.TEST_ADMIN_TOKEN;
  var $ = function (s) { return document.querySelector(s); };
  var PW = 'test';

  $('#testReset').onclick = async function () {
    if (!await BM.ask('要清空所有測試資料嗎？\n測試的打卡、申請單和登入身分都會清除，正式資料不受影響。', { ok: '清空', danger: true })) return;
    window.TEST_CLEAR();
    location.reload();
  };
  $('#testBack').onclick = function () { location.href = 'index.html#/settings'; };
  if ($('#simFirst')) $('#simFirst').onchange = function () { this.parentElement.classList.toggle('on', this.checked); };

  if (!ADMIN) {
    document.addEventListener('DOMContentLoaded', function () {
      $('#loginView').innerHTML = '<main><div class="card login"><h2>需要管理員登入</h2>' +
        '<p>測試頁只有管理員能使用。請先用管理員帳號登入，再從管理頁按「測試頁」。</p>' +
        '<div class="btn-row"><a class="btn block" href="index.html">前往登入</a></div></div></main>';
    });
    BM.mock = function () { return Promise.reject(new Error('請先用管理員帳號登入')); };
    return;
  }

  // ---------- 讀取正式資料（只讀） ----------
  var DATA = null, REC = {};
  var NEWS = [{ id: "n1", title: "（測試）年終尾牙報名開始", body: "這是測試模式的範例公告。", pinned: true, files: [], status: "published", publishedAt: new Date().toISOString().slice(0, 19), createdAt: "" }];
  var ready = BM.realApi('testData', { token: ADMIN }).then(function (d) { DATA = d; }).catch(function (e) {
    var err = new Error(e.auth ? '管理員登入已失效，請回管理頁重新登入' : '讀取正式資料失敗：' + e.message);
    throw err;
  });

  function fail(msg) { return Promise.reject(new Error(msg)); }
  function authFail() { var e = new Error('登入已失效，請重新登入'); e.auth = true; return Promise.reject(e); }
  function wait() { return new Promise(function (r) { setTimeout(r, 150); }); }
  function today() { return BM.today(); }
  function sess(s) { return s === 'AM' ? '上午' : '下午'; }

  function staffByEn(en) {
    en = String(en || '').trim().toLowerCase();
    return DATA.staff.filter(function (s) { return s.en.toLowerCase() === en; })[0];
  }
  function canSee(s, page) {
    var p = DATA.perms[s.role === 'manager' ? 'manager' : 'staff'];
    if (!p[page]) return false;
    return true;
  }
  function meView(s) {
    var pages = {};
    ['events', 'records', 'corrections'].forEach(function (k) { pages[k] = canSee(s, k); });
    return { name: s.en, region: s.region, admin: false, role: s.role, counted: s.counted, pages: pages, avatar: s.avatar || '' };
  }
  function userFrom(token) {
    var m = String(token || '').match(/^t:(.+)$/);
    return m ? staffByEn(m[1]) : null;
  }
  // 「（測試）」LINE 通知：送不出去也不影響測試流程
  function notify(kind, text) {
    BM.realApi('testNotify', { token: ADMIN, kind: kind, text: text })
      .then(function () { BM.toast('（測試）已通知管理員 LINE'); })
      .catch(function (e) { BM.toast('（測試）LINE 通知沒送出：' + e.message, true); });
  }

  function eventsFor(s) {
    return DATA.events.map(function (e) {
      var v = JSON.parse(JSON.stringify(e));
      v.mine = e.registrants.filter(function (r) { return r.en === s.en; }).map(function (r) { return r.date + '|' + r.session; });
      v.registrants = e.registrants.map(function (r) { return { name: r.en, date: r.date, session: r.session }; });
      var set = {};
      e.registrants.forEach(function (r) { set[r.en] = true; });
      v.peopleCount = Object.keys(set).length;
      return v;
    });
  }
  function summary(type, d, s, rd, rs) {
    var f = function (dd, ss) { return dd.slice(5).replace('-', '/') + ' ' + sess(ss); };
    if (type === 'add') return '補登 ' + f(d, s);
    if (type === 'remove') return '移除 ' + f(d, s);
    return '修正：補登 ' + f(d, s) + '，移除 ' + f(rd, rs);
  }
  // 測試頁送出的修正申請（已生效）：套用到正式紀錄的快照上，畫面才會跟正式版一樣
  var OPS = [];
  function applyOpsToRecords(rec) {
    var t = today();
    OPS.forEach(function (o) {
      if (o.date.slice(0, 4) !== String(rec.year)) return;
      if (o.ev.dates[o.ev.dates.length - 1] >= t) return; // 正式版：活動結束隔天才計入
      var p = rec.people.filter(function (x) { return x.name === o.en; })[0];
      if (!p) return;
      var it = p.items.filter(function (i) { return i.date === o.date && i.name === o.ev.name; })[0];
      var has = !!(it && it.sessions.indexOf(o.session) >= 0);
      if (o.on && !has) {
        if (!it) { it = { date: o.date, name: o.ev.name, sessions: [], count: 0 }; p.items.push(it); }
        it.sessions.push(o.session);
        it.sessions.sort();
        p.total += 0.5;
      } else if (!o.on && has) {
        it.sessions = it.sessions.filter(function (x) { return x !== o.session; });
        if (!it.sessions.length) p.items = p.items.filter(function (x) { return x !== it; });
        p.total -= 0.5;
      }
      if (it) it.count = it.sessions.length * 0.5;
      p.items.sort(function (a, b) { return a.date.localeCompare(b.date); });
    });
  }

  function myCorr(s) {
    return DATA.corrections.filter(function (c) { return c.en === s.en; }).map(function (c) {
      return { eventName: c.eventName, summary: c.summary, reason: c.reason, status: c.status, createdAt: c.createdAt };
    }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  }

  // ---------- 公告已讀、申訴與通報（只存在這個分頁） ----------
  // 存在這台電腦的瀏覽器（換身分會重新整理，資料要留著才能測「申訴人送出 → HR 受理」）；「重設測試資料」會清掉
  var CASE_KEY = 'bellamed.test.casedb';
  var CDB = (function () { try { return JSON.parse(localStorage.getItem(CASE_KEY) || 'null') || {}; } catch (e) { return {}; } })();
  var READS = CDB.reads || {}, CASES = CDB.cases || [], CASE_FILES = {}, caseSeq = CDB.seq || 0;
  function saveCases() { try { localStorage.setItem(CASE_KEY, JSON.stringify({ reads: READS, cases: CASES, seq: caseSeq })); } catch (e) { } }
  var CASE_ST = { submitted: '待受理', accepted: '調查中', rejected: '不受理', decided: '已決定', appealed: '申復中', received: '處理中', closed: '已結案' };
  function attPeople() { return (DATA.att && DATA.att.people) || []; }
  function receiverEn(to) {
    if (to === 'gm') return 'Andy';
    var a = attPeople().filter(function (p) { return p.role === 'admin'; })[0];
    return a ? a.en : 'Melissa';
  }
  function caseRole(c, s) { return receiverEn(c.to).toLowerCase() === s.en.toLowerCase() ? 'receiver' : c.en === s.en ? 'applicant' : ''; }
  function caseTitle(c) { return c.kind === 'notice' ? '知悉通報 ' + c.no : ({ bully: '職場霸凌', harass: '職場性騷擾' }[c.data.type] || '申訴') + ' ' + c.no; }
  function md5(t) { return String(t || '').slice(5, 10).replace('-', '/'); }
  function caseSteps(c) {
    var h = function (a) { return c.history.filter(function (x) { return x.act === a; })[0]; };
    var rn = receiverEn(c.to), st = function (x, cur) { return x ? 'done' : cur ? 'cur' : 'todo'; };
    if (c.kind === 'notice') {
      var rv = h('receive'), cl = h('close');
      return [{ date: md5(c.createdAt), who: c.en, act: '通報', state: 'done' }, { date: rv ? md5(rv.t) : '', who: rn, act: '收件', state: st(rv, c.status === 'submitted') },
        { date: cl ? md5(cl.t) : '', who: '', act: '結案', state: st(cl, c.status === 'received') }];
    }
    var acc = h('accept'), rej = h('reject'), dec = h('decide'), app = h('appeal'), appd = h('appealDecide'), clo = h('close');
    var out = [{ date: md5(c.createdAt), who: c.en, act: '申訴', state: 'done' }];
    if (rej) return out.concat([{ date: md5(rej.t), who: rn, act: '不受理', state: 'bad' }]);
    return out.concat([
      { date: acc ? md5(acc.t) : '', who: rn, act: '受理', state: st(acc, c.status === 'submitted') },
      { date: '', who: rn, act: '調查', state: dec ? 'done' : c.status === 'accepted' ? 'cur' : 'todo' },
      { date: dec ? md5(dec.t) : '', who: rn, act: '決定', state: dec ? 'done' : 'todo' },
      { date: app ? md5(app.t) : '', who: c.en, act: '申復', state: app ? (appd ? 'done' : 'cur') : 'todo', opt: !app },
      { date: clo || appd ? md5((clo || appd).t) : '', who: '', act: '結案', state: c.status === 'closed' ? 'done' : 'todo' }]);
  }
  function caseSum(c, role) {
    return { id: c.id, no: c.no, kind: c.kind, title: caseTitle(c), status: c.status, statusLabel: CASE_ST[c.status], createdAt: c.createdAt, steps: caseSteps(c), role: role, applicant: role === 'receiver' ? c.en : '' };
  }
  function stamp() { return new Date(Date.now() + 480 * 60000).toISOString().slice(0, 19); } // 台北時間
  var CASE_H = {
    caseList: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var mine = [], todo = [];
      CASES.forEach(function (c) { var r = caseRole(c, s); if (r === 'receiver') todo.push(caseSum(c, r)); else if (r) mine.push(caseSum(c, r)); });
      return { mine: mine.reverse(), todo: todo.reverse(), canNotice: s.role === 'manager' || s.role === 'admin', gm: 'Andy' };
    },
    caseGet: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var c = CASES.filter(function (x) { return x.id === d.id; })[0], role = c && caseRole(c, s);
      if (!role) return fail('找不到這個案件');
      var v = caseSum(c, role);
      v.to = c.to; v.data = c.data; v.decision = c.decision || '';
      var plus = function (days) { return new Date(Date.parse(c.createdAt.slice(0, 10)) + days * 86400000).toISOString().slice(0, 10).replace(/-/g, '/'); };
      v.deadlines = role === 'receiver' && c.kind === 'complaint' ? { accept: plus(14), decide: plus(91) } : {};
      v.history = c.history.filter(function (h) { return role === 'receiver' || h.act !== 'memo'; });
      var dec = c.history.filter(function (h) { return h.act === 'decide'; })[0];
      v.canAppeal = role === 'applicant' && c.kind === 'complaint' && c.status === 'decided' && !!dec;
      v.appealUntil = dec ? new Date(Date.parse(dec.t.slice(0, 10)) + 30 * 86400000).toISOString().slice(0, 10) : '';
      return v;
    },
    caseSubmit: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var kind = d.kind === 'notice' ? 'notice' : 'complaint', to = d.to === 'gm' ? 'gm' : 'hr';
      if (receiverEn(to).toLowerCase() === s.en.toLowerCase()) return fail('受理人不能是自己，請改選另一位');
      var prefix = kind === 'notice' ? 'KN' : d.data.type === 'harass' ? 'SH' : 'BL';
      var n = CASES.filter(function (c) { return c.no.indexOf(prefix) === 0; }).length + 1;
      CASES.push({ id: 'case' + (++caseSeq), no: prefix + '-' + today().slice(0, 4) + '-' + ('0' + n).slice(-2) + '（測試）', kind: kind, en: s.en, to: to,
        data: JSON.parse(JSON.stringify(d.data || {})), status: 'submitted', history: [{ t: stamp(), who: s.en, act: 'submit', note: '' }], createdAt: stamp() });
      saveCases();
      if (to === 'hr') BM.toast('（測試）正式版會用 LINE 通知 HR：有一件新的' + (kind === 'notice' ? '通報' : '申訴'));
      return CASE_H.caseList(d);
    },
    caseAct: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var c = CASES.filter(function (x) { return x.id === d.id; })[0], role = c && caseRole(c, s);
      if (!role) return fail('找不到這個案件');
      var next = { accept: 'accepted', reject: 'rejected', decide: 'decided', appeal: 'appealed', appealDecide: 'closed', receive: 'received', close: 'closed' }[d.act];
      if (next) c.status = next;
      if (d.act === 'decide' || d.act === 'reject') c.decision = d.note;
      if (d.act === 'appealDecide') c.decision += '\n\n【申復結果】' + d.note;
      c.history.push({ t: stamp(), who: s.en, act: d.act, note: d.note || '' });
      saveCases();
      return CASE_H.caseGet(d);
    },
    caseUpload: function (d) { var id = 'cf' + (++caseSeq); CASE_FILES[id] = { name: d.name, mime: d.mimeType, base64: d.base64 }; return { id: id, name: d.name, mime: d.mimeType }; },
    caseFile: function (d) { return CASE_FILES[d.fileId] || fail('測試附件只在上傳的那個分頁看得到'); }
  };

  var H = {
    login: function (d) {
      var s = staffByEn(d.account);
      if (!s || d.password !== PW) return fail('帳號或密碼錯誤（測試頁的密碼一律是 test；帳號是員工英文名）');
      if ($('#simFirst') && $('#simFirst').checked) return { role: 'pwchange', token: 'pw:' + s.en, staff: meView(s) };
      return { role: 'staff', token: 't:' + s.en, staff: meView(s) };
    },
    changeMyPassword: function (d) {
      var m = String(d.token || '').match(/^pw:(.+)$/);
      var s = m && staffByEn(m[1]);
      if (!s) return authFail();
      var pw = String(d.newPassword || '');
      if (!/^[A-Za-z0-9!@#$%^&*._-]{6,20}$/.test(pw)) return fail('密碼需為 6–20 碼的英文或數字');
      if (/^(.)\1+$/.test(pw) || '0123456789012345678909876543210'.indexOf(pw) >= 0) return fail('密碼太簡單，請換一組');
      if ($('#simFirst')) { $('#simFirst').checked = false; $('#simFirst').parentElement.classList.remove('on'); }
      return { role: 'staff', token: 't:' + s.en, staff: meView(s) };
    },
    forgotPassword: function (d) {
      var s = staffByEn(d.account);
      if (s) notify('forgot', '🔑 忘記密碼申請\n' + s.en + ' 申請重設密碼。\n請先確認是本人，再決定是否恢復為生日末 4 碼。');
      return { message: '已送出，請等待 1–2 日內管理員通知。' };
    },
    reportIssue: function (d) {
      var msg = String(d.message || '').trim();
      if (!msg) return fail('請描述遇到的問題');
      notify('report', '🐞 問題回報\n回報人：' + (d.who || '未登入') + '\n頁面：測試頁\n\n' + msg);
      return { ok: true };
    },
    me: function (d) { var s = userFrom(d.token); return s ? meView(s) : authFail(); },
    setAvatar: function (d) { var s = userFrom(d.token); if (!s) return authFail(); s.avatar = String(d.avatar || ''); return meView(s); },
    // 入口網站：選單用預設分組（測試模式不讀正式的選單設定）
    portal: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      var me = meView(s);
      var M = { events: ['醫學會', '🏥', true], repair: ['設備維修', '🔧'], training: ['教育訓練', '🎓'], attendance: ['出勤管理', '⏰', true],
        apply: ['申請與通報', '📝', true], assets: ['辦公設備管理', '🖨️'], news: ['公告', '📢', true], rules: ['規章', '📘', true] };
      var groups = [['業務事項', ['events', 'repair', 'training']], ['行政事項', ['attendance', 'apply', 'assets']], ['公司資訊', ['news', 'rules']]];
      var canEv = me.pages.events || me.pages.records || me.pages.corrections;
      var menu = groups.map(function (g) {
        return { name: g[0], items: g[1].filter(function (k) { return k !== 'events' || canEv; }).map(function (k) {
          return { key: k, name: M[k][0], icon: M[k][1], ready: !!M[k][2] };
        }) };
      });
      var t = today();
      var evs = me.pages.events ? eventsFor(s).filter(function (e) {
        return e.status !== 'cancelled' && e.dates.length && e.dates[e.dates.length - 1] >= t;
      }).slice(0, 4).map(function (e) { return { id: e.id, name: e.name, dates: e.dates, mine: e.mine.length > 0, peopleCount: e.peopleCount }; }) : null;
      var ah = attMock().home(d.token);
      var todos = ah.todos.slice();
      var news = NEWS.filter(function (n) { return n.status === 'published'; }).slice(0, 3).map(function (n) {
        return { kind: 'news', id: n.id, title: n.title, date: n.publishedAt.slice(0, 10), pinned: n.pinned, unread: !READS[s.en + ':news:' + n.id] };
      });
      var review = ah.review.concat(CASES.filter(function (c) { return caseRole(c, s) === 'receiver' && ['submitted', 'accepted', 'appealed', 'received'].indexOf(c.status) >= 0; })
        .map(function (c) { return { kind: 'case', id: c.id, title: caseTitle(c) }; }));
      return { me: me, menu: menu, home: { events: evs, att: ah.att, pendingAtt: ah.pendingAtt, pending: ah.pendingAtt, todos: todos, review: review, mine: ah.mine, news: news } };
    },
    // 歷年活動：用正式活動資料
    eventHistory: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var t = today();
      var done = DATA.events.filter(function (e) { return e.status === 'published' && e.dates.length && e.dates[e.dates.length - 1] < t; });
      var ys = Object.keys(done.reduce(function (o, e) { o[e.dates[0].slice(0, 4)] = 1; return o; }, {})).sort().reverse();
      var y = String(d.year || ys[0] || t.slice(0, 4));
      return { year: y, years: ys, list: done.filter(function (e) { return e.dates[0].slice(0, 4) === y; }).map(function (e) { return { name: e.name, dates: e.dates, host: e.host }; }) };
    },
    // 公告：測試的公告只存在這個分頁（不會推播）
    newsList: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      return NEWS.filter(function (n) { return n.status === 'published'; }).map(function (n) { var v = JSON.parse(JSON.stringify(n)); v.read = !!READS[s.en + ':news:' + n.id]; return v; });
    },
    newsRead: function (d) { var s = userFrom(d.token); if (!s) return authFail(); READS[s.en + ':' + (d.kind === 'rule' ? 'rule' : 'news') + ':' + d.id] = 1; saveCases(); return { ok: true }; },
    // 已結束活動的「修改紀錄」：和正式版一樣直接生效
    editRecord: function (d) {
      var s = userFrom(d.token); if (!s) return authFail();
      var ev = DATA.events.filter(function (e) { return e.id === d.eventId; })[0];
      if (!ev) return fail('活動不存在');
      if (!(ev.dates[ev.dates.length - 1] < today())) return fail('活動結束後才能修改紀錄');
      var want = {};
      (d.sessions || []).forEach(function (x) { if (ev.dates.indexOf(x.date) >= 0) want[x.date + '|' + x.session] = true; });
      ev.dates.forEach(function (dt) {
        ['AM', 'PM'].forEach(function (ss) {
          var had = ev.registrants.some(function (r) { return r.en === s.en && r.date === dt && r.session === ss; });
          var on = !!want[dt + '|' + ss];
          if (had === on) return;
          ev.registrants = ev.registrants.filter(function (r) { return !(r.en === s.en && r.date === dt && r.session === ss); });
          if (on) ev.registrants.push({ en: s.en, date: dt, session: ss });
          OPS.push({ en: s.en, ev: ev, date: dt, session: ss, on: on });
        });
      });
      return eventsFor(s);
    },
    newsFile: function () { return fail('測試模式沒有附件'); },
    // 規章：內容讀正式後端（管理員權限），只讀
    rulesList: function () { return BM.realApi('rulesList', { token: ADMIN }); },
    ruleDoc: function (d) { return BM.realApi('ruleDoc', { token: ADMIN, id: d.id }); },
    changePassword: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (d.oldPassword !== PW) return fail('帳號或密碼錯誤（測試模式的目前密碼一律是 test）');
      var pw = String(d.newPassword || '');
      if (!/^[A-Za-z0-9!@#$%^&*._-]{6,20}$/.test(pw)) return fail('密碼需為 6–20 碼的英文或數字');
      return { token: 't:' + s.en, staff: meView(s) };
    },
    events: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (!canSee(s, 'events')) return fail('你的帳號沒有這個頁面的權限');
      return eventsFor(s);
    },
    register: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (!s.counted) return fail('你的帳號只需查看，不需要報名');
      var ev = DATA.events.filter(function (e) { return e.id === d.eventId; })[0];
      if (!ev || ev.status !== 'published') return fail('活動不存在或尚未開放');
      var t = today();
      var want = {};
      (d.sessions || []).forEach(function (x) { want[x.date + '|' + x.session] = true; });
      // 保留過去的場次，未來的場次依勾選重設
      ev.registrants = ev.registrants.filter(function (r) { return r.en !== s.en || r.date < t; });
      Object.keys(want).forEach(function (k) {
        var p = k.split('|');
        if (p[0] < t) return;
        if (ev.dates.indexOf(p[0]) >= 0) ev.registrants.push({ en: s.en, date: p[0], session: p[1] });
      });
      return eventsFor(s);
    },
    records: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (!canSee(s, 'records')) return fail('你的帳號沒有這個頁面的權限');
      var y = String(d.year);
      var get = REC[y] || (REC[y] = BM.realApi('adminRecords', { token: ADMIN, year: y }));
      return get.then(function (snap) {
        var rec = JSON.parse(JSON.stringify(snap));
        applyOpsToRecords(rec);
        var all = s.role === 'manager';
        return { year: rec.year, updatedAt: rec.updatedAt, locked: rec.locked, all: all,
                 people: all ? rec.people : rec.people.filter(function (p) { return p.name === s.en; }) };
      });
    },
    myCorrections: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (!canSee(s, 'corrections')) return fail('你的帳號沒有這個頁面的權限');
      return myCorr(s);
    },
    submitCorrection: function (d) {
      var s = userFrom(d.token);
      if (!s) return authFail();
      if (!canSee(s, 'corrections')) return fail('你的帳號沒有這個頁面的權限');
      var ev = DATA.events.filter(function (e) { return e.id === d.eventId; })[0];
      if (!ev) return fail('活動不存在');
      if (['add', 'remove', 'swap'].indexOf(d.type) < 0) return fail('請選擇申請類型');
      var isReg = function (dt, ss) { return ev.registrants.some(function (r) { return r.en === s.en && r.date === dt && r.session === ss; }); };
      if (d.type !== 'remove' && isReg(d.date, d.session)) return fail('補登的場次你已經有報名紀錄了');
      if (d.type !== 'add' && !isReg(d.rmDate, d.rmSession)) return fail('移除的場次你沒有報名紀錄');
      // 和正式版一樣「送出就生效」：改報名名單，參加紀錄也會跟著變
      var ops = [];
      if (d.type !== 'add') ops.push({ en: s.en, ev: ev, date: d.rmDate, session: d.rmSession, on: false });
      if (d.type !== 'remove') ops.push({ en: s.en, ev: ev, date: d.date, session: d.session, on: true });
      ops.forEach(function (o) {
        ev.registrants = ev.registrants.filter(function (r) { return !(r.en === o.en && r.date === o.date && r.session === o.session); });
        if (o.on) ev.registrants.push({ en: o.en, date: o.date, session: o.session });
        OPS.push(o);
      });
      var date = d.type === 'remove' ? d.rmDate : d.date, ses = d.type === 'remove' ? d.rmSession : d.session;
      var sum = summary(d.type, date, ses, d.rmDate, d.rmSession);
      DATA.corrections.push({ en: s.en, eventId: ev.id, eventName: ev.name, summary: sum, reason: String(d.reason || '').slice(0, 200),
        status: 'approved', createdAt: new Date().toISOString().slice(0, 19) }); // 正式版：未鎖定年度送出就自動通過
      var label = d.type === 'add' ? '補登' : d.type === 'remove' ? '移除' : '修正';
      notify('correction', '📝 ' + label + '申請（已自動通過）\n' + s.en + '\n' + ev.name + '\n' + sum + (d.reason ? '\n說明：' + d.reason : '') + '\n\n有問題可以按「撤銷」改回原狀。');
      return myCorr(s);
    }
  };


  // ---------- 出勤（規則和正式版共用 att-core.js；資料只在這個分頁） ----------
  var AM = null;
  function attMock() {
    if (AM) return AM;
    var att = DATA.att || { people: [], cal: {} };
    // 管理員（HR）也要能登入測試，才能測審核流程
    att.people.forEach(function (p) {
      if (!staffByEn(p.en)) DATA.staff.push({ en: p.en, region: p.region, role: p.role, counted: false, mustChange: false });
    });
    AM = ATT_MOCK({
      persistKey: 'bellamed.test.attdb', // 測試資料留在這台電腦的瀏覽器，重新整理、換身分都還在
      people: function () { return att.people; },
      cal: function (y) { return att.cal[y] || { days: {}, overrides: [] }; },
      me: function (token) {
        var s = userFrom(token);
        return s ? att.people.filter(function (p) { return p.en.toLowerCase() === s.en.toLowerCase(); })[0] : null;
      },
      notify: function (toId, text) {
        var p = att.people.filter(function (x) { return x.id === toId; })[0];
        BM.toast('（測試通知給 ' + (p ? p.en : '') + '）' + text.split('\n')[0]);
      }
    });
    Object.keys(AM.handlers).forEach(function (k) { H[k] = AM.handlers[k]; });
    Object.keys(CASE_H).forEach(function (k) { H[k] = CASE_H[k]; });
    fillSwitcher();
    return AM;
  }

  // ---------- 測試列「切換身分」：不用登出登入，直接換成另一個人（例如業務送單 → HR → Andy → Eva 審核） ----------
  var ROLE_TAG = { admin: 'HR', manager: '主管', finance: '財務' };
  function fillSwitcher() {
    var sel = $('#testAs');
    if (!sel || sel.dataset.filled) return;
    sel.dataset.filled = '1';
    var cur = userFrom(BM.store('staffToken'));
    var list = DATA.staff.slice().sort(function (a, b) {
      var ra = ROLE_TAG[a.role] ? 0 : 1, rb = ROLE_TAG[b.role] ? 0 : 1;
      return ra - rb || a.en.localeCompare(b.en);
    });
    sel.innerHTML = '<option value="">（未登入）</option>' + list.map(function (s) {
      return '<option value="' + BM.esc(s.en) + '"' + (cur && cur.en === s.en ? ' selected' : '') + '>' + BM.esc(s.en) +
        (ROLE_TAG[s.role] ? '（' + ROLE_TAG[s.role] + '）' : '') + '</option>';
    }).join('');
    sel.onchange = function () {
      BM.clearCache();
      var s = sel.value && staffByEn(sel.value);
      if (s) { BM.store('staffToken', 't:' + s.en); BM.store('staff', meView(s)); }
      else { BM.store('staffToken', null); BM.store('staff', null); }
      location.reload();
    };
  }
  // 等網頁的程式都載入完（ATT_MOCK 在後面的檔案）再建立測試資料和「切換身分」選單
  document.addEventListener('DOMContentLoaded', function () {
    ready.then(function () { attMock(); }).catch(function () { });
  });

  BM.mock = function (action, d) {
    return ready.then(wait).then(function () {
      attMock();
      var fn = H[action];
      if (!fn) throw new Error('測試頁不支援這個動作');
      var r = fn(d);
      // 用登入畫面登入時，測試列的「切換身分」也跟著顯示目前的人
      if (action === 'login' && r && r.token && $('#testAs')) $('#testAs').value = String(r.token).replace(/^t:/, '');
      return r;
    });
  };
})();
