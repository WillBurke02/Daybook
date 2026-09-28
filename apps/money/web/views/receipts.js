// Receipts: a photo or a PDF kept with the payment it was for, or kept for
// later and matched by amount and date. Photos are shrunk in the browser; a
// PDF is kept as it came and opens in the browser's own viewer.
import { api } from '../api.js';
import { el, flash, dialog, table } from '../core/dom.js';
import { money, signed, dateUK, dayShort, today, toNumber } from '../core/format.js';
import { shrinkAll, picturesIn, pictureInput, viewImage, viewPdf } from '../ui/media.js';

const PDF_MAX = 10 * 1024 * 1024;
const readUrl = f => new Promise(r => { const x = new FileReader(); x.onload = () => r(x.result); x.readAsDataURL(f); });

/** Photos and PDFs, ready to save: [{image, thumb}]. */
async function prepare(files) {
  const out = [];
  for (const f of files) {
    if (f.type === 'application/pdf') {
      if (f.size > PDF_MAX) { flash(`${f.name} is over 10 MB`); continue; }
      out.push({ image: (await readUrl(f)).replace(/^data:application\/pdf[^,]*,/, 'data:application/pdf;base64,'), thumb: null });
    } else out.push(...await shrinkAll([f]));
  }
  return out;
}
const full = id => api.table('receipt', { id }).then(([r]) => r?.image);
const open = async (r, title) => r.pdf || r.image?.startsWith('data:application/pdf') ? viewPdf(r.image || await full(r.id)) : viewImage(full(r.id), title);
const tile = (r, title) => el('button', { class: 'thumb' + (r.pdf ? ' pdf' : ''), type: 'button', title: r.note || 'Open', onclick: () => open(r, title) },
  r.thumb ? el('img', { src: r.thumb, alt: 'Receipt' }) : el('span', {}, 'PDF'));

/** The receipts for one payment, in a box: add (camera, file, paste), see, note, remove. */
export function openReceipts(t, onChange) {
  const list = el('div', { class: 'stack' });
  let touched = false;
  const draw = async () => {
    const rows = (await api.receiptsFor([t.id]))[t.id] || [];
    list.replaceChildren(...(rows.length ? rows.map(r => {
      const note = el('input', { value: r.note || '', placeholder: 'Note, e.g. what it was for', 'aria-label': 'Note' });
      note.addEventListener('change', async () => { await api.save('receipt', { id: r.id, note: note.value || null }); touched = true; });
      return el('div', { class: 'row mid receipt' }, tile(r, t.description), note,
        el('button', { class: 'icon del', type: 'button', title: 'Remove', onclick: async () => {
          await api.remove('receipt', r.id); touched = true; draw();
          flash('Receipt removed', { label: 'Undo', fn: async () => { await api.undo(); draw(); } });
        } }, '×'));
    }) : [el('p', { class: 'note' }, 'No receipt yet.')]));
  };
  const add = async files => {
    const got = await prepare(files);
    if (!got.length) return;
    try { await api.save('receipt', got.map(g => ({ ...g, txn_id: t.id, date: t.date, amount: Math.abs(t.amount) }))); touched = true; draw(); }
    catch (e) { flash(e.message); }
  };
  const pick = pictureInput(add, { accept: 'image/*,application/pdf', camera: false });
  const cam = pictureInput(add);
  const d = dialog(`Receipts · ${dayShort(t.date)} · ${t.merchant || t.description} · ${money(t.amount)}`, el('div', { class: 'stack' }, list,
    el('div', { class: 'row mid' }, el('button', { class: 'btn sm', type: 'button', onclick: () => cam.click() }, '📷 Photo'), cam,
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => pick.click() }, 'Photo or PDF file…'), pick,
      el('span', { class: 'muted small' }, 'Or paste a screenshot here.'))));
  d.addEventListener('paste', e => { const f = picturesIn(e.clipboardData); if (f.length) { e.preventDefault(); add(f); } });
  d.addEventListener('close', () => { if (touched) onChange?.(); });
  draw();
}

/** The paperclip in a transaction row: how many receipts, or a faint one to add. */
export const clip = (t, mine, onChange) => el('button', { class: 'clip' + (mine?.length ? ' has' : ''), type: 'button',
  title: mine?.length ? `${mine.length} receipt${mine.length > 1 ? 's' : ''}` : 'Attach a receipt', 'aria-label': 'Receipts',
  onclick: () => openReceipts(t, onChange) }, '📎', mine?.length > 1 ? String(mine.length) : '');

export const panels = {
  // Kept before the payment shows on a statement: matched later by amount and date.
  'spending.receipts': { title: 'Receipts waiting for a payment', w: 6, deps: ['receipt', 'txn'], async render(body, ctx) {
    const rows = await api.view('v_receipt', { txn_id: '', order: 'date', desc: 1 });
    const draft = { date: el('input', { type: 'date', class: 'sm', value: today() }),
                    amount: el('input', { class: 'sm', inputmode: 'decimal', placeholder: '£', style: 'width:90px' }),
                    note: el('input', { class: 'sm', placeholder: 'What for' }) };
    const add = async files => {
      const got = await prepare(files);
      if (!got.length) return;
      try {
        await api.save('receipt', got.map(g => ({ ...g, date: draft.date.value || null, amount: toNumber(draft.amount.value), note: draft.note.value || null })));
        ctx.changed('receipt'); ctx.refresh();
      } catch (e) { flash(e.message); }
    };
    const pick = pictureInput(add, { accept: 'image/*,application/pdf', camera: false }), cam = pictureInput(add);
    body.append(el('div', { class: 'row mid', style: 'margin-bottom:8px' }, draft.date, draft.amount, draft.note,
      el('button', { class: 'btn sm', type: 'button', onclick: () => cam.click() }, '📷 Photo'), cam,
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => pick.click() }, 'File…'), pick));
    if (!rows.length) { body.append(el('p', { class: 'note' }, 'None waiting. A receipt kept here is matched to its payment once the statement is in.')); return; }
    const find = async (r, cell) => {
      const cands = await api.receiptMatches(r.id);
      cell.replaceChildren(...(cands.length ? cands.map(c => el('div', { class: 'row mid' },
        el('span', { class: 'num' }, dayShort(c.date)), el('span', {}, c.merchant || c.description), signed(c.amount),
        el('button', { class: 'btn sm', type: 'button', onclick: async () => {
          await api.save('receipt', { id: r.id, txn_id: c.id });
          flash('Linked', { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('receipt'); ctx.refresh(); } });
          ctx.changed('receipt'); ctx.refresh();
        } }, 'Link'))) : [el('span', { class: 'muted' }, 'No payment of that amount within a week of that date yet.')]));
    };
    body.append(table([
      { k: '_t', label: '', sort: false, render: r => tile(r, r.note || 'Receipt') },
      { k: 'date', label: 'Date', fmt: v => v ? dateUK(v) : '' },
      { k: 'amount', label: 'Amount', n: true, fmt: v => v == null ? '' : money(v) },
      { k: 'note', label: 'Note' },
      { k: '_m', label: 'Payment', sort: false, render: r => { const cell = el('div');
          cell.append(el('button', { class: 'btn plain sm', type: 'button', onclick: () => find(r, cell) }, 'Find the payment')); return cell; } },
      { k: '_x', label: '', sort: false, render: r => el('button', { class: 'icon del', type: 'button', title: 'Remove', onclick: async () => {
          await api.remove('receipt', r.id); ctx.changed('receipt'); ctx.refresh();
          flash('Receipt removed', { label: 'Undo', fn: async () => { await api.undo(); ctx.refresh(); } }); } }, '×') },
    ], rows));
  } },
};
