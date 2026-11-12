#!/usr/bin/env python3
"""Second pass for words Wiktionary didn't accent directly: try lemma /
Croatian-variant pages on Wiktionary and raw text from Hrvatski jezični portal.
Writes reports/dictionary_alt.json for manual review."""
import html, json, pathlib, re, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys_path = str(ROOT / "tools")
import sys; sys.path.insert(0, sys_path)
from dict_check import fetch, sh_section, parse  # noqa: E402

UA = {"User-Agent": "srpske-reci-flashcards/1.0 (https://github.com/mopilek96-ai/srpske-reci)"}
ALT = {
    "čestitam": ["čestitati"], "tobogan": ["tobogan"], "udica": ["udica"], "programer": ["programer", "programator"],
    "sportista": ["sportista", "sportaš"], "optimista": ["optimista", "optimist"], "pesimista": ["pesimista", "pesimist"],
    "optimističan": ["optimističan", "optimistički"], "zainteresovan": ["zainteresovati", "zainteresirati", "zainteresiran"],
    "raspoložen": ["raspoložen", "raspoložiti"], "nazdravlje": ["zdravlje", "na zdravlje"], "laptop": ["laptop"],
    "kaktus": ["kaktus"], "spavam": ["spavati"], "idem": ["ići"], "radiš": ["raditi"], "došli": ["doći"],
    "nema": ["nemati", "imati"], "laku": ["lak"], "čemu": ["što", "šta"], "ljudi": ["ljudi"],
}


def hjp(word):
    """Search Hrvatski jezični portal; return visible text around the first result."""
    try:
        data = urllib.parse.urlencode({"word": word, "search": "Pretraži"}).encode()
        req = urllib.request.Request("https://hjp.znanje.hr/index.php?show=search", data=data, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            page = r.read().decode("utf-8", "replace")
    except Exception as e:
        return {"error": str(e)}
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text)
    i = text.lower().find(word.lower())
    return {"snippet": text[max(0, i - 200): i + 1200] if i >= 0 else text[:1500]}


def main():
    out = {}
    for tok, alts in ALT.items():
        res = {"wiktionary": {}, "hjp": None}
        for a in alts:
            title, text = fetch(a)
            sec = sh_section(text) if text else None
            if sec:
                info = parse(sec)
                # keep accented inflection params (pr.va, vn, …) that verbs carry in sh-conj
                info["conj"] = re.findall(r"\|(pr\.va|p\.va|vn|pr\.1s|pr\.2s|pr\.3s|app\.[a-z]+)=([^|}]+)", sec)
                res["wiktionary"][a] = info
            time.sleep(0.3)
        res["hjp"] = hjp(alts[0] if tok not in ("idem", "radiš", "došli", "nema", "laku", "čemu", "spavam") else alts[0])
        time.sleep(0.5)
        out[tok] = res
    p = ROOT / "reports" / "dictionary_alt.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", p)


if __name__ == "__main__":
    main()
