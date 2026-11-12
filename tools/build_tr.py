#!/usr/bin/env python3
"""Build the Russian-letter reading (tr), part of speech and gender for words.json.

Stress comes from reports/dictionary.json (Wiktionary heads). Words the
dictionary doesn't have use STRESS_MANUAL and are flagged "stress_src": "manual".

Reading rules (agreed with Liza):
  e -> э (Serbian e is hard), except after lj/nj/j/ć/đ -> е
  č -> тш, ć -> ч, dž -> дж, đ -> дьж, h -> х
  lj/nj + vowel -> ля/ле/лю/ли (ня…), j + vowel -> я/е/ю/йо, j before consonant -> й
  every content word gets a stress mark; clitics (je, sam, si, li…) don't.
"""
import json, pathlib, re, sys, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
ACC = {"̀", "́", "̏", "̑"}
VOW = set("aeiou")
CLITICS = {"je", "sam", "si", "su", "smo", "ste", "li", "se", "me", "na", "u", "sa", "iz", "da"}
LEMMA = {"cipele": "cipela"}

# Stress confirmed by a second source (reports/dictionary_alt.json): Hrvatski jezični portal or the
# Wiktionary lemma page (present tense of verbs, Croatian -ist forms whose genitive equals the Serbian -ista).
STRESS_VERIFIED = {
    "čestitam": 1,   # HJP: prez. čèstītām
    "tobogan": 1,    # HJP: tȍbogān
    "udica": 1,      # HJP: ȕdica
    "programer": 2,  # HJP: progràmēr
    "optimista": 2,  # HJP: optìmist, G optìmista
    "pesimista": 2,  # HJP: pesìmist, G pesìmista
    "optimističan": 3,  # HJP: optimìstičan
    "raspoložen": 2,    # HJP: raspòložen
    "spavam": 1, "idem": 1, "radiš": 1, "došli": 1, "nema": 1, "laku": 1, "čemu": 1, "ljudi": 1,  # HJP/Wiktionary
    "laptop": 1, "kaktus": 1, "de": 1,  # two syllables: standard never stresses the last one
}
# Not confirmed by any dictionary we can reach: flagged on the card.
STRESS_MANUAL = {
    "nazdravlje": 2,     # zdrȃvlje; by the norm the accent may jump onto "na" (nȁ zdrāvlje)
    "sportista": 1,      # by analogy with spòrtāš
    "zainteresovan": 3,  # no entry; Croatian uses zainteresiran
    "džordž": 1,
}

# part of speech / gender: m f n pl for nouns; otherwise a pos label
G = {
 "l01-rec":"f","l01-jazavac":"m","l01-kornjaca":"f","l01-ljiljan":"m","l01-dzak":"m","l01-djak":"m","l01-ljubav":"f",
 "l01-sumnja":"f","l01-zelja":"f","l01-cadj":"f","l01-dzordz":"name","l01-vece":"n",
 "l01-majka":"f","l01-otac":"m","l01-sin":"m","l01-avion":"m","l01-grad":"m","l01-jagoda":"f","l01-zaba":"f",
 "l01-telefon":"m","l01-selo":"n","l01-laptop":"m","l01-caj":"m","l01-krava":"f","l01-svinja":"f","l01-ovca":"f",
 "az-buba":"f","az-voz":"m","az-gitara":"f","az-drvo":"n","az-ekser":"m","az-zmaj":"m","az-igla":"f","az-lubenica":"f",
 "az-mis":"m","az-naocare":"pl","az-njuska":"f","az-olovka":"f","az-paprika":"f","az-rak":"m","az-sat":"m",
 "az-tobogan":"m","az-curan":"m","az-udica":"f","az-foka":"f","az-hleb":"m","az-cipele":"pl","az-camac":"m","az-sesir":"m",
 "al-autobus":"m","al-bicikl":"m","al-cvet":"m","al-cizma":"f","al-dzep":"m","al-djevrek":"m","al-flauta":"f",
 "al-grozdje":"n","al-harmonika":"f","al-indijanac":"m","al-jez":"m","al-kaktus":"m","al-leptir":"m","al-ljuljaska":"f",
 "al-makaze":"pl","al-noz":"m","al-ogledalo":"n","al-puz":"m","al-uho":"n","al-viljuska":"f","al-zvezda":"f","al-zirafa":"f",
 "l02-dobrodosli":"phrase","l02-nazdravlje":"interj","l02-ziveli":"interj","l02-srecanrodjendan":"phrase",
 "l02-srecanput":"phrase","l02-lakunoc":"phrase","l02-cestitam":"verb","l02-prijatno":"interj","l02-dobardan":"phrase",
 "l02-nemanacemu":"phrase","l02-hvala":"interj","l02-idemdaspavam":"phrase",
 "l03-cao":"interj","l03-zdravo":"interj","l03-desi":"phrase","l03-kakosi":"phrase","l03-starradis":"phrase",
 "l03-jasam":"verb","l03-tisi":"verb","l03-onje":"verb","l03-mismo":"verb","l03-viste":"verb","l03-onisu":"verb",
 "l03-dali":"particle","l03-covek":"m","l03-zena":"f","l03-muz":"m","l03-brat":"m","l03-drug":"m","l03-ljudi":"pl",
 "l03-ucitelj":"m","l03-programer":"m","l03-italijan":"m","l03-sportista":"m","l03-pomocnik":"m","l03-naucnik":"m",
 "l03-novinar":"m","l03-optimista":"m","l03-pesimista":"m","l03-tu":"adv","l03-ovde":"adv","l03-tamo":"adv",
 "l03-uvek":"adv","l03-mnogo":"adv","l03-samo":"particle","l03-sanama":"phrase","l03-iz":"prep","l03-moj":"pron",
 "l03-tvoj":"pron","l03-njen":"pron","l03-ulica":"f","l03-usluga":"f","l03-dobar":"adj","l03-nov":"adj",
 "l03-veseo":"adj","l03-odgovoran":"adj","l03-odlican":"adj","l03-optimistican":"adj","l03-zadovoljan":"adj",
 "l03-spreman":"adj","l03-zainteresovan":"adj","l03-siguran":"adj","l03-raspolozen":"adj","l03-dostupan":"adj",
 "l03-vredan":"adj","l03-iskusan":"adj","l03-efikasan":"adj","l03-popularan":"adj","l03-pozitivan":"adj",
 "l03-kvalitetan":"adj",
}


def letters(word):
    return re.findall(r"lj|nj|dž|.", word.lower())


def nuclei(ls):
    """indexes of letters that are syllable nuclei (vowels + syllabic r)."""
    out = []
    for i, c in enumerate(ls):
        if c in VOW:
            out.append(i)
        elif c == "r":
            prev = ls[i - 1] if i else None
            nxt = ls[i + 1] if i + 1 < len(ls) else None
            if (prev is None or prev not in VOW) and (nxt is None or nxt not in VOW) and (prev or nxt):
                out.append(i)
    return out


def split_marks(s):
    """[(char, has_stress)] where accent marks count only on vowels and r (so ć keeps its acute)."""
    out = []
    for ch in unicodedata.normalize("NFD", s.lower()):
        if unicodedata.combining(ch) and out:
            base, keep, stressed = out[-1]
            if base in "aeiour" and ch in ACC:
                out[-1] = (base, keep, True)
            elif ch != "\u0304":
                out[-1] = (base, keep + ch, stressed)
        else:
            out.append((ch, "", False))
    return [(unicodedata.normalize("NFC", b + k), st) for b, k, st in out]


def strip_acc(s):
    return "".join(c for c, _ in split_marks(s))


def stressed_syllable(head):
    """1-based syllable carrying the accent in a Wiktionary head like 'telèfōn'."""
    chars = split_marks(head)
    word = "".join(c for c, _ in chars)
    ls = letters(word)
    pos, p = [], 0
    for l in ls:
        pos.append(p); p += len(l)
    for n, li in enumerate(nuclei(ls), 1):
        if chars[pos[li]][1]:
            return n
    return None


CONS = {"b":"б","c":"ц","č":"тш","ć":"ч","d":"д","dž":"дж","đ":"дьж","f":"ф","g":"г","h":"х","k":"к","l":"л",
        "m":"м","n":"н","p":"п","r":"р","s":"с","š":"ш","t":"т","v":"в","z":"з","ž":"ж"}
SOFT_V = {"a":"я","e":"е","u":"ю","i":"и","o":"ьо"}
PLAIN_V = {"a":"а","e":"э","i":"и","o":"о","u":"у"}


def transcribe(word, stress):
    """word: Serbian Latin; stress: 1-based syllable or None."""
    ls = letters(word)
    nuc = nuclei(ls)
    target = nuc[stress - 1] if stress and stress <= len(nuc) else None
    out, i = [], 0
    while i < len(ls):
        c = ls[i]
        nxt = ls[i + 1] if i + 1 < len(ls) else None
        prev = ls[i - 1] if i else None
        piece = ""
        if c in ("lj", "nj"):
            base = "л" if c == "lj" else "н"
            if nxt in VOW:
                piece = base + SOFT_V[nxt]; i += 1
            else:
                piece = base + "ь"
        elif c == "j":
            if nxt in VOW:
                iot = {"a":"я","e":"е","u":"ю","i":"йи","o":"йо"}[nxt]
                piece = ("ь" if prev and prev not in VOW else "") + iot; i += 1
            else:
                piece = "й"
        elif c in VOW:
            piece = "е" if (c == "e" and prev in ("ć", "đ")) else PLAIN_V[c]
        else:
            piece = CONS.get(c, c)
        # stress: the vowel produced at the target nucleus (may be the vowel we just consumed)
        consumed = i  # index of last letter this piece covers
        if target is not None and target in (consumed, consumed - 0) and (ls[target] in VOW or ls[target] == "r"):
            piece = piece + "́"
        out.append(piece)
        i += 1
    return "".join(out)


def main():
    words = json.loads((ROOT / "words.json").read_text(encoding="utf-8"))
    d = json.loads((ROOT / "reports" / "dictionary.json").read_text(encoding="utf-8"))
    issues = []
    for w in words:
        toks = re.findall(r"[^\s.,!?—–\-]+", w["sr"])
        parts, srcs = [], []
        content = [t for t in toks if t.lower() not in CLITICS] or toks[:1]
        for t in toks:
            if t not in content:
                parts.append(transcribe(t, None)); continue
            key = LEMMA.get(t.lower(), t)
            entry = d.get(key) or d.get(key.lower()) or {}
            stress, src = None, "dict"
            same = [h for hh in entry.get("heads", []) for h in hh.split(",") if strip_acc(h.strip()) == key.lower()]
            if same:
                ss = {stressed_syllable(h) for h in same} - {None}
                if len(ss) > 1:
                    issues.append(f"{w['id']}: несколько ударений в словаре {same}")
                stress = min(ss) if ss else None
            if stress is None:
                n = len(nuclei(letters(t)))
                if n == 1:
                    stress, src = 1, "dict"
                elif t.lower() in STRESS_VERIFIED:
                    stress, src = STRESS_VERIFIED[t.lower()], "dict"
                else:
                    stress, src = STRESS_MANUAL.get(t.lower()), "manual"
                if n > 1 and stress is None:
                    issues.append(f"{w['id']}: нет ударения для {t}")
            parts.append(transcribe(t, stress)); srcs.append(src)
            g_dict = [g for g in entry.get("genders", []) if re.fullmatch(r"[mfn](-[a-z]+)?", g)]
            if g_dict and G.get(w["id"]) in ("m", "f", "n", "pl") and len(toks) == 1:
                gd = g_dict[0]
                mine = G[w["id"]]
                dg = "pl" if gd.endswith("-p") else gd[0]
                if mine != dg and not (mine == "pl" and t.lower() in LEMMA):
                    issues.append(f"{w['id']}: род у меня {mine}, в словаре {gd}")
        w["tr"] = " ".join(parts)
        w["g"] = G[w["id"]]
        w["stress_src"] = "manual" if "manual" in srcs else "dict"
    (ROOT / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("\n".join(issues) or "no issues")
    print("manual stress:", [w["sr"] for w in words if w["stress_src"] == "manual"])


if __name__ == "__main__":
    main()
