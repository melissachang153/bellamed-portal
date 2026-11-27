/* 功能：出勤紀錄（出勤明細、申請、工作日曆）。打卡在首頁。由 shell.js 掛到內容區。 */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var S = { me: null, tab: 'detail', ym: '', who: '', sort: { key: 'date', dir: -1 }, applyType: 'fix', prefill: null, edit: null, calYm: '' };
  var TABS = [['detail', '出勤明細'], ['apply', '申請'], ['settings', '出勤設定']];
  var STATUS = { pending: ['審核中', 'warn'], approved: ['已核准', ''], rejected: ['已退件', 'bad'], cancelled: ['已取消', 'gray'] };
  var ACT = { submit: '送出', resubmit: '修改後重新送出', edit: '修改', cancel: '取消', cancelReq: '申請取消', withdraw: '撤回修改',
    approve: '核准', reject: '退件', skip: '跳過' };
  var ST_LABEL = { ok: ['正常', ''], abnormal: ['異常', 'bad'], working: ['上班中', 'gray'], none: ['尚未打卡', 'gray'], off: ['休假日', 'gray'], before: ['', 'gray'] };

  function token() { return BM.store('staffToken'); }
  function alive() { return !!document.getElementById('modAtt'); }
  function isHR() { return S.me.admin || S.me.role === 'admin'; }
  function api(action, data, opts) { return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); }, opts); }
  function key(k) { return 'att_' + String(S.me.name).toLowerCase() + '_' + k; }
  function md(d) { return d.slice(5).replace('-', '/'); }
  function shiftYm(ym, n) { var p = ym.split('-'); var d = new Date(+p[0], +p[1] - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function wd(d) { return '日一二三四五六'.charAt(ATT.weekday(d)); }

  function mount(root, me, tab) {
    S.me = me;
    // 舊網址：打卡、出勤紀錄、補登、請假、加班
    var alias = { punch: 'detail', records: 'detail', team: 'detail', fix: 'apply', leave: 'apply', ot: 'apply', calendar: 'settings' };
    if (alias[tab]) { if (tab === 'leave' || tab === 'ot' || tab === 'fix') S.applyType = tab; tab = alias[tab]; }
    var tabs = TABS.filter(function (t) { return t[0] !== 'settings' || isHR(); });
    var t = tabs.some(function (x) { return x[0] === tab; }) ? tab : 'detail';
    S.tab = t;
    root.innerHTML = '<div id="modAtt"><div class="mod-body" id="attBody"></div></div>';
    var body = $('#attBody');
    if (t === 'detail') return renderDetail(body);
    if (t === 'apply') return renderApply(body);
    if (t === 'settings') return renderSettings(body);
  }

  // ======================= 首頁的打卡卡片 =======================
  function todayCard(t, opts) {
    var d = t.day, next = !d.inTime ? 'in' : 'out';
    var tile = function (label, v) { return '<div class="' + (v ? 'has' : '') + '"><span>' + label + '</span><b>' + (v || '--:--') + '</b></div>'; };
    return '<div class="hc-title">' + BM.icon('attendance') + '今日出勤<small class="pc-date">' + md(d.date) + '（' + wd(d.date) + '）</small>' +
      (opts && opts.link ? '<a class="small hc-all" href="#/attendance/detail">出勤明細 ›</a>' : '') + '</div>' +
      '<div class="pc-tiles">' + tile('上班', d.inTime) + tile('下班', d.outTime) + '</div>' +
      '<button type="button" class="pc-btn ' + next + '" data-punch="' + next + '">打卡<small id="attClock">' + esc(t.now) + '</small></button>';
  }
  function punchButton() { return ''; }
  function bindPunch(root, after) {
    $$('[data-punch]', root).forEach(function (btn) { btn.onclick = function () { doPunch(btn.dataset.punch, after); }; });
  }
  var tickTimer = null;
  function tpeNow() {
    var d = new Date();
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
  async function doPunch(kind, after) {
    var t = await api('attPunch', { kind: kind });
    if (t.needConfirm) {
      var ok = await BM.ask('要覆蓋今天的' + t.kindLabel + '卡嗎？\n今天已在 ' + t.prev + ' 打過' + t.kindLabel + '卡', { ok: '確定覆蓋' });
      if (!ok) return;
      t = await api('attPunch', { kind: kind, overwrite: true });
    }
    var d = t.day, tm = t.done.time;
    if (kind === 'in' && d.reasons && d.reasons.length) BM.notice(tm + ' 上班打卡成功', '已超過 9:30', { tone: 'warn' });
    else if (kind === 'out' && d.status === 'abnormal') BM.notice(tm + ' 下班打卡成功', d.reasons.join('、'), { tone: 'warn' });
    else BM.toast((kind === 'in' ? '上班' : '下班') + '打卡成功 ' + tm);
    if (after) after(t);
  }

  // ======================= 出勤明細 =======================
  function dayBadge(d, showReasons) {
    if (d.status === 'before') return '';
    var s = ST_LABEL[d.status] || ['', 'gray'];
    var label = d.status === 'off' ? (d.holiday || '休假日') : s[0];
    var rs = showReasons !== false && d.reasons && d.reasons.length && d.status !== 'ok' ? d.reasons : [];
    return '<span class="badge ' + s[1] + '">' + esc(label) + '</span>' + (rs.length ? '<span class="att-reason">' + esc(rs.join('、')) + '</span>' : '');
  }
  function tm(t, fix) { return t ? t + (fix ? '<span class="fx">補</span>' : '') : '—'; }
  function renderDetail(body) {
    if (!S.ym) S.ym = BM.today().slice(0, 7);
    var k = key('m_' + (S.who || 'me') + '_' + S.ym);
    var draw = function (m) {
      if (!alive() || S.tab !== 'detail') return;
      var thisMonth = S.ym >= BM.today().slice(0, 7);
      var people = m.people || [];
      var bar = '<div class="att-month-bar"><button class="btn small ghost" id="mPrev" aria-label="上個月">‹</button><b>' + S.ym.replace('-', ' 年 ') + ' 月</b>' +
        '<button class="btn small ghost" id="mNext" aria-label="下個月"' + (thisMonth ? ' disabled' : '') + '>›</button>' +
        (people.length ? '<select class="input mini att-who" id="mWho"><option value="all"' + (S.who === 'all' ? ' selected' : '') + '>全部</option>' +
          people.map(function (p) { return '<option value="' + esc(p.id) + '"' + ((S.who || myId(people)) === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' : '') +
        '<span class="grow"></span>' + (m.canExport || people.length ? '<button class="btn small" id="mXlsx">匯出 Excel</button>' : '') + '</div>';
      if (S.who === 'all') body.innerHTML = bar + allTable(m);
      else {
        var s = m.summary;
        var mine = !S.who || S.who === myId(people);
        body.innerHTML = bar + '<div class="att-sum">' + sumCell('出勤天數', s.present) + sumCell('正常', s.ok) + sumCell('異常', s.abnormal, s.abnormal) + sumCell('補登', s.fix) + '</div>' +
          (m.days.length ? '<div class="card att-days">' + m.days.map(function (d) { return dayRow(d, m.detail, mine); }).join('') + '</div>' : '<div class="card empty">沒有資料</div>');
      }
      $('#mPrev').onclick = function () { S.ym = shiftYm(S.ym, -1); renderDetail(body); };
      $('#mNext').onclick = function () { S.ym = shiftYm(S.ym, 1); renderDetail(body); };
      if ($('#mWho')) $('#mWho').onchange = function () { S.who = this.value === myId(people) ? '' : this.value; renderDetail(body); };
      if ($('#mXlsx')) $('#mXlsx').onclick = function () { exportXlsx(m); };
      $$('[data-fix]', body).forEach(function (b) {
        b.onclick = function () { S.prefill = JSON.parse(b.dataset.fix); S.applyType = 'fix'; S.edit = null; BM.go('attendance/apply'); };
      });
      $$('[data-sort]', body).forEach(function (th) {
        th.onclick = function () {
          var kk = th.dataset.sort;
          S.sort = S.sort.key === kk ? { key: kk, dir: -S.sort.dir } : { key: kk, dir: kk === 'date' ? -1 : 1 };
          draw(m);
        };
      });
    };
    if (!BM.cached(k)) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(k, function () { return BM.api('attMonth', { token: token(), ym: S.ym, staffId: S.who }); }, draw);
  }
  function myId(people) { var m = people.filter(function (p) { return p.name.split(' ').pop() === S.me.name; })[0]; return m ? m.id : ''; }
  function sumCell(label, n, warn) { return '<div class="' + (warn ? 'warn' : '') + '"><b>' + n + '</b><span>' + label + '</span></div>'; }
  // 異常的那一天：「申請補登」自動帶入缺的部分
  function fixPrefill(d) {
    var p = { date: d.date, inTime: '', outTime: '', useIn: false, useOut: false };
    d.reasons.forEach(function (r) {
      if (r === '缺上班卡') p.useIn = true;
      else if (r === '缺下班卡') p.useOut = true;
      else {
        var g = r.match(/(\d{2}:\d{2})–(\d{2}:\d{2})/);
        if (!g) return;
        if (g[1] === '09:30' || (d.inTime && g[2] === d.inTime)) { p.useIn = true; p.inTime = g[1]; }
        else { p.useOut = true; p.outTime = g[2]; }
      }
    });
    return p;
  }
  function dayRow(d, detail, mine) {
    var off = !d.workday;
    var act = '';
    if (mine && d.status === 'abnormal') {
      act = d.pendingFix ? '<button class="btn small" disabled>補登申請中</button>' :
        '<button class="btn small" data-fix="' + esc(JSON.stringify(fixPrefill(d))) + '">申請補登</button>';
    }
    return '<div class="att-day' + (off ? ' off' : '') + '">' +
      '<div class="ad-date">' + md(d.date) + '（' + wd(d.date) + '）</div>' +
      '<div class="ad-times">' + (d.inTime || d.outTime ? tm(d.inTime, d.inFix) + '<span class="muted">→</span>' + tm(d.outTime, d.outFix) : '<span class="muted">—</span>') + '</div>' +
      '<div class="ad-st">' + (off && !d.inTime && !d.outTime ? '' : dayBadge(d, detail !== false)) + '</div>' +
      '<div class="ad-act">' + act + '</div></div>';
  }
  function allTable(m) {
    var rows = m.rows.slice();
    var sk = S.sort.key, dir = S.sort.dir;
    var val = { date: function (r) { return r.date; }, name: function (r) { return r.staff; }, status: function (r) { return r.status === 'abnormal' ? 0 : r.status === 'ok' ? 2 : 1; } };
    rows.sort(function (a, b) {
      var x = val[sk](a), y = val[sk](b);
      var c = x < y ? -1 : x > y ? 1 : 0;
      return c * dir || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.staff.localeCompare(b.staff);
    });
    var th = function (k, label) {
      return '<th data-sort="' + k + '" class="sortable' + (sk === k ? ' on' : '') + '">' + label + '<span class="ar">' + (sk === k ? (dir > 0 ? '▲' : '▼') : '⇅') + '</span></th>';
    };
    return '<div class="card" style="padding:0;overflow:auto"><table class="grid att-all"><thead><tr>' + th('date', '日期') + th('name', '姓名') +
      '<th>上班</th><th>下班</th>' + th('status', '狀態') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        return '<tr><td>' + md(r.date) + '（' + wd(r.date) + '）</td><td>' + esc(r.staff) + '</td><td>' + tm(r.inTime, r.inFix) + '</td><td>' + tm(r.outTime, r.outFix) + '</td>' +
          '<td>' + (r.workday ? dayBadge(r, m.detail) : '<span class="badge gray">' + esc(r.holiday || '休假日') + '</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">—</td></tr>') + '</tbody></table></div>';
  }
  function stText(d) {
    if (!d.workday && !d.inTime && !d.outTime) return d.holiday || '休假日';
    return (ST_LABEL[d.status] || [''])[0] + (d.reasons && d.reasons.length && d.status !== 'ok' ? '：' + d.reasons.join('、') : '');
  }
  function exportXlsx(m) {
    var head = ['日期', '星期', '姓名', '上班', '下班', '狀態'];
    var rows;
    if (S.who === 'all') {
      rows = m.rows.map(function (r) { return [r.date, wd(r.date), r.staff, r.inTime + (r.inFix ? '（補登）' : ''), r.outTime + (r.outFix ? '（補登）' : ''), stText(r)]; });
    } else {
      rows = m.days.slice().reverse().map(function (d) { return [d.date, wd(d.date), m.staff, d.inTime + (d.inFix ? '（補登）' : ''), d.outTime + (d.outFix ? '（補登）' : ''), stText(d)]; });
    }
    BM.xlsx('出勤明細_' + S.ym + (S.who === 'all' ? '_全部' : '_' + m.staff.split(' ').pop()) + '.xlsx', [{ name: S.ym, rows: [head].concat(rows) }]);
  }

  // ======================= 申請（補登打卡／請假／加班） =======================
  function statusChip(r) {
    var s = STATUS[r.status] || [r.status, 'gray'];
    var txt = r.status === 'pending' ? (r.mode === 'cancel' ? '取消審核中' : r.mode === 'edit' ? '修改審核中' : '審核中') : s[0];
    return '<span class="badge ' + (r.status === 'pending' ? 'warn' : s[1]) + '">' + txt + '</span>';
  }
  function renderApply(body) {
    var types = [['fix', '補登打卡'], ['leave', '請假'], ['ot', '加班']];
    body.innerHTML = '<div class="card att-form">' +
      '<div class="att-types">' + types.map(function (t) { return '<button type="button" data-type="' + t[0] + '" class="' + (S.applyType === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div id="attForm"></div></div>' +
      '<div class="section-title">我的申請</div><div id="attMine"><div class="card empty">讀取中…</div></div>';
    $$('[data-type]', body).forEach(function (b) {
      b.onclick = function () { S.applyType = b.dataset.type; S.edit = null; S.prefill = null; renderApply(body); };
    });
    var f = $('#attForm', body);
    if (S.applyType === 'fix') fixForm(f);
    if (S.applyType === 'leave') leaveForm(f);
    if (S.applyType === 'ot') otForm(f);
    loadMine();
  }
  function afterSave(res) {
    BM.toast(res.status === 'approved' ? '已送出並生效' : '已送出');
    S.edit = null; S.prefill = null;
    ['reqs', 'bal'].forEach(function (k) { BM.cache(key(k), null); });
    BM.cache(key('m_me_' + (S.ym || BM.today().slice(0, 7))), null);
    renderApply($('#attBody'));
  }
  function editNote() { return S.edit ? '<div class="att-editing">修改：' + esc(S.edit.summary) + ' <button type="button" class="link-btn" id="edCancel">取消修改</button></div>' : ''; }
  function bindEditCancel(el) { if ($('#edCancel', el)) $('#edCancel', el).onclick = function () { S.edit = null; renderApply($('#attBody')); }; }

  function fixForm(el) {
    var d = S.prefill || (S.edit ? (function (x) {
      var o = { date: x.date, inTime: x.inTime || (x.kind === 'in' ? x.time : ''), outTime: x.outTime || (x.kind === 'out' ? x.time : ''), reason: x.reason };
      o.useIn = !!o.inTime; o.useOut = !!o.outTime; return o;
    })(S.edit.pendingData || S.edit.data) : { date: BM.today(), useIn: false, useOut: false });
    el.innerHTML = editNote() +
      '<label class="f" for="fxDate">日期</label><input class="input" id="fxDate" type="date" max="' + BM.today() + '" value="' + esc(d.date || BM.today()) + '" style="max-width:260px">' +
      punchRow('In', '上班', d.useIn, d.inTime) + punchRow('Out', '下班', d.useOut, d.outTime) +
      '<label class="f" for="fxReason">原因</label><input class="input" id="fxReason" maxlength="200" value="' + esc(d.reason || '') + '">' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" id="fxOk">送出</button></div>';
    bindEditCancel(el);
    ['In', 'Out'].forEach(function (k) {
      var c = $('#fxUse' + k, el), t = $('#fxTime' + k, el);
      c.onchange = function () { t.disabled = !c.checked; if (c.checked) t.focus(); };
    });
    $('#fxOk', el).onclick = async function () {
      var data = { date: $('#fxDate', el).value, inTime: $('#fxUseIn', el).checked ? $('#fxTimeIn', el).value : '', outTime: $('#fxUseOut', el).checked ? $('#fxTimeOut', el).value : '', reason: $('#fxReason', el).value.trim() };
      if (!data.inTime && !data.outTime) return BM.toast('請勾選上班或下班並填寫時間', true);
      if (!data.reason) return BM.toast('請填寫原因', true);
      afterSave(await api('attSaveFix', { id: S.edit ? S.edit.id : '', data: data }));
    };
  }
  function punchRow(k, label, on, time) {
    return '<div class="att-prow"><label class="chk' + (on ? ' on' : '') + '"><input type="checkbox" id="fxUse' + k + '"' + (on ? ' checked' : '') + '>' + label + '</label>' +
      '<input class="input" id="fxTime' + k + '" type="time" value="' + esc(time || '') + '"' + (on ? '' : ' disabled') + '></div>';
  }

  // 請假：時間用 30 分鐘一格的選單；選了假別就顯示剩餘
  function timeOptions(sel) {
    var out = '';
    for (var m = 9 * 60; m <= 18 * 60; m += 30) { var v = ATT.fmtMin(m); out += '<option' + (v === sel ? ' selected' : '') + '>' + v + '</option>'; }
    return out;
  }
  async function leaveForm(el) {
    el.innerHTML = '<div class="card empty" style="border:0">讀取中…</div>';
    var b = BM.cached(key('bal'));
    if (!b) { b = await api('attBalances', {}); BM.cache(key('bal'), b); }
    if (!alive()) return;
    var d = S.edit ? (S.edit.pendingData || S.edit.data) : { leaveType: '', fromDate: BM.today(), toDate: BM.today(), fromTime: '09:00', toTime: '18:00' };
    var bal = {};
    b.balances.forEach(function (x) { bal[x.key] = x; });
    var files = (d.files || []).slice();
    var types = b.types.types.filter(function (t) { return bal[t.key]; });
    el.innerHTML = editNote() +
      '<div class="row2"><div><label class="f" for="lvType">假別</label><select class="input" id="lvType"><option value="">請選擇</option>' + types.map(function (t) {
        return '<option value="' + t.key + '"' + (t.key === d.leaveType ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('') + '</select></div>' +
      '<div id="lvBalWrap"><label class="f">剩餘</label><div class="att-bal" id="lvBal"></div></div></div>' +
      '<div class="row2" id="lvEvWrap" hidden><div><label class="f" for="lvEv" id="lvEvLbl">日期</label><input class="input" type="date" id="lvEv" value="' + esc(d.eventDate || '') + '"></div>' +
      '<div id="lvRelWrap" hidden><label class="f" for="lvRel">親屬</label><select class="input" id="lvRel"><option value="">請選擇</option>' + b.types.funeral.map(function (f) {
        return '<option value="' + f.key + '"' + (f.key === d.relation ? ' selected' : '') + '>' + esc(f.name) + '（' + f.days + ' 天）</option>';
      }).join('') + '</select></div></div>' +
      '<div class="row2"><div><label class="f" for="lvFromD">開始</label><div class="att-dt"><input class="input" type="date" id="lvFromD" value="' + esc(d.fromDate) + '"><select class="input" id="lvFromT">' + timeOptions(d.fromTime) + '</select></div></div>' +
      '<div><label class="f" for="lvToD">結束</label><div class="att-dt"><input class="input" type="date" id="lvToD" value="' + esc(d.toDate) + '"><select class="input" id="lvToT">' + timeOptions(d.toTime) + '</select></div></div></div>' +
      '<label class="f">共</label><div class="att-total" id="lvTotal"></div>' +
      '<label class="f" for="lvReason">原因</label><input class="input" id="lvReason" maxlength="200" value="' + esc(d.reason || '') + '">' +
      '<label class="f">附件</label><div class="att-files" id="lvFiles"></div>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" id="lvOk">送出</button></div>';
    bindEditCancel(el);
    var drawFiles = function () {
      $('#lvFiles', el).innerHTML = files.map(function (f, i) {
        return '<span class="file-chip">' + esc(f.name) + '<button type="button" data-rm="' + i + '" aria-label="移除">×</button></span>';
      }).join('') + (files.length < 5 ? '<label class="file-add">＋ 上傳檔案或照片<input type="file" id="lvPick" accept="image/*,application/pdf" multiple hidden></label>' : '');
      $$('[data-rm]', el).forEach(function (x) { x.onclick = function () { files.splice(+x.dataset.rm, 1); drawFiles(); }; });
      var pick = $('#lvPick', el);
      if (pick) pick.onchange = async function () {
        var list = Array.prototype.slice.call(pick.files, 0, 5 - files.length);
        for (var i = 0; i < list.length; i++) files.push(await uploadFile(list[i]));
        drawFiles();
      };
    };
    drawFiles();
    var upd = function () {
      var t = $('#lvType', el).value, x = bal[t];
      var tt = types.filter(function (y) { return y.key === t; })[0] || {};
      $('#lvEvWrap', el).hidden = !tt.event;
      $('#lvRelWrap', el).hidden = !tt.relation;
      $('#lvEvLbl', el).textContent = tt.event || '日期';
      $('#lvBalWrap', el).style.visibility = t ? '' : 'hidden';
      var rem = x ? x.remaining : null, period = x ? x.period : '';
      if (tt.relation) { var rel = b.types.funeral.filter(function (f) { return f.key === $('#lvRel', el).value; })[0]; rem = rel ? rel.days * 480 : null; }
      if (tt.event) {
        var w = ATT.eventWindow(t, $('#lvEv', el).value);
        period = w ? w.to.replace(/-/g, '/') + ' 前' : '';
      }
      $('#lvBal', el).innerHTML = rem !== null && rem !== undefined ? '<b>' + esc(ATT.fmtDays(rem)) + '</b>' + (period ? '<span>' + esc(period) + '</span>' : '') : '<span class="muted">—</span>';
      var fd = $('#lvFromD', el).value, td = $('#lvToD', el).value;
      if (td < fd) { $('#lvToD', el).value = fd; td = fd; }
      var mins = fd && td ? ATT.leaveMinutes(fd, $('#lvFromT', el).value, td, $('#lvToT', el).value, function (dd) { var w = ATT.weekday(dd); return w !== 0 && w !== 6; }) : 0;
      $('#lvTotal', el).textContent = ATT.fmtDays(mins);
    };
    ['lvType', 'lvEv', 'lvRel', 'lvFromD', 'lvFromT', 'lvToD', 'lvToT'].forEach(function (id) { $('#' + id, el).onchange = upd; });
    upd();
    $('#lvOk', el).onclick = async function () {
      if (!$('#lvType', el).value) return BM.toast('請選擇假別', true);
      var data = { leaveType: $('#lvType', el).value, relation: $('#lvRel', el).value, eventDate: $('#lvEv', el).value, fromDate: $('#lvFromD', el).value, fromTime: $('#lvFromT', el).value,
        toDate: $('#lvToD', el).value, toTime: $('#lvToT', el).value, reason: $('#lvReason', el).value.trim(), files: files };
      afterSave(await api('attSaveLeave', { id: S.edit ? S.edit.id : '', data: data }));
      BM.cache(key('bal'), null);
    };
  }
  // 上傳一個附件（照片或 PDF）
  function uploadFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 8 * 1024 * 1024) { BM.toast('檔案太大（上限 8 MB）', true); return reject(new Error('too big')); }
      var r = new FileReader();
      r.onload = function () {
        var b64 = String(r.result).split(',')[1];
        api('attUpload', { name: file.name, mimeType: file.type, base64: b64 }).then(resolve, reject);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // 加班：選日期後帶出當天打卡，預設從應下班時間到下班卡
  function otForm(el) {
    var d = S.edit ? (S.edit.pendingData || S.edit.data) : { date: BM.today(), comp: true };
    el.innerHTML = editNote() +
      '<div class="row2"><div><label class="f" for="otDate">日期</label><input class="input" id="otDate" type="date" max="' + BM.today() + '" value="' + esc(d.date) + '"></div>' +
      '<div><label class="f">當天打卡</label><div class="input att-ro" id="otPunch">—</div></div></div>' +
      '<div class="row2"><div><label class="f" for="otFrom">開始</label><input class="input" id="otFrom" type="time" value="' + esc(d.from || '') + '"></div>' +
      '<div><label class="f" for="otTo">結束</label><input class="input" id="otTo" type="time" value="' + esc(d.to || '') + '"></div></div>' +
      '<div class="row2"><div><label class="f">共</label><div class="att-total" id="otTotal">—</div></div>' +
      '<div><label class="f">換成</label><div class="att-seg"><button type="button" data-comp="1" class="' + (d.comp ? 'on' : '') + '">補休</button><button type="button" data-comp="0" class="' + (d.comp ? '' : 'on') + '">加班費</button></div></div></div>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" id="otOk">送出</button></div>';
    bindEditCancel(el);
    var comp = !!d.comp;
    $$('[data-comp]', el).forEach(function (b) {
      b.onclick = function () { comp = b.dataset.comp === '1'; $$('[data-comp]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); };
    });
    var day = null;
    var calc = function () {
      var a = ATT.toMin($('#otFrom', el).value), b2 = ATT.toMin($('#otTo', el).value);
      var mins = a !== null && b2 !== null && b2 > a ? b2 - a : 0;
      if (day && !day.workday && mins) mins -= Math.max(0, Math.min(b2, 810) - Math.max(a, 750));
      $('#otTotal', el).textContent = mins ? ATT.fmtDur(mins) : '—';
    };
    var loadDay = async function (fill) {
      var date = $('#otDate', el).value;
      if (!date) return;
      var ym = date.slice(0, 7), k = key('m_me_' + ym);
      var m = BM.cached(k) || await api('attMonth', { ym: ym }, { silent: true });
      BM.cache(k, m);
      day = m.days.filter(function (x) { return x.date === date; })[0] || null;
      $('#otPunch', el).textContent = day && (day.inTime || day.outTime) ? (day.inTime || '—') + ' → ' + (day.outTime || '—') : '—';
      if (fill && day && day.outTime) {
        $('#otFrom', el).value = day.workday ? day.expectedOut : day.inTime;
        $('#otTo', el).value = day.outTime;
      }
      calc();
    };
    $('#otDate', el).onchange = function () { loadDay(true); };
    $('#otFrom', el).onchange = calc; $('#otTo', el).onchange = calc;
    loadDay(!S.edit);
    $('#otOk', el).onclick = async function () {
      var data = { date: $('#otDate', el).value, from: $('#otFrom', el).value, to: $('#otTo', el).value, comp: comp };
      afterSave(await api('attSaveOt', { id: S.edit ? S.edit.id : '', data: data }));
    };
  }

  function loadMine() {
    var draw = function (list) {
      var box = $('#attMine');
      if (!box) return;
      box.innerHTML = list.length ? '<div class="card">' + list.slice(0, 50).map(function (r) {
        return '<a href="#" class="att-req-row" data-req="' + esc(r.id) + '"><span class="grow">' + esc(r.title) + '・' + esc(r.summary) + '</span>' + statusChip(r) + '</a>';
      }).join('') + '</div>' : '<div class="card empty">—</div>';
      $$('[data-req]', box).forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); openReq(list.filter(function (r) { return r.id === a.dataset.req; })[0]); };
      });
    };
    BM.swr(key('reqs'), function () { return BM.api('attMyReqs', { token: token() }); }, draw);
  }
  function historyHtml(r) {
    return '<div class="att-hist">' + (r.history || []).map(function (h) {
      return '<div><span class="muted">' + esc(String(h.t).slice(5, 16).replace('T', ' ').replace('-', '/')) + '</span> ' + esc(h.by) + ' ' +
        esc(ACT[h.act] || h.act) + (h.note ? '：' + esc(h.note) : '') + '</div>';
    }).join('') + '</div>';
  }
  // 申請單內容：自己的可以修改、取消；審核人可以核准、退件
  function openReq(r, onDone) {
    if (!r) return;
    var canEdit = r.mine && r.status !== 'cancelled' && r.mode !== 'cancel';
    var canCancel = r.mine && ['pending', 'approved', 'rejected'].indexOf(r.status) >= 0 && r.mode !== 'cancel';
    var m = BM.modal('<h2>' + esc((r.mine ? '' : r.staff + '・') + r.title) + ' ' + statusChip(r) + '</h2>' +
      '<div class="att-req-main">' + esc(r.summary) + '</div>' +
      ((r.pendingData || r.data || {}).reason ? '<div class="small muted">' + esc((r.pendingData || r.data).reason) + '</div>' : '') +
      (((r.pendingData || r.data || {}).files || []).length ? '<label class="f">附件</label><div class="att-thumbs" id="rqFiles">' + (r.pendingData || r.data).files.map(function (f) {
        return '<button type="button" class="att-th' + (/^image\//.test(f.mime) ? ' img' : ' pdf') + '" data-fid="' + esc(f.id) + '">' + (/^image\//.test(f.mime) ? '' : 'PDF') + '<small>' + esc(f.name) + '</small></button>';
      }).join('') + '</div>' : '') +
      historyHtml(r) +
      (r.canDecide ? '<label class="f" for="rqNote">備註</label><input class="input" id="rqNote" maxlength="200">' +
        '<div class="btn-row"><button class="btn danger" id="rqNo">退件</button><button class="btn" id="rqOk">核准</button></div>' :
        (canEdit || canCancel ? '<div class="btn-row">' + (canCancel ? '<button class="btn ghost" id="rqCancel">' + (r.mode === 'edit' ? '撤回修改' : '取消申請') + '</button>' : '') +
          (canEdit ? '<button class="btn" id="rqEdit">修改</button>' : '') + '</div>' : '')));
    var el = m.el;
    // 附件：從後端讀取（不公開），照片顯示縮圖，點了另開
    $$('[data-fid]', el).forEach(function (bt) {
      var got = null;
      var load = function () {
        if (!got) got = BM.api('attFile', { token: token(), id: r.id, fileId: bt.dataset.fid }).then(function (x) {
          var bin = atob(x.base64), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return URL.createObjectURL(new Blob([arr], { type: x.mime }));
        });
        return got;
      };
      if (bt.classList.contains('img')) load().then(function (u) { bt.style.backgroundImage = 'url("' + u + '")'; }).catch(function () { });
      bt.onclick = function () { load().then(function (u) { window.open(u, '_blank', 'noopener'); }).catch(function (e) { BM.toast(e.message, true); }); };
    });
    var done = function () { BM.cache(key('reqs'), null); BM.cache(key('bal'), null); m.close(); if (onDone) onDone(); else if (S.tab === 'apply' && alive()) renderApply($('#attBody')); };
    if ($('#rqEdit', el)) $('#rqEdit', el).onclick = function () { m.close(); S.edit = r; S.applyType = r.type; S.prefill = null; if (S.tab === 'apply' && alive()) renderApply($('#attBody')); else BM.go('attendance/apply'); };
    if ($('#rqCancel', el)) $('#rqCancel', el).onclick = async function () {
      if (!await BM.ask(r.mode === 'edit' ? '撤回這次修改？' : '取消這張申請？')) return;
      await api('attCancel', { id: r.id }); BM.toast('已送出'); done();
    };
    if ($('#rqOk', el)) $('#rqOk', el).onclick = async function () {
      await api('attDecide', { id: r.id, approve: true, note: $('#rqNote', el).value.trim() }); BM.toast('已核准'); done();
    };
    if ($('#rqNo', el)) $('#rqNo', el).onclick = async function () {
      var note = $('#rqNote', el).value.trim();
      if (!note) return BM.toast('請在備註填寫退件原因', true);
      await api('attDecide', { id: r.id, approve: false, note: note }); BM.toast('已退件'); done();
    };
  }
  // 從首頁或「待我審核」直接打開某一張申請單
  async function openReqById(id, onDone) {
    var r = await api('attReq', { id: id });
    openReq(r, onDone);
  }

  // ======================= 工作日曆（HR） =======================
  // ======================= 出勤設定（HR）：工作日曆、假別額度 =======================
  function renderSettings(body) {
    S.setSeg = S.setSeg || 'cal';
    body.innerHTML = '<div class="seg-tabs"><button type="button" data-seg="cal" class="' + (S.setSeg === 'cal' ? 'on' : '') + '">工作日曆</button>' +
      '<button type="button" data-seg="quota" class="' + (S.setSeg === 'quota' ? 'on' : '') + '">假別額度</button></div><div id="setBody"></div>';
    $$('[data-seg]', body).forEach(function (b) { b.onclick = function () { S.setSeg = b.dataset.seg; renderSettings(body); }; });
    if (S.setSeg === 'quota') return renderQuota($('#setBody', body));
    return renderCalendar($('#setBody', body));
  }
  async function renderQuota(el) {
    el.innerHTML = '<div class="card empty">讀取中…</div>';
    var ym = BM.today().slice(0, 7);
    var m = BM.cached(key('m_me_' + ym)) || await api('attMonth', { ym: ym }, { silent: true });
    var people = (m.people || []).filter(function (p) { return p.active !== false; });
    if (!alive() || !el.isConnected) return;
    S.qWho = S.qWho || (people[0] && people[0].id) || '';
    S.qYear = S.qYear || BM.today().slice(0, 4);
    var y0 = Number(BM.today().slice(0, 4));
    el.innerHTML = '<div class="bar-row"><select class="input" id="qWho" style="max-width:220px">' + people.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === S.qWho ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('') + '</select><select class="input" id="qYear" style="max-width:130px">' + [y0 + 1, y0, y0 - 1].map(function (y) {
      return '<option value="' + y + '"' + (String(y) === S.qYear ? ' selected' : '') + '>' + y + ' 年</option>';
    }).join('') + '</select><span class="small muted" id="qInfo"></span></div><div id="qTable"><div class="card empty">讀取中…</div></div>';
    $('#qWho', el).onchange = function () { S.qWho = this.value; renderQuota(el); };
    $('#qYear', el).onchange = function () { S.qYear = this.value; renderQuota(el); };
    var r = await api('attBalances', { staffId: S.qWho, year: S.qYear });
    if (!$('#qTable', el)) return;
    $('#qInfo', el).textContent = [r.hireDate ? '到職 ' + r.hireDate.replace(/-/g, '/') : '', r.gender === 'F' ? '女' : r.gender === 'M' ? '男' : '', r.aboriginal ? '原住民' : ''].filter(Boolean).join('・');
    var hrs = function (min) { return min ? String(Math.round(min / 6) / 10) : ''; };
    var quota = function (x) {
      if (x.key === 'funeral') return '依親屬 8／6／3 天';
      if (x.total === null) return '—';
      return (x.unit === 'month' ? '每月 ' : '') + ATT.fmtDays(x.total) + (x.key === 'family' ? '（併入事假）' : '') + (x.unit === 'event' ? '（每次）' : '');
    };
    $('#qTable', el).innerHTML = '<div class="card" style="padding:0;overflow:auto"><table class="grid q-t"><thead><tr><th>假別</th><th>額度</th><th>已用</th><th>剩餘</th><th>手動調整（小時）</th></tr></thead><tbody>' +
      r.balances.map(function (x) {
        if (x.closed) return '<tr class="na"><td>' + esc(x.name) + '</td><td colspan="3">第一次申請時開啟（' + ATT.fmtDays(x.legal * 480) + '）</td><td><input class="input q-in" type="number" step="0.5" data-adj="' + x.key + '"></td></tr>';
        return '<tr><td>' + esc(x.name) + '</td><td>' + esc(quota(x)) + '</td><td>' + (x.unit === 'month' ? '本月 ' : '') + esc(ATT.fmtDays(x.used)) + '</td>' +
          '<td><b>' + (x.remaining === null ? '—' : esc(ATT.fmtDays(x.remaining))) + '</b></td>' +
          '<td>' + (x.key === 'funeral' || x.key === 'injury' || x.key === 'official' ? '' : '<input class="input q-in" type="number" step="0.5" data-adj="' + x.key + '" value="' + hrs(x.adjust) + '">') + '</td></tr>';
      }).join('') + '</tbody></table></div><div class="btn-row" style="justify-content:flex-end"><button class="btn" id="qSave">儲存</button></div>';
    $('#qSave', el).onclick = async function () {
      var adj = {};
      $$('[data-adj]', el).forEach(function (i) { adj[i.dataset.adj] = Math.round((Number(i.value) || 0) * 60); });
      await api('attAdjust', { staffId: S.qWho, year: S.qYear, adj: adj });
      BM.toast('已儲存');
      renderQuota(el);
    };
  }

  async function renderCalendar(body) {
    if (!S.calYm) S.calYm = BM.today().slice(0, 7);
    var y = S.calYm.slice(0, 4);
    var k = key('cal_' + y);
    var draw = function (c) {
      if (!alive() || S.tab !== 'settings' || S.setSeg !== 'cal' || !body.isConnected) return;
      var days = ATT.monthDays(S.calYm), first = ATT.weekday(days[0]);
      var cells = [];
      for (var i = 0; i < first; i++) cells.push('<div class="cal-d empty"></div>');
      days.forEach(function (d) {
        var ov = c.overrides.filter(function (o) { return o.date === d; });
        var g = c.days[d], w = ATT.weekday(d);
        var cls = 'cal-d', label = '';
        if (ov.length) { cls += ov.some(function (o) { return o.off; }) ? ' ty' : ' work'; label = ov.map(function (o) { return o.note + (o.region === '全' ? '' : '（' + o.region + '）'); }).join('、'); }
        else if (g) { cls += g.off ? ' hol' : ' work'; label = g.name; }
        else if (w === 0 || w === 6) cls += ' off';
        cells.push('<button type="button" class="' + cls + '" data-day="' + d + '"><b>' + Number(d.slice(8)) + '</b>' + (label ? '<small>' + esc(label) + '</small>' : '') + '</button>');
      });
      body.innerHTML = '<div class="att-month-bar"><button class="btn small ghost" id="cPrev">‹</button><b>' + S.calYm.replace('-', ' 年 ') + ' 月</b>' +
        '<button class="btn small ghost" id="cNext">›</button></div>' +
        '<div class="card"><div class="cal-grid">' + '日一二三四五六'.split('').map(function (x) { return '<div class="cal-h">' + x + '</div>'; }).join('') + cells.join('') + '</div></div>';
      $('#cPrev').onclick = function () { S.calYm = shiftYm(S.calYm, -1); renderCalendar(body); };
      $('#cNext').onclick = function () { S.calYm = shiftYm(S.calYm, 1); renderCalendar(body); };
      $$('[data-day]', body).forEach(function (b) { b.onclick = function () { openDay(b.dataset.day, c, body); }; });
    };
    if (!BM.cached(k)) body.innerHTML = '<div class="card empty">讀取中…</div>';
    BM.swr(k, function () { return BM.api('attCalendar', { token: token(), year: y }); }, draw);
  }
  function openDay(d, c, body) {
    var ov = c.overrides.filter(function (o) { return o.date === d; });
    var m = BM.modal('<h2>' + BM.fmtDate(d) + '</h2>' +
      (c.days[d] ? '<p class="small muted" style="margin:0">' + esc(c.days[d].name) + '</p>' : '') +
      (ov.length ? '<div class="card" style="margin-top:10px">' + ov.map(function (o) {
        return '<div class="att-row"><span class="grow">' + (o.region === '全' ? '全部' : o.region + '區') + '・' + (o.off ? '停班' : '上班') + '・' + esc(o.note) + '</span>' +
          '<button class="btn small danger" data-rm="' + esc(o.id) + '">取消</button></div>';
      }).join('') + '</div>' : '') +
      '<div class="row2"><div><label class="f" for="oRegion">地區</label><select class="input" id="oRegion"><option value="全">全部</option><option value="北">北區</option><option value="中">中區</option><option value="南">南區</option></select></div>' +
      '<div><label class="f">這一天</label><div class="att-seg"><button type="button" class="on" data-off="1">停班</button><button type="button" data-off="0">上班</button></div></div></div>' +
      '<label class="f" for="oNote">說明</label><input class="input" id="oNote" maxlength="30">' +
      '<div class="btn-row"><button class="btn block" id="oSave">儲存</button></div>');
    var el = m.el, off = true;
    $$('[data-off]', el).forEach(function (b) { b.onclick = function () { off = b.dataset.off === '1'; $$('[data-off]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    var after = function (res) { BM.cache(key('cal_' + d.slice(0, 4)), res); m.close(); renderCalendar(body); };
    $('#oSave', el).onclick = async function () {
      var note = $('#oNote', el).value.trim();
      if (!note) return BM.toast('請填寫說明', true);
      after(await api('attCalSave', { year: d.slice(0, 4), override: { date: d, region: $('#oRegion', el).value, off: off, note: note } }));
    };
    $$('[data-rm]', el).forEach(function (b) { b.onclick = async function () { after(await api('attCalRemove', { year: d.slice(0, 4), id: b.dataset.rm })); }; });
  }

  // ======================= 給首頁和「待我審核」用 =======================
  function reqCard(r, opts) {
    opts = opts || {};
    return '<div class="card att-req" data-id="' + esc(r.id) + '"><div class="rec-head"><b>' + esc((opts.who ? r.staff + '・' : '') + r.title) + '</b>' + statusChip(r) + '</div>' +
      '<div class="att-req-main">' + esc(r.summary) + '</div>' +
      (opts.decide && r.canDecide ? '<div class="btn-row"><button class="btn small" data-ok>核准</button><button class="btn small danger" data-no>退件</button></div>' : '') + '</div>';
  }

  BM.modules = BM.modules || {};
  BM.modules.attendance = {
    mount: mount, init: function (me) { S.me = me; }, tick: tick, todayCard: todayCard, punchButton: punchButton,
    doPunch: doPunch, bindPunch: bindPunch, reqCard: reqCard, historyHtml: historyHtml, openReqById: openReqById, openReq: openReq
  };
})();
