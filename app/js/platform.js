/**
 * One surface over two homes.
 *
 * The same `app/` directory ships three ways — a GitHub Pages PWA, a Claude
 * artifact, and a Capacitor shell on the App Store and Play Store — so every
 * device capability is reached through this module and nothing above it knows
 * which one it is running in.
 *
 * Capacitor injects `window.Capacitor` into the WebView and registers native
 * plugins on `Capacitor.Plugins`, so the native path needs no bundler and no
 * import that would fail on the web. Absence is the normal case: on the web the
 * plugins simply are not there, and each function falls back to what a browser
 * can do (a file input, the Web Speech API) or reports that it cannot.
 *
 * Two things only the native shell can do, and they are the reason the shell
 * exists at all:
 *   · receive a KakaoTalk export straight from the share sheet — iOS Safari
 *     cannot register as a share target at all
 *   · recognise speech on the device, so audio never leaves the phone; Chrome's
 *     Web Speech API streams it to Google
 */

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
const plugin = (name) => cap()?.Plugins?.[name];

/** True inside the Capacitor shell, false on the web and in the artifact. */
export const isNative = () => Boolean(cap()?.isNativePlatform?.());

/** 'ios' | 'android' | 'web' */
export const platform = () => cap()?.getPlatform?.() || 'web';

/* ─────────── speaking the answer aloud ─────────── */

/**
 * Read an English sentence out loud.
 *
 * A tester asked for this and the reason is obvious in hindsight: the app asks
 * people to say a sentence they have never heard. Reading it silently tells you
 * the words, not the shape of them.
 *
 * speechSynthesis is in every browser this app runs in and inside the Capacitor
 * WebView, so there is no native plugin here — but it is quietly unreliable.
 * Voices load asynchronously and the list is empty on the first call in most
 * browsers, so picking a voice has to wait for `voiceschanged`. Safari also
 * stays "speaking" after an utterance is cancelled, so every call cancels first.
 *
 * @returns {{available: () => boolean, speak: (text: string) => Promise<void>, stop: () => void}}
 */
export function createSpeaker() {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (!synth) {
    return { available: () => false, speak: async () => {}, stop: () => {} };
  }

  let voice = null;
  const pick = () => {
    const all = synth.getVoices();
    if (!all.length) return null;
    const en = all.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
    const pool = en.length ? en : all;
    // Prefer a US voice, then any English one; a local voice avoids a network
    // round trip and keeps working on a train.
    return pool.find((v) => /^en[-_]US/i.test(v.lang) && v.localService)
      || pool.find((v) => /^en[-_]US/i.test(v.lang))
      || pool.find((v) => v.localService)
      || pool[0]
      || null;
  };

  voice = pick();
  if (!voice) synth.addEventListener?.('voiceschanged', () => { voice = pick(); }, { once: true });

  return {
    available: () => true,
    stop: () => { try { synth.cancel(); } catch { /* nothing was speaking */ } },
    speak(text) {
      return new Promise((resolve) => {
        const line = String(text || '').trim();
        if (!line) return resolve();
        try {
          synth.cancel();                       // Safari stalls without this
          const u = new SpeechSynthesisUtterance(line);
          if (!voice) voice = pick();
          if (voice) u.voice = voice;
          u.lang = (voice && voice.lang) || 'en-US';
          u.rate = 0.92;                        // a shade under natural, to copy
          u.onend = () => resolve();
          u.onerror = () => resolve();          // silence is not worth an error
          synth.speak(u);
        } catch {
          resolve();
        }
      });
    },
  };
}

/* ─────────── share target ─────────── */

/**
 * Call `handler(text)` whenever KakaoTalk (or anything else) shares a chat
 * export into the app. Web returns a no-op: there, import goes through the file
 * input on the first screen.
 *
 * @param {(text: string, name: string) => void} handler
 * @returns {Promise<() => void>} unsubscribe
 */
export async function onSharedChatExport(handler) {
  const share = plugin('CapacitorShareTarget');
  const fs = plugin('Filesystem');

  // Web: an installed PWA on Android can be a share target. The share arrives
  // as a POST that the service worker catches and stashes, and the browser is
  // sent back here with ?shared=1 — so this is a one-shot pickup, not a stream.
  if (!share) {
    if (!/[?&]shared=1/.test(location.search)) return () => {};
    try {
      const res = await caches.match('./__shared-export');
      const text = res ? await res.text() : '';
      // Clear both the stash and the query string so a reload does not re-import.
      for (const k of await caches.keys()) (await caches.open(k)).delete('./__shared-export');
      history.replaceState(null, '', location.pathname);
      if (text.trim()) handler(text, 'shared.txt');
    } catch { /* no cache access; the file input still works */ }
    return () => {};
  }

  const sub = await share.addListener('shareReceived', async (event) => {
    // A share arrives either as plain text or as the exported .txt file.
    const text = (event?.texts || []).find((t) => t && t.trim().length > 20);
    if (text) return handler(text, 'shared.txt');

    const file = (event?.files || []).find((f) => /text|plain|octet-stream/.test(f.mimeType || '') || /\.txt$/i.test(f.name || ''));
    if (!file || !fs) return;
    try {
      const read = await fs.readFile({ path: file.uri, encoding: 'utf8' });
      if (read?.data) handler(String(read.data), file.name || 'shared.txt');
    } catch {
      // A share we cannot read is not worth interrupting the user over; the
      // file input on the import screen still works.
    }
  });

  return () => { try { sub.remove(); } catch { /* listener already gone */ } };
}

/* ─────────── speech recognition ─────────── */

/**
 * A recogniser, native where there is one and Web Speech otherwise.
 *
 * Both shapes are reduced to the same three things the practice screen needs:
 * can we listen at all, start listening with a callback for partial text, and
 * stop. `onEnd` fires once per session with the final transcript.
 */
export function createRecogniser({ onPartial, onEnd, onError }) {
  const native = plugin('SpeechRecognition');
  if (native) return nativeRecogniser(native, { onPartial, onEnd, onError });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) return webRecogniser(SR, { onPartial, onEnd, onError });

  return {
    kind: 'none',
    available: async () => false,
    onDevice: async () => false,
    start: async () => {},
    stop: async () => {},
  };
}

function nativeRecogniser(sr, { onPartial, onEnd, onError }) {
  let heard = '';
  let listening = false;
  let subs = [];

  const attach = async () => {
    if (subs.length) return;
    subs.push(await sr.addListener('partialResults', (e) => {
      const t = e?.accumulatedText || e?.accumulated || (e?.matches || [])[0] || '';
      if (t) { heard = t.trim(); onPartial?.(heard); }
    }));
    subs.push(await sr.addListener('error', (e) => {
      listening = false;
      onError?.(e?.message || 'recognition_failed');
    }));
  };

  return {
    kind: 'native',
    available: async () => {
      try { return Boolean((await sr.available())?.available); } catch { return false; }
    },
    onDevice: async () => {
      try { return Boolean((await sr.isOnDeviceRecognitionAvailable({ language: 'en-US' }))?.available); }
      catch { return false; }
    },
    async start() {
      if (listening) return;
      heard = '';
      const perm = await sr.checkPermissions().catch(() => null);
      if (perm?.speechRecognition !== 'granted') {
        const asked = await sr.requestPermissions().catch(() => null);
        if (asked?.speechRecognition !== 'granted') { onError?.('not-allowed'); return; }
      }
      await attach();
      listening = true;
      // Prefer on-device: the whole point of the native shell is that audio
      // stays on the phone. Fall back to the default path when the locale has
      // no on-device model.
      const onDevice = await this.onDevice();
      try {
        const res = await sr.start({
          language: 'en-US',
          partialResults: true,
          popup: false,
          useOnDeviceRecognition: onDevice,
        });
        const best = (res?.matches || [])[0];
        if (best) heard = String(best).trim();
      } catch (e) {
        onError?.(e?.message || 'recognition_failed');
      } finally {
        listening = false;
        onEnd?.(heard);
      }
    },
    async stop() {
      if (!listening) return;
      try { await sr.stop(); } catch { /* already stopped */ }
    },
  };
}

function webRecogniser(SR, { onPartial, onEnd, onError }) {
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let heard = '';
  let listening = false;

  rec.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    heard = t.trim();
    if (heard) onPartial?.(heard);
  };
  rec.onerror = (e) => { listening = false; onError?.(e.error); };
  rec.onend = () => { listening = false; onEnd?.(heard); };

  return {
    kind: 'web',
    available: async () => true,
    onDevice: async () => false,   // Chrome streams audio to Google
    async start() {
      if (listening) return;
      heard = '';
      try { rec.start(); listening = true; } catch { onError?.('start_failed'); }
    },
    async stop() {
      if (listening) { try { rec.stop(); } catch { /* already stopped */ } }
      listening = false;
    },
  };
}
