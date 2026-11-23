/* 管理中心：醫學會（活動、審核、參加紀錄、設定）與人員。由 shell.js 掛到管理中心。 */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var D = null; // adminData
  var S = { tab: 'events', year: String(new Date().getFullYear()) };
  var REG = ['北', '中', '南'];
  var ALL_TABS = [['events', '活動'], ['review', '審核'], ['records', '參加紀錄'], ['staff', '人員'], ['settings', '醫學會設定']];

  function token() { return BM.store('adminToken'); }
  function call(action, data) {
    return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); });
  }
  function logout() { BM.logout(); }
  function alive() { return !!document.getElementById('admEvents'); } // 已切換到別的頁面就不要再畫

  // 掛載：tabs 是要顯示的分頁（例如只顯示人員）；tab 是一開始的分頁
  async function mount(root, tabs, tab) {
    var list = ALL_TABS.filter(function (t) { return tabs.indexOf(t[0]) >= 0; });
    root.innerHTML = '<div id="admEvents"><div id="verWarn" class="notice" hidden></div>' +
      (list.length > 1 ? '<nav class="tabs sub" id="tabs">' + list.map(function (t) {
        return '<button data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</nav>' : '<nav id="tabs" hidden></nav>') + '<div class="mod-body">' +
      ALL_TABS.map(function (t) { return '<div id="tab-' + t[0] + '" hidden></div>'; }).join('') + '</div></div>';
    $$('#tabs button').forEach(function (b) { b.onclick = function () { switchTab(b.dataset.tab); }; });
    S.tab = tab && tabs.indexOf(tab) >= 0 ? tab : (tabs.indexOf(S.tab) >= 0 ? S.tab : list[0][0]);
    switchTab(S.tab, true);
    await reload();
  }
  // 有暫存就先顯示，再背景更新；操作後直接用伺服器回傳的最新資料
  async function reload(data) {
    if (data) { D = data; BM.cache('adminData2', D); render(); return; }
    await BM.swr('adminData2', function () { return BM.api('adminData', { token: token() }); }, function (d) { D = d; render(); });
  }
  function render() {
    if (!D || !alive()) return;
    var pending = D.corrections.filter(function (c) { return c.status === 'pending'; }).length;
    var rv = $('#tabs [data-tab=review]');
    if (rv) rv.innerHTML = '審核' + (pending ? '<span class="badge warn">' + pending + '</span>' : '');
    // 網頁和後端版本不一致時提醒（代表其中一邊還沒更新）
    var vw = document.getElementById('verWarn');
    var bv = D.settings.backendVersion || '';
    var older = !bv || bv.localeCompare(BM.VERSION, 'en', { numeric: true }) < 0;
    vw.hidden = bv === BM.VERSION;
    vw.innerHTML = '⚠️ 版本不一致：網頁 v' + esc(BM.VERSION) + '，後端 ' + (bv ? 'v' + esc(bv) : '是舊版') + '。' +
      (older ? '請到 Apps Script 貼上最新的後端程式並部署新版本。' : '請把最新的 portal 資料夾上傳到 GitHub。');
    if (S.tab === 'events') renderEvents();
    if (S.tab === 'review') renderReview();
    if (S.tab === 'records') renderRecords();
    if (S.tab === 'staff') renderStaff();
    if (S.tab === 'settings') renderSettings();
  }
  function switchTab(t, noRender) {
    S.tab = t;
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    ALL_TABS.forEach(function (x) { $('#tab-' + x[0]).hidden = x[0] !== t; });
    if (!noRender) render();
    window.scrollTo(0, 0);
  }
  function staffName(id) {
    var s = D.staff.filter(function (x) { return x.id === id; })[0];
    return s ? s.name + ' ' + s.enName : id;
  }

  // ======================= 活動 =======================
  function statusBadge(e) {
    var b = [];
    if (e.status === 'draft') b.push('<span class="badge gray">草稿</span>');
    if (e.status === 'published') b.push('<span class="badge">已公開</span>');
    if (e.status === 'cancelled') b.push('<span class="badge bad">已取消</span>');
    if (e.status !== 'draft' && e.dirty) b.push('<span class="badge warn">★ 待推播</span>');
    else if (e.pushedAt) b.push('<span class="badge gray">已推播</span>');
    return b.join(' ');
  }
  function renderEvents() {
    var today = BM.today();
    var upcoming = D.events.filter(function (e) { return !e.dates.length || e.dates[e.dates.length - 1] >= today; }).reverse();
    var past = D.events.filter(function (e) { return e.dates.length && e.dates[e.dates.length - 1] < today; });
    var card = function (e) {
      return '<div class="card"><div class="list-item"><div class="grow">' +
        '<b>' + esc(e.name) + '</b><div class="small muted">' + esc(BM.fmtRange(e.dates)) + (e.host ? '・' + esc(e.host) : '') +
        '・報名 ' + e.regCount + ' 人' + (e.suggested !== '' ? '／建議 ' + e.suggested : '') + '</div>' +
        '<div style="margin-top:4px">' + statusBadge(e) + '</div></div></div>' +
        '<div class="btn-row">' +
        '<button class="btn small ghost" data-act="edit" data-id="' + e.id + '">編輯</button>' +
        '<button class="btn small ghost" data-act="regs" data-id="' + e.id + '">報名名單</button>' +
        (e.status === 'draft' ? '<button class="btn small" data-act="publish" data-id="' + e.id + '">公開</button>' : '') +
        (e.status === 'published' ? '<button class="btn small ghost" data-act="draft" data-id="' + e.id + '">改回草稿</button>' : '') +
        (e.status === 'published' ? '<button class="btn small danger" data-act="cancel" data-id="' + e.id + '">取消活動</button>' : '') +
        (e.status === 'cancelled' ? '<button class="btn small ghost" data-act="publish" data-id="' + e.id + '">恢復公開</button>' : '') +
        '<button class="btn small danger" data-act="delete" data-id="' + e.id + '">刪除</button>' +
        '</div></div>';
    };
    var box = $('#tab-events');
    box.innerHTML =
      '<div class="btn-row" style="margin-top:0"><button class="btn" id="newEv">＋ 新增活動</button>' +
      '<button class="btn ghost" id="pushBtn">📣 推播活動更新</button></div>' +
      '<div class="small muted" style="margin-top:6px">推播目標：<b>' + (D.settings.pushTarget === 'main' ? '正式群組' : '測試群組') + '</b>（可在「設定」切換）</div>' +
      '<div class="section-title">即將到來的活動</div>' + (upcoming.length ? upcoming.map(card).join('') : '<div class="card empty">尚無活動</div>') +
      (past.length ? '<details><summary class="section-title" style="cursor:pointer">已結束的活動（' + past.length + '）</summary>' + past.map(card).join('') + '</details>' : '');
    $('#newEv').onclick = function () { openEditor(null); };
    $('#pushBtn').onclick = openPush;
    $$('[data-act]', box).forEach(function (b) {
      b.onclick = function () { eventAction(b.dataset.act, b.dataset.id); };
    });
  }
  async function eventAction(act, id) {
    var e = D.events.filter(function (x) { return x.id === id; })[0];
    if (act === 'edit') return openEditor(e);
    if (act === 'regs') return openRegs(e);
    if (act === 'publish') { await reload(await call('setEventStatus', { id: id, status: 'published' })); BM.toast('已公開，員工可以報名了'); }
    if (act === 'draft') { await reload(await call('setEventStatus', { id: id, status: 'draft' })); BM.toast('已改回草稿'); }
    if (act === 'cancel') {
      if (!await BM.ask('確定取消「' + e.name + '」？\n取消後此活動的報名不會計入次數，下次推播會標示〔已取消〕。')) return;
      await reload(await call('setEventStatus', { id: id, status: 'cancelled' }));
      BM.toast('已取消活動');
    }
    if (act === 'delete') {
      if (!await BM.ask('確定刪除「' + e.name + '」？\n\n刪除後活動會整個消失' + (e.regCount ? '，' + e.regCount + ' 人的報名紀錄也會一起刪除' : '') +
        '，無法復原，也不會通知群組。\n（如果要讓大家知道活動取消，請改用「取消活動」）')) return;
      await reload(await call('deleteEvent', { id: id }));
      BM.toast('已刪除');
    }
  }

  function meetRowHtml(d, m) {
    m = m || { mode: 'all', all: '' };
    var name = 'mt_' + d;
    return '<div class="card" style="padding:10px;margin:6px 0" data-mt="' + d + '">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="flex:1">' + BM.fmtDate(d) + '</b>' +
      '<label class="chk' + (m.mode !== 'region' ? ' on' : '') + '"><input type="radio" name="' + name + '" value="all"' + (m.mode !== 'region' ? ' checked' : '') + '>全區相同</label>' +
      '<label class="chk' + (m.mode === 'region' ? ' on' : '') + '"><input type="radio" name="' + name + '" value="region"' + (m.mode === 'region' ? ' checked' : '') + '>北中南不同</label></div>' +
      '<div class="mt-all" ' + (m.mode === 'region' ? 'hidden' : '') + '><label class="f">全區集合時間</label><input class="input" type="time" data-r="all" value="' + esc(m.all || '') + '"></div>' +
      '<div class="mt-reg row3" ' + (m.mode === 'region' ? '' : 'hidden') + '>' + REG.map(function (r) {
        return '<div><label class="f">' + r + '區</label><input class="input" type="time" data-r="' + r + '" value="' + esc(m[r] || '') + '"></div>';
      }).join('') + '</div></div>';
  }

  function openEditor(e) {
    var isNew = !e;
    e = e || { name: '', dates: [], location: '', host: '', suggested: '', dress: '商務', meetPlace: '', meetTimes: {}, notes: '', poster: '', attachments: [] };
    var dates = e.dates.slice();
    var mt = JSON.parse(JSON.stringify(e.meetTimes || {}));

    var m = BM.modal('<h2>' + (isNew ? '新增活動' : '編輯活動') + '</h2>' +
      '<p class="small muted" style="margin:0">所有欄位都可以之後再補，填到一半可以先存成草稿。</p>' +
      '<label class="f">活動名稱 *</label><input class="input" id="eName" value="' + esc(e.name) + '">' +
      '<label class="f">日期（可多天）</label><div id="dateList"></div>' +
      '<div class="date-range"><div><span class="small muted">開始</span><input class="input" type="date" id="dateFrom"></div>' +
      '<div><span class="small muted">結束（單日可不填）</span><input class="input" type="date" id="dateTo"></div>' +
      '<button class="btn ghost" id="dateAddBtn">加入</button></div>' +
      '<p class="small muted" style="margin:4px 0 0">可以直接輸入日期或點日曆選取。加入後，不需要的日子可以按 ✕ 移除。</p>' +
      '<label class="f">地點</label><input class="input" id="eLoc" value="' + esc(e.location) + '">' +
      '<label class="f">主辦</label><input class="input" id="eHost" value="' + esc(e.host) + '" placeholder="例如：高醫">' +
      '<div class="row2"><div><label class="f">建議名額</label><input class="input" id="eSug" type="number" min="0" inputmode="numeric" value="' + esc(e.suggested) + '"></div>' +
      '<div><label class="f">服裝</label><input class="input" id="eDress" value="' + esc(e.dress) + '"></div></div>' +
      '<label class="f">集合地點</label><input class="input" id="eMeetPlace" value="' + esc(e.meetPlace) + '">' +
      '<label class="f">集合時間（每天）</label><div id="mtList"></div>' +
      '<label class="f">其他說明</label><textarea class="input" id="eNotes">' + esc(e.notes) + '</textarea>' +
      '<div id="fileBox"></div>' +
      (e.status === 'cancelled'
        ? '<div class="btn-row"><button class="btn block" data-save="keep">儲存（此活動已取消）</button></div>'
        : '<div class="section-title" style="margin-top:20px">儲存方式' + (isNew ? '' : '（目前：' + ({ draft: '草稿', published: '已公開' })[e.status] + '）') + '</div>' +
          '<div class="save-opts">' +
          '<button class="btn ghost" data-save="draft"><b>存成草稿</b><span>只有你看得到</span></button>' +
          '<button class="btn ghost" data-save="published"><b>儲存並公開</b><span>員工可以報名</span></button>' +
          '<button class="btn" data-save="push"><b>公開並推播</b><span>接著預覽 LINE 推播</span></button>' +
          '</div>'), { wide: true });
    var root = m.el;

    function collectMt() {
      $$('[data-mt]', root).forEach(function (box) {
        var d = box.dataset.mt;
        var mode = $('input[type=radio]:checked', box).value;
        var o = { mode: mode };
        if (mode === 'all') o.all = $('[data-r=all]', box).value;
        else REG.forEach(function (r) { o[r] = $('[data-r="' + r + '"]', box).value; });
        mt[d] = o;
      });
    }
    function drawDates() {
      collectMt();
      dates.sort();
      $('#dateList', root).innerHTML = dates.length ? dates.map(function (d) {
        return '<span class="chk on" style="margin:0 6px 6px 0">' + BM.fmtDate(d) + ' <a href="#" data-del="' + d + '" aria-label="移除">✕</a></span>';
      }).join('') : '<div class="small muted">尚未設定日期</div>';
      $$('[data-del]', root).forEach(function (a) {
        a.onclick = function (ev) { ev.preventDefault(); dates = dates.filter(function (x) { return x !== a.dataset.del; }); drawDates(); };
      });
      $('#mtList', root).innerHTML = dates.length ? dates.map(function (d) { return meetRowHtml(d, mt[d]); }).join('') : '<div class="small muted">設定日期後即可填寫</div>';
      $$('[data-mt]', root).forEach(function (box) {
        $$('input[type=radio]', box).forEach(function (r) {
          r.onchange = function () {
            $$('input[type=radio]', box).forEach(function (x) { x.parentElement.classList.toggle('on', x.checked); });
            $('.mt-all', box).hidden = r.value !== 'all';
            $('.mt-reg', box).hidden = r.value === 'all';
          };
        });
      });
    }
    function drawFiles() {
      var box = $('#fileBox', root);
      if (!e.id) { box.innerHTML = '<div class="notice">儲存一次後，就可以上傳海報與附件（也可以用 LINE 官方帳號的「上傳活動附件」）。</div>'; return; }
      box.innerHTML = '<label class="f">海報</label>' +
        (e.poster ? '<img class="poster" style="max-width:220px" src="' + BM.img(e.poster, 500) + '" alt=""><button class="btn small danger" data-rm="poster">移除海報</button> ' : '') +
        '<label class="btn small ghost">' + (e.poster ? '更換海報' : '上傳海報') + '<input type="file" accept="image/*" id="upPoster" hidden></label>' +
        '<label class="f">附件</label>' +
        (e.attachments.length ? e.attachments.map(function (a) {
          return '<div class="list-item" style="margin-bottom:6px"><div class="grow">📎 <a href="' + BM.fileUrl(a.id) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a></div>' +
            '<button class="btn small danger" data-rm="' + a.id + '">移除</button></div>';
        }).join('') : '<div class="small muted">尚無附件</div>') +
        '<label class="btn small ghost" style="margin-top:6px">上傳附件<input type="file" id="upAtt" hidden></label>';
      $('#upPoster', root).onchange = function () { upload(this.files[0], 'poster'); };
      $('#upAtt', root).onchange = function () { upload(this.files[0], 'attachment'); };
      $$('[data-rm]', root).forEach(function (b) {
        b.onclick = async function () {
          if (!await BM.ask('確定移除？')) return;
          var kind = b.dataset.rm === 'poster' ? 'poster' : 'attachment';
          D = await call('removeFile', { eventId: e.id, kind: kind, fileId: b.dataset.rm });
          refreshFromD();
        };
      });
    }
    function refreshFromD() {
      var fresh = D.events.filter(function (x) { return x.id === e.id; })[0];
      if (fresh) { e.poster = fresh.poster; e.attachments = fresh.attachments; }
      drawFiles();
      render();
    }
    async function upload(file, kind) {
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return BM.toast('檔案太大（上限 15MB）', true);
      var b64 = await new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(String(r.result).split(',')[1]); };
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      D = await call('uploadFile', { eventId: e.id, kind: kind, name: file.name, mimeType: file.type, base64: b64 });
      BM.toast('已上傳');
      refreshFromD();
    }

    // 加入單日或一段日期（開始～結束，每一天都加入）
    $('#dateFrom', root).onchange = function () {
      if (!$('#dateTo', root).value || $('#dateTo', root).value < this.value) $('#dateTo', root).min = this.value;
    };
    $('#dateAddBtn', root).onclick = function () {
      var a = $('#dateFrom', root).value, b = $('#dateTo', root).value || a;
      if (!a) return BM.toast('請先選擇開始日期', true);
      if (b < a) { var t = a; a = b; b = t; }
      var p = a.split('-'), cur = new Date(+p[0], +p[1] - 1, +p[2]), n = 0;
      while (n < 31) {
        var d = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
        if (d > b) break;
        if (dates.indexOf(d) < 0) dates.push(d);
        cur.setDate(cur.getDate() + 1);
        n++;
      }
      if (n >= 31) BM.toast('一次最多加入 31 天', true);
      $('#dateFrom', root).value = '';
      $('#dateTo', root).value = '';
      drawDates();
    };
    // 三種儲存方式：草稿 / 公開 / 公開並推播
    async function save(mode) {
      collectMt();
      var payload = {
        id: e.id || '', name: $('#eName', root).value.trim(), dates: dates, location: $('#eLoc', root).value,
        host: $('#eHost', root).value, suggested: $('#eSug', root).value, dress: $('#eDress', root).value,
        meetPlace: $('#eMeetPlace', root).value, meetTimes: mt, notes: $('#eNotes', root).value
      };
      if (!payload.name) return BM.toast('請至少填寫活動名稱', true);
      if (mode === 'draft' && e.status === 'published' && !await BM.ask('改成草稿後，員工就看不到這個活動，也不能報名。確定？')) return;
      if (mode === 'push' && !dates.length) return BM.toast('推播前請先設定日期', true);
      var status = mode === 'push' ? 'published' : mode === 'keep' ? undefined : mode;
      var data = await call('saveEvent', { event: payload, status: status });
      await reload(data);
      var saved = D.events.filter(function (x) { return x.id === data.savedId; })[0];
      if (saved) e = saved;
      if (mode === 'push') { m.close(); BM.toast('已公開，請確認推播內容'); openPush(); return; }
      BM.toast(mode === 'draft' ? '已存成草稿' : mode === 'published' ? '已公開，員工可以報名了' : '已儲存');
      if (mode === 'draft' && isNew) { isNew = false; drawFiles(); return; } // 新草稿：留在畫面上，方便接著上傳海報
      m.close();
    }
    $$('[data-save]', root).forEach(function (b) { b.onclick = function () { save(b.dataset.save); }; });
    drawDates();
    drawFiles();
  }

  async function openRegs(e) {
    var regs = await call('eventRegs', { eventId: e.id });
    var active = D.staff.filter(function (s) { return s.active && s.counted; }); // 只列「列入統計」的人
    var locked = D.settings.lockedYears;
    function has(sid, d, s) { return regs.some(function (r) { return r.staffId === sid && r.date === d && r.session === s; }); }
    function draw() {
      var total = {};
      regs.forEach(function (r) { total[r.staffId] = (total[r.staffId] || 0) + 0.5; });
      return '<h2>報名名單：' + esc(e.name) + '</h2>' +
        '<p class="small muted" style="margin:0">勾選或取消就會直接修改（管理員手動修正，立即生效）。</p>' +
        (e.dates.some(function (d) { return locked.indexOf(d.slice(0, 4)) >= 0; }) ? '<div class="notice">此活動所屬年度已鎖定，無法修改。</div>' : '') +
        '<div class="scroll-x"><table class="grid"><thead><tr><th>員工</th>' +
        e.dates.map(function (d) { return '<th colspan="2">' + BM.fmtDate(d, false) + '</th>'; }).join('') + '<th>次數</th></tr><tr><th></th>' +
        e.dates.map(function () { return '<th>上</th><th>下</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
        active.map(function (s) {
          return '<tr><td style="white-space:nowrap">' + esc(s.enName || s.name) + '</td>' +
            e.dates.map(function (d) {
              return ['AM', 'PM'].map(function (x) {
                return '<td><input type="checkbox" style="width:20px;height:20px;accent-color:#1f6f50" data-s="' + s.id + '" data-d="' + d + '" data-x="' + x + '"' + (has(s.id, d, x) ? ' checked' : '') + '></td>';
              }).join('');
            }).join('') + '<td>' + (total[s.id] || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var m = BM.modal(draw(), { wide: true, onClose: reload });
    function bind() {
      $$('input[data-s]', m.el).forEach(function (c) {
        c.onchange = async function () {
          try {
            regs = await call('setReg', { eventId: e.id, staffId: c.dataset.s, date: c.dataset.d, session: c.dataset.x, on: c.checked });
          } catch (err) { c.checked = !c.checked; return; }
          var inner = m.el.querySelector('.modal-x');
          m.el.innerHTML = '';
          m.el.appendChild(inner);
          m.el.insertAdjacentHTML('beforeend', draw());
          bind();
        };
      });
    }
    bind();
  }

  // ---------- 推播 ----------
  async function openPush() {
    var p = await call('previewPush');
    if (!p.items.length) return BM.toast('目前沒有已公開、未結束的活動可以推播', true);
    var stars = p.starIds.slice();
    var targetName = p.target === 'main' ? '正式群組' : '測試群組';
    function text() {
      var lines = ['【活動更新】', ''];
      p.items.forEach(function (e) {
        lines.push((stars.indexOf(e.id) >= 0 ? '★' : '') + BM.fmtRange(e.dates) + ' ' + e.name + (e.host ? '（' + e.host + '主辦）' : '') + (e.status === 'cancelled' ? '〔已取消〕' : ''));
      });
      return lines.join('\n');
    }
    var m = BM.modal('<h2>推播活動更新</h2>' +
      '<p class="small muted" style="margin:0">勾選的活動會加上 ★（預設勾選新增或修改過、尚未推播的活動）。</p>' +
      '<div id="pItems" style="margin:10px 0"></div>' +
      '<label class="f">推播內容預覽</label><div class="preview" id="pText"></div>' +
      '<div id="pMissing"></div>' +
      '<div class="notice' + (p.target === 'main' ? '' : ' ok') + '">將推播到：<b>' + targetName + '</b></div>' +
      '<div class="btn-row"><button class="btn block" id="pSend">推播到' + targetName + '</button></div>');
    function draw() {
      $('#pItems', m.el).innerHTML = p.items.map(function (e) {
        var on = stars.indexOf(e.id) >= 0;
        return '<label class="chk' + (on ? ' on' : '') + '" style="display:flex;margin-bottom:6px;border-radius:10px"><input type="checkbox" data-id="' + e.id + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(BM.fmtRange(e.dates) + ' ' + e.name) + (e.status === 'cancelled' ? ' 〔已取消〕' : '') + '</span></label>';
      }).join('');
      $('#pText', m.el).textContent = text();
      var miss = p.items.filter(function (e) { return stars.indexOf(e.id) >= 0 && e.missing.length; });
      $('#pMissing', m.el).innerHTML = miss.length ? '<div class="notice">⚠️ 以下標 ★ 的活動還有欄位沒填：<br>' + miss.map(function (e) {
        return '・' + esc(e.name) + '：' + esc(e.missing.join('、'));
      }).join('<br>') + '<br>確認是刻意留空再推播；若是遺漏，請先關閉此視窗補上。</div>' : '';
      $$('#pItems input', m.el).forEach(function (c) {
        c.onchange = function () {
          if (c.checked) stars.push(c.dataset.id); else stars = stars.filter(function (x) { return x !== c.dataset.id; });
          draw();
        };
      });
    }
    draw();
    $('#pSend', m.el).onclick = async function () {
      var miss = p.items.filter(function (e) { return stars.indexOf(e.id) >= 0 && e.missing.length; });
      var msg = '確定推播到「' + targetName + '」？';
      if (miss.length) msg = '有 ' + miss.length + ' 個活動還有欄位未填寫。\n' + msg;
      if (!await BM.ask(msg)) return;
      var r = await call('pushUpdate', { starIds: stars });
      BM.toast('已推播到' + r.sentTo);
      m.close();
      reload(r.data);
    };
  }

  // ======================= 審核 =======================
  function renderReview() {
    var pend = D.corrections.filter(function (c) { return c.status === 'pending'; });
    var done = D.corrections.filter(function (c) { return c.status !== 'pending'; }).slice(0, 50);
    var item = function (c, actions) {
      return '<div class="card"><div class="list-item"><div class="grow"><b>' + esc(c.staffName) + '</b>　' + esc(c.eventName) +
        '<div><b>' + esc(c.summary || '') + '</b></div>' +
        (c.reason ? '<div class="small muted">說明：' + esc(c.reason) + '</div>' : '') +
        '<div class="small muted">' + c.createdAt.replace('T', ' ').slice(0, 16) + '</div></div>' +
        (actions ? '' : c.status === 'approved' ? '<span class="badge">' + (c.auto ? '自動通過' : '已通過') + '</span>' :
          c.status === 'revoked' ? '<span class="badge gray">已撤銷</span>' : '<span class="badge bad">已退回</span>') + '</div>' +
        (actions ? '<div class="btn-row"><button class="btn small" data-ok="1" data-id="' + c.id + '">通過</button><button class="btn small danger" data-ok="0" data-id="' + c.id + '">退回</button></div>' : '') +
        (!actions && c.status === 'approved' && !c.locked ? '<div class="btn-row"><button class="btn small ghost" data-rev="' + c.id + '">↩ 撤銷</button></div>' : '') +
        '</div>';
    };
    var box = $('#tab-review');
    box.innerHTML = '<p class="small muted" style="margin:0 4px">未鎖定年度的申請送出就自動生效；有問題可以按「撤銷」改回原狀。</p>' +
      (pend.length ? '<div class="section-title">待審核（' + pend.length + '）</div>' + pend.map(function (c) { return item(c, true); }).join('') : '') +
      '<div class="section-title">最近的申請</div>' + (done.length ? done.map(function (c) { return item(c, false); }).join('') : '<div class="card empty">無</div>');
    $$('[data-rev]', box).forEach(function (b) {
      b.onclick = async function () {
        if (!await BM.ask('撤銷這筆申請？報名紀錄會改回申請前的樣子。')) return;
        await reload(await call('revokeCorrection', { id: b.dataset.rev }));
        BM.toast('已撤銷');
      };
    });
    $$('[data-ok]', box).forEach(function (b) {
      b.onclick = async function () {
        await reload(await call('reviewCorrection', { id: b.dataset.id, approve: b.dataset.ok === '1' }));
        BM.toast(b.dataset.ok === '1' ? '已通過' : '已退回');
      };
    });
  }

  // ======================= 參加紀錄 =======================
  async function renderRecords() {
    var box = $('#tab-records');
    box.innerHTML = BM.yearSelect(S.year, 'ry') + '<div id="rl"></div>' +
      '<p class="small muted">要手動修改某人的次數：到「活動」→ 該活動的「報名名單」勾選/取消。</p>';
    $('#ry').onchange = function () { S.year = this.value; renderRecords(); };
    var year = S.year;
    await BM.swr('arec_' + year, function () { return BM.api('adminRecords', { token: token(), year: year }); }, function (rec) {
      if (S.year !== year || !$('#rl')) return;
      $('#rl').innerHTML = BM.recordsHead(rec) + '<div id="rt"></div>';
      BM.recordsTable($('#rt'), rec);
    });
  }

  // ======================= 員工 =======================
  // 狀態篩選（預設只看在職）與排序（姓名／地區，再點一次反向）
  var STAFF_VIEW = { filter: 'active', key: 'name', dir: 1 };
  var REG_ORDER = { '北': 1, '中': 2, '南': 3 };
  function renderStaff() {
    var box = $('#tab-staff');
    var nActive = D.staff.filter(function (s) { return s.active; }).length;
    var nOff = D.staff.length - nActive;
    var list = D.staff.filter(function (s) {
      return STAFF_VIEW.filter === 'all' ? true : STAFF_VIEW.filter === 'active' ? s.active : !s.active;
    });
    var byName = function (a, b) { return String(a.enName || a.name).localeCompare(String(b.enName || b.name), 'en', { sensitivity: 'base' }); };
    list.sort(function (a, b) {
      if (STAFF_VIEW.key === 'region') return ((REG_ORDER[a.region] || 9) - (REG_ORDER[b.region] || 9)) * STAFF_VIEW.dir || byName(a, b);
      return byName(a, b) * STAFF_VIEW.dir;
    });
    var th = function (key, label) {
      var on = STAFF_VIEW.key === key;
      return '<th class="sortable' + (on ? ' on' : '') + '" data-ssort="' + key + '" role="button" tabindex="0">' + label +
        (on ? (STAFF_VIEW.dir > 0 ? ' ▲' : ' ▼') : ' <span class="sort-hint">▲▼</span>') + '</th>';
    };
    var seg = [['active', '在職（' + nActive + '）'], ['off', '停用（' + nOff + '）'], ['all', '全部']];
    box.innerHTML = '<div class="btn-row" style="margin-top:0"><button class="btn" id="addStaff">＋ 新增員工</button>' +
      '<a class="btn ghost" href="' + esc(D.settings.staffSheetUrl) + '" target="_blank" rel="noopener">開啟人員主檔</a></div>' +
      '<div class="choice" style="margin-top:12px" role="group" aria-label="狀態篩選">' + seg.map(function (o) {
        return '<button class="btn small ' + (STAFF_VIEW.filter === o[0] ? '' : 'ghost') + '" data-sf="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="card scroll-x" style="padding:0;margin-top:10px"><table class="grid"><thead><tr>' + th('name', '姓名') + th('region', '地區') +
      '<th>角色</th><th>狀態</th><th></th></tr></thead><tbody>' +
      (list.length ? '' : '<tr><td colspan="5" class="muted">沒有資料</td></tr>') +
      list.map(function (s) {
        return '<tr><td>' + esc([s.name, s.enName].filter(Boolean).join(' ')) + '</td><td>' + esc(s.region || '—') + '</td><td style="white-space:nowrap">' +
          (s.admin ? '管理員' : s.role === 'manager' ? '主管' : s.role === 'finance' ? '財務' : '職員') +
          (!s.admin && !s.counted ? '<div class="small muted">不列入統計</div>' : '') + '</td><td>' +
          (/^A\d{3}$/.test(s.id) ? '<span class="badge gray">非正式</span> ' : '') +
          (s.active ? '<span class="badge">在職</span>' : '<span class="badge gray">停用</span>') +
          (s.active && s.mustChange ? ' <span class="badge warn">尚未設定密碼</span>' : '') +
          (s.locked ? ' <span class="badge bad">🔒 鎖定中</span>' : '') + '</td>' +
          '<td style="white-space:nowrap"><button class="btn small ghost" data-edit="' + s.id + '">編輯</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    $('#addStaff').onclick = function () { staffEditor(null); };
    $$('[data-sf]', box).forEach(function (b) { b.onclick = function () { STAFF_VIEW.filter = b.dataset.sf; renderStaff(); }; });
    $$('[data-ssort]', box).forEach(function (h) {
      var go = function () {
        var k = h.dataset.ssort;
        if (STAFF_VIEW.key === k) STAFF_VIEW.dir = -STAFF_VIEW.dir; else { STAFF_VIEW.key = k; STAFF_VIEW.dir = 1; }
        renderStaff();
      };
      h.onclick = go;
      h.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    $$('[data-edit]', box).forEach(function (b) {
      b.onclick = function () { staffEditor(D.staff.filter(function (s) { return s.id === b.dataset.edit; })[0]); };
    });
  }
  function staffEditor(s) {
    var isNew = !s;
    s = s || { id: '', name: '', enName: '', region: '北', dept: '業務', birthday: '', active: true, note: '', role: 'staff', counted: true };
    var isTemp = /^A\d{3}$/.test(s.id);
    var pwLabel = function (t) { return t ? '預設密碼（4 碼數字）' : '生日（MMDD，作為預設密碼）'; };
    var radios = function (name, opts, cur) {
      return '<div class="choice">' + opts.map(function (o) {
        var on = o[0] === cur;
        return '<label class="chk' + (on ? ' on' : '') + '"><input type="radio" name="' + name + '" value="' + o[0] + '"' + (on ? ' checked' : '') + '>' + o[1] + '</label>';
      }).join('') + '</div>';
    };
    var m = BM.modal('<h2>' + (isNew ? '新增員工' : '編輯員工') + (isTemp ? ' <span class="badge gray">非正式</span>' : '') + '</h2>' +
      (isNew ? '<label class="chk" style="margin-bottom:4px"><input type="checkbox" id="sTemp">非正式員工（員編自動編為 A 開頭三碼流水號）</label>' +
        '<label class="f">員編</label><input class="input" id="sId" inputmode="numeric" value="">' : '') +
      '<label class="f">地區</label>' + radios('sReg', REG.map(function (r) { return [r, r + '區']; }), s.region) +
      (s.admin ? '' : '<label class="f">角色</label>' + radios('sRole', [['staff', '職員'], ['manager', '主管'], ['finance', '財務']], s.role === 'manager' || s.role === 'finance' ? s.role : 'staff') +
        '<label class="chk' + (s.counted ? ' on' : '') + '" style="margin-top:10px"><input type="checkbox" id="sCounted"' + (s.counted ? ' checked' : '') + '>列入統計（可以報名，會出現在報名名單與參加紀錄）</label>') +
      '<div class="row2"><div><label class="f">中文名' + (isTemp ? '（選填）' : '') + '</label><input class="input" id="sName" value="' + esc(s.name) + '"></div>' +
      '<div><label class="f">英文名（登入帳號）</label><input class="input" id="sEn" autocapitalize="off" value="' + esc(s.enName) + '"></div></div>' +
      '<div class="row2"><div><label class="f">部門</label><input class="input" id="sDept" value="' + esc(s.dept) + '"></div>' +
      '<div><label class="f" id="sBdayLbl">' + pwLabel(isTemp) + '</label><input class="input" id="sBday" inputmode="numeric" maxlength="4" value="' + esc(s.birthday) + '"></div></div>' +
      '<div class="row2"><div><label class="f">到職日</label><input class="input" id="sHire" type="date" value="' + esc(s.hireDate || '') + '"></div>' +
      '<div><label class="f">直屬主管</label><select class="input" id="sMgr"><option value="">自動（主管）</option>' +
      (D.staff || []).filter(function (x) { return x.active && x.id !== s.id && (x.admin || x.role === 'manager'); }).map(function (x) {
        return '<option value="' + esc(x.id) + '"' + (x.id === s.managerId ? ' selected' : '') + '>' + esc(x.enName || x.name) + '</option>';
      }).join('') + '</select></div></div>' +
      '<label class="f">備註</label><input class="input" id="sNote" value="' + esc(s.note) + '">' +
      (isNew ? '<p class="small muted">第一次登入時，需要用預設密碼登入並重新設定。</p>' :
        s.admin ? '<p class="small muted">這是管理員帳號，不能停用，也不列入報名統計。</p>' :
        '<label class="chk' + (s.active ? ' on' : '') + '" style="margin-top:12px"><input type="checkbox" id="sActive"' + (s.active ? ' checked' : '') + '>在職（取消勾選＝停用，列表不再顯示）</label>') +
      '<div class="btn-row"><button class="btn" id="sSave">儲存</button></div>' +
      (isNew || s.admin ? '' : '<h3 style="margin-top:24px">密碼</h3>' +
        '<p class="small muted" style="margin:0">「恢復預設密碼」後，員工下次登入需重新設定新密碼，也會同時解除鎖定。</p>' +
        '<div class="btn-row"><button class="btn ghost" id="sReset">恢復預設密碼（並解鎖）</button>' +
        '<input class="input" id="sPw" placeholder="或直接指定新密碼（6–20 碼英數）" style="flex:1;min-width:160px"><button class="btn ghost" id="sSetPw">設定</button></div>'));
    var r = m.el;
    // 按鈕式選項：點了就亮起來
    $$('input[type=radio]', r).forEach(function (x) {
      x.onchange = function () {
        $$('input[name="' + x.name + '"]', r).forEach(function (y) { y.parentElement.classList.toggle('on', y.checked); });
        if (x.name === 'sRole' && $('#sCounted', r)) { // 換角色時帶入預設：職員列入、主管不列入
          $('#sCounted', r).checked = x.value === 'staff';
          $('#sCounted', r).parentElement.classList.toggle('on', x.value === 'staff');
        }
      };
    });
    if ($('#sCounted', r)) $('#sCounted', r).onchange = function () { this.parentElement.classList.toggle('on', this.checked); };
    var picked = function (name) { var x = $('input[name="' + name + '"]:checked', r); return x ? x.value : ''; };
    var tempBox = $('#sTemp', r);
    if (tempBox) tempBox.onchange = function () {
      tempBox.parentElement.classList.toggle('on', tempBox.checked);
      $('#sId', r).disabled = tempBox.checked;
      $('#sId', r).value = '';
      $('#sId', r).placeholder = tempBox.checked ? '儲存時自動編號' : '';
      $('#sBdayLbl', r).textContent = pwLabel(tempBox.checked);
      if (tempBox.checked) $('#sDept', r).value = '非正式';
    };
    $('#sSave', r).onclick = async function () {
      var temp = !!(tempBox && tempBox.checked);
      var st = { id: isNew ? (temp ? '' : $('#sId', r).value.trim()) : s.id, temp: temp, name: $('#sName', r).value.trim(), enName: $('#sEn', r).value.trim(), region: picked('sReg'),
        dept: $('#sDept', r).value.trim(), birthday: $('#sBday', r).value.trim(), note: $('#sNote', r).value.trim(),
        active: isNew || s.admin ? true : $('#sActive', r).checked, hireDate: $('#sHire', r).value, managerId: $('#sMgr', r).value };
      if (!s.admin) { st.role = picked('sRole'); st.counted = $('#sCounted', r).checked; }
      if (!st.region) return BM.toast('請選擇地區', true);
      D = await call('saveStaff', { staff: st });
      BM.toast('已儲存');
      m.close();
      render();
    };
    if (!isNew && !s.admin) {
      $('#sReset', r).onclick = async function () {
        if (!await BM.ask('把 ' + (s.enName || s.name) + ' 的密碼恢復為預設密碼 ' + s.birthday + '？\n對方下次登入需重新設定新密碼。')) return;
        await call('setStaffPassword', { id: s.id, reset: true });
        BM.toast('已恢復並解鎖，對方需重新登入');
        reload();
      };
      $('#sSetPw', r).onclick = async function () {
        var pw = $('#sPw', r).value.trim();
        if (!/^[A-Za-z0-9!@#$%^&*._-]{6,20}$/.test(pw)) return BM.toast('密碼需為 6–20 碼的英文或數字', true);
        await call('setStaffPassword', { id: s.id, password: pw });
        BM.toast('已更新，對方需用新密碼重新登入');
        $('#sPw', r).value = '';
      };
    }
  }

  // ======================= 設定 =======================
  // 原則：能點就不用選、能選就不用打字；點了就直接儲存
  var FB_FILTER = 'open';
  var SET_OPEN = {}; // 設定頁各區塊是否展開（預設全部收起）
  function renderSettings() {
    var st = D.settings;
    var box = $('#tab-settings');
    var y = Number(BM.today().slice(0, 4));
    var target = st.pushTarget === 'main' ? 'main' : 'test';
    var PAGES = [['events', '活動報名', ''], ['records', '參加紀錄', '主管看全員、職員只看自己'], ['corrections', '修正申請', '只有列入統計的人看得到']];
    var fbOpen = D.feedback.filter(function (f) { return f.status === 'new'; }).length;
    var fbSched = D.feedback.filter(function (f) { return f.status === 'scheduled'; }).length;

    box.innerHTML =
      '<details class="card set-sec" data-sec="line"><summary class="set-sum">LINE 推播</summary>' +
      '<div class="small">' + (st.lineTokenSet ? '✅ LINE Token' : '❌ 尚未設定 LINE Token') + '　' + (st.adminBound ? '✅ 已綁定管理員 LINE' : '❌ 尚未綁定（在 LINE 私訊官方帳號「綁定 你的登入密碼」）') + '</div>' +
      '<label class="f">推播目標（點一下就切換）</label><div class="btn-row" style="margin-top:0">' +
      '<button class="btn ' + (target === 'test' ? '' : 'ghost') + '" data-pt="test">' + (target === 'test' ? '✓ ' : '') + '測試群組</button>' +
      '<button class="btn ' + (target === 'main' ? '' : 'ghost') + '" data-pt="main">' + (target === 'main' ? '✓ ' : '') + '正式群組</button></div>' +
      '<div class="small" style="margin-top:8px">測試群組 ' + (st.testGroupId ? '✅ 已設定' : '❌ 未設定') + '　正式群組 ' + (st.mainGroupId ? '✅ 已設定' : '❌ 未設定') + '</div>' +
      '<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">變更群組 ID</summary>' +
      '<label class="f">測試群組 ID</label><input class="input" id="tg" value="' + esc(st.testGroupId) + '">' +
      '<label class="f">正式群組 ID</label><input class="input" id="mg" value="' + esc(st.mainGroupId) + '">' +
      '<p class="small muted">也可以在群組裡輸入「設為測試群組」或「設為正式群組」自動設定。</p>' +
      '<div class="btn-row"><button class="btn small ghost" id="saveGroups">儲存群組 ID</button></div></details>' +
      (st.richMenuErr ? '<div class="notice">LINE 選單尚未更新：' + esc(st.richMenuErr) + '<br>上傳最新網頁後，到最下面「進階」按「重新建立 LINE 選單」。</div>' : '') +
      '</details>' +

      '<details class="card set-sec" data-sec="perm"><summary class="set-sum">頁面權限</summary>' +
      '<p class="small muted" style="margin:0 0 6px">勾選或取消就會立即儲存。管理員永遠可以看全部。</p>' +
      '<table class="grid perm-table"><thead><tr><th>頁面</th><th>主管</th><th>職員</th></tr></thead><tbody>' +
      PAGES.map(function (p) {
        return '<tr><td>' + p[1] + (p[2] ? '<div class="small muted">' + p[2] + '</div>' : '') + '</td>' +
          ['manager', 'staff'].map(function (r) {
            return '<td><input type="checkbox" style="width:22px;height:22px;accent-color:var(--brand)" data-perm="' + r + '|' + p[0] + '"' + (D.perms[r][p[0]] ? ' checked' : '') + '></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
      '<p class="small muted">「列入統計」在「員工 → 編輯」裡逐一設定：有勾的人可以報名，也會出現在報名名單與參加紀錄。</p></details>' +

      '<details class="card set-sec" data-sec="lock"><summary class="set-sum">年度鎖定</summary>' +
      '<p class="small muted" style="margin:0 0 8px">點年份就會切換鎖定／解鎖。鎖定後該年的報名與修正都不能再改。</p>' +
      BM.yearChips('', { noNext: true, label: function (yy) { return (st.lockedYears.indexOf(yy) >= 0 ? '🔒 ' : '🔓 ') + yy; } })
        .replace('class="year-chips"', 'class="year-chips" id="lockChips"') +
      '<p class="small muted">每年 1/11 13:00 會自動鎖定去年（若還有待審核申請，會每小時提醒並延後鎖定）。</p></details>' +

      '<details class="card set-sec" data-sec="backup"><summary class="set-sum">年度紀錄備份</summary>' +
      '<div class="small">' + (st.backupSpreadsheetId ? '✅ 已設定　<a href="https://docs.google.com/spreadsheets/d/' + esc(st.backupSpreadsheetId) + '" target="_blank" rel="noopener">開啟備份試算表</a>' : '❌ 尚未設定（第一次備份時會自動建立）') + '</div>' +
      '<label class="f">立即備份（點年份）</label>' +
      BM.yearChips('', { noNext: true }).replace('class="year-chips"', 'class="year-chips" id="bkChips"') +
      '<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">變更備份試算表</summary>' +
      '<input class="input" id="bk" style="margin-top:6px" value="' + esc(st.backupSpreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + st.backupSpreadsheetId : '') + '" placeholder="貼上試算表網址">' +
      '<div class="btn-row"><button class="btn small ghost" id="saveBk">儲存</button></div></details></details>' +

      '<details class="card set-sec" data-sec="yearend"><summary class="set-sum">年底提醒</summary>' +
      '<p class="small muted" style="margin:0">每年 12/31 前最後一個工作天 10:00 自動推播；前一天會先私訊預覽給你，可以在 LINE 上取消。</p>' +
      '<div class="btn-row"><button class="btn small ghost" id="yePreview">預覽／手動推播</button></div></details>' +

      '<details class="card set-sec" data-sec="fb"><summary class="set-sum">問題回報 ' + (fbOpen ? '<span class="badge warn">未處理 ' + fbOpen + '</span> ' : '') + (fbSched ? '<span class="badge gray">排程 ' + fbSched + '</span>' : '') + '</summary>' +
      '<div class="choice" id="fbFilter">' + [['open', '未處理'], ['scheduled', '排程處理'], ['done', '已處理'], ['all', '全部']].map(function (o) {
        return '<button class="btn small ' + (FB_FILTER === o[0] ? '' : 'ghost') + '" data-fbf="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div><div id="fbList" style="margin-top:10px"></div>' +
      '<p class="small muted">「排程處理」會在每月 1 日整理成清單私訊給你，再由 Claude 和你討論修改方式。</p></details>' +

      '<details class="card set-sec" data-sec="pw"><summary class="set-sum">我的密碼</summary>' +
      '<p class="small muted" style="margin:0 0 8px">管理員帳號的新密碼 10–20 碼，需同時包含英文與數字。</p>' +
      '<div class="row2"><input class="input" id="op" type="password" placeholder="目前的密碼" autocomplete="current-password"><input class="input" id="np" type="password" placeholder="新密碼" autocomplete="new-password"></div>' +
      '<div class="btn-row"><button class="btn ghost" id="pwBtn">修改密碼</button></div></details>' +

      '<details class="card set-sec" data-sec="adv"><summary class="set-sum">進階</summary>' +
      '<p class="small muted">LINE 選單平常會自動更新；只有選單不見或沒更新時才需要按。</p>' +
      '<div class="btn-row"><button class="btn small ghost" id="rmBtn">重新建立 LINE 選單</button></div>' +
      '<p class="small" style="margin-top:12px"><a href="' + esc(st.dataSheetUrl) + '" target="_blank" rel="noopener">開啟資料試算表</a>　' +
      '<a href="' + esc(st.staffSheetUrl) + '" target="_blank" rel="noopener">開啟人員主檔</a></p></details>';

    $$('details[data-sec]', box).forEach(function (d) {
      d.open = !!SET_OPEN[d.dataset.sec];
      d.addEventListener('toggle', function () { SET_OPEN[d.dataset.sec] = d.open; });
    });
    // 推播目標
    $$('[data-pt]', box).forEach(function (b) {
      b.onclick = async function () {
        var pt = b.dataset.pt;
        if (pt === target) return;
        if (pt === 'main' && !await BM.ask('切換到「正式群組」後，所有推播都會發到正式群組。確定？')) return;
        await reload(await call('saveSettings', { settings: { pushTarget: pt } }));
        BM.toast('推播目標：' + (pt === 'main' ? '正式群組' : '測試群組'));
      };
    });
    $('#saveGroups').onclick = async function () {
      await reload(await call('saveSettings', { settings: { testGroupId: $('#tg').value, mainGroupId: $('#mg').value } }));
      BM.toast('已儲存群組 ID');
    };
    // 頁面權限：勾了就存
    $$('[data-perm]', box).forEach(function (c) {
      c.onchange = async function () {
        var perms = JSON.parse(JSON.stringify(D.perms));
        var k = c.dataset.perm.split('|');
        perms[k[0]][k[1]] = c.checked;
        try { await reload(await call('savePerms', { perms: perms })); BM.toast('已儲存權限'); }
        catch (e) { c.checked = !c.checked; }
      };
    });
    // 年度鎖定：點年份切換
    $$('#lockChips [data-year]', box).forEach(function (b) {
      b.onclick = async function () {
        var yy = b.dataset.year;
        var locked = st.lockedYears.indexOf(yy) >= 0;
        if (!await BM.ask(locked ? '解鎖 ' + yy + ' 年後，該年資料可以再被修改。改完記得重新鎖定。確定解鎖？' : '鎖定 ' + yy + ' 年？鎖定後該年的報名與修正都不能再改。')) return;
        await reload(await call('setYearLock', { year: yy, locked: !locked }));
        BM.toast(locked ? '已解鎖 ' + yy : '已鎖定 ' + yy);
      };
    });
    // 立即備份
    $$('#bkChips [data-year]', box).forEach(function (b) {
      b.onclick = async function () {
        if (!await BM.ask('把 ' + b.dataset.year + ' 年的紀錄備份到年度紀錄試算表？（已有同年份分頁會覆蓋）')) return;
        var r = await call('runJobNow', { job: 'backup', year: b.dataset.year });
        BM.toast('已備份到「' + r.sheet + '」分頁');
      };
    });
    $('#saveBk').onclick = async function () {
      await reload(await call('saveSettings', { settings: { backupSpreadsheetId: $('#bk').value } }));
      BM.toast('已儲存');
    };
    // 年底提醒
    $('#yePreview').onclick = async function () {
      var p = await call('previewYearEnd');
      var tname = p.target === 'main' ? '正式群組' : '測試群組';
      var m = BM.modal('<h2>年底提醒</h2>' +
        '<p class="small muted" style="margin:0">' + p.year + ' 年的自動推播日：<b>' + esc(p.date.replace(/-/g, '/')) + '</b> 10:00' + (p.cancelled ? '（這次已取消）' : '') + '</p>' +
        '<label class="f">推播內容</label><div class="preview">' + esc(p.text) + '</div>' +
        '<div class="notice' + (p.target === 'main' ? '' : ' ok') + '">將推播到：<b>' + tname + '</b></div>' +
        '<div class="btn-row"><button class="btn block" id="yeSend">現在手動推播</button></div>');
      $('#yeSend', m.el).onclick = async function () {
        if (!await BM.ask('確定現在推播到「' + tname + '」？')) return;
        var r = await call('runJobNow', { job: 'yearend' });
        BM.toast('已推播到' + r.sentTo);
        m.close();
      };
    };
    // 問題回報
    function drawFb() {
      var list = D.feedback.filter(function (f) {
        return FB_FILTER === 'all' ? true : FB_FILTER === 'open' ? f.status === 'new' : f.status === FB_FILTER;
      });
      var badge = function (s) { return s === 'done' ? '<span class="badge">已處理</span>' : s === 'scheduled' ? '<span class="badge gray">排程處理</span>' : '<span class="badge warn">未處理</span>'; };
      $('#fbList').innerHTML = list.length ? list.map(function (f) {
        return '<div class="card fb-item" style="margin-bottom:8px"><div class="list-item"><div class="grow">' +
          '<div class="small muted">' + esc(f.time.replace('T', ' ').slice(0, 16)) + '・' + esc(f.who) + '・' + esc(f.page) + '</div>' +
          esc(f.message) + '</div>' + badge(f.status) + '</div>' +
          '<div class="btn-row">' +
          (f.status !== 'done' ? '<button class="btn small" data-fb="' + f.id + '" data-s="done">✅ 已處理</button>' : '') +
          (f.status !== 'scheduled' ? '<button class="btn small ghost" data-fb="' + f.id + '" data-s="scheduled">🗓 排程處理</button>' : '') +
          (f.status !== 'new' ? '<button class="btn small ghost" data-fb="' + f.id + '" data-s="new">改回未處理</button>' : '') +
          '</div></div>';
      }).join('') : '<div class="small muted">沒有資料</div>';
      $$('[data-fb]', box).forEach(function (b) {
        b.onclick = async function () { await reload(await call('setFeedbackStatus', { id: b.dataset.fb, status: b.dataset.s })); BM.toast('已更新'); };
      });
    }
    $$('[data-fbf]', box).forEach(function (b) {
      b.onclick = function () {
        FB_FILTER = b.dataset.fbf;
        $$('[data-fbf]', box).forEach(function (x) { x.classList.toggle('ghost', x !== b); });
        drawFb();
      };
    });
    drawFb();
    $('#rmBtn').onclick = async function () {
      await call('runJobNow', { job: 'richmenu' });
      BM.toast('已重新建立，請關閉 LINE 聊天室再打開');
      reload();
    };
    $('#pwBtn').onclick = async function () {
      var n = $('#np').value;
      if (n.length < 10 || n.length > 20 || !/[A-Za-z]/.test(n) || !/\d/.test(n)) return BM.toast('新密碼需 10–20 碼，需同時有英文與數字', true);
      var r = await call('changeMyPassword', { oldPassword: $('#op').value, newPassword: n });
      BM.store('adminToken', r.token);
      BM.store('staffToken', r.token);
      BM.store('staff', r.staff);
      $('#op').value = ''; $('#np').value = '';
      BM.toast('密碼已修改。LINE 綁定也請改用新密碼');
    };
  }


  BM.admin = BM.admin || {};
  BM.admin.events = { mount: mount };
})();
