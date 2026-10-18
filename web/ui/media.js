// Photos and voice notes, made small in the browser before they are saved.
// Used by Log (photos, voice) and Money (receipts).
import { el, flash, dialog } from '../core/dom.js';

/** A canvas of src at most max px on its long side, on white (a see-through PNG goes on white, not black). */
function scaled(src, max) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = el('canvas', { width: Math.round(src.width * s), height: Math.round(src.height * s) });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
/** A canvas as a JPEG data URL, encoded off the main thread where the browser can (toBlob), so the page does not stall. */
const jpeg = (c, q) => new Promise((ok, bad) => c.toBlob(b => {
  if (!b) return bad(new Error('the picture could not be made smaller'));
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(r.error); r.readAsDataURL(b);
}, 'image/jpeg', q));

// ponytail: 1600px JPEG keeps a phone photo near 300 KB; the original stays wherever you took it.
/** A photo read once (a phone's 12 MP photo is the slow part), then made 1600px and, from that, a 240px thumbnail. */
export async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const big = scaled(bmp, 1600);
  bmp.close();
  return { image: await jpeg(big, 0.85), thumb: await jpeg(scaled(big, 240), 0.7) };
}

/** A data URL (from the inbox) back into something shrink() takes. */
export const blobOf = async url => (await fetch(url)).blob();

/** Every picture in a paste or a drop. */
export const picturesIn = dt => [...(dt?.files || [])].filter(f => f.type.startsWith('image/'));

/** Shrink each picture; a file that will not read is reported, not fatal. */
export async function shrinkAll(files) {
  const out = [];
  for (const f of files) {
    try { out.push(await shrink(f)); }
    catch { flash(`Can't read ${f.name || 'that picture'}. Save it as JPEG or PNG and try again.`); }
  }
  return out;
}

// --- videos (Log) ------------------------------------------------------------------------
// A browser cannot shrink a video, so it goes up as it is (raw, not base64) and plays from the Pi
// in pieces. A phone's minute of video is about 60 MB; a longer one is trimmed on the phone first.
export const CLIP_MAX = 60 * 1024 * 1024;
export const isVideo = f => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name || '');
/** Pictures and videos in a paste or a drop. */
export const mediaIn = dt => [...(dt?.files || [])].filter(f => f.type.startsWith('image/') || isVideo(f));

/** A video's first frame (240px JPEG) and its length, if this browser can read it (a PC may not read an
 *  iPhone's HEVC: it still uploads, without a picture). */
export function videoInfo(file) {
  return new Promise(done => {
    const url = URL.createObjectURL(file), v = el('video', { muted: true, playsinline: true, preload: 'metadata' });
    const end = (thumb = null) => { URL.revokeObjectURL(url); done({ thumb, duration: isFinite(v.duration) ? v.duration : null }); };
    const timer = setTimeout(() => end(), 6000);
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); }, { once: true });
    v.addEventListener('seeked', () => {
      clearTimeout(timer);
      try {
        const s = 240 / Math.max(v.videoWidth, v.videoHeight, 1), c = el('canvas', { width: Math.round(v.videoWidth * s), height: Math.round(v.videoHeight * s) });
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        end(c.toDataURL('image/jpeg', 0.7));
      } catch { end(); }
    }, { once: true });
    v.addEventListener('error', () => { clearTimeout(timer); end(); }, { once: true });
    v.src = url;
  });
}

/** Send a video to an entry: base is the app's own path ('/log/'). Returns its id. progress(0…1) as it goes
 *  (XMLHttpRequest, because fetch cannot say how much of an upload has gone). */
export async function uploadClip(base, entryId, file, info = {}, progress = () => {}) {
  const out = await new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${base}clip/${entryId}${info.duration ? `?duration=${info.duration.toFixed(1)}` : ''}`);
    x.setRequestHeader('Content-Type', file.type || 'video/mp4');
    x.setRequestHeader('X-Daybook', '1');
    x.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch { /* not JSON: the status says enough */ }
      if (x.status >= 200 && x.status < 300) ok(j); else bad(new Error(j.error || `the video did not upload (${x.status})`));
    };
    x.onerror = () => bad(new Error('the video did not upload: the connection dropped. Try again.'));
    x.send(file);
  });
  if (info.thumb) await fetch(`${base}api/clip/${out.id}/thumb`, { method: 'POST', body: JSON.stringify({ thumb: info.thumb }),
    headers: { 'Content-Type': 'application/json', 'X-Daybook': '1' } }).catch(() => {});
  return out.id;
}

/** A note that stays while something is sent, with how far it has got: busy('Uploading video 1 of 2', 0.45).
 *  busy() takes it away. (A flash fades; an upload can take a minute.) */
let busyBox = null;
export function busy(msg, frac) {
  if (msg == null) { busyBox?.remove(); busyBox = null; return; }
  busyBox ??= document.body.appendChild(el('div', { class: 'busy', role: 'status' }, el('span'), el('progress', { max: 1 })));
  busyBox.firstChild.textContent = msg;
  if (frac == null) busyBox.lastChild.removeAttribute('value'); else busyBox.lastChild.value = frac;
}

/** A video on an entry: its picture with ▶; opens a player (the Pi sends it in pieces as it plays). */
export function videoTile(att, base, title) {
  return el('button', { class: 'thumb vid', type: 'button', title: 'Play video', onclick: () => {
    const v = el('video', { controls: true, playsinline: true, autoplay: true, class: 'full', src: `${base}clip/${att.id}` });
    dialog(title, v);
  } }, att.thumb ? el('img', { src: att.thumb, alt: 'Video' }) : el('span', { class: 'novid' }, 'Video'),
    el('span', { class: 'play' }, '▶'), att.duration_s ? el('span', { class: 'len num' }, clock(att.duration_s)) : null);
}

/** Take pictures from the camera (phone) or files. accept may add PDF (receipts), or video (Log). */
export function pictureInput(onFiles, { multiple = true, camera = true, accept = 'image/*' } = {}) {
  const i = el('input', { type: 'file', accept, multiple, capture: camera ? 'environment' : null, hidden: true });
  i.addEventListener('change', () => { if (i.files.length) onFiles([...i.files]); i.value = ''; });
  return i;
}

/** A photo at full size, in a box. src may be a promise (loaded when opened). */
export function viewImage(src, title) {
  const img = el('img', { alt: title, class: 'full' });
  dialog(title, img);
  Promise.resolve(src).then(s => { if (s) img.src = s; });
}

/** Photos one after another: ← and → (or a swipe, or the buttons) step through, Esc closes.
 *  items: [{src: () => url or a promise of one, title, href}]; more(): fetches the next page, returns how many came. */
export function viewGallery(items, at, { more } = {}) {
  let i = at, seq = 0;
  const img = el('img', { class: 'full', alt: '' });
  const count = el('span', { class: 'muted small num' }), what = el('span', { class: 'gtitle' });
  const step = async n => {
    if (i + n >= items.length && more) await more();          // past the last loaded: the next page first
    if (i + n < 0 || i + n >= items.length) return;
    i += n; show();
  };
  const prev = el('button', { class: 'gnav prev', type: 'button', 'aria-label': 'Previous photo', onclick: () => step(-1) }, '‹');
  const next = el('button', { class: 'gnav next', type: 'button', 'aria-label': 'Next photo', onclick: () => step(1) }, '›');
  const show = async () => {
    const it = items[i], mine = ++seq;
    what.textContent = it.title; img.alt = it.title; count.textContent = `${i + 1} of ${items.length}${more ? '+' : ''}`;
    prev.disabled = i === 0;
    img.classList.add('loading');
    const s = await it.src();
    if (mine === seq && s) { img.src = s; img.classList.remove('loading'); }
    // the neighbours, so the next step is instant
    [items[i + 1], items[i - 1]].forEach(n => n && Promise.resolve(n.src()).catch(() => {}));
  };
  const d = dialog(el('div', { class: 'row mid' }, what, el('span', { class: 'spacer' }), count),
    el('div', { class: 'gallery' }, prev, img, next), [{ label: 'Open the entry', cls: 'btn plain', fn: () => { if (items[i].href) location.hash = items[i].href.replace(/^#/, ''); } }]);
  d.classList.add('gview');
  d.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
  let x0 = null;                                               // a swipe left or right on a phone
  img.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); });
  show();
  return d;
}

/** A PDF, opened in the browser's own viewer. */
export async function viewPdf(dataUrl) {
  const blob = await blobOf(dataUrl);
  open(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), '_blank');
}

// --- voice notes ---------------------------------------------------------------------

export const VOICE_MAX = 600;          // ten minutes a note
/** Why the microphone cannot be used here, or null if it can. */
export function voiceBlocked() {
  if (!window.isSecureContext) return 'Voice notes need this page over HTTPS (or on this computer): see the README, Tailscale Serve.';
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return 'This browser cannot record sound.';
  return null;
}
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** A record/stop button. done({data, duration_s}) gets the note as a data URL. */
export function recorder(done) {
  const why = voiceBlocked();
  if (why) return el('span', { class: 'muted small', title: why }, 'Voice: needs HTTPS');
  let rec = null, started = 0, tick = null;
  const time = el('span', { class: 'num muted small' });
  const btn = el('button', { class: 'btn plain sm rec', type: 'button', title: 'Record a voice note (up to 10 minutes)' }, '● Voice');
  const stop = () => { if (rec?.state === 'recording') rec.stop(); };
  btn.addEventListener('click', async () => {
    if (rec?.state === 'recording') return stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return flash('The microphone was not allowed'); }
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
    const parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    rec.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach(t => t.stop());
      btn.textContent = '● Voice'; btn.classList.remove('on'); time.textContent = '';
      const secs = Math.min(VOICE_MAX, (Date.now() - started) / 1000);
      const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(new Blob(parts, { type: rec.mimeType })); });
      // the stored type is the plain one: data:audio/webm;base64,… (the codec is inside the file anyway)
      done({ data: url.replace(/^data:(audio\/[a-z0-9]+)[^,]*?;base64,/, 'data:$1;base64,'), duration_s: Math.round(secs * 10) / 10 });
    };
    rec.start(1000);
    started = Date.now();
    btn.textContent = '■ Stop'; btn.classList.add('on');
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= VOICE_MAX) stop();
    }, 250);
  });
  return el('span', { class: 'recorder' }, btn, time);
}

/** A voice note: play it (loaded on first press) and see how long it is. */
export function voicePlayer(att, load) {
  const audio = el('audio', { controls: true, preload: 'none' });
  const box = el('span', { class: 'voice' }, el('span', { class: 'num muted small' }, clock(att.duration_s)));
  const play = el('button', { class: 'btn plain sm', type: 'button' }, '▶ Voice note');
  play.addEventListener('click', async () => {
    play.replaceWith(audio);
    audio.src = await load(att.id);
    audio.play().catch(() => {});
  });
  box.prepend(play);
  return box;
}
export const clock = s => s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
