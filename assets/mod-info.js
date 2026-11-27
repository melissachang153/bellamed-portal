/* 功能：公告、規章。由 shell.js 掛到內容區。 */
(function () {
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var esc = BM.esc;
  function token() { return BM.store('staffToken'); }
  function api(action, data, opts) { return BM.run(function () { return BM.api(action, Object.assign({ token: token() }, data || {})); }, opts); }
  function ymd(s) { return String(s || '').slice(0, 10).replace(/-/g, '/'); }

  // 已讀紀錄：存在後端（每個人一份，換裝置也一樣）；這台裝置也記一份，畫面馬上更新
  function readSet() { return BM.store('newsRead') || {}; }
  function markRead(id, kind) {
    var r = readSet(); r[(kind || 'news') + ':' + id] = 1; r[id] = 1; BM.store('newsRead', r);
    BM.api('newsRead', { token: token(), kind: kind || 'news', id: id }).catch(function () { });
  }
  function isRead(id, kind) { var r = readSet(); return !!(r[(kind || 'news') + ':' + id] || (!kind && r[id])); }
  // 排定時間：日期＋整點／半點
  function whenFields(p, val) {
    var d = val ? val.slice(0, 10) : '', t = val ? val.slice(11, 16) : '09:00', opts = '';
    for (var m = 0; m < 24 * 60; m += 30) { var v = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); opts += '<option' + (v === t ? ' selected' : '') + '>' + v + '</option>'; }
    return '<input class="input" type="date" id="' + p + 'D" min="' + BM.today() + '" value="' + esc(d) + '" style="max-width:170px"><select class="input" id="' + p + 'T" style="max-width:100px">' + opts + '</select>';
  }
  function fmtWhen(v) { return v ? v.slice(5, 10).replace('-', '/') + ' ' + v.slice(11, 16) : ''; }

  // 從後端讀附件（不公開），回傳可以開啟的網址
  var fileCache = {};
  function fileUrl(action, data) {
    var k = action + JSON.stringify(data);
    if (!fileCache[k]) fileCache[k] = BM.api(action, Object.assign({ token: token() }, data)).then(function (x) {
      var bin = atob(x.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([arr], { type: x.mime }));
    });
    return fileCache[k];
  }
  function thumbs(files, action, extra) {
    return '<div class="att-thumbs">' + files.map(function (f) {
      var img = /^image\//.test(f.mime);
      return '<button type="button" class="att-th ' + (img ? 'img' : 'pdf') + '" data-nf="' + esc(f.id) + '">' + (img ? '' : (/pdf/.test(f.mime) ? 'PDF' : '檔案')) + '<small>' + esc(f.name) + '</small></button>';
    }).join('') + '</div>';
  }
  function bindThumbs(root, action, extraOf) {
    $$('[data-nf]', root).forEach(function (bt) {
      var get = function () { return fileUrl(action, extraOf(bt.dataset.nf)); };
      if (bt.classList.contains('img')) get().then(function (u) { bt.style.backgroundImage = 'url("' + u + '")'; }).catch(function () { });
      bt.onclick = function () { get().then(function (u) { window.open(u, '_blank'); }).catch(function (e) { BM.toast(e.message, true); }); };
    });
  }

  // ======================= 公告 =======================
  var N = { me: null, list: [] };
  function isAdmin() { return !!(N.me && N.me.admin); }
  function mountNews(root, me, sub) {
    N.me = me;
    root.innerHTML = '<div id="modNews">' + (isAdmin() ? '<div class="bar-row"><button class="btn" id="nNew">＋ 新增公告</button></div>' : '') + '<div id="nList"><div class="card empty">讀取中…</div></div></div>';
    if ($('#nNew')) $('#nNew').onclick = function () { openEditor(null); };
    BM.swr('news', function () { return BM.api('newsList', { token: token() }); }, function (list) {
      N.list = list;
      drawNews();
      if (sub) { var n = list.filter(function (x) { return x.id === sub; })[0]; if (n && !$('.modal-wrap')) openNews(n); sub = null; }
    });
  }
  function drawNews() {
    var box = $('#nList');
    if (!box) return;
    box.innerHTML = N.list.length ? '<div class="card news-list">' + N.list.map(function (n) {
      var unread = n.status === 'published' && !n.read && !isRead(n.id);
      var when = n.status === 'scheduled' ? '<span class="badge warn">排定 ' + esc(fmtWhen(n.publishAt)) + '</span>' :
        (n.status === 'published' && n.pushLine && !n.pushedAt && n.pushAt ? '<span class="badge warn">推播 ' + esc(fmtWhen(n.pushAt)) + '</span>' : '');
      return '<a href="#" class="ann-row' + (unread ? ' unread' : '') + '" data-n="' + esc(n.id) + '">' +
        (n.status === 'draft' ? '<span class="tag gray">草稿</span>' : n.pinned ? '<span class="tag pin">置頂</span>' : '<span class="tag">公告</span>') +
        '<span class="grow">' + esc(n.title) + '</span>' + when + '<span class="d">' + (n.status === 'published' ? ymd(n.publishedAt).slice(5) : '') + '</span>' +
        '<span class="new' + (unread ? '' : ' off') + '"' + (unread ? ' aria-label="未讀"' : '') + '></span></a>';
    }).join('') + '</div>' : '<div class="card empty">—</div>';
    $$('[data-n]', box).forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); openNews(N.list.filter(function (x) { return x.id === a.dataset.n; })[0]); };
    });
  }
  function openNews(n) {
    if (!n) return;
    if (n.status === 'published' && !n.read) { markRead(n.id); n.read = true; }
    var m = BM.modal('<h2>' + esc(n.title) + '</h2><div class="small muted">' + ymd(n.publishedAt || n.createdAt) + '</div>' +
      (n.body ? '<div class="news-body">' + BM.linkify(n.body) + '</div>' : '') +
      (n.files.length ? thumbs(n.files) : '') +
      (isAdmin() ? '<div class="btn-row"><button class="btn danger ghost" id="nDel">刪除</button><span class="grow"></span><button class="btn" id="nEdit">編輯</button></div>' : ''));
    bindThumbs(m.el, 'newsFile', function (fid) { return { fileId: fid }; });
    if ($('#nEdit', m.el)) $('#nEdit', m.el).onclick = function () { m.close(); openEditor(n); };
    if ($('#nDel', m.el)) $('#nDel', m.el).onclick = async function () {
      if (!await BM.ask('刪除「' + n.title + '」？', { ok: '刪除' })) return;
      N.list = await api('newsDelete', { id: n.id }); BM.cache('news', N.list); m.close(); drawNews();
    };
    drawNews();
  }
  function openEditor(n) {
    n = n || { id: '', title: '', body: '', pinned: false, files: [], status: 'draft' };
    var files = n.files.slice();
    var target = BM.store('newsPushTarget') || 'main';
    var m = BM.modal('<h2>' + (n.id ? '編輯公告' : '新增公告') + '</h2>' +
      '<label class="f" for="neT">標題</label><input class="input" id="neT" maxlength="80" value="' + esc(n.title) + '">' +
      '<label class="f" for="neB">內容</label><textarea class="input" id="neB" rows="6" maxlength="5000">' + esc(n.body) + '</textarea>' +
      '<label class="f">附件</label><div class="att-files" id="neF"></div>' +
      '<div class="ne-opts"><label class="chk' + (n.pinned ? ' on' : '') + '"><input type="checkbox" id="neP"' + (n.pinned ? ' checked' : '') + '>置頂</label></div>' +
      (n.status !== 'published' ? '<label class="f">發布時間</label><div class="ne-opts"><div class="att-seg"><button type="button" data-pm="now" class="' + (n.publishAt ? '' : 'on') + '">立即</button><button type="button" data-pm="at" class="' + (n.publishAt ? 'on' : '') + '">排定</button></div>' +
        '<span id="neWhen"' + (n.publishAt ? '' : ' hidden') + '>' + whenFields('neP', n.publishAt) + '</span></div>' : '') +
      (!n.pushedAt ? '<label class="f">LINE 推播</label><div class="ne-opts"><label class="chk' + (n.pushLine !== false ? ' on' : '') + '"><input type="checkbox" id="neL"' + (n.pushLine !== false ? ' checked' : '') + '>推播</label>' +
        '<select class="input" id="neG" style="max-width:150px"><option value="main"' + ((n.pushTarget || target) === 'main' ? ' selected' : '') + '>正式群組</option><option value="test"' + ((n.pushTarget || target) === 'test' ? ' selected' : '') + '>測試群組</option></select>' +
        '<div class="att-seg"><button type="button" data-qm="same" class="' + (n.pushAt ? '' : 'on') + '">同發布時間</button><button type="button" data-qm="at" class="' + (n.pushAt ? 'on' : '') + '">另訂</button></div>' +
        '<span id="nePushWhen"' + (n.pushAt ? '' : ' hidden') + '>' + whenFields('neQ', n.pushAt) + '</span></div>' : '') +
      '<div class="btn-row">' + (n.status === 'published' || n.status === 'scheduled' ? '<button class="btn ghost" id="neUn">改回草稿</button>' : '<button class="btn ghost" id="neD">存成草稿</button>') +
      '<span class="grow"></span><button class="btn" id="neOk">' + (n.status === 'published' ? '儲存' : '發布') + '</button></div>');
    var el = m.el;
    $$('.chk input', el).forEach(function (i) { i.onchange = function () { i.parentElement.classList.toggle('on', i.checked); }; });
    var pubMode = n.publishAt ? 'at' : 'now', pushMode = n.pushAt ? 'at' : 'same';
    var setBtn = function () { if ($('#neOk', el) && n.status !== 'published') $('#neOk', el).textContent = pubMode === 'at' ? '排定發布' : '發布'; };
    $$('[data-pm]', el).forEach(function (b) { b.onclick = function () { pubMode = b.dataset.pm; $$('[data-pm]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); $('#neWhen', el).hidden = pubMode !== 'at'; setBtn(); }; });
    $$('[data-qm]', el).forEach(function (b) { b.onclick = function () { pushMode = b.dataset.qm; $$('[data-qm]', el).forEach(function (x) { x.classList.toggle('on', x === b); }); $('#nePushWhen', el).hidden = pushMode !== 'at'; }; });
    setBtn();
    var whenOf = function (p) { var d = $('#' + p + 'D', el).value; return d ? d + 'T' + $('#' + p + 'T', el).value : ''; };
    var drawFiles = function () {
      $('#neF', el).innerHTML = files.map(function (f, i) { return '<span class="file-chip">' + esc(f.name) + '<button type="button" data-rm="' + i + '" aria-label="移除">×</button></span>'; }).join('') +
        (files.length < 10 ? '<label class="file-add">＋ 加入檔案或圖片<input type="file" id="nePick" multiple hidden></label>' : '');
      $$('[data-rm]', el).forEach(function (x) { x.onclick = function () { files.splice(+x.dataset.rm, 1); drawFiles(); }; });
      $('#nePick', el) && ($('#nePick', el).onchange = async function () {
        var list = Array.prototype.slice.call(this.files, 0, 10 - files.length);
        for (var i = 0; i < list.length; i++) files.push(await upload(list[i]));
        drawFiles();
      });
    };
    drawFiles();
    var save = async function (publish, unpublish) {
      var x = { id: n.id, title: $('#neT', el).value.trim(), body: $('#neB', el).value, pinned: $('#neP', el).checked, files: files };
      if (!x.title) return BM.toast('請填寫標題', true);
      var pushLine = publish && $('#neL', el) && $('#neL', el).checked;
      var tgt = $('#neG', el) ? $('#neG', el).value : 'main';
      var publishAt = publish && n.status !== 'published' && pubMode === 'at' ? whenOf('neP') : '';
      var pushAt = pushLine && pushMode === 'at' ? whenOf('neQ') : '';
      var nowMin = BM.today() + 'T' + new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000).toTimeString().slice(0, 5);
      if (publish && n.status !== 'published' && pubMode === 'at' && (!publishAt || publishAt <= nowMin)) return BM.toast('請選擇未來的發布時間', true);
      if (pushLine && pushMode === 'at' && (!pushAt || pushAt <= nowMin)) return BM.toast('請選擇未來的推播時間', true);
      if (pushAt && publishAt && pushAt < publishAt) return BM.toast('推播時間不能早於發布時間', true);
      if (pushLine) {
        BM.store('newsPushTarget', tgt);
        var whenTxt = pushAt ? fmtWhen(pushAt) : publishAt ? fmtWhen(publishAt) : '現在';
        if (!await BM.ask((publishAt ? '排定 ' + fmtWhen(publishAt) + ' 發布' : '發布') + '，' + whenTxt + ' 推播到 LINE ' + (tgt === 'main' ? '正式群組' : '測試群組') + '？', { ok: '確定' })) return;
      }
      var r = await api('newsSave', { news: x, publish: publish, unpublish: !!unpublish, pushLine: pushLine, pushTarget: tgt, publishAt: publishAt, pushAt: pushAt });
      N.list = r.list; BM.cache('news', N.list);
      if (r.pushed && !r.pushed.ok) BM.notice('已發布，但 LINE 推播沒有送出：' + r.pushed.error);
      else BM.toast(publishAt ? '已排定 ' + fmtWhen(publishAt) + ' 發布' : publish ? '已發布' : '已儲存');
      m.close(); drawNews();
    };
    if ($('#neD', el)) $('#neD', el).onclick = function () { save(false); };
    if ($('#neUn', el)) $('#neUn', el).onclick = function () { save(false, true); };
    // 已發布的公告按「儲存」：只改內容；如果還沒推播又勾了推播，就照設定推播
    $('#neOk', el).onclick = function () { save(n.status === 'published' ? !!($('#neL', el) && $('#neL', el).checked) : true); };
  }
  function upload(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > 15 * 1024 * 1024) { BM.toast('檔案太大（上限 15 MB）', true); return reject(new Error('too big')); }
      var r = new FileReader();
      r.onload = function () { api('newsUpload', { name: file.name, mimeType: file.type || 'application/octet-stream', base64: String(r.result).split(',')[1] }).then(resolve, reject); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ======================= 規章 =======================
  function mountRules(root, me, sub) {
    if (sub) return renderDoc(root, sub);
    root.innerHTML = '<div id="modRules"><div class="card empty">讀取中…</div></div>';
    BM.swr('rules', function () { return BM.api('rulesList', { token: token() }); }, function (list) {
      var box = $('#modRules');
      if (!box) return;
      box.innerHTML = list.length ? '<div class="card">' + list.map(function (d) {
        return '<a class="doc-row" href="#/rules/' + esc(d.id) + '"><span class="doc-ty' + (d.video ? ' v' : '') + '">' + (d.video ? '影片' : '頁面') + '</span>' +
          '<span class="grow"><b>' + esc(d.title) + '</b><small>' + ymd(d.date) + '</small></span><span class="go">›</span></a>';
      }).join('') + '</div>' : '<div class="card empty">—</div>';
    });
  }
  function renderDoc(root, id) {
    root.innerHTML = '<div id="modRules"><div class="card empty">讀取中…</div></div>';
    BM.swr('rule_' + id, function () { return BM.api('ruleDoc', { token: token(), id: id }); }, function (d) {
      var box = $('#modRules');
      if (!box) return;
      var h = $('.page-head h2');
      if (h) h.innerHTML = '<a class="crumb" href="#/rules">規章 ›</a>' + esc(d.title);
      var tmp = document.createElement('div');
      tmp.innerHTML = d.html;
      var heads = $$('h3[id]', tmp);
      box.innerHTML = '<div class="doc-meta">' + esc(d.sub) + '<br>' + esc(d.meta) + '</div>' +
        (d.video ? '<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(d.video) + '?rel=0" title="' + esc(d.title) + '" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' : '') +
        (heads.length ? '<nav class="toc">' + heads.map(function (x) { return '<a href="#" data-to="' + x.id + '">' + esc(x.textContent) + '</a>'; }).join('') + '</nav>' : '') +
        '<div class="card manual manual-box" id="manBox">' + d.html + '</div>';
      if (!isRead(id, 'rule')) markRead(id, 'rule');
      // 內容在固定範圍內捲動；點目錄就捲到那一章
      var mb = $('#manBox', box);
      $$('[data-to]', box).forEach(function (a) {
        a.onclick = function (e) {
          e.preventDefault();
          var t = document.getElementById(a.dataset.to);
          if (!t) return;
          mb.scrollTo({ top: t.getBoundingClientRect().top - mb.getBoundingClientRect().top + mb.scrollTop - 8, behavior: 'smooth' });
          var r = mb.getBoundingClientRect();
          if (r.top < 60 || r.top > window.innerHeight - 200) window.scrollTo({ top: r.top + window.scrollY - 70, behavior: 'smooth' });
        };
      });
    });
  }

  BM.modules.news = { mount: mountNews, isRead: isRead, markRead: markRead };
  BM.modules.rules = { mount: mountRules };
})();
