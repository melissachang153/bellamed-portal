/* 寶漾行政系統：外框（登入、選單、首頁、我的、管理中心、網址切換） */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var P = null; // { me, menu, home }
  var TEST = !!window.BM_TEST;

  function token() { return BM.store('staffToken'); }
  function isAdmin() { return !!(P && P.me && P.me.admin); }
  // 會收到審核單的人：管理員（HR）、主管、財務
  function isHR() { return isAdmin() || !!(P && P.me && P.me.role === 'admin'); }
  // 各功能的子分頁（顯示在左側選單，點功能名稱展開）
  function subsOf(key) {
    var S = {
      events: [['events', '活動報名'], ['records', '參加紀錄'], ['history', '歷年活動']].concat(isAdmin() ? [['settings', '設定']] : []),
      attendance: [['detail', '出勤明細'], ['apply', '休假申請']].concat(isHR() ? [['settings', '出勤設定']] : []),
      settings: [['staff', '人員'], ['perm', '選單與權限'], ['line', 'LINE 與推播'], ['fb', '問題回報']]
    };
    return S[key] || [];
  }
  BM.subsOf = subsOf;
  function isApprover() { return isAdmin() || !!(P && P.me && ['admin', 'manager', 'finance'].indexOf(P.me.role) >= 0); }

  // ---------------- 登入／登出 ----------------
  BM.go = function (path) {
    var h = '#/' + path;
    if (location.hash === h) route(); else location.hash = h;
  };
  BM.logout = function () {
    BM.store('adminToken', null);
    BM.store('staffToken', null);
    BM.store('staff', null);
    BM.clearCache(); // 共用裝置也不會留下別人的資料
    P = null;
    showLogin();
  };
  BM.onAuthFail = function () { BM.logout(); };
  // 管理功能超過 7 天沒輸入密碼：跳出密碼框，成功就換新的登入憑證
  var reauthWait = null;
  BM.onReauth = function () {
    if (reauthWait) return reauthWait;
    reauthWait = new Promise(function (resolve) {
      var done = false;
      var m = BM.modal('<h2>請再輸入一次密碼</h2>' +
        '<p class="small muted" style="margin:0">管理中心每 7 天需要重新確認一次身分。</p>' +
        '<label class="f" for="raPw">密碼</label><input class="input" id="raPw" type="password" autocomplete="current-password" maxlength="20">' +
        '<div class="btn-row"><button class="btn block" id="raOk">確定</button></div>',
        { onClose: function () { if (!done) resolve(false); reauthWait = null; } });
      var pw = m.el.querySelector('#raPw');
      pw.focus();
      var go = async function () {
        if (!pw.value) return BM.toast('請輸入密碼', true);
        var r;
        try { r = await BM.run(function () { return BM.api('reauth', { token: token(), password: pw.value }); }); }
        catch (e) { pw.value = ''; return; }
        saveAuth(r);
        done = true;
        resolve(true);
        m.close();
      };
      m.el.querySelector('#raOk').onclick = go;
      pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    });
    return reauthWait;
  };

  function saveAuth(r) {
    BM.store('staffToken', r.token);
    BM.store('staff', r.staff);
    BM.store('adminToken', r.staff && r.staff.admin ? r.token : null);
  }

  function hideSplash() { var s = document.getElementById("splash"); if (s && !s.classList.contains("gone")) { s.classList.add("gone"); setTimeout(function () { s.remove(); }, 300); } }
  function showOnly(id) {
    if (id !== "appView") hideSplash();
    ['loginView', 'pwView', 'appView'].forEach(function (v) { $('#' + v).hidden = v !== id; });
    // 版本列：登入後放在內容欄的最下面（不另外撐高頁面），登入前放在頁面最下面
    var f = document.querySelector('.site-foot');
    if (f) (id === 'appView' ? $('.main-col') : document.body).appendChild(f);
  }
  function showLogin() {
    showOnly('loginView');
    var a = $('#loginAcct');
    if (a && !a.value) setTimeout(function () { a.focus(); }, 50);
  }

  async function doLogin() {
    var acct = $('#loginAcct').value.trim(), pw = $('#loginPw').value.trim();
    if (!acct) return BM.toast('請輸入帳號', true);
    if (!pw) return BM.toast('請輸入密碼', true);
    var r = await BM.run(function () { return BM.api('login', { account: acct, password: pw }); });
    $('#loginPw').value = '';
    afterAuth(r);
  }
  function afterAuth(r) {
    if (r.role === 'pwchange') return showPwChange(r);
    saveAuth(r);
    if (r.events && r.staff) BM.cache('ev_' + (r.staff.admin ? 'admin' : String(r.staff.name).toLowerCase()), r.events);
    startApp();
  }

  // 首次登入（或密碼被重設）改密碼
  var pwTicket = null, pwAdmin = false;
  function showPwChange(r) {
    pwTicket = r.token;
    pwAdmin = !!r.staff.admin;
    showOnly('pwView');
    $('#pwHello').textContent = r.staff.name + '，你好';
    $('#pwRules').innerHTML = pwAdmin
      ? '<li>管理員帳號：10–20 碼，需同時包含英文與數字</li><li>不能包含生日</li>'
      : '<li>6–20 碼，英文或數字</li><li>不能包含生日</li>';
    $('#newPw').value = '';
    $('#newPw2').value = '';
    $('#newPw').focus();
  }
  function pwOk(a, b, admin) {
    if (!/^[A-Za-z0-9!@#$%^&*._-]{6,20}$/.test(a)) { BM.toast('密碼需為 6–20 碼的英文或數字', true); return false; }
    if (admin && (a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a))) { BM.toast('管理員密碼至少 10 碼，需同時有英文與數字', true); return false; }
    if (a !== b) { BM.toast('兩次輸入的密碼不一樣', true); return false; }
    return true;
  }
  async function doPwChange() {
    var a = $('#newPw').value, b = $('#newPw2').value;
    if (!pwOk(a, b, pwAdmin)) return;
    var r;
    try {
      r = await BM.run(function () { return BM.api('changeMyPassword', { token: pwTicket, newPassword: a }); });
    } catch (e) {
      if (e.auth) showLogin();
      return;
    }
    pwTicket = null;
    BM.toast('密碼已更新');
    afterAuth(r);
  }
  function openForgot() {
    var m = BM.modal('<h2>忘記密碼</h2>' +
      '<p class="small muted" style="margin:0">送出後請等待 1–2 日內管理員通知。</p>' +
      '<label class="f" for="fgAcct">帳號</label><input class="input" id="fgAcct" autocapitalize="off" value="' + esc($('#loginAcct').value.trim()) + '">' +
      '<div class="btn-row"><button class="btn block" id="fgSend">送出申請</button></div>');
    m.el.querySelector('#fgSend').onclick = async function () {
      var acct = m.el.querySelector('#fgAcct').value.trim();
      if (!acct) return BM.toast('請輸入帳號', true);
      var r = await BM.run(function () { return BM.api('forgotPassword', { account: acct }); });
      m.close();
      BM.modal('<h2>已送出</h2><p>' + esc(r.message) + '</p>');
    };
  }

  // ---------------- 啟動：取得「我」、選單、首頁摘要 ----------------
  async function startApp() {
    var saved = BM.store('staff');
    if (!token() || !saved) return showLogin();
    showOnly('appView');
    var first = true;
    await BM.swr('portal', function () { return BM.api('portal', { token: token() }); }, function (p) {
      P = p;
      BM.store("staff", p.me);
      drawFrame();
      hideSplash();
      // 第一次（或資料有變）才重畫內容；正在看的功能不要被打斷
      if (first || currentRoute() === 'home') route();
      first = false;
    });
    hideSplash();
  }

  function roleLabel(me) {
    return me.admin ? '管理員' : me.role === 'manager' ? '主管' : me.role === 'finance' ? '財務' : '';
  }

  // 外框：頁首、左側選單、手機下方常用列
  // 單色線條圖示（顏色跟著文字走）
  var ICON_PATHS = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    events: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M9.5 15l2 2 3.5-3.5"/>',
    repair: '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4.5 16.5a1.8 1.8 0 0 0 2.5 2.5l5-5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.3-.5-.5-2.3z"/>',
    training: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.4 1.6 3.3 2.5 5.5 2.5s4.1-.9 5.5-2.5V11M21.5 9v5"/>',
    attendance: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    leave: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M9.5 15h5"/>',
    apply: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h4"/>',
    assets: '<rect x="3" y="4.5" width="18" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>',
    news: '<path d="M4 10v4a1 1 0 0 0 1 1h2.5l5.5 4V5L7.5 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 9.2a4 4 0 0 1 0 5.6M19 7a7 7 0 0 1 0 10"/>',
    rules: '<path d="M6 4h10.5A2.5 2.5 0 0 1 19 6.5V20H8.5A2.5 2.5 0 0 1 6 17.5z"/><path d="M6 17.5A2.5 2.5 0 0 1 8.5 15H19M10 8h5"/>',
    me: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    review: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    admin: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    test: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5.3 18a1.6 1.6 0 0 0 1.4 2.5h10.6a1.6 1.6 0 0 0 1.4-2.5l-5.2-9.3V3.5M7.8 14h8.4"/>',
    logout: '<path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"/>',
    other: '<rect x="5" y="5" width="14" height="14" rx="3"/>'
  };
  function icon(key) {
    return '<svg class="nic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[key] || ICON_PATHS.other) + '</svg>';
  }
  BM.icon = icon;
  var BOTTOM_ICON = { 'home': 'home', 'attendance/detail': 'attendance', 'attendance/apply': 'apply', 'me': 'me' };
  $$('#bottomNav a').forEach(function (a) { var s = a.querySelector('span'); if (s) s.innerHTML = icon(BOTTOM_ICON[a.dataset.r]); });

  function drawFrame() {
    var me = P.me;
    $('#who').textContent = me.name;
    var av = $('#userBtn .avatar');
    if (!av.dataset.def) av.dataset.def = av.innerHTML;
    var has = me.avatar && BM.avatars && BM.avatars.has(me.avatar);
    av.classList.toggle('pic', !!has);
    av.innerHTML = has ? BM.avatars.svg(me.avatar, 30) : av.dataset.def;
    var fold = BM.store('navFold') || {};
    var groups = P.menu.slice();
    if (isAdmin()) groups.push({ name: '後台設定', admin: true, items: [{ key: 'settings', name: '後台設定', ready: true }] });
    $('#sideNav').innerHTML =
      groups.map(function (g) {
        return '<div class="nav-sec' + (fold[g.name] ? ' folded' : '') + (g.admin ? ' nav-adm' : '') + '">' +
          '<button type="button" class="nav-group" aria-expanded="' + !fold[g.name] + '"><span>' + esc(g.name) + '</span><span class="chev" aria-hidden="true"></span></button>' +
          '<div class="nav-items">' + g.items.map(function (it) {
            var subs = subsOf(it.key);
            if (g.admin) return subs.map(function (s) { return '<a href="#/settings/' + s[0] + '" data-r="settings/' + s[0] + '" class="nav-item nav-sub0">' + esc(s[1]) + '</a>'; }).join('');
            if (subs.length && it.ready) {
              return '<button type="button" class="nav-item nav-mod" data-mod="' + it.key + '">' + icon(it.key) + '<span>' + esc(it.name) + '</span><span class="car" aria-hidden="true"></span></button>' +
                '<div class="nav-subs" data-subs="' + it.key + '">' + subs.map(function (s) {
                  return '<a href="#/' + it.key + '/' + s[0] + '" data-r="' + it.key + '/' + s[0] + '" class="nav-item nav-sub">' + esc(s[1]) + '</a>';
                }).join('') + '</div>';
            }
            return '<a href="#/' + it.key + '" data-r="' + it.key + '" class="nav-item">' + icon(it.key) + '<span>' + esc(it.name) + '</span>' +
              (it.ready ? '' : '<span class="soon">即將推出</span>') + '</a>';
          }).join('') + '</div></div>';
      }).join('');
    $$('#sideNav .nav-mod').forEach(function (b) {
      b.onclick = function () {
        var open = BM.store('navOpen') || {}, k = b.dataset.mod;
        var now = !b.parentNode.querySelector('[data-subs="' + k + '"]').classList.contains('open');
        if (now) open[k] = 1; else delete open[k];
        BM.store('navOpen', open);
        markNav();
      };
    });
    $$('#sideNav .nav-group').forEach(function (b) {
      b.onclick = function () {
        var sec = b.parentNode, name = b.firstChild.textContent, f = BM.store('navFold') || {};
        var folded = sec.classList.toggle('folded');
        b.setAttribute('aria-expanded', String(!folded));
        if (folded) f[name] = 1; else delete f[name];
        BM.store('navFold', f);
      };
    });
    markNav();
  }
  // 左側選單整個收起／展開（電腦記住設定；手機變成滑出的抽屜）
  var mobile = window.matchMedia('(max-width: 959px)');
  function setSide(open) {
    if (mobile.matches) document.body.classList.toggle('side-open', open);
    else { document.body.classList.toggle('side-closed', !open); BM.store('sideClosed', open ? null : 1); }
    var b = $('#sideBtn'), t = open ? '收合選單' : '展開選單';
    b.title = t; b.setAttribute('aria-label', t);
  }
  if (BM.store('sideClosed')) document.body.classList.add('side-closed');
  $('#sideBtn').onclick = function () {
    setSide(mobile.matches ? !document.body.classList.contains('side-open') : document.body.classList.contains('side-closed'));
  };
  $('#sideMask').onclick = function () { setSide(false); };
  function markNav() {
    document.body.classList.remove('side-open');
    var parts = currentRoute().split('/'), r = parts[0];
    var full = r + '/' + (parts[1] || (subsOf(r)[0] || [''])[0]);
    var open = BM.store('navOpen') || {};
    $$('#sideNav a.nav-item').forEach(function (a) { a.classList.toggle('on', a.dataset.r === r || a.dataset.r === full); });
    $$('#sideNav .nav-mod').forEach(function (b) {
      var k = b.dataset.mod, isOpen = !!open[k] || k === r;
      b.classList.toggle('open', isOpen);
      b.classList.toggle('cur', k === r);
      b.setAttribute('aria-expanded', String(isOpen));
      b.parentNode.querySelector('[data-subs="' + k + '"]').classList.toggle('open', isOpen);
    });
    $$('#sideNav .nav-sec').forEach(function (s) { s.classList.toggle('has-on', !!s.querySelector('.nav-item.on')); });
    var sub = currentRoute();
    $$('#bottomNav a').forEach(function (a) {
      var on = a.dataset.r === sub || (a.dataset.r === 'home' && r === 'home');
      a.classList.toggle('on', on);
    });
  }

  // 頁首右上角：個人選單
  function openUserMenu() {
    var me = P.me;
    var items = [['me', 'me', '我的']];
    if (isAdmin()) items.push(['settings', 'admin', '後台設定']);
    var m = BM.modal('<h2>' + esc(me.name) + (roleLabel(me) ? ' <span class="badge gray">' + roleLabel(me) + '</span>' : '') + '</h2>' +
      '<div class="menu-list">' + items.map(function (i) {
        return '<button class="menu-row" data-go="' + i[0] + '">' + icon(i[1]) + esc(i[2]) + '</button>';
      }).join('') +
      (isAdmin() && !TEST ? '<a class="menu-row" href="test.html">' + icon('test') + '測試模式</a>' : '') +
      '<button class="menu-row" id="umOut">' + icon('logout') + '登出</button></div>');
    $$('[data-go]', m.el).forEach(function (b) { b.onclick = function () { m.close(); BM.go(b.dataset.go); }; });
    $('#umOut', m.el).onclick = async function () { m.close(); if (await BM.ask('確定要登出？', { ok: '登出' })) BM.logout(); };
  }

  // ---------------- 網址切換 ----------------
  function currentRoute() { return (location.hash || '').replace(/^#\/?/, '') || 'home'; }
  function moduleOf(key) {
    var found = null;
    (P ? P.menu : []).forEach(function (g) { g.items.forEach(function (it) { if (it.key === key) found = it; }); });
    return found;
  }
  function route() {
    if (!P) return;
    var r = currentRoute();
    var parts = r.split('/');
    var box = $('#content');
    // 換頁時關掉上一頁開著的視窗（不然會蓋在新頁面上）
    Array.prototype.forEach.call(document.querySelectorAll('.modal-wrap'), function (w) { w.remove(); });
    document.body.classList.remove('noscroll');
    markNav();
    window.scrollTo(0, 0);
    if (r === 'home') return renderHome(box);
    if (r === 'me') return renderMe(box);
    if (r === 'todo') return renderTodo(box);
    if (parts[0] === 'review' && isApprover()) return parts[1] === 'events' && isAdmin() ? renderEventsReview(box) : renderReview(box);
    if ((parts[0] === 'settings' || parts[0] === 'admin') && isAdmin()) return renderSettings(box, parts[0] === 'settings' ? parts[1] : '');
    var mod = moduleOf(parts[0]);
    if (!mod) return BM.go('home');
    if (mod.ready && BM.modules[mod.key]) {
      var subs = subsOf(mod.key), alias = mod.key === 'attendance' ? { punch: 'detail', records: 'detail', team: 'detail', fix: 'apply', leave: 'apply', ot: 'apply', calendar: 'settings' } : {};
      var sub = subs.filter(function (s) { return s[0] === (alias[parts[1]] || parts[1]); })[0] || subs[0];
      box.innerHTML = '<div class="page-head"><h2>' + esc(sub ? sub[1] : mod.name) + '</h2></div><div id="modRoot"></div>';
      return BM.modules[mod.key].mount($('#modRoot'), P.me, sub && !alias[parts[1]] ? sub[0] : parts[1]);
    }
    renderSoon(box, mod);
  }

  function renderSoon(box, mod) {
    box.innerHTML = '<div class="page-head"><h2>' + esc(mod.name) + '</h2></div><div class="card empty"><b>即將推出</b></div>';
  }

  // ---------------- 首頁 ----------------
  var ST = { pending: ['審核中', 'warn'], approved: ['已核准', ''], rejected: ['已退件', 'bad'], cancelled: ['已取消', 'gray'] };
  function chip(r) { var s = ST[r.status] || [r.status, 'gray']; return '<span class="badge ' + s[1] + '">' + s[0] + '</span>'; }
  // 首頁的清單卡片：標題、件數、全部 ›，每筆只有標題
  function listCard(title, ico, items, href, row) {
    return '<div class="card home-card home-list"><div class="hc-title">' + icon(ico) + title +
      (items.length && title !== '我的申請' ? '<span class="cnt">' + items.length + '</span>' : '') + '<a class="small hc-all" href="' + href + '">全部 ›</a></div>' +
      (items.length ? items.slice(0, 5).map(row).join('') : '<div class="hl-empty">—</div>') + '</div>';
  }
  function todoAction(t) {
    if (t.kind === 'rejected') return BM.modules.attendance.openReqById(t.id, refreshHome);
    if (t.kind === 'event') { BM.go('events'); setTimeout(function () { BM.modules.events.openEvent(t.id); }, 500); return; }
    BM.go('attendance/detail');
  }
  function renderHome(box) {
    var me = P.me, h = P.home || {};
    var hr = new Date().getHours();
    var hi = hr < 11 ? '早安' : hr < 18 ? '午安' : '晚安';
    var A = BM.modules.attendance;
    var todos = h.todos || [], review = h.review || [], mine = h.mine || [];
    var html = '<div class="hello"><h2>' + hi + '，' + esc(me.name) + '</h2></div><div class="home-grid">';
    if (moduleOf('attendance') && h.att && A) html += '<div class="card home-card home-att">' + A.todayCard(h.att, { link: true }) + '</div>';
    html += listCard('待辦事項', 'attendance', todos, '#/todo', function (t, i) {
      return '<a href="#" class="hl-row" data-todo="' + i + '"><span class="dot ' + (t.kind === 'event' ? 'y' : '') + '"></span><span class="grow">' + esc(t.title) + '</span><span class="go">›</span></a>';
    });
    if (isApprover()) html += listCard('待我審核', 'review', review, '#/review', function (r, i) {
      return '<a href="#" class="hl-row" data-rev="' + i + '"><span class="grow">' + esc(r.title) + '</span><span class="go">›</span></a>';
    });
    if (moduleOf('attendance')) html += listCard('我的申請', 'apply', mine, '#/attendance/apply', function (r) {
      return '<a href="#" class="hl-row" data-mine="' + esc(r.id) + '"><span class="grow">' + esc(r.title) + '</span>' + chip(r) + '<span class="go">›</span></a>';
    });
    if (moduleOf('news') && h.news) {
      var N = BM.modules.news;
      // 後端記的未讀，再扣掉這台裝置剛看過的（不用等重新整理）
      var isUnread = function (n) { return (n.unread !== undefined ? !!n.unread : n.kind === 'news') && !(N && N.isRead(n.id, n.kind === 'rule' ? 'rule' : 'news')); };
      var unreadN = h.news.filter(isUnread).length;
      html += '<div class="card home-card home-list home-news"><div class="hc-title">' + icon('news') + '最新公告' + (unreadN ? '<span class="cnt">' + unreadN + '</span>' : '') + '<a class="small hc-all" href="#/news">全部 ›</a></div>' +
        (h.news.length ? h.news.map(function (n) {
          var unread = isUnread(n);
          return '<a class="ann-row' + (unread ? ' unread' : '') + '" href="#/' + (n.kind === 'rule' ? 'rules/' : 'news/') + esc(n.id) + '">' +
            (n.pinned ? '<span class="tag pin">置頂</span>' : '<span class="tag">' + (n.kind === 'rule' ? '規章' : '公告') + '</span>') +
            '<span class="grow">' + esc(n.title) + '</span><span class="d">' + esc(n.date.slice(5).replace('-', '/')) + '</span><span class="new' + (unread ? '' : ' off') + '"></span></a>';
        }).join('') : '<div class="hl-empty">—</div>') + '</div>';
    }
    html += '</div>';
    if (h.events) {
      html += '<div class="section-title">即將舉行的醫學會</div>' + (h.events.length ? h.events.map(function (e) {
        return '<a class="card list-item home-ev" href="#/events" data-ev="' + e.id + '"><div class="grow"><b>' + esc(e.name) + '</b>' +
          '<div class="small muted">' + esc(BM.fmtRange(e.dates)) + '・已報名 ' + e.peopleCount + ' 人</div></div>' +
          (e.mine ? '<span class="badge">我已報名</span>' : '') + '</a>';
      }).join('') : '<div class="card empty">—</div>');
    }
    html += '<div class="home-menu">' + P.menu.map(function (g) {
      return '<div class="section-title">' + esc(g.name) + '</div><div class="tiles">' + g.items.map(function (it) {
        return '<a class="tile' + (it.ready ? '' : ' off') + '" href="#/' + it.key + '">' + icon(it.key) +
          '<span>' + esc(it.name) + '</span>' + (it.ready ? '' : '<span class="soon">即將推出</span>') + '</a>';
      }).join('') + '</div>';
    }).join('') + '</div>';
    box.innerHTML = html;
    if ($('.home-att [data-punch]', box)) {
      A.init(me); A.tick();
      A.bindPunch($('.home-att', box), function (t) { P.home.att = t; BM.cache('portal', P); renderHome(box); refreshHome(); });
    }
    if (A) A.init(me);
    $$('[data-todo]', box).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); todoAction(todos[+a.dataset.todo]); }; });
    $$('[data-rev]', box).forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var r = review[+a.dataset.rev];
        if (r.kind === 'att') A.openReqById(r.id, refreshHome);
        else if (r.kind === 'case') BM.go('apply/' + r.id);
        else BM.go('review/events');
      };
    });
    $$('[data-mine]', box).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); A.openReqById(a.dataset.mine, refreshHome); }; });
    $$('[data-ev]', box).forEach(function (a) {
      a.onclick = function () { setTimeout(function () { BM.modules.events.openEvent(a.dataset.ev); }, 400); };
    });
  }
  async function refreshHome() {
    await refreshPortal();
    if (currentRoute() === 'home') renderHome($('#content'));
  }

  // ---------------- 待辦事項（全部） ----------------
  function renderTodo(box) {
    var todos = (P.home && P.home.todos) || [];
    box.innerHTML = '<div class="page-head"><h2>待辦事項</h2></div>' +
      (todos.length ? '<div class="card">' + todos.map(function (t, i) {
        return '<a href="#" class="hl-row" data-todo="' + i + '"><span class="dot ' + (t.kind === 'event' ? 'y' : '') + '"></span><span class="grow">' + esc(t.title) + '</span><span class="go">›</span></a>';
      }).join('') + '</div>' : '<div class="card empty">—</div>');
    if (BM.modules.attendance) BM.modules.attendance.init(P.me);
    $$('[data-todo]', box).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); todoAction(todos[+a.dataset.todo]); }; });
  }

  // ---------------- 待我審核 ----------------
  function renderReview(box) {
    var A = BM.modules.attendance;
    A.init(P.me);
    var h = P.home || {};
    box.innerHTML = '<div class="page-head"><h2>待我審核</h2></div><div id="revRoot"><div class="card empty">讀取中…</div></div>';
    var key = 'review_' + String(P.me.name).toLowerCase();
    var draw = function (r) {
      var root = $('#revRoot');
      if (!root) return;
      var row = function (x) { return '<a href="#" class="hl-row" data-r="' + esc(x.id) + '"><span class="grow">' + esc(x.staff + '・' + x.title) + '</span>' + chip(x) + '<span class="go">›</span></a>'; };
      root.innerHTML =
        (isAdmin() && h.pendingEvents ? '<div class="card"><a href="#/review/events" class="hl-row"><span class="grow">醫學會修正申請</span><span class="cnt">' + h.pendingEvents + '</span><span class="go">›</span></a></div>' : '') +
        (r.todo.length ? '<div class="card">' + r.todo.map(row).join('') + '</div>' : '<div class="card empty">—</div>') +
        (r.done.length ? '<div class="section-title">最近審核過的</div><div class="card">' + r.done.map(row).join('') + '</div>' : '');
      $$('[data-r]', root).forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var x = r.todo.concat(r.done).filter(function (y) { return y.id === a.dataset.r; })[0];
          A.openReq(x, function () { BM.cache(key, null); refreshPortal(); renderReview(box); });
        };
      });
    };
    BM.swr(key, function () { return BM.api('attReview', { token: token() }); }, draw);
  }
  function renderEventsReview(box) {
    box.innerHTML = '<div class="page-head"><h2>醫學會修正申請</h2></div><div id="admRoot"></div>';
    BM.admin.events.mount($('#admRoot'), ['review'], 'review');
  }

  // ---------------- 我的 ----------------
  function renderMe(box) {
    var me = P.me;
    var canCor = me.pages && me.pages.corrections;
    box.innerHTML = '<div class="page-head"><h2>我的</h2></div>' +
      '<div class="card"><div class="rec-head"><b style="font-size:18px">' + esc(me.name) + '</b>' +
      (roleLabel(me) ? '<span class="badge gray">' + roleLabel(me) + '</span>' : '') + '</div>' +
      '<div class="small muted">' + esc(me.region || '') + '區</div></div>' +
      '<div class="section-title">頭像</div><div class="card"><div class="ava-grid" id="avaGrid">' +
      '<button type="button" class="ava-pick' + (!me.avatar ? ' on' : '') + '" data-ava="" title="預設"><span class="ava-def">' + icon('me') + '</span><span>預設</span></button>' +
      BM.avatars.list.map(function (a) {
        return '<button type="button" class="ava-pick' + (me.avatar === a.key ? ' on' : '') + '" data-ava="' + a.key + '" title="' + a.name + '">' + BM.avatars.svg(a.key, 52) + '<span>' + a.name + '</span></button>';
      }).join('') + '</div></div>' +
      (moduleOf('attendance') ? '<div class="section-title">假勤餘額</div><div class="card" id="meBal"><div class="muted small">讀取中…</div></div>' : '') +
      '<div class="section-title">我的申請</div><div class="card">' +
      (moduleOf('attendance') ? '<a class="menu-row" href="#/attendance/apply">' + icon('apply') + '休假申請</a>' : '') +
      (canCor ? '<a class="menu-row" href="#/events/corrections">' + icon('events') + '醫學會修正申請</a>' : '') + '</div>' +
      '<div class="section-title">修改密碼</div><div class="card">' +
      '<label class="f" for="mOld">目前的密碼</label><input class="input" id="mOld" type="password" autocomplete="current-password" maxlength="20">' +
      '<label class="f" for="mNew">新密碼</label><input class="input" id="mNew" type="password" autocomplete="new-password" maxlength="20">' +
      '<label class="f" for="mNew2">再輸入一次</label><input class="input" id="mNew2" type="password" autocomplete="new-password" maxlength="20">' +
      '<div class="btn-row"><button class="btn" id="mPwBtn">修改密碼</button></div></div>' +
      '<div class="btn-row"><button class="btn danger block" id="mOut">登出</button></div>';
    $('#mPwBtn').onclick = async function () {
      var a = $('#mNew').value, b = $('#mNew2').value;
      if (!$('#mOld').value) return BM.toast('請輸入目前的密碼', true);
      if (!pwOk(a, b, me.admin)) return;
      var r = await BM.run(function () { return BM.api('changePassword', { token: token(), oldPassword: $('#mOld').value, newPassword: a }); });
      saveAuth(r);
      ['#mOld', '#mNew', '#mNew2'].forEach(function (s) { $(s).value = ''; });
      BM.toast('密碼已修改' + (me.admin ? '。LINE 綁定也請改用新密碼' : ''));
    };
    $('#mOut').onclick = async function () { if (await BM.ask('確定要登出？', { ok: '登出' })) BM.logout(); };
    $$('#avaGrid [data-ava]').forEach(function (b) {
      b.onclick = async function () {
        var me2 = await BM.run(function () { return BM.api('setAvatar', { token: token(), avatar: b.dataset.ava }); });
        P.me = me2; BM.store('staff', me2); BM.cache('portal', P);
        drawFrame();
        $$('#avaGrid [data-ava]').forEach(function (x) { x.classList.toggle('on', x === b); });
        BM.toast('頭像已更新');
      };
    });
    if ($('#meBal')) {
      BM.run(function () { return BM.api('attBalances', { token: token() }); }, { silent: true }).then(function (r) {
        var el = $('#meBal');
        if (!el) return;
        var show = r.balances.filter(function (x) { return x.remaining !== null && (['annual', 'comp', 'personal', 'sick'].indexOf(x.key) >= 0 || x.used); });
        el.innerHTML = '<div class="bal-grid">' + show.map(function (x) {
          return '<div><span>' + esc(x.name) + '</span><b>' + esc(ATT.fmtDays(x.remaining)) + '</b></div>';
        }).join('') + '</div>';
      }).catch(function () { });
    }
  }

  // ---------------- 系統設定（只有管理員） ----------------
  var SET_TABS = [['staff', '人員'], ['perm', '選單與權限'], ['line', 'LINE 與推播'], ['fb', '問題回報']];
  function renderSettings(box, tab) {
    if (!SET_TABS.some(function (t) { return t[0] === tab; })) tab = 'staff';
    var cur = SET_TABS.filter(function (t) { return t[0] === tab; })[0];
    box.innerHTML = '<div class="page-head"><h2>' + cur[1] + '</h2></div><div class="mod-body" id="setRoot"></div>';
    var root = $('#setRoot');
    if (tab === 'perm') return renderPerm(root);
    if (tab === 'staff') return BM.admin.events.mount(root, ['staff'], 'staff');
    return BM.admin.events.mount(root, ['settings'], 'settings', { setMode: tab });
  }

  // 選單與權限：選單分組 → 功能 → 子分頁。功能依主管／行政／職員勾選誰能用；每個子分頁可設定誰能匯出
  async function renderPerm(root) {
    root.innerHTML = '<div id="permAdm"><div class="card empty">讀取中…</div></div>';
    var A = await BM.run(function () { return BM.api('portalAdmin', { token: BM.store('adminToken') }); });
    var menu = JSON.parse(JSON.stringify(A.menu));
    var allow = {}, exportOn = {};
    var load = function () {
      allow = {}; exportOn = JSON.parse(JSON.stringify(A.exportOn || {}));
      Object.keys(A.allow).forEach(function (k) { allow[k] = {}; A.allow[k].forEach(function (id) { allow[k][id] = true; }); });
    };
    load();
    var open = null; // 展開中的格子：'key|group' 或 'export:…'
    var shut = {};   // 收起的選單分組
    var showMenu = false;
    var people = function (g) { return A.people.filter(function (p) { return p.group === g; }); };
    var modName = function (k) { var m = A.modules.filter(function (x) { return x.key === k; })[0]; return m ? m.name : k; };
    var ck = function (on, all, attr) { return '<button type="button" class="ck ' + (all && on === all ? 'on' : on ? 'part' : '') + '" ' + attr + ' aria-label="勾選"></button>'; };
    var cnt = function (k, list) { return list.filter(function (p) { return allow[k] && allow[k][p.id]; }).length; };
    var nameOf = function (p) { return esc((p.name ? p.name + ' ' : '') + p.en); };
    function personBox(k, p) {
      var on = !!(allow[k] && allow[k][p.id]);
      return '<label class="chk' + (on ? ' on' : '') + '"><input type="checkbox" data-one="' + k + '|' + p.id + '"' + (on ? ' checked' : '') + '>' + nameOf(p) + '</label>';
    }
    function whoList(k) {
      return A.groups.map(function (g) {
        var ps = people(g[0]);
        if (!ps.length) return '';
        return '<div class="who-row"><span class="who-h">' + ck(cnt(k, ps), ps.length, 'data-gall="' + k + '|' + g[0] + '"') + g[1] + '</span>' +
          '<div class="who">' + ps.map(function (p) { return personBox(k, p); }).join('') + '</div></div>';
      }).join('');
    }
    function modCell(k, g) {
      var ps = people(g), on = cnt(k, ps);
      if (!ps.length) return '<td class="muted">—</td>';
      return '<td><span class="gk' + (open === k + '|' + g ? ' open' : '') + '">' + ck(on, ps.length, 'data-gall="' + k + '|' + g + '"') +
        '<button type="button" class="gk-n" data-open="' + k + '|' + g + '">' + on + '/' + ps.length + ' ' + (open === k + '|' + g ? '▾' : '▸') + '</button></span></td>';
    }
    function expCell(ek) {
      if (!exportOn[ek]) return '<td><span class="gk">' + ck(0, 1, 'data-exp="' + ek + '"') + '<span class="gk-n">不開放</span></span></td>';
      var n = cnt(ek, A.people);
      return '<td><span class="gk' + (open === ek ? ' open' : '') + '">' + ck(1, 1, 'data-exp="' + ek + '"') +
        '<button type="button" class="gk-n" data-open="' + ek + '">' + n + ' 人 ' + (open === ek ? '▾' : '▸') + '</button></span></td>';
    }
    function draw() {
      var el = $('#permAdm');
      if (!el) return;
      var cols = A.groups.length + 2;
      var rows = menu.map(function (g, gi) {
        var r = '<tr class="grp"><td colspan="' + cols + '"><button type="button" class="grp-t" data-shut="' + gi + '">' + (shut[gi] ? '▸ ' : '▾ ') + esc(g.name) + '</button></td></tr>';
        if (shut[gi]) return r;
        g.items.forEach(function (k) {
          r += '<tr class="mod"><td>' + esc(modName(k)) + '</td>' + A.groups.map(function (x) { return modCell(k, x[0]); }).join('') + '<td></td></tr>';
          if (open && open.indexOf(k + '|') === 0) {
            r += '<tr class="drop"><td colspan="' + cols + '"><div class="who">' + people(open.split('|')[1]).map(function (p) { return personBox(k, p); }).join('') + '</div></td></tr>';
          }
          (A.subpages[k] || []).forEach(function (s) {
            var ek = 'export:' + k + '/' + s[0];
            r += '<tr class="subp"><td>' + esc(s[1]) + '</td>' + A.groups.map(function () { return '<td></td>'; }).join('') + expCell(ek) + '</tr>';
            if (open === ek && exportOn[ek]) r += '<tr class="drop"><td colspan="' + cols + '">' + whoList(ek) + '</td></tr>';
          });
        });
        return r;
      }).join('');
      el.innerHTML = '<div class="card" style="padding:0;overflow:auto"><table class="grid perm2"><thead><tr><th>選單</th>' +
        A.groups.map(function (g) { return '<th>' + g[1] + ' <small>' + people(g[0]).length + '</small></th>'; }).join('') + '<th>可匯出</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (showMenu ? '<div class="card">' + menuEditor() + '</div>' : '') +
        '<div class="btn-row"><button class="btn ghost" id="mToggle">' + (showMenu ? '收起分組設定' : '調整選單分組與順序') + '</button><span class="grow"></span><button class="btn" id="pSave">儲存</button></div>';
      $$('[data-shut]', el).forEach(function (b) { b.onclick = function () { shut[b.dataset.shut] = !shut[b.dataset.shut]; draw(); }; });
      $$('[data-gall]', el).forEach(function (b) {
        b.onclick = function () {
          var p = b.dataset.gall.split('|'), ps = people(p[1]);
          allow[p[0]] = allow[p[0]] || {};
          var all = ps.every(function (x) { return allow[p[0]][x.id]; });
          ps.forEach(function (x) { allow[p[0]][x.id] = !all; });
          draw();
        };
      });
      $$('[data-exp]', el).forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.exp;
          exportOn[k] = !exportOn[k];
          if (exportOn[k] && !cnt(k, A.people)) { allow[k] = {}; A.people.forEach(function (p) { if (p.group !== 'staff') allow[k][p.id] = true; }); }
          open = exportOn[k] ? k : null;
          draw();
        };
      });
      $$('[data-open]', el).forEach(function (b) { b.onclick = function () { open = open === b.dataset.open ? null : b.dataset.open; draw(); }; });
      $$('[data-one]', el).forEach(function (c) {
        c.onchange = function () { var p = c.dataset.one.split('|'); allow[p[0]] = allow[p[0]] || {}; allow[p[0]][p[1]] = c.checked; draw(); };
      });
      $('#mToggle', el).onclick = function () { showMenu = !showMenu; draw(); };
      if (showMenu) bindMenuEditor(el);
      $('#pSave', el).onclick = async function () {
        if (menu.some(function (g) { return !String(g.name).trim(); })) return BM.toast('分組名稱不能空白', true);
        var out = {};
        Object.keys(allow).forEach(function (k) { out[k] = Object.keys(allow[k]).filter(function (id) { return allow[k][id]; }); });
        A = await BM.run(function () { return BM.api('saveMenu', { token: BM.store('adminToken'), menu: menu, allow: out, exportOn: exportOn }); });
        menu = JSON.parse(JSON.stringify(A.menu));
        load();
        BM.toast('已儲存');
        draw();
        refreshPortal();
      };
    }
    function menuEditor() {
      return menu.map(function (g, gi) {
        return '<div class="grp-box"><div class="grp-head"><input class="input" data-gname="' + gi + '" value="' + esc(g.name) + '" maxlength="20">' +
          '<button class="btn small ghost" data-gup="' + gi + '" ' + (gi === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button class="btn small ghost" data-gdown="' + gi + '" ' + (gi === menu.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button class="btn small danger" data-gdel="' + gi + '" ' + (g.items.length ? 'disabled' : '') + '>刪除</button></div>' +
          g.items.map(function (k, ii) {
            return '<div class="grp-item"><span class="grow">' + esc(modName(k)) + '</span>' +
              '<button class="btn small ghost" data-up="' + gi + ',' + ii + '" ' + (ii === 0 ? 'disabled' : '') + '>↑</button>' +
              '<button class="btn small ghost" data-down="' + gi + ',' + ii + '" ' + (ii === g.items.length - 1 ? 'disabled' : '') + '>↓</button>' +
              '<select class="input mini" data-move="' + gi + ',' + ii + '"><option value="">移到…</option>' +
              menu.map(function (g2, gj) { return gj === gi ? '' : '<option value="' + gj + '">' + esc(g2.name) + '</option>'; }).join('') + '</select></div>';
          }).join('') + '</div>';
      }).join('') + '<div class="btn-row"><button class="btn small ghost" id="gAdd">＋ 新增分組</button></div>';
    }
    function bindMenuEditor(el) {
      var at = function (s) { return s.split(',').map(Number); };
      $$('[data-gname]', el).forEach(function (i) { i.oninput = function () { menu[+i.dataset.gname].name = i.value; }; });
      $$('[data-gup]', el).forEach(function (b) { b.onclick = function () { var i = +b.dataset.gup; menu.splice(i - 1, 0, menu.splice(i, 1)[0]); draw(); }; });
      $$('[data-gdown]', el).forEach(function (b) { b.onclick = function () { var i = +b.dataset.gdown; menu.splice(i + 1, 0, menu.splice(i, 1)[0]); draw(); }; });
      $$('[data-gdel]', el).forEach(function (b) { b.onclick = function () { menu.splice(+b.dataset.gdel, 1); draw(); }; });
      $$('[data-up]', el).forEach(function (b) { b.onclick = function () { var p = at(b.dataset.up), it = menu[p[0]].items; it.splice(p[1] - 1, 0, it.splice(p[1], 1)[0]); draw(); }; });
      $$('[data-down]', el).forEach(function (b) { b.onclick = function () { var p = at(b.dataset.down), it = menu[p[0]].items; it.splice(p[1] + 1, 0, it.splice(p[1], 1)[0]); draw(); }; });
      $$('[data-move]', el).forEach(function (s) {
        s.onchange = function () { if (s.value === '') return; var p = at(s.dataset.move); menu[+s.value].items.push(menu[p[0]].items.splice(p[1], 1)[0]); draw(); };
      });
      $('#gAdd', el).onclick = function () { menu.push({ name: '新分組', items: [] }); draw(); };
    }
    draw();
  }
  async function refreshPortal() {
    try { P = await BM.api('portal', { token: token() }); BM.cache('portal', P); drawFrame(); } catch (e) { }
  }

  // ---------------- 啟動 ----------------
  window.addEventListener('hashchange', route);
  $('#loginBtn').onclick = doLogin;
  $('#loginPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('#loginAcct').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#loginPw').focus(); });
  $('#forgotBtn').onclick = openForgot;
  $('#newPwBtn').onclick = doPwChange;
  $('#newPw2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doPwChange(); });
  $('#pwCancel').onclick = function () { pwTicket = null; showLogin(); };
  $('#userBtn').onclick = function () { if (P) openUserMenu(); };
  BM.footer(TEST ? '測試模式' : '入口網站', function () { return P ? P.me.name : ''; });
  startApp();
})();
