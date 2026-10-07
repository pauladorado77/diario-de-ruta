(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CFG=window.DIARIO_CONFIG;
const sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey);
const BUCKET="fotos";
const TRIP_START="2026-10-10";

/* ---------- itinerary (the plan) ---------- */
const P={
 cor:["A Coruña",43.362,-8.411],mpl:["Montpellier",43.611,3.877],mon:["Mónaco",43.738,7.424],tur:["Turín",45.07,7.687],
 tav:["Tavullia",43.902,12.751],gra:["Gradara",43.94,12.77],smr:["San Marino",43.936,12.447],flo:["Florencia",43.77,11.256],
 car:["Carcasona",43.213,2.351],bur:["Burdeos",44.838,-0.579]};
const ROUTE=["cor","mpl","mon","tur","tav","gra","smr","tav","flo","car","bur","cor"];
const DAYS=[
 [1,"2026-10-10",["A Coruña","Montpellier"],"11 h 40 al volante"],
 [2,"2026-10-11",["Montpellier","Mónaco","Turín"],"6 h 35 al volante"],
 [3,"2026-10-12",["Turín","Tavullia"],"4 h 25 al volante"],
 [4,"2026-10-13",["Tavullia, día Valentino Rossi"],"sin coche"],
 [5,"2026-10-14",["Gradara","San Marino"],"2 h al volante"],
 [6,"2026-10-15",["Tavullia","Florencia"],"2 h 40 al volante"],
 [7,"2026-10-16",["Florencia"],"sin coche"],
 [8,"2026-10-17",["Florencia","Carcasona","Burdeos"],"12 h al volante"],
 [9,"2026-10-18",["Burdeos","A Coruña"],"8 h 30 al volante"]];

/* ---------- state ---------- */
const S={stops:[],photos:[],comments:[],editor:false,session:null,loaded:false,lb:null,sheet:null,picking:false,form:null,busy:false};

/* ---------- helpers ---------- */
const parseD=d=>{if(!d)return null;const[y,m,dd]=d.split("-").map(Number);return new Date(y,m-1,dd)};
const fmtDay=new Intl.DateTimeFormat("es-ES",{weekday:"short",day:"numeric",month:"short"});
const fmtLong=new Intl.DateTimeFormat("es-ES",{weekday:"long",day:"numeric",month:"short"});
function todayStr(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function nowTime(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}
function dayN(date){if(!date)return null;return Math.round((parseD(date)-parseD(TRIP_START))/864e5)+1}
function dayLabel(s){const n=dayN(s.fecha);const parts=[];if(n>=1&&n<=9)parts.push("Día "+n);if(s.fecha)parts.push(fmtDay.format(parseD(s.fecha)));if(s.hora)parts.push(s.hora.slice(0,5));return parts.join(" · ")}
function ago(iso){if(!iso)return"";const m=Math.round((Date.now()-new Date(iso))/6e4);if(m<1)return"ahora mismo";if(m<60)return"hace "+m+" min";const h=Math.round(m/60);if(h<24)return"hace "+h+" h";const d=Math.round(h/24);return d===1?"ayer":"hace "+d+" días"}
const pubUrl=ruta=>sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
const thumbUrl=ruta=>pubUrl(ruta.replace(/\.jpg$/,"_t.jpg"));
const sortKey=s=>(s.fecha||"9999")+" "+(s.hora||"99:99")+" "+s.creado;
function photosOf(id){return S.photos.filter(p=>p.parada_id===id).sort((a,b)=>a.creado.localeCompare(b.creado))}
function commentsOf(id){return S.comments.filter(c=>c.foto_id===id).sort((a,b)=>a.creado.localeCompare(b.creado))}
function commentsOfStop(id){const ids=new Set(photosOf(id).map(p=>p.id));return S.comments.filter(c=>ids.has(c.foto_id))}
let toastT;function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,3800)}
function lsGet(k){try{return localStorage.getItem(k)||""}catch(e){return""}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function errText(e,base){const m=(e&&(e.message||e.error_description))||"";
  if(/row-level security|permission|not authorized|Unauthorized/i.test(m))return base+": tu cuenta no tiene permiso.";
  if(/Invalid login/i.test(m))return"Email o contraseña incorrectos.";
  if(/Failed to fetch|NetworkError|network/i.test(m))return base+": no hay conexión. Prueba otra vez cuando tengas cobertura.";
  return base+(m?": "+m:".");}
function onImgErr(img){if(img.dataset.full&&img.src!==img.dataset.full){img.src=img.dataset.full}}
window.__imgErr=onImgErr;
const thumbTag=(p,alt)=>`<img src="${esc(thumbUrl(p.ruta))}" data-full="${esc(pubUrl(p.ruta))}" onerror="__imgErr(this)" alt="${esc(alt||"")}" loading="lazy">`;

/* ---------- map ---------- */
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const map=L.map("map",{scrollWheelZoom:false,zoomSnap:.25,minZoom:4,maxZoom:15});
map.attributionControl.setPrefix(false).addAttribution("Fronteras: Natural Earth");
const planPts=ROUTE.map(k=>[P[k][1],P[k][2]]);
map.fitBounds(planPts,{padding:[30,30]});
const narrow=map.getSize().x<640;
if(narrow)map.setView([44.4,4.6],Math.max(map.getZoom()+.75,5),{animate:false});
map.setMaxBounds([[35.5,-16],[52,20]]);
const TRIP=new Set(["France","Monaco","Italy"]);
fetch("geo.json").then(r=>r.json()).then(g=>{
  L.geoJSON(g,{interactive:false,style:f=>({color:css("--border"),weight:.8,fillColor:TRIP.has(f.properties.n)?css("--land-trip"):css("--land"),fillOpacity:1})}).addTo(map).bringToBack();
}).catch(()=>{});
[["Francia",46.4,2.6],["Italia",42.6,12.9],["España",40.6,-4.2]].forEach(([n,a,o])=>L.marker([a,o],{interactive:false,keyboard:false,icon:L.divIcon({className:"",html:`<div class="country">${n}</div>`,iconSize:[0,0]})}).addTo(map));
const seen=new Set();
ROUTE.forEach(k=>{if(seen.has(k))return;seen.add(k);
  L.marker([P[k][1],P[k][2]],{interactive:false,keyboard:false,icon:L.divIcon({className:"",html:`<div class="dot future"></div>`,iconSize:[10,10],iconAnchor:[5,5]})}).addTo(map);
  if(k!=="gra")L.marker([P[k][1],P[k][2]],{interactive:false,keyboard:false,icon:L.divIcon({className:"",html:`<div class="stoplbl future ${k}">${P[k][0]}</div>`,iconSize:[0,0]})}).addTo(map);
});
const trail=L.polyline([],{color:css("--rust"),weight:3.5,lineCap:"round",lineJoin:"round",interactive:false}).addTo(map);
const stopLayer=L.layerGroup().addTo(map);
const fam=L.marker([P.cor[1],P.cor[2]],{icon:L.divIcon({className:"",html:`<div class="fam idle" id="fam" title="¡Aquí estamos!"><div class="body"><div class="tail"></div><img src="img/familia.jpg?v=3" alt="Nuestra familia"></div><div class="shadow"></div></div>`,iconSize:[72,86],iconAnchor:[36,86]}),zIndexOffset:3000,keyboard:false}).addTo(map);
fam.on("click",()=>{const l=lastStop();if(l)openStop(l.id)});
let pickMarker=null;

function lastStop(){return S.stops.length?S.stops[S.stops.length-1]:null}
function drawStops(){
  stopLayer.clearLayers();
  S.stops.forEach(s=>{
    const m=L.marker([s.lat,s.lng],{title:s.nombre,icon:L.divIcon({className:"",html:`<div class="dot"></div>`,iconSize:[14,14],iconAnchor:[7,7]})});
    m.on("click",()=>{if(!S.picking)openStop(s.id)});
    m.bindTooltip(esc(s.nombre),{direction:"top",offset:[0,-6]});
    m.addTo(stopLayer);
  });
}
const hav=(a,b)=>{const r=Math.PI/180,dA=(b[0]-a[0])*r,dO=(b[1]-a[1])*r;const h=Math.sin(dA/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dO/2)**2;return 12742*Math.asin(Math.sqrt(h))};
let raf=null,lastAnimKey="";
function animate(force){
  const path=[[P.cor[1],P.cor[2]]].concat(S.stops.map(s=>[s.lat,s.lng]));
  const key=JSON.stringify(path);
  if(!force&&key===lastAnimKey)return;
  const first=lastAnimKey==="";lastAnimKey=key;
  cancelAnimationFrame(raf);
  const famEl=()=>document.getElementById("fam");
  const keepInView=pos=>{map.invalidateSize();if(!map.getBounds().pad(-0.08).contains(pos))map.panTo(pos,{animate:true})};
  if(path.length<2){fam.setLatLng(path[0]);trail.setLatLngs([]);keepInView(path[0]);return}
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  // first load or replay: whole journey; a new stop: only the last leg
  const from=(first||force)?0:Math.max(0,path.length-2);
  const segs=[];let tot=0;for(let i=from+1;i<path.length;i++){const d=hav(path[i-1],path[i]);segs.push(d);tot+=d}
  const DUR=reduce||tot===0?0:Math.min(5200,1800+tot*1.2);let t0=null;
  const step=ts=>{
    if(t0===null)t0=ts;let f=DUR?Math.min(1,(ts-t0)/DUR):1;
    f=f<.5?2*f*f:1-Math.pow(-2*f+2,2)/2;
    let left=f*tot,i=0;while(i<segs.length-1&&left>segs[i]){left-=segs[i];i++}
    const k=segs[i]?Math.min(1,left/segs[i]):1,a=path[from+i],b=path[from+i+1];
    const pos=[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k];
    fam.setLatLng(pos);trail.setLatLngs(path.slice(0,from+i+1).concat([pos]));
    const v=famEl();if(v){v.classList.toggle("moving",f<1);v.classList.toggle("idle",f>=1)}
    if(f<1)raf=requestAnimationFrame(step);else keepInView(pos);
  };
  raf=requestAnimationFrame(step);
}

/* ---------- render ---------- */
function render(){
  drawStops();renderNow();renderEntries();renderDays();
  if(S.loaded)animate(false);
  if(S.sheet&&S.sheet.type==="stop")renderStopSheet();
  if(S.lb)renderLb();
  $("#fabAdd").hidden=!S.editor||S.picking;
  $("#loginBtn").textContent=S.session?"Salir del modo viajero":"Acceso viajeros";
}
function renderNow(){
  const el=$("#now");const s=lastStop();
  if(!S.loaded)return;
  if(!s){
    el.innerHTML=`<div class="pol"><img src="img/familia.jpg?v=3" alt=""></div><div style="min-width:0"><div class="mono">Todavía en casa</div><h3>A Coruña</h3><p>Salimos el sábado 10 de octubre. ¡Volved por aquí!</p></div>`;
    return;
  }
  const ph=photosOf(s.id);const last=ph[ph.length-1];const nc=commentsOfStop(s.id).length;
  const when=ago(last?last.creado:s.creado);
  el.innerHTML=`<div class="pol">${last?thumbTag(last,s.nombre):`<img src="img/familia.jpg?v=3" alt="">`}</div>
    <div style="min-width:0"><div class="mono">Última publicación${dayN(s.fecha)>=1&&dayN(s.fecha)<=9?" · Día "+dayN(s.fecha):""}</div>
    <h3>${esc(s.nombre)}</h3><p>${esc([when,ph.length?ph.length+(ph.length>1?" fotos":" foto"):null,nc?nc+(nc>1?" comentarios":" comentario"):null].filter(Boolean).join(" · "))}</p>
    <button class="btnlink" id="nowOpen" type="button">Ver la parada</button><button class="btnlink" id="replay" type="button">Ver el viaje otra vez</button></div>`;
  $("#nowOpen").onclick=()=>openStop(s.id);
  $("#replay").onclick=()=>animate(true);
}
function renderEntries(){
  const el=$("#entries");
  if(!S.loaded){el.innerHTML="";return}
  if(!S.stops.length){
    el.outerHTML=`<ol class="entries" id="entries"><li class="empty"><span class="script">muy pronto</span>Aquí irán apareciendo las paradas con sus fotos en cuanto salgamos a la carretera.</li></ol>`;return;
  }
  const list=[...S.stops].reverse();
  el.innerHTML=list.map(s=>{const ph=photosOf(s.id);const nc=commentsOfStop(s.id).length;
    const meta=[dayLabel(s),ph.length?ph.length+(ph.length>1?" fotos":" foto"):null,nc?nc+" 💬":null].filter(Boolean).join(" · ");
    return `<li class="entry" data-id="${esc(s.id)}" tabindex="0"><div class="pol">${ph[0]?thumbTag(ph[0],""):`<div class="scene road"></div>`}</div>
      <div style="min-width:0"><div class="mono">${esc(meta)}</div><h3>${esc(s.nombre)}</h3>${s.nota?`<p>${esc(s.nota)}</p>`:""}</div></li>`}).join("");
  el.querySelectorAll(".entry").forEach(li=>{li.onclick=()=>openStop(li.dataset.id);li.onkeydown=e=>{if(e.key==="Enter")openStop(li.dataset.id)}});
}
function renderDays(){
  const t=todayStr();
  $("#days").innerHTML=DAYS.map(([n,d,r,dr])=>{
    const st=d<t?"done":d===t?"today":"future";const lbl=st==="done"?"Hecho":st==="today"?"Hoy":"Próximamente";
    const real=S.stops.filter(s=>s.fecha===d);
    const chips=real.length?`<div class="stops">${real.map(s=>`<button type="button" data-id="${esc(s.id)}">${esc(s.nombre)}</button>`).join("")}</div>`:"";
    return `<li class="day ${st}"><div class="n">${n}</div><div class="route">${r.map(esc).join('<i>→</i>')}<small>${fmtDay.format(parseD(d))} · ${dr}</small>${chips}</div><span class="chip">${lbl}</span></li>`}).join("");
  $("#days").querySelectorAll(".stops button").forEach(b=>b.onclick=()=>openStop(b.dataset.id));
}

/* ---------- stop sheet ---------- */
function closeSheet(){S.sheet=null;$("#sheetRoot").innerHTML="";document.body.style.overflow=""}
function sheetShell(inner){
  $("#sheetRoot").innerHTML=`<div class="sheet" id="sheet"><div class="panel" role="dialog" aria-modal="true"><button class="close" id="sheetX" type="button" aria-label="Cerrar">✕</button>${inner}</div></div>`;
  document.body.style.overflow="hidden";
  $("#sheetX").onclick=closeSheet;
  $("#sheet").onclick=e=>{if(e.target.id==="sheet")closeSheet()};
}
function openStop(id){S.sheet={type:"stop",id,confirm:false};renderStopSheet();const p=$("#sheet .panel");if(p)p.scrollTop=0}
function renderStopSheet(){
  const s=S.stops.find(x=>x.id===S.sheet.id);if(!s){closeSheet();return}
  const ph=photosOf(s.id);
  const prevScroll=$("#sheet .panel")?.scrollTop||0;
  const tools=S.editor?`<div class="row"><button class="btn wine" id="sUp" type="button" ${S.busy?"disabled":""}>📷 Subir fotos</button><button class="btn" id="sEdit" type="button">Editar</button><button class="btn danger" id="sDel" type="button">Borrar</button></div>`:"";
  const conf=S.sheet.confirm?`<div class="confirm"><div>¿Borrar «${esc(s.nombre)}»${ph.length?" y sus "+ph.length+" fotos":""}? No se puede deshacer.</div><div class="row"><button class="btn wine" id="sDelYes" type="button">Sí, borrar</button><button class="btn" id="sDelNo" type="button">Cancelar</button></div></div>`:"";
  const gal=ph.length?`<div class="gallery">${ph.map(p=>{const n=commentsOf(p.id).length;return `<button type="button" data-p="${esc(p.id)}" aria-label="Ver foto">${thumbTag(p,p.pie)}${n?`<span class="cc">💬 ${n}</span>`:""}</button>`}).join("")}</div>`
    :`<div class="empty">${S.editor?"Todavía no hay fotos. Pulsa «Subir fotos» para elegirlas del carrete.":"Todavía no hay fotos de esta parada."}</div>`;
  sheetShell(`<div><div class="mono">${esc(dayLabel(s))}</div><h2>${esc(s.nombre)}</h2></div>
    ${s.nota?`<p class="note">${esc(s.nota)}</p>`:""}
    ${tools}<div class="status" id="sStatus">${S.busy?esc(S.busy):""}</div>${conf}${gal}`);
  const p=$("#sheet .panel");if(p)p.scrollTop=prevScroll;
  document.querySelectorAll(".gallery button").forEach(b=>b.onclick=()=>openLb(b.dataset.p));
  if($("#sUp"))$("#sUp").onclick=()=>pickFiles(files=>uploadPhotos(s.id,files));
  if($("#sEdit"))$("#sEdit").onclick=()=>openForm(s);
  if($("#sDel"))$("#sDel").onclick=()=>{S.sheet.confirm=true;renderStopSheet()};
  if($("#sDelNo"))$("#sDelNo").onclick=()=>{S.sheet.confirm=false;renderStopSheet()};
  if($("#sDelYes"))$("#sDelYes").onclick=()=>deleteStop(s);
}
function pickFiles(cb){const f=$("#fileIn");f.value="";f.onchange=()=>{const list=[...f.files];if(list.length)cb(list)};f.click()}


/* coordinates typed or pasted by hand: decimal, degrees-minutes-seconds or a Google Maps link */
function parseCoords(txt){
  if(!txt)return null;let t=txt.trim();
  const ok=(a,b)=>isFinite(a)&&isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&!(a===0&&b===0)?[a,b]:null;
  let m=t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)||t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)||t.match(/[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if(m)return ok(+m[1],+m[2]);
  const dms=[...t.matchAll(/(\d+(?:[.,]\d+)?)\s*[°º]\s*(?:(\d+(?:[.,]\d+)?)\s*['’′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["”″]|'')\s*)?([NSEWO])/gi)];
  if(dms.length===2){const v=dms.map(x=>{const n=k=>x[k]?parseFloat(x[k].replace(",",".")):0;let d=n(1)+n(2)/60+n(3)/3600;if(/[SWO]/i.test(x[4]))d=-d;return{d,lat:/[NS]/i.test(x[4])}});
    const la=v.find(x=>x.lat),lo=v.find(x=>!x.lat);return la&&lo?ok(la.d,lo.d):null}
  if(/;/.test(t))t=t.replace(/,/g,".").replace(/;/g," ");
  else if((t.match(/,/g)||[]).length===3)t=t.replace(/(\d),(\d+)\s*,\s*(-?\d+),(\d)/,"$1.$2 $3.$4");
  m=t.replace(/,/g," ").trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  return m?ok(+m[1],+m[2]):null;
}
window.__parseCoords=parseCoords;

/* ---------- stop form ---------- */
function openForm(s){
  S.form=s?{id:s.id,nombre:s.nombre,fecha:s.fecha||"",hora:(s.hora||"").slice(0,5),nota:s.nota||"",lat:s.lat,lng:s.lng,files:[]}
          :(S.form&&!S.form.id?S.form:{id:null,nombre:"",fecha:todayStr(),hora:nowTime(),nota:"",lat:null,lng:null,files:[]});
  S.sheet={type:"form"};renderForm();
}
function readForm(){if(!$("#fName"))return;Object.assign(S.form,{nombre:$("#fName").value,fecha:$("#fDate").value,hora:$("#fTime").value,nota:$("#fNote").value})}
function renderForm(){
  const F=S.form;
  sheetShell(`<div><div class="mono">${F.id?"Editar parada":"Nueva parada"}</div><h2>${F.id?"Editar":"Estamos en…"}</h2></div>
  <form class="f" id="fStop">
    <label>Lugar<input id="fName" required maxlength="80" placeholder="Por ejemplo: gasolinera en Aragón" value="${esc(F.nombre)}"></label>
    <div class="two"><label>Fecha<input id="fDate" type="date" value="${esc(F.fecha)}"></label><label>Hora<input id="fTime" type="time" value="${esc(F.hora)}"></label></div>
    <label>Qué hemos hecho<textarea id="fNote" maxlength="2000" placeholder="Paramos a echar gasolina y…">${esc(F.nota)}</textarea></label>
    <div class="where"><div class="mono">Dónde</div>
      <div class="coords" id="fCoords">${F.lat!=null?`📍 ${F.lat.toFixed(4)}, ${F.lng.toFixed(4)}`:"Todavía sin marcar"}</div>
      <div class="row"><button class="btn solid" id="fGeo" type="button">Usar mi ubicación</button><button class="btn" id="fPick" type="button">Elegir en el mapa</button></div>
      <label>O escribe las coordenadas<input id="fCoordIn" inputmode="text" autocomplete="off" placeholder="43.7384, 7.4246"></label>
      <div class="row"><button class="btn" id="fCoordOk" type="button">Usar estas coordenadas</button></div>
      <div class="status">Sirven números como 43.7384, 7.4246, el formato 43°44'18"N 7°25'28"E o un enlace de Google Maps.</div></div>
    ${F.id?"":`<label>Fotos (opcional)<input id="fFiles" type="file" accept="image/*" multiple></label><div class="status" id="fFilesN">${F.files.length?F.files.length+" fotos elegidas":""}</div>`}
    <div class="status" id="fStatus"></div>
    <div class="row"><button class="btn wine" id="fSave" type="submit">Guardar parada</button><button class="btn" id="fCancel" type="button">Cancelar</button></div>
  </form>`);
  $("#fCancel").onclick=()=>{const id=F.id;S.form=null;if(id)openStop(id);else closeSheet()};
  $("#fGeo").onclick=()=>{
    if(!navigator.geolocation){toast("Este móvil no permite obtener la ubicación. Elígela en el mapa.");return}
    $("#fCoords").textContent="Buscando dónde estáis…";
    navigator.geolocation.getCurrentPosition(pos=>{F.lat=+pos.coords.latitude.toFixed(5);F.lng=+pos.coords.longitude.toFixed(5);
      $("#fCoords").textContent=`📍 ${F.lat.toFixed(4)}, ${F.lng.toFixed(4)}`},
      ()=>{$("#fCoords").textContent=F.lat!=null?`📍 ${F.lat.toFixed(4)}, ${F.lng.toFixed(4)}`:"Todavía sin marcar";toast("No se pudo obtener la ubicación. Revisa el permiso o elígela en el mapa.")},
      {enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  };
  $("#fPick").onclick=()=>{readForm();startPick()};
  const applyCoords=()=>{const c=parseCoords($("#fCoordIn").value);
    if(!c){toast("No entiendo esas coordenadas. Prueba con algo como 43.7384, 7.4246");return}
    F.lat=+c[0].toFixed(6);F.lng=+c[1].toFixed(6);$("#fCoords").textContent=`📍 ${F.lat.toFixed(5)}, ${F.lng.toFixed(5)}`;toast("Ubicación puesta")};
  $("#fCoordOk").onclick=applyCoords;
  $("#fCoordIn").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();applyCoords()}};
  if($("#fFiles"))$("#fFiles").onchange=e=>{F.files=[...e.target.files];$("#fFilesN").textContent=F.files.length?F.files.length+" fotos elegidas":""};
  $("#fStop").onsubmit=async e=>{e.preventDefault();readForm();
    if(!F.nombre.trim()){$("#fName").focus();return}
    if(F.lat==null){toast("Marca dónde estáis: con tu ubicación o en el mapa.");return}
    const row={nombre:F.nombre.trim(),fecha:F.fecha||null,hora:F.hora||null,nota:F.nota.trim()||null,lat:F.lat,lng:F.lng};
    $("#fSave").disabled=true;$("#fStatus").textContent="Guardando…";
    try{
      let id=F.id;
      if(id){const{error}=await sb.from("paradas").update(row).eq("id",id);if(error)throw error}
      else{const{data,error}=await sb.from("paradas").insert(row).select().single();if(error)throw error;id=data.id}
      const files=F.files||[];S.form=null;
      await reload();openStop(id);
      if(files.length)uploadPhotos(id,files);else toast("Parada guardada");
    }catch(err){$("#fSave").disabled=false;$("#fStatus").textContent="";toast(errText(err,"No se pudo guardar"))}
  };
}
function startPick(){
  S.picking=true;$("#sheetRoot").innerHTML="";document.body.style.overflow="";
  $("#banner").hidden=false;$("#fabAdd").hidden=true;
  document.querySelector(".mapsec").scrollIntoView({behavior:"smooth",block:"start"});
  if(S.form.lat!=null)setPick(S.form.lat,S.form.lng,false);
}
function setPick(lat,lng,done){
  if(!pickMarker)pickMarker=L.marker([lat,lng],{icon:L.divIcon({className:"",html:'<div class="pick"></div>',iconSize:[16,16],iconAnchor:[8,8]}),zIndexOffset:4000}).addTo(map);
  else pickMarker.setLatLng([lat,lng]);
  if(done){S.form.lat=+lat.toFixed(5);S.form.lng=+lng.toFixed(5);endPick()}
}
function endPick(){S.picking=false;$("#banner").hidden=true;if(pickMarker){map.removeLayer(pickMarker);pickMarker=null}$("#fabAdd").hidden=!S.editor;S.sheet={type:"form"};renderForm()}
map.on("click",e=>{if(S.picking)setPick(e.latlng.lat,e.latlng.lng,true)});
$("#bannerX").onclick=endPick;
$("#fabAdd").onclick=()=>openForm(null);

/* ---------- photos ---------- */
function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file);const im=new Image();im.onload=()=>res({im,u});im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("No se pudo leer la imagen"))};im.src=u})}
async function decode(file){
  try{const b=await createImageBitmap(file,{imageOrientation:"from-image"});return{src:b,w:b.width,h:b.height,u:null}}
  catch(e){const r=await loadImg(file);return{src:r.im,w:r.im.naturalWidth,h:r.im.naturalHeight,u:r.u}}
}
function toJpeg(img,max,q){const k=Math.min(1,max/Math.max(img.w,img.h));const W=Math.round(img.w*k),H=Math.round(img.h*k);
  const c=document.createElement("canvas");c.width=W;c.height=H;c.getContext("2d").drawImage(img.src,0,0,W,H);
  return new Promise(r=>c.toBlob(b=>r({blob:b,w:W,h:H}),"image/jpeg",q))}
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
async function uploadPhotos(stopId,files){
  files=files.filter(f=>/^image\//.test(f.type)||/\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if(!files.length)return;
  let ok=0,lastErr=null;
  for(let i=0;i<files.length;i++){
    S.busy=`Subiendo foto ${i+1} de ${files.length}…`;if(S.sheet&&S.sheet.type==="stop")renderStopSheet();
    try{
      const img=await decode(files[i]);
      const full=await toJpeg(img,1800,.84),thumb=await toJpeg(img,480,.78);
      if(img.u)URL.revokeObjectURL(img.u);
      if(!full.blob||!thumb.blob)throw new Error("No se pudo preparar la foto");
      const base=`${stopId}/${uid()}`;
      let r=await sb.storage.from(BUCKET).upload(base+".jpg",full.blob,{contentType:"image/jpeg",cacheControl:"31536000"});if(r.error)throw r.error;
      r=await sb.storage.from(BUCKET).upload(base+"_t.jpg",thumb.blob,{contentType:"image/jpeg",cacheControl:"31536000"});if(r.error)throw r.error;
      const ins=await sb.from("fotos").insert({parada_id:stopId,ruta:base+".jpg",ancho:full.w,alto:full.h});if(ins.error)throw ins.error;
      ok++;
    }catch(err){lastErr=err;console.error(err)}
  }
  S.busy=false;await reload();
  if(lastErr)toast(ok?`Se subieron ${ok} de ${files.length}. `+errText(lastErr,"Alguna falló"):errText(lastErr,"No se pudieron subir las fotos"));
  else toast(ok===1?"Foto subida":`${ok} fotos subidas`);
}
async function deletePhoto(p){
  const{error}=await sb.from("fotos").delete().eq("id",p.id);if(error)throw error;
  await sb.storage.from(BUCKET).remove([p.ruta,p.ruta.replace(/\.jpg$/,"_t.jpg")]);
}
async function deleteStop(s){
  try{
    for(const p of photosOf(s.id))await deletePhoto(p);
    const{error}=await sb.from("paradas").delete().eq("id",s.id);if(error)throw error;
    closeSheet();await reload();toast("Parada borrada");
  }catch(err){toast(errText(err,"No se pudo borrar"))}
}

/* ---------- lightbox ---------- */
function openLb(pid){S.lb={pid,editCap:false,confirm:false};renderLb();document.addEventListener("keydown",lbKey)}
function closeLb(){S.lb=null;$("#lbRoot").innerHTML="";document.removeEventListener("keydown",lbKey)}
function lbKey(e){if(!S.lb||e.target.matches("input,textarea"))return;if(e.key==="Escape")closeLb();if(e.key==="ArrowLeft")lbStep(-1);if(e.key==="ArrowRight")lbStep(1)}
function lbStep(d){const p=S.photos.find(x=>x.id===S.lb.pid);if(!p)return;const l=photosOf(p.parada_id);const n=l[l.indexOf(p)+d];if(n){S.lb={pid:n.id,editCap:false,confirm:false};renderLb()}}
function renderLb(){
  const p=S.photos.find(x=>x.id===S.lb.pid);if(!p){closeLb();return}
  const draft=$("#cText")?$("#cText").value:"";const draftName=$("#cName")?$("#cName").value:null;
  const s=S.stops.find(x=>x.id===p.parada_id);const l=photosOf(p.parada_id);const i=l.indexOf(p);const cs=commentsOf(p.id);
  const cap=S.lb.editCap?`<form class="f" id="capF"><textarea id="capT" maxlength="500" placeholder="Pie de foto">${esc(p.pie||"")}</textarea><div class="row"><button class="btn solid" type="submit">Guardar</button><button class="btn" id="capX" type="button">Cancelar</button></div></form>`
    :`${p.pie?`<div class="cap">${esc(p.pie)}</div>`:""}${S.editor?`<div class="row"><button class="btn" id="capE" type="button">${p.pie?"Editar pie":"＋ Pie de foto"}</button><button class="btn danger" id="pDel" type="button">Borrar foto</button></div>`:""}`;
  const conf=S.lb.confirm?`<div class="confirm"><div>¿Borrar esta foto${cs.length?" y sus comentarios":""}?</div><div class="row"><button class="btn wine" id="pDelYes" type="button">Sí, borrar</button><button class="btn" id="pDelNo" type="button">Cancelar</button></div></div>`:"";
  const colors=["var(--sage-deep)","var(--rust)","var(--wine)","var(--gold)"];
  const list=cs.length?cs.map(c=>`<div class="cm"><div class="av" style="background:${colors[(c.autor.charCodeAt(0)||0)%4]}">${esc(c.autor.trim().charAt(0).toUpperCase())}</div><div style="min-width:0"><b>${esc(c.autor)}</b><span class="w">${esc(ago(c.creado))}</span>${S.editor?`<button class="del" data-c="${esc(c.id)}" type="button">borrar</button>`:""}<div class="t">${esc(c.texto)}</div></div></div>`).join("")
    :`<p class="mono" style="color:var(--ink-soft)">Todavía nadie ha comentado. ¡Sé la primera persona!</p>`;
  $("#lbRoot").innerHTML=`<div class="lb" role="dialog" aria-modal="true" aria-label="Foto">
    <figure><img src="${esc(pubUrl(p.ruta))}" alt="${esc(p.pie||"Foto del viaje")}">
      ${i>0?`<button class="nav prev" id="lbPrev" type="button" aria-label="Anterior">‹</button>`:""}
      ${i<l.length-1?`<button class="nav next" id="lbNext" type="button" aria-label="Siguiente">›</button>`:""}
      <button class="x" id="lbX" type="button" aria-label="Cerrar">✕</button></figure>
    <aside><div class="head"><div class="mono">${esc(s?s.nombre:"")} · foto ${i+1} de ${l.length}</div>${cap}${conf}</div>
      <div class="clist" id="cList">${list}</div>
      <form class="send" id="cForm"><input id="cName" maxlength="40" placeholder="Tu nombre" value="${esc(lsGet("dr_nombre"))}" aria-label="Tu nombre" required>
        <div class="row" style="flex-wrap:nowrap"><textarea id="cText" maxlength="1000" placeholder="Escribe un comentario…" aria-label="Comentario" required></textarea><button class="btn solid" type="submit">Enviar</button></div></form>
    </aside></div>`;
  if(draft)$("#cText").value=draft;if(draftName!==null)$("#cName").value=draftName;
  $("#lbX").onclick=closeLb;
  if($("#lbPrev"))$("#lbPrev").onclick=()=>lbStep(-1);
  if($("#lbNext"))$("#lbNext").onclick=()=>lbStep(1);
  const cl=$("#cList");cl.scrollTop=cl.scrollHeight;
  if($("#capE"))$("#capE").onclick=()=>{S.lb.editCap=true;renderLb()};
  if($("#capX"))$("#capX").onclick=()=>{S.lb.editCap=false;renderLb()};
  if($("#capF"))$("#capF").onsubmit=async e=>{e.preventDefault();const{error}=await sb.from("fotos").update({pie:$("#capT").value.trim()||null}).eq("id",p.id);if(error)return toast(errText(error,"No se pudo guardar"));S.lb.editCap=false;await reload()};
  if($("#pDel"))$("#pDel").onclick=()=>{S.lb.confirm=true;renderLb()};
  if($("#pDelNo"))$("#pDelNo").onclick=()=>{S.lb.confirm=false;renderLb()};
  if($("#pDelYes"))$("#pDelYes").onclick=async()=>{try{const n=l[i+1]||l[i-1];await deletePhoto(p);if(n)S.lb={pid:n.id,editCap:false,confirm:false};else closeLb();await reload();toast("Foto borrada")}catch(err){toast(errText(err,"No se pudo borrar"))}};
  document.querySelectorAll(".cm .del").forEach(b=>b.onclick=async()=>{const{error}=await sb.from("comentarios").delete().eq("id",b.dataset.c);if(error)toast(errText(error,"No se pudo borrar"));else reload()});
  const send=async e=>{e&&e.preventDefault();const autor=$("#cName").value.trim(),texto=$("#cText").value.trim();
    if(!autor){$("#cName").focus();return}if(!texto){$("#cText").focus();return}
    lsSet("dr_nombre",autor);const btn=$("#cForm button[type=submit]");btn.disabled=true;
    const{error}=await sb.from("comentarios").insert({foto_id:p.id,autor,texto});
    if(error){btn.disabled=false;toast(errText(error,"No se pudo enviar"));return}
    $("#cText").value="";await reload();};
  $("#cForm").onsubmit=send;
  $("#cText").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}};
}

/* ---------- login ---------- */
function openLogin(){
  S.sheet={type:"login"};
  sheetShell(`<div><div class="mono">Solo para los viajeros</div><h2>Entrar</h2></div>
    <p class="note">Entra con el email y la contraseña de tu cuenta de viajero para añadir paradas y subir fotos.</p>
    <form class="f" id="lForm"><label>Email<input id="lEmail" type="email" autocomplete="username" required></label>
    <label>Contraseña<input id="lPass" type="password" autocomplete="current-password" required></label>
    <div class="status" id="lStatus"></div><div class="row"><button class="btn wine" type="submit">Entrar</button></div></form>`);
  $("#lForm").onsubmit=async e=>{e.preventDefault();$("#lStatus").textContent="Entrando…";
    const{error}=await sb.auth.signInWithPassword({email:$("#lEmail").value.trim(),password:$("#lPass").value});
    if(error){$("#lStatus").textContent="";toast(errText(error,"No se pudo entrar"));return}
    closeSheet();};
}
$("#loginBtn").onclick=async()=>{if(S.session){await sb.auth.signOut();toast("Has salido del modo viajero")}else openLogin()};
async function checkEditor(session){
  S.session=session;S.editor=false;
  if(session){const{data,error}=await sb.rpc("es_editor");S.editor=!error&&data===true;
    if(!S.editor)toast("Tu cuenta no está en la lista de viajeros, así que no puede publicar.");else toast("Modo viajero activado");}
  render();
}
sb.auth.onAuthStateChange((ev,session)=>{if(ev==="INITIAL_SESSION"||ev==="SIGNED_IN"||ev==="SIGNED_OUT")setTimeout(()=>checkEditor(session),0)});

/* ---------- data ---------- */
let reloading=null;
async function reload(){
  if(reloading)return reloading;
  reloading=(async()=>{
    const[a,b,c]=await Promise.all([sb.from("paradas").select("*"),sb.from("fotos").select("*"),sb.from("comentarios").select("*")]);
    if(a.error||b.error||c.error){const e=a.error||b.error||c.error;console.error(e);if(!S.loaded)$("#now").querySelector("p").textContent="No se pudo cargar el viaje. Recarga la página en un momento.";return}
    S.stops=a.data.sort((x,y)=>sortKey(x).localeCompare(sortKey(y)));S.photos=b.data;S.comments=c.data;S.loaded=true;render();
  })().finally(()=>{reloading=null});
  return reloading;
}
let rt=null;
sb.channel("diario").on("postgres_changes",{event:"*",schema:"public"},()=>{clearTimeout(rt);rt=setTimeout(reload,400)}).subscribe();
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")reload()});
renderDays();reload();
})();
