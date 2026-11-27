/* 寶漾行政系統：出勤規則核心
 * 網頁（測試模式）和後端共用同一份程式：後端的 gas/AttCore.gs 內容要和這個檔案完全相同。
 * 這裡只有規則與流程，不碰試算表或網頁畫面；存取資料由呼叫端提供（store、env）。 */
var ATT = (function () {
  // ---------------- 上下班規則 ----------------
  // 正常＝打卡時間（加上當天的假）有涵蓋 9:30–18:00。
  // 提早上班（9:30 前）的人，只要從上班起滿 9 小時（8 小時＋午休 1 小時）也算正常；9:30 以後才上班不適用。
  var RULE = {
    earliest: 7 * 60,        // 7:00 前打卡視為 7:00
    coreFrom: 9 * 60 + 30,   // 9:30
    coreTo: 18 * 60,         // 18:00
    workSpan: 9 * 60,        // 9 小時（含午休 1 小時）
    lunchFrom: 12 * 60 + 30,
    lunchTo: 13 * 60 + 30
  };
  var KIND_LABEL = { 'in': '上班', out: '下班' };
  var TYPE_LABEL = { fix: '補登打卡', leave: '請假', ot: '加班' };
  // 各種申請單要經過哪幾關（hr＝HR、manager＝直屬主管、finance＝財務）
  var FLOWS = { fix: ['hr', 'manager'], leave: ['hr', 'manager', 'finance'], ot: ['hr', 'manager', 'finance'] };
  var STAGE_LABEL = { hr: 'HR', manager: '主管', finance: '財務' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(t) { if (!t) return null; var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }
  function fmtMin(m) { if (m === null || m === undefined) return ''; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function fmtDur(m) { m = Math.max(0, Math.round(m)); var h = Math.floor(m / 60), r = m % 60; return (h ? h + ' 小時' : '') + (r || !h ? (h ? ' ' : '') + r + ' 分' : ''); }
  function weekday(date) { var p = date.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
  function addDays(date, n) {
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function monthDays(ym) {
    var p = ym.split('-'), n = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(ym + '-' + pad(i));
    return out;
  }
  // 最早可以下班的時間：9:30 前上班＝上班＋9 小時（最晚 18:00）；9:30 以後上班＝18:00
  function expectedOut(inMin) {
    if (inMin === null || inMin === undefined) return null;
    var s = Math.max(inMin, RULE.earliest);
    return s <= RULE.coreFrom ? Math.min(RULE.coreTo, s + RULE.workSpan) : RULE.coreTo;
  }

  // ---------------- 工作日 ----------------
  // cal：{ days: { 'yyyy-MM-dd': { off: true/false, name } }（政府辦公日曆）, overrides: [{ date, region: '全'/'北'/'中'/'南', off, note }] }
  function dayInfo(date, region, cal) {
    cal = cal || {};
    var ov = (cal.overrides || []).filter(function (o) { return o.date === date && !o.voided; });
    var mine = ov.filter(function (o) { return o.region === region; })[0] || ov.filter(function (o) { return o.region === '全'; })[0];
    if (mine) return { workday: !bool(mine.off), name: mine.note || (bool(mine.off) ? '停班' : '上班'), manual: true };
    var g = (cal.days || {})[date];
    if (g) return { workday: !g.off, name: g.name || '' };
    var wd = weekday(date);
    return { workday: wd !== 0 && wd !== 6, name: '' };
  }
  function bool(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

  // ---------------- 一天的出勤狀態 ----------------
  // 每天只有一個有效的上班卡和下班卡：同一種卡有好幾筆時，以最後建立的那筆為準
  // （再按一次會把舊的作廢；補登核准後也會蓋過原本的卡，取消補登就回到原本的卡）
  function effective(punches, kind) {
    var list = punches.filter(function (p) { return p.kind === kind; })
      .sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.time.localeCompare(b.time); });
    return list[list.length - 1] || null;
  }
  // 一段必須在班的時間 [from, to]，扣掉已涵蓋的區間（打卡、請假），回傳還缺的區段
  function gapsOf(from, to, covers) {
    var gaps = [[from, to]];
    covers.forEach(function (c) {
      var next = [];
      gaps.forEach(function (g) {
        if (c[1] <= g[0] || c[0] >= g[1]) { next.push(g); return; }
        if (c[0] > g[0]) next.push([g[0], c[0]]);
        if (c[1] < g[1]) next.push([c[1], g[1]]);
      });
      gaps = next;
    });
    return gaps.filter(function (g) { return g[1] > g[0]; });
  }

  // punches：當天這個人有效的打卡（{ time: 'HH:mm:ss', kind: 'in'/'out', source, createdAt }）
  // leaves：當天已核准的假（[{ from: 'HH:mm', to: 'HH:mm' }]；請假功能上線後才會有）
  // status：ok＝正常、abnormal＝異常、working＝今天還在上班中、none＝今天還沒打卡、off＝休假日
  function buildDay(date, punches, info, now, leaves) {
    var pin = effective(punches, 'in'), pout = effective(punches, 'out');
    var inT = pin ? pin.time : '', outT = pout ? pout.time : '';
    var inMin = toMin(inT), outMin = toMin(outT);
    var lv = (leaves || []).map(function (l) { return [toMin(l.from), toMin(l.to)]; });
    var exp = info.workday && inT ? expectedOut(inMin) : (info.workday ? RULE.coreTo : null);
    var today = date === now.date;
    var d = {
      date: date, workday: info.workday, holiday: info.name || '', inTime: inT.slice(0, 5), outTime: outT.slice(0, 5),
      inFix: !!(pin && pin.source === 'fix'), outFix: !!(pout && pout.source === 'fix'),
      expectedOut: fmtMin(exp), status: 'ok', reasons: [], missingIn: false, missingOut: false, leaveMin: 0
    };
    if (!info.workday) { d.status = 'off'; return d; }
    // 這一天必須在班的時段：9:30 到 應下班（9:30 前上班的人，滿 9 小時就可以下班）
    var need = [RULE.coreFrom, exp];
    // 整段都有請假：正常
    if (!gapsOf(need[0], need[1], lv).length) { d.status = 'ok'; d.reasons = ['請假']; return d; }
    if (today && !outT) {
      // 今天還沒下班：先不判斷（只提示 9:30 後才上班）
      d.status = inT ? 'working' : 'none';
      if (inT && inMin > RULE.coreFrom && gapsOf(RULE.coreFrom, inMin, lv).length) d.reasons = ['9:30 後才上班'];
      return d;
    }
    if (!inT) { d.missingIn = true; d.reasons.push('缺上班卡'); }
    if (!outT) { d.missingOut = true; d.reasons.push('缺下班卡'); }
    if (inT && outT) {
      var gaps = gapsOf(need[0], need[1], lv.concat([[Math.max(inMin, RULE.earliest), outMin]]));
      gaps.forEach(function (g) { d.reasons.push('缺 ' + fmtMin(g[0]) + '–' + fmtMin(g[1])); });
    }
    if (d.reasons.length) d.status = 'abnormal';
    return d;
  }

  // ---------------- 共用審核流程 ----------------
  // people：[{ id, en, role, managerId, region, active }]
  function approverId(stage, applicant, people) {
    var act = people.filter(function (p) { return p.active !== false; });
    if (stage === 'hr') { var a = act.filter(function (p) { return p.role === 'admin'; })[0]; return a ? a.id : ''; }
    if (stage === 'manager') {
      if (applicant.managerId && act.some(function (p) { return p.id === applicant.managerId; })) return applicant.managerId;
      var m = act.filter(function (p) { return p.role === 'manager'; })[0]; return m ? m.id : '';
    }
    if (stage === 'finance') { var f = act.filter(function (p) { return p.role === 'finance'; })[0]; return f ? f.id : ''; }
    return '';
  }
  // 從目前這關往後找：輪到申請人自己（或沒有審核人）的關卡自動跳過；全部通過回傳 true
  function advance(req, applicant, people, by, now) {
    while (req.stage < req.stages.length) {
      var who = approverId(req.stages[req.stage], applicant, people);
      if (who && who !== applicant.id) return false;
      req.history.push({ t: now, by: '系統', act: 'skip', note: STAGE_LABEL[req.stages[req.stage]] + '關自動跳過（' + (who ? '申請人本人' : '沒有審核人') + '）' });
      if (req.stages[req.stage] === 'hr') req.hrOk = true;
      req.stage++;
    }
    return true;
  }
  // 審核全部通過：回傳要對資料做的事（apply＝生效、replace＝改成新內容、unapply＝撤銷）
  function finish(req, now) {
    var eff;
    if (req.mode === 'cancel') { eff = { op: 'unapply', data: req.data }; req.status = 'cancelled'; }
    else if (req.mode === 'edit') { eff = { op: 'replace', from: req.data, data: req.pendingData }; req.data = req.pendingData; req.status = 'approved'; }
    else { eff = { op: 'apply', data: req.data }; req.status = 'approved'; }
    req.mode = ''; req.pendingData = null; req.stages = []; req.stage = 0; req.doneAt = now;
    return eff;
  }
  function start(req, applicant, people, stages, now) {
    req.stages = stages; req.stage = 0; req.status = 'pending';
    if (advance(req, applicant, people, '', now)) return finish(req, now);
    return null;
  }
  function currentApprover(req, applicant, people) {
    if (req.status !== 'pending' || req.stage >= req.stages.length) return '';
    return approverId(req.stages[req.stage], applicant, people);
  }


  // ---------------- 假別（勞基法、勞工請假規則、性別平等工作法） ----------------
  var DAY = 480; // 一天 8 小時（分鐘）
  // yearDays＝每年上限；monthDays＝每月上限；late＝可以事後一週內補請；relation＝依親屬關係決定天數
  var LEAVE_TYPES = [
    { key: 'annual', name: '特休' },
    { key: 'comp', name: '補休' },
    { key: 'personal', name: '事假', yearDays: 14 },
    { key: 'family', name: '家庭照顧假', yearDays: 7 },
    { key: 'sick', name: '病假', yearDays: 30, late: true },
    { key: 'menstrual', name: '生理假', monthDays: 1 },
    { key: 'marriage', name: '婚假', yearDays: 8 },
    { key: 'funeral', name: '喪假', late: true, relation: true },
    { key: 'injury', name: '公傷病假', late: true },
    { key: 'official', name: '公假' },
    { key: 'maternity', name: '產假', yearDays: 56 },
    { key: 'prenatal', name: '產檢假', yearDays: 7 },
    { key: 'paternity', name: '陪產檢及陪產假', yearDays: 7 },
    { key: 'aboriginal', name: '原住民族歲時祭儀假', yearDays: 1 }
  ];
  var FUNERAL = [
    { key: 'p', name: '父母、養父母、繼父母、配偶', days: 8 },
    { key: 'g', name: '祖父母、子女、配偶之父母', days: 6 },
    { key: 'o', name: '曾祖父母、兄弟姊妹、配偶之祖父母', days: 3 }
  ];
  function leaveType(k) { return LEAVE_TYPES.filter(function (t) { return t.key === k; })[0]; }
  function utc(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function isoOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function shiftDate(date, y, m) { var p = date.split('-'); return isoOf(Date.UTC(+p[0] + y, +p[1] - 1 + m, +p[2])); }
  // 特休天數（第 38 條）：滿半年 3 天、滿 1 年 7 天、2 年 10 天、3 年 14 天、5 年 15 天、10 年起每年加 1 天，最多 30 天
  function annualTier(n) { return n < 2 ? 7 : n < 3 ? 10 : n < 5 ? 14 : n < 10 ? 15 : Math.min(30, 15 + (n - 9)); }
  // 曆年制：每一段年資的特休，依落在這一年的天數比例分配，合計後以半天為單位無條件進位
  function annualMinutes(hireDate, year) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate || '')) return 0;
    var ys = utc(year + '-01-01'), ye = utc((Number(year) + 1) + '-01-01');
    var periods = [[shiftDate(hireDate, 0, 6), shiftDate(hireDate, 1, 0), 3]];
    for (var n = 1; n <= 45; n++) periods.push([shiftDate(hireDate, n, 0), shiftDate(hireDate, n + 1, 0), annualTier(n)]);
    var days = 0;
    periods.forEach(function (pr) {
      var a = utc(pr[0]), b = utc(pr[1]);
      var ov = Math.max(0, Math.min(b, ye) - Math.max(a, ys));
      if (ov > 0) days += pr[2] * ov / (b - a);
    });
    return Math.ceil(days * 2 - 1e-9) / 2 * DAY;
  }
  // 請假時數：只算工作日的 9:00–18:00，扣掉午休 12:30–13:30
  function leaveMinutes(fromDate, fromTime, toDate, toTime, isWorkday) {
    var total = 0;
    for (var d = fromDate, i = 0; d <= toDate && i < 400; d = addDays(d, 1), i++) {
      if (isWorkday && !isWorkday(d)) continue;
      var s = Math.max(540, d === fromDate ? toMin(fromTime) : 540), e = Math.min(1080, d === toDate ? toMin(toTime) : 1080);
      if (e > s) total += e - s - overlap(s, e, RULE.lunchFrom, RULE.lunchTo);
    }
    return total;
  }
  function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
  function fmtDays(m) {
    if (m === null || m === undefined) return '';
    m = Math.max(0, Math.round(m));
    var d = Math.floor(m / DAY), h = Math.floor((m % DAY) / 60), mm = m % 60;
    return [d ? d + ' 天' : '', h ? h + ' 小時' : '', mm ? mm + ' 分' : ''].filter(Boolean).join(' ') || '0';
  }
  function md(date) { return date.slice(5).replace('-', '/'); }

  // ---------------- 服務：store 和 env 由呼叫端提供 ----------------
  // store：all(table) 回傳物件陣列（複本）；insert(table, obj)；update(table, obj)（以 id 對應）
  // env：now() → { date, time: 'HH:mm:ss', stamp }；people()；cal(year)；audit(who, action, detail)；notify(toId, text)；uid()
  //      startDate()（選填）；canExport(me)（選填，能看全部人的出勤、匯出 Excel）；adjust(staffId, year, key)（選填，期初調整分鐘）
  function service(store, env) {
    var REQ_MEMO = null;
    function reqs() { if (!REQ_MEMO) REQ_MEMO = store.all('Requests'); return REQ_MEMO; }
    function person(id) { return env.people().filter(function (p) { return p.id === id; })[0]; }
    function en(id) { var p = person(id); return p ? p.en : ''; }
    function fullName(p) { return (p.name ? p.name + ' ' : '') + p.en; }
    function infoFor(date, p) { return dayInfo(date, p.region, env.cal(date.slice(0, 4))); }
    function isWorkdayFor(p) { return function (d) { return infoFor(d, p).workday; }; }
    function punchesOf(staffId, from, to) {
      return store.all('Punches').filter(function (x) { return x.staffId === staffId && !bool(x.voided) && x.date >= from && x.date <= to; });
    }
    function live(r) { return r.status === 'approved' || r.status === 'pending'; }
    function dataOf(r) { return r.pendingData || r.data || {}; }
    // 某人某天已核准的假（給正常／異常判斷用）
    function leavesOn(staffId, date) {
      return reqs().filter(function (r) {
        return r.staffId === staffId && r.type === 'leave' && r.status === 'approved' && r.data.fromDate <= date && r.data.toDate >= date;
      }).map(function (r) {
        return { from: date === r.data.fromDate ? r.data.fromTime : '09:00', to: date === r.data.toDate ? r.data.toTime : '18:00' };
      });
    }
    function fixParts(d) {
      if (d.kind) return { inTime: d.kind === 'in' ? d.time : '', outTime: d.kind === 'out' ? d.time : '' }; // 舊格式
      return { inTime: d.inTime || '', outTime: d.outTime || '' };
    }
    function dayOf(p, date, now, all) {
      var list = (all || punchesOf(p.id, date, date)).filter(function (x) { return x.date === date; });
      var d = buildDay(date, list, infoFor(date, p), now, leavesOn(p.id, date));
      // 出勤系統上線前、或到職前的日子：不判斷正常／異常
      var start = env.startDate ? env.startDate() : '';
      if (d.workday && ((start && date < start) || (p.hireDate && date < p.hireDate)) && !d.inTime && !d.outTime) {
        d.status = 'before'; d.reasons = []; d.missingIn = d.missingOut = false;
      }
      d.pendingFix = reqs().filter(function (r) { return r.staffId === p.id && r.type === 'fix' && r.status === 'pending' && dataOf(r).date === date; }).length;
      return d;
    }
    function canExport(me) { return me.role === 'admin' || !!(env.canExport && env.canExport(me)); }
    function activePeople() { return env.people().filter(function (p) { return p.active !== false; }); }
    // 異常原因：HR 和本人看得到；其他人看別人時只看正常／異常
    function canDetail(me, p) { return me.role === 'admin' || !p || me.id === p.id; }
    function detail(me, d, p) { if (!canDetail(me, p)) d.reasons = []; return d; }

    function title(r) {
      if (r.type === 'leave') { var t = leaveType(dataOf(r).leaveType); return t ? t.name : '請假'; }
      return TYPE_LABEL[r.type] || r.type;
    }
    function summary(r) {
      var d = dataOf(r);
      if (r.type === 'fix') {
        var f = fixParts(d);
        return md(d.date) + ' ' + [f.inTime ? '上班 ' + f.inTime : '', f.outTime ? '下班 ' + f.outTime : ''].filter(Boolean).join('、');
      }
      if (r.type === 'leave') {
        return md(d.fromDate) + ' ' + d.fromTime + ' – ' + (d.toDate === d.fromDate ? '' : md(d.toDate) + ' ') + d.toTime + '（' + fmtDays(d.minutes) + '）';
      }
      if (r.type === 'ot') return md(d.date) + ' ' + d.from + '–' + d.to + '（' + fmtDur(d.minutes) + '，' + (d.comp ? '補休' : '加班費') + '）';
      return '';
    }
    function reqView(r, viewer) {
      var p = person(r.staffId) || { id: r.staffId, en: '' };
      var who = currentApprover(r, p, env.people());
      return {
        id: r.id, type: r.type, typeLabel: TYPE_LABEL[r.type] || r.type, title: title(r), staff: p.en, staffName: fullName(p),
        mine: !!(viewer && viewer.id === r.staffId), data: r.data, pendingData: r.pendingData || null, mode: r.mode || '',
        status: r.status, hrOk: !!r.hrOk, stageLabel: r.status === 'pending' ? STAGE_LABEL[r.stages[r.stage]] : '',
        waitingFor: who ? en(who) : '', canDecide: !!(viewer && who && who === viewer.id), history: r.history || [],
        createdAt: r.createdAt, summary: summary(r)
      };
    }

    // ---------- 假勤餘額 ----------
    function balances(p, year, skipId, month) {
      var mine = reqs().filter(function (r) { return r.staffId === p.id && r.id !== skipId; });
      var used = {};
      mine.filter(function (r) { return r.type === 'leave' && live(r) && String(dataOf(r).fromDate).slice(0, 4) === String(year); }).forEach(function (r) {
        var d = dataOf(r);
        used[d.leaveType] = (used[d.leaveType] || 0) + Number(d.minutes || 0);
        if (d.leaveType === 'menstrual' && month && String(d.fromDate).slice(0, 7) === month) used.menstrualMonth = (used.menstrualMonth || 0) + Number(d.minutes || 0);
      });
      var adj = function (k) { return env.adjust ? Number(env.adjust(p.id, String(year), k) || 0) : 0; };
      var compIn = 0;
      mine.filter(function (r) { return r.type === 'ot' && r.status === 'approved' && r.data.comp && String(r.data.date).slice(0, 4) === String(year); })
        .forEach(function (r) { compIn += Number(r.data.minutes || 0); });
      return LEAVE_TYPES.map(function (t) {
        var u = used[t.key] || 0, total = null, unit = 'year';
        if (t.key === 'annual') total = annualMinutes(p.hireDate, year) + adj('annual');
        else if (t.key === 'comp') total = compIn + adj('comp');
        else if (t.monthDays) { total = t.monthDays * DAY; unit = 'month'; u = used.menstrualMonth || 0; }
        else if (t.yearDays) total = t.yearDays * DAY;
        var remain = total === null ? null : total - u;
        // 家庭照顧假併入事假計算：兩種合計一年 14 天
        if (t.key === 'personal') remain = Math.min(remain, 14 * DAY - (used.personal || 0) - (used.family || 0));
        if (t.key === 'family') remain = Math.min(remain, 14 * DAY - (used.personal || 0) - (used.family || 0));
        return { key: t.key, name: t.name, total: total, used: u, remaining: remain === null ? null : Math.max(0, remain), unit: unit,
          label: remain === null ? '' : (unit === 'month' ? '本月剩 ' : '剩 ') + fmtDays(Math.max(0, remain)) };
      });
    }

    // ---------- 各種申請單的檢查 ----------
    function noFuture(date, time, now, msg) {
      if (date > now.date || (time && date === now.date && time > now.time.slice(0, 5))) throw new Error(msg || '不能申請未來的時間');
    }
    function checkFix(me, data, now, skipId) {
      var x = { date: String(data.date || ''), inTime: String(data.inTime || ''), outTime: String(data.outTime || ''), reason: String(data.reason || '').trim().slice(0, 200) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error('請選擇日期');
      if (!x.inTime && !x.outTime) throw new Error('請勾選要補登的卡，並填寫時間');
      [x.inTime, x.outTime].forEach(function (t) { if (t && !/^\d{2}:\d{2}$/.test(t)) throw new Error('時間格式不正確'); });
      if (x.inTime && x.outTime && x.outTime <= x.inTime) throw new Error('下班時間要晚於上班時間');
      noFuture(x.date, x.outTime || x.inTime, now, '不能補登未來的時間');
      if (x.date < addDays(now.date, -400)) throw new Error('日期太久以前了');
      if (!x.reason) throw new Error('請填寫原因');
      var dup = reqs().filter(function (r) { return r.id !== skipId && r.staffId === me.id && r.type === 'fix' && r.status === 'pending' && dataOf(r).date === x.date; })[0];
      if (dup) throw new Error('這一天已經有一張補登在審核中');
      return x;
    }
    function checkLeave(me, data, now, skipId) {
      var t = leaveType(String(data.leaveType || ''));
      if (!t) throw new Error('請選擇假別');
      var x = { leaveType: t.key, fromDate: String(data.fromDate || ''), fromTime: String(data.fromTime || ''), toDate: String(data.toDate || ''),
        toTime: String(data.toTime || ''), relation: String(data.relation || ''), reason: String(data.reason || '').trim().slice(0, 200) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(x.toDate)) throw new Error('請選擇日期');
      if (!/^\d{2}:\d{2}$/.test(x.fromTime) || !/^\d{2}:\d{2}$/.test(x.toTime)) throw new Error('請選擇時間');
      if (toMin(x.fromTime) % 30 || toMin(x.toTime) % 30) throw new Error('請假以 30 分鐘為單位');
      if (x.toDate + x.toTime <= x.fromDate + x.fromTime) throw new Error('結束要晚於開始');
      if (x.fromDate.slice(0, 4) !== x.toDate.slice(0, 4)) throw new Error('跨年度的假請分兩張申請');
      // 期限：當天 9:30 前送出；病假、喪假、公傷病假可以在一週內補請
      if (t.late) { if (x.fromDate < addDays(now.date, -7)) throw new Error(t.name + '最晚要在一週內補請'); }
      else if (x.fromDate < now.date || (x.fromDate === now.date && now.time.slice(0, 5) > '09:30')) throw new Error('請假要在當天 9:30 前送出');
      x.minutes = leaveMinutes(x.fromDate, x.fromTime, x.toDate, x.toTime, isWorkdayFor(me));
      if (!x.minutes) throw new Error('這段時間不是上班時間');
      if (t.relation) {
        var rel = FUNERAL.filter(function (f) { return f.key === x.relation; })[0];
        if (!rel) throw new Error('請選擇親屬關係');
        if (x.minutes > rel.days * DAY) throw new Error('這個親屬關係的喪假最多 ' + rel.days + ' 天');
      }
      var b = balances(me, x.fromDate.slice(0, 4), skipId, x.fromDate.slice(0, 7)).filter(function (y) { return y.key === t.key; })[0];
      if (b && b.remaining !== null && x.minutes > b.remaining) throw new Error(t.name + '只剩 ' + fmtDays(b.remaining));
      var clash = reqs().filter(function (r) {
        if (r.id === skipId || r.staffId !== me.id || r.type !== 'leave' || !live(r)) return false;
        var d = dataOf(r);
        return d.fromDate + d.fromTime < x.toDate + x.toTime && x.fromDate + x.fromTime < d.toDate + d.toTime;
      })[0];
      if (clash) throw new Error('這段時間已經有請假：' + summary(clash));
      return x;
    }
    function checkOt(me, data, now, skipId) {
      var x = { date: String(data.date || ''), from: String(data.from || ''), to: String(data.to || ''), comp: !!data.comp };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error('請選擇日期');
      if (!/^\d{2}:\d{2}$/.test(x.from) || !/^\d{2}:\d{2}$/.test(x.to)) throw new Error('請填寫開始和結束時間');
      if (x.to <= x.from) throw new Error('結束要晚於開始');
      noFuture(x.date, x.to, now, '加班要在加班之後才申請');
      var d = dayOf(me, x.date, now);
      if (!d.inTime || !d.outTime) throw new Error('這一天沒有完整的上下班打卡');
      var ws = d.workday ? d.expectedOut : d.inTime, we = d.outTime;
      if (x.from < ws || x.to > we) throw new Error('加班時間要在 ' + ws + '–' + we + ' 之間');
      var a = toMin(x.from), b = toMin(x.to);
      x.minutes = b - a - (d.workday ? 0 : overlap(a, b, RULE.lunchFrom, RULE.lunchTo));
      if (x.minutes <= 0) throw new Error('加班時數要大於 0');
      var dup = reqs().filter(function (r) {
        if (r.id === skipId || r.staffId !== me.id || r.type !== 'ot' || !live(r)) return false;
        var e = dataOf(r);
        return e.date === x.date && e.from < x.to && x.from < e.to;
      })[0];
      if (dup) throw new Error('這段時間已經申請過加班');
      return x;
    }
    var CHECK = { fix: checkFix, leave: checkLeave, ot: checkOt };

    // 申請單生效／撤銷時，實際改動打卡資料（請假、加班不用改打卡，直接從申請單計算）
    function effect(r, eff, now) {
      if (!eff || r.type !== 'fix') return;
      if (eff.op === 'unapply' || eff.op === 'replace') {
        store.all('Punches').filter(function (x) { return x.reqId === r.id && !bool(x.voided); }).forEach(function (x) {
          x.voided = 'TRUE'; x.voidedAt = now.stamp; store.update('Punches', x);
        });
      }
      if (eff.op === 'apply' || eff.op === 'replace') {
        var f = fixParts(eff.data);
        [['in', f.inTime], ['out', f.outTime]].forEach(function (k) {
          if (!k[1]) return;
          store.insert('Punches', { id: env.uid(), staffId: r.staffId, date: eff.data.date, time: k[1] + ':00', kind: k[0],
            source: 'fix', reqId: r.id, voided: '', createdAt: now.stamp });
        });
      }
    }
    function notifyNext(r) {
      var p = person(r.staffId); if (!p) return;
      var who = currentApprover(r, p, env.people());
      if (who) env.notify(who, '📝 ' + p.en + ' 的' + title(r) + (r.mode === 'cancel' ? '（取消）' : r.mode === 'edit' ? '（修改）' : '') + '等你審核：' + summary(r));
    }
    function save(r, isNew) { if (isNew) store.insert('Requests', r); else store.update('Requests', r); REQ_MEMO = null; }
    function reqById(id) { var r = reqs().filter(function (x) { return x.id === id; })[0]; if (!r) throw new Error('找不到這張申請單'); return JSON.parse(JSON.stringify(r)); }

    // 新增或修改任何一種申請單（補登、請假、加班共用同一套審核流程）
    function saveReq(me, id, type, data) {
      var now = env.now();
      var people = env.people();
      if (!id) {
        if (!CHECK[type]) throw new Error('不支援的申請');
        var x = CHECK[type](me, data, now, '');
        var r = { id: env.uid(), type: type, staffId: me.id, data: x, pendingData: null, mode: '', status: 'pending', stages: [], stage: 0,
          hrOk: false, history: [{ t: now.stamp, by: me.en, act: 'submit', note: x.reason || '' }], createdAt: now.stamp, doneAt: '' };
        var eff = start(r, me, people, FLOWS[type], now.stamp);
        save(r, true);
        effect(r, eff, now);
        env.audit(me.en, '送出' + title(r), summary(r));
        if (!eff) notifyNext(r);
        return reqView(r, me);
      }
      var cur = reqById(id);
      if (cur.staffId !== me.id) throw new Error('只能修改自己的申請');
      var y = CHECK[cur.type](me, data, now, cur.id);
      var eff2 = null;
      if (cur.status === 'rejected' || (cur.status === 'pending' && !cur.hrOk && !cur.mode)) {
        cur.data = y; cur.mode = ''; cur.pendingData = null; cur.hrOk = false;
        cur.history.push({ t: now.stamp, by: me.en, act: cur.status === 'rejected' ? 'resubmit' : 'edit', note: y.reason || '' });
        eff2 = start(cur, me, people, FLOWS[cur.type], now.stamp);
      } else if (cur.status === 'pending' && cur.hrOk && !cur.mode) {
        var rest = cur.stages.slice(cur.stage);
        cur.data = y; cur.hrOk = false;
        cur.history.push({ t: now.stamp, by: me.en, act: 'edit', note: y.reason || '' });
        eff2 = start(cur, me, people, ['hr'].concat(rest), now.stamp);
      } else if (cur.status === 'approved' || (cur.status === 'pending' && cur.mode === 'edit')) {
        cur.mode = 'edit'; cur.pendingData = y;
        cur.history.push({ t: now.stamp, by: me.en, act: 'edit', note: y.reason || '' });
        eff2 = start(cur, me, people, ['hr'], now.stamp);
      } else throw new Error('這張申請單目前不能修改');
      save(cur, false);
      effect(cur, eff2, now);
      env.audit(me.en, '修改' + title(cur), summary(cur));
      if (!eff2) notifyNext(cur);
      return reqView(cur, me);
    }

    return {
      leaveTypes: function () { return { types: LEAVE_TYPES, funeral: FUNERAL }; },
      // 首頁：今天的狀態
      today: function (me) {
        var now = env.now();
        var d = dayOf(me, now.date, now);
        return { now: now.time.slice(0, 5), day: d, next: d.inTime ? 'out' : 'in' };
      },
      // 打卡：今天已經有同一種卡時，先回傳 needConfirm，使用者確認後帶 overwrite 再送一次（舊的作廢）
      punch: function (me, kind, overwrite) {
        var now = env.now();
        kind = kind === 'out' ? 'out' : 'in';
        var prev = punchesOf(me.id, now.date, now.date).filter(function (x) { return x.kind === kind; });
        var prevEff = effective(prev, kind);
        if (prevEff && !overwrite) {
          return { needConfirm: true, kind: kind, kindLabel: KIND_LABEL[kind], prev: prevEff.time.slice(0, 5), now: now.time.slice(0, 5), prevFix: prevEff.source === 'fix' };
        }
        prev.forEach(function (x) {
          if (x.source === 'fix') return;
          x.voided = 'TRUE'; x.voidedAt = now.stamp; x.voidReason = '覆蓋'; store.update('Punches', x);
        });
        store.insert('Punches', { id: env.uid(), staffId: me.id, date: now.date, time: now.time, kind: kind, source: 'punch', reqId: '', voided: '', createdAt: now.stamp });
        env.audit(me.en, KIND_LABEL[kind] + '打卡' + (prevEff ? '（覆蓋 ' + prevEff.time.slice(0, 5) + '）' : ''), now.date + ' ' + now.time);
        var t = this.today(me);
        t.done = { kind: kind, time: now.time.slice(0, 5), replaced: prevEff ? prevEff.time.slice(0, 5) : '' };
        return t;
      },
      // 出勤明細：自己，或（有匯出權限）某一個人
      month: function (me, ym, staffId) {
        var now = env.now();
        var p = me;
        if (staffId && staffId !== me.id) { if (!canExport(me)) throw new Error('沒有權限'); p = person(staffId); if (!p) throw new Error('找不到這位員工'); }
        if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = now.date.slice(0, 7);
        var days = monthDays(ym);
        var all = punchesOf(p.id, days[0], days[days.length - 1]);
        var out = days.filter(function (d) { return d <= now.date; }).map(function (d) { return detail(me, dayOf(p, d, now, all), p); });
        var sum = { workdays: 0, present: 0, ok: 0, abnormal: 0, fix: 0 };
        out.forEach(function (d) {
          if (d.workday) sum.workdays++;
          if (d.inTime || d.outTime) sum.present++;
          if (d.status === 'ok') sum.ok++;
          if (d.status === 'abnormal') sum.abnormal++;
          if (d.inFix || d.outFix) sum.fix++;
        });
        return { ym: ym, staff: fullName(p), staffId: p.id, days: out.reverse(), summary: sum, detail: canDetail(me, p), canExport: canExport(me) };
      },
      // 出勤明細：全部（有匯出權限）。每天每人一列（休假日沒打卡的不列）
      monthAll: function (me, ym) {
        if (!canExport(me)) throw new Error('沒有權限');
        var now = env.now();
        if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = now.date.slice(0, 7);
        var days = monthDays(ym).filter(function (d) { return d <= now.date; });
        var all = store.all('Punches').filter(function (x) { return x.date.slice(0, 7) === ym && !bool(x.voided); });
        var rows = [];
        activePeople().forEach(function (p) {
          var mine = all.filter(function (x) { return x.staffId === p.id; });
          days.forEach(function (dt) {
            var d = dayOf(p, dt, now, mine);
            if (!d.workday && !d.inTime && !d.outTime) return;
            if (d.status === 'before') return;
            rows.push({ date: dt, staff: fullName(p), staffId: p.id, region: p.region, inTime: d.inTime, outTime: d.outTime, inFix: d.inFix, outFix: d.outFix,
              status: d.status, holiday: d.holiday, workday: d.workday, reasons: me.role === 'admin' ? d.reasons : [] });
          });
        });
        return { ym: ym, rows: rows, detail: me.role === 'admin' };
      },
      // 有權限看別人的時候，下拉選單用的名單
      people: function (me) {
        if (!canExport(me)) return [];
        return activePeople().map(function (p) { return { id: p.id, name: fullName(p) }; });
      },
      balances: function (me, year) {
        var now = env.now();
        return balances(me, String(year || now.date.slice(0, 4)), '', now.date.slice(0, 7));
      },
      saveFix: function (me, id, data) { return saveReq(me, id, 'fix', data); },
      saveLeave: function (me, id, data) { return saveReq(me, id, 'leave', data); },
      saveOt: function (me, id, data) { return saveReq(me, id, 'ot', data); },
      cancel: function (me, id) {
        var now = env.now();
        var r = reqById(id);
        if (r.staffId !== me.id) throw new Error('只能取消自己的申請');
        var eff = null;
        if (r.status === 'rejected' || (r.status === 'pending' && !r.hrOk && !r.mode)) {
          r.status = 'cancelled'; r.mode = ''; r.pendingData = null; r.stages = []; r.stage = 0; r.doneAt = now.stamp;
          r.history.push({ t: now.stamp, by: me.en, act: 'cancel', note: '' });
        } else if (r.status === 'pending' && r.mode === 'edit') {
          r.status = 'approved'; r.mode = ''; r.pendingData = null; r.stages = []; r.stage = 0;
          r.history.push({ t: now.stamp, by: me.en, act: 'withdraw', note: '撤回修改' });
        } else if (r.status === 'approved' || (r.status === 'pending' && r.hrOk)) {
          var wasPending = r.status === 'pending';
          if (wasPending) { r.prevStages = r.stages; r.prevStage = r.stage; }
          r.mode = 'cancel'; r.pendingData = null;
          r.history.push({ t: now.stamp, by: me.en, act: 'cancelReq', note: '' });
          eff = start(r, me, env.people(), ['hr'], now.stamp);
          if (eff && wasPending) eff = null;
        } else throw new Error('這張申請單目前不能取消');
        save(r, false);
        effect(r, eff, now);
        env.audit(me.en, '取消' + title(r), summary(r));
        if (r.status === 'pending') notifyNext(r);
        return reqView(r, me);
      },
      // 審核：approve＝true 核准、false 退件（退件要寫原因）
      decide: function (me, id, approve, note) {
        var now = env.now();
        var r = reqById(id);
        var p = person(r.staffId);
        if (!p) throw new Error('找不到申請人');
        if (currentApprover(r, p, env.people()) !== me.id) throw new Error('這張申請單目前不是由你審核');
        note = String(note || '').trim().slice(0, 200);
        var stageName = r.stages[r.stage];
        var eff = null;
        if (approve) {
          r.history.push({ t: now.stamp, by: me.en, act: 'approve', note: STAGE_LABEL[stageName] + '核准' + (note ? '：' + note : '') });
          if (stageName === 'hr') r.hrOk = true;
          r.stage++;
          var wasPending = r.mode === 'cancel' && !r.doneAt;
          if (advance(r, p, env.people(), me.en, now.stamp)) { eff = finish(r, now.stamp); if (wasPending) eff = null; }
        } else {
          if (!note) throw new Error('退件請填寫原因');
          r.history.push({ t: now.stamp, by: me.en, act: 'reject', note: STAGE_LABEL[stageName] + '退件：' + note });
          if (r.mode === 'edit' || (r.mode === 'cancel' && r.doneAt)) { r.status = 'approved'; }
          else if (r.mode === 'cancel') { r.status = 'pending'; r.stages = r.prevStages || FLOWS[r.type]; r.stage = r.prevStage || 0; }
          else r.status = 'rejected';
          r.mode = ''; r.pendingData = null;
          if (r.status !== 'pending') { r.stages = []; r.stage = 0; }
        }
        save(r, false);
        effect(r, eff, now);
        env.audit(me.en, approve ? '核准申請' : '退件', p.en + ' ' + title(r) + ' ' + summary(r));
        if (r.status === 'pending') notifyNext(r);
        else env.notify(p.id, (r.status === 'rejected' ? '❌ 你的' + title(r) + '被退件：' : r.status === 'cancelled' ? '✅ 已取消' + title(r) + '：' : '✅ 你的' + title(r) + '已核准：') + summary(r) + (approve ? '' : '\n原因：' + note));
        return reqView(r, me);
      },
      myRequests: function (me) {
        return reqs().filter(function (r) { return r.staffId === me.id; })
          .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 200)
          .map(function (r) { return reqView(r, me); });
      },
      reqById: function (me, id) {
        var r = reqById(id), p = person(r.staffId);
        var v = reqView(r, me);
        if (!v.mine && !v.canDecide && me.role !== 'admin' && !(r.history || []).some(function (h) { return h.by === me.en; })) throw new Error('沒有權限');
        return v;
      },
      // 待我審核＋最近我審過的
      review: function (me) {
        var all = reqs();
        var people = env.people();
        var todo = all.filter(function (r) { var p = person(r.staffId); return p && currentApprover(r, p, people) === me.id; });
        var done = all.filter(function (r) {
          return todo.indexOf(r) < 0 && (r.history || []).some(function (h) { return h.by === me.en && (h.act === 'approve' || h.act === 'reject'); });
        }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 30);
        return { todo: todo.map(function (r) { return reqView(r, me); }), done: done.map(function (r) { return reqView(r, me); }) };
      },
      pendingCount: function (me) {
        var people = env.people();
        return reqs().filter(function (r) { var p = person(r.staffId); return p && currentApprover(r, p, people) === me.id; }).length;
      },
      // 待辦事項：這個月和上個月還沒處理的異常、被退件的申請
      todos: function (me) {
        var now = env.now();
        var out = [];
        var ym = now.date.slice(0, 7), prev = shiftDate(ym + '-01', 0, -1).slice(0, 7);
        [prev, ym].forEach(function (m) {
          var days = monthDays(m).filter(function (d) { return d < now.date; });
          var all = punchesOf(me.id, days[0], days[days.length - 1] || days[0]);
          days.forEach(function (dt) {
            var d = dayOf(me, dt, now, all);
            if (d.status === 'abnormal' && !d.pendingFix) out.push({ kind: 'abnormal', date: dt, title: md(dt) + ' ' + d.reasons[0] });
          });
        });
        out.sort(function (a, b) { return b.date.localeCompare(a.date); });
        reqs().filter(function (r) { return r.staffId === me.id && r.status === 'rejected'; }).forEach(function (r) {
          out.unshift({ kind: 'rejected', id: r.id, title: title(r) + '被退件' });
        });
        return out;
      }
    };
  }

  return {
    RULE: RULE, FLOWS: FLOWS, KIND_LABEL: KIND_LABEL, TYPE_LABEL: TYPE_LABEL, STAGE_LABEL: STAGE_LABEL, LEAVE_TYPES: LEAVE_TYPES, FUNERAL: FUNERAL,
    toMin: toMin, fmtMin: fmtMin, fmtDur: fmtDur, fmtDays: fmtDays, addDays: addDays, weekday: weekday, monthDays: monthDays,
    expectedOut: expectedOut, dayInfo: dayInfo, buildDay: buildDay, effective: effective, annualMinutes: annualMinutes, leaveMinutes: leaveMinutes,
    service: service
  };
})();
