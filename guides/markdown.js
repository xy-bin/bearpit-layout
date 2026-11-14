/* 轻量 Markdown 渲染器（白名单解析，防 XSS）
   浏览器：window.renderMarkdown(src, images) / window.mdPlainText(src)
   Node：  require('./markdown.js').renderMarkdown(...)
   内嵌图片约定：正文写 ![说明](img:N)，images[N] 为压缩后的 data:image/jpeg;base64,...
   这样超长 base64 不会塞进编辑框，图片在文章数据里只存一份。 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.renderMarkdown = api.renderMarkdown; root.mdPlainText = api.mdPlainText; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 只允许位图 data URL；svg / html / script 一律拒绝 */
  var DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
  var RELATIVE = /^(\.\/|\/)[^\s"'<>]+$/;

  function safeUrl(u, isImg, images) {
    u = String(u == null ? '' : u).trim();
    var m = /^img:(\d+)$/i.exec(u);
    if (m) {
      var v = images && images[Number(m[1])];
      return typeof v === 'string' && DATA_IMG.test(v) ? v : '';
    }
    if (/^https?:\/\//i.test(u)) return u;
    if (RELATIVE.test(u)) return u;
    if (isImg && DATA_IMG.test(u)) return u;
    return '';
  }

  /* 行内：代码 -> 图片 -> 链接 先转成占位符，剩余文本转义后再处理强调，最后还原 */
  function inline(s, images) {
    var tokens = [];
    function stash(h) { tokens.push(h); return '\u0001' + (tokens.length - 1) + '\u0001'; }
    var t = String(s == null ? '' : s);
    t = t.replace(/`([^`\n]+)`/g, function (m, c) {
      return stash('<code class="md-code">' + esc(c) + '</code>');
    });
    /* 图片 / 链接地址允许内含一层括号（如 javascript:alert(1)），
       这样非法地址能被整体识别并降级，不会在正文里残留半截语法 */
    t = t.replace(/!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/g, function (m, alt, u) {
      var url = safeUrl(u, true, images);
      return url
        ? stash('<img class="md-img" src="' + esc(url) + '" alt="' + esc(alt) + '" loading="lazy" />')
        : stash(esc(alt || '图片'));   /* 非法地址降级为替代文字，不回显原始语法 */
    });
    t = t.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/g, function (m, txt, u) {
      var url = safeUrl(u, false, images);
      return url
        ? stash('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + '</a>')
        : stash(esc(txt));
    });
    t = esc(t);
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    t = t.replace(/\u0001(\d+)\u0001/g, function (m, i) { return tokens[Number(i)] || ''; });
    return t;
  }

  function splitRow(l) {
    return l.trim().replace(/^\|/, '').replace(/\|\s*$/, '')
      .split('|').map(function (c) { return c.trim(); });
  }

  var BLOCK = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|---|\|)/;

  function renderMarkdown(src, images) {
    images = images || [];
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;

    while (i < lines.length) {
      var l = lines[i];

      /* fenced code */
      if (/^\s*```/.test(l)) {
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre class="md-pre"><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }

      /* heading */
      var h = /^\s*(#{1,6})\s+(.*)$/.exec(l);
      if (h) {
        var n = h[1].length;
        out.push('<h' + n + ' class="md-h">' + inline(h[2], images) + '</h' + n + '>');
        i++;
        continue;
      }

      /* hr */
      if (/^\s*-{3,}\s*$/.test(l) || /^\s*([*_])(?:\s*\1){2,}\s*$/.test(l)) {
        out.push('<hr class="md-hr" />');
        i++;
        continue;
      }

      /* blockquote */
      if (/^\s*>\s?/.test(l)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote class="md-quote">' + renderMarkdown(q.join('\n'), images) + '</blockquote>');
        continue;
      }

      /* unordered list */
      if (/^\s*[-*+]\s+/.test(l)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ul.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, ''), images) + '</li>');
          i++;
        }
        out.push('<ul class="md-list">' + ul.join('') + '</ul>');
        continue;
      }

      /* ordered list */
      if (/^\s*\d+[.)]\s+/.test(l)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          ol.push('<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''), images) + '</li>');
          i++;
        }
        out.push('<ol class="md-list">' + ol.join('') + '</ol>');
        continue;
      }

      /* table: | a | b | + | --- | --- | */
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        var head = splitRow(l);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var th = head.map(function (c) { return '<th>' + inline(c, images) + '</th>'; }).join('');
        var tr = rows.map(function (r) {
          return '<tr>' + r.map(function (c) { return '<td>' + inline(c, images) + '</td>'; }).join('') + '</tr>';
        }).join('');
        out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>' + th +
          '</tr></thead><tbody>' + tr + '</tbody></table></div>');
        continue;
      }

      if (!l.trim()) { i++; continue; }

      /* paragraph：连续普通行合并，单换行用 <br> 保留（攻略里换行通常有意义） */
      var p = [];
      while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i]) && !/^\s*```/.test(lines[i])) {
        p.push(inline(lines[i], images));
        i++;
      }
      if (!p.length) { p.push(inline(lines[i], images)); i++; }  /* 兜底：保证游标前进，避免死循环 */
      out.push('<p class="md-p">' + p.join('<br />') + '</p>');
    }
    return out.join('\n');
  }

  /* 摘要与搜索用纯文本：去掉图片、链接地址、语法标记 */
  function mdPlainText(md) {
    return String(md == null ? '' : md)
      .replace(/!\[[^\]\n]*\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, ' ')
      .replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`\n]*)`/g, '$1')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[*_~|#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { renderMarkdown: renderMarkdown, mdPlainText: mdPlainText };
});
