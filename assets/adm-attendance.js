/* 管理中心：出勤（工作日曆：政府辦公日曆＋手動調整，例如颱風停班，可分北中南） */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  var S = { year: '', data: null };

  function token() { return BM.store('staffToken'); }
  function alive() { return !!document.getElementById('admAtt'); }
  function call(action, data) { return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); }); }

  async function mount(root) {
    if (!S.year) S.year = BM.today().slice(0, 4);
    root.innerHTML = '<div id="admAtt"><div class="card empty">讀取中…</div></div>';
    S.data = await call('attCalendar', { year: S.year });
    if (alive()) render();
  }

  function render() {
    var d = S.data, box = $('#admAtt');
    var ov = d.overrides.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var hol = Object.keys(d.days).sort().map(function (k) { return { date: k, off: d.days[k].off, name: d.days[k].name }; })
      .filter(function (x) { var w = ATT.weekday(x.date); return !x.off || (w !== 0 && w !== 6); });
    var y = Number(S.year);
    box.innerHTML =
      '<div class="att-month-bar"><button class="btn small ghost" id="yPrev">‹</button><b>' + S.year + ' 年工作日曆</b>' +
      '<button class="btn small ghost" id="yNext">›</button></div>' +
      '<div class="card"><h3 style="margin-top:0">手動調整</h3>' +
      '<p class="small muted" style="margin-top:0">颱風停班、公司另外放假或補班時在這裡設定。可以只調整某一區；同一天同一區以最後一次設定為準。</p>' +
      '<div class="row2"><div><label class="f" for="oDate">日期</label><input class="input" type="date" id="oDate"></div>' +
      '<div><label class="f" for="oRegion">地區</label><select class="input" id="oRegion"><option value="全">全部地區</option><option value="北">北區</option><option value="中">中區</option><option value="南">南區</option></select></div></div>' +
      '<label class="f">這一天</label><div class="choice">' +
      '<label class="chk on"><input type="radio" name="oOff" value="1" checked>停班（不用上班）</label>' +
      '<label class="chk"><input type="radio" name="oOff" value="0">要上班</label></div>' +
      '<label class="f" for="oNote">說明</label><input class="input" id="oNote" maxlength="30" placeholder="例如：凱米颱風停班">' +
      '<div class="btn-row"><button class="btn" id="oSave">新增調整</button></div>' +
      (ov.length ? '<table class="grid" style="margin-top:16px"><thead><tr><th>日期</th><th>地區</th><th>設定</th><th>說明</th><th></th></tr></thead><tbody>' +
        ov.map(function (o) {
          return '<tr><td>' + BM.fmtDate(o.date) + '</td><td>' + (o.region === '全' ? '全部' : o.region + '區') + '</td>' +
            '<td>' + (o.off ? '<span class="badge warn">停班</span>' : '<span class="badge">上班</span>') + '</td><td>' + esc(o.note) + '</td>' +
            '<td><button class="btn small danger" data-rm="' + esc(o.id) + '">取消</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p class="small muted">這一年還沒有手動調整。</p>') + '</div>' +
      '<details class="card"><summary><b>政府辦公日曆（' + hol.length + ' 天）</b></summary>' +
      '<p class="small muted">自動讀取 Google 的台灣假日日曆，每 7 天更新一次。週末以外的放假日和補班日如下：</p>' +
      (hol.length ? '<table class="grid"><tbody>' + hol.map(function (x) {
        return '<tr><td>' + BM.fmtDate(x.date) + '</td><td>' + (x.off ? '<span class="badge gray">放假</span>' : '<span class="badge">補班</span>') + '</td><td>' + esc(x.name) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="small muted">還沒有讀到這一年的假日（政府通常在前一年 6 月公告）。</p>') +
      '<div class="btn-row"><button class="btn small ghost" id="oRefresh">重新讀取政府日曆</button>' +
      (d.sheetUrl ? '<a class="btn small ghost" href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">打開出勤試算表</a>' : '') + '</div></details>';

    $('#yPrev').onclick = function () { S.year = String(y - 1); mount(box.parentElement); };
    $('#yNext').onclick = function () { S.year = String(y + 1); mount(box.parentElement); };
    $$('input[name=oOff]', box).forEach(function (x) {
      x.onchange = function () { $$('input[name=oOff]', box).forEach(function (z) { z.parentElement.classList.toggle('on', z.checked); }); };
    });
    $('#oSave').onclick = async function () {
      var o = { date: $('#oDate').value, region: $('#oRegion').value, off: $('input[name=oOff]:checked').value === '1', note: $('#oNote').value.trim() };
      if (!o.date) return BM.toast('請選擇日期', true);
      if (!o.note) return BM.toast('請填寫說明', true);
      S.year = o.date.slice(0, 4);
      S.data = await call('attCalSave', { year: S.year, override: o });
      BM.toast('已新增');
      render();
    };
    $$('[data-rm]', box).forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('取消這筆調整？')) return;
        S.data = await call('attCalRemove', { year: S.year, id: b.dataset.rm });
        render();
      };
    });
    $('#oRefresh').onclick = async function () {
      S.data = await call('attCalRefresh', { year: S.year });
      BM.toast('已更新');
      render();
    };
  }

  BM.admin = BM.admin || {};
  BM.admin.attendance = { mount: mount };
})();
