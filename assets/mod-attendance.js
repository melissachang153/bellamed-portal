/* 功能：出勤紀錄（打卡、出勤紀錄、補登打卡、全員出勤）。由 shell.js 掛到內容區。 */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var S = { me: null, tab: 'punch', ym: '', viewId: '', teamDate: '' };
  var TABS = [['punch', '打卡'], ['records', '出勤紀錄'], ['fix', '補登打卡'], ['leave', '請假'], ['ot', '加班'], ['team', '全員出勤']];
  var STATUS = { pending: ['審核中', 'warn'], approved: ['已核准', ''], rejected: ['已退件', 'bad'], cancelled: ['已取消', 'gray'] };
  var ACT = { submit: '送出', resubmit: '修改後重新送出', edit: '修改', cancel: '取消', cancelReq: '申請取消', withdraw: '撤回修改',
    approve: '核准', reject: '退件', skip: '跳過' };

  function token() { return BM.store('staffToken'); }
  function alive() { return !!document.getElementById('modAtt'); }
  function isViewer() { return ['admin', 'manager', 'finance'].indexOf(S.me.role) >= 0 || S.me.admin; }
  function api(action, data, opts) {
    return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); }, opts);
  }
  function key(k) { return 'att_' + String(S.me.name).toLowerCase() + '_' + k; }

  function mount(root, me, tab) {
    S.me = me;
    var tabs = TABS.filter(function (t) { return t[0] !== 'team' || isViewer(); });
    root.innerHTML = '<div id="modAtt"><nav class="tabs" id="attTabs">' + tabs.map(function (t) {
      return '<button data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</nav><div class="mod-body" id="attBody"></div></div>';
    $$('#attTabs button').forEach(function (b) { b.onclick = function () { BM.go('attendance/' + b.dataset.tab); }; });
    var t = tabs.some(function (x) { return x[0] === tab; }) ? tab : 'punch';
    S.tab = t;
    $$('#attTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    var body = $('#attBody');
    if (t === 'punch') return renderPunch(body);
    if (t === 'records') return renderRecords(body);
    if (t === 'fix') return renderFix(body);
    if (t === 'team') return renderTeam(body);
    if (t === 'ot') return renderOt(body);
    body.innerHTML = '<div class="card empty"><b>' + (t === 'leave' ? '請假' : '加班') + '即將推出</b>' +
      '<p class="small muted">下一階段開放線上' + (t === 'leave' ? '請假，假勤餘額也會在這裡顯示。' : '申請加班，可以選擇領加班費或換補休。') + '</p></div>';
  }

  // ---------------- 打卡 ----------------
  function flagBadges(d) {
    return d.flags.map(function (f) { return '<span class="badge ' + (f === '遲到' || f === '早退' ? 'warn' : 'bad') + '">' + f + '</span>'; }).join(' ') +
      (d.otMin ? ' <span class="badge ot">加班 ' + ATT.fmtDur(d.otMin) + '</span>' : '') +
      (d.pendingFix ? ' <span class="badge gray">補登審核中</span>' : '');
  }
  function todayCard(t, big) {
    var d = t.day;
    var stateText = !d.inTime && !d.outTime ? '還沒打卡' : !d.outTime ? '上班中' : '已打下班卡';
    return '<div class="att-today' + (big ? ' big' : '') + '">' +
      '<div class="att-clock" id="attClock">' + esc(t.now) + '</div>' +
      '<div class="att-date">' + BM.fmtDate(d.date) + (d.workday ? '' : '・<span class="badge gray">' + esc(d.holiday || '休假日') + '</span>') + '</div>' +
      '<div class="att-cells">' +
      '<div><span>上班</span><b>' + (d.inTime || '--:--') + '</b>' + (d.inFix ? '<small>補登</small>' : '') + '</div>' +
      '<div><span>應下班</span><b>' + (d.expectedOut || '--:--') + '</b></div>' +
      '<div><span>下班</span><b>' + (d.outTime || '--:--') + '</b>' + (d.outFix ? '<small>補登</small>' : '') + '</div></div>' +
      '<div class="att-state">' + stateText + (d.flags.length || d.pendingFix ? '　' + flagBadges(d) : '') + '</div></div>';
  }
  // 兩顆按鈕：上班、下班。下一個該按的那顆比較醒目
  function punchButton(t) {
    var d = t.day, next = !d.inTime ? 'in' : 'out';
    var b = function (k, label, time) {
      return '<button class="btn att-punch ' + k + (next === k ? ' next' : '') + '" data-punch="' + k + '">' + BM.icon('attendance') +
        '<span>' + label + (time ? '<small>已打 ' + time + '</small>' : '') + '</span></button>';
    };
    return '<div class="att-punch-row">' + b('in', '上班', d.inTime) + b('out', '下班', d.outTime) + '</div>';
  }
  function bindPunch(root, after) {
    $$('[data-punch]', root).forEach(function (btn) { btn.onclick = function () { doPunch(btn.dataset.punch, after); }; });
  }
  // 畫面上的時鐘每 10 秒更新一次（實際打卡時間以伺服器為準）
  var tickTimer = null;
  function tpeNow() {
    var d = new Date(Date.now() + (BM.clockSkew || 0));
    var t = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
    return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  function tick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(function () {
      var c = document.getElementById('attClock');
      if (!c) return clearInterval(tickTimer);
      c.textContent = tpeNow();
    }, 10000);
  }
  // 打卡：今天已經打過同一種卡，先問要不要覆蓋；打完依結果顯示（正常＝小提示，遲到／早退／加班＝視窗）
  async function doPunch(kind, after) {
    var t = await api('attPunch', { kind: kind });
    if (t.needConfirm) {
      var lbl = t.kindLabel;
      var ok = await BM.ask('要覆蓋今天的' + lbl + '卡嗎？\n今天已在 ' + t.prev + ' 打過' + lbl + '卡', { ok: '確定覆蓋' });
      if (!ok) return;
      t = await api('attPunch', { kind: kind, overwrite: true });
    }
    BM.cache(key('today'), t);
    var d = t.day, tm = t.done.time, lbl2 = kind === 'in' ? '上班' : '下班';
    if (kind === 'in' && d.late) {
      BM.notice(tm + ' 上班打卡成功（遲到）', '已超過 9:30，今天的應下班時間是 ' + d.expectedOut + '。', { tone: 'warn' });
    } else if (kind === 'out' && d.otMin) {
      BM.notice(tm + ' 下班打卡成功', (d.workday ? '超時 ' + ATT.fmtDur(d.overMin) : '今天是' + (d.holiday || '休假日') + '，共工作 ' + ATT.fmtDur(d.otMin)) +
        '，已記錄加班（' + d.otKind + '）。\n加班費或補休的申請，下一階段在「加班」頁開放。');
    } else if (kind === 'out' && d.early) {
      BM.notice(tm + ' 下班打卡成功（早退）', '今天的應下班時間是 ' + d.expectedOut + '。如果是請假或公出，之後請補請假。', { tone: 'warn' });
    } else if (kind === 'out' && !d.inTime) {
      BM.notice(tm + ' 下班打卡成功', '今天沒有上班卡，會標示為缺卡。請到「補登打卡」補上今天的上班時間。', { tone: 'warn' });
    } else {
      BM.toast(lbl2 + '打卡成功 ' + tm + (t.done.replaced ? '（已覆蓋 ' + t.done.replaced + '）' : ''));
    }
    if (after) after(t);
  }
  function renderPunch(body) {
    var draw = function (t) {
      if (!alive() || S.tab !== 'punch') return;
      body.innerHTML = '<div class="card">' + todayCard(t, true) + punchButton(t) + '</div>' +
        (t.punches.length ? '<div class="section-title">今天的打卡</div><div class="card">' + t.punches.map(function (p) {
          return '<div class="att-row"><b>' + p.time + '</b><span>' + p.kindLabel + '卡</span>' + (p.fix ? '<span class="badge gray">補登</span>' : '') + '</div>';
        }).join('') + '</div>' : '') +
        '<p class="small muted att-rule">7:00–9:30 之間打上班卡，下班時間是上班打卡加 9 小時；9:30 以後打卡算遲到，下班時間固定 18:30。午休 12:30–13:30。' +
        '下班卡比應下班時間晚 30 分鐘以上，會自動記錄加班。按錯了可以再按一次覆蓋。打卡時間以伺服器時間為準。</p>' +
        '<div class="btn-row"><a class="btn ghost" href="#/attendance/fix">整天忘了打卡？申請補登</a></div>';
      bindPunch(body, draw);
      tick();
    };
    var c = BM.cached(key('today'));
    if (!c) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(key('today'), function () { return BM.api('attToday', { token: token() }); }, draw);
  }

  // ---------------- 出勤紀錄（月） ----------------
  function shiftYm(ym, n) { var p = ym.split('-'); var d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function renderRecords(body) {
    if (!S.ym) S.ym = BM.today().slice(0, 7);
    var k = key('m_' + (S.viewId || 'me') + '_' + S.ym);
    var draw = function (m) {
      if (!alive() || S.tab !== 'records') return;
      var s = m.summary;
      var thisMonth = S.ym >= BM.today().slice(0, 7);
      body.innerHTML = '<div class="att-month-bar">' +
        '<button class="btn small ghost" id="mPrev" aria-label="上個月">‹</button><b>' + S.ym.replace('-', ' 年 ') + ' 月</b>' +
        '<button class="btn small ghost" id="mNext" aria-label="下個月"' + (thisMonth ? ' disabled' : '') + '>›</button>' +
        (isViewer() ? '<select class="input mini" id="mWho"><option value="">我自己</option></select>' : '') + '</div>' +
        (S.viewId ? '<p class="small muted" style="margin:0 4px 8px">正在看：<b>' + esc(m.staff) + '</b></p>' : '') +
        '<div class="att-sum">' +
        sumCell('出勤天數', s.present) + sumCell('遲到', s.late, s.late) + sumCell('早退', s.early, s.early) +
        sumCell('缺卡', s.missing, s.missing) + sumCell('補登', s.fix) + sumCell('加班', s.otMin ? ATT.fmtDur(s.otMin) : 0) + '</div>' +
        (m.days.length ? '<div class="card att-days">' + m.days.map(dayRow).join('') + '</div>' : '<div class="card empty">這個月還沒有資料</div>');
      $('#mPrev').onclick = function () { S.ym = shiftYm(S.ym, -1); renderRecords(body); };
      $('#mNext').onclick = function () { S.ym = shiftYm(S.ym, 1); renderRecords(body); };
      if ($('#mWho')) fillWho($('#mWho'), body);
      $$('[data-fix]', body).forEach(function (b) {
        b.onclick = function () { openFixForm(null, { date: b.dataset.date, kind: b.dataset.fix }); };
      });
    };
    var c = BM.cached(k);
    if (!c) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(k, function () { return BM.api('attMonth', { token: token(), ym: S.ym, staffId: S.viewId }); }, draw);
  }
  function sumCell(label, n, warn) { return '<div class="' + (warn ? 'warn' : '') + '"><b>' + n + '</b><span>' + label + '</span></div>'; }
  function dayRow(d) {
    var off = !d.workday;
    var mine = !S.viewId;
    var acts = mine && !d.pendingFix ? (d.missingIn ? '<button class="btn small ghost" data-fix="in" data-date="' + d.date + '">補登上班</button>' : '') +
      (d.missingOut ? '<button class="btn small ghost" data-fix="out" data-date="' + d.date + '">補登下班</button>' : '') : '';
    return '<div class="att-day' + (off ? ' off' : '') + '">' +
      '<div class="ad-date">' + BM.fmtDate(d.date, false) + (off ? '<small>' + esc(d.holiday || '休假日') + '</small>' : '') + '</div>' +
      '<div class="ad-times">' + (d.inTime || d.outTime ? '<span>' + (d.inTime || '--:--') + (d.inFix ? '*' : '') + '</span><span class="muted">→</span><span>' +
        (d.outTime || '--:--') + (d.outFix ? '*' : '') + '</span>' : '<span class="muted">' + (off ? '' : '—') + '</span>') + '</div>' +
      '<div class="ad-flags">' + flagBadges(d) + acts + '</div></div>';
  }
  async function fillWho(sel, body) {
    var list = BM.cached(key('staffList'));
    var put = function (l) {
      sel.innerHTML = '<option value="">我自己</option>' + l.filter(function (p) { return p.en !== S.me.name; }).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === S.viewId ? ' selected' : '') + '>' + esc(p.en) + '</option>';
      }).join('');
    };
    if (list) put(list);
    sel.onchange = function () { S.viewId = sel.value; renderRecords(body); };
    if (!list) {
      var t = await api('attTeam', { date: BM.today() }, { silent: true });
      BM.cache(key('staffList'), t.staffList);
      if (alive()) put(t.staffList);
    }
  }

  // ---------------- 補登打卡 ----------------
  function statusBadge(r) {
    var s = STATUS[r.status] || [r.status, 'gray'];
    var txt = r.status === 'pending' ? (r.mode === 'cancel' ? '取消審核中' : r.mode === 'edit' ? '修改審核中' : '審核中') + (r.waitingFor ? '・等 ' + r.waitingFor : '') : s[0];
    return '<span class="badge ' + s[1] + '">' + esc(txt) + '</span>';
  }
  function historyHtml(r) {
    return '<div class="att-hist">' + r.history.map(function (h) {
      return '<div><span class="muted">' + esc(String(h.t).slice(5, 16).replace('T', ' ').replace('-', '/')) + '</span> ' + esc(h.by) + ' ' +
        esc(ACT[h.act] || h.act) + (h.note ? '：' + esc(h.note) : '') + '</div>';
    }).join('') + '</div>';
  }
  function reqCard(r, opts) {
    opts = opts || {};
    var d = r.data || {};
    var nd = r.pendingData;
    var canEdit = r.mine && r.status !== 'cancelled' && r.mode !== 'cancel';
    var canCancel = r.mine && (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected') && r.mode !== 'cancel';
    return '<div class="card att-req" data-id="' + esc(r.id) + '">' +
      '<div class="rec-head"><b>' + esc((opts.who ? r.staff + '・' : '') + r.typeLabel) + '</b>' + statusBadge(r) + '</div>' +
      '<div class="att-req-main">' + esc(r.summary) + (nd ? '　<span class="small muted">原本：' + esc(d.date.slice(5).replace('-', '/') + ' ' + d.time) + '</span>' : '') + '</div>' +
      '<div class="small muted">原因：' + esc((nd || d).reason || '') + '</div>' +
      '<details><summary class="small muted">審核歷程</summary>' + historyHtml(r) + '</details>' +
      (opts.decide && r.canDecide ? '<div class="btn-row"><button class="btn small" data-ok>核准</button><button class="btn small danger" data-no>退件</button></div>' :
        (canEdit || canCancel) && !opts.decide ? '<div class="btn-row">' + (canEdit ? '<button class="btn small ghost" data-edit>修改</button>' : '') +
        (canCancel ? '<button class="btn small ghost" data-cancel>' + (r.mode === 'edit' ? '撤回修改' : '取消申請') + '</button>' : '') + '</div>' : '') +
      '</div>';
  }
  function renderFix(body) {
    var draw = function (list) {
      if (!alive() || S.tab !== 'fix') return;
      var fixes = list.filter(function (r) { return r.type === 'fix'; });
      body.innerHTML = '<div class="btn-row" style="margin:0 0 12px"><button class="btn" id="fNew">＋ 申請補登打卡</button></div>' +
        '<p class="small muted" style="margin:0 4px 12px">忘了打卡時填寫，經 HR 和主管核准後才會算進出勤紀錄。HR 核准前可以自己修改或取消；核准後要修改或取消，只需要 HR 再審一次。</p>' +
        (fixes.length ? fixes.map(function (r) { return reqCard(r); }).join('') : '<div class="card empty">還沒有補登申請</div>');
      $('#fNew').onclick = function () { openFixForm(null, null); };
      bindReqActions(body, fixes, function () { renderFix(body); });
    };
    var c = BM.cached(key('reqs'));
    if (!c) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(key('reqs'), function () { return BM.api('attMyReqs', { token: token() }); }, draw);
  }
  function bindReqActions(root, list, refresh) {
    $$('.att-req', root).forEach(function (el) {
      var r = list.filter(function (x) { return x.id === el.dataset.id; })[0];
      if (!r) return;
      if ($('[data-edit]', el)) $('[data-edit]', el).onclick = function () { openFixForm(r, r.pendingData || r.data); };
      if ($('[data-cancel]', el)) $('[data-cancel]', el).onclick = async function () {
        var msg = r.mode === 'edit' ? '撤回這次修改，維持原本已核准的內容？' :
          r.status === 'approved' || r.hrOk ? '申請取消這張補登？HR 核准後才會取消。' : '確定取消這張補登申請？';
        if (!await BM.ask(msg)) return;
        await api('attCancel', { id: r.id });
        BM.toast('已送出');
        BM.cache(key('reqs'), null);
        refresh();
      };
    });
  }
  function openFixForm(r, d) {
    d = d || {};
    var today = BM.today();
    var m = BM.modal('<h2>' + (r ? '修改補登打卡' : '申請補登打卡') + '</h2>' +
      (r && (r.status === 'approved' || r.hrOk) ? '<p class="small muted" style="margin:0">這張已經過 HR 核准，修改後要再由 HR 審一次。</p>' : '') +
      '<label class="f" for="fxDate">日期</label><input class="input" id="fxDate" type="date" max="' + today + '" value="' + esc(d.date || today) + '">' +
      '<label class="f">補登哪一張卡</label><div class="choice">' +
      [['in', '上班卡'], ['out', '下班卡']].map(function (o) {
        var on = (d.kind || 'in') === o[0];
        return '<label class="chk' + (on ? ' on' : '') + '"><input type="radio" name="fxKind" value="' + o[0] + '"' + (on ? ' checked' : '') + '>' + o[1] + '</label>';
      }).join('') + '</div>' +
      '<label class="f" for="fxTime">實際時間</label><input class="input" id="fxTime" type="time" value="' + esc(d.time || '') + '">' +
      '<label class="f" for="fxReason">原因</label><input class="input" id="fxReason" maxlength="200" placeholder="例如：忘記打卡、外出拜訪客戶" value="' + esc(d.reason || '') + '">' +
      '<div class="btn-row"><button class="btn block" id="fxOk">送出</button></div>');
    var el = m.el;
    $$('input[name=fxKind]', el).forEach(function (x) {
      x.onchange = function () { $$('input[name=fxKind]', el).forEach(function (y) { y.parentElement.classList.toggle('on', y.checked); }); };
    });
    $('#fxOk', el).onclick = async function () {
      var k = $('input[name=fxKind]:checked', el);
      var data = { date: $('#fxDate', el).value, kind: k ? k.value : 'in', time: $('#fxTime', el).value, reason: $('#fxReason', el).value.trim() };
      if (!data.date) return BM.toast('請選擇日期', true);
      if (!data.time) return BM.toast('請填寫時間', true);
      if (!data.reason) return BM.toast('請填寫原因', true);
      var res = await api('attSaveFix', { id: r ? r.id : '', data: data });
      m.close();
      BM.toast(res.status === 'approved' ? '已生效' : '已送出，等待 ' + (res.waitingFor || '審核'));
      BM.cache(key('reqs'), null);
      BM.cache(key('today'), null);
      if (S.tab === 'fix') renderFix($('#attBody')); else BM.go('attendance/fix');
    };
  }

  // ---------------- 加班（自動記錄；申請下一階段開放） ----------------
  function renderOt(body) {
    var y = BM.today().slice(0, 4);
    var k = key('ot_' + y);
    var draw = function (o) {
      if (!alive() || S.tab !== 'ot') return;
      body.innerHTML = '<div class="card att-ot-head"><div><b>' + o.year + ' 年已記錄的加班</b>' +
        '<div class="small muted">下班卡比應下班時間晚 30 分鐘以上，或休假日上班，系統會自動記錄。</div></div>' +
        '<div class="att-ot-total"><b>' + ATT.fmtDur(o.totalMin) + '</b><span>' + o.days.length + ' 天</span></div></div>' +
        '<div class="card small muted" style="margin-top:0">申請加班費或補休的功能下一階段開放：到時候在這裡勾選要申請的日子（以天為單位），選擇加班費或補休後送出。年底還沒申請的，由財務結算。</div>' +
        (o.days.length ? '<div class="card att-days">' + o.days.map(function (d) {
          return '<div class="att-day">' +
            '<div class="ad-date">' + BM.fmtDate(d.date, false) + '<small>' + esc(d.otKind) + (d.holiday ? '・' + esc(d.holiday) : '') + '</small></div>' +
            '<div class="ad-times"><span>' + d.inTime + '</span><span class="muted">→</span><span>' + d.outTime + '</span></div>' +
            '<div class="ad-flags"><span class="badge ot">加班 ' + ATT.fmtDur(d.otMin) + '</span><span class="badge gray">未申請</span></div></div>';
        }).join('') + '</div>' : '<div class="card empty">今年還沒有記錄到加班</div>');
    };
    if (!BM.cached(k)) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(k, function () { return BM.api('attOvertime', { token: token(), year: y }); }, draw);
  }

  // ---------------- 全員出勤 ----------------
  function renderTeam(body) {
    if (!S.teamDate) S.teamDate = BM.today();
    var k = key('team_' + S.teamDate);
    var draw = function (t) {
      if (!alive() || S.tab !== 'team') return;
      BM.cache(key('staffList'), t.staffList);
      var ppl = t.people;
      var cnt = function (f) { return ppl.filter(f).length; };
      var isToday = t.date === BM.today();
      body.innerHTML = '<div class="att-month-bar"><button class="btn small ghost" id="tPrev" aria-label="前一天">‹</button>' +
        '<input class="input mini" type="date" id="tDate" max="' + BM.today() + '" value="' + t.date + '">' +
        '<button class="btn small ghost" id="tNext" aria-label="後一天"' + (isToday ? ' disabled' : '') + '>›</button></div>' +
        '<div class="att-sum">' + sumCell('已上班', cnt(function (d) { return d.inTime; })) +
        sumCell(isToday ? '還沒打卡' : '缺上班卡', cnt(function (d) { return d.workday && !d.inTime; }), 1) +
        sumCell('遲到', cnt(function (d) { return d.late; }), 1) + sumCell('早退', cnt(function (d) { return d.early; }), 1) + '</div>' +
        '<div class="card" style="padding:0;overflow:auto"><table class="grid"><thead><tr><th>姓名</th><th>區</th><th>上班</th><th>下班</th><th>應下班</th><th>標示</th></tr></thead><tbody>' +
        ppl.map(function (d) {
          return '<tr><td><a href="#" data-who="' + esc(d.staffId) + '">' + esc(d.staff) + '</a></td><td>' + esc(d.region || '') + '</td>' +
            '<td>' + (d.inTime || '—') + (d.inFix ? '*' : '') + '</td><td>' + (d.outTime || '—') + (d.outFix ? '*' : '') + '</td>' +
            '<td>' + (d.expectedOut || '') + '</td><td>' + (d.workday ? flagBadges(d) : '<span class="badge gray">' + esc(d.holiday || '休假日') + '</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="small muted">＊＝補登的打卡。點姓名可以看那個人整個月的紀錄。</p>';
      $('#tPrev').onclick = function () { S.teamDate = ATT.addDays(S.teamDate, -1); renderTeam(body); };
      $('#tNext').onclick = function () { S.teamDate = ATT.addDays(S.teamDate, 1); renderTeam(body); };
      $('#tDate').onchange = function () { if (this.value) { S.teamDate = this.value; renderTeam(body); } };
      $$('[data-who]', body).forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); S.viewId = a.dataset.who === myId(ppl) ? '' : a.dataset.who; S.ym = S.teamDate.slice(0, 7); BM.go('attendance/records'); };
      });
    };
    var c = BM.cached(k);
    if (!c) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(k, function () { return BM.api('attTeam', { token: token(), date: S.teamDate }); }, draw);
  }
  function myId(ppl) { var m = ppl.filter(function (p) { return p.staff === S.me.name; })[0]; return m ? m.staffId : ''; }

  // 給首頁和「待我審核」用
  BM.modules = BM.modules || {};
  BM.modules.attendance = {
    mount: mount,
    init: function (me) { S.me = me; },
    tick: tick,
    todayCard: todayCard,
    punchButton: punchButton,
    doPunch: doPunch,
    bindPunch: bindPunch,
    reqCard: reqCard,
    historyHtml: historyHtml
  };
})();
