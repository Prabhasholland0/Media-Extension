// Pure planning rules shared by the app and tests. No browser or database access.
export const presets=[
 {id:'media',name:'Media team',hint:'Video, audio and lighting positions'},
 {id:'church',name:'Church services',hint:'Media, worship and hospitality teams'},
 {id:'blank',name:'Start empty',hint:'Add your own teams and positions'}
];
export const itemKinds={header:'Section',item:'Item',song:'Song',media:'Media',message:'Message'};

const byOrder=(a,b)=>(a.sort_order??0)-(b.sort_order??0)||String(a.name).localeCompare(String(b.name));

// Every open seat of an event, in team and position order: [{team,position,slot}].
export function slotsFor(needs,positions,teams){
 const teamOrder=new Map([...teams].sort(byOrder).map((t,i)=>[t.id,i]));
 const posById=new Map(positions.map(p=>[p.id,p]));
 return needs.map(n=>({need:n,position:posById.get(n.position_id)})).filter(x=>x.position)
  .sort((a,b)=>(teamOrder.get(a.position.team_id)??99)-(teamOrder.get(b.position.team_id)??99)||byOrder(a.position,b.position))
  .flatMap(({need,position})=>Array.from({length:need.quantity},(_,i)=>({team:teams.find(t=>t.id===position.team_id),position,slot:i+1})));
}
export const slotKey=(positionId,slot)=>`${positionId}:${slot}`;
export const needsTotal=needs=>needs.reduce((sum,n)=>sum+n.quantity,0);

export function fillSummary(slots,assignments){
 const keys=new Set(slots.map(s=>slotKey(s.position.id,s.slot)));
 const inSlots=assignments.filter(a=>keys.has(slotKey(a.position_id,a.slot)));
 return {total:slots.length,filled:inSlots.length,open:slots.length-inSlots.length,
  accepted:inSlots.filter(a=>a.status==='accepted').length,pending:inSlots.filter(a=>a.status==='pending').length,declined:inSlots.filter(a=>a.status==='declined').length};
}

export const isBlocked=(blockouts,userId,day)=>blockouts.some(b=>b.user_id===userId&&b.day===day);
export const qualified=(memberPositions,userId,positionId)=>memberPositions.some(m=>m.user_id===userId&&m.position_id===positionId);

// Fills open seats of one service, keeping every existing choice.
// Candidates must hold the position, be free that day, not have said they are unavailable for this service,
// and not already serve in the service. People who said they are available come first, then fewer assignments; scarce positions are filled first, and
// an augmenting search moves earlier automatic picks when that frees a seat for someone.
export function autoFill({slots,roster,memberPositions,blockouts,day,current,load={},availability={}}){
 const result=new Map(current.map(a=>[slotKey(a.position_id,a.slot),a.user_id]));
 const fixed=new Set(result.keys());
 const seatOf=new Map([...result].map(([k,u])=>[u,k]));
 const candidatesFor=s=>roster.map(m=>m.user_id)
  .filter(u=>qualified(memberPositions,u,s.position.id)&&!isBlocked(blockouts,u,day)&&availability[u]!=='not_available')
  .sort((a,b)=>(availability[b]==='available')-(availability[a]==='available')||(load[a]||0)-(load[b]||0));
 const open=slots.filter(s=>!fixed.has(slotKey(s.position.id,s.slot)))
  .map(s=>({key:slotKey(s.position.id,s.slot),candidates:candidatesFor(s)}))
  .sort((a,b)=>a.candidates.length-b.candidates.length);
 const openByKey=new Map(open.map(o=>[o.key,o]));
 function place(seat,seen){
  for(const u of seat.candidates){
   if(seen.has(u))continue;seen.add(u);
   const prior=seatOf.get(u);
   if(!prior||(!fixed.has(prior)&&place(openByKey.get(prior),seen))){seatOf.set(u,seat.key);result.set(seat.key,u);return true;}
  }
  return false;
 }
 for(const seat of open)place(seat,new Set());
 return [...result].map(([key,user_id])=>{const [position_id,slot]=key.split(':');return {position_id,slot:Number(slot),user_id};});
}

// Problems an admin should see before publishing; never blocks saving a draft.
export function warnings({slots,assignments,roster,memberPositions,blockouts,day,availability={}}){
 const names=new Map(roster.map(m=>[m.user_id,m.full_name||'A member']));
 const out=[];
 for(const a of assignments){
  const s=slots.find(s=>s.position.id===a.position_id&&s.slot===a.slot);if(!s)continue;
  const who=names.get(a.user_id)||'A former member';
  if(!qualified(memberPositions,a.user_id,a.position_id))out.push(`${who} is not set up for ${s.position.name}.`);
  if(isBlocked(blockouts,a.user_id,day))out.push(`${who} blocked out this date.`);
  if(availability[a.user_id]==='not_available')out.push(`${who} said they are not available for this service.`);
  if(a.status==='declined')out.push(`${who} declined ${s.position.name}.`);
 }
 return out;
}

// Clock time for each plan item, counted from the service start (HH:MM).
export function planTimes(items,start){
 if(!start)return items.map(()=>'');
 const [h,m]=start.split(':').map(Number);let t=h*60+m;
 return items.map(i=>{const at=t;t+=i.duration_minutes||0;return clock(at);});
}
export const clock=mins=>{const h=Math.floor(mins/60)%24,m=mins%60;return `${(h%12)||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;};
export const timeLabel=t=>t?clock(Number(t.slice(0,2))*60+Number(t.slice(3,5))):'';
export const planLength=items=>items.reduce((sum,i)=>sum+(i.duration_minutes||0),0);
export const duration=mins=>mins<60?`${mins} min`:`${Math.floor(mins/60)} hr${mins%60?` ${mins%60} min`:''}`;

// Default service names and times when someone asks for N services.
export function defaultServices(count){
 const times=['09:00','11:00','13:00','17:00','19:00','21:00'];
 return Array.from({length:count},(_,i)=>({name:count===1?'Service':`Service ${i+1}`,starts_at:times[i]||'09:00'}));
}
export function today(){const d=new Date();return iso(d);}
export function nextSunday(){const d=new Date();d.setDate(d.getDate()+(7-d.getDay())%7);return iso(d);}
export function addDays(day,n){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);return iso(d);}
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// Permission keys checked by the database (006_tenant_core.sql). Labels are what admins see.
export const permissionList=[
 ['org.manage','Edit church profile and settings'],
 ['members.manage','Invite people, change roles, remove members'],
 ['members.contact.read','See email addresses and phone numbers'],
 ['roles.manage','Create and edit roles'],
 ['campuses.manage','Manage campuses and locations'],
 ['departments.manage','Manage departments, positions and who can serve'],
 ['events.manage','Create and edit events, services and plans'],
 ['schedule.manage','Schedule people in every department'],
 ['audit.read','View the activity log']
];
export const allPermissions=permissionList.map(([k])=>k);
export const systemRoles=[
 {key:'owner',name:'Owner',permissions:allPermissions},
 {key:'admin',name:'Church admin',permissions:allPermissions},
 {key:'scheduler',name:'Scheduler',permissions:['members.contact.read','events.manage','schedule.manage']},
 {key:'member',name:'Member',permissions:[]}
];
export const deptRoles={leader:'Leader',coordinator:'Coordinator',member:'Member'};
export const timeZones=()=>{try{return Intl.supportedValuesOf('timeZone');}catch{return ['Asia/Kolkata','UTC'];}};
