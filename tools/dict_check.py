#!/usr/bin/env python3
"""Look up every Serbian word from words.json in English Wiktionary
(Serbo-Croatian section) and save accented headwords, gender and IPA.

Runs in GitHub Actions (needs internet). Results are cached in
reports/dictionary.json so each word is fetched only once; delete an entry
to refetch it.
"""
import json, pathlib, re, time, unicodedata, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "reports" / "dictionary.json"
API = "https://en.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page="
UA = {"User-Agent": "srpske-reci-flashcards/1.0 (https://github.com/mopilek96-ai/srpske-reci)"}

# words in our list whose dictionary headword differs from how we wrote them
LEMMA = {"cipele": "cipela", "ljudi": "čovek", "jagode": "jagoda"}
CLITICS = {"je", "sam", "si", "su", "smo", "ste", "li", "se", "me", "da", "na", "u", "iz", "sa", "i"}
ACCENTS = {"̀", "́", "̏", "̑"}  # ` ´ double-grave inverted-breve


def lookup_tokens(w):
    toks = re.findall(r"[^\s.,!?—–\-]+", w["sr"])
    if len(toks) == 1:
        t = toks[0]
        return [LEMMA.get(t.lower(), t)]
    return [LEMMA.get(t.lower(), t) for t in toks if t.lower() not in CLITICS]


def fetch(title):
    for t in (title, title.lower(), title[:1].upper() + title[1:]):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + urllib.parse.quote(t), headers=UA), timeout=30) as r:
                data = json.load(r)
        except Exception as e:  # network hiccup: try next form
            data = {"error": str(e)}
        if "parse" in data:
            return t, data["parse"]["wikitext"]
    return title, None


def sh_section(text):
    m = re.search(r"^==\s*Serbo-Croatian\s*==\s*$", text, re.M)
    if not m:
        return None
    rest = text[m.end():]
    n = re.search(r"^==[^=].*==\s*$", rest, re.M)
    return rest[: n.start()] if n else rest


def parse(section):
    heads, genders, ipas, pos = [], [], [], []
    for m in re.finditer(r"\{\{sh-([a-z ]+)\|([^{}]*)\}\}", section):
        kind, body = m.group(1), m.group(2)
        if kind in ("IPA", "pr", "hyphenation"):
            continue
        pos.append(kind)
        for part in body.split("|"):
            k, _, v = part.partition("=")
            val = v if _ else k
            key = k if _ else ""
            if key.startswith("g"):
                genders.append(val)
            elif any(c in ACCENTS for c in unicodedata.normalize("NFD", val)):
                heads.append(val)
            elif not _ and val in ("m", "f", "n", "m-p", "f-p", "n-p", "m-an", "m-in"):
                genders.append(val)
    for m in re.finditer(r"\{\{IPA\|sh\|([^{}]*)\}\}", section):
        ipas += [p for p in m.group(1).split("|") if p.startswith("/") or p.startswith("[")]
    for m in re.finditer(r"\{\{sh-IPA\|?([^{}]*)\}\}", section):
        ipas.append("sh-IPA:" + m.group(1))
    return {"pos": pos, "heads": heads, "genders": genders, "ipa": ipas}


def main():
    words = json.loads((ROOT / "words.json").read_text(encoding="utf-8"))
    OUT.parent.mkdir(exist_ok=True)
    cache = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    new = 0
    for w in words:
        for tok in lookup_tokens(w):
            if tok in cache:
                continue
            title, text = fetch(tok)
            sec = sh_section(text) if text else None
            cache[tok] = {"title": title, "found": bool(sec), **(parse(sec) if sec else {})}
            new += 1
            time.sleep(0.3)
    OUT.write_text(json.dumps(dict(sorted(cache.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    found = sum(1 for v in cache.values() if v.get("found"))
    print(f"looked up {new} new tokens; {found}/{len(cache)} found in Wiktionary")


if __name__ == "__main__":
    main()
