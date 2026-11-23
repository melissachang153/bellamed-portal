/* 頭像：自己畫的 Q 版動物（沒有版權問題）。key 存在人員主檔的 avatar 欄位。 */
(function () {
  var EYES = '<circle cx="25" cy="35" r="2.6" fill="#3a2e2a"/><circle cx="39" cy="35" r="2.6" fill="#3a2e2a"/>' +
    '<circle cx="25.9" cy="34.1" r=".8" fill="#fff"/><circle cx="39.9" cy="34.1" r=".8" fill="#fff"/>';
  var BLUSH = '<ellipse cx="19.5" cy="41" rx="3.6" ry="2.2" fill="#f49a9a" opacity=".55"/><ellipse cx="44.5" cy="41" rx="3.6" ry="2.2" fill="#f49a9a" opacity=".55"/>';
  var SMILE = '<path d="M29.5 44.5q2.5 2.2 5 0" fill="none" stroke="#3a2e2a" stroke-width="1.4" stroke-linecap="round"/>';
  var LIST = [
    ['cat', '貓咪', '#ffe5c7',
      '<path d="M13 26 17 8l12 9z M51 26 47 8 35 17z" fill="#f2a65a"/><path d="M17 13l1.5-1 4 5z M47 13l-1.5-1-4 5z" fill="#f9cfa0"/>' +
      '<circle cx="32" cy="36" r="20" fill="#f2a65a"/><path d="M27 19q5 4 10 0" stroke="#d98a3e" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="32" cy="43" rx="8" ry="5.5" fill="#fff4e6"/>' + EYES + BLUSH +
      '<path d="M30.3 40.2h3.4L32 42z" fill="#d9665b"/><path d="M32 42v1.5m0 0q-1.6 1.6-3.2.6m3.2-.6q1.6 1.6 3.2.6" stroke="#3a2e2a" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '<path d="M12 39h7M12.5 43l6.5-1.5M52 39h-7M51.5 43 45 41.5" stroke="#c97b35" stroke-width="1" stroke-linecap="round"/>'],
    ['bear', '小熊', '#f1e3d3',
      '<circle cx="16" cy="20" r="7.5" fill="#a5734d"/><circle cx="48" cy="20" r="7.5" fill="#a5734d"/><circle cx="16" cy="20" r="3.8" fill="#e8c39e"/><circle cx="48" cy="20" r="3.8" fill="#e8c39e"/>' +
      '<circle cx="32" cy="36" r="20" fill="#a5734d"/><ellipse cx="32" cy="43" rx="9" ry="7" fill="#e8c39e"/>' + EYES + BLUSH +
      '<ellipse cx="32" cy="40.5" rx="3" ry="2.2" fill="#3a2e2a"/>' + SMILE],
    ['rabbit', '兔兔', '#fde4ec',
      '<ellipse cx="24" cy="14" rx="5.5" ry="13" fill="#fff" stroke="#f1d3dd"/><ellipse cx="40" cy="14" rx="5.5" ry="13" fill="#fff" stroke="#f1d3dd"/>' +
      '<ellipse cx="24" cy="15" rx="2.6" ry="9" fill="#f7b9cb"/><ellipse cx="40" cy="15" rx="2.6" ry="9" fill="#f7b9cb"/>' +
      '<circle cx="32" cy="38" r="19" fill="#fff" stroke="#f1d3dd"/>' + EYES + BLUSH +
      '<path d="M30.4 40.6h3.2L32 42.4z" fill="#ef7f9f"/><path d="M32 42.4v1.3m0 0q-1.5 1.5-3 .5m3-.5q1.5 1.5 3 .5" stroke="#3a2e2a" stroke-width="1.1" fill="none" stroke-linecap="round"/>'],
    ['panda', '熊貓', '#e1f1e4',
      '<circle cx="16" cy="20" r="7.5" fill="#2f2f33"/><circle cx="48" cy="20" r="7.5" fill="#2f2f33"/>' +
      '<circle cx="32" cy="36" r="20" fill="#fff" stroke="#dcdcdc"/>' +
      '<ellipse cx="24" cy="35" rx="5" ry="6.5" transform="rotate(-25 24 35)" fill="#2f2f33"/><ellipse cx="40" cy="35" rx="5" ry="6.5" transform="rotate(25 40 35)" fill="#2f2f33"/>' +
      '<circle cx="25" cy="34.5" r="2" fill="#fff"/><circle cx="39" cy="34.5" r="2" fill="#fff"/><circle cx="25.3" cy="34.7" r="1.1" fill="#2f2f33"/><circle cx="38.7" cy="34.7" r="1.1" fill="#2f2f33"/>' +
      BLUSH + '<ellipse cx="32" cy="41.5" rx="2.6" ry="1.9" fill="#2f2f33"/>' + SMILE],
    ['fox', '狐狸', '#ffe9d6',
      '<path d="M12 27 15 7l13 11z M52 27 49 7 36 18z" fill="#f08a3c"/><path d="M15.5 12l1-1.5 6 6z M48.5 12l-1-1.5-6 6z" fill="#3a2e2a" opacity=".75"/>' +
      '<circle cx="32" cy="36" r="20" fill="#f08a3c"/><path d="M13 37q4 15 19 17 15-2 19-17-8 7-19 7t-19-7z" fill="#fff8f0"/>' + EYES + BLUSH +
      '<ellipse cx="32" cy="43" rx="2.6" ry="1.9" fill="#3a2e2a"/><path d="M29.5 46.5q2.5 2 5 0" fill="none" stroke="#3a2e2a" stroke-width="1.3" stroke-linecap="round"/>'],
    ['penguin', '企鵝', '#dceef7',
      '<circle cx="32" cy="35" r="21" fill="#34495e"/><path d="M32 23c-5-3-14-1-15 9-1 9 6 17 15 17s16-8 15-17c-1-10-10-12-15-9z" fill="#fff"/>' +
      EYES + BLUSH + '<path d="M28.5 40h7L32 44.5z" fill="#f5b041"/>'],
    ['dog', '狗狗', '#f6ecd9',
      '<circle cx="32" cy="37" r="19" fill="#f3d9a4"/>' +
      '<ellipse cx="14" cy="33" rx="6.5" ry="12.5" transform="rotate(18 14 33)" fill="#b07a4a"/><ellipse cx="50" cy="33" rx="6.5" ry="12.5" transform="rotate(-18 50 33)" fill="#b07a4a"/>' +
      '<ellipse cx="39.5" cy="33" rx="5" ry="5.5" fill="#e2bf80"/>' +
      '<ellipse cx="32" cy="44" rx="8.5" ry="6" fill="#fffaf0"/>' + EYES + BLUSH +
      '<ellipse cx="32" cy="41" rx="3" ry="2.2" fill="#3a2e2a"/><path d="M32 43.2v1.3m0 0q-1.6 1.7-3.2.6m3.2-.6q1.6 1.7 3.2.6" stroke="#3a2e2a" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '<path d="M30.4 46.4q1.6 3 3.2 0z" fill="#ef7f7f"/>'],
    ['chick', '小雞', '#fff6c9',
      '<path d="M30 16q-1-6 3-8m-1 8q2-5 6-5" stroke="#f0b81c" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
      '<circle cx="32" cy="37" r="20" fill="#ffd84d"/>' + EYES + BLUSH +
      '<path d="M28 40.5q4-3 8 0-4 4-8 0z" fill="#f39c33"/>'],
    ['koala', '無尾熊', '#e6edf3',
      '<circle cx="14" cy="24" r="9" fill="#9aa6b2"/><circle cx="50" cy="24" r="9" fill="#9aa6b2"/><circle cx="14" cy="24" r="5" fill="#f3e6ee"/><circle cx="50" cy="24" r="5" fill="#f3e6ee"/>' +
      '<circle cx="32" cy="37" r="19" fill="#b4bec8"/>' + EYES + BLUSH +
      '<ellipse cx="32" cy="41" rx="4.2" ry="5.2" fill="#4a4a52"/><path d="M29.5 47.5q2.5 1.8 5 0" fill="none" stroke="#3a2e2a" stroke-width="1.3" stroke-linecap="round"/>'],
    ['tiger', '老虎', '#fff0d9',
      '<circle cx="16" cy="20" r="7" fill="#f5a623"/><circle cx="48" cy="20" r="7" fill="#f5a623"/><circle cx="16" cy="20" r="3.5" fill="#fff4e0"/><circle cx="48" cy="20" r="3.5" fill="#fff4e0"/>' +
      '<circle cx="32" cy="36" r="20" fill="#f5a623"/>' +
      '<path d="M32 17v6M27 18l1.5 4.5M37 18l-1.5 4.5M12.5 32h5M12.5 37h4M51.5 32h-5M51.5 37h-4" stroke="#5b3a1a" stroke-width="2" stroke-linecap="round"/>' +
      '<ellipse cx="32" cy="43" rx="9" ry="6" fill="#fff8ec"/>' + EYES + BLUSH +
      '<path d="M30 40h4l-2 2.2z" fill="#d9665b"/><path d="M32 42.2v1.3m0 0q-1.6 1.6-3.2.6m3.2-.6q1.6 1.6 3.2.6" stroke="#3a2e2a" stroke-width="1.1" fill="none" stroke-linecap="round"/>'],
    ['frog', '青蛙', '#e4f5dc',
      '<circle cx="21" cy="21" r="8" fill="#7cc576"/><circle cx="43" cy="21" r="8" fill="#7cc576"/><circle cx="21" cy="21" r="4.6" fill="#fff"/><circle cx="43" cy="21" r="4.6" fill="#fff"/>' +
      '<circle cx="21.5" cy="21.5" r="2.4" fill="#3a2e2a"/><circle cx="42.5" cy="21.5" r="2.4" fill="#3a2e2a"/>' +
      '<ellipse cx="32" cy="38" rx="21" ry="17" fill="#7cc576"/><circle cx="21" cy="21" r="4.6" fill="#fff"/><circle cx="43" cy="21" r="4.6" fill="#fff"/>' +
      '<circle cx="21.5" cy="21.5" r="2.4" fill="#3a2e2a"/><circle cx="42.5" cy="21.5" r="2.4" fill="#3a2e2a"/>' + BLUSH +
      '<path d="M24 41q8 7 16 0" fill="none" stroke="#3a6b35" stroke-width="1.8" stroke-linecap="round"/>'],
    ['owl', '貓頭鷹', '#ece4f6',
      '<path d="M13 22 15 10l9 7z M51 22 49 10l-9 7z" fill="#8e6fb5"/><circle cx="32" cy="36" r="20" fill="#8e6fb5"/>' +
      '<circle cx="24.5" cy="34" r="7.5" fill="#fff"/><circle cx="39.5" cy="34" r="7.5" fill="#fff"/>' +
      '<circle cx="25" cy="34.5" r="3.4" fill="#3a2e2a"/><circle cx="39" cy="34.5" r="3.4" fill="#3a2e2a"/><circle cx="26" cy="33.4" r="1" fill="#fff"/><circle cx="40" cy="33.4" r="1" fill="#fff"/>' +
      '<path d="M29.5 41h5L32 45z" fill="#f5b041"/><path d="M22 48q2.5 2 5 0 2.5 2 5 0 2.5 2 5 0 2.5 2 5 0" fill="none" stroke="#c8b6df" stroke-width="1.5" stroke-linecap="round"/>']
  ];
  var MAP = {};
  LIST.forEach(function (a) { MAP[a[0]] = a; });
  function svg(key, size) {
    var a = MAP[key];
    if (!a) return '';
    return '<svg class="ava" viewBox="0 0 64 64" width="' + (size || 32) + '" height="' + (size || 32) + '" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="32" fill="' + a[2] + '"/><g transform="translate(0 2)">' + a[3] + '</g></svg>';
  }
  BM.avatars = { list: LIST.map(function (a) { return { key: a[0], name: a[1] }; }), svg: svg, has: function (k) { return !!MAP[k]; } };
})();
