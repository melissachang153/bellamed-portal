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

  // ---------------- 服務：store 和 env 由呼叫端提供 ----------------
  // store：all(table) 回傳物件陣列（複本）；insert(table, obj)；update(table, obj)（以 id 對應）
  // env：now() → { date, time: 'HH:mm:ss', stamp }；people()；cal(year)；audit(who, action, detail)；notify(toId, text)；uid()
  function service(store, env) {
    function person(id) { return env.people().filter(function (p) { return p.id === id; })[0]; }
    function en(id) { var p = person(id); return p ? p.en : ''; }
    function infoFor(date, p) { return dayInfo(date, p.region, env.cal(date.slice(0, 4))); }
    function punchesOf(staffId, from, to) {
      return store.all('Punches').filter(function (x) { return x.staffId === staffId && !bool(x.voided) && x.date >= from && x.date <= to; });
    }
    function dayOf(p, date, now, all) {
      var list = (all || punchesOf(p.id, date, date)).filter(function (x) { return x.date === date; });
      var d = buildDay(date, list, infoFor(date, p), now, env.leaves ? env.leaves(p.id, date) : []);
      // 出勤系統上線前、或到職前的日子：不判斷正常／異常
      var start = env.startDate ? env.startDate() : '';
      if (d.workday && ((start && date < start) || (p.hireDate && date < p.hireDate)) && !d.inTime && !d.outTime) {
        d.status = 'before'; d.reasons = []; d.missingIn = d.missingOut = false;
      }
      d.pendingFix = store.all('Requests').filter(function (r) {
        return r.staffId === p.id && r.type === 'fix' && r.status === 'pending' && (r.pendingData || r.data).date === date;
      }).length;
      return d;
    }
    function isViewer(me) { return ['admin', 'manager', 'finance'].indexOf(me.role) >= 0; }
    function activePeople() { return env.people().filter(function (p) { return p.active !== false; }); }
    // 異常原因：HR 和本人看得到；主管、財務看別人時只看正常／異常
    function canDetail(me, p) { return me.role === 'admin' || !p || me.id === p.id; }
    function detail(me, d, p) {
      if (!canDetail(me, p)) d.reasons = [];
      return d;
    }
    function reqView(r, viewer) {
      var p = person(r.staffId) || { id: r.staffId, en: '' };
      var who = currentApprover(r, p, env.people());
      return {
        id: r.id, type: r.type, typeLabel: TYPE_LABEL[r.type] || r.type, staff: p.en, mine: viewer && viewer.id === r.staffId,
        data: r.data, pendingData: r.pendingData || null, mode: r.mode || '', status: r.status, hrOk: !!r.hrOk,
        stageLabel: r.status === 'pending' ? STAGE_LABEL[r.stages[r.stage]] : '', waitingFor: who ? en(who) : '',
        canDecide: !!(viewer && who && who === viewer.id), history: r.history || [], createdAt: r.createdAt, summary: summary(r)
      };
    }
    function summary(r) {
      var d = r.pendingData || r.data || {};
      if (r.type === 'fix') return d.date.slice(5).replace('-', '/') + ' ' + KIND_LABEL[d.kind] + ' ' + d.time;
      return '';
    }
    function checkFix(me, data, now, skipId) {
      var x = { date: String(data.date || ''), kind: data.kind === 'out' ? 'out' : 'in', time: String(data.time || ''), reason: String(data.reason || '').trim().slice(0, 200) };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error('請選擇日期');
      if (!/^\d{2}:\d{2}$/.test(x.time)) throw new Error('請填寫時間');
      if (x.date > now.date || (x.date === now.date && x.time > now.time.slice(0, 5))) throw new Error('不能補登未來的時間');
      if (x.date < addDays(now.date, -400)) throw new Error('日期太久以前了');
      if (!x.reason) throw new Error('請填寫補登原因');
      var dup = store.all('Requests').filter(function (r) {
        var d = r.pendingData || r.data;
        return r.id !== skipId && r.staffId === me.id && r.type === 'fix' && r.status === 'pending' && d.date === x.date && d.kind === x.kind;
      })[0];
      if (dup) throw new Error('這一天的' + KIND_LABEL[x.kind] + '卡已經有一張補登在審核中');
      return x;
    }
    // 申請單生效／撤銷時，實際改動打卡資料
    function effect(r, eff, now) {
      if (!eff || r.type !== 'fix') return;
      if (eff.op === 'unapply' || eff.op === 'replace') {
        store.all('Punches').filter(function (x) { return x.reqId === r.id && !bool(x.voided); }).forEach(function (x) {
          x.voided = 'TRUE'; x.voidedAt = now.stamp; store.update('Punches', x);
        });
      }
      if (eff.op === 'apply' || eff.op === 'replace') {
        store.insert('Punches', { id: env.uid(), staffId: r.staffId, date: eff.data.date, time: eff.data.time + ':00', kind: eff.data.kind,
          source: 'fix', reqId: r.id, voided: '', createdAt: now.stamp });
      }
    }
    function notifyNext(r) {
      var p = person(r.staffId); if (!p) return;
      var who = currentApprover(r, p, env.people());
      if (who) env.notify(who, '📝 ' + p.en + ' 的' + TYPE_LABEL[r.type] + (r.mode === 'cancel' ? '（取消）' : r.mode === 'edit' ? '（修改）' : '') + '等你審核：' + summary(r));
    }
    function save(r, isNew) { if (isNew) store.insert('Requests', r); else store.update('Requests', r); }
    function reqById(id) { var r = store.all('Requests').filter(function (x) { return x.id === id; })[0]; if (!r) throw new Error('找不到這張申請單'); return r; }

    return {
      // 首頁和打卡頁：今天的狀態
      today: function (me) {
        var now = env.now();
        var d = dayOf(me, now.date, now);
        var list = punchesOf(me.id, now.date, now.date).sort(function (a, b) { return a.time.localeCompare(b.time); })
          .map(function (x) { return { time: x.time.slice(0, 5), kind: x.kind, kindLabel: KIND_LABEL[x.kind], fix: x.source === 'fix' }; });
        return { now: now.time.slice(0, 5), day: d, punches: list, next: d.inTime ? 'out' : 'in' };
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
          if (x.source === 'fix') return; // 補登的卡由申請單管理，不在這裡作廢（新的卡時間比較晚，自然會蓋過）
          x.voided = 'TRUE'; x.voidedAt = now.stamp; x.voidReason = '覆蓋'; store.update('Punches', x);
        });
        store.insert('Punches', { id: env.uid(), staffId: me.id, date: now.date, time: now.time, kind: kind, source: 'punch', reqId: '', voided: '', createdAt: now.stamp });
        env.audit(me.en, KIND_LABEL[kind] + '打卡' + (prevEff ? '（覆蓋 ' + prevEff.time.slice(0, 5) + '）' : ''), now.date + ' ' + now.time);
        var t = this.today(me);
        t.done = { kind: kind, time: now.time.slice(0, 5), replaced: prevEff ? prevEff.time.slice(0, 5) : '' };
        return t;
      },
      // 一個月的出勤（自己的；HR、主管、財務可以看別人）
      month: function (me, ym, staffId) {
        var now = env.now();
        var p = me;
        if (staffId && staffId !== me.id) { if (!isViewer(me)) throw new Error('沒有權限'); p = person(staffId); if (!p) throw new Error('找不到這位員工'); }
        if (!/^\d{4}-\d{2}$/.test(ym)) ym = now.date.slice(0, 7);
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
        return { ym: ym, staff: p.en, staffId: p.id, days: out.reverse(), summary: sum, detail: canDetail(me, p) };
      },
      // 全員某一天的出勤（HR、主管、財務）
      team: function (me, date) {
        if (!isViewer(me)) throw new Error('沒有權限');
        var now = env.now();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) date = now.date;
        var all = store.all('Punches').filter(function (x) { return x.date === date && !bool(x.voided); });
        return {
          date: date,
          detail: me.role === 'admin',
          people: activePeople().map(function (p) {
            var d = detail(me, dayOf(p, date, now, all.filter(function (x) { return x.staffId === p.id; })), p);
            d.staff = p.en; d.staffId = p.id; d.region = p.region;
            return d;
          }).sort(function (a, b) { return a.staff.localeCompare(b.staff); }),
          staffList: activePeople().map(function (p) { return { id: p.id, en: p.en }; })
        };
      },
      // HR：某個月所有人的異常清單（含原因）
      abnormal: function (me, ym) {
        if (me.role !== 'admin') throw new Error('只有 HR 可以看異常清單');
        var now = env.now();
        if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = now.date.slice(0, 7);
        var days = monthDays(ym).filter(function (d) { return d <= now.date; });
        var all = store.all('Punches').filter(function (x) { return x.date.slice(0, 7) === ym && !bool(x.voided); });
        var rows = [];
        activePeople().forEach(function (p) {
          var mine = all.filter(function (x) { return x.staffId === p.id; });
          days.forEach(function (dt) {
            var d = dayOf(p, dt, now, mine);
            if (d.status === 'abnormal') rows.push({ date: dt, staff: p.en, staffId: p.id, region: p.region, inTime: d.inTime, outTime: d.outTime, reasons: d.reasons, pendingFix: d.pendingFix });
          });
        });
        rows.sort(function (a, b) { return b.date.localeCompare(a.date) || a.staff.localeCompare(b.staff); });
        return { ym: ym, rows: rows };
      },
      // 補登打卡：新增或修改
      saveFix: function (me, id, data) {
        var now = env.now();
        var people = env.people();
        if (!id) {
          var x = checkFix(me, data, now, '');
          var r = { id: env.uid(), type: 'fix', staffId: me.id, data: x, pendingData: null, mode: '', status: 'pending', stages: [], stage: 0,
            hrOk: false, history: [{ t: now.stamp, by: me.en, act: 'submit', note: x.reason }], createdAt: now.stamp, doneAt: '' };
          var eff = start(r, me, people, FLOWS.fix, now.stamp);
          save(r, true);
          effect(r, eff, now);
          env.audit(me.en, '送出補登打卡', summary(r));
          if (!eff) notifyNext(r);
          return reqView(r, me);
        }
        var cur = reqById(id);
        if (cur.staffId !== me.id) throw new Error('只能修改自己的申請');
        var y = checkFix(me, data, now, cur.id);
        var eff2 = null;
        if (cur.status === 'rejected' || (cur.status === 'pending' && !cur.hrOk && !cur.mode)) {
          // HR 核准前（或被退件）：直接改內容，重新從第一關開始
          cur.data = y; cur.mode = ''; cur.pendingData = null; cur.hrOk = false;
          cur.history.push({ t: now.stamp, by: me.en, act: cur.status === 'rejected' ? 'resubmit' : 'edit', note: y.reason });
          eff2 = start(cur, me, people, FLOWS.fix, now.stamp);
        } else if (cur.status === 'pending' && cur.hrOk && !cur.mode) {
          // HR 已核准、後面的關卡還沒審完：HR 再看一次修改後的內容，之後照原本剩下的關卡繼續
          var rest = cur.stages.slice(cur.stage);
          cur.data = y; cur.hrOk = false;
          cur.history.push({ t: now.stamp, by: me.en, act: 'edit', note: y.reason });
          eff2 = start(cur, me, people, ['hr'].concat(rest), now.stamp);
        } else if (cur.status === 'approved' || (cur.status === 'pending' && cur.mode === 'edit')) {
          // 已核准：改的內容只要 HR 再審一次
          cur.mode = 'edit'; cur.pendingData = y;
          cur.history.push({ t: now.stamp, by: me.en, act: 'edit', note: y.reason });
          eff2 = start(cur, me, people, ['hr'], now.stamp);
        } else throw new Error('這張申請單目前不能修改');
        save(cur, false);
        effect(cur, eff2, now);
        env.audit(me.en, '修改補登打卡', summary(cur));
        if (!eff2) notifyNext(cur);
        return reqView(cur, me);
      },
      cancel: function (me, id) {
        var now = env.now();
        var r = reqById(id);
        if (r.staffId !== me.id) throw new Error('只能取消自己的申請');
        var eff = null;
        if (r.status === 'rejected' || (r.status === 'pending' && !r.hrOk && !r.mode)) {
          r.status = 'cancelled'; r.mode = ''; r.pendingData = null; r.stages = []; r.stage = 0; r.doneAt = now.stamp;
          r.history.push({ t: now.stamp, by: me.en, act: 'cancel', note: '' });
        } else if (r.status === 'pending' && r.mode === 'edit') {
          // 撤回修改：回到原本已核准的內容
          r.status = 'approved'; r.mode = ''; r.pendingData = null; r.stages = []; r.stage = 0;
          r.history.push({ t: now.stamp, by: me.en, act: 'withdraw', note: '撤回修改' });
        } else if (r.status === 'approved' || (r.status === 'pending' && r.hrOk)) {
          var wasPending = r.status === 'pending';
          if (wasPending) { r.prevStages = r.stages; r.prevStage = r.stage; }
          r.mode = 'cancel'; r.pendingData = null;
          r.history.push({ t: now.stamp, by: me.en, act: 'cancelReq', note: '' });
          eff = start(r, me, env.people(), ['hr'], now.stamp);
          if (eff && wasPending) eff = null; // 還沒生效過，不用撤銷
        } else throw new Error('這張申請單目前不能取消');
        save(r, false);
        effect(r, eff, now);
        env.audit(me.en, '取消申請', summary(r));
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
        env.audit(me.en, approve ? '核准申請' : '退件', p.en + ' ' + summary(r));
        if (r.status === 'pending') notifyNext(r);
        else env.notify(p.id, (r.status === 'rejected' ? '❌ 你的' + TYPE_LABEL[r.type] + '被退件：' : r.status === 'cancelled' ? '✅ 已取消' + TYPE_LABEL[r.type] + '：' : '✅ 你的' + TYPE_LABEL[r.type] + '已核准：') + summary(r) + (approve ? '' : '\n原因：' + note));
        return reqView(r, me);
      },
      myRequests: function (me) {
        return store.all('Requests').filter(function (r) { return r.staffId === me.id; })
          .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 100)
          .map(function (r) { return reqView(r, me); });
      },
      // 待我審核＋最近我審過的
      review: function (me) {
        var all = store.all('Requests');
        var people = env.people();
        var todo = all.filter(function (r) { var p = person(r.staffId); return p && currentApprover(r, p, people) === me.id; });
        var done = all.filter(function (r) {
          return todo.indexOf(r) < 0 && (r.history || []).some(function (h) { return h.by === me.en && (h.act === 'approve' || h.act === 'reject'); });
        }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 30);
        return { todo: todo.map(function (r) { return reqView(r, me); }), done: done.map(function (r) { return reqView(r, me); }) };
      },
      pendingCount: function (me) {
        var people = env.people();
        return store.all('Requests').filter(function (r) { var p = person(r.staffId); return p && currentApprover(r, p, people) === me.id; }).length;
      }
    };
  }

  return {
    RULE: RULE, FLOWS: FLOWS, KIND_LABEL: KIND_LABEL, TYPE_LABEL: TYPE_LABEL, STAGE_LABEL: STAGE_LABEL,
    toMin: toMin, fmtMin: fmtMin, fmtDur: fmtDur, addDays: addDays, weekday: weekday, monthDays: monthDays,
    expectedOut: expectedOut, dayInfo: dayInfo, buildDay: buildDay, effective: effective, service: service
  };
})();
