/* 功能：申請與通報（職場霸凌／性騷擾申訴、主管知悉通報單）。由 shell.js 掛到內容區。
 * 機密：案件只有申請人本人和受理人看得到（後端把關）；這裡不暫存任何案件內容在瀏覽器。 */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var A = { me: null, list: null };
  function token() { return BM.store('staffToken'); }
  function api(action, data, opts) { return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); }, opts); }
  function alive() { return !!document.getElementById('modApply'); }
  function title(t) { var h = $('.page-head h2'); if (h) h.innerHTML = t; }
  function ymd(s) { return String(s || '').slice(0, 10).replace(/-/g, '/'); }
  var CHIP = { submitted: 'warn', accepted: 'warn', received: 'warn', appealed: 'warn', decided: '', rejected: 'gray', closed: 'gray' };

  function mount(root, me, sub) {
    A.me = me;
    root.innerHTML = '<div id="modApply"><div class="card empty">讀取中…</div></div>';
    if (sub === 'complaint' || sub === 'notice') return renderForm(sub);
    if (sub) return renderCase(sub);
    renderHome();
  }

  // ======================= 首頁：兩張卡片＋我的案件 =======================
  async function renderHome() {
    title('申請與通報');
    var r = await api('caseList', {}, { silent: !!A.list });
    A.list = r;
    if (!alive()) return;
    var box = $('#modApply');
    var row = function (c) {
      return '<a href="#/apply/' + esc(c.id) + '" class="req-row"><div class="rh"><b>' + esc(c.title + (c.applicant ? '・' + c.applicant : '')) + '</b>' +
        '<span class="badge ' + (CHIP[c.status] || '') + '">' + esc(c.statusLabel) + '</span></div>' + BM.steps(c.steps, true) + '</a>';
    };
    box.innerHTML = '<div class="case-cards">' +
      '<div class="card"><div class="hc-title">' + BM.icon('apply') + '職場霸凌／性騷擾申訴</div><div class="btn-row"><a class="btn" href="#/apply/complaint">填寫申訴表</a></div></div>' +
      (r.canNotice ? '<div class="card"><div class="hc-title">' + BM.icon('apply') + '職場霸凌知悉通報單</div><div class="btn-row"><a class="btn" href="#/apply/notice">填寫通報單</a></div></div>' : '') +
      '</div>' +
      (r.todo.length ? '<div class="section-title">待我處理</div><div class="card" style="max-width:760px">' + r.todo.map(row).join('') + '</div>' : '') +
      '<div class="section-title">我的申訴與通報</div>' +
      (r.mine.length ? '<div class="card" style="max-width:760px">' + r.mine.map(row).join('') + '</div>' : '<div class="card empty" style="max-width:760px">—</div>');
  }

  // ======================= 表單 =======================
  function radios(name, opts, cur) {
    return '<div class="opts">' + opts.map(function (o) {
      return '<label><input type="radio" name="' + name + '" value="' + o[0] + '"' + (o[0] === cur ? ' checked' : '') + '>' + esc(o[1]) + '</label>';
    }).join('') + '</div>';
  }
  function checks(name, opts) {
    return '<div class="opts">' + opts.map(function (o) {
      return '<label><input type="checkbox" name="' + name + '" value="' + o[0] + '">' + esc(o[1]) + '</label>';
    }).join('') + '</div>';
  }
  function inp(id, ph) { return '<input class="input" id="' + id + '" maxlength="200"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
  function tr(k, v, small) { return '<tr><td class="k">' + k + (small ? '<small>' + small + '</small>' : '') + '</td><td colspan="3">' + v + '</td></tr>'; }
  function tr2(k1, v1, k2, v2) { return '<tr><td class="k">' + k1 + '</td><td>' + v1 + '</td><td class="k">' + k2 + '</td><td>' + v2 + '</td></tr>'; }
  var FREQ = [['single', '單一事件（情節重大）'], ['frequent', '近期頻繁發生'], ['long', '長期持續累積']];
  var PRIVACY = '本公司蒐集本表個人資料，僅供處理本申訴（職場霸凌或性騷擾）、調查、依法登錄或通知主管機關及依法保存紀錄（3 年）之用，利用對象限於處理本案之人員及主管機關。您得依個人資料保護法第 3 條行使查詢、閱覽、更正等權利；如未提供必要資料，本公司可能無法受理您的申訴。';

  function renderForm(kind) {
    var notice = kind === 'notice';
    title('<a class="crumb" href="#/apply">申請與通報 ›</a>' + (notice ? '職場霸凌知悉通報單' : '職場霸凌／性騷擾申訴'));
    var gm = (A.list && A.list.gm) || 'Andy';
    var files = [];
    var to = radios('fTo', [['hr', 'HR Melissa'], ['gm', '總經理 ' + gm + '（' + (notice ? '涉及 HR 時' : '被申訴人為 HR 時') + '）']], 'hr');
    var html = notice ?
      tr2('通報人', esc(A.me.name), '知悉日期', '<input class="input" type="date" id="fKnown" max="' + BM.today() + '" value="' + BM.today() + '">') +
      tr('知悉方式', radios('fHow', [['self', '當事人主動反映'], ['noticed', '自行察覺'], ['told', '他人告知']], 'self') + '<div id="fTellerW" hidden style="margin-top:6px">' + inp('fTeller', '告知人') + '</div>') +
      tr2('疑似被霸凌者', inp('fVictim'), '疑似行為人', inp('fActor')) +
      tr('發生頻率', radios('fFreq', FREQ, '')) +
      tr('已知證據', checks('fEv', [['email', 'Email'], ['chat', '通訊軟體對話'], ['meeting', '會議紀錄'], ['record', '錄音'], ['witness', '目擊者'], ['other', '其他']]), '可複選') +
      tr('事件概述', '<textarea class="input" id="fStory" maxlength="5000" placeholder="時間、地點、經過、目擊者"></textarea>') +
      tr('當事人意願', radios('fWill', [['complain', '願意提出申訴'], ['mediate', '希望協調'], ['adjust', '僅希望調整工作安排'], ['none', '暫無意願'], ['notasked', '尚未詢問']], '')) +
      tr('已採取的暫時措施', checks('fMeas', [['none', '無'], ['seat', '調整座位'], ['schedule', '調整班表／匯報對象'], ['resource', '告知外部資源'], ['other', '其他']]) + '<div style="margin-top:6px">' + inp('fMeasOther', '其他措施') + '</div>', '可複選') +
      tr('是否需迴避', radios('fAvoid', [['no', '否'], ['yes', '是']], 'no') + '<div style="margin-top:6px">' + inp('fAvoidNote', '原因') + '</div>') +
      tr('附件', '<div class="att-files" id="fFiles"></div>') +
      tr('送交', to)
      :
      tr('申訴類型', radios('fType', [['bully', '職場霸凌'], ['harass', '職場性騷擾'], ['unsure', '不確定（由 HR 協助判斷）']], '')) +
      tr2('申訴人', esc(A.me.name), '聯絡電話', '<input class="input" id="fPhone" maxlength="30" inputmode="tel">') +
      tr2('被申訴人姓名', inp('fAccused'), '身分', radios('fRole', [['company', '本公司'], ['client', '客戶'], ['vendor', '廠商'], ['other', '其他']], 'company')) +
      tr2('發生期間', inp('fPeriod'), '發生地點', inp('fPlace')) +
      tr('發生頻率', radios('fFreq', FREQ, '')) +
      tr('行為樣態', checks('fPat', [['isolate', '排擠孤立'], ['obstruct', '阻礙工作'], ['power', '權力欺壓'], ['rumor', '散布謠言／揭露隱私'], ['other', '其他']]) + '<div style="margin-top:6px">' + inp('fPatOther', '其他') + '</div>', '職場霸凌適用，可複選') +
      tr('事件經過', '<textarea class="input" id="fStory" maxlength="5000" placeholder="依時間順序寫下人、事、時、地、物，以及對方具體的言語或行為"></textarea>') +
      tr('相關證據', checks('fEv', [['email', 'Email'], ['chat', '通訊軟體對話紀錄'], ['meeting', '會議紀錄'], ['record', '錄音'], ['photo', '照片／影片'], ['other', '其他']]) +
        '<div style="margin-top:6px">' + inp('fEvNote', '說明') + '</div><div class="att-files" id="fFiles" style="margin-top:6px"></div>', '可複選') +
      tr('證人', inp('fWitness', '姓名／部門')) +
      tr('是否曾溝通或反映', radios('fContact', [['no', '否'], ['yes', '是']], 'no') + '<div style="margin-top:6px">' + inp('fContactNote', '對象與結果') + '</div>') +
      tr('身心影響程度', radios('fImpact', [['1', '1 幾乎沒有影響'], ['2', '2 輕微'], ['3', '3 中度'], ['4', '4 明顯影響'], ['5', '5 嚴重影響，難以工作']], ''), '選填') +
      tr('是否就醫或諮商', radios('fMed', [['no', '否'], ['yes', '是']], ''), '選填') +
      tr('對工作的影響', inp('fWork'), '選填') +
      tr('希望公司採取的措施', checks('fWant', [['adjust', '調整座位／班表／匯報對象'], ['client', '調整拜訪客戶安排'], ['resource', '提供或轉介諮詢資源'], ['mediate', '進行協調（限職場霸凌，須雙方同意）'], ['investigate', '進行調查'], ['record', '暫時僅留存紀錄'], ['other', '其他']]) +
        '<div style="margin-top:6px">' + inp('fWantOther', '其他') + '</div>', '可複選') +
      tr('其他補充', '<textarea class="input" id="fOther" maxlength="1000" style="min-height:60px"></textarea>', '選填') +
      tr('送交', to) +
      tr('個人資料蒐集告知', '<div class="notice-txt">' + PRIVACY + '</div>') +
      tr('醫療資料同意', '<div class="opts"><label><input type="checkbox" id="fMedOk">同意公司為處理本申訴，蒐集、處理及利用我提供的醫療相關資料（個人資料保護法第 6 條第 1 項第 6 款）</label></div>', '選填') +
      tr('確認', '<div class="opts"><label><input type="checkbox" id="fOk">我已閱讀上述告知，以上內容屬實</label></div>');
    var box = $('#modApply');
    box.innerHTML = '<div class="card" style="max-width:900px;padding:12px"><table class="frm"><tbody>' + html + '</tbody></table>' +
      '<div class="btn-row" style="justify-content:flex-end"><button class="btn" id="fSend">' + (notice ? '送出通報' : '送出申訴') + '</button></div></div>';
    var val = function (id) { var e = $('#' + id, box); return e ? e.value.trim() : ''; };
    var rv = function (n) { var e = $('input[name=' + n + ']:checked', box); return e ? e.value : ''; };
    var cv = function (n) { return $$('input[name=' + n + ']:checked', box).map(function (e) { return e.value; }); };
    if ($('#fTellerW', box)) $$('input[name=fHow]', box).forEach(function (r) { r.onchange = function () { $('#fTellerW', box).hidden = rv('fHow') !== 'told'; }; });
    // 附件：上傳到不公開的雲端資料夾
    var drawFiles = function () {
      $('#fFiles', box).innerHTML = files.map(function (f, i) { return '<span class="file-chip">' + esc(f.name) + '<button type="button" data-rm="' + i + '" aria-label="移除">×</button></span>'; }).join('') +
        (files.length < 10 ? '<label class="file-add">＋ 上傳檔案<input type="file" id="fPick" multiple hidden></label>' : '');
      $$('[data-rm]', box).forEach(function (x) { x.onclick = function () { files.splice(+x.dataset.rm, 1); drawFiles(); }; });
      if ($('#fPick', box)) $('#fPick', box).onchange = async function () {
        var list = Array.prototype.slice.call(this.files, 0, 10 - files.length);
        for (var i = 0; i < list.length; i++) files.push(await upload(list[i]));
        drawFiles();
      };
    };
    drawFiles();
    $('#fSend', box).onclick = async function () {
      var data = notice ? {
        knownDate: val('fKnown'), how: rv('fHow'), teller: val('fTeller'), victim: val('fVictim'), actor: val('fActor'), freq: rv('fFreq'),
        evidence: cv('fEv'), story: val('fStory'), will: rv('fWill'), measures: cv('fMeas'), measureOther: val('fMeasOther'),
        avoid: rv('fAvoid'), avoidNote: val('fAvoidNote'), files: files
      } : {
        type: rv('fType'), phone: val('fPhone'), accused: val('fAccused'), accusedRole: rv('fRole'), period: val('fPeriod'), place: val('fPlace'),
        freq: rv('fFreq'), patterns: cv('fPat'), patternOther: val('fPatOther'), story: val('fStory'), evidence: cv('fEv'), evidenceNote: val('fEvNote'),
        witness: val('fWitness'), contacted: rv('fContact'), contactedNote: val('fContactNote'), impact: rv('fImpact'), medical: rv('fMed'),
        workImpact: val('fWork'), wants: cv('fWant'), wantOther: val('fWantOther'), other: val('fOther'),
        medConsent: !!($('#fMedOk', box) && $('#fMedOk', box).checked), confirm: !!($('#fOk', box) && $('#fOk', box).checked), files: files
      };
      if (!notice && !data.type) return BM.toast('請選擇申訴類型', true);
      if (!notice && !data.accused) return BM.toast('請填寫被申訴人姓名', true);
      if (notice && !data.victim) return BM.toast('請填寫疑似被霸凌者', true);
      if (!data.story) return BM.toast(notice ? '請填寫事件概述' : '請填寫事件經過', true);
      if (!notice && !data.confirm) return BM.toast('請勾選「我已閱讀上述告知，以上內容屬實」', true);
      var who = rv('fTo') === 'gm' ? '總經理 ' + gm : 'HR Melissa';
      if (!await BM.ask((notice ? '送出通報單' : '送出申訴') + '給 ' + who + '？', { ok: '送出' })) return;
      A.list = await api('caseSubmit', { kind: kind, to: rv('fTo'), data: data });
      BM.toast('已送出');
      BM.go('apply');
    };
  }
  function upload(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 15 * 1024 * 1024) { BM.toast('檔案太大（上限 15 MB）', true); return reject(new Error('too big')); }
      var r = new FileReader();
      r.onload = function () { api('caseUpload', { name: file.name, mimeType: file.type || 'application/octet-stream', base64: String(r.result).split(',')[1] }).then(resolve, reject); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ======================= 案件內容 =======================
  var LBL = {
    type: { bully: '職場霸凌', harass: '職場性騷擾', unsure: '不確定' }, accusedRole: { company: '本公司', client: '客戶', vendor: '廠商', other: '其他' },
    freq: { single: '單一事件（情節重大）', frequent: '近期頻繁發生', long: '長期持續累積' },
    patterns: { isolate: '排擠孤立', obstruct: '阻礙工作', power: '權力欺壓', rumor: '散布謠言／揭露隱私', other: '其他' },
    evidence: { email: 'Email', chat: '通訊軟體對話紀錄', meeting: '會議紀錄', record: '錄音', photo: '照片／影片', witness: '目擊者', other: '其他' },
    wants: { adjust: '調整座位／班表／匯報對象', client: '調整拜訪客戶安排', resource: '提供或轉介諮詢資源', mediate: '進行協調', investigate: '進行調查', record: '暫時僅留存紀錄', other: '其他' },
    how: { self: '當事人主動反映', noticed: '自行察覺', told: '他人告知' },
    will: { complain: '願意提出申訴', mediate: '希望協調', adjust: '僅希望調整工作安排', none: '暫無意願', notasked: '尚未詢問' },
    measures: { none: '無', seat: '調整座位', schedule: '調整班表／匯報對象', resource: '告知外部資源', other: '其他' },
    yn: { yes: '是', no: '否' }
  };
  var ACT = { submit: '送出', accept: '受理', reject: '不受理', memo: '紀錄', decide: '決定', appeal: '申復', appealDecide: '申復結果', receive: '收件', close: '結案' };
  function many(arr, map) { return (arr || []).map(function (k) { return map[k] || k; }).join('、'); }
  function formView(c) {
    var d = c.data, rows = [];
    var add = function (k, v) { if (v) rows.push('<tr><td class="k">' + k + '</td><td>' + esc(v) + '</td></tr>'); };
    if (c.kind === 'notice') {
      add('通報人', c.role === 'receiver' ? c.applicant : A.me.name); add('知悉日期', ymd(d.knownDate)); add('知悉方式', (LBL.how[d.how] || '') + (d.teller ? '（' + d.teller + '）' : ''));
      add('疑似被霸凌者', d.victim); add('疑似行為人', d.actor); add('發生頻率', LBL.freq[d.freq]); add('已知證據', many(d.evidence, LBL.evidence));
      add('事件概述', d.story); add('當事人意願', LBL.will[d.will]); add('已採取的暫時措施', many(d.measures, LBL.measures) + (d.measureOther ? '：' + d.measureOther : ''));
      add('是否需迴避', (LBL.yn[d.avoid] || '') + (d.avoidNote ? '：' + d.avoidNote : ''));
    } else {
      add('申訴類型', LBL.type[d.type]); add('申訴人', c.role === 'receiver' ? c.applicant : A.me.name); add('聯絡電話', d.phone);
      add('被申訴人', d.accused + (d.accusedRole ? '（' + LBL.accusedRole[d.accusedRole] + '）' : '')); add('發生期間', d.period); add('發生地點', d.place);
      add('發生頻率', LBL.freq[d.freq]); add('行為樣態', many(d.patterns, LBL.patterns) + (d.patternOther ? '：' + d.patternOther : ''));
      add('事件經過', d.story); add('相關證據', many(d.evidence, LBL.evidence) + (d.evidenceNote ? '：' + d.evidenceNote : '')); add('證人', d.witness);
      add('是否曾溝通或反映', (LBL.yn[d.contacted] || '') + (d.contactedNote ? '：' + d.contactedNote : ''));
      add('身心影響程度', d.impact); add('是否就醫或諮商', LBL.yn[d.medical]); add('對工作的影響', d.workImpact);
      add('希望公司採取的措施', many(d.wants, LBL.wants) + (d.wantOther ? '：' + d.wantOther : '')); add('其他補充', d.other);
      add('醫療資料同意', d.medConsent ? '同意' : ''); add('確認', d.confirm ? '已閱讀個人資料蒐集告知，內容屬實' : '');
    }
    return '<table class="frm"><tbody>' + rows.join('') + '</tbody></table>' +
      ((d.files || []).length ? '<div class="att-thumbs" style="margin-top:10px">' + d.files.map(function (f) {
        var img = /^image\//.test(f.mime);
        return '<button type="button" class="att-th ' + (img ? 'img' : 'pdf') + '" data-cf="' + esc(f.id) + '">' + (img ? '' : (/pdf/.test(f.mime) ? 'PDF' : '檔案')) + '<small>' + esc(f.name) + '</small></button>';
      }).join('') + '</div>' : '');
  }
  async function renderCase(id) {
    var c = await api('caseGet', { id: id });
    if (!alive()) return;
    title('<a class="crumb" href="#/apply">申請與通報 ›</a>' + esc(c.no));
    var R = c.role === 'receiver', btn = [];
    if (R && c.kind === 'complaint' && c.status === 'submitted') btn.push(['accept', '受理', ''], ['reject', '不受理', 'ghost']);
    if (R && c.kind === 'complaint' && c.status === 'accepted') btn.push(['decide', '作成決定', '']);
    if (R && c.kind === 'complaint' && c.status === 'decided') btn.push(['close', '結案', 'ghost']);
    if (R && c.status === 'appealed') btn.push(['appealDecide', '申復決定', '']);
    if (R && c.kind === 'notice' && c.status === 'submitted') btn.push(['receive', '收件', '']);
    if (R && c.kind === 'notice' && c.status === 'received') btn.push(['close', '結案', '']);
    if (R && c.status !== 'closed' && c.status !== 'rejected') btn.unshift(['memo', '新增紀錄', 'ghost']);
    if (c.canAppeal) btn.push(['appeal', '提出申復', '']);
    var box = $('#modApply');
    box.innerHTML = '<div class="card" style="max-width:900px"><div class="rh" style="display:flex;gap:10px;align-items:center"><b style="flex:1;font-size:16px">' +
      esc(c.title + (c.applicant ? '・' + c.applicant : '')) + '</b><span class="badge ' + (CHIP[c.status] || '') + '">' + esc(c.statusLabel) + '</span></div>' +
      BM.steps(c.steps) +
      (c.decision ? '<div class="case-dec">' + esc(c.decision) + '</div>' : '') +
      (c.canAppeal ? '<div class="small muted" style="margin-top:6px">申復期限：' + ymd(c.appealUntil) + '</div>' : '') +
      (btn.length ? '<div class="btn-row">' + btn.map(function (b) { return '<button class="btn ' + b[2] + '" data-act="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="case-hist">' + c.history.slice().reverse().map(function (h) {
        return '<div><b>' + ymd(h.t).slice(5) + '</b> ' + esc(h.who) + ' ' + esc(ACT[h.act] || h.act) + (h.note ? '：' + esc(h.note) : '') + '</div>';
      }).join('') + '</div></div>' +
      '<details class="card" style="max-width:900px;margin-top:12px"><summary><b>' + (c.kind === 'notice' ? '通報單內容' : '申訴表內容') + '</b></summary><div style="margin-top:10px">' + formView(c) + '</div></details>';
    $$('[data-cf]', box).forEach(function (bt) {
      var got = null;
      var load = function () {
        if (!got) got = BM.api('caseFile', { token: token(), id: c.id, fileId: bt.dataset.cf }).then(function (x) {
          var bin = atob(x.base64), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return URL.createObjectURL(new Blob([arr], { type: x.mime }));
        });
        return got;
      };
      if (bt.classList.contains('img')) load().then(function (u) { bt.style.backgroundImage = 'url("' + u + '")'; }).catch(function () { });
      bt.onclick = function () { load().then(function (u) { window.open(u, '_blank'); }).catch(function (e) { BM.toast(e.message, true); }); };
    });
    var NEED = { reject: '不受理的理由', memo: '紀錄內容（例如保護措施、訪談）', decide: '調查結果與決定', appeal: '申復理由', appealDecide: '申復結果', close: '結案說明（選填）' };
    $$('[data-act]', box).forEach(function (b) {
      b.onclick = async function () {
        var act = b.dataset.act, note = '';
        if (NEED[act]) {
          var m = BM.modal('<h2>' + esc(b.textContent) + '</h2><label class="f" for="caNote">' + NEED[act] + '</label><textarea class="input" id="caNote" rows="5" maxlength="3000"></textarea>' +
            '<div class="btn-row"><button class="btn block" id="caOk">確定</button></div>');
          note = await new Promise(function (res) {
            $('#caOk', m.el).onclick = function () {
              var v = $('#caNote', m.el).value.trim();
              if (!v && act !== 'close') return BM.toast('請填寫' + NEED[act], true);
              m.close(); res(v || ' ');
            };
          });
          note = note.trim();
        } else if (!await BM.ask(b.textContent + '？', { ok: '確定' })) return;
        await api('caseAct', { id: c.id, act: act, note: note });
        BM.toast('已更新');
        renderCase(c.id);
      };
    });
  }

  BM.modules = BM.modules || {};
  BM.modules.apply = { mount: mount };
})();
