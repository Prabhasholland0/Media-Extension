import {store,live} from './store.js';
import {canSlideService,slideService,bindServiceSwipe} from './service-transitions.js';
import {presets,itemKinds,slotsFor,slotKey,needsTotal,fillSummary,isBlocked,qualified,autoFill,warnings,planTimes,timeLabel,planLength,duration,defaultServices,today,nextSunday,permissionList,deptRoles,timeZones} from './core.js';

const app=document.querySelector('#app'),dialog=document.querySelector('#dialog'),toastEl=document.querySelector('#toast');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={user:null,profile:null,orgs:[],org:null,data:null,authTab:'signin',drafts:{},busy:false,recovery:false,newEvent:null,showPast:false,platformAdmin:false,invitations:[],audit:null,auditOrg:null,notifications:[]};
let toastTimer;

// ---------- small helpers ----------
const icons={home:'<path d="M3 11 12 3l9 8v10H3z"/><path d="M9 21v-6h6v6"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',plus:'<path d="M12 5v14M5 12h14"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',up:'<path d="m6 15 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',check:'<path d="m5 12 5 5 9-10"/>',list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',left:'<path d="m15 6-6 6 6 6"/>',right:'<path d="m9 6 6 6-6 6"/>',out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]}</svg>`;
const longDate=d=>new Date(`${d}T12:00:00`).toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const shortDate=d=>new Date(`${d}T12:00:00`).toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
const dateTile=d=>{const x=new Date(`${d}T12:00:00`);return `<span class="date-tile"><small>${x.toLocaleDateString('en',{month:'short'})}</small><b>${x.getDate()}</b></span>`;};
const initials=n=>(String(n||'').match(/\p{L}+/gu)||['?']).map(w=>w[0]).join('').slice(0,2).toUpperCase();
const avatar=n=>`<span class="avatar" aria-hidden="true">${esc(initials(n))}</span>`;
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const eventBadge=s=>`<span class="badge ${s}">${{draft:'Draft',published:'Published',cancelled:'Cancelled',completed:'Completed'}[s]}</span>`;
const statusBadge=s=>`<span class="badge ${s}">${{accepted:'Confirmed',pending:'Pending',declined:'Declined'}[s]}</span>`;
const roleName=r=>state.data?.roles?.find(x=>x.key===r)?.name||({owner:'Owner',admin:'Church admin',scheduler:'Scheduler',member:'Member'}[r]||r);
// Mirrors the database permission checks so people only see actions they can take.
const can=p=>Boolean(state.data?.perms?.includes(p));
const leadsAny=()=>state.data.profile.status==='active'&&state.data.departmentMembers.some(d=>d.user_id===state.user.id&&d.dept_role!=='member');
const canSchedulePos=pid=>can('schedule.manage')||state.data.profile.status==='active'&&state.data.departmentMembers.some(d=>d.user_id===state.user.id&&d.dept_role!=='member'&&d.team_id===state.data.positions.find(p=>p.id===pid)?.team_id);
const canScheduleAny=()=>can('schedule.manage')||leadsAny();
const settingsAccess=()=>['org.manage','roles.manage','campuses.manage','audit.read'].some(can);
const grantable=r=>r.key!=='owner'&&r.permissions.every(p=>state.data.perms.includes(p));
const activeTeams=()=>[...state.data.teams].filter(t=>!t.archived_at).sort(byOrder);
const byOrder=(a,b)=>(a.sort_order??0)-(b.sort_order??0);
const nameOf=id=>state.data.roster.find(r=>r.user_id===id)?.full_name||'Former member';
const errorText=e=>(e?.message||String(e)).replace(/^.*?ERROR:\s*/,'');

function toast(msg,kind=''){toastEl.textContent=msg;toastEl.className=`show ${kind}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.className='',3600);}
function route(){const parts=location.hash.replace(/^#\/?/,'').split('?')[0].split('/').filter(Boolean);const query=new URLSearchParams(location.hash.split('?')[1]||'');return {parts,query};}
const go=hash=>{if(location.hash===hash)render();else location.hash=hash;};
const orgLink=(page='home')=>`#/o/${state.org.id}/${page}`;

// Shows a dialog with optional fields; resolves to the submitted values or null.
function ask({title,body='',fields=[],confirm='Save',danger=false}){
 dialog.innerHTML=`<form method="dialog" class="dialog-body"><h2>${esc(title)}</h2>${body?`<p class="muted">${body}</p>`:''}
  ${fields.map(f=>`<label class="field"><span>${esc(f.label)}</span>${f.type==='select'?`<select name="${f.name}">${f.options.map(([v,l])=>`<option value="${esc(v)}" ${v===f.value?'selected':''}>${esc(l)}</option>`).join('')}</select>`:f.type==='textarea'?`<textarea name="${f.name}" rows="3" maxlength="${f.max||1000}">${esc(f.value)}</textarea>`:`<input name="${f.name}" type="${f.type||'text'}" value="${esc(f.value??'')}" ${f.required?'required':''} ${f.min!=null?`min="${f.min}"`:''} ${f.max&&f.type!=='number'?`maxlength="${f.max}"`:f.max?`max="${f.max}"`:''}>`}</label>`).join('')}
  <div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn ${danger?'danger':'primary'}" value="ok">${esc(confirm)}</button></div></form>`;
 return new Promise(resolve=>{
  dialog.onclose=()=>{if(dialog.returnValue!=='ok')return resolve(null);resolve(Object.fromEntries(new FormData(dialog.querySelector('form'))));};
  dialog.returnValue='';dialog.showModal();dialog.querySelector('input,select,textarea')?.focus();
 });
}

async function act(fn,success){
 if(state.busy)return;state.busy=true;document.body.classList.add('busy');
 try{await fn();if(success)toast(success,'good');}
 catch(e){toast(errorText(e),'bad');console.error(e);}
 finally{state.busy=false;document.body.classList.remove('busy');}
}
async function loadNotifications(){try{state.notifications=await store.notifications();}catch{state.notifications=[];}}
async function reloadOrg(){state.data=await store.loadOrg(state.org.id);state.auditOrg=null;await loadNotifications();}
async function reloadOrgs(){state.orgs=await store.orgs();if(state.org)state.org=state.orgs.find(o=>o.id===state.org.id)||null;}

// ---------- layout ----------
// Grouped by what people do: their own serving, planning, people, and admin. Items appear only with the permission behind them.
function navGroups(){
 const unread=state.notifications.filter(n=>!n.read_at).length;
 return [['You',[['home','Home','home'],['schedule','My schedule','check'],['notifications','Notifications','bell',unread]]],
  ['Plan',[['calendar','Calendar','calendar'],['events','Events','list'],['teams','Departments','layers']]],
  ['People',[['people','People','users']]],
  ...(settingsAccess()?[['Admin',[['settings','Settings','gear']]]]:[])];
}
const countBadge=n=>n?`<b class="count" aria-label="${n} unread">${n}</b>`:'';
const orgSwitch=()=>`<label class="org-switch"><span class="eyebrow">Organization</span><select data-change="switch-org" aria-label="Organization">${state.orgs.map(o=>`<option value="${o.id}" ${o.id===state.org.id?'selected':''}>${esc(o.name)}</option>`).join('')}<option value="__new">+ Create or join…</option></select></label>`;
function shell(page,content){
 const people=!live?store.people():[],unread=state.notifications.filter(n=>!n.read_at).length;
 const here=p=>page===p?'class="active" aria-current="page"':'';
 const tabs=[['home','Home','home'],['schedule','Schedule','check'],['calendar','Calendar','calendar'],['notifications','Alerts','bell',unread],['more','More','more']];
 const inMore=!tabs.some(([p])=>p===page)&&page!=='';
 return `${!live?`<div class="demo-bar"><span><b>Sample workspace.</b> Changes last for this visit only.</span><label>View as <select data-change="act-as">${people.map(p=>`<option value="${p.id}" ${p.id===state.user.id?'selected':''}>${esc(p.full_name)}</option>`).join('')}</select></label></div>`:''}
 <div class="layout"><aside class="sidebar"><a class="brand" href="#/orgs">${logo()}<span>MediaHub</span></a>${orgSwitch()}
  <nav class="nav" aria-label="Main">${navGroups().map(([g,items])=>`<div class="nav-group"><span class="eyebrow">${g}</span>${items.map(([p,l,i,n])=>`<a href="${orgLink(p)}" ${here(p)}>${icon(i)}<span>${l}</span>${countBadge(n)}</a>`).join('')}</div>`).join('')}</nav>
  <a class="account" href="#/profile">${avatar(state.profile?.full_name)}<span><b>${esc(state.profile?.full_name||'Your profile')}</b><small>${roleName(state.org.role)}</small></span></a>
 </aside>
 <header class="topbar"><a class="brand" href="#/orgs" aria-label="All organizations">${logo()}<span>MediaHub</span></a>${orgSwitch()}<a class="account" href="#/profile" aria-label="Your profile">${avatar(state.profile?.full_name)}</a></header>
 <main class="main">${state.data?.profile?.status==='suspended'?'<div class="notice bad" role="status">This organization is suspended. You can view it, but changes are turned off. Contact MediaHub support.</div>':''}${content}</main>
 <nav class="tabbar" aria-label="Main">${tabs.map(([p,l,i,n])=>`<a href="${orgLink(p)}" ${p==='more'&&inMore?'class="active"':here(p)}>${icon(i)}<span>${l}</span>${countBadge(n)}</a>`).join('')}</nav></div>`;
}
// Shown while an organization loads: the same frame as the page, so nothing jumps when it arrives.
const skeleton=()=>`<div class="skeleton" aria-busy="true" aria-label="Loading"><div class="sk-side"><div class="sk title" style="width:60%"></div><div class="sk nav"></div>${'<div class="sk nav"></div>'.repeat(6)}</div>
 <div class="sk-main"><div class="sk title"></div><div class="sk line" style="width:30%"></div><div class="sk card"></div><div class="sk card"></div><div class="sk line"></div><div class="sk line" style="width:70%"></div></div></div>`;
const logo=()=>`<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#95f500"/><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#061a49" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const heading=(title,sub='',actions='')=>`<header class="page-head"><div><h1>${title}</h1>${sub?`<p class="muted">${sub}</p>`:''}</div>${actions?`<div class="actions">${actions}</div>`:''}</header>`;
const empty=(title,text,action='')=>`<div class="empty"><h3>${title}</h3><p class="muted">${text}</p>${action}</div>`;

// ---------- sign in ----------
function authPage(){
 const t=state.authTab;
 const form=t==='signup'?`<form data-form="signup"><label class="field"><span>Your name</span><input name="name" required maxlength="100" autocomplete="name"></label>
   <label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
   <label class="field"><span>Password</span><input name="password" type="password" minlength="12" required autocomplete="new-password"><small class="muted">At least 12 characters.</small></label>
   <button class="btn primary wide">Create account</button></form>`
 :t==='reset'?`<form data-form="reset"><p class="muted">We will email you a link to choose a new password.</p><label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label><button class="btn primary wide">Send reset link</button></form>`
 :`<form data-form="signin"><label class="field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
   <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
   <button class="btn primary wide">Sign in</button><button type="button" class="btn ghost wide" data-action="auth-tab" data-tab="reset">Forgot password?</button></form>`;
 return `<div class="auth"><section class="auth-hero">${logo()}<h1>Plan every service with your whole team.</h1><p>Create your organization, set how many services and how many people each one needs, build the run sheet, and let your team confirm their spots.</p>
  <ul><li>Any team, church or production crew can sign up</li><li>Services, positions and plans for every event</li><li>Members accept or decline and add blockout dates</li></ul></section>
  <section class="auth-card panel"><div class="tabs">${[['signin','Sign in'],['signup','Create account']].map(([k,l])=>`<button class="${t===k?'active':''}" data-action="auth-tab" data-tab="${k}">${l}</button>`).join('')}</div>
  ${new URLSearchParams(location.search).get('join')?`<p class="note">Sign in or create an account to join your team.</p>`:''}${form}</section></div>`;
}
const recoveryPage=()=>`<div class="auth"><section class="auth-card panel"><h2>Choose a new password</h2><form data-form="new-password"><label class="field"><span>New password</span><input name="password" type="password" minlength="12" required autocomplete="new-password"></label><button class="btn primary wide">Save password</button></form></section></div>`;

// ---------- organizations ----------
function orgsPage(){
 const join=new URLSearchParams(location.search).get('join')||'';
 return `<div class="solo">${!live?`<div class="demo-bar"><span><b>Sample workspace.</b> Changes last for this visit only.</span></div>`:''}<a class="brand dark" href="#/orgs">${logo()}<span>MediaHub</span></a>
 ${heading('Your organizations','Open one, start a new one, or join a team with an invite code.',`${state.platformAdmin?'<a class="btn" href="#/platform">Platform admin</a>':''}<a class="btn" href="#/profile">${icon('user')}Profile</a>`)}
 ${state.invitations.length?`<section class="panel"><h2>Invitations for you</h2><ul class="list">${state.invitations.map(i=>`<li class="row"><span class="avatar big">${esc(initials(i.org_name))}</span><div class="grow"><b>${esc(i.org_name)}</b><small class="muted">Join as ${esc(i.role_name)}${i.invited_by_name?` · invited by ${esc(i.invited_by_name)}`:''}</small></div><button class="btn small primary" data-action="answer-invite" data-id="${i.id}" data-accept="1">Accept</button><button class="btn small" data-action="answer-invite" data-id="${i.id}" data-accept="">Decline</button></li>`).join('')}</ul></section>`:''}
 ${state.orgs.length?`<div class="org-grid">${state.orgs.map(o=>`<a class="panel org-card" href="#/o/${o.id}/home"><span class="avatar big">${esc(initials(o.name))}</span><span><b>${esc(o.name)}</b><small class="muted">${o.role==='owner'?'Owner':o.role==='admin'?'Church admin':o.role==='member'?'Member':'Team role'}${o.status==='suspended'?' · Suspended':''}</small></span></a>`).join('')}</div>`:''}
 <div class="two-col"><section class="panel"><h2>Create an organization</h2><p class="muted">You become its owner and can invite your team.</p>
  <form data-form="create-org"><label class="field"><span>Name</span><input name="name" required maxlength="80" placeholder="e.g. Grace Church Media"></label>
  <fieldset class="choice-list"><legend>Start with</legend>${presets.map((p,i)=>`<label class="choice"><input type="radio" name="preset" value="${p.id}" ${i===0?'checked':''}><span><b>${p.name}</b><small class="muted">${p.hint}</small></span></label>`).join('')}</fieldset>
  <button class="btn primary">Create organization</button></form></section>
 <section class="panel"><h2>Join a team</h2><p class="muted">Ask your team admin for the 8-character invite code or link.</p>
  <form data-form="join-org"><label class="field"><span>Invite code</span><input name="code" required maxlength="8" value="${esc(join)}" class="code-input" autocomplete="off"></label><button class="btn primary">Join</button></form></section></div></div>`;
}

// ---------- home ----------
function upcomingEvents(){const t=today();return state.data.events.filter(e=>e.event_date>=t);}
function eventFill(e){
 const d=state.data,slots=slotsFor(d.needs.filter(n=>n.event_id===e.id),d.positions,d.teams);
 const services=d.services.filter(s=>s.event_id===e.id);
 const sums=services.map(s=>fillSummary(slots,d.assignments.filter(a=>a.service_id===s.id)));
 return sums.reduce((t,x)=>({total:t.total+x.total,filled:t.filled+x.filled,declined:t.declined+x.declined,pending:t.pending+x.pending,accepted:t.accepted+x.accepted}),{total:0,filled:0,declined:0,pending:0,accepted:0});
}
const progress=f=>`<span class="progress" title="${f.filled} of ${f.total} positions filled"><span style="width:${f.total?Math.round(f.filled/f.total*100):0}%"></span></span><small class="muted">${f.filled}/${f.total} filled</small>`;

function myAssignments(){
 const d=state.data,t=today();
 return d.assignments.filter(a=>a.user_id===state.user.id).map(a=>{const s=d.services.find(s=>s.id===a.service_id);const e=s&&d.events.find(e=>e.id===s.event_id);return e&&{a,s,e,p:d.positions.find(p=>p.id===a.position_id)};})
  .filter(x=>x&&x.e.event_date>=t).sort((x,y)=>x.e.event_date.localeCompare(y.e.event_date)||String(x.s.starts_at).localeCompare(String(y.s.starts_at)));
}
// Events asking for my availability, one row per service, like the NLAG availability page.
function availabilityPanel(){
 const req=state.data.requests||[];if(!req.length)return '';
 const events=[...new Map(req.map(r=>[r.event_id,r])).values()];
 const open=req.filter(r=>!r.status).length;
 return `<section class="panel availability"><div class="panel-head"><div><h2>Are you available?</h2><small class="muted">${open?`${open===1?'1 service still needs':`${open} services still need`} your answer`:'Thanks, all answered. You can change an answer until you are scheduled.'}</small></div></div>
 <ul class="list">${events.map(e=>{const campus=state.data.campuses.find(c=>c.id===e.campus_id);return `<li class="avail-event">${dateTile(e.event_date)}<div class="grow"><b>${esc(e.title)}</b><small class="muted">${shortDate(e.event_date)}${campus?` · ${esc(campus.name)}`:''}</small>
  <div class="avail-services">${req.filter(r=>r.event_id===e.event_id).map(r=>`<div class="avail-row"><span>${esc(r.service_name)}${r.starts_at?` · ${timeLabel(r.starts_at)}`:''}</span><span class="toggle" role="group" aria-label="${esc(r.service_name)}">
   <button class="btn small ${r.status==='available'?'yes':''}" data-action="availability" data-service="${r.service_id}" data-status="available" aria-pressed="${r.status==='available'}">Available</button>
   <button class="btn small ${r.status==='not_available'?'no':''}" data-action="availability" data-service="${r.service_id}" data-status="not_available" aria-pressed="${r.status==='not_available'}">Not available</button></span></div>`).join('')}</div></div></li>`;}).join('')}</ul></section>`;
}
// Spots other people asked to hand over that I am trained and free for.
function openSpots(){
 const d=state.data,t=today(),me=state.user.id;
 return d.assignments.filter(a=>a.replacement_requested_at&&a.user_id!==me&&qualified(d.memberPositions,me,a.position_id)&&!d.assignments.some(x=>x.service_id===a.service_id&&x.user_id===me))
  .map(a=>{const s=d.services.find(s=>s.id===a.service_id),e=s&&d.events.find(e=>e.id===s.event_id);return e&&e.status==='published'&&e.event_date>=t&&{a,s,e,p:d.positions.find(p=>p.id===a.position_id)};}).filter(Boolean)
  .sort((x,y)=>x.e.event_date.localeCompare(y.e.event_date));
}
function openSpotsPanel(){
 const list=openSpots();if(!list.length)return '';
 return `<section class="panel"><h2>Spots you can take</h2><p class="muted">These people asked for someone to cover them. You are trained for each spot and free that day.</p>
 <ul class="list">${list.map(({a,s,e,p})=>`<li class="row">${dateTile(e.event_date)}<div class="grow"><a href="${orgLink(`event/${e.id}`)}"><b>${esc(p?.name||'Position')} · ${esc(e.title)}</b></a><small class="muted">${esc(s.name)}${s.starts_at?` · ${timeLabel(s.starts_at)}`:''} · from ${esc(nameOf(a.user_id))}${a.replacement_note?`: “${esc(a.replacement_note)}”`:''}</small>${isBlocked(state.data.blockouts,state.user.id,e.event_date)?'<small class="muted">You blocked out this date.</small>':''}</div>
  <button class="btn small primary" data-action="take-spot" data-id="${a.id}">Take this spot</button></li>`).join('')}</ul></section>`;
}
const assignmentActions=({a,e})=>e.status==='cancelled'?'':`<div class="actions">${a.replacement_requested_at?`<button class="btn small" data-action="withdraw-replacement" data-id="${a.id}">I can serve after all</button>`
 :`${a.status!=='accepted'?`<button class="btn small primary" data-action="respond" data-id="${a.id}" data-status="accepted">Accept</button>`:''}${a.status==='accepted'&&e.status==='published'?`<button class="btn small" data-action="ask-replacement" data-id="${a.id}">Find a replacement</button>`:''}${a.status!=='declined'?`<button class="btn small ghost" data-action="respond" data-id="${a.id}" data-status="declined">Decline</button>`:''}`}</div>`;
const assignmentBadge=({a,e})=>e.status==='cancelled'?eventBadge('cancelled'):a.replacement_requested_at?'<span class="badge pending">Replacement asked</span>':statusBadge(a.status);
const assignmentRows=list=>`<ul class="list">${list.map(x=>{const {s,e,p}=x;return `<li class="row">${dateTile(e.event_date)}<div class="grow"><a href="${orgLink(`event/${e.id}`)}"><b>${esc(e.title)}</b></a><small class="muted">${esc(s.name)}${s.starts_at?` · ${timeLabel(s.starts_at)}`:''} · ${esc(p?.name||'Position')}</small></div>
 ${assignmentBadge(x)}${assignmentActions(x)}</li>`;}).join('')}</ul>`;
// The next thing I serve at, front and centre.
function heroCard(mine){
 const x=mine.find(x=>x.e.status!=='cancelled'&&x.a.status!=='declined');
 if(!x)return '';
 const {s,e,p,a}=x,others=mine.filter(y=>y!==x&&y.e.status!=='cancelled').length;
 return `<section class="hero">${dateTile(e.event_date)}<div class="grow"><span class="eyebrow">Next time you serve</span><b>${esc(p?.name||'Position')} · ${esc(e.title)}</b><span class="muted">${longDate(e.event_date)} · ${esc(s.name)}${s.starts_at?` at ${timeLabel(s.starts_at)}`:''}</span></div>
 ${a.replacement_requested_at?'<span class="badge">Replacement asked</span>':a.status==='pending'?`<button class="btn" data-action="respond" data-id="${a.id}" data-status="accepted">Accept</button>`:'<span class="badge">Confirmed</span>'}
 <a class="btn ghost" href="${orgLink('schedule')}">${others?`${others} more`:'My schedule'}</a></section>`;
}
function homePage(){
 const mine=myAssignments(),upcoming=upcomingEvents(),d=state.data;
 const fills=upcoming.map(e=>[e,eventFill(e)]);
 const open=fills.reduce((n,[,f])=>n+f.total-f.filled,0),declined=fills.reduce((n,[,f])=>n+f.declined,0);
 const waiting=mine.filter(x=>x.a.status==='pending'&&x.e.status!=='cancelled').length;
 return shell('home',`${heading(`Hi ${esc((state.profile?.full_name||'there').split(' ')[0])}`,esc(state.org.name),can('events.manage')?`<a class="btn primary" href="${orgLink('new-event')}">${icon('plus')}New event</a>`:'')}
 ${setupCard()}${heroCard(mine)}${canScheduleAny()?`<div class="stats"><div class="stat"><small>Upcoming events</small><b>${upcoming.length}</b></div><div class="stat"><small>Open positions</small><b>${open}</b></div><div class="stat ${declined?'warn':''}"><small>Declined, need a replacement</small><b>${declined}</b></div><div class="stat"><small>Team members</small><b>${d.roster.length}</b></div></div>`:''}
 ${availabilityPanel()}
 <section class="panel"><div class="panel-head"><div><h2>Your schedule</h2>${waiting?`<small class="muted">${waiting===1?'1 spot needs':`${waiting} spots need`} your answer</small>`:''}</div><a href="${orgLink('schedule')}" class="btn ghost small">See all</a></div>
 ${mine.length?assignmentRows(mine.slice(0,3)):empty('Nothing scheduled yet','When an admin schedules you, it appears here for you to accept or decline.')}</section>
 ${openSpotsPanel()}
 <section class="panel"><div class="panel-head"><h2>Upcoming events</h2><a class="btn ghost small" href="${orgLink('events')}">All events</a></div>
 ${upcoming.length?eventList(upcoming.slice(0,5)):empty('No upcoming events',can('events.manage')?'Create an event to start planning services.':'Your admins have not published any upcoming events yet.')}</section>`);
}
// Everything about my own serving in one place: answer availability, accept or hand over spots, pick up cover.
function schedulePage(){
 const mine=myAssignments(),blocked=state.data.blockouts.filter(b=>b.user_id===state.user.id&&b.day>=today()).length;
 return shell('schedule',`${heading('My schedule',esc(state.org.name),`<a class="btn" href="#/profile">${icon('calendar')}Blockout dates${blocked?` · ${blocked}`:''}</a>`)}
 ${availabilityPanel()}
 <section class="panel"><h2>Where you serve</h2>${mine.length?assignmentRows(mine):empty('Nothing scheduled yet','When an admin schedules you, it appears here for you to accept or decline.')}</section>
 ${openSpotsPanel()}`);
}
const monthKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const isoDay=d=>`${monthKey(d)}-${String(d.getDate()).padStart(2,'0')}`;
// Month view of every event this person can see. Phones get the same month as a list.
function calendarPage(query){
 const d=state.data,t=today(),m=/^\d{4}-\d{2}$/.test(query.get('m')||'')?query.get('m'):t.slice(0,7);
 const first=new Date(`${m}-01T12:00:00`),prev=new Date(first),next=new Date(first);prev.setMonth(prev.getMonth()-1);next.setMonth(next.getMonth()+1);
 const mineEvents=new Set(d.assignments.filter(a=>a.user_id===state.user.id).map(a=>d.services.find(s=>s.id===a.service_id)?.event_id));
 const byDay={};for(const e of d.events)(byDay[e.event_date]||=[]).push(e);
 const cls=e=>['cal-ev',e.status==='draft'?'draft':'',e.status==='cancelled'?'cancelled':'',mineEvents.has(e.id)?'mine':''].filter(Boolean).join(' ');
 const day=new Date(first);day.setDate(1-first.getDay());
 const cells=[];for(let i=0;i<42;i++){const k=isoDay(day);cells.push({k,n:day.getDate(),other:day.getMonth()!==first.getMonth()});day.setDate(day.getDate()+1);}
 const weeks=cells.slice(35).every(c=>c.other)?cells.slice(0,35):cells;
 const inMonth=Object.keys(byDay).filter(k=>k.startsWith(m)).sort();
 const label=first.toLocaleDateString('en',{month:'long',year:'numeric'});
 const oldest=new Date(`${t}T12:00:00`);oldest.setDate(oldest.getDate()-60);
 return shell('calendar',`${heading('Calendar',esc(state.org.name),can('events.manage')?`<a class="btn primary" href="${orgLink('new-event')}">${icon('plus')}New event</a>`:'')}
 <section class="panel"><div class="cal-head"><h2>${label}</h2><div class="actions"><a class="icon-btn" href="${orgLink('calendar')}?m=${monthKey(prev)}" aria-label="Previous month">${icon('left')}</a><a class="btn small" href="${orgLink('calendar')}">Today</a><a class="icon-btn" href="${orgLink('calendar')}?m=${monthKey(next)}" aria-label="Next month">${icon('right')}</a></div></div>
 <div class="cal" role="grid" aria-label="${label}">${weekdays.map(w=>`<div class="cal-dow" role="columnheader">${w.slice(0,3)}</div>`).join('')}
  ${weeks.map(c=>`<div class="cal-day ${c.other?'other':''} ${c.k===t?'today':''}" role="gridcell"><span class="cal-num">${c.n}</span>${(byDay[c.k]||[]).map(e=>`<a class="${cls(e)}" href="${orgLink(`event/${e.id}`)}" title="${esc(e.title)}">${esc(e.title)}</a>`).join('')}</div>`).join('')}</div>
 <div class="cal-agenda">${inMonth.length?`<ul class="list">${inMonth.flatMap(k=>byDay[k]).map(e=>`<li><a class="row link" href="${orgLink(`event/${e.id}`)}">${dateTile(e.event_date)}<span class="grow"><b>${esc(e.title)}</b><small class="muted">${shortDate(e.event_date)}${mineEvents.has(e.id)?' · You serve':''}</small></span>${eventBadge(e.status)}</a></li>`).join('')}</ul>`:empty('No events this month','Use the arrows to look at other months.')}</div>
 <div class="legend"><span><i></i>Published</span>${d.events.some(e=>e.status==='draft')?'<span><i class="draft"></i>Draft</span>':''}<span><i class="mine"></i>You serve</span></div>
 ${m<monthKey(oldest)?`<p class="muted">Events before ${shortDate(isoDay(oldest))} are not shown here.</p>`:''}</section>`);
}
// Phones: everything the bottom bar has no room for.
function morePage(){
 const items=navGroups().flatMap(([,items])=>items).filter(([p])=>!['home','schedule','calendar','notifications'].includes(p));
 return shell('more',`${heading('More',esc(state.org.name))}
 <section class="panel more-list"><ul class="list">${items.map(([p,l,i])=>`<li><a class="row link" href="${orgLink(p)}">${icon(i)}<span class="grow"><b>${l}</b></span>${icon('right')}</a></li>`).join('')}
  <li><a class="row link" href="#/profile">${icon('user')}<span class="grow"><b>Your profile</b><small class="muted">Details, blockout dates, appearance</small></span>${icon('right')}</a></li>
  <li><a class="row link" href="#/orgs">${icon('layers')}<span class="grow"><b>Switch organization</b><small class="muted">Create or join another</small></span>${icon('right')}</a></li>
  <li><button class="row link" data-action="sign-out">${icon('out')}<span class="grow"><b>Sign out</b></span></button></li></ul></section>`);
}
function eventList(events){
 return `<ul class="list">${events.map(e=>{const s=state.data.services.filter(s=>s.event_id===e.id).sort(byOrder);const f=eventFill(e);
  return `<li><a class="row link" href="${orgLink(`event/${e.id}`)}">${dateTile(e.event_date)}<div class="grow"><b>${esc(e.title)}</b><small class="muted">${s.length} service${s.length===1?'':'s'}${s.length?`: ${s.map(x=>esc(x.name)+(x.starts_at?` ${timeLabel(x.starts_at)}`:'')).join(', ')}`:''}</small></div>
  <div class="fill">${e.status==='cancelled'?'':progress(f)}</div>${eventBadge(e.status)}</a></li>`;}).join('')}</ul>`;
}

// ---------- events ----------
function eventsPage(){
 const t=today(),all=state.data.events,list=state.showPast?all.filter(e=>e.event_date<t).reverse():all.filter(e=>e.event_date>=t);
 return shell('events',`${heading('Events','Each event has its own services, people and plan.',can('events.manage')?`<a class="btn primary" href="${orgLink('new-event')}">${icon('plus')}New event</a>`:'')}
 <div class="tabs inline"><button class="${state.showPast?'':'active'}" data-action="past" data-past="0">Upcoming</button><button class="${state.showPast?'active':''}" data-action="past" data-past="1">Past 60 days</button></div>
 <section class="panel">${list.length?eventList(list):empty(state.showPast?'No past events':'No upcoming events',can('events.manage')&&!state.showPast?'Create your first event: pick a date, how many services, and how many people each position needs.':'')}</section>
 ${serviceTypesPanel()}`);
}

function serviceTypesPanel(){
 const d=state.data,types=d.serviceTypes.filter(t=>!t.archived_at),manage=can('events.manage');
 if(!manage)return '';
 return `<section class="panel"><div class="panel-head"><div><h2>Service types</h2><small class="muted">Reusable services, like your Sunday Gathering, that you can schedule weeks ahead.</small></div></div>
 ${types.length?`<ul class="list">${types.map(t=>{const campus=d.campuses.find(c=>c.id===t.campus_id);const seats=t.needs.reduce((n,x)=>n+x.quantity,0);
  return `<li class="row"><div class="grow"><b>${esc(t.name)}</b><small class="muted">${t.weekday!=null?`Every ${weekdays[t.weekday]}`:'No set day'}${campus?` · ${esc(campus.name)}`:''} · ${t.services.length} service${t.services.length===1?'':'s'} · ${seats} people each${t.ask_availability?' · asks for availability':''}</small></div>
  <button class="btn small primary" data-action="type-schedule" data-id="${t.id}">Schedule weeks</button><button class="btn small ghost" data-action="type-edit" data-id="${t.id}">Edit</button><button class="icon-btn" data-action="type-delete" data-id="${t.id}" aria-label="Delete ${esc(t.name)}">${icon('x')}</button></li>`;}).join('')}</ul>`
 :'<p class="muted">Open an event, then use <b>Save as service type</b> in its Setup tab.</p>'}</section>`;
}
function newEventDraft(){return {title:'Sunday Service',event_date:nextSunday(),notes:'',campus_id:state.data.campuses.find(c=>!c.archived_at)?.id||'',services:defaultServices(1),needs:{}};}
function newEventPage(){
 if(!can('events.manage'))return shell('events',empty('You can’t create events','Ask someone with permission to manage events in this organization.'));
 const n=state.newEvent||(state.newEvent=newEventDraft()),d=state.data;
 const perService=Object.values(n.needs).reduce((a,b)=>a+b,0);
 const teams=activeTeams(),campuses=d.campuses.filter(c=>!c.archived_at);
 return shell('events',`${heading('New event','Choose the date, how many services, and how many people you need.')}
 <form data-form="new-event" class="stack">
 <section class="panel"><h2>1. Event</h2><div class="grid-2"><label class="field"><span>Title</span><input name="title" required maxlength="120" value="${esc(n.title)}" data-draft="title"></label>
  <label class="field"><span>Date</span><input name="event_date" type="date" required value="${n.event_date}" data-draft="event_date"></label></div>
  ${campuses.length?`<label class="field"><span>Campus</span><select data-draft="campus_id"><option value="">No specific campus</option>${campuses.map(c=>`<option value="${c.id}" ${n.campus_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>`:''}
  <label class="field"><span>Notes for the team <small class="muted">(optional)</small></span><textarea name="notes" rows="2" maxlength="2000" data-draft="notes">${esc(n.notes)}</textarea></label>
  ${d.serviceTypes.some(t=>!t.archived_at)?`<label class="field"><span>Start from a service type <small class="muted">(fills services and people)</small></span><select data-change="from-type"><option value="">None</option>${d.serviceTypes.filter(t=>!t.archived_at).map(t=>`<option value="${t.id}" ${n.service_type_id===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>`:''}</section>
 <section class="panel"><div class="panel-head"><h2>2. How many services?</h2>${stepper('services',n.services.length,1,6)}</div>
  <div class="service-rows">${n.services.map((s,i)=>`<div class="grid-2"><label class="field"><span>Service ${i+1} name</span><input required maxlength="60" value="${esc(s.name)}" data-svc="${i}" data-key="name"></label><label class="field"><span>Start time</span><input type="time" value="${s.starts_at||''}" data-svc="${i}" data-key="starts_at"></label></div>`).join('')}</div></section>
 <section class="panel"><div class="panel-head"><h2>3. How many people per service?</h2><span class="pill">${perService} per service · ${perService*n.services.length} total</span></div>
  ${teams.length?teams.map(t=>{const ps=d.positions.filter(p=>p.team_id===t.id).sort(byOrder);return ps.length?`<h3 class="team-label">${esc(t.name)}</h3><div class="need-grid">${ps.map(p=>`<div class="need"><span>${esc(p.name)}<small class="muted">${d.memberPositions.filter(m=>m.position_id===p.id).length} trained</small></span>${stepper(`need:${p.id}`,n.needs[p.id]||0,0,50)}</div>`).join('')}</div>`:'';}).join('')
  :empty('No positions yet',`Add departments and positions first.`,`<a class="btn" href="${orgLink('teams')}">Set up departments</a>`)}</section>
 <div class="form-foot"><a class="btn" href="${orgLink('events')}">Cancel</a><button class="btn primary">Create event</button></div></form>`);
}
const stepper=(key,value,min,max)=>`<span class="stepper"><button type="button" data-action="step" data-key="${key}" data-delta="-1" ${value<=min?'disabled':''} aria-label="Fewer">−</button><output aria-live="polite">${value}</output><button type="button" data-action="step" data-key="${key}" data-delta="1" ${value>=max?'disabled':''} aria-label="More">+</button></span>`;

function eventPage(id,tab,query){
 const d=state.data,e=d.events.find(e=>e.id===id);
 if(!e)return shell('events',empty('Event not found','It may have been deleted, or it is not published yet.',`<a class="btn" href="${orgLink('events')}">Back to events</a>`));
 const services=d.services.filter(s=>s.event_id===id).sort(byOrder);
 const svc=services.find(s=>s.id===query.get('service'))||services[0];
 const tabs=[['schedule','People'],['plan','Plan'],...(can('events.manage')?[['setup','Setup']]:[])];
 const campus=d.campuses.find(c=>c.id===e.campus_id);
 tab=tabs.some(([k])=>k===tab)?tab:'schedule';
 const body=tab==='plan'?planTab(e,services,svc):tab==='setup'?setupTab(e,services):scheduleTab(e,services,svc);
 return shell('events',`<a class="back" href="${orgLink('events')}">← Events</a>
 ${heading(`${esc(e.title)} ${eventBadge(e.status)}`,longDate(e.event_date)+(campus?` · ${esc(campus.name)}`:'')+(e.notes?` · ${esc(e.notes)}`:''),
  can('events.manage')?`<button class="btn" data-action="duplicate" data-id="${e.id}">${icon('copy')}Duplicate</button>${['draft','published'].includes(e.status)&&e.event_date>=today()?`<button class="btn" data-action="toggle-availability" data-id="${e.id}">${e.availability_open?'Stop asking for availability':'Ask for availability'}</button>`:''}${['draft','published'].includes(e.status)?`<button class="btn ${e.status==='draft'?'primary':''}" data-action="publish" data-id="${e.id}" data-status="${e.status==='draft'?'published':'draft'}">${e.status==='draft'?'Publish to team':'Unpublish'}</button>`:''}`:'')}
 ${e.status==='cancelled'?'<div class="notice bad" role="status">This event is cancelled. Everyone who was scheduled has been told.</div>':e.status==='completed'?'<div class="notice" role="status">This event is marked completed.</div>':''}
 <div class="tabs inline">${tabs.map(([k,l])=>`<a href="${orgLink(`event/${id}/${k}`)}${svc?`?service=${svc.id}`:''}" class="${tab===k?'active':''}">${l}</a>`).join('')}</div>${body}`);
}
const serviceChips=(e,services,svc,tab,extra=()=>'')=>services.length>1?`<div class="chips">${services.map(s=>`<a href="${orgLink(`event/${e.id}/${tab}`)}?service=${s.id}" class="chip ${s.id===svc.id?'active':''}">${esc(s.name)}${s.starts_at?` · ${timeLabel(s.starts_at)}`:''}${extra(s)}</a>`).join('')}</div>`:'';

function scheduleTab(e,services,svc){
 const d=state.data;
 if(!svc)return `<section class="panel">${empty('No services yet',can('events.manage')?'Add a service in Setup.':'')}</section>`;
 const slots=slotsFor(d.needs.filter(n=>n.event_id===e.id),d.positions,d.teams);
 const saved=d.assignments.filter(a=>a.service_id===svc.id);
 const draft=state.drafts[svc.id],current=draft||saved;
 const at=(p,slot)=>current.find(a=>a.position_id===p&&a.slot===slot);
 const f=fillSummary(slots,current.map(a=>({...a,status:saved.find(s=>s.position_id===a.position_id&&s.slot===a.slot&&s.user_id===a.user_id)?.status||'pending'})));
 const load=countLoad(),avail=Object.fromEntries(d.availability.filter(a=>a.service_id===svc.id).map(a=>[a.user_id,a.status]));
 const answered=d.roster.filter(m=>avail[m.user_id]).length,yes=d.roster.filter(m=>avail[m.user_id]==='available').length;
 const warn=canScheduleAny()?warnings({slots,assignments:current.map(a=>({...a,status:saved.find(s=>s.position_id===a.position_id&&s.slot===a.slot&&s.user_id===a.user_id)?.status})),roster:d.roster,memberPositions:d.memberPositions,blockouts:d.blockouts,day:e.event_date,availability:avail}):[];
 const groups=[...new Set(slots.map(s=>s.team?.id))].map(tid=>({team:d.teams.find(t=>t.id===tid),slots:slots.filter(s=>s.team?.id===tid)}));
 const option=(m,s,a)=>{const other=current.find(x=>x.user_id===m.user_id&&!(x.position_id===s.position.id&&x.slot===s.slot));const blocked=isBlocked(d.blockouts,m.user_id,e.event_date);
  return `<option value="${m.user_id}" ${a?.user_id===m.user_id?'selected':''} ${other?'disabled':''}>${esc(m.full_name||'Member')}${other?' (already serving)':blocked?' (blocked out)':avail[m.user_id]==='not_available'?' (not available)':`${avail[m.user_id]==='available'?' · available':''} · ${load[m.user_id]||0} upcoming`}</option>`;};
 return `${serviceChips(e,services,svc,'schedule',s=>{const x=fillSummary(slots,d.assignments.filter(a=>a.service_id===s.id));return ` <small>${x.filled}/${x.total}</small>`;})}
 ${slideOpen(services)}<section class="panel"><div class="panel-head"><div><h2>${esc(svc.name)}${svc.starts_at?` · ${timeLabel(svc.starts_at)}`:''}</h2><small class="muted">${f.filled} of ${f.total} filled${draft?' · <b>Unsaved changes</b>':''}</small>${canScheduleAny()&&(e.availability_open||answered)?`<small class="muted">${yes} available · ${answered-yes} not available · ${d.roster.length-answered} not answered</small>`:''}</div>
  ${canScheduleAny()&&slots.length?`<div class="actions"><button class="btn" data-action="autofill" data-service="${svc.id}">${icon('spark')}Auto-fill open spots</button>${draft?`<button class="btn" data-action="discard" data-service="${svc.id}">Discard</button><button class="btn primary" data-action="save-roster" data-service="${svc.id}">Save</button>`:''}</div>`:''}</div>
 ${warn.length?`<ul class="warnings">${warn.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
 ${slots.length?groups.map(g=>`<h3 class="team-label">${esc(g.team?.name||'Team')}</h3><ul class="slots">${g.slots.map(s=>{const a=at(s.position.id,s.slot);const stored=a&&saved.find(x=>x.position_id===a.position_id&&x.slot===a.slot&&x.user_id===a.user_id);
  const label=`${esc(s.position.name)}${d.needs.find(n=>n.event_id===e.id&&n.position_id===s.position.id).quantity>1?` ${s.slot}`:''}`;
  if(!canSchedulePos(s.position.id))return `<li class="slot"><span class="slot-name">${label}</span><span class="slot-person">${a?`${avatar(nameOf(a.user_id))}${esc(nameOf(a.user_id))}`:'<span class="muted">Open</span>'}</span>${stored?.replacement_requested_at?'<span class="badge pending">Needs cover</span>':stored?statusBadge(stored.status):''}</li>`;
  const rank=m=>({available:0,undefined:1,not_available:2})[avail[m.user_id]],ok=d.roster.filter(m=>qualified(d.memberPositions,m.user_id,s.position.id)).sort((x,y)=>rank(x)-rank(y)),rest=d.roster.filter(m=>!ok.includes(m));
  return `<li class="slot"><label class="slot-name" for="slot-${s.position.id}-${s.slot}">${label}</label><select id="slot-${s.position.id}-${s.slot}" data-change="assign" data-service="${svc.id}" data-position="${s.position.id}" data-slot="${s.slot}">
   <option value="">Open</option><optgroup label="Trained for ${esc(s.position.name)}">${ok.map(m=>option(m,s,a)).join('')}</optgroup>${rest.length?`<optgroup label="Everyone else">${rest.map(m=>option(m,s,a)).join('')}</optgroup>`:''}</select>
   ${stored?.replacement_requested_at?'<span class="badge pending">Needs cover</span>':stored?statusBadge(stored.status):a?'<span class="badge new">New</span>':''}</li>`;}).join('')}</ul>`).join('')
 :empty('No positions needed yet',can('events.manage')?'Set how many people each position needs in Setup.':'',can('events.manage')?`<a class="btn" href="${orgLink(`event/${e.id}/setup`)}">Open setup</a>`:'')}</section>
 ${canScheduleAny()&&e.status==='draft'?'<p class="muted note">People you schedule see their request right away on their Home page. Publish the event so the whole team can see the plan and roster.</p>':''}${slideClose(services)}`;
}
// Upcoming assignments per person, used to spread the work.
function countLoad(){const d=state.data,t=today(),live=new Set(d.events.filter(e=>e.event_date>=t).map(e=>e.id)),sv=new Set(d.services.filter(s=>live.has(s.event_id)).map(s=>s.id));
 return d.assignments.reduce((m,a)=>{if(sv.has(a.service_id)&&a.status!=='declined')m[a.user_id]=(m[a.user_id]||0)+1;return m;},{});}

// Swiping left or right on a phone moves between services, ported from the NLAG schedule (service-transitions.js).
const slideOpen=services=>services.length>1?'<div class="service-slide-viewport" id="service-slide-viewport"><div class="service-slide-content">':'';
const slideClose=services=>services.length>1?'</div></div>':'';
let sliding=false;
function bindEventSwipe(){
 const vp=app.querySelector('#service-slide-viewport');if(!vp)return;
 bindServiceSwipe(vp,dir=>{
  const {parts,query}=route(),id=parts[3],tab=parts[4]||'schedule',services=state.data.services.filter(s=>s.event_id===id).sort(byOrder);
  const i=Math.max(0,services.findIndex(s=>s.id===query.get('service'))),next=services[i+dir];if(!next)return;
  const hash=`${orgLink(`event/${id}/${tab}`)}?service=${next.id}`;
  if(!canSlideService())return go(hash);
  const t=document.createElement('template');t.innerHTML=eventPage(id,tab,new URLSearchParams({service:next.id}));
  const incoming=t.content.querySelector('.service-slide-content');if(!incoming)return go(hash);
  sliding=true;slideService(vp,incoming,dir).finally(()=>{sliding=false;go(hash);});
 },()=>!state.busy&&!sliding&&!dialog.open);
}
function planTab(e,services,svc){
 const items=state.data.items.filter(i=>i.event_id===e.id).sort(byOrder),times=planTimes(items,svc?.starts_at?.slice(0,5));
 return `${serviceChips(e,services,svc,'plan')}
 ${slideOpen(services)}<section class="panel"><div class="panel-head"><div><h2>Service plan</h2><small class="muted">${items.length} items · ${duration(planLength(items))}${svc?.starts_at?` · times for ${esc(svc.name)}`:''}</small></div></div>
 ${items.length?`<ol class="plan">${items.map((i,n)=>`<li class="plan-item ${i.kind}"><span class="plan-time">${times[n]}</span><div class="grow"><b>${esc(i.title)}</b>${i.kind!=='header'?`<span class="kind">${itemKinds[i.kind]}</span>`:''}${i.notes?`<small class="muted">${esc(i.notes)}</small>`:''}</div>
  <span class="plan-length">${i.kind==='header'?'':`${i.duration_minutes} min`}</span>${can('events.manage')?`<span class="row-actions"><button class="icon-btn" data-action="item-move" data-id="${i.id}" data-delta="-1" ${n===0?'disabled':''} aria-label="Move up">${icon('up')}</button><button class="icon-btn" data-action="item-move" data-id="${i.id}" data-delta="1" ${n===items.length-1?'disabled':''} aria-label="Move down">${icon('down')}</button><button class="btn small ghost" data-action="item-edit" data-id="${i.id}">Edit</button><button class="icon-btn" data-action="item-delete" data-id="${i.id}" aria-label="Remove ${esc(i.title)}">${icon('x')}</button></span>`:''}</li>`).join('')}</ol>`
 :empty('The plan is empty',can('events.manage')?'Add songs, videos, the message and anything else in running order.':'')}
 ${can('events.manage')?`<form data-form="add-item" data-event="${e.id}" class="add-item"><input name="title" required maxlength="120" placeholder="Add an item, e.g. Welcome" aria-label="Item title"><select name="kind" aria-label="Type">${Object.entries(itemKinds).map(([k,l])=>`<option value="${k}" ${k==='item'?'selected':''}>${l}</option>`).join('')}</select><input name="duration_minutes" type="number" min="0" max="600" value="5" aria-label="Minutes"><button class="btn primary">${icon('plus')}Add</button></form>`:''}</section>${slideClose(services)}`;
}

function setupTab(e,services){
 const d=state.data,needs=d.needs.filter(n=>n.event_id===e.id),teams=activeTeams();
 return `<section class="panel"><h2>Event details</h2><form data-form="event-details" data-event="${e.id}"><div class="grid-2"><label class="field"><span>Title</span><input name="title" required maxlength="120" value="${esc(e.title)}"></label><label class="field"><span>Date</span><input name="event_date" type="date" required value="${e.event_date}"></label></div>
  ${d.campuses.length?`<label class="field"><span>Campus</span><select name="campus_id"><option value="">No specific campus</option>${d.campuses.filter(c=>!c.archived_at||c.id===e.campus_id).map(c=>`<option value="${c.id}" ${e.campus_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>`:''}
  <label class="field"><span>Notes for the team</span><textarea name="notes" rows="2" maxlength="2000">${esc(e.notes)}</textarea></label><button class="btn primary">Save details</button></form></section>
 <section class="panel"><div class="panel-head"><h2>Services (${services.length})</h2><button class="btn" data-action="add-service" data-event="${e.id}">${icon('plus')}Add service</button></div>
  <ul class="list">${services.map(s=>`<li class="row"><div class="grow"><b>${esc(s.name)}</b><small class="muted">${s.starts_at?timeLabel(s.starts_at):'No start time'}</small></div><button class="btn small" data-action="edit-service" data-id="${s.id}">Edit</button><button class="btn small danger" data-action="delete-service" data-id="${s.id}">Remove</button></li>`).join('')}</ul></section>
 <section class="panel"><div class="panel-head"><h2>People needed per service</h2><span class="pill">${needsTotal(needs)} per service</span></div>
  ${teams.map(t=>{const ps=d.positions.filter(p=>p.team_id===t.id).sort(byOrder);return ps.length?`<h3 class="team-label">${esc(t.name)}</h3><div class="need-grid">${ps.map(p=>`<div class="need"><span>${esc(p.name)}</span>${stepper(`setneed:${e.id}:${p.id}`,needs.find(n=>n.position_id===p.id)?.quantity||0,0,50)}</div>`).join('')}</div>`:'';}).join('')||empty('No positions yet','',`<a class="btn" href="${orgLink('teams')}">Set up departments</a>`)}
  <p class="muted note">Lowering a number removes the people in the extra spots.</p></section>
 <section class="panel"><h2>Reuse and status</h2><p class="muted">Save these services and people needed as a service type to schedule future weeks in one step.</p>
  <div class="actions"><button class="btn" data-action="save-type" data-id="${e.id}">Save as service type</button>
  ${e.status==='cancelled'||e.status==='completed'?`<button class="btn" data-action="event-status" data-id="${e.id}" data-status="draft">Reopen as draft</button>`
   :`<button class="btn" data-action="event-status" data-id="${e.id}" data-status="completed">Mark completed</button><button class="btn danger" data-action="event-status" data-id="${e.id}" data-status="cancelled">Cancel event</button>`}</div></section>
 <section class="panel danger-zone"><h2>Delete event</h2><p class="muted">Removes its services, plan and everyone's assignments.</p><button class="btn danger" data-action="delete-event" data-id="${e.id}">Delete event</button></section>`;
}

// ---------- people & departments ----------
const roleOptions=current=>state.data.roles.filter(r=>grantable(r)||r.key===current).map(r=>`<option value="${esc(r.key)}" ${r.key===current?'selected':''}>${esc(r.name)}</option>`).join('');
function inviteForm(defaultRole='member',next=''){
 return `<form data-form="invite" class="inline-form wrap" ${next?`data-next="${next}"`:''}><input name="email" type="email" required maxlength="200" placeholder="name@example.com" aria-label="Email address">
  <select name="role" aria-label="Role">${state.data.roles.filter(grantable).map(r=>`<option value="${esc(r.key)}" ${r.key===defaultRole?'selected':''}>${esc(r.name)}</option>`).join('')}</select><button class="btn primary">Invite</button></form>`;
}
function invitePanel(){
 const d=state.data,link=`${location.origin}${location.pathname}?join=${d.inviteCode}`;
 return `<section class="panel"><h2>Invite people</h2>
  <p class="muted">Invite by email to choose their role. They see the invitation in MediaHub after they sign in with that email; no email is sent yet, so let them know.</p>
  ${inviteForm()}
  ${d.invitations.length?`<ul class="list compact">${d.invitations.map(i=>`<li class="row"><span class="grow"><b>${esc(i.email)}</b><small class="muted">${esc(roleName(i.role))} · invited ${shortDate(i.created_at.slice(0,10))}</small></span><span class="badge pending">Waiting</span><button class="icon-btn" data-action="invite-revoke" data-id="${i.id}" aria-label="Cancel invitation for ${esc(i.email)}">${icon('x')}</button></li>`).join('')}</ul>`:''}
  <div class="invite"><div><h3>Or share an invite code</h3><p class="muted">Anyone with this code joins as a Member after signing up.</p></div>
  <div class="invite-code"><code>${esc(d.inviteCode)}</code><button class="btn" data-action="copy" data-text="${esc(link)}">${icon('copy')}Copy invite link</button><button class="btn ghost small" data-action="reset-code">New code</button></div></div></section>`;
}
function peoplePage(){
 const d=state.data,manage=can('members.manage'),depts=can('departments.manage');
 return shell('people',`${heading('People',`${d.roster.length} member${d.roster.length===1?'':'s'}`)}
 ${manage?invitePanel():''}
 <section class="panel"><ul class="list">${d.roster.map(m=>{
  const ps=d.memberPositions.filter(x=>x.user_id===m.user_id).map(x=>d.positions.find(p=>p.id===x.position_id)?.name).filter(Boolean);
  const leads=d.departmentMembers.filter(x=>x.user_id===m.user_id&&x.dept_role!=='member').map(x=>`${deptRoles[x.dept_role]}, ${d.teams.find(t=>t.id===x.team_id)?.name||''}`);
  const me=m.user_id===state.user.id,editRole=manage&&!me&&m.role!=='owner'&&grantable(d.roles.find(r=>r.key===m.role)||{key:m.role,permissions:[]});
  return `<li class="row person">${avatar(m.full_name)}<div class="grow"><b>${esc(m.full_name||'New member')}${me?' <small class="muted">(you)</small>':''}</b>
   <small class="muted">${ps.length?esc(ps.join(' · ')):'No positions yet'}</small>${leads.length?`<small class="muted">${esc(leads.join(' · '))}</small>`:''}${m.email||m.phone?`<small class="muted">${esc([m.email,m.phone].filter(Boolean).join(' · '))}</small>`:''}</div>
   ${editRole?`<select data-change="role" data-user="${m.user_id}" aria-label="Role for ${esc(m.full_name)}">${roleOptions(m.role)}</select>`:`<span class="badge role">${esc(roleName(m.role))}</span>`}
   ${depts?`<button class="btn small" data-action="member-positions" data-user="${m.user_id}">Positions</button>`:''}
   ${editRole?`<button class="icon-btn" data-action="remove-member" data-user="${m.user_id}" aria-label="Remove ${esc(m.full_name)}">${icon('x')}</button>`:''}</li>`;}).join('')}</ul></section>`);
}
function teamsPage(){
 const d=state.data,admin=can('departments.manage'),all=[...d.teams].sort(byOrder),teams=all.filter(t=>!t.archived_at),archived=all.filter(t=>t.archived_at);
 const people=t=>d.departmentMembers.filter(x=>x.team_id===t.id);
 return shell('teams',`${heading('Departments & positions','Each department has leaders and positions, the spots you fill in each service like Camera or Producer.',admin?`<button class="btn primary" data-action="add-team">${icon('plus')}Add department</button>`:'')}
 ${teams.length?`<div class="team-grid">${teams.map(t=>{const ps=d.positions.filter(p=>p.team_id===t.id).sort(byOrder),lead=people(t).filter(x=>x.dept_role!=='member');
  return `<section class="panel"><div class="panel-head"><h2>${esc(t.name)}</h2>${admin?`<div class="actions"><button class="btn small ghost" data-action="edit-team" data-id="${t.id}">Edit</button><button class="btn small ghost" data-action="archive-team" data-id="${t.id}">Archive</button><button class="icon-btn" data-action="delete-team" data-id="${t.id}" aria-label="Delete ${esc(t.name)}">${icon('x')}</button></div>`:''}</div>
  ${t.description?`<p class="muted">${esc(t.description)}</p>`:''}
  <p class="lead-line"><small class="muted">${lead.length?`Led by ${esc(lead.map(x=>`${nameOf(x.user_id)} (${deptRoles[x.dept_role]})`).join(', '))}`:'No leader yet'} · ${people(t).length} in department</small>${admin?` <button class="btn small ghost" data-action="dept-members" data-id="${t.id}">Leaders & members</button>`:''}</p>
  <ul class="list compact">${ps.map(p=>`<li class="row"><span class="grow">${esc(p.name)}<small class="muted">${d.memberPositions.filter(m=>m.position_id===p.id).length} people</small></span>${admin?`<button class="btn small ghost" data-action="rename-position" data-id="${p.id}">Rename</button><button class="icon-btn" data-action="delete-position" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">${icon('x')}</button>`:''}</li>`).join('')||'<li class="muted">No positions yet.</li>'}</ul>
  ${admin?`<form data-form="add-position" data-team="${t.id}" class="inline-form"><input name="name" required maxlength="60" placeholder="New position" aria-label="New position in ${esc(t.name)}"><button class="btn">${icon('plus')}Add</button></form>`:''}</section>`;}).join('')}</div>`
 :`<section class="panel">${empty('No departments yet',admin?'Add a department such as Media or Worship, then its positions.':'Your admins have not set up departments yet.')}</section>`}
 ${archived.length?`<section class="panel"><h2>Archived</h2><ul class="list compact">${archived.map(t=>`<li class="row"><span class="grow">${esc(t.name)}<small class="muted">Hidden from new events. History is kept.</small></span>${admin?`<button class="btn small" data-action="archive-team" data-id="${t.id}" data-restore="1">Restore</button>`:''}</li>`).join('')}</ul></section>`:''}`);
}

// ---------- settings ----------
const auditWhat={organizations:'church profile',org_members:'membership',org_roles:'role',invitations:'invitation',campuses:'campus',teams:'department',positions:'position',department_members:'department membership',events:'event',plan_assignments:'schedule'};
function auditLine(a){
 const who=a.actor_id?nameOf(a.actor_id):'System',det=a.detail||{};
 const verb={insert:'added',update:'changed',delete:'removed'}[a.action]||a.action;
 const label=det.name||det.title||det.email||(a.entity==='org_members'||a.entity==='department_members'?nameOf(det.user_id||a.entity_id):'');
 const fields=a.action==='update'?Object.keys(det).filter(k=>!/_id$|^id$/.test(k)).map(k=>k.replace(/_/g,' ')).join(', '):'';
 return `<li class="row"><span class="grow"><span><b>${esc(who)}</b> ${verb} ${esc(auditWhat[a.entity]||a.entity)}${label?` <b>${esc(label)}</b>`:''}${fields?` <small class="muted">(${esc(fields)})</small>`:''}</span><small class="muted">${new Date(a.at).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}</small></span></li>`;
}
function orgProfileForm(next=''){
 const p=state.data.profile,zones=timeZones();
 return `<form data-form="org-profile" ${next?`data-next="${next}"`:''}><label class="field"><span>Church or organization name</span><input name="name" required maxlength="80" value="${esc(p.name)}"></label>
  <div class="grid-2"><label class="field"><span>Time zone</span><select name="time_zone">${(zones.includes(p.time_zone)?zones:[p.time_zone,...zones]).map(z=>`<option ${z===p.time_zone?'selected':''}>${esc(z)}</option>`).join('')}</select></label>
  <label class="field"><span>Website</span><input name="website" type="url" maxlength="200" value="${esc(p.website)}" placeholder="https://"></label>
  <label class="field"><span>Contact email</span><input name="contact_email" type="email" maxlength="200" value="${esc(p.contact_email)}"></label>
  <label class="field"><span>Contact phone</span><input name="contact_phone" maxlength="40" value="${esc(p.contact_phone)}"></label></div>
  <label class="field"><span>Address</span><textarea name="address" rows="2" maxlength="300">${esc(p.address)}</textarea></label>
  <button class="btn primary">${next?'Save and continue':'Save'}</button></form>`;
}
function campusPanel(){
 const d=state.data,list=[...d.campuses].sort((a,b)=>Boolean(a.archived_at)-Boolean(b.archived_at)||byOrder(a,b));
 return `<ul class="list compact">${list.map(c=>`<li class="row"><span class="grow"><span><b>${esc(c.name)}</b>${c.archived_at?' <span class="badge draft">Archived</span>':''}</span>${c.address?`<small class="muted">${esc(c.address)}</small>`:''}</span>
   <button class="btn small ghost" data-action="edit-campus" data-id="${c.id}">Edit</button><button class="btn small ghost" data-action="archive-campus" data-id="${c.id}">${c.archived_at?'Restore':'Archive'}</button></li>`).join('')||'<li class="muted">No campuses yet. Add one if your church meets in more than one place.</li>'}</ul>
  <form data-form="add-campus" class="inline-form wrap"><input name="name" required maxlength="80" placeholder="Campus name" aria-label="Campus name"><input name="address" maxlength="300" placeholder="Address (optional)" aria-label="Campus address"><button class="btn">${icon('plus')}Add campus</button></form>`;
}
async function settingsPage(){
 if(!settingsAccess())return shell('settings',empty('You can’t open settings','Ask a church admin if you need to change something here.'));
 const d=state.data,owner=state.org.role==='owner';
 if(can('audit.read')&&state.auditOrg!==state.org.id){try{state.audit=await store.auditLog(state.org.id);}catch{state.audit=null;}state.auditOrg=state.org.id;}
 const others=d.roster.filter(m=>m.user_id!==state.user.id);
 return shell('settings',`${heading('Settings',esc(state.org.name))}
 ${can('org.manage')?`<section class="panel"><h2>Church profile</h2>${orgProfileForm()}</section>`:''}
 ${can('campuses.manage')?`<section class="panel"><h2>Campuses</h2>${campusPanel()}</section>`:''}
 ${can('roles.manage')?`<section class="panel"><div class="panel-head"><h2>Roles & permissions</h2><button class="btn small" data-action="new-role">${icon('plus')}New role</button></div>
  <p class="muted">Roles decide what people can do. Department leaders can also schedule their own department.</p>
  <ul class="list compact">${d.roles.map(r=>`<li class="row"><span class="grow"><span><b>${esc(r.name)}</b>${r.is_system?' <span class="badge draft">Built in</span>':''}</span><small class="muted">${r.key==='owner'?'Everything, plus transferring and deleting the organization':r.permissions.length?esc(r.permissions.map(k=>permissionList.find(p=>p[0]===k)?.[1]).join(' · ')):'Sees published events and their own schedule'}</small><small class="muted">${d.roster.filter(m=>m.role===r.key).length} people</small></span>
   ${r.key!=='owner'&&grantable(r)?`<button class="btn small ghost" data-action="edit-role" data-key="${esc(r.key)}">Edit</button>`:''}${!r.is_system?`<button class="icon-btn" data-action="delete-role" data-key="${esc(r.key)}" aria-label="Delete ${esc(r.name)}">${icon('x')}</button>`:''}</li>`).join('')}</ul></section>`:''}
 ${can('audit.read')?`<section class="panel"><h2>Activity</h2><p class="muted">The latest changes to people, roles, departments, events and schedules.</p>
  ${state.audit===null?'<p class="notice bad">Could not load the activity log.</p>':state.audit.length?`<ul class="list compact audit">${state.audit.map(auditLine).join('')}</ul>`:'<p class="muted">No activity yet.</p>'}</section>`:''}
 ${owner?`<section class="panel"><h2>Transfer ownership</h2><p class="muted">Give ownership to another member. You become a Church admin.</p>
  ${others.length?`<form data-form="transfer" class="inline-form wrap"><select name="user" aria-label="New owner">${others.map(m=>`<option value="${m.user_id}">${esc(m.full_name||'Member')}</option>`).join('')}</select><button class="btn">Transfer</button></form>`:'<p class="muted">Invite someone first.</p>'}</section>
 <section class="panel danger-zone"><h2>Delete organization</h2><p class="muted">Permanently removes every event, plan, department and membership in ${esc(state.org.name)}.</p><button class="btn danger" data-action="delete-org">Delete organization</button></section>`:''}`);
}

// ---------- setup wizard ----------
const setupSteps=['Church details','Campuses','Departments','First event','Invite leaders','Invite volunteers','Publish'];
function setupCard(){
 if(state.data.profile.onboarded_at||!can('org.manage'))return '';
 return `<section class="panel setup-card"><div class="grow"><h2>Finish setting up ${esc(state.org.name)}</h2><p class="muted">A few short steps: church details, campuses, departments, your first event and your people.</p></div><a class="btn primary" href="${orgLink('setup')}">Continue setup</a></section>`;
}
function setupPage(step){
 if(!can('org.manage'))return shell('home',empty('Only church admins can run setup',''));
 step=Math.min(setupSteps.length,Math.max(1,step));
 const d=state.data,nextLink=`${orgLink('setup')}?step=${step+1}`,teams=activeTeams();
 const body={
  1:()=>`<p class="muted">This shows on your church profile and sets the time zone for services.</p>${orgProfileForm(nextLink)}`,
  2:()=>`<p class="muted">Add each place you meet. Skip this if you have one location.</p>${can('campuses.manage')?campusPanel():'<p class="muted">You need permission to manage campuses.</p>'}`,
  3:()=>`<p class="muted">Departments hold the positions you schedule, like Camera in Media or Vocals in Worship.</p>
   <ul class="list compact">${teams.map(t=>`<li class="row"><span class="grow"><b>${esc(t.name)}</b><small class="muted">${d.positions.filter(p=>p.team_id===t.id).map(p=>p.name).join(' · ')||'No positions yet'}</small></span></li>`).join('')||'<li class="muted">No departments yet.</li>'}</ul>
   <div class="actions"><button class="btn" data-action="add-team">${icon('plus')}Add department</button><a class="btn ghost" href="${orgLink('teams')}">Edit positions and leaders</a></div>`,
  4:()=>{const ev=d.events.filter(e=>e.event_date>=today());return `<p class="muted">Create the next service you need to plan. You can set how many services and how many people each position needs.</p>
   ${ev.length?`<ul class="list compact">${ev.slice(0,5).map(e=>`<li class="row"><span class="grow"><b>${esc(e.title)}</b><small class="muted">${shortDate(e.event_date)}</small></span><span class="badge ${e.status}">${e.status==='published'?'Published':'Draft'}</span></li>`).join('')}</ul>`:''}
   <a class="btn ${ev.length?'':'primary'}" href="${orgLink('new-event')}">${icon('plus')}Create an event</a>`;},
  5:()=>`<p class="muted">Invite the people who will help you run things, such as a Church admin or a Scheduler. They see the invitation when they sign in with this email.</p>${can('members.manage')?inviteForm(d.roles.some(r=>r.key==='scheduler')?'scheduler':'member'):''}
   ${d.invitations.length?`<ul class="list compact">${d.invitations.map(i=>`<li class="row"><span class="grow">${esc(i.email)}<small class="muted">${esc(roleName(i.role))}</small></span><span class="badge pending">Waiting</span></li>`).join('')}</ul>`:''}`,
  6:()=>can('members.manage')?`<p class="muted">Share the invite link with volunteers. They join as Members, then you choose which positions they can serve in from People.</p>
   <div class="invite-code"><code>${esc(d.inviteCode)}</code><button class="btn" data-action="copy" data-text="${esc(`${location.origin}${location.pathname}?join=${d.inviteCode}`)}">${icon('copy')}Copy invite link</button></div>
   <h3>Or invite by email</h3>${inviteForm('member')}`:'<p class="muted">You need permission to invite people.</p>',
  7:()=>{const drafts=d.events.filter(e=>e.status==='draft'&&e.event_date>=today());return `<p class="muted">Publishing lets your team see an event and respond to their schedule. You can keep events as drafts until the schedule is ready.</p>
   ${drafts.length?`<ul class="list compact">${drafts.map(e=>`<li class="row"><span class="grow"><b>${esc(e.title)}</b><small class="muted">${shortDate(e.event_date)}</small></span><button class="btn small" data-action="publish" data-id="${e.id}" data-status="published">Publish</button></li>`).join('')}</ul>`:'<p class="muted">No draft events waiting.</p>'}
   <button class="btn primary" data-action="finish-setup">Finish setup</button>`;}
 }[step];
 return shell('home',`${heading('Set up your church',`Step ${step} of ${setupSteps.length}: ${setupSteps[step-1]}`,`<button class="btn ghost" data-action="finish-setup" data-skip="1">Skip setup</button>`)}
 <ol class="steps">${setupSteps.map((s,i)=>`<li class="${i+1===step?'active':i+1<step?'done':''}"><a href="${orgLink('setup')}?step=${i+1}" ${i+1===step?'aria-current="step"':''}><span>${i+1}</span>${esc(s)}</a></li>`).join('')}</ol>
 <section class="panel">${body()}</section>
 <div class="actions spread">${step>1?`<a class="btn" href="${orgLink('setup')}?step=${step-1}">Back</a>`:'<span></span>'}${step<setupSteps.length&&step!==1?`<a class="btn primary" href="${nextLink}">Next</a>`:''}</div>`);
}

// ---------- platform admin ----------
// Organization metadata only: platform operators never see church records.
async function platformPage(){
 if(!state.platformAdmin)return `<div class="solo">${empty('Not available','This page is for MediaHub operators.','<a class="btn" href="#/orgs">Back</a>')}</div>`;
 let orgs;try{orgs=await store.platformOrgs();}catch(e){return `<div class="solo">${empty('Could not load organizations',esc(errorText(e)),'<a class="btn" href="#/orgs">Back</a>')}</div>`;}
 return `<div class="solo wide"><a class="back" href="#/orgs">← Back</a>${heading('Platform admin',`${orgs.length} organization${orgs.length===1?'':'s'}. Counts only; church records stay private.`)}
 <section class="panel"><ul class="list">${orgs.map(o=>`<li class="row"><span class="grow"><b>${esc(o.name)}</b><small class="muted">${o.members} members · ${o.events} events · created ${shortDate(String(o.created_at).slice(0,10))}</small></span>
  <span class="badge ${o.status==='active'?'published':'declined'}">${o.status==='active'?'Active':'Suspended'}</span><button class="btn small" data-action="org-status" data-id="${o.id}" data-status="${o.status==='active'?'suspended':'active'}">${o.status==='active'?'Suspend':'Reactivate'}</button></li>`).join('')||'<li class="muted">No organizations yet.</li>'}</ul></section></div>`;
}

// ---------- notifications ----------
const notifIcon={availability:'calendar',scheduled:'calendar',cancelled:'x',declined:'x',replacement_requested:'users',replacement_taken:'users'};
function notificationsPage(){
 const list=state.notifications,unread=list.filter(n=>!n.read_at).length;
 return shell('notifications',`${heading('Notifications',unread?`${unread} unread`:'You are all caught up',unread?'<button class="btn" data-action="mark-read">Mark all as read</button>':'')}
 <section class="panel">${list.length?`<ul class="list notifications">${list.map(n=>{const org=state.orgs.find(o=>o.id===n.org_id);
  return `<li><button class="row link notif ${n.read_at?'':'unread'}" data-action="open-notification" data-id="${n.id}"><span class="notif-icon ${n.kind}">${icon(notifIcon[n.kind]||'bell')}</span><span class="grow"><b>${esc(n.title)}</b>${n.body?`<small class="muted">${esc(n.body)}</small>`:''}<small class="muted">${org&&org.id!==state.org.id?`${esc(org.name)} · `:''}${new Date(n.created_at).toLocaleString('en',{dateStyle:'medium',timeStyle:'short'})}</small></span>${n.read_at?'':'<span class="dot" aria-label="Unread"></span>'}</button></li>`;}).join('')}</ul>`
 :empty('No notifications yet','You hear here when you are scheduled, when someone needs cover, and when plans change. Email reminders are not set up yet.')}</section>`);
}

// ---------- profile ----------
// theme.js applies the saved choice before the page paints; this keeps it in step when changed here.
const currentTheme=()=>{try{return localStorage.getItem('mediahub-theme')||'system';}catch{return 'system';}};
function setTheme(k){try{k==='system'?localStorage.removeItem('mediahub-theme'):localStorage.setItem('mediahub-theme',k);}catch{}if(k==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=k;}
function profilePage(){
 const p=state.profile||{},mine=state.data?state.data.blockouts.filter(b=>b.user_id===state.user.id&&b.day>=today()).sort((a,b)=>a.day.localeCompare(b.day)):null;
 const theme=currentTheme();
 const content=`<a class="back" href="${state.org?orgLink():'#/orgs'}">← Back</a>${heading('Your profile',esc(p.email||''))}
 <section class="panel"><h2>Details</h2><form data-form="profile"><div class="grid-2"><label class="field"><span>Name</span><input name="name" required maxlength="100" value="${esc(p.full_name)}" autocomplete="name"></label><label class="field"><span>Phone <small class="muted">(seen by your admins)</small></span><input name="phone" maxlength="30" value="${esc(p.phone)}" autocomplete="tel"></label></div><button class="btn primary">Save profile</button></form></section>
 ${mine?`<section class="panel"><h2>Blockout dates</h2><p class="muted">Dates you can't serve. Admins see them when scheduling, and auto-fill skips you.</p>
  <form data-form="blockout" class="inline-form"><input name="day" type="date" required min="${today()}" aria-label="Date"><input name="reason" maxlength="120" placeholder="Reason (optional)" aria-label="Reason"><button class="btn">${icon('plus')}Add</button></form>
  <ul class="list compact">${mine.map(b=>`<li class="row"><span class="grow"><b>${shortDate(b.day)}</b>${b.reason?`<small class="muted">${esc(b.reason)}</small>`:''}</span><button class="icon-btn" data-action="delete-blockout" data-day="${b.day}" aria-label="Remove ${shortDate(b.day)}">${icon('x')}</button></li>`).join('')||'<li class="muted">No upcoming blockout dates.</li>'}</ul></section>`:''}
 <section class="panel"><div class="panel-head"><div><h2>Appearance</h2><small class="muted">Saved on this device.</small></div><span class="segmented" role="group" aria-label="Theme">${[['system','System'],['light','Light'],['dark','Dark']].map(([k,l])=>`<button type="button" data-action="theme" data-theme="${k}" aria-pressed="${theme===k}">${l}</button>`).join('')}</span></div></section>
 <section class="panel"><h2>Organizations</h2><ul class="list compact">${state.orgs.map(o=>`<li class="row"><span class="grow"><b>${esc(o.name)}</b><small class="muted">${roleName(o.role)}</small></span>${o.role!=='owner'?`<button class="btn small" data-action="leave-org" data-id="${o.id}">Leave</button>`:''}</li>`).join('')}</ul><a class="btn" href="#/orgs">Create or join another</a></section>
 <button class="btn ghost" data-action="sign-out">Sign out</button>`;
 return state.org?shell('',content):`<div class="solo">${content}</div>`;
}

// ---------- render ----------
async function render(){
 const {parts,query}=route();
 if(state.recovery){app.innerHTML=recoveryPage();return;}
 if(!state.user){app.innerHTML=authPage();return;}
 if(parts[0]==='o'&&parts[1]){
  if(state.org?.id!==parts[1]){
   const org=state.orgs.find(o=>o.id===parts[1]);if(!org)return go('#/orgs');
   state.org=org;state.data=null;state.drafts={};state.newEvent=null;
   app.innerHTML=skeleton();
   try{await reloadOrg();}catch(e){app.innerHTML=`<div class="solo">${empty('Could not load this organization',esc(errorText(e)),'<a class="btn" href="#/orgs">Back</a>')}</div>`;return;}
   try{localStorage.setItem('mediahub-org',org.id);}catch{}
  }
  const page=parts[2]||'home';
  app.innerHTML=page==='events'?eventsPage():page==='new-event'?newEventPage():page==='event'?eventPage(parts[3],parts[4],query):page==='people'?peoplePage():page==='teams'?teamsPage():page==='settings'?await settingsPage():page==='setup'?setupPage(Number(query.get('step'))||1):page==='notifications'?notificationsPage():page==='schedule'?schedulePage():page==='calendar'?calendarPage(query):page==='more'?morePage():homePage();
 }else if(parts[0]==='profile'){app.innerHTML=profilePage();}
 else if(parts[0]==='platform'){state.org=null;state.data=null;app.innerHTML=await platformPage();}
 else{
  if(!parts.length&&state.orgs.length){let last;try{last=localStorage.getItem('mediahub-org');}catch{}return go(`#/o/${(state.orgs.find(o=>o.id===last)||state.orgs[0]).id}/home`);}
  state.org=null;state.data=null;try{state.invitations=await store.myInvitations();}catch{state.invitations=[];}app.innerHTML=orgsPage();
 }
 document.title=`${state.org?state.org.name+' · ':''}MediaHub`;
 if(parts[2]==='event')bindEventSwipe();
}

// ---------- events ----------
const handlers={
 'auth-tab':b=>{state.authTab=b.dataset.tab;render();},
 past:b=>{state.showPast=b.dataset.past==='1';render();},
 respond:b=>act(async()=>{await store.respond(b.dataset.id,b.dataset.status);await reloadOrg();render();},b.dataset.status==='accepted'?'Thanks, you are confirmed.':'Declined. Your admin will find a replacement.'),
 step:b=>{
  const [kind,a,c]=b.dataset.key.split(':'),delta=Number(b.dataset.delta);
  if(kind==='services'){const n=state.newEvent,count=Math.min(6,Math.max(1,n.services.length+delta));n.services=defaultServices(count).map((s,i)=>n.services[i]||s);if(count===1&&n.services[0].name==='Service 1')n.services[0].name='Service';if(count>1&&n.services[0].name==='Service')n.services[0].name='Service 1';return render();}
  if(kind==='need'){const n=state.newEvent;n.needs[a]=Math.min(50,Math.max(0,(n.needs[a]||0)+delta));if(!n.needs[a])delete n.needs[a];return render();}
  if(kind==='setneed'){const cur=state.data.needs.find(n=>n.event_id===a&&n.position_id===c)?.quantity||0,next=Math.min(50,Math.max(0,cur+delta));
   const filled=state.data.assignments.some(x=>x.position_id===c&&x.slot>next&&state.data.services.some(s=>s.id===x.service_id&&s.event_id===a));
   act(async()=>{if(filled&&!await ask({title:'Remove people from extra spots?',body:'Someone is scheduled in a spot you are removing. They will be taken off this event.',confirm:'Remove spot',danger:true}))return;
    await store.setNeed(state.org.id,a,c,next);await reloadOrg();render();});}
 },
 autofill:b=>{
  const svc=state.data.services.find(s=>s.id===b.dataset.service),e=state.data.events.find(e=>e.id===svc.event_id),d=state.data;
  const slots=slotsFor(d.needs.filter(n=>n.event_id===e.id),d.positions,d.teams).filter(x=>canSchedulePos(x.position.id));
  const current=(state.drafts[svc.id]||d.assignments.filter(a=>a.service_id===svc.id)).filter(a=>a.status!=='declined');
  const availability=Object.fromEntries(d.availability.filter(a=>a.service_id===svc.id).map(a=>[a.user_id,a.status]));
  const filled=autoFill({slots,roster:d.roster,memberPositions:d.memberPositions,blockouts:d.blockouts,day:e.event_date,current,load:countLoad(),availability});
  const added=filled.length-current.length;
  state.drafts[svc.id]=filled;render();toast(added?`Filled ${added} spot${added===1?'':'s'}, people who said available first. Review, then Save.`:'No trained, available people for the open spots.',added?'good':'');
 },
 discard:b=>{delete state.drafts[b.dataset.service];render();},
 'save-roster':b=>act(async()=>{const id=b.dataset.service;await store.saveAssignments(id,state.drafts[id].map(({position_id,slot,user_id})=>({position_id,slot,user_id})));delete state.drafts[id];await reloadOrg();render();},'Schedule saved. People see their requests now.'),
 publish:b=>act(async()=>{await store.updateEvent(b.dataset.id,{status:b.dataset.status});await reloadOrg();render();},b.dataset.status==='published'?'Published. Your team can now see this event.':'Moved back to draft.'),
 duplicate:b=>act(async()=>{const e=state.data.events.find(e=>e.id===b.dataset.id);
  const v=await ask({title:'Duplicate event',body:'Copies the services, people needed and plan. Nobody is scheduled yet.',fields:[{name:'date',label:'New date',type:'date',required:true,value:e.event_date>=today()?addWeek(e.event_date):nextSunday()}],confirm:'Duplicate'});if(!v)return;
  const id=await store.duplicateEvent(e.id,v.date);await reloadOrg();go(orgLink(`event/${id}`));},'Event duplicated.'),
 'delete-event':b=>act(async()=>{if(!await ask({title:'Delete this event?',body:'Its services, plan and assignments are removed for everyone.',confirm:'Delete event',danger:true}))return;await store.deleteEvent(b.dataset.id);await reloadOrg();go(orgLink('events'));}),
 'add-service':b=>act(async()=>{const n=state.data.services.filter(s=>s.event_id===b.dataset.event).length;const v=await ask({title:'Add service',fields:[{name:'name',label:'Name',required:true,max:60,value:`Service ${n+1}`},{name:'starts_at',label:'Start time',type:'time',value:''}]});if(!v)return;
  await store.addService(state.org.id,b.dataset.event,{name:v.name.trim(),starts_at:v.starts_at||null,sort_order:n+1});await reloadOrg();render();}),
 'edit-service':b=>act(async()=>{const s=state.data.services.find(s=>s.id===b.dataset.id);const v=await ask({title:'Edit service',fields:[{name:'name',label:'Name',required:true,max:60,value:s.name},{name:'starts_at',label:'Start time',type:'time',value:s.starts_at?.slice(0,5)||''}]});if(!v)return;
  await store.updateService(s.id,{name:v.name.trim(),starts_at:v.starts_at||null});await reloadOrg();render();}),
 'delete-service':b=>act(async()=>{if(!await ask({title:'Remove this service?',body:'People scheduled in it are taken off.',confirm:'Remove',danger:true}))return;await store.deleteService(b.dataset.id);await reloadOrg();render();}),
 'item-move':b=>act(async()=>{const it=state.data.items.find(i=>i.id===b.dataset.id),list=state.data.items.filter(i=>i.event_id===it.event_id).sort(byOrder);
  const i=list.indexOf(it),j=i+Number(b.dataset.delta);[list[i],list[j]]=[list[j],list[i]];
  await Promise.all(list.map((x,k)=>x.sort_order!==k+1?store.updateItem(x.id,{sort_order:k+1}):null));await reloadOrg();render();}),
 'item-edit':b=>act(async()=>{const it=state.data.items.find(i=>i.id===b.dataset.id);
  const v=await ask({title:'Edit plan item',fields:[{name:'title',label:'Title',required:true,max:120,value:it.title},{name:'kind',label:'Type',type:'select',value:it.kind,options:Object.entries(itemKinds)},{name:'duration_minutes',label:'Minutes',type:'number',min:0,max:600,value:it.duration_minutes},{name:'notes',label:'Notes',type:'textarea',value:it.notes}],confirm:'Save'});
  if(!v)return;await store.updateItem(it.id,{title:v.title.trim(),kind:v.kind,duration_minutes:v.kind==='header'?0:Number(v.duration_minutes)||0,notes:v.notes.trim()});await reloadOrg();render();}),
 'item-delete':b=>act(async()=>{await store.deleteItem(b.dataset.id);await reloadOrg();render();}),
 'add-team':()=>act(async()=>{const v=await ask({title:'Add department',fields:[{name:'name',label:'Department name',required:true,max:60,value:''}],confirm:'Add department'});if(!v)return;await store.addTeam(state.org.id,v.name.trim(),state.data.teams.length+1);await reloadOrg();render();}),
 'delete-team':b=>act(async()=>{const t=state.data.teams.find(t=>t.id===b.dataset.id);if(!await ask({title:`Delete ${t.name}?`,body:'Its positions are removed from every event and schedule. Archive it instead to keep its history.',confirm:'Delete department',danger:true}))return;await store.deleteTeam(t.id);await reloadOrg();render();}),
 'rename-position':b=>act(async()=>{const p=state.data.positions.find(p=>p.id===b.dataset.id);const v=await ask({title:'Rename position',fields:[{name:'name',label:'Position',required:true,max:60,value:p.name}]});if(!v)return;await store.renamePosition(p.id,v.name.trim());await reloadOrg();render();}),
 'delete-position':b=>act(async()=>{const p=state.data.positions.find(p=>p.id===b.dataset.id);if(!await ask({title:`Delete ${p.name}?`,body:'It is removed from every event and schedule.',confirm:'Delete position',danger:true}))return;await store.deletePosition(p.id);await reloadOrg();render();}),
 'member-positions':b=>act(async()=>{
  const d=state.data,u=b.dataset.user,has=new Set(d.memberPositions.filter(m=>m.user_id===u).map(m=>m.position_id));
  dialog.innerHTML=`<form method="dialog" class="dialog-body"><h2>${esc(nameOf(u))}</h2><p class="muted">Choose what this person can serve as.</p>${activeTeams().map(t=>`<fieldset class="checks"><legend>${esc(t.name)}</legend>${d.positions.filter(p=>p.team_id===t.id).sort(byOrder).map(p=>`<label><input type="checkbox" name="p" value="${p.id}" ${has.has(p.id)?'checked':''}> ${esc(p.name)}</label>`).join('')}</fieldset>`).join('')}
   <div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div></form>`;
  const picked=await new Promise(r=>{dialog.onclose=()=>r(dialog.returnValue==='ok'?new FormData(dialog.querySelector('form')).getAll('p'):null);dialog.returnValue='';dialog.showModal();});
  if(!picked)return;await store.setMemberPositions(state.org.id,u,picked);await reloadOrg();render();},'Positions updated.'),
 'remove-member':b=>act(async()=>{if(!await ask({title:`Remove ${nameOf(b.dataset.user)}?`,body:'They lose access and are taken off every schedule in this organization.',confirm:'Remove',danger:true}))return;await store.removeMember(state.org.id,b.dataset.user);await reloadOrg();render();}),
 copy:b=>navigator.clipboard.writeText(b.dataset.text).then(()=>toast('Invite link copied.','good'),()=>ask({title:'Invite link',fields:[{name:'l',label:'Copy this link',value:b.dataset.text}],confirm:'Done'})),
 'reset-code':()=>act(async()=>{if(!await ask({title:'Make a new invite code?',body:'The old code and link stop working. Current members stay.',confirm:'New code'}))return;await store.resetCode(state.org.id);await reloadOrg();render();},'New invite code ready.'),
 'delete-org':()=>act(async()=>{const v=await ask({title:'Delete organization?',body:`Type <b>${esc(state.org.name)}</b> to confirm. This cannot be undone.`,fields:[{name:'name',label:'Organization name',required:true}],confirm:'Delete forever',danger:true});
  if(!v)return;if(v.name.trim()!==state.org.name)throw Error('The name did not match.');await store.deleteOrg(state.org.id);state.org=null;await reloadOrgs();go('#/orgs');},'Organization deleted.'),
 'leave-org':b=>act(async()=>{const o=state.orgs.find(o=>o.id===b.dataset.id);if(!await ask({title:`Leave ${o.name}?`,body:'You are taken off its schedules. You can rejoin with an invite code.',confirm:'Leave',danger:true}))return;
  await store.removeMember(o.id,state.user.id);if(state.org?.id===o.id){state.org=null;state.data=null;}await reloadOrgs();go('#/orgs');}),
 'delete-blockout':b=>act(async()=>{await store.deleteBlockout(b.dataset.day);await reloadOrg();render();}),
 'answer-invite':b=>act(async()=>{const accept=Boolean(b.dataset.accept);const id=await store.answerInvitation(b.dataset.id,accept);
  if(accept){await reloadOrgs();go(`#/o/${id}/home`);}else{state.invitations=await store.myInvitations();render();}},b.dataset.accept?'Welcome to the team!':'Invitation declined.'),
 'invite-revoke':b=>act(async()=>{const i=state.data.invitations.find(i=>i.id===b.dataset.id);if(!await ask({title:`Cancel the invitation for ${i.email}?`,confirm:'Cancel invitation',danger:true}))return;
  await store.revokeInvitation(i.id);await reloadOrg();render();},'Invitation cancelled.'),
 'edit-team':b=>act(async()=>{const t=state.data.teams.find(t=>t.id===b.dataset.id);
  const v=await ask({title:'Edit department',fields:[{name:'name',label:'Department name',required:true,max:60,value:t.name},{name:'description',label:'Description',type:'textarea',max:300,value:t.description||''}]});if(!v)return;
  await store.updateTeam(t.id,{name:v.name.trim(),description:v.description.trim()});await reloadOrg();render();},'Department saved.'),
 'archive-team':b=>act(async()=>{const t=state.data.teams.find(t=>t.id===b.dataset.id),restore=Boolean(b.dataset.restore);
  if(!restore&&!await ask({title:`Archive ${t.name}?`,body:'It is hidden when you create new events. Past schedules and people stay as they are, and you can restore it any time.',confirm:'Archive'}))return;
  await store.updateTeam(t.id,{archived_at:restore?null:new Date().toISOString()});await reloadOrg();render();},b.dataset.restore?'Department restored.':'Department archived.'),
 'dept-members':b=>act(async()=>{
  const d=state.data,t=d.teams.find(t=>t.id===b.dataset.id),cur=new Map(d.departmentMembers.filter(x=>x.team_id===t.id).map(x=>[x.user_id,x.dept_role]));
  dialog.innerHTML=`<form method="dialog" class="dialog-body"><h2>${esc(t.name)}</h2><p class="muted">Leaders and coordinators can schedule this department's positions and see its draft events.</p>
   <ul class="list compact">${d.roster.map(m=>`<li class="row"><span class="grow">${esc(m.full_name||'Member')}</span><select name="${m.user_id}" aria-label="${esc(m.full_name)} in ${esc(t.name)}"><option value="">Not in department</option>${Object.entries(deptRoles).map(([k,l])=>`<option value="${k}" ${cur.get(m.user_id)===k?'selected':''}>${l}</option>`).join('')}</select></li>`).join('')}</ul>
   <div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></div></form>`;
  const picked=await new Promise(r=>{dialog.onclose=()=>r(dialog.returnValue==='ok'?Object.fromEntries(new FormData(dialog.querySelector('form'))):null);dialog.returnValue='';dialog.showModal();});
  if(!picked)return;
  for(const [user,role] of Object.entries(picked))if((cur.get(user)||'')!==role)await store.setDepartmentMember(state.org.id,t.id,user,role||null);
  await reloadOrg();render();},'Department updated.'),
 'edit-campus':b=>act(async()=>{const c=state.data.campuses.find(c=>c.id===b.dataset.id);
  const v=await ask({title:'Edit campus',fields:[{name:'name',label:'Name',required:true,max:80,value:c.name},{name:'address',label:'Address',type:'textarea',max:300,value:c.address||''}]});if(!v)return;
  await store.updateCampus(c.id,{name:v.name.trim(),address:v.address.trim()});await reloadOrg();render();},'Campus saved.'),
 'archive-campus':b=>act(async()=>{const c=state.data.campuses.find(c=>c.id===b.dataset.id);await store.updateCampus(c.id,{archived_at:c.archived_at?null:new Date().toISOString()});await reloadOrg();render();}),
 'new-role':()=>editRole(null),
 'edit-role':b=>editRole(state.data.roles.find(r=>r.key===b.dataset.key)),
 'delete-role':b=>act(async()=>{const r=state.data.roles.find(r=>r.key===b.dataset.key);if(!await ask({title:`Delete the ${r.name} role?`,body:'Move everyone in this role to another role first.',confirm:'Delete role',danger:true}))return;
  await store.deleteRole(state.org.id,r.key);await reloadOrg();render();},'Role deleted.'),
 'org-status':b=>act(async()=>{const suspend=b.dataset.status==='suspended';
  if(suspend&&!await ask({title:'Suspend this organization?',body:'Its members can still sign in and view it, but nobody can make changes until you reactivate it.',confirm:'Suspend',danger:true}))return;
  await store.setOrgStatus(b.dataset.id,b.dataset.status);render();},b.dataset.status==='suspended'?'Organization suspended.':'Organization reactivated.'),
 'finish-setup':b=>act(async()=>{await store.updateOrg(state.org.id,{onboarded_at:new Date().toISOString()});await reloadOrgs();await reloadOrg();go(orgLink('home'));},b.dataset.skip?'Setup hidden. You can change everything in Settings.':'Setup complete.'),
 availability:b=>act(async()=>{await store.setAvailability(b.dataset.service,b.dataset.status);await reloadOrg();render();}),
 'toggle-availability':b=>act(async()=>{const e=state.data.events.find(e=>e.id===b.dataset.id);await store.updateEvent(e.id,{availability_open:!e.availability_open});await reloadOrg();render();},
  state.data?.events.find(e=>e.id===b.dataset.id)?.availability_open?'Stopped asking for availability.':'Asked for availability. Everyone trained for a needed position has been told.'),
 'take-spot':b=>act(async()=>{await store.takeReplacement(b.dataset.id);await reloadOrg();render();},'The spot is yours. You are confirmed.'),
 'ask-replacement':b=>act(async()=>{const v=await ask({title:'Find a replacement',body:'Everyone trained for this spot and free that day is told, along with your schedulers. You stay scheduled until someone takes it.',fields:[{name:'note',label:'Note (optional)',max:200,value:''}],confirm:'Ask for cover'});
  if(!v)return;await store.requestReplacement(b.dataset.id,v.note||'');await reloadOrg();render();},'Request sent.'),
 'withdraw-replacement':b=>act(async()=>{await store.cancelReplacement(b.dataset.id);await reloadOrg();render();},'Request withdrawn. You are still scheduled.'),
 'event-status':b=>act(async()=>{const st=b.dataset.status,e=state.data.events.find(e=>e.id===b.dataset.id);
  if(st==='cancelled'&&!await ask({title:`Cancel ${e.title}?`,body:'Everyone scheduled is told in MediaHub. The event, its plan and roster are kept so you can reopen it.',confirm:'Cancel event',danger:true}))return;
  await store.updateEvent(e.id,{status:st});await reloadOrg();render();},b.dataset.status==='cancelled'?'Event cancelled. Your team has been told.':b.dataset.status==='completed'?'Marked completed.':'Reopened as a draft.'),
 'save-type':b=>act(async()=>{const d=state.data,e=d.events.find(e=>e.id===b.dataset.id);
  const v=await ask({title:'Save as service type',body:'Keeps the services, start times and people needed. People and the plan are not copied.',fields:[{name:'name',label:'Name',required:true,max:80,value:e.title},{name:'weekday',label:'Happens every',type:'select',value:String(new Date(`${e.event_date}T12:00:00`).getDay()),options:[['','No set day'],...weekdays.map((w,i)=>[String(i),w])]},{name:'ask',label:'Ask for availability on new events',type:'select',value:e.availability_open?'1':'',options:[['1','Yes'],['','No']]}],confirm:'Save'});
  if(!v)return;await store.addServiceType(state.org.id,{name:v.name.trim(),weekday:v.weekday===''?null:Number(v.weekday),ask_availability:Boolean(v.ask),campus_id:e.campus_id||null,notes:e.notes,
   services:d.services.filter(s=>s.event_id===e.id).sort(byOrder).map(s=>({name:s.name,starts_at:s.starts_at?.slice(0,5)||null})),needs:d.needs.filter(n=>n.event_id===e.id).map(n=>({position_id:n.position_id,quantity:n.quantity}))});
  await reloadOrg();render();},'Service type saved. Schedule weeks from Events.'),
 'type-schedule':b=>act(async()=>{const t=state.data.serviceTypes.find(t=>t.id===b.dataset.id);
  if(t.weekday==null)throw Error('Choose the day of the week this service happens first (Edit).');
  const v=await ask({title:`Schedule ${t.name}`,body:`Creates a draft event every ${weekdays[t.weekday]}${t.ask_availability?' and asks the team for availability':''}. Dates that already have one are skipped.`,fields:[{name:'from',label:'Starting from',type:'date',required:true,value:today()},{name:'weeks',label:'Number of weeks',type:'number',min:1,max:26,required:true,value:4}],confirm:'Create events'});
  if(!v)return;const n=await store.createFromType(t.id,v.from,Number(v.weeks));await reloadOrg();render();toast(n?`Created ${n} draft event${n===1?'':'s'}.`:'Those weeks already have events.','good');}),
 'type-edit':b=>act(async()=>{const d=state.data,t=d.serviceTypes.find(t=>t.id===b.dataset.id);
  const v=await ask({title:'Edit service type',fields:[{name:'name',label:'Name',required:true,max:80,value:t.name},{name:'weekday',label:'Happens every',type:'select',value:t.weekday==null?'':String(t.weekday),options:[['','No set day'],...weekdays.map((w,i)=>[String(i),w])]},
   {name:'ask',label:'Ask for availability on new events',type:'select',value:t.ask_availability?'1':'',options:[['1','Yes'],['','No']]},
   ...(d.campuses.length?[{name:'campus_id',label:'Campus',type:'select',value:t.campus_id||'',options:[['','No specific campus'],...d.campuses.filter(c=>!c.archived_at||c.id===t.campus_id).map(c=>[c.id,c.name])]}]:[])]});
  if(!v)return;await store.updateServiceType(t.id,{name:v.name.trim(),weekday:v.weekday===''?null:Number(v.weekday),ask_availability:Boolean(v.ask),...(d.campuses.length?{campus_id:v.campus_id||null}:{})});await reloadOrg();render();},'Service type saved.'),
 'type-delete':b=>act(async()=>{const t=state.data.serviceTypes.find(t=>t.id===b.dataset.id);if(!await ask({title:`Delete ${t.name}?`,body:'Events already created from it are kept.',confirm:'Delete',danger:true}))return;
  await store.deleteServiceType(t.id);await reloadOrg();render();},'Service type deleted.'),
 'mark-read':()=>act(async()=>{await store.markRead(null);await loadNotifications();render();}),
 'open-notification':b=>act(async()=>{const n=state.notifications.find(n=>n.id===b.dataset.id);if(!n.read_at)await store.markRead([n.id]);await loadNotifications();
  if(n.event_id&&state.orgs.some(o=>o.id===n.org_id))go(`#/o/${n.org_id}/event/${n.event_id}`);else render();}),
 theme:b=>{setTheme(b.dataset.theme);render();},
 'sign-out':()=>act(async()=>{await store.signOut();if(!live)location.reload();})
};
// Role editor: only permissions you hold can be granted (the database checks this too).
const editRole=r=>act(async()=>{
 const mine=state.data.perms;
 dialog.innerHTML=`<form method="dialog" class="dialog-body"><h2>${r?`Edit ${esc(r.name)}`:'New role'}</h2>
  <label class="field"><span>Role name</span><input name="name" required maxlength="40" value="${esc(r?.name||'')}"></label>
  <fieldset class="checks single"><legend>What people in this role can do</legend>${permissionList.map(([k,l])=>`<label><input type="checkbox" name="p" value="${k}" ${r?.permissions.includes(k)?'checked':''} ${mine.includes(k)?'':'disabled'}> ${esc(l)}</label>`).join('')}</fieldset>
  <p class="muted">Everyone can see published events and respond to their own schedule.</p>
  <div class="dialog-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save role</button></div></form>`;
 const v=await new Promise(res=>{dialog.onclose=()=>{if(dialog.returnValue!=='ok')return res(null);const fd=new FormData(dialog.querySelector('form'));res({name:fd.get('name').trim(),permissions:fd.getAll('p')});};dialog.returnValue='';dialog.showModal();});
 if(!v||!v.name)return;
 const key=r?.key||`${v.name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^[^a-z]+|_+$/g,'').slice(0,20)||'role'}_${Math.random().toString(36).slice(2,6)}`;
 await store.saveRole(state.org.id,key,v.name,v.permissions);await reloadOrg();render();},'Role saved.');
const addWeek=d=>{const x=new Date(`${d}T12:00:00`);x.setDate(x.getDate()+7);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};

const forms={
 signin:f=>act(async()=>{await store.signIn(f.email.value.trim(),f.password.value);await afterSignIn();}),
 signup:f=>act(async()=>{const r=await store.signUp({name:f.name.value.trim(),email:f.email.value.trim(),password:f.password.value});
  if(r.confirm){state.authTab='signin';render();toast('Check your email to confirm your account, then sign in.','good');}else await afterSignIn();}),
 reset:f=>act(async()=>{await store.resetPassword(f.email.value.trim());state.authTab='signin';render();},'If that email has an account, a reset link is on its way.'),
 'new-password':f=>act(async()=>{await store.setPassword(f.password.value);state.recovery=false;await afterSignIn();},'Password updated.'),
 'create-org':f=>act(async()=>{const id=await store.createOrg(f.name.value.trim(),f.preset.value);await reloadOrgs();clearJoin();go(`#/o/${id}/setup`);},'Organization created. Let’s set it up.'),
 'join-org':f=>act(async()=>{const id=await store.joinOrg(f.code.value.trim());await reloadOrgs();clearJoin();go(`#/o/${id}/home`);},'Welcome to the team!'),
 'new-event':f=>act(async()=>{const n=state.newEvent;
  const needs=Object.entries(n.needs).map(([position_id,quantity])=>({position_id,quantity}));
  if(!needs.length&&!await ask({title:'No people needed yet?',body:'You can still create the event and set positions later in Setup.',confirm:'Create anyway'}))return;
  const id=await store.createEvent(state.org.id,{title:n.title.trim(),event_date:n.event_date,notes:n.notes.trim(),campus_id:n.campus_id||null,service_type_id:n.service_type_id||null,services:n.services.map(s=>({name:s.name.trim()||'Service',starts_at:s.starts_at||null})),needs});
  state.newEvent=null;await reloadOrg();go(orgLink(`event/${id}`));},'Event created. Now schedule your people.'),
 'event-details':f=>act(async()=>{await store.updateEvent(f.dataset.event,{title:f.title.value.trim(),event_date:f.event_date.value,notes:f.notes.value.trim(),...(f.campus_id?{campus_id:f.campus_id.value||null}:{})});await reloadOrg();render();},'Details saved.'),
 'add-item':f=>act(async()=>{const ev=f.dataset.event,n=state.data.items.filter(i=>i.event_id===ev).length;
  await store.addItem(state.org.id,ev,{title:f.title.value.trim(),kind:f.kind.value,duration_minutes:f.kind.value==='header'?0:Number(f.duration_minutes.value)||0,sort_order:n+1});await reloadOrg();await render();app.querySelector('[data-form="add-item"] input')?.focus();}),
 'add-position':f=>act(async()=>{const t=f.dataset.team;await store.addPosition(state.org.id,t,f.name.value.trim(),state.data.positions.filter(p=>p.team_id===t).length+1);await reloadOrg();render();}),
 'org-profile':f=>act(async()=>{const v=Object.fromEntries(['name','time_zone','website','contact_email','contact_phone','address'].map(k=>[k,f[k].value.trim()]));
  await store.updateOrg(state.org.id,v);await reloadOrgs();await reloadOrg();if(f.dataset.next)go(f.dataset.next);else render();},'Church profile saved.'),
 invite:f=>act(async()=>{const email=f.email.value.trim();await store.invite(state.org.id,email,f.role.value);await reloadOrg();await render();
  toast(`Invitation ready. Ask ${email} to sign in to MediaHub with that email to accept it.`,'good');}),
 'add-campus':f=>act(async()=>{await store.addCampus(state.org.id,{name:f.name.value.trim(),address:f.address.value.trim(),sort_order:state.data.campuses.length+1});await reloadOrg();render();},'Campus added.'),
 transfer:f=>act(async()=>{const name=nameOf(f.user.value);if(!await ask({title:`Make ${name} the owner?`,body:'You become a Church admin. Only the new owner can transfer ownership again or delete the organization.',confirm:'Transfer ownership',danger:true}))return;
  await store.transferOwnership(state.org.id,f.user.value);await reloadOrgs();await reloadOrg();go(orgLink('home'));},'Ownership transferred.'),
 profile:f=>act(async()=>{await store.updateProfile(f.name.value,f.phone.value);state.profile=await store.profile();if(state.org)await reloadOrg();render();},'Profile saved.'),
 blockout:f=>act(async()=>{await store.addBlockout(f.day.value,f.reason.value.trim());await reloadOrg();render();},'Blockout date added.')
};
function clearJoin(){if(new URLSearchParams(location.search).has('join'))history.replaceState(null,'',location.pathname+location.hash);}

const changes={
 'switch-org':s=>s.value==='__new'?go('#/orgs'):go(`#/o/${s.value}/home`),
 'act-as':s=>act(async()=>{store.actAs(s.value);await afterSignIn(true);}),
 'from-type':s=>{const t=state.data.serviceTypes.find(t=>t.id===s.value),n=state.newEvent;
  if(!t){n.service_type_id=null;return render();}
  Object.assign(n,{service_type_id:t.id,title:t.name,campus_id:t.campus_id||n.campus_id,notes:t.notes||n.notes,services:t.services.length?t.services.map(x=>({name:x.name,starts_at:x.starts_at||''})):n.services,
   needs:Object.fromEntries(t.needs.filter(x=>state.data.positions.some(p=>p.id===x.position_id)).map(x=>[x.position_id,x.quantity]))});
  if(t.weekday!=null){const d=new Date(`${today()}T12:00:00`);d.setDate(d.getDate()+(t.weekday-d.getDay()+7)%7);n.event_date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  render();},
 role:s=>act(async()=>{await store.setRole(state.org.id,s.dataset.user,s.value);await reloadOrg();render();},'Role updated.'),
 assign:s=>{
  const id=s.dataset.service,list=(state.drafts[id]||state.data.assignments.filter(a=>a.service_id===id)).map(a=>({...a}));
  const pos=s.dataset.position,slot=Number(s.dataset.slot),rest=list.filter(a=>!(a.position_id===pos&&a.slot===slot));
  state.drafts[id]=s.value?[...rest,{position_id:pos,slot,user_id:s.value}]:rest;render();
 }
};

app.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&handlers[b.dataset.action]){e.preventDefault();handlers[b.dataset.action](b);}});
app.addEventListener('submit',e=>{const f=e.target.closest('[data-form]');if(f&&forms[f.dataset.form]){e.preventDefault();forms[f.dataset.form](f);}});
app.addEventListener('change',e=>{const s=e.target.closest('[data-change]');if(s&&changes[s.dataset.change])changes[s.dataset.change](s);});
// New-event form keeps its values in state so steppers can re-render without losing typing.
app.addEventListener('input',e=>{const n=state.newEvent,t=e.target;if(!n)return;if(t.dataset.draft)n[t.dataset.draft]=t.value;if(t.dataset.svc)n.services[t.dataset.svc][t.dataset.key]=t.value;});
window.addEventListener('hashchange',()=>{
 if(Object.keys(state.drafts).length&&!location.hash.includes('/event/')){if(!confirm('Leave without saving schedule changes?'))return history.back();state.drafts={};}
 render();
});
window.addEventListener('beforeunload',e=>{if(Object.keys(state.drafts).length)e.preventDefault();});

async function afterSignIn(keepRoute=false){
 state.user=await store.user();if(!state.user)return render();
 const current=state.org?.id;
 state.profile=await store.profile();state.orgs=await store.orgs();await loadNotifications();
 try{state.platformAdmin=await store.isPlatformAdmin();}catch{state.platformAdmin=false;}
 Object.assign(state,{org:null,data:null,drafts:{},newEvent:null});
 const join=new URLSearchParams(location.search).get('join');
 if(join)return go('#/orgs');
 if(keepRoute)return go(current&&state.orgs.some(o=>o.id===current)?`#/o/${current}/home`:'#/');
 if(/^#\/(o\/|profile)/.test(location.hash))return render();
 go('#/');
}

async function start(){
 app.innerHTML=skeleton();
 if(live&&new URLSearchParams(location.hash.slice(1)).get('type')==='recovery')state.recovery=true;
 try{await store.init();}catch(e){app.innerHTML=`<div class="solo">${empty('Could not connect',esc(errorText(e)))}</div>`;return;}
 store.onAuth((event,user)=>{if(event==='PASSWORD_RECOVERY'){state.recovery=true;render();}else if(event==='SIGNED_OUT'){Object.assign(state,{user:null,org:null,data:null,orgs:[],drafts:{}});history.replaceState(null,'',location.pathname);render();}});
 if(state.recovery){history.replaceState(null,'',location.pathname);state.user=await store.user();return render();}
 await afterSignIn();
}
start();
