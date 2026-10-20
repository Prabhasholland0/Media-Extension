import test from 'node:test';
import assert from 'node:assert/strict';
import {slotsFor,autoFill,fillSummary,warnings,planTimes,defaultServices} from '../platform/core.js';
const teams=[{id:'t1',name:'Video',sort_order:1}];
const positions=[{id:'cam',team_id:'t1',name:'Camera',sort_order:2},{id:'prod',team_id:'t1',name:'Producer',sort_order:1}];
const roster=['a','b','c','d'].map(user_id=>({user_id,full_name:user_id.toUpperCase()}));
const mp=(u,p)=>({user_id:u,position_id:p});
test('slots follow team and position order with one seat per needed person',()=>{
 const slots=slotsFor([{position_id:'cam',quantity:2},{position_id:'prod',quantity:1}],positions,teams);
 assert.deepEqual(slots.map(s=>`${s.position.id}${s.slot}`),['prod1','cam1','cam2']);
});
test('auto-fill keeps choices, skips blockouts and fills scarce positions first',()=>{
 const slots=slotsFor([{position_id:'cam',quantity:2},{position_id:'prod',quantity:1}],positions,teams);
 // Only "a" can produce; a greedy camera-first fill would waste them.
 const memberPositions=[mp('a','prod'),mp('a','cam'),mp('b','cam'),mp('c','cam'),mp('d','cam')];
 const out=autoFill({slots,roster,memberPositions,blockouts:[{user_id:'b',day:'2026-11-01'}],day:'2026-11-01',current:[{position_id:'cam',slot:1,user_id:'d'}]});
 const at=(p,s)=>out.find(a=>a.position_id===p&&a.slot===s)?.user_id;
 assert.equal(at('prod',1),'a');assert.equal(at('cam',1),'d');assert.equal(at('cam',2),'c');
 assert.equal(new Set(out.map(a=>a.user_id)).size,out.length,'nobody twice in a service');
});
test('auto-fill prefers people with fewer upcoming assignments',()=>{
 const slots=slotsFor([{position_id:'cam',quantity:1}],positions,teams);
 const out=autoFill({slots,roster,memberPositions:[mp('a','cam'),mp('b','cam')],blockouts:[],day:'x',current:[],load:{a:3,b:1}});
 assert.equal(out[0].user_id,'b');
});
test('summary, warnings and plan times',()=>{
 const slots=slotsFor([{position_id:'cam',quantity:2}],positions,teams);
 const assignments=[{position_id:'cam',slot:1,user_id:'a',status:'declined'},{position_id:'cam',slot:2,user_id:'b',status:'accepted'}];
 assert.deepEqual(fillSummary(slots,assignments),{total:2,filled:2,open:0,accepted:1,pending:0,declined:1});
 const w=warnings({slots,assignments,roster,memberPositions:[mp('b','cam')],blockouts:[{user_id:'b',day:'d'}],day:'d'});
 assert.deepEqual(w,['A is not set up for Camera.','A declined Camera.','B blocked out this date.']);
 assert.deepEqual(planTimes([{duration_minutes:5},{duration_minutes:50},{duration_minutes:0}],'11:30'),['11:30 AM','11:35 AM','12:25 PM']);
 assert.equal(defaultServices(3).length,3);
});
test('auto-fill puts people who said available first and never picks people who said not available',()=>{
 const slots=slotsFor([{position_id:'cam',quantity:2}],positions,teams);
 const memberPositions=['a','b','c'].map(u=>mp(u,'cam'));
 const out=autoFill({slots,roster,memberPositions,blockouts:[],day:'x',current:[],load:{c:5},availability:{a:'not_available',c:'available'}});
 assert.deepEqual(out.map(a=>a.user_id).sort(),['b','c'],'c first despite more load; a skipped');
 const w=warnings({slots,assignments:[{position_id:'cam',slot:1,user_id:'a',status:'pending'}],roster,memberPositions,blockouts:[],day:'x',availability:{a:'not_available'}});
 assert.match(w.join(),/A said they are not available/);
});
