#!/usr/bin/env python3
"""Generate mp3 audio for every Serbian word and example in words.json.

Uses Azure AI Speech (neural voice). Only texts that don't have audio yet are
sent, so each run costs just the new words. Writes audio/<hash>.mp3 and
audio/index.json ({text: file}).

Env: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (e.g. westeurope)
Optional: TTS_VOICE (default sr-Latn-RS-SophieNeural)
"""
import hashlib, json, os, pathlib, sys, time, urllib.request, urllib.error
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
VOICE = os.environ.get("TTS_VOICE", "sr-Latn-RS-SophieNeural")


def fname(text: str) -> str:
    return hashlib.sha1(f"{VOICE}|{text}".encode("utf-8")).hexdigest()[:16] + ".mp3"


def synth(text: str, key: str, region: str, slow: bool) -> bytes:
    rate = "-15%" if slow else "-5%"
    lang = "-".join(VOICE.split("-")[:-1])  # e.g. sr-Latn-RS
    ssml = (f'<speak version="1.0" xml:lang="{lang}"><voice name="{VOICE}">'
            f'<prosody rate="{rate}">{escape(text)}</prosody></voice></speak>')
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"), method="POST",
        headers={"Ocp-Apim-Subscription-Key": key,
                 "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                 "User-Agent": "srpske-reci"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(3 * (attempt + 1)); continue
            raise SystemExit(f"Azure TTS error {e.code} for {text!r}: {e.read()[:300]!r}")
    raise SystemExit("Azure TTS: too many retries")


def main():
    key, region = os.environ.get("AZURE_SPEECH_KEY"), os.environ.get("AZURE_SPEECH_REGION")
    words = json.loads((ROOT / "words.json").read_text(encoding="utf-8"))
    AUDIO.mkdir(exist_ok=True)
    idx_path = AUDIO / "index.json"
    old = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {}

    texts = {}  # text -> slow?
    for w in words:
        if w.get("sr"): texts[w["sr"]] = True
        if w.get("ex_sr"): texts.setdefault(w["ex_sr"], False)

    index, todo = {}, []
    for t, slow in texts.items():
        f = fname(t)
        if (AUDIO / f).exists():
            index[t] = f
        else:
            todo.append((t, slow, f))

    if todo and not (key and region):
        print(f"{len(todo)} texts need audio, but AZURE_SPEECH_KEY/REGION are not set; skipping.")
    elif todo:
        chars = sum(len(t) for t, _, _ in todo)
        print(f"Generating {len(todo)} audio files ({chars} characters) with {VOICE}")
        for t, slow, f in todo:
            (AUDIO / f).write_bytes(synth(t, key, region, slow))
            index[t] = f
            time.sleep(0.4)  # stay well under the free-tier rate limit

    # remove audio no longer used by any word
    used = set(index.values())
    for p in AUDIO.glob("*.mp3"):
        if p.name not in used:
            p.unlink()

    new = dict(sorted(index.items()))
    if new != old:
        idx_path.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"audio/index.json: {len(new)} entries")


if __name__ == "__main__":
    main()
