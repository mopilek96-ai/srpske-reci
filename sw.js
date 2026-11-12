// Офлайн-режим: оболочка и слова — «сначала сеть, потом кэш», mp3 и иконки — «сначала кэш».
const CACHE = "srpske-v3";
const SHELL = ["./", "index.html", "app.js", "config.js", "words.json", "grammar.json", "audio/index.json", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    // вся озвучка заранее (≈2–3 МБ), чтобы слова звучали и без интернета
    try {
      const map = await (await fetch("audio/index.json")).json();
      const files = [...new Set(Object.values(map))].map(f => "audio/" + f);
      for (const f of files) {
        try { const r = await fetch(f, {cache: "no-cache"}); if (r.ok) await c.put(f, r); } catch (err) {}
      }
    } catch (err) {}
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase, шрифты — напрямую
  const key = url.pathname.endsWith("/") ? url.pathname : url.pathname; // без ?v=… чтобы кэш находился
  const cacheFirst = /\/(audio\/[^/]+\.mp3|icons\/)/.test(url.pathname);
  if (cacheFirst) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(key, res.clone());
      return res;
    }));
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(key, res.clone()));
      return res;
    }).catch(() => caches.match(key).then(r => r || caches.match("./"))));
  }
});
