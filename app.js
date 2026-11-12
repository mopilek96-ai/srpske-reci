(function(){
"use strict";
// ---------- helpers ----------
const $ = id => document.getElementById(id);
const DAY = 86400000;
const NEW_PER_DAY = 15;
const CFG = window.SRPSKE_CONFIG || {};
const todayKey = (t=Date.now()) => { const d=new Date(t); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

// Serbian Latin -> Cyrillic (digraphs lj, nj, dž first)
const L2C = {a:"а",b:"б",c:"ц","č":"ч","ć":"ћ",d:"д","đ":"ђ",e:"е",f:"ф",g:"г",h:"х",i:"и",j:"ј",k:"к",l:"л",m:"м",n:"н",o:"о",p:"п",r:"р",s:"с","š":"ш",t:"т",u:"у",v:"в",z:"з","ž":"ж"};
const DI = {"lj":"љ","nj":"њ","dž":"џ"};
function toCyr(str){
  let out="", s=String(str||"");
  for(let i=0;i<s.length;i++){
    const two=s.slice(i,i+2), lt=two.toLowerCase();
    if(DI[lt]){ const c=DI[lt]; out += (two[0]!==two[0].toLowerCase()) ? c.toUpperCase() : c; i++; continue; }
    const ch=s[i], lc=ch.toLowerCase();
    if(L2C[lc]){ out += ch!==lc ? L2C[lc].toUpperCase() : L2C[lc]; } else out+=ch;
  }
  return out;
}

// ---------- spaced repetition (SM-2 style) ----------
function schedule(st, g, now){
  st = st ? {...st} : {i:0,e:2.5,r:0,l:0,d:0};
  if(g===0){ st.r=0; st.l=(st.l||0)+1; st.e=Math.max(1.3,st.e-0.2); st.i=0; st.d=now+10*60000; }
  else{
    if(g===1){ st.i = st.r===0 ? 1 : Math.max(1, st.i*1.2); st.e=Math.max(1.3,st.e-0.15); }
    if(g===2){ st.i = st.r===0 ? 1 : st.r===1 ? 3 : st.i*st.e; }
    if(g===3){ st.i = st.r===0 ? 3 : st.i*st.e*1.3; st.e=st.e+0.15; }
    st.i=Math.round(st.i*10)/10; st.r+=1; st.d=now+st.i*DAY;
  }
  st.t=now; return st;
}
const fmtInterval = d => d<1/24 ? "10 мин" : d<1 ? "сегодня" : d<1.5 ? "1 дн" : Math.round(d)+" дн";
function statusOf(st, now){
  if(!st) return "new";
  if(st.d<=now) return "due";
  return st.i>=21 ? "known" : "learn";
}

// ---------- shared progress (Supabase REST) ----------
const SB = CFG.supabaseUrl && CFG.supabaseKey ? {
  url: CFG.supabaseUrl.replace(/\/$/,"") + "/rest/v1/progress",
  headers(extra){
    const h={"apikey":CFG.supabaseKey,"Content-Type":"application/json",...(extra||{})};
    if(!/^sb_/.test(CFG.supabaseKey)) h.Authorization="Bearer "+CFG.supabaseKey;
    return h;
  }
} : null;
async function sbAll(){
  if(!SB) return [];
  const r=await fetch(SB.url+"?select=name,cards,days,updated",{headers:SB.headers()});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return r.json();
}
async function sbSave(row){
  if(!SB) return;
  const r=await fetch(SB.url+"?on_conflict=name",{method:"POST",headers:SB.headers({"Prefer":"resolution=merge-duplicates,return=minimal"}),body:JSON.stringify(row)});
  if(!r.ok) throw new Error("HTTP "+r.status);
}

// ---------- state ----------
let me = store.get("srpske.me");
let words=[], audioMap={};
let allProgress={};     // name -> row
let mine={cards:{},days:{},updated:0};
let view="learn";
let queue=[], current=null, flipped=false, curDir="sr";
let loaded=false, cram=false;
let build=null;

// ---------- who am I ----------
function showWho(){
  $("who").hidden=false; $("app").hidden=true;
  const names = CFG.people || ["Лиза","Олег"];
  $("who-list").innerHTML = names.map(n=>`<button class="btn" type="button" data-name="${esc(n)}">${esc(n)}</button>`).join("");
  $("who-list").querySelectorAll("button").forEach(b=>b.onclick=()=>pickMe(b.dataset.name));
}
function pickMe(n){
  me=n; store.set("srpske.me", n);
  $("who").hidden=true; $("app").hidden=false;
  $("me-name").textContent=n;
  loadMine(); if(loaded){ buildQueue(); render(); }
}
$("switch-me").onclick=()=>showWho();
function loadMine(){
  const local = store.get("srpske.progress."+me);
  const remote = allProgress[me];
  const lt = local&&local.updated||0, rt = remote ? Date.parse(remote.updated)||0 : 0;
  const src = rt>lt ? remote : local;
  mine = {cards: {...(src&&src.cards||{})}, days: {...(src&&src.days||{})}, updated: Math.max(lt,rt)};
}

// ---------- tabs & filters ----------
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{
  view=b.dataset.view;
  document.querySelectorAll("nav button").forEach(x=>x.setAttribute("aria-selected", x===b?"true":"false"));
  ["learn","words","progress"].forEach(v=>$("view-"+v).hidden = v!==view);
  if(view==="progress") refreshOthers();
  render();
}));
$("f-lesson").addEventListener("change", ()=>{ buildQueue(); renderLearn(); });
$("f-dir").addEventListener("change", ()=>{ buildQueue(); renderLearn(); });
$("f-mode").addEventListener("change", ()=>{ $("f-script").hidden = $("f-mode").value!=="build"; $("f-dir").hidden = $("f-mode").value==="build"; nextCard(); renderLearn(); });
$("f-script").addEventListener("change", ()=>{ nextCard(); renderLearn(); });
$("search").addEventListener("input", renderWords);

function lessons(){
  const m=new Map();
  for(const w of words){ const k=w.lesson||"Без урока"; const a=w.added||0; if(!m.has(k)||m.get(k)>a) m.set(k,a); }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
}
function fillLessonSelect(){
  const sel=$("f-lesson"), prev=sel.value;
  const ls=lessons();
  sel.innerHTML='<option value="">Все уроки</option>'+ls.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("");
  if(ls.includes(prev)) sel.value=prev;
}

// ---------- queue ----------
function newIntroducedToday(){ return (mine.days[todayKey()]||{}).n || 0; }
function buildQueue(){
  const now=Date.now(), lf=$("f-lesson").value;
  const pool=words.filter(w=>!lf || (w.lesson||"Без урока")===lf);
  const due=pool.filter(w=>mine.cards[w.id] && mine.cards[w.id].d<=now).sort((a,b)=>mine.cards[a.id].d-mine.cards[b.id].d);
  const left=Math.max(0, NEW_PER_DAY-newIntroducedToday());
  const fresh=pool.filter(w=>!mine.cards[w.id]).sort((a,b)=>(a.added||0)-(b.added||0)).slice(0,left);
  queue=[...due,...fresh].map(w=>w.id);
  for(let i=queue.length-1;i>0;i--){ if(Math.random()<.5){ const j=Math.floor(Math.random()*(i+1)); [queue[i],queue[j]]=[queue[j],queue[i]]; } }
  cram=false; nextCard();
}
function nextCard(){
  flipped=false;
  current = queue.length ? words.find(w=>w.id===queue[0]) || null : null;
  const d=$("f-dir").value;
  curDir = d==="mix" ? (Math.random()<.5?"sr":"ru") : d;
  build = current ? newBuild(current) : null;
}

// ---------- audio ----------
const player = new Audio();
let playingBtn=null;
player.addEventListener("ended", ()=>{ if(playingBtn) playingBtn.dataset.on="0"; });
player.addEventListener("pause", ()=>{ if(playingBtn) playingBtn.dataset.on="0"; });
function synthVoice(){
  try{ const vs=speechSynthesis.getVoices(); return vs.find(v=>/^sr/i.test(v.lang)) || vs.find(v=>/^(hr|bs)/i.test(v.lang)) || null; }catch(e){ return null; }
}
const hasAudio = t => !!audioMap[t];
const canSpeak = t => hasAudio(t) || ("speechSynthesis" in window);
function speak(text, btn){
  if(playingBtn) playingBtn.dataset.on="0";
  playingBtn=btn||null; if(btn) btn.dataset.on="1";
  const file = audioMap[text];
  if(file){
    player.src = "audio/"+file; player.currentTime=0;
    player.play().catch(()=>{ if(btn) btn.dataset.on="0"; });
    return;
  }
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text); u.lang="sr-RS"; u.rate=0.85;
    const v=synthVoice(); if(v){ u.voice=v; u.lang=v.lang; }
    u.onend=u.onerror=()=>{ if(btn) btn.dataset.on="0"; };
    speechSynthesis.speak(u);
  }catch(e){ if(btn) btn.dataset.on="0"; }
}
function speakButtons(w, withEx){
  const a = canSpeak(w.sr) ? '<button class="speak" id="say" type="button">▶ Слово</button>' : "";
  const b = withEx && w.ex_sr && canSpeak(w.ex_sr) ? '<button class="speak" id="say-ex" type="button">▶ Пример</button>' : "";
  return a||b ? `<div class="row" style="justify-content:center;margin-top:6px">${a}${b}</div>` : "";
}
function wireSpeak(w){
  const s=$("say"); if(s) s.onclick=e=>{ e.stopPropagation(); speak(w.sr, s); };
  const se=$("say-ex"); if(se) se.onclick=e=>{ e.stopPropagation(); speak(w.ex_sr, se); };
}
const trLine = w => w.tr ? `<div class="tr" title="Как читать">[${esc(w.tr)}]</div>` : "";
const exampleBlock = w => w.ex_sr ? `<div class="ex"><span class="ex-sr" lang="sr-Latn">${esc(w.ex_sr)}</span><span class="ex-cyr" lang="sr-Cyrl">${esc(toCyr(w.ex_sr))}</span>${w.ex_ru?`<span class="ex-ru">${esc(w.ex_ru)}</span>`:""}</div>` : "";

// ---------- render: learn ----------
function renderMeter(){
  const now=Date.now();
  const known=words.filter(w=>statusOf(mine.cards[w.id],now)==="known").length;
  const today=(mine.days[todayKey()]||{}).c||0;
  $("meter").innerHTML = `<span>В очереди <b>${queue.length}</b></span><span>Сегодня повторено <b>${today}</b></span><span>Выучено <b>${known}</b> из ${words.length}</span>`;
}
function renderLearn(){
  renderMeter();
  const area=$("learn-area");
  if(!loaded){ area.innerHTML='<div class="empty"><span class="hint">Загружаю слова…</span></div>'; return; }
  if(!words.length){ area.innerHTML='<div class="empty"><h2>Слов пока нет</h2></div>'; return; }
  if(!current){
    const now=Date.now();
    const nextDue=words.map(w=>mine.cards[w.id]).filter(Boolean).map(s=>s.d).filter(d=>d>now).sort((a,b)=>a-b)[0];
    const lf=$("f-lesson").value;
    const newsLeft=words.filter(w=>!mine.cards[w.id] && (!lf||(w.lesson||"Без урока")===lf)).length;
    area.innerHTML=`<div class="empty"><h2>Bravo! На сейчас всё</h2>
      <span class="hint">${nextDue?"Следующее повторение: "+new Date(nextDue).toLocaleString("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})+".":""}
      ${newsLeft?" Ещё "+newsLeft+" новых слов ждут, на день лимит "+NEW_PER_DAY+" новых.":""}</span>
      <div class="row" style="justify-content:center">
        ${newsLeft?'<button class="btn" id="more-new" type="button">Взять ещё 10 новых</button>':''}
        <button class="btn ghost" id="cram" type="button">Прогнать всё ещё раз</button>
      </div></div>`;
    const mn=$("more-new"); if(mn) mn.onclick=()=>{
      queue=words.filter(w=>!mine.cards[w.id] && (!lf||(w.lesson||"Без урока")===lf)).sort((a,b)=>(a.added||0)-(b.added||0)).slice(0,10).map(w=>w.id);
      nextCard(); renderLearn();
    };
    $("cram").onclick=()=>{
      queue=words.filter(w=>mine.cards[w.id] && (!lf||(w.lesson||"Без урока")===lf)).map(w=>w.id).sort(()=>Math.random()-.5);
      nextCard(); cram=true; renderLearn();
    };
    return;
  }
  if($("f-mode").value==="build"){ if(!build||build.script!==$("f-script").value) build=newBuild(current); renderBuild(area); return; }
  const w=current, st=mine.cards[w.id];
  const srFront = curDir==="sr";
  const srBlock = `<div class="word" lang="sr-Latn">${esc(w.sr)}</div><div class="cyr" lang="sr-Cyrl">${esc(toCyr(w.sr))}</div>${trLine(w)}`;
  const front = srFront ? srBlock : `<div class="trans">${esc(w.ru)}</div>`;
  const back = `${srFront ? `<div class="trans">${esc(w.ru)}</div>` : srBlock}
    ${w.note?`<div class="note">${esc(w.note)}</div>`:""}${exampleBlock(w)}`;
  area.innerHTML = `
    <div class="card" id="card" tabindex="0" role="button" aria-label="${flipped?"Карточка":"Показать ответ"}">
      <span class="lesson">${esc(w.lesson||"")}</span>
      <span class="dirtag">${!st?"новое":st.l?"было трудно":""}</span>
      ${front}
      ${flipped?back:'<div class="hint" style="margin-top:14px">Нажми, чтобы увидеть ответ</div>'}
      ${(srFront||flipped)?speakButtons(w, flipped):""}
    </div>
    <div class="grades" style="margin-top:12px">
      ${["Не помню","Трудно","Помню","Легко"].map((t,g)=>`<button class="g${g}" data-g="${g}" type="button" ${flipped?"":"disabled"}>${t}<span>${flipped?fmtInterval(previewDays(st,g)):(g+1)}</span></button>`).join("")}
    </div>`;
  $("card").onclick=e=>{ if(e.target.closest(".speak")) return; if(!flipped){ flipped=true; renderLearn(); } };
  wireSpeak(w);
  area.querySelectorAll(".grades button").forEach(b=>b.onclick=()=>grade(+b.dataset.g));
}
function previewDays(st,g){ const n=Date.now(); return (schedule(st,g,n).d-n)/DAY; }

// ---------- build-the-word mode ----------
function letters(word, script){
  const s=String(word||"").toLowerCase().replace(/[^\p{L}]/gu,"");
  if(script==="cyr") return [...toCyr(s)];
  return s.match(/lj|nj|dž|./g) || [];
}
function newBuild(w){
  const script=$("f-script").value;
  const ans=letters(w.sr, script);
  let order=ans.map((_,i)=>i);
  for(let k=0;k<6;k++){
    for(let i=order.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [order[i],order[j]]=[order[j],order[i]]; }
    if(ans.length<2 || order.map(i=>ans[i]).join("")!==ans.join("")) break;
  }
  return {script, ans, pool:order.map(i=>({t:ans[i],used:false})), placed:[], errors:0, done:false, grade:null, wrong:[]};
}
function renderBuild(area){
  const w=current, b=build, st=mine.cards[w.id];
  const slots=b.ans.map((_,i)=>{
    const pi=b.placed[i];
    if(pi===undefined) return '<span class="slot"></span>';
    const cls = b.done ? "ok" : (b.wrong.includes(i) ? "bad" : "");
    return `<button class="tile ${cls}" data-slot="${i}" type="button" ${b.done?"disabled":""}>${esc(b.pool[pi].t)}</button>`;
  }).join("");
  const pool=b.pool.map((p,i)=>p.used?"":`<button class="tile" data-pool="${i}" type="button">${esc(p.t)}</button>`).join("");
  const full=b.placed.filter(x=>x!==undefined).length===b.ans.length;
  const other = b.script==="cyr" ? `<div class="cyr" lang="sr-Latn">${esc(w.sr)}</div>` : `<div class="cyr" lang="sr-Cyrl">${esc(toCyr(w.sr))}</div>`;
  const msg = b.done ? (b.grade===2?"Верно с первого раза!":b.grade===1?"Верно, но с ошибками. Слово вернётся пораньше.":"Ничего, это слово скоро повторим.")
    : b.wrong.length ? "Почти! Красные буквы стоят не на своём месте. Нажми на них, чтобы вернуть." : "";
  area.innerHTML = `
    <div class="card" style="cursor:default">
      <span class="lesson">${esc(w.lesson||"")}</span>
      <span class="dirtag">${!st?"новое":""}</span>
      <div class="trans">${esc(w.ru)}</div>
      <div class="slots" aria-label="Твой ответ">${slots}</div>
      ${b.done ? other + trLine(w) + (w.note?`<div class="note">${esc(w.note)}</div>`:"") + exampleBlock(w) : `<div class="pool" aria-label="Буквы">${pool}</div>`}
      <div class="buildmsg ${b.done&&b.grade===2?"ok":b.wrong.length||(b.done&&b.grade===0)?"bad":""}">${msg}</div>
      ${b.done?speakButtons(w,true):""}
    </div>
    <div class="row" style="justify-content:center;margin-top:12px">
      ${b.done ? '<button class="btn" id="b-next" type="button">Дальше →</button>'
        : `<button class="btn ghost" id="b-reveal" type="button">Показать ответ</button><button class="btn" id="b-check" type="button" ${full?"":"disabled"}>Проверить</button>`}
    </div>`;
  area.querySelectorAll("[data-pool]").forEach(el=>el.onclick=()=>placeTile(+el.dataset.pool));
  area.querySelectorAll("[data-slot]").forEach(el=>el.onclick=()=>unplace(+el.dataset.slot));
  const c=$("b-check"); if(c) c.onclick=checkBuild;
  const r=$("b-reveal"); if(r) r.onclick=revealBuild;
  const n=$("b-next"); if(n){ n.onclick=()=>advance(w,b.grade); n.focus(); }
  wireSpeak(w);
}
function placeTile(pi){
  const b=build; if(b.done||b.pool[pi].used) return;
  const slot=b.ans.findIndex((_,i)=>b.placed[i]===undefined); if(slot<0) return;
  b.placed[slot]=pi; b.pool[pi].used=true; renderLearn();
}
function unplace(i){
  const b=build; if(b.done) return;
  const pi=b.placed[i]; if(pi===undefined) return;
  b.pool[pi].used=false; b.placed[i]=undefined; b.wrong=b.wrong.filter(x=>x!==i); renderLearn();
}
function checkBuild(){
  const b=build;
  b.wrong=b.ans.map((t,i)=>b.pool[b.placed[i]].t===t?-1:i).filter(i=>i>=0);
  if(!b.wrong.length){ b.done=true; b.grade = b.errors? 1 : 2; record(current,b.grade); speak(current.sr,null); }
  else b.errors++;
  renderLearn();
}
function revealBuild(){
  const b=build;
  b.pool.forEach(p=>p.used=false);
  b.placed=b.ans.map(t=>{ const i=b.pool.findIndex(p=>!p.used&&p.t===t); b.pool[i].used=true; return i; });
  b.wrong=[]; b.done=true; b.grade=0; record(current,0); renderLearn();
}

document.addEventListener("keydown", e=>{
  if(view!=="learn" || !current || $("app").hidden) return;
  if(e.target.matches("input,textarea,select")) return;
  if($("f-mode").value==="build"){
    if(!build) return;
    if(e.key==="Backspace"){ const last=build.placed.map((x,i)=>x!==undefined?i:-1).filter(i=>i>=0).pop(); if(last!==undefined){ e.preventDefault(); unplace(last); } return; }
    if(e.key==="Enter" && !build.done && build.placed.filter(x=>x!==undefined).length===build.ans.length){ e.preventDefault(); checkBuild(); return; }
    if(e.key.length<=2 && !build.done){
      const k=e.key.toLowerCase(); const pi=build.pool.findIndex(p=>!p.used && (p.t===k || (build.script==="cyr" && p.t===toCyr(k))));
      if(pi>=0){ e.preventDefault(); placeTile(pi); }
    }
    return;
  }
  if(e.code==="Space"||e.key==="Enter"){ if(!flipped){ e.preventDefault(); flipped=true; renderLearn(); } }
  else if(flipped && ["1","2","3","4"].includes(e.key)){ grade(+e.key-1); }
});

function grade(g){ if(!current||!flipped) return; const w=current; record(w,g); advance(w,g); }
function advance(w,g){
  queue.shift();
  if(g===0){ queue.splice(Math.min(3,queue.length),0,w.id); }
  if(!queue.length) cram=false;
  nextCard(); renderLearn();
}
function record(w,g){
  if(cram && g!==0) return;
  const now=Date.now(), was=mine.cards[w.id];
  mine.cards[w.id]=schedule(was,g,now);
  const dk=todayKey(now);
  const day={...(mine.days[dk]||{c:0,n:0})}; day.c+=1; if(!was) day.n+=1;
  mine.days[dk]=day;
  mine.updated=now;
  store.set("srpske.progress."+me, mine);
  scheduleSave();
}

// ---------- saving ----------
let saveTimer=null, saving=false, dirty=false;
function scheduleSave(){ dirty=true; clearTimeout(saveTimer); saveTimer=setTimeout(flush, 1500); }
async function flush(){
  if(!SB || saving || !dirty || !me) return;
  saving=true; dirty=false;
  try{
    await sbSave({name:me, cards:mine.cards, days:mine.days, updated:new Date(mine.updated||Date.now()).toISOString()});
    setSync("ok");
  }catch(e){ dirty=true; setSync("err"); setTimeout(flush, 15000); }
  finally{ saving=false; if(dirty) scheduleSave(); }
}
window.addEventListener("pagehide", ()=>{ if(dirty) flush(); });
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden" && dirty) flush(); });
function setSync(s){
  const el=$("sync");
  if(!SB){ el.textContent="Прогресс только на этом устройстве"; return; }
  el.textContent = s==="ok" ? "Прогресс сохранён" : s==="err" ? "Нет связи, сохраню позже" : "";
}

// ---------- render: words ----------
function renderWords(){
  const area=$("words-area");
  if(!loaded){ area.innerHTML='<p class="hint">Загружаю…</p>'; return; }
  const q=$("search").value.trim().toLowerCase(), now=Date.now();
  const chipTxt={new:"новое",learn:"учу",known:"выучено",due:"повторить"};
  const blocks=lessons().map(l=>{
    const ws=words.filter(w=>(w.lesson||"Без урока")===l && (!q || (w.sr+" "+toCyr(w.sr)+" "+w.ru).toLowerCase().includes(q))).sort((a,b)=>(a.added||0)-(b.added||0));
    if(!ws.length) return "";
    return `<div class="lessonblock"><div class="lessonhead"><b>${esc(l)}</b><span class="hint">${ws.length} сл.</span></div>
      ${ws.map(w=>{ const s=statusOf(mine.cards[w.id],now); return `<div class="wordrow"><div class="sr" lang="sr-Latn">${esc(w.sr)}<small lang="sr-Cyrl">${esc(toCyr(w.sr))}${w.tr?` · [${esc(w.tr)}]`:""}</small></div><div class="ru">${esc(w.ru)}</div><span class="chip ${s}">${chipTxt[s]}</span></div>`; }).join("")}</div>`;
  }).join("");
  area.innerHTML = blocks || '<div class="empty"><span class="hint">Ничего не нашлось.</span></div>';
}

// ---------- render: progress ----------
async function refreshOthers(){
  if(!SB) return;
  try{ const rows=await sbAll(); allProgress={}; rows.forEach(r=>allProgress[r.name]=r); if(view==="progress") renderProgress(); }
  catch(e){ $("progress-note").textContent="Не удалось загрузить прогресс остальных. Проверь интернет."; }
}
function renderProgress(){
  const area=$("progress-area");
  const names=[...new Set([me, ...Object.keys(allProgress)].filter(Boolean))];
  const now=Date.now(), total=words.length||1;
  const last14=[...Array(14)].map((_,i)=>todayKey(now-(13-i)*DAY));
  area.innerHTML = names.map(n=>{
    const p = n===me ? mine : (allProgress[n]||{cards:{},days:{}});
    const cards=p.cards||{}, days=p.days||{};
    let known=0, learn=0, due=0;
    for(const w of words){ const s=statusOf(cards[w.id],now); if(s==="known")known++; else if(s==="learn")learn++; else if(s==="due")due++; }
    const fresh=words.length-known-learn-due;
    let streak=0; for(let i=0;i<400;i++){ const k=todayKey(now-i*DAY); if(days[k]&&days[k].c) streak++; else if(i===0) continue; else break; }
    const word = streak%10===1&&streak%100!==11 ? "день" : (streak%10>=2&&streak%10<=4&&(streak%100<10||streak%100>=20)) ? "дня" : "дней";
    const pct=v=>(v/total*100).toFixed(1)+"%";
    return `<div class="person">
      <div class="top"><span class="name">${esc(n)}${n===me?" · это ты":""}</span><span class="hint">Серия: ${streak} ${word} подряд</span></div>
      <div class="bar" role="img" aria-label="Выучено ${known}, учу ${learn}, повторить ${due}, новых ${fresh}">
        <i style="width:${pct(known)};background:var(--good)"></i><i style="width:${pct(learn)};background:var(--warn)"></i><i style="width:${pct(due)};background:var(--bad)"></i>
      </div>
      <div class="legend"><span style="--c:var(--good)">Выучено ${known}</span><span style="--c:var(--warn)">Учу ${learn}</span><span style="--c:var(--bad)">Повторить ${due}</span><span style="--c:var(--line)">Новых ${fresh}</span></div>
      <div><div class="hint" style="margin-bottom:4px">Последние 2 недели</div><div class="days">${last14.map(k=>{ const c=(days[k]||{}).c||0; return `<i class="${c>=10?"on":c>0?"some":""}" title="${k}: ${c}"></i>`; }).join("")}</div></div>
    </div>`;
  }).join("");
}

function render(){
  if(view==="learn") renderLearn();
  else if(view==="words") renderWords();
  else renderProgress();
}

// ---------- boot ----------
(async function boot(){
  if(!me) showWho(); else { $("me-name").textContent=me; }
  render();
  try{
    const [wr, ar] = await Promise.all([
      fetch("words.json?v="+Date.now()).then(r=>{ if(!r.ok) throw 0; return r.json(); }),
      fetch("audio/index.json?v="+Date.now()).then(r=>r.ok?r.json():{}).catch(()=>({}))
    ]);
    words = wr.filter(w=>w.sr&&w.ru); audioMap = ar||{};
  }catch(e){ $("status").textContent="Не удалось загрузить слова. Обнови страницу."; return; }
  try{ const rows=await sbAll(); rows.forEach(r=>allProgress[r.name]=r); }catch(e){ setSync("err"); }
  if(me) loadMine();
  loaded=true;
  $("status").textContent = words.length+" слов";
  setSync(SB?"":"");
  fillLessonSelect(); buildQueue(); render();
})();
})();
