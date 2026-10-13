// Photos and voice notes, made small in the browser before they are saved.
// Used by Log (photos, voice) and Money (receipts).
import { el, flash, dialog } from '../core/dom.js';

async function jpeg(file, max, q) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = el('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);      // see-through PNGs go on white, not black
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', q);
}

// ponytail: 1600px JPEG keeps a phone photo near 300 KB; the original stays wherever you took it.
export const shrink = async file => ({ image: await jpeg(file, 1600, 0.85), thumb: await jpeg(file, 240, 0.7) });

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

/** Send a video to an entry: base is the app's own path ('/log/'). Returns its id. */
export async function uploadClip(base, entryId, file, info = {}) {
  const r = await fetch(`${base}clip/${entryId}${info.duration ? `?duration=${info.duration.toFixed(1)}` : ''}`, {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'video/mp4', 'X-Daybook': '1' } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `the video did not upload (${r.status})`);
  if (info.thumb) await fetch(`${base}api/clip/${out.id}/thumb`, { method: 'POST', body: JSON.stringify({ thumb: info.thumb }),
    headers: { 'Content-Type': 'application/json', 'X-Daybook': '1' } }).catch(() => {});
  return out.id;
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
