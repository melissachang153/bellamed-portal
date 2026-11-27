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
  $('#testBack').onclick = function () { location.href = 'index.html#/admin'; };
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
    if (page === 'corrections') return s.counted;
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
      var M = { events: ['醫學會', '🏥', true], repair: ['設備維修', '🔧'], training: ['教育訓練', '🎓'], attendance: ['出勤紀錄', '⏰', true],
        apply: ['申請與通報', '📝'], assets: ['辦公設備管理', '🖨️'], news: ['公告', '📢'], rules: ['規章', '📘'] };
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
      return { me: me, menu: menu, home: { events: evs, att: ah.att, pendingAtt: ah.pendingAtt, pending: ah.pendingAtt } };
    },
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
