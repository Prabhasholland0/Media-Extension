import {db} from './api.js';
export function mountAlerts(user){
 if(!user||!db)return;
 const host=document.querySelector('.top-right');if(!host)return;
 const button=document.createElement('button');button.className='btn notification-bell';button.setAttribute('aria-label','Assignment notifications');button.innerHTML='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span></span>';host.prepend(button);
 let rows=[];
 const load=async()=>{const result=await db.from('assignment_notifications').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);if(!button.isConnected)return;if(result.error){button.title='Unable to load notifications';return;}rows=result.data;const count=rows.filter(r=>!r.read_at).length;button.querySelector('span').textContent=count||'';button.setAttribute('aria-label',`Assignment notifications, ${count} unread`);};
 load();const timer=setInterval(()=>{if(!button.isConnected){clearInterval(timer);return;}if(!document.hidden)load();},30000);
 button.onclick=async()=>{await load();const dialog=document.createElement('dialog');dialog.className='assignment-alert-dialog';const heading=document.createElement('h2');heading.textContent='Your assignments';dialog.append(heading);const close=document.createElement('button');close.className='btn';close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(close);
 const names={first:'1st Service',second:'2nd Service',hindi:'Hindi Service',telugu:'Telugu Service',eden_english:'English Service',eden_hindi:'Hindi Service'};
 if(!rows.length){const p=document.createElement('p');p.textContent='No assignment notifications yet.';dialog.append(p);}
 rows.forEach(row=>{const p=document.createElement('p');p.className='assignment-alert-item';const role=row.position==='producer'?'Producer':row.position==='ccu'?'CCU':row.position.replace('cam_','Camera ');p.textContent=`Hi ${user.full_name}, you’re assigned to ${role} for ${names[row.service_id]||row.service_id} at ${row.service_id.startsWith('eden_')?'Eden Square':'Kompally'} on ${row.service_date}.`;dialog.append(p);});
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();const ids=rows.filter(r=>!r.read_at).map(r=>r.id);if(ids.length){await db.from('assignment_notifications').update({read_at:new Date().toISOString()}).in('id',ids);load();}
 };
}
