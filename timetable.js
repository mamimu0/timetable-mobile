/*
 * 時間割PDF(週間・生徒掲示用)の読み取りと、クラス/コースごとの時間割・.ics の生成。
 * ブラウザ(<script>)でも Node(require)でも動く。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timetable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 時程表(金沢大学附属高校)
  const BELLS = {
    50: [['8:45', '9:35'], ['9:45', '10:35'], ['10:45', '11:35'], ['11:45', '12:35'],
         ['13:25', '14:15'], ['14:25', '15:15'], ['15:25', '16:15']],
    45: [['8:45', '9:30'], ['9:40', '10:25'], ['10:35', '11:20'], ['11:30', '12:15'],
         ['13:05', '13:50'], ['14:00', '14:45'], ['14:55', '15:40']],
  };
  const CLASSES = ['A', 'B', 'C'];
  const COURSES = ['L', 'S1', 'S2'];
  const WEEKDAYS = ['月', '火', '水', '木', '金'];
  // この科目が入っている時間は、クラスの行ではなくコース(L/S1/S2)の行を読む
  const SPLIT_RE = /[化物生αβγ]|公共/;

  const blank = (s) => s.replace(/[\s\u3000]/g, '');

  // pdf.js の getTextContent() の結果を扱いやすい形にする
  function fromPdfjs(textContent) {
    return textContent.items
      .map((i) => ({ str: blank(i.str || ''), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }))
      .filter((i) => i.str);
  }

  /**
   * 文字の座標から週間時間割の表を組み立てる。
   * 戻り値: { days, nRows, cells[day][row][period0], notes[day][period0] }
   *   行は上から 1年A,B,C / 2年A(L),B(S1),C(S2) / 3年…
   */
  function parseWeek(rawItems) {
    const items = rawItems.map((i) => Object.assign({}, i, { cx: i.x + i.w / 2, cy: i.y + i.h / 2 }));

    // --- 列: 「1限」…「7限」の見出し ---
    const heads = items.filter((i) => /^[1-7]限$/.test(i.str));
    if (heads.length < 7) throw new Error('時間割の表が見つかりませんでした（このPDFは対応していない形式かもしれません）');
    const yCount = new Map();
    heads.forEach((h) => { const k = Math.round(h.y); yCount.set(k, (yCount.get(k) || 0) + 1); });
    const headY = [...yCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const cols = heads.filter((h) => Math.abs(h.y - headY) < 3).sort((a, b) => a.cx - b.cx);
    if (cols.length % 7 !== 0 || cols.some((c, k) => c.str !== (k % 7 + 1) + '限')) {
      throw new Error('1限〜7限の列を正しく読み取れませんでした');
    }
    const nDays = cols.length / 7;
    const pitch = (cols[cols.length - 1].cx - cols[0].cx) / (cols.length - 1);
    const left = cols[0].cx - pitch / 2;
    const right = cols[cols.length - 1].cx + pitch / 2;
    const dayOf = (cx) => Math.floor((cx - left) / (pitch * 7));

    // --- 日: 見出しの日付・曜日・「45分授業」 ---
    const days = Array.from({ length: nDays }, (_, index) => ({ index, text: '' }));
    items.filter((i) => i.cy > headY + 3 && i.cx > left && i.cx < right && !/^[1-7]限$/.test(i.str))
      .sort((a, b) => a.cx - b.cx)
      .forEach((i) => { const d = dayOf(i.cx); if (days[d]) days[d].text += i.str; });
    days.forEach((d) => {
      const m = /(\d{1,2})月(\d{1,2})日/.exec(d.text);
      d.hasDate = !!m;
      d.month = m ? +m[1] : null;
      d.day = m ? +m[2] : null;
      d.is45 = /45分/.test(d.text);
      d.off = !d.hasDate; // 日付がない曜日は祝日などの休み
      d.weekday = WEEKDAYS[d.index] || '';
    });

    // --- 行: 左端の「Ａ」「Ｂ(S1)」などのラベル ---
    const labels = items.filter((i) => i.cx < left && i.cy < headY && /^[ＡＢＣ]/.test(i.str)).sort((a, b) => b.cy - a.cy);
    if (labels.length === 0 || labels.length % 3 !== 0) throw new Error('クラスの行を正しく読み取れませんでした');
    const nRows = labels.length;
    const rowY = labels.map((l) => l.cy);

    // --- 本体の文字を(列, 行)に割り当てる ---
    const body = [];
    for (const i of items) {
      if (i.cx <= left || i.cx >= right || i.cy >= headY - 2) continue;
      const col = Math.round((i.cx - cols[0].cx) / pitch);
      if (col < 0 || col >= cols.length || Math.abs(i.cx - cols[col].cx) > pitch * 0.5) continue;
      let row = 0;
      rowY.forEach((y, r) => { if (Math.abs(i.cy - y) < Math.abs(i.cy - rowY[row])) row = r; });
      if (Math.abs(i.cy - rowY[row]) > 22) continue; // 表の外(注意書きなど)
      body.push(Object.assign(i, { col, row }));
    }

    // --- 複数マスにまたがる縦書き(「身体計測」「避難訓練」など)を見つける ---
    // 通常のマスは高さ40に2文字までしか入らないので、文字間隔17.2で3文字以上つながっていたら結合セル。
    const notes = days.map(() => Array(7).fill(null));
    const consumed = new Set();
    for (let col = 0; col < cols.length; col++) {
      const big = body.filter((i) => i.col === col && i.h >= 14).sort((a, b) => b.cy - a.cy);
      let chain = [];
      const flush = () => {
        if (chain.length >= 3) {
          const grades = new Set(chain.map((c) => Math.floor(c.row / 3)));
          notes[Math.floor(col / 7)][col % 7] = { text: chain.map((c) => c.str).join(''), grades };
          chain.forEach((c) => consumed.add(c));
        }
        chain = [];
      };
      big.forEach((it) => {
        const gap = chain.length ? chain[chain.length - 1].cy - it.cy : 0;
        if (chain.length && !(gap >= 16.4 && gap <= 18.0)) flush();
        chain.push(it);
      });
      flush();
    }

    // --- セルの文字を上から順につなぐ ---
    const cells = days.map(() => Array.from({ length: nRows }, () => Array(7).fill('')));
    body.filter((i) => !consumed.has(i))
      .sort((a, b) => b.cy - a.cy || a.cx - b.cx)
      .forEach((i) => { cells[Math.floor(i.col / 7)][i.row][i.col % 7] += i.str; });

    return { days, nDays, nRows, cells, notes };
  }

  // 「物生」(物理か生物を選ぶマス)や、α/β/γの置き換え
  function personalize(text, sel) {
    if (text === '物生') text = sel.bio ? '生' : '物';
    if (sel.alias && sel.alias[text]) text = sel.alias[text];
    return text;
  }

  /** 1日分の時間割(選んだ学年・クラス・コースの分) */
  function resolveDay(week, dIdx, sel) {
    const day = week.days[dIdx];
    const g = sel.grade - 1;
    const base = g * 3;
    if (week.nRows < base + 3) throw new Error(sel.grade + '年の行がこのPDFにありません');
    const ci = CLASSES.indexOf(sel.cls);
    const si = COURSES.indexOf(sel.course);
    const bells = BELLS[day.is45 ? 45 : 50];
    const periods = [];
    for (let p = 0; p < 7; p++) {
      let text;
      const note = week.notes[dIdx][p];
      if (note && note.grades.has(g)) {
        text = note.text;
      } else if (sel.grade === 1) {
        text = week.cells[dIdx][base + ci][p];
      } else {
        const three = [0, 1, 2].map((k) => week.cells[dIdx][base + k][p]);
        text = three[three.some((t) => SPLIT_RE.test(t)) ? si : ci];
      }
      periods.push({ period: p + 1, text: personalize(text, sel), start: bells[p][0], end: bells[p][1] });
    }
    return { day, periods };
  }

  function label(sel) {
    if (sel.grade === 1) return '1年' + sel.cls + '組';
    return sel.grade + '年' + sel.cls + '組 ' + sel.course + (sel.course === 'S2' ? (sel.bio ? '(生物)' : '(物理)') : '');
  }

  /** その週の月曜日 {y,m,d} をファイル名/見出しから推定する */
  function guessMonday(fileName, week, today) {
    today = today || new Date();
    const first = week.days.findIndex((d) => d.hasDate);
    if (first < 0) return null;
    let month = week.days[first].month;
    let day = week.days[first].day;
    const m = /(\d{2})(\d{2})/.exec(fileName || '');
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) { month = +m[1]; day = +m[2]; } // 見出しに誤植があってもファイル名を優先
    let best = null;
    for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
      const t = Date.UTC(y, month - 1, day - first);
      if (best === null || Math.abs(t - today.getTime()) < Math.abs(best - today.getTime())) best = t;
    }
    const d = new Date(best);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  /** 月曜日 + n日 の {y,m,d} */
  function addDays(monday, n) {
    const d = new Date(Date.UTC(monday.y, monday.m - 1, monday.d + n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (o) => '' + o.y + pad(o.m) + pad(o.d);
  const icsTime = (o, hhmm) => { // 日本時間 → UTC
    const [h, mi] = hhmm.split(':').map(Number);
    const t = new Date(Date.UTC(o.y, o.m - 1, o.d, h - 9, mi));
    return '' + t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + 'T' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + '00Z';
  };
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  /** .ics を作る。同じ日・限は同じUIDなので、入れ直すと上書きされる */
  function buildICS(week, sel, monday, opts) {
    opts = opts || {};
    const now = new Date();
    const stamp = '' + now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jikanwari-smartphone//JA', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:時間割', 'X-WR-TIMEZONE:Asia/Tokyo'];
    let count = 0;
    week.days.forEach((day, d) => {
      if (day.off) return;
      const date = addDays(monday, d);
      resolveDay(week, d, sel).periods.forEach((pr) => {
        if (!pr.text) return;
        count++;
        lines.push('BEGIN:VEVENT',
          'UID:' + ymd(date) + '-p' + pr.period + '@jikanwari.local',
          'DTSTAMP:' + stamp,
          'DTSTART:' + icsTime(date, pr.start),
          'DTEND:' + icsTime(date, pr.end),
          'SUMMARY:' + esc(pr.period + '限 ' + pr.text),
          'DESCRIPTION:' + esc(label(sel) + '\n' + pr.start + '〜' + pr.end));
        if (opts.alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(pr.period + '限 ' + pr.text), 'TRIGGER:-PT' + opts.alarm + 'M', 'END:VALARM');
        lines.push('END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    return { ics: lines.join('\r\n') + '\r\n', count };
  }

  return { BELLS, CLASSES, COURSES, WEEKDAYS, fromPdfjs, parseWeek, resolveDay, label, guessMonday, addDays, buildICS };
});
