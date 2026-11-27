/* 功能：醫學會（活動報名、參加紀錄、歷年活動；已結束的活動可直接修改紀錄）。由 shell.js 掛到內容區。 */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var S = { me: null, events: [], tab: 'events', year: String(new Date().getFullYear()) };
  var esc = BM.esc;
  var TABS = [['events', '活動報名'], ['records', '參加紀錄'], ['history', '歷年活動'], ['settings', '設定']];

  function token() { return BM.store('staffToken'); }
  function myKey() { return S.me.admin ? 'admin' : String(S.me.name).toLowerCase(); }
  function canSee(t) { return t === 'settings' ? !!S.me.admin : true; } // 每個人都能報名、看紀錄、申請修正
  function alive() { return !!document.getElementById('modEvents'); } // 已切換到別的功能就不要再畫

  // 掛載：root 是內容區；tab 可指定一開始顯示的分頁
  function mount(root, me, tab) {
    S.me = me;
    root.innerHTML = '<div id="modEvents"><div class="mod-body">' +
      TABS.map(function (t) { return '<div id="evtab-' + t[0] + '" hidden></div>'; }).join('') + '</div></div>';
    S.events = BM.cached('ev_' + myKey()) || [];
    switchTab(tab && canSee(tab) && TABS.some(function (t) { return t[0] === tab; }) ? tab : 'events');
    if (canSee('events')) loadEvents().then(prefetch); else prefetch();
  }

  function switchTab(t) {
    S.tab = t;
    TABS.forEach(function (x) { $('#evtab-' + x[0]).hidden = x[0] !== t; });
    // 管理者：活動報名直接是管理清單（可以新增、編輯）；設定分頁是醫學會的設定
    if (S.me.admin) { $('#evtab-events').innerHTML = ''; $('#evtab-settings').innerHTML = ''; } // 兩個分頁共用同一套管理畫面，一次只放一個
    if (t === 'events' && S.me.admin) BM.admin.events.mount($('#evtab-events'), ['events']);
    else if (t === 'events') renderEvents();
    if (t === 'settings') BM.admin.events.mount($('#evtab-settings'), ['settings'], null, { setMode: 'events' });
    if (t === 'records') loadRecords();
    if (t === 'history') renderHistory();
    window.scrollTo(0, 0);
  }

  // ---------------- 活動 ----------------
  async function loadEvents() {
    await BM.swr('ev_' + myKey(), function () { return BM.api('events', { token: token() }); }, function (evs) {
      S.events = evs;
      if (alive() && S.tab === 'events' && !document.querySelector('.modal-wrap')) { if (S.me.admin) { if (BM.admin.events.redraw) BM.admin.events.redraw(); } else renderEvents(); } // 正在看活動內容時不打斷
    });
  }
  // 在背景先抓好其他分頁的資料，切換時就不用等
  function prefetch() {
    var y = BM.today().slice(0, 4);
    if (canSee('records')) {
      BM.run(function () { return BM.api('records', { token: token(), year: y }); }, { silent: true })
        .then(function (r) { BM.cache('rec_' + myKey() + '_' + y, r); }).catch(function () { });
    }
  }

  // 已結束的活動：顯示我參加的場次，可以直接「修改紀錄」（年度鎖定前）
  function mineText(e) {
    if (!e.mine.length) return '未參加';
    return e.dates.map(function (d) {
      var s = ['AM', 'PM'].filter(function (x) { return e.mine.indexOf(d + '|' + x) >= 0; });
      return s.length ? d.slice(5).replace('-', '/') + ' ' + s.map(BM.sess).join('、') : '';
    }).filter(Boolean).join('；');
  }
  function pastCard(e) {
    return '<div class="card ev-card ev-past" data-id="' + e.id + '" role="button" tabindex="0">' +
      '<div class="ev-body"><p class="ev-name">' + esc(e.name) + '</p><div class="ev-meta">' +
      '<div>' + esc(BM.fmtRange(e.dates)) + (e.location ? '・' + esc(e.location) : '') + '</div><div>我：' + esc(mineText(e)) + '</div></div>' +
      '<div class="ev-foot" style="justify-content:flex-end">' + (e.locked ? '<span class="small muted">🔒 已鎖定</span>' :
        '<button type="button" class="btn small ghost" data-edit="' + e.id + '">修改紀錄</button>') + '</div></div></div>';
  }
  function openEditRecord(e) {
    var mine = {};
    e.mine.forEach(function (k) { mine[k] = true; });
    var m = BM.modal('<h2>修改紀錄</h2><div class="small muted">' + esc(e.name) + '</div><div class="sess-grid">' +
      e.dates.map(function (d) {
        return '<div class="sess-day"><span class="d">' + BM.fmtDate(d) + '</span>' + ['AM', 'PM'].map(function (s) {
          var k = d + '|' + s, on = !!mine[k];
          return '<label class="chk' + (on ? ' on' : '') + '"><input type="checkbox" data-k="' + k + '"' + (on ? ' checked' : '') + '>' + BM.sess(s) + '</label>';
        }).join('') + '</div>';
      }).join('') + '</div><div class="btn-row"><button class="btn block" id="erSave">儲存</button></div>');
    m.el.querySelectorAll('.chk input').forEach(function (i) { i.onchange = function () { i.parentElement.classList.toggle('on', i.checked); }; });
    m.el.querySelector('#erSave').onclick = async function () {
      var sessions = [];
      m.el.querySelectorAll('.chk input:checked').forEach(function (i) { var p = i.dataset.k.split('|'); sessions.push({ date: p[0], session: p[1] }); });
      S.events = await BM.run(function () { return BM.api('editRecord', { token: token(), eventId: e.id, sessions: sessions }); });
      BM.cache('ev_' + myKey(), S.events);
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('rec_') >= 0) try { localStorage.removeItem(k); } catch (x) { } });
      BM.toast('已儲存');
      m.close();
      renderEvents();
    };
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
    // 今年已結束的活動；去年的活動在年度鎖定前也列出來（1 月初還能修改）
    var past = S.events.filter(function (e) {
      var y = e.dates[0].slice(0, 4);
      return e.dates[e.dates.length - 1] < today && e.status !== 'cancelled' && (y === thisYear || (Number(y) === Number(thisYear) - 1 && !e.locked));
    }).sort(function (a, b) { return b.dates[0].localeCompare(a.dates[0]); });
    var html = '<div class="section-title">即將舉行</div>';
    html += upcoming.length ? upcoming.map(evCard).join('') : '<div class="card empty">目前沒有開放報名的活動</div>';
    if (past.length) html += '<div class="section-title">已結束</div>' + past.map(pastCard).join('');
    box.innerHTML = html;
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); openEditRecord(S.events.filter(function (x) { return x.id === b.dataset.edit; })[0]); };
    });
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

  function openEvent(id, after) {
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
    if (!cancelled) {
      sess = '<h3 style="margin:18px 0 4px">我要報名</h3><div class="sess-grid">' +
        e.dates.map(function (d) {
          var past = d < today;
          return '<div class="sess-day"><span class="d">' + BM.fmtDate(d) + (past ? ' <span class="badge gray">已過</span>' : '') + '</span>' +
            ['AM', 'PM'].map(function (s) {
              var k = d + '|' + s, on = !!mine[k];
              return '<label class="chk' + (on ? ' on' : '') + (past ? ' dis' : '') + '"><input type="checkbox" data-k="' + k + '"' +
                (on ? ' checked' : '') + (past ? ' disabled' : '') + '>' + BM.sess(s) + '</label>';
            }).join('') + '</div>';
        }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn block" id="saveReg">儲存報名</button></div>';
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
      if (after) after(); else renderEvents();
    };
  }

  // ---------------- 歷年活動 ----------------
  function renderHistory(year) {
    var box = $('#evtab-history');
    if (!box) return;
    var key = 'evh_' + (year || 'last');
    var draw = function (r) {
      if (!$('#evtab-history') || S.tab !== 'history') return;
      box.innerHTML = '<div class="bar-row"><select class="input" id="hisYear" aria-label="年度" style="max-width:160px">' +
        (r.years.length ? r.years : [r.year]).map(function (y) { return '<option value="' + y + '"' + (y === r.year ? ' selected' : '') + '>' + y + ' 年</option>'; }).join('') +
        '</select></div>' +
        (r.list.length ? '<div class="card" style="padding:0;overflow:auto"><table class="grid his-t"><thead><tr><th>日期</th><th>活動名稱</th><th>主辦</th></tr></thead><tbody>' +
          r.list.map(function (e) { return '<tr><td>' + esc(BM.fmtRange(e.dates)) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.host || '—') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<div class="card empty">—</div>');
      $('#hisYear').onchange = function () { renderHistory(this.value); };
    };
    if (BM.cached(key) === null) box.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(key, function () { return BM.api('eventHistory', { token: token(), year: year || '' }); }, draw);
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
      '';
  }

  BM.modules = BM.modules || {};
  BM.modules.events = { mount: mount, openEvent: function (id, after) { if (S.events.length) openEvent(id, after); }, mineOf: function (id) { var e = S.events.filter(function (x) { return x.id === id; })[0]; return e ? e.mine : []; } };
})();
