/* 功能：醫學會（活動報名、參加紀錄、修正申請）。由 shell.js 掛到內容區。 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var S = { me: null, events: [], tab: 'events', year: String(new Date().getFullYear()) };
  var esc = BM.esc;
  var TABS = [['events', '活動報名'], ['records', '參加紀錄'], ['corrections', '修正申請'], ['settings', '設定']];

  function token() { return BM.store('staffToken'); }
  function myKey() { return S.me.admin ? 'admin' : String(S.me.name).toLowerCase(); }
  function canSee(t) { return t === 'settings' ? !!S.me.admin : !!(S.me.pages && S.me.pages[t]); }
  function alive() { return !!document.getElementById('modEvents'); } // 已切換到別的功能就不要再畫

  // 掛載：root 是內容區；tab 可指定一開始顯示的分頁
  function mount(root, me, tab) {
    S.me = me;
    var tabs = TABS.filter(function (t) { return canSee(t[0]); });
    if (!tabs.length) {
      root.innerHTML = '<div class="card empty">你的帳號目前沒有可以查看的醫學會頁面，請洽管理員。</div>';
      return;
    }
    root.innerHTML = '<div id="modEvents"><nav class="tabs" id="evTabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</nav><div class="mod-body">' +
      TABS.map(function (t) { return '<div id="evtab-' + t[0] + '" hidden></div>'; }).join('') + '</div></div>';
    $$('#evTabs button').forEach(function (b) { b.onclick = function () { BM.go('events/' + b.dataset.tab); }; });
    S.events = BM.cached('ev_' + myKey()) || [];
    var first = tabs[0][0];
    switchTab(tab && canSee(tab) ? tab : (canSee(S.tab) ? S.tab : first));
    if (canSee('events')) loadEvents().then(prefetch); else prefetch();
  }

  function switchTab(t) {
    S.tab = t;
    $$('#evTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    TABS.forEach(function (x) { $('#evtab-' + x[0]).hidden = x[0] !== t; });
    // 管理者：活動報名直接是管理清單（可以新增、編輯）；設定分頁是醫學會的設定
    if (S.me.admin) { $('#evtab-events').innerHTML = ''; $('#evtab-settings').innerHTML = ''; } // 兩個分頁共用同一套管理畫面，一次只放一個
    if (t === 'events' && S.me.admin) BM.admin.events.mount($('#evtab-events'), ['events']);
    else if (t === 'events') renderEvents();
    if (t === 'settings') BM.admin.events.mount($('#evtab-settings'), ['settings'], null, { setMode: 'events' });
    if (t === 'records') loadRecords();
    if (t === 'corrections') loadCorrections();
    window.scrollTo(0, 0);
  }

  // ---------------- 活動 ----------------
  async function loadEvents() {
    await BM.swr('ev_' + myKey(), function () { return BM.api('events', { token: token() }); }, function (evs) {
      S.events = evs;
      if (alive() && S.tab === 'events' && !document.querySelector('.modal-wrap')) renderEvents(); // 正在看活動內容時不打斷
    });
  }
  // 在背景先抓好其他分頁的資料，切換時就不用等
  function prefetch() {
    var y = BM.today().slice(0, 4);
    if (canSee('records')) {
      BM.run(function () { return BM.api('records', { token: token(), year: y }); }, { silent: true })
        .then(function (r) { BM.cache('rec_' + myKey() + '_' + y, r); }).catch(function () { });
    }
    if (canSee('corrections')) {
      BM.run(function () { return BM.api('myCorrections', { token: token() }); }, { silent: true })
        .then(function (r) { BM.cache('cor_' + myKey(), r); }).catch(function () { });
    }
  }

  function evCard(e) {
    var today = BM.today();
    var mine = e.mine.length;
    var badges = [];
    if (e.status === 'cancelled') badges.push('<span class="badge bad">已取消</span>');
    if (mine) badges.push('<span class="badge">我已報名</span>');
    var end = e.dates[e.dates.length - 1];
    if (e.status !== 'cancelled' && e.dates[0] <= today && end >= today) badges.push('<span class="badge warn">進行中</span>');
    var count = '已報名 ' + e.peopleCount + ' 人' + (e.suggested !== '' ? '／建議 ' + e.suggested + ' 人' : '');
    return '<div class="card ev-card" data-id="' + e.id + '" role="button" tabindex="0">' +
      '<div class="ev-body"><p class="ev-name">' + esc(e.name) + '</p><div class="ev-meta">' +
      '<div>日期：' + esc(e.dates.map(function (d, i) { return BM.fmtDate(d, i === 0 || d.slice(0, 4) !== e.dates[0].slice(0, 4)); }).join('、')) + '</div>' +
      (e.host ? '<div>主辦：' + esc(e.host) + '</div>' : '') +
      (e.location ? '<div>地點：' + esc(e.location) + '</div>' : '') +
      '</div><div class="ev-foot"><span class="small muted">' + count + '</span>' + badges.join('') + '</div></div></div>';
  }

  function renderEvents() {
    if (S.me.admin) return; // 管理者看的是管理清單
    var box = $('#evtab-events');
    if (!box) return;
    var today = BM.today();
    var thisYear = today.slice(0, 4);
    var upcoming = S.events.filter(function (e) { return e.dates[e.dates.length - 1] >= today; });
    var past = S.events.filter(function (e) {
      return e.dates[e.dates.length - 1] < today && e.dates[0].slice(0, 4) === thisYear && e.status !== 'cancelled';
    }).reverse();
    var html = '<div class="section-title">即將舉行</div>';
    html += upcoming.length ? upcoming.map(evCard).join('') : '<div class="card empty">目前沒有開放報名的活動</div>';
    if (past.length) {
      html += '<details><summary class="section-title" style="cursor:pointer">今年已結束的活動（' + past.length + '）</summary>' +
        past.map(evCard).join('') + '</details>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.ev-card').forEach(function (c) {
      c.onclick = function () { openEvent(c.dataset.id); };
      c.onkeydown = function (e) { if (e.key === 'Enter') openEvent(c.dataset.id); };
    });
  }

  function regsHtml(e) {
    if (!e.registrants.length) return '<p class="muted small">目前還沒有人報名</p>';
    return e.dates.map(function (d) {
      var parts = ['AM', 'PM'].map(function (s) {
        var names = e.registrants.filter(function (r) { return r.date === d && r.session === s; })
          .map(function (r) { return r.name; });
        return names.length ? '<div><span class="r-s">' + BM.sess(s) + '（' + names.length + '）：</span>' + esc(names.join('、')) + '</div>' : '';
      }).join('');
      return parts ? '<div class="r-day"><b>' + BM.fmtDate(d) + '</b>' + parts + '</div>' : '';
    }).join('');
  }

  function openEvent(id) {
    var e = S.events.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var today = BM.today();
    var cancelled = e.status === 'cancelled';
    var mine = {};
    e.mine.forEach(function (k) { mine[k] = true; });

    var info = '';
    var row = function (k, v) { return v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : ''; };
    info += row('日期', e.dates.map(function (d) { return BM.fmtDate(d); }).join('<br>'));
    info += row('主辦', esc(e.host));
    info += row('地點', esc(e.location));
    info += row('服裝', esc(e.dress));
    info += row('集合地點', esc(e.meetPlace));
    info += row('集合時間', BM.meetTimesHtml(e, S.me.region));
    info += row('建議名額', e.suggested !== '' ? esc(e.suggested) + ' 人' : '');
    info += row('其他說明', e.notes ? BM.linkify(e.notes) : '');
    if (e.attachments && e.attachments.length) {
      info += row('附件', e.attachments.map(function (a) {
        return '📎 <a href="' + BM.fileUrl(a.id) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>';
      }).join('<br>'));
    }

    var sess = '';
    if (S.me.admin || !S.me.counted) {
      sess = ''; // 管理員或不列入統計（例如主管）：只顯示活動內容與報名名單
    } else if (!cancelled) {
      sess = '<h3 style="margin:18px 0 4px">我要報名</h3><p class="muted small" style="margin:0">上午、下午各算 0.5 次，可以只報其中一場。</p><div class="sess-grid">' +
        e.dates.map(function (d) {
          var past = d < today;
          return '<div class="sess-day"><span class="d">' + BM.fmtDate(d) + (past ? ' <span class="badge gray">已過</span>' : '') + '</span>' +
            ['AM', 'PM'].map(function (s) {
              var k = d + '|' + s, on = !!mine[k];
              return '<label class="chk' + (on ? ' on' : '') + (past ? ' dis' : '') + '"><input type="checkbox" data-k="' + k + '"' +
                (on ? ' checked' : '') + (past ? ' disabled' : '') + '>' + BM.sess(s) + '</label>';
            }).join('') + '</div>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn block" id="saveReg">儲存報名</button></div>' +
        (e.dates.some(function (d) { return d < today; }) ? '<p class="muted small">已過的場次如需更正，請到「修正申請」。</p>' : '');
    }

    var m = BM.modal(
      '<h2>' + esc(e.name) + '</h2>' +
      (cancelled ? '<div class="notice">此活動已取消</div>' : '') +
      (e.poster ? '<a href="' + BM.fileUrl(e.poster) + '" target="_blank" rel="noopener"><img class="poster" src="' + BM.img(e.poster) + '" alt="活動海報"></a>' : '') +
      '<dl class="info">' + info + '</dl>' + sess +
      '<h3 style="margin:20px 0 4px">報名名單 <span class="small muted">已報名 ' + e.peopleCount + ' 人' + (e.suggested !== '' ? '／建議 ' + e.suggested + ' 人' : '') + '</span></h3>' +
      '<div class="regs">' + regsHtml(e) + '</div>'
    );
    m.el.querySelectorAll('.chk input').forEach(function (i) {
      i.onchange = function () { i.parentElement.classList.toggle('on', i.checked); };
    });
    var save = m.el.querySelector('#saveReg');
    if (save) save.onclick = async function () {
      var sessions = [];
      m.el.querySelectorAll('.chk input:checked').forEach(function (i) {
        var p = i.dataset.k.split('|');
        sessions.push({ date: p[0], session: p[1] });
      });
      S.events = await BM.run(function () { return BM.api('register', { token: token(), eventId: e.id, sessions: sessions }); });
      BM.cache('ev_' + myKey(), S.events);
      BM.toast('已儲存報名');
      m.close();
      renderEvents();
    };
  }

  // ---------------- 參加紀錄 ----------------
  async function loadRecords() {
    var box = $('#evtab-records');
    if (!box) return;
    box.innerHTML = BM.yearSelect(S.year, 'yearSel') + '<div id="recList"></div>';
    $('#yearSel').onchange = function () { S.year = this.value; loadRecords(); };
    var year = S.year;
    await BM.swr('rec_' + myKey() + '_' + year, function () { return BM.api('records', { token: token(), year: year }); }, function (rec) {
      if (S.year !== year || !$('#recList')) return; // 已切換到別的年度或別的功能
      renderRecords(rec);
    });
  }

  // 主管／管理員：全員表；職員：只有自己
  function renderRecords(rec) {
    var box = $('#recList');
    var head = BM.recordsHead(rec);
    if (rec.all) {
      box.innerHTML = head + '<div id="recTable"></div>';
      BM.recordsTable($('#recTable'), rec);
      return;
    }
    var p = rec.people[0];
    if (!p) { box.innerHTML = head + '<div class="card empty">你的帳號不列入統計</div>'; return; }
    box.innerHTML = head + '<div class="card rec-person"><div class="rec-head"><b>' + esc(p.name) + '</b>' +
      '<span class="rec-total">' + p.total + ' 次</span></div>' +
      (p.items.length ? '<ul class="rec-items">' + p.items.map(function (i) {
        return '<li><span>' + i.date.slice(5).replace('-', '/') + '</span><span>' + esc(i.name) + '</span><span class="c">' +
          i.sessions.map(BM.sess).join('、') + '</span></li>';
      }).join('') + '</ul>' : '<div class="small muted">尚無紀錄</div>') + '</div>' +
      (canSee('corrections') ? '<p class="small muted">紀錄有錯？請到「修正申請」提出。</p>' : '');
  }

  // ---------------- 修正申請 ----------------
  async function loadCorrections() {
    var box = $('#evtab-corrections');
    if (!box) return;
    var today = BM.today();
    var listKey = 'cor_' + myKey();
    var evs = S.events.filter(function (e) { return e.status !== 'cancelled' && e.dates.some(function (d) { return d <= today; }); }).slice().reverse();
    var TYPES = [['add', '申請補登', '有去但沒報名'], ['remove', '申請移除', '有報名但沒去'], ['swap', '申請修正', '報錯場次，同時補登一場、移除一場']];
    box.innerHTML =
      '<div class="card"><h3 style="margin:0">提出申請</h3>' +
      '<p class="muted small" style="margin:4px 0 0">送出後立即生效，次數會馬上更新。</p>' +
      '<label class="f" for="cEv">活動</label><select class="input" id="cEv"><option value="">請選擇活動…</option>' +
      evs.map(function (e) { return '<option value="' + e.id + '">' + esc(BM.fmtRange(e.dates) + ' ' + e.name) + '</option>'; }).join('') + '</select>' +
      '<label class="f">申請類型</label><div class="sess-grid" id="cTypes">' + TYPES.map(function (t, i) {
        return '<label class="chk' + (i === 0 ? ' on' : '') + '" style="border-radius:10px"><input type="radio" name="ctype" value="' + t[0] + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span><b>' + t[1] + '</b> <span class="small muted">' + t[2] + '</span></span></label>';
      }).join('') + '</div>' +
      '<div id="cAddBox"><label class="f" for="cAdd">補登場次</label><select class="input" id="cAdd"></select></div>' +
      '<div id="cRmBox" hidden><label class="f" for="cRm">移除場次</label><select class="input" id="cRm"></select></div>' +
      '<label class="f" for="cReason">說明（選填）</label><textarea class="input" id="cReason" maxlength="200" placeholder="例如：當天臨時參加"></textarea>' +
      '<div class="btn-row"><button class="btn block" id="cSubmit">送出申請</button></div></div>' +
      '<div class="section-title">我的申請紀錄</div><div id="cList"></div>';

    var ev = function () { return S.events.filter(function (e) { return e.id === $('#cEv').value; })[0]; };
    var type = function () { return $('input[name=ctype]:checked').value; };
    var fill = function () {
      var e = ev();
      var t = type();
      $('#cAddBox').hidden = t === 'remove';
      $('#cRmBox').hidden = t === 'add';
      if (!e) { $('#cAdd').innerHTML = ''; $('#cRm').innerHTML = ''; return; }
      var all = [];
      e.dates.filter(function (d) { return d <= today; }).forEach(function (d) {
        ['AM', 'PM'].forEach(function (s) { all.push(d + '|' + s); });
      });
      var opt = function (k) { var p = k.split('|'); return '<option value="' + k + '">' + BM.fmtDate(p[0]) + ' ' + BM.sess(p[1]) + '</option>'; };
      var notMine = all.filter(function (k) { return e.mine.indexOf(k) < 0; });
      var mine = all.filter(function (k) { return e.mine.indexOf(k) >= 0; });
      $('#cAdd').innerHTML = notMine.length ? notMine.map(opt).join('') : '<option value="">（沒有可補登的場次）</option>';
      $('#cRm').innerHTML = mine.length ? mine.map(opt).join('') : '<option value="">（你在這個活動沒有報名紀錄）</option>';
    };
    $('#cEv').onchange = fill;
    $$('input[name=ctype]').forEach(function (r) {
      r.onchange = function () {
        $$('input[name=ctype]').forEach(function (x) { x.parentElement.classList.toggle('on', x.checked); });
        fill();
      };
    });
    fill();
    $('#cSubmit').onclick = async function () {
      var e = ev();
      var t = type();
      if (!e) return BM.toast('請選擇活動', true);
      var add = $('#cAdd').value, rm = $('#cRm').value;
      if (t !== 'remove' && !add) return BM.toast('請選擇補登場次', true);
      if (t !== 'add' && !rm) return BM.toast('請選擇移除場次', true);
      var p = { token: token(), eventId: e.id, type: t, reason: $('#cReason').value };
      if (t !== 'remove') { p.date = add.split('|')[0]; p.session = add.split('|')[1]; }
      if (t !== 'add') { p.rmDate = rm.split('|')[0]; p.rmSession = rm.split('|')[1]; }
      var newList = await BM.run(function () { return BM.api('submitCorrection', p); });
      BM.cache(listKey, newList);
      BM.toast('已送出並生效');
      // 申請已生效：重新抓活動（我的場次已改變），表單選項才會正確
      try { S.events = await BM.api('events', { token: token() }); BM.cache('ev_' + myKey(), S.events); } catch (e2) { }
      if (alive()) loadCorrections();
    };
    // 申請紀錄：先顯示暫存，再背景更新（只更新清單，不會清掉正在填的表單）
    BM.swr(listKey, function () { return BM.api('myCorrections', { token: token() }); }, function (list) {
      var el = $('#cList');
      if (el) el.innerHTML = corListHtml(list);
    });
  }

  function corListHtml(list) {
    var statusBadge = function (s) {
      return s === 'pending' ? '<span class="badge warn">待審核</span>' : s === 'approved' ? '<span class="badge">已通過</span>' : s === 'revoked' ? '<span class="badge gray">已撤銷</span>' : '<span class="badge bad">已退回</span>';
    };
    return list.length ? list.map(function (c) {
      return '<div class="card list-item"><div class="grow"><b>' + esc(c.eventName) + '</b><div>' + esc(c.summary || '') + '</div>' +
        (c.reason ? '<div class="small muted">' + esc(c.reason) + '</div>' : '') +
        '<div class="small muted">' + c.createdAt.slice(0, 10).replace(/-/g, '/') + ' 送出</div></div>' + statusBadge(c.status) + '</div>';
    }).join('') : '<div class="card empty">尚無申請紀錄</div>';
  }

  BM.modules = BM.modules || {};
  BM.modules.events = { mount: mount, openEvent: function (id) { if (S.events.length) openEvent(id); } };
})();
