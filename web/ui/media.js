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

/** Take pictures from the camera (phone) or files. accept may add PDF (receipts). */
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
