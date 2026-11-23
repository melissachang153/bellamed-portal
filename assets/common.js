/* 寶漾行政系統：共用工具（API、登入狀態、格式化） */
var BM = (function () {
  var KEY = window.BM_PREFIX || 'bellamed.'; // 測試頁用另一組前綴，不會動到正式登入

  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(KEY + k) || 'null');
      if (v === null) localStorage.removeItem(KEY + k);
      else localStorage.setItem(KEY + k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  async function api(action, data) {
    if (BM.mock) return BM.mock(action, data || {}); // 測試頁：所有動作都在瀏覽器裡模擬
    return realApi(action, data);
  }
  async function realApi(action, data) {
    var url = window.BELLAMED_CONFIG && window.BELLAMED_CONFIG.apiUrl;
    if (!url || url.indexOf('http') !== 0) throw new Error('尚未設定系統網址（assets/config.js）');
    var body = Object.assign({ action: action }, data || {});
    var res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('連線失敗，請檢查網路後再試一次');
    }
    var j = await res.json();
    if (!j.ok) {
      var msg = j.error === 'AUTH' ? '登入已失效，請重新登入' : j.error === 'PWCHANGE' ? '請先修改管理密碼' :
        j.error === 'REAUTH' ? '請再輸入一次密碼' : j.error;
      var err = new Error(msg);
      err.auth = j.error === 'AUTH';
      err.reauth = j.error === 'REAUTH';
      err.pwchange = j.error === 'PWCHANGE';
      throw err;
    }
    return j.data;
  }

  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  function parse(d) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(d, withYear) {
    if (!d) return '';
    var x = parse(d);
    var s = (withYear === false ? '' : d.slice(0, 4) + '/') + d.slice(5, 7) + '/' + d.slice(8, 10);
    return s + '（' + WD[x.getDay()] + '）';
  }
  function fmtRange(dates) {
    if (!dates || !dates.length) return '日期待定';
    var a = dates[0], b = dates[dates.length - 1];
    // 和後端推播格式一致：2026/12/05-06（同月只寫日）、2026/05/30-06/02
    if (a === b) return a.replace(/-/g, '/');
    if (a.slice(0, 7) === b.slice(0, 7)) return a.replace(/-/g, '/') + '-' + b.slice(8);
    if (a.slice(0, 4) === b.slice(0, 4)) return a.replace(/-/g, '/') + '-' + b.slice(5).replace('-', '/');
    return a.replace(/-/g, '/') + '-' + b.replace(/-/g, '/');
  }
  function today() {
    var d = new Date();
    var t = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000); // 台北時間
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sess(s) { return s === 'AM' ? '上午' : '下午'; }
  function img(id, w) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 1000); }
  function fileUrl(id) { return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view'; }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2800);
  }
  var busyCount = 0, quietCount = 0;
  function busy(on) {
    busyCount += on ? 1 : -1;
    var el = document.getElementById('busy');
    if (el) el.hidden = busyCount <= 0;
  }
  // 背景更新：頂端細進度條，不擋畫面
  function quiet(on) {
    quietCount += on ? 1 : -1;
    var bar = document.getElementById('quietBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'quietBar'; document.body.appendChild(bar); }
    bar.classList.toggle('on', quietCount > 0);
  }
  // opts.silent：已有畫面時在背景更新（不轉圈、失敗也不跳錯誤，除非登入失效）
  async function run(fn, opts) {
    var silent = opts && opts.silent;
    silent ? quiet(true) : busy(true);
    try { return await fn(); }
    catch (e) {
      // 管理功能超過 7 天沒輸入密碼：請使用者再輸入一次，成功後自動重試
      if (e.reauth && BM.onReauth) {
        silent ? quiet(false) : busy(false);
        var again = await BM.onReauth();
        silent ? quiet(true) : busy(true);
        if (again) return await fn();
      }
      if (e.pwchange && BM.onPwChange) BM.onPwChange();
      else if (!silent || e.auth) toast(e.message, true);
      if (e.auth && BM.onAuthFail) BM.onAuthFail();
      throw e;
    }
    finally { silent ? quiet(false) : busy(false); }
  }

  // ---- 本機暫存：先顯示上次的資料，再背景更新 ----
  function cache(k, v) {
    var key = 'c.' + k;
    if (v === undefined) return store(key);
    store(key, v === null ? null : { t: Date.now(), v: v });
  }
  function cached(k) { var c = cache(k); return c ? c.v : null; }
  function clearCache() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY + 'c.') === 0) localStorage.removeItem(k); });
    } catch (e) { }
  }
  // 有暫存就馬上 render，同時背景取得最新資料；資料有變才重畫
  async function swr(key, fetcher, render) {
    var old = cached(key);
    if (old !== null) render(old, true);
    var fresh;
    try { fresh = await run(fetcher, { silent: old !== null }); }
    catch (e) { return old; }
    cache(key, fresh);
    if (old === null || JSON.stringify(old) !== JSON.stringify(fresh)) render(fresh, false);
    return fresh;
  }

  function modal(html, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
      (opts.locked ? '' : '<button class="modal-x" aria-label="關閉">×</button>') + html + '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('noscroll');
    var close = function () { wrap.remove(); if (!document.querySelector('.modal-wrap')) document.body.classList.remove('noscroll'); if (opts.onClose) opts.onClose(); };
    if (!opts.locked) {
      wrap.querySelector('.modal-x').onclick = close;
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    }
    return { el: wrap.querySelector('.modal'), close: close };
  }

  function meetTimesHtml(ev, myRegion) {
    var dates = ev.dates || [];
    if (!dates.length) return '';
    var rows = dates.map(function (d) {
      var m = (ev.meetTimes || {})[d];
      var label = dates.length > 1 ? '<span class="mt-date">' + fmtDate(d, false) + '</span>' : '';
      if (!m) return '<div class="mt-row">' + label + '<span class="muted">待補</span></div>';
      if (m.mode === 'all') return '<div class="mt-row">' + label + '<span class="mt-chip mine">全區 ' + esc(m.all || '待補') + '</span></div>';
      return '<div class="mt-row">' + label + ['北', '中', '南'].map(function (r) {
        return '<span class="mt-chip' + (r === myRegion ? ' mine' : '') + '">' + r + '區 ' + esc(m[r] || '待補') + '</span>';
      }).join('') + '</div>';
    });
    return rows.join('');
  }

  // ---- 版本與問題回報 ----
  var VERSION = '2.0.0'; // 與後端 gas/Code.gs 的 BACKEND_VERSION 一律相同
  var UPDATED = '2026/11/23';

  function footer(pageName, whoFn) {
    var f = document.createElement('footer');
    f.className = 'site-foot';
    f.innerHTML = '<span>版本 v' + VERSION + '・更新日期 ' + UPDATED + '</span>' +
      '<button type="button" class="link-btn">回報問題</button>';
    document.body.appendChild(f);
    f.querySelector('button').onclick = function () {
      var who = (whoFn && whoFn()) || '';
      var m = modal('<h2>回報問題</h2>' +
        '<label class="f" for="rpWho">姓名</label><input class="input" id="rpWho" value="' + esc(who) + '" maxlength="40">' +
        '<label class="f" for="rpMsg">問題描述</label><textarea class="input" id="rpMsg" maxlength="1000" placeholder="例如：按「儲存報名」後一直轉圈"></textarea>' +
        '<div class="btn-row"><button class="btn block" id="rpSend">送出</button></div>');
      m.el.querySelector('#rpSend').onclick = async function () {
        var msg = m.el.querySelector('#rpMsg').value.trim();
        if (!msg) return toast('請描述遇到的問題', true);
        await run(function () {
          return api('reportIssue', { who: m.el.querySelector('#rpWho').value.trim(), page: pageName, message: msg,
            version: VERSION, userAgent: navigator.userAgent });
        });
        toast('已送出，謝謝你的回報');
        m.close();
      };
    };
  }

  // 年度按鈕列（2023～明年），點一下就切換
  function yearChips(current, opts) {
    opts = opts || {};
    var y = Number(today().slice(0, 4));
    var html = '';
    for (var i = y + (opts.noNext ? 0 : 1); i >= 2023; i--) {
      var on = String(i) === String(current);
      html += '<button type="button" class="btn small ' + (on ? '' : 'ghost') + '" data-year="' + i + '"' + (on ? ' aria-pressed="true"' : '') + '>' +
        (opts.label ? opts.label(String(i)) : i) + '</button>';
    }
    return '<div class="year-chips">' + html + '</div>';
  }

  // 參加紀錄的年度下拉選單（2023～明年，預設今年）
  function yearSelect(current, id) {
    var y = Number(today().slice(0, 4));
    var opts = '';
    for (var i = y + 1; i >= 2023; i--) opts += '<option value="' + i + '"' + (String(i) === String(current) ? ' selected' : '') + '>' + i + ' 年</option>';
    return '<select class="input" id="' + id + '" aria-label="年度" style="max-width:180px">' + opts + '</select>';
  }
  // 參加紀錄上方的說明：更新時間＋（匯入說明）
  function recordsHead(rec) {
    return '<p class="small muted" style="margin:8px 4px 0">每次活動結束後隔日更新' + (rec.updatedAt ? '，上次更新：' + esc(rec.updatedAt) : '') +
      (rec.locked ? '　<span class="badge gray">🔒 已結算鎖定</span>' : '') + '</p>' +
      '<div style="height:10px"></div>';
  }

  // ---- 全員參加紀錄表（報名頁的主管/管理員、管理頁共用）----
  // 欄位：員工｜參加場次（日期＋活動）｜次數；點「員工」「次數」表頭排序，再點一次反向
  var recSort = { key: 'total', dir: -1 };
  function recordsTable(box, rec) {
    function draw() {
      var people = rec.people.slice().sort(function (a, b) {
        var byName = String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' });
        if (recSort.key === 'name') return byName * recSort.dir;
        return (a.total - b.total) * recSort.dir || byName;
      });
      var th = function (key, label) {
        var on = recSort.key === key;
        var arrow = on ? (recSort.dir > 0 ? ' ▲' : ' ▼') : ' <span class="sort-hint">▲▼</span>';
        return '<th class="sortable' + (on ? ' on' : '') + '" data-sort="' + key + '" role="button" tabindex="0" aria-sort="' +
          (on ? (recSort.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + label + arrow + '</th>';
      };
      box.innerHTML = '<div class="scroll-x card" style="padding:0"><table class="grid rec-table"><thead><tr>' +
        th('name', '員工') + '<th>參加場次</th>' + th('total', '次數') + '</tr></thead><tbody>' +
        (people.length ? people.map(function (p) {
          return '<tr><td style="white-space:nowrap"><b>' + esc(p.name) + '</b></td><td>' +
            (p.items.map(function (i) { return '<div>' + esc(i.date.slice(5).replace('-', '/') + ' ' + i.name) + '</div>'; }).join('') || '<span class="muted">—</span>') +
            '</td><td class="num"><b>' + p.total + '</b></td></tr>';
        }).join('') : '<tr><td colspan="3" class="muted">尚無資料</td></tr>') + '</tbody></table></div>';
      box.querySelectorAll('[data-sort]').forEach(function (h) {
        var go = function () {
          var k = h.dataset.sort;
          if (recSort.key === k) recSort.dir = -recSort.dir;
          else recSort = { key: k, dir: k === 'name' ? 1 : -1 };
          draw();
        };
        h.onclick = go;
        h.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      });
    }
    draw();
  }

  return {
    VERSION: VERSION, UPDATED: UPDATED, footer: footer, cache: cache, cached: cached, clearCache: clearCache, swr: swr,
    recordsTable: recordsTable, yearChips: yearChips, yearSelect: yearSelect, recordsHead: recordsHead, realApi: realApi, mock: null,
    store: store, api: api, fmtDate: fmtDate, fmtRange: fmtRange, today: today, esc: esc, sess: sess,
    img: img, fileUrl: fileUrl, linkify: linkify, toast: toast, busy: busy, run: run, modal: modal,
    meetTimesHtml: meetTimesHtml, onAuthFail: null, onPwChange: null, onReauth: null
  };
})();
