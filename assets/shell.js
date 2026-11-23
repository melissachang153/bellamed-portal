/* 寶漾內部系統：外框（登入、選單、首頁、我的、管理中心、網址切換） */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var P = null; // { me, menu, home }
  var TEST = !!window.BM_TEST;

  function token() { return BM.store('staffToken'); }
  function isAdmin() { return !!(P && P.me && P.me.admin); }

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

  function showOnly(id) {
    ['loginView', 'pwView', 'appView'].forEach(function (v) { $('#' + v).hidden = v !== id; });
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
      BM.store('staff', p.me);
      drawFrame();
      // 第一次（或資料有變）才重畫內容；正在看的功能不要被打斷
      if (first || currentRoute() === 'home') route();
      first = false;
    });
  }

  function roleLabel(me) {
    return me.admin ? '管理員' : me.role === 'manager' ? '主管' : me.role === 'finance' ? '財務' : '';
  }

  // 外框：頁首、左側選單、手機下方常用列
  function drawFrame() {
    var me = P.me;
    $('#who').textContent = me.name;
    $('#sideNav').innerHTML = '<a href="#/home" data-r="home" class="nav-item"><span class="ic">🏠</span>首頁</a>' +
      P.menu.map(function (g) {
        return '<div class="nav-group">' + esc(g.name) + '</div>' + g.items.map(function (it) {
          return '<a href="#/' + it.key + '" data-r="' + it.key + '" class="nav-item"><span class="ic">' + it.icon + '</span>' + esc(it.name) +
            (it.ready ? '' : '<span class="soon">即將推出</span>') + '</a>';
        }).join('');
      }).join('');
    markNav();
  }
  function markNav() {
    var r = currentRoute().split('/')[0];
    $$('#sideNav .nav-item').forEach(function (a) { a.classList.toggle('on', a.dataset.r === r); });
    var sub = currentRoute();
    $$('#bottomNav a').forEach(function (a) {
      var on = a.dataset.r === sub || (a.dataset.r === 'home' && r === 'home');
      a.classList.toggle('on', on);
    });
  }

  // 頁首右上角：個人選單
  function openUserMenu() {
    var me = P.me;
    var items = [['me', '👤', '我的']];
    if (isAdmin()) {
      items.push(['review', '✅', '待我審核' + (P.home.pending ? '（' + P.home.pending + '）' : '')]);
      items.push(['admin', '⚙️', '管理中心']);
    }
    var m = BM.modal('<h2>' + esc(me.name) + (roleLabel(me) ? ' <span class="badge gray">' + roleLabel(me) + '</span>' : '') + '</h2>' +
      '<div class="menu-list">' + items.map(function (i) {
        return '<button class="menu-row" data-go="' + i[0] + '"><span class="ic">' + i[1] + '</span>' + esc(i[2]) + '</button>';
      }).join('') +
      (isAdmin() && !TEST ? '<a class="menu-row" href="test.html"><span class="ic">🧪</span>測試模式</a>' : '') +
      '<button class="menu-row" id="umOut"><span class="ic">🚪</span>登出</button></div>');
    $$('[data-go]', m.el).forEach(function (b) { b.onclick = function () { m.close(); BM.go(b.dataset.go); }; });
    $('#umOut', m.el).onclick = function () { m.close(); if (confirm('確定要登出？')) BM.logout(); };
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
    markNav();
    window.scrollTo(0, 0);
    if (r === 'home') return renderHome(box);
    if (r === 'me') return renderMe(box);
    if (parts[0] === 'review' && isAdmin()) return renderAdmin(box, 'events', 'review', '待我審核');
    if (parts[0] === 'admin' && isAdmin()) return renderAdmin(box, parts[1] || 'events', parts[2]);
    var mod = moduleOf(parts[0]);
    if (!mod) return BM.go('home');
    if (mod.ready && BM.modules[mod.key]) {
      box.innerHTML = '<div class="page-head"><h2>' + mod.icon + ' ' + esc(mod.name) + '</h2></div><div id="modRoot"></div>';
      return BM.modules[mod.key].mount($('#modRoot'), P.me, parts[1]);
    }
    renderSoon(box, mod);
  }

  function renderSoon(box, mod) {
    box.innerHTML = '<div class="page-head"><h2>' + mod.icon + ' ' + esc(mod.name) + '</h2></div>' +
      '<div class="card empty"><div style="font-size:40px">🚧</div><b>即將推出</b>' +
      '<p class="small muted">這個功能還在規劃中，完成後會在這裡開放。</p>' +
      '<div class="btn-row" style="justify-content:center"><a class="btn ghost" href="#/home">回首頁</a></div></div>';
  }

  // ---------------- 首頁 ----------------
  function renderHome(box) {
    var me = P.me, h = P.home || {};
    var hr = new Date().getHours();
    var hi = hr < 11 ? '早安' : hr < 18 ? '午安' : '晚安';
    var att = moduleOf('attendance');
    var html = '<div class="hello"><h2>' + hi + '，' + esc(me.name) + '</h2><div class="muted">' + BM.fmtDate(BM.today()) + '</div></div>';
    html += '<div class="home-grid">';
    if (att) {
      html += '<a class="card home-card" href="#/attendance"><div class="hc-title">⏰ 今日出勤</div>' +
        '<div class="muted small">出勤紀錄即將推出，完成後可以在這裡打卡。</div></a>';
    }
    if (isAdmin()) {
      html += '<a class="card home-card" href="#/review"><div class="hc-title">✅ 待我審核</div>' +
        (h.pending ? '<div><span class="big-num">' + h.pending + '</span> 件醫學會修正申請</div>' : '<div class="muted small">目前沒有待審核的申請</div>') + '</a>';
    }
    html += '</div>';
    if (h.events) {
      html += '<div class="section-title">即將舉行的醫學會</div>' + (h.events.length ? h.events.map(function (e) {
        return '<a class="card list-item home-ev" href="#/events" data-ev="' + e.id + '"><div class="grow"><b>' + esc(e.name) + '</b>' +
          '<div class="small muted">' + esc(BM.fmtRange(e.dates)) + '・已報名 ' + e.peopleCount + ' 人</div></div>' +
          (e.mine ? '<span class="badge">我已報名</span>' : '') + '</a>';
      }).join('') : '<div class="card empty">目前沒有即將舉行的活動</div>');
    }
    // 手機沒有左側選單：首頁下方列出全部功能（電腦版由左側選單取代，不重複顯示）
    html += '<div class="home-menu">' + P.menu.map(function (g) {
      return '<div class="section-title">' + esc(g.name) + '</div><div class="tiles">' + g.items.map(function (it) {
        return '<a class="tile' + (it.ready ? '' : ' off') + '" href="#/' + it.key + '"><span class="t-ic">' + it.icon + '</span>' +
          '<span>' + esc(it.name) + '</span>' + (it.ready ? '' : '<span class="soon">即將推出</span>') + '</a>';
      }).join('') + '</div>';
    }).join('') + '</div>';
    box.innerHTML = html;
    $$('[data-ev]', box).forEach(function (a) {
      a.onclick = function () { setTimeout(function () { BM.modules.events.openEvent(a.dataset.ev); }, 400); };
    });
  }

  // ---------------- 我的 ----------------
  function renderMe(box) {
    var me = P.me;
    var canCor = me.pages && me.pages.corrections;
    box.innerHTML = '<div class="page-head"><h2>👤 我的</h2></div>' +
      '<div class="card"><div class="rec-head"><b style="font-size:18px">' + esc(me.name) + '</b>' +
      (roleLabel(me) ? '<span class="badge gray">' + roleLabel(me) + '</span>' : '') + '</div>' +
      '<div class="small muted">' + esc(me.region || '') + '區</div></div>' +

      '<div class="section-title">我的申請</div>' +
      '<div class="card">' + (canCor ? '<a class="menu-row" href="#/events/corrections"><span class="ic">🏥</span>醫學會修正申請</a>' : '') +
      '<div class="menu-row off"><span class="ic">⏰</span>請假・加班・補登<span class="soon">即將推出</span></div></div>' +

      '<div class="section-title">假勤餘額</div><div class="card small muted">出勤紀錄上線後，這裡會顯示特休和補休的剩餘時數。</div>' +

      '<div class="section-title">通知設定</div><div class="card small muted">出勤紀錄上線後，可以在這裡設定上下班提醒和審核通知。</div>' +

      '<div class="section-title">修改密碼</div><div class="card">' +
      '<label class="f" for="mOld">目前的密碼</label><input class="input" id="mOld" type="password" autocomplete="current-password" maxlength="20">' +
      '<label class="f" for="mNew">新密碼</label><input class="input" id="mNew" type="password" autocomplete="new-password" maxlength="20">' +
      '<label class="f" for="mNew2">再輸入一次</label><input class="input" id="mNew2" type="password" autocomplete="new-password" maxlength="20">' +
      '<p class="small muted">' + (me.admin ? '管理員密碼 10–20 碼，需同時有英文與數字。' : '6–20 碼英文或數字，不能包含生日。') + '</p>' +
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
    $('#mOut').onclick = function () { if (confirm('確定要登出？')) BM.logout(); };
  }

  // ---------------- 管理中心 ----------------
  var ADMIN_TABS = [['events', '醫學會'], ['staff', '人員'], ['menu', '選單與權限']];
  function renderAdmin(box, tab, sub, title) {
    if (!ADMIN_TABS.some(function (t) { return t[0] === tab; })) tab = 'events';
    box.innerHTML = '<div class="page-head"><h2>' + (title ? '✅ ' + title : '⚙️ 管理中心') + '</h2>' +
      (isAdmin() && !TEST ? '<a class="btn small ghost" href="test.html">🧪 測試模式</a>' : '') + '</div>' +
      (title ? '' : '<nav class="tabs top">' + ADMIN_TABS.map(function (t) {
        return '<a href="#/admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</a>';
      }).join('') + '</nav>') + '<div id="admRoot"></div>';
    var root = $('#admRoot');
    if (tab === 'menu') return renderMenuAdmin(root);
    if (tab === 'staff') return BM.admin.events.mount(root, ['staff'], 'staff');
    return BM.admin.events.mount(root, title ? ['review'] : ['events', 'review', 'records', 'settings'], sub);
  }

  // 選單與權限：分組名稱、順序、功能放哪一組；各角色可以使用哪些功能
  async function renderMenuAdmin(root) {
    root.innerHTML = '<div id="menuAdm"><div class="card empty">讀取中…</div></div>';
    var A = await BM.run(function () { return BM.api('portalAdmin', { token: BM.store('adminToken') }); });
    var menu = JSON.parse(JSON.stringify(A.menu));
    var perms = JSON.parse(JSON.stringify(A.perms));
    var name = function (k) { var m = A.modules.filter(function (x) { return x.key === k; })[0]; return m ? m.icon + ' ' + m.name : k; };
    function draw() {
      var el = $('#menuAdm');
      if (!el) return;
      el.innerHTML = '<p class="small muted">調整完按最下面的「儲存」，所有人的選單會跟著更新。</p>' +
        menu.map(function (g, gi) {
          return '<div class="card"><div class="grp-head"><input class="input" data-gname="' + gi + '" value="' + esc(g.name) + '" maxlength="20" aria-label="分組名稱">' +
            '<button class="btn small ghost" data-gup="' + gi + '" ' + (gi === 0 ? 'disabled' : '') + ' aria-label="分組上移">↑</button>' +
            '<button class="btn small ghost" data-gdown="' + gi + '" ' + (gi === menu.length - 1 ? 'disabled' : '') + ' aria-label="分組下移">↓</button>' +
            '<button class="btn small danger" data-gdel="' + gi + '" ' + (g.items.length ? 'disabled title="分組裡還有功能，先移走才能刪除"' : '') + '>刪除</button></div>' +
            (g.items.length ? g.items.map(function (k, ii) {
              return '<div class="grp-item"><span class="grow">' + esc(name(k)) + '</span>' +
                '<button class="btn small ghost" data-up="' + gi + ',' + ii + '" ' + (ii === 0 ? 'disabled' : '') + ' aria-label="上移">↑</button>' +
                '<button class="btn small ghost" data-down="' + gi + ',' + ii + '" ' + (ii === g.items.length - 1 ? 'disabled' : '') + ' aria-label="下移">↓</button>' +
                '<select class="input mini" data-move="' + gi + ',' + ii + '" aria-label="移到其他分組"><option value="">移到…</option>' +
                menu.map(function (g2, gj) { return gj === gi ? '' : '<option value="' + gj + '">' + esc(g2.name) + '</option>'; }).join('') + '</select></div>';
            }).join('') : '<div class="small muted">（這個分組沒有功能）</div>') + '</div>';
        }).join('') +
        '<div class="btn-row" style="margin-top:0"><button class="btn ghost" id="gAdd">＋ 新增分組</button></div>' +
        '<div class="section-title">各角色可以使用的功能</div>' +
        '<div class="card" style="padding:0"><table class="grid"><thead><tr><th>功能</th><th class="num">主管</th><th class="num">職員</th></tr></thead><tbody>' +
        A.modules.map(function (m) {
          return '<tr><td>' + esc(m.icon + ' ' + m.name) + (m.ready ? '' : ' <span class="soon">即將推出</span>') + '</td>' +
            ['manager', 'staff'].map(function (r) {
              return '<td class="num"><input type="checkbox" class="cb" data-perm="' + r + ',' + m.key + '"' + (perms[r][m.key] ? ' checked' : '') + ' aria-label="' + esc(m.name) + '"></td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="small muted">管理員一律可以使用全部功能。醫學會裡的各分頁另外在「醫學會 → 醫學會設定」調整。</p>' +
        '<div class="btn-row"><button class="btn block" id="mSave">儲存</button></div>';
      var at = function (s) { return s.split(',').map(Number); };
      $$('[data-gname]', el).forEach(function (i) { i.oninput = function () { menu[+i.dataset.gname].name = i.value; }; });
      $$('[data-gup]', el).forEach(function (b) { b.onclick = function () { var i = +b.dataset.gup; menu.splice(i - 1, 0, menu.splice(i, 1)[0]); draw(); }; });
      $$('[data-gdown]', el).forEach(function (b) { b.onclick = function () { var i = +b.dataset.gdown; menu.splice(i + 1, 0, menu.splice(i, 1)[0]); draw(); }; });
      $$('[data-gdel]', el).forEach(function (b) { b.onclick = function () { menu.splice(+b.dataset.gdel, 1); draw(); }; });
      $$('[data-up]', el).forEach(function (b) { b.onclick = function () { var p = at(b.dataset.up), it = menu[p[0]].items; it.splice(p[1] - 1, 0, it.splice(p[1], 1)[0]); draw(); }; });
      $$('[data-down]', el).forEach(function (b) { b.onclick = function () { var p = at(b.dataset.down), it = menu[p[0]].items; it.splice(p[1] + 1, 0, it.splice(p[1], 1)[0]); draw(); }; });
      $$('[data-move]', el).forEach(function (s) {
        s.onchange = function () {
          if (s.value === '') return;
          var p = at(s.dataset.move);
          var k = menu[p[0]].items.splice(p[1], 1)[0];
          menu[+s.value].items.push(k);
          draw();
        };
      });
      $$('[data-perm]', el).forEach(function (c) { c.onchange = function () { var p = c.dataset.perm.split(','); perms[p[0]][p[1]] = c.checked; }; });
      $('#gAdd', el).onclick = function () { menu.push({ name: '新分組', items: [] }); draw(); };
      $('#mSave', el).onclick = async function () {
        if (menu.some(function (g) { return !String(g.name).trim(); })) return BM.toast('分組名稱不能空白', true);
        A = await BM.run(function () { return BM.api('saveMenu', { token: BM.store('adminToken'), menu: menu, perms: perms }); });
        menu = JSON.parse(JSON.stringify(A.menu));
        perms = JSON.parse(JSON.stringify(A.perms));
        BM.toast('已儲存');
        draw();
        refreshPortal();
      };
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
