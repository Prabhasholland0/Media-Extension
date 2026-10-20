export const services = [{id:'first',name:'1st Service'},{id:'second',name:'2nd Service'},{id:'hindi',name:'Hindi Service'},{id:'telugu',name:'Telugu Service'}];
export const campuses=[{id:'kompally',name:'Kompally'},{id:'eden_square',name:'Eden Square'}];
export const servicesFor=campus=>campus==='eden_square'?[{id:'eden_english',name:'English'},{id:'eden_hindi',name:'Hindi'}]:services;
export function positionsFor(count=8){if(!Number.isInteger(count)||count<0||count>16)throw Error('Choose between 0 and 16 cameras.');return ['producer','ccu',...Array.from({length:count},(_,i)=>`cam_${i+1}`)];}
export const positions=positionsFor();
export const roleFor = p => p.startsWith('cam_') ? 'camera' : p;
export const positionName = p => p==='producer'?'Producer':p==='ccu'?'CCU':`Cam ${p.split('_')[1]}`;
export const statusFor = (rows,user,date,service) => rows.find(r=>r.user_id===user&&r.service_date===date&&r.service_id===service)?.status ?? 'not_submitted';
export function candidates(members,rows,date,service,position) { return members.filter(m=>m.active&&m.skills.includes(roleFor(position))&&statusFor(rows,m.id,date,service)==='available'); }
export function validate(assignments,members,rows,date,service,complete=true,cameraCount=8){
  const positions=positionsFor(cameraCount);
  const errors=Object.keys(assignments).filter(p=>!positions.includes(p)).map(p=>`${positionName(p)} is outside the selected camera count.`),used=new Map();
  for(const p of positions){const id=assignments[p];if(id==='not_needed'){if(!p.startsWith('cam_'))errors.push(positionName(p)+' cannot be marked Standby.');continue;}if(!id){if(complete)errors.push(`${positionName(p)} needs a team member.`);continue;}
    if(!candidates(members,rows,date,service,p).some(m=>m.id===id))errors.push(`${positionName(p)}: member is unavailable, inactive, or missing the required skill.`);
    if(used.has(id))errors.push(`${positionName(p)}: member is already assigned to ${positionName(used.get(id))}.`);used.set(id,p);
  } return errors;
}
export function autoAssign(members,rows,date,service,existing={},cameraCount=8){
  const positions=positionsFor(cameraCount);
  const result={...existing}, occupied=new Map(Object.entries(result).filter(([,id])=>id&&id!=='not_needed').map(([p,id])=>[id,p]));
  const fixed=new Set(Object.keys(result).filter(p=>result[p]));
  function match(p,seen){for(const m of candidates(members,rows,date,service,p)){if(seen.has(m.id))continue;seen.add(m.id);const prior=occupied.get(m.id);if(!prior||(!fixed.has(prior)&&match(prior,seen))){occupied.set(m.id,p);result[p]=m.id;return true;}}return false;}
  for(const p of positions.filter(p=>!fixed.has(p)).sort((a,b)=>candidates(members,rows,date,service,a).length-candidates(members,rows,date,service,b).length))match(p,new Set());
  return result;
}
export function nextSunday(){const d=new Date();d.setDate(d.getDate()+(7-d.getDay())%7);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function sampleData(date){const names=['Prabhas','Sherlyn','Steen','Caleb','Meghana','Arpan','Piyush','Natasha','Emmanuel','Sidhu','Sam','Avinash','Justin','Austin','Avinash G','Jairus'];
 const members=names.map((full_name,i)=>({id:`demo-${i}`,full_name,email:`${full_name.toLowerCase().replaceAll(' ','.')}@example.com`,phone:'',avatar_url:'',active:true,is_admin:i===0,skills:['camera',...([5,6,7,8].includes(i)?['producer']:[]),...([3,9,10].includes(i)?['ccu']:[])]}));
 const rows=members.flatMap((m,i)=>i===15?[]:services.map((s,j)=>({user_id:m.id,service_date:date,service_id:s.id,status:(i+j)%7===4?'not_available':'available'})));
 return {members,rows};
}
