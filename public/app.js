const labels = { disabled: 'ปิดไว้จนกว่าจะตั้งค่า provider', configured_pending_validation: 'ตั้งค่าแล้ว — ต้องทดสอบ Ollama ในเครื่อง', curated_reference: 'ราคาอ้างอิง curated — ไม่ใช่ราคาตลาดสด', simulation_only: 'จำลองเท่านั้น — ไม่มีการโอนเงินจริง' };
const statusLabels = { DRAFT:'ฉบับร่าง', READY_TO_PUBLISH:'พร้อมเผยแพร่', WAITING_FOR_SELECTION:'รอเลือกราคา/ช่าง', WAITING_FOR_APPOINTMENT:'รอนัดหมาย', SCHEDULED:'นัดหมายแล้ว', IN_PROGRESS:'กำลังดำเนินงาน', WAITING_FOR_CUSTOMER_CONFIRMATION:'รอลูกค้ายืนยันงาน', COMPLETED:'เสร็จสิ้น', DISPUTED:'อยู่ระหว่างข้อพิพาท', NO_PROVIDER_FOUND:'ยังไม่พบช่าง', POSTED:'กำลังจับคู่', MATCHED:'จับคู่แล้ว', ASSIGNED:'มอบหมายแล้ว', CANCELLED:'ยกเลิก' };
const roleLabels = { CUSTOMER_GENERAL:'ลูกค้าทั่วไป', CUSTOMER_BUSINESS:'ลูกค้าบริษัท', TECHNICIAN:'ช่าง/ทีมช่าง', ADMIN:'ผู้ดูแลระบบ' };
const categoryLabels = { HARDWARE:'อุปกรณ์/Hardware', SOFTWARE:'โปรแกรม/Software' };
const formatLabels = { ONSITE:'เข้าพื้นที่', ONLINE:'ออนไลน์', PICKUP:'รับเข้าศูนย์' };
let districtLabels = {};
let currentUser;
const $ = (selector) => document.querySelector(selector);
function message(text, bad=false) { const node=$('#workspace-message'); node.textContent=text; node.classList.toggle('error',bad); }
const appDialog=$('#app-dialog');
function closeDialog(value=null){appDialog.returnValue=value===null?'':JSON.stringify(value);appDialog.close();}
$('#dialog-form').addEventListener('submit',(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget).entries());closeDialog(values);});
appDialog.querySelector('[data-dialog-close]').addEventListener('click',()=>closeDialog(null));
function openDialog({title,description='',content='',fields=[],actions=true,confirmLabel='บันทึก',cancelLabel='ยกเลิก'}){
  $('#dialog-title').textContent=title;$('#dialog-description').textContent=description;$('#dialog-body').innerHTML=content;
  if(fields.length){$('#dialog-body').innerHTML=`${content}<div class="dialog-fields">${fields.map((field)=>{const id=`field-${field.name}`;const safeName=escapeHtml(field.name);let control='';if(field.options){control=`<select id="${id}" name="${safeName}" ${field.required?'required':''}>${field.options.map((option)=>`<option value="${escapeHtml(option.value)}" ${String(option.value)===String(field.value)?'selected':''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;}else if(field.type==='textarea'){control=`<textarea id="${id}" name="${safeName}" maxlength="${field.maxlength??2000}" ${field.required?'required':''}>${escapeHtml(field.value??'')}</textarea>`;}else{control=`<input id="${id}" name="${safeName}" type="${field.type??'text'}" value="${escapeHtml(field.value??'')}" ${field.required?'required':''} ${field.min!==undefined?`min="${field.min}"`:''} ${field.max!==undefined?`max="${field.max}"`:''}>`;}return `<label for="${id}">${escapeHtml(field.label)}${control}</label>`;}).join('')}</div>`;}
  $('#dialog-actions').innerHTML=actions?`<button class="button button-secondary" type="button" data-dialog-cancel>${cancelLabel}</button><button class="button button-primary" type="submit">${confirmLabel}</button>`:'';
  $('#dialog-actions').querySelector('[data-dialog-cancel]')?.addEventListener('click',()=>closeDialog(null));
  appDialog.showModal();if(fields.length)appDialog.querySelector('input,select,textarea')?.focus();
  return new Promise((resolve)=>appDialog.addEventListener('close',()=>{let result=null;try{result=appDialog.returnValue?JSON.parse(appDialog.returnValue):null;}catch{}resolve(result);},{once:true}));
}
async function askConfirm(title,description,confirmLabel='ยืนยัน'){return Boolean(await openDialog({title,description:'ตรวจสอบข้อมูลก่อนดำเนินการ',content:escapeHtml(description).replaceAll('\n','<br>'),confirmLabel}));}
async function askChoice(title,description,choices){const content=`<div class="choice-list">${choices.map((choice,index)=>`<button class="choice-option" type="button" data-choice="${index}"><strong>${escapeHtml(choice.label)}</strong><span>${escapeHtml(choice.detail??'')}</span></button>`).join('')}</div>`;const resultPromise=openDialog({title,description,content,actions:false});$('#dialog-body').querySelectorAll('[data-choice]').forEach((button)=>button.addEventListener('click',()=>closeDialog({choice:Number(button.dataset.choice)})));return resultPromise.then((result)=>result?choices[result.choice]:null);}
function localDateTimeValue(date=new Date(Date.now()+86400000)){const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);}
async function api(path, options={}) {
  const headers={Accept:'application/json',...(options.headers??{})};
  let body=options.body;
  if(body!==undefined && !(body instanceof Blob)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const response=await fetch(path,{...options,headers,body});
  if(response.status===204)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error?.message??`คำขอไม่สำเร็จ (${response.status})`);error.code=data.error?.code;throw error;}
  return data.data??data;
}
async function loadStatus(){
  const ids={'ai-status':'aiIntegration','market-status':'marketPriceIntegration','payment-status':'payment'};
  try{const status=await api('/api/demo/status');for(const [id,key] of Object.entries(ids))document.getElementById(id).textContent=labels[status[key]]??'ยังไม่พร้อมใช้งาน';}
  catch{for(const id of Object.keys(ids))document.getElementById(id).textContent='ตรวจสอบสถานะไม่ได้';}
}
async function loadCatalog(){const catalog=await api('/api/catalog');districtLabels=Object.fromEntries(catalog.districts.map((district)=>[district.code,district.name]));$('#district-select').innerHTML=catalog.districts.map((d)=>`<option value="${escapeHtml(d.code)}">${escapeHtml(d.name)}</option>`).join('');}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function button(label,action,id){return `<button class="button button-small" data-action="${escapeHtml(action)}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;}
async function refresh(){
  const jobs=await api('/api/jobs');
  $('#job-list').innerHTML=jobs.length?jobs.map((j)=>`<article class="job-card"><div><span class="job-status">${escapeHtml(statusLabels[j.status]??j.status)}</span><h3>${escapeHtml(categoryLabels[j.category]??j.category)} · ${escapeHtml(formatLabels[j.service_format]??j.service_format)}</h3><p>${escapeHtml(j.symptom_text)}</p><small>${escapeHtml(districtLabels[j.district_code]??j.district_code)}${j.agreed_amount?` · ${Number(j.agreed_amount).toLocaleString('th-TH')} บาท`:''}</small></div><div class="job-actions">${jobActions(j)}</div></article>`).join(''):'<p class="empty-state">ยังไม่มีงานในบัญชีนี้</p>';
  if(currentUser.role==='ADMIN'){
    const disputes=await api('/api/admin/disputes?status=OPEN');
    const claims=await api('/api/admin/warranty-claims');
    $('#admin-list').hidden=false;
    $('#admin-list').innerHTML=`<h3>ข้อพิพาทที่ต้องตรวจสอบ</h3>`+(disputes.length?disputes.map((d)=>`<article class="job-card"><div><h3>งาน ${escapeHtml(d.job_id)}</h3><p>${escapeHtml(d.reason)}</p></div><div class="job-actions">${button('คงผลว่างานเสร็จ','resolve',d.id)}</div></article>`).join(''):'<p class="empty-state">ไม่มีข้อพิพาทค้าง</p>')+`<h3>คำขอใช้สิทธิ์รับประกัน</h3>`+(claims.filter((c)=>['OPEN','UNDER_REVIEW'].includes(c.status)).map((c)=>`<article class="job-card"><div><h3>งาน ${escapeHtml(c.job_id)}</h3><p>${escapeHtml(c.reason)}</p></div><div class="job-actions">${button('อนุมัติคำขอ','claim-resolve',c.id)}</div></article>`).join('')||'<p class="empty-state">ไม่มีคำขอค้าง</p>');
  }
}
function jobActions(job){
  if(currentUser.role==='ADMIN')return '<span class="empty-action">จัดการจากคิวผู้ดูแล</span>';
  const actions=[];
  if(job.status==='DRAFT'){actions.push(button('ดำเนินการวิเคราะห์/ประเมิน','prepare',job.id));if(currentUser.role!=='TECHNICIAN'&&currentUser.role!=='ADMIN')actions.push(button('ถาม AI เพิ่มเติม','ai-chat',job.id));}
  if(job.status==='READY_TO_PUBLISH')actions.push(button('เผยแพร่และจับคู่','publish',job.id));
  if(job.status==='WAITING_FOR_SELECTION')actions.push(button('ดูและเลือกข้อเสนอ','offers',job.id));
  if(job.status==='WAITING_FOR_APPOINTMENT')actions.push(button('เสนอเวลานัด','appointment',job.id),button('ยืนยันเวลาที่อีกฝ่ายเสนอ','confirm-appt',job.id),button('เลื่อนนัด','reschedule-appt',job.id),button('ยกเลิกนัด','cancel-appt',job.id));
  if(job.status==='SCHEDULED')actions.push(button(currentUser.role==='TECHNICIAN'?'เริ่มงาน':'ดูงาน','start',job.id),button('เลื่อนนัด','reschedule-appt',job.id),button('ยกเลิกนัด','cancel-appt',job.id));
  if(job.status==='IN_PROGRESS'&&currentUser.role==='TECHNICIAN')actions.push(button('ส่งงานให้ลูกค้ายืนยัน','submit',job.id));
  if(job.status==='WAITING_FOR_CUSTOMER_CONFIRMATION'&&currentUser.role==='TECHNICIAN')actions.push(button('เสนอเงื่อนไขรับประกัน','warranty',job.id));
  if(job.status==='WAITING_FOR_CUSTOMER_CONFIRMATION'&&currentUser.role!=='TECHNICIAN')actions.push(button('ตรวจรับและยืนยันงาน','complete',job.id));
  if(job.status==='COMPLETED'&&currentUser.role!=='TECHNICIAN')actions.push(button('จำลองชำระเงิน','pay',job.id),button('รีวิวช่าง','review',job.id),button('ขอใช้สิทธิ์รับประกัน','claim',job.id),button('แจ้งข้อพิพาท','dispute',job.id));
  if(job.status==='COMPLETED'&&currentUser.role==='TECHNICIAN')actions.push(button('ยืนยันรับเงินตรง','confirm-direct',job.id));
  if((job.has_provider||job.assigned_provider_id)&& !['CANCELLED','DRAFT'].includes(job.status))actions.push(button('เปิดแชตงาน','chat',job.id));
  return actions.join('')||'<span class="empty-action">ไม่มีรายการที่ต้องทำ</span>';
}
async function prepareJob(id){
  let analysis;
  let analysisLabel='AI';
  try{analysis=await api(`/api/jobs/${id}/analyze`,{method:'POST',body:{}});message(`AI สรุป: ${analysis.summary}`);}
  catch(error){
    const draft=await api(`/api/jobs/${id}`);
    const symptomSummary=draft.symptom_text?.trim();
    if(!symptomSummary)throw new Error(`AI ยังไม่พร้อม (${error.message}) และไม่มีคำอธิบายอาการให้ใช้แทน`);
    if(!await askConfirm('AI ยังไม่พร้อมใช้งาน',`ใช้คำอธิบายอาการที่กรอกเป็นสรุปงานแทนได้หรือไม่?\n\n${error.message}\n\nระบบจะระบุชัดเจนว่านี่ไม่ใช่ผลวิเคราะห์จาก AI`,'ใช้คำอธิบายที่กรอก'))return;
    await api(`/api/jobs/${id}/manual-summary`,{method:'POST',body:{summary:symptomSummary}});
    analysisLabel='ใช้คำอธิบายอาการที่กรอก (ไม่ใช่ AI)';
  }
  try{
    const estimate=await api(`/api/jobs/${id}/price-estimates`,{method:'POST',body:{}});
    const reviewedDate=estimate.reviewedAt?new Date(estimate.reviewedAt).toLocaleDateString('th-TH'):'ไม่ระบุ';
    const validUntil=estimate.referenceValidUntil?new Date(estimate.referenceValidUntil).toLocaleDateString('th-TH'):null;
    const referenceDisclosure=estimate.referenceType==='CURATED_PUBLIC_EXAMPLES'
      ?`\n\nราคาอ้างอิงตัวอย่าง — ไม่ใช่ราคาตลาดสดหรือราคาเฉพาะอาการ\nวันที่ตรวจทบทวน: ${reviewedDate} · ใช้ประกอบการประเมินได้ถึง: ${validUntil}\n${estimate.referenceNotes??''}\nแหล่งข้อมูล: ${estimate.sourceReference}`:'';
    const summaryDisclosure=analysisLabel==='AI'?'AI สรุปอาการแล้ว':analysisLabel;
    const accepted=await askConfirm(currentUser.role==='CUSTOMER_BUSINESS'?'ตรวจสอบช่วงราคาก่อนเผยแพร่':'ตรวจสอบราคาโดยประมาณ',`${summaryDisclosure}\n${currentUser.role==='CUSTOMER_BUSINESS'?`ช่วงราคาเบื้องต้น ${estimate.min}–${estimate.max} บาท — ยังไม่ใช่ราคาสุดท้าย ทีมช่างจะส่งข้อเสนอให้เลือก`:`ราคาโดยประมาณ ${estimate.min} บาท จาก ${estimate.source}`}\n\n${referenceDisclosure}`,'ยืนยันและดำเนินการ');
    if(!accepted)return;
    await api(`/api/jobs/${id}/confirm-summary`,{method:'POST',body:{}});
    await api(`/api/jobs/${id}/price-estimates/${estimate.estimateId}/accept`,{method:'POST',body:{}});
    const referenceNote=estimate.referenceType==='CURATED_PUBLIC_EXAMPLES'?` ราคาอ้างอิงตัวอย่าง (ไม่ใช่ราคาตลาดสด/ราคาเฉพาะอาการ); ตรวจทบทวน ${reviewedDate} และใช้ได้ถึง ${validUntil}${estimate.referenceNotes?` (${estimate.referenceNotes})`:''}; แหล่งข้อมูล: ${estimate.sourceReference}.`:'';
    message((currentUser.role==='CUSTOMER_BUSINESS'?`ช่วงราคาคร่าว ๆ ${estimate.min}–${estimate.max} บาท — ขั้นถัดไปเผยแพร่เพื่อรับข้อเสนอทีมช่าง`: `ยอมรับราคาประเมิน ${estimate.min} บาทแล้ว`)+referenceNote);
  }catch(error){
    const detail=/เก่าเกินกำหนด|หมดอายุ|ทบทวนแหล่งข้อมูล/.test(error.message)
      ?`${error.message} สำหรับ Demo ทีมพัฒนาต้องตรวจแหล่งอ้างอิงและอัปเดต reviewedAt ใน curated catalog ก่อนประเมินใหม่ (ไม่มีข้อมูลราคาตลาดสด)`
      :error.message;
    message(`ยังประเมินราคาไม่ได้: ${detail}`,true);
  }
  await refresh();
}
$('#login-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const data=await api('/api/auth/login',{method:'POST',body:{email:form.get('email'),password:form.get('password')}});await showDashboard(data.user);}catch(error){message(error.message,true);}});
async function showDashboard(user){currentUser=user;$('#job-list').replaceChildren();$('#admin-list').replaceChildren();$('#admin-list').hidden=true;$('#login-form').hidden=true;$('#dashboard').hidden=false;$('#user-label').textContent=`${user.displayName} · ${roleLabels[user.role]}`;$('#job-form').hidden=!user.role.startsWith('CUSTOMER_');$('#job-form').querySelectorAll('.company-field').forEach((el)=>el.hidden=user.role!=='CUSTOMER_BUSINESS');syncServiceFormat();await loadCatalog();await refresh();}
$('#logout-button').addEventListener('click',async()=>{await api('/api/auth/logout',{method:'POST'});currentUser=null;$('#dashboard').hidden=true;$('#job-list').replaceChildren();$('#admin-list').replaceChildren();$('#admin-list').hidden=true;$('#login-form').hidden=false;message('ออกจากระบบแล้ว');});
$('#notification-button').addEventListener('click',async()=>{try{const notifications=await api('/api/notifications');const content=notifications.length?notifications.map((n)=>`<div class="notification-item"><strong>${n.read_at?'':'● '}${escapeHtml(n.title)}</strong><div>${escapeHtml(n.body)}</div></div>`).join(''):'<p>ยังไม่มีการแจ้งเตือน</p>';await openDialog({title:'การแจ้งเตือน',description:'รายการอัปเดตเกี่ยวกับงานของคุณ',content,actions:false});for(const n of notifications.filter((item)=>!item.read_at))await api(`/api/notifications/${n.id}/read`,{method:'POST',body:{}});}catch(error){message(error.message,true);}});
$('#job-form').addEventListener('submit',async(event)=>{
  event.preventDefault();
  const formElement=event.currentTarget;
  const submitButton=formElement.querySelector('[type="submit"]');
  const form=new FormData(formElement);
  let job;
  submitButton.disabled=true;
  submitButton.textContent='กำลังบันทึกงาน…';
  try{
    const selectedFiles=form.getAll('attachments').filter((file)=>file.size);
    if(selectedFiles.length>3)throw new Error('แนบรูปได้สูงสุด 3 ภาพ กรุณาเลือกไฟล์ใหม่');
    const files=selectedFiles;
    if(files.some((file)=>!['image/jpeg','image/png','image/webp'].includes(file.type)))throw new Error('รองรับเฉพาะภาพ JPG, PNG และ WebP');
    if(files.some((file)=>file.size>10*1024*1024))throw new Error('ภาพแต่ละไฟล์ต้องไม่เกิน 10 MiB');
    const consent=await askConfirm('การใช้ข้อมูลเพื่อวิเคราะห์',`หากยินยอม ระบบจะส่งอาการและรูปที่เลือก (สูงสุด 3 ภาพ) ไปยัง AI เพื่อช่วยสรุปปัญหา หากไม่ยินยอม รูปจะไม่ถูกอัปโหลด และยังเลือกใช้คำอธิบายอาการที่กรอกเป็นสรุปงานแทนได้\n\nรูปที่เลือก: ${files.length}`,'ยินยอมและดำเนินการ');
    job=await api('/api/jobs',{method:'POST',body:{category:form.get('category'),serviceFormat:form.get('serviceFormat'),districtCode:form.get('districtCode'),symptom:form.get('symptom'),manufacturer:form.get('manufacturer')||undefined,model:form.get('model')||undefined,preferredTimeNote:form.get('preferredTimeNote')||undefined}});
    const attachmentIds=[];
    if(consent){
      for(const file of files){
        const uploaded=await fetch(`/api/jobs/${job.jobId}/attachments`,{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':file.name},body:file});
        if(!uploaded.ok)throw new Error((await uploaded.json()).error?.message??'อัปโหลดภาพไม่สำเร็จ');
        attachmentIds.push((await uploaded.json()).data.attachmentId);
      }
      await api(`/api/jobs/${job.jobId}/ai-consents`,{method:'POST',body:{dataScope:{symptom:true,attachmentIds}}});
    }
    formElement.reset();
    syncServiceFormat();
    message('บันทึกงานฉบับร่างแล้ว');
    await refresh();
    try{await prepareJob(job.jobId);}catch(error){message(`บันทึก Draft แล้ว แต่ทำขั้นวิเคราะห์ต่อไม่ได้: ${error.message}`,true);await refresh();}
  }catch(error){
    if(job){formElement.reset();syncServiceFormat();message(`บันทึก Draft แล้ว แต่ทำรายการต่อไม่สำเร็จ: ${error.message}`,true);await refresh().catch(()=>{});}
    else message(error.message,true);
  }finally{submitButton.disabled=false;submitButton.textContent='สร้างฉบับร่างและวิเคราะห์';}
});
$('#job-list').addEventListener('click',async(event)=>{const b=event.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;try{
  if(b.dataset.action==='prepare')await prepareJob(id);
  if(b.dataset.action==='ai-chat'){const history=await api(`/api/jobs/${id}/ai-chat`);const transcript=history.map((item)=>`<div class="notification-item"><strong>คุณ:</strong> ${escapeHtml(item.question)}<br><strong>AI:</strong> ${escapeHtml(item.answer)}</div>`).join('');const form=await openDialog({title:'พูดคุยกับ AI',description:'คำแนะนำเป็นข้อมูลเบื้องต้น โปรดตรวจสอบก่อนนำไปใช้',content:transcript,fields:[{name:'question',label:'พิมพ์คำถามเกี่ยวกับอาการ',type:'textarea',required:true,maxlength:2000}],confirmLabel:'ส่งคำถาม'});if(form?.question?.trim()){const answer=await api(`/api/jobs/${id}/ai-chat`,{method:'POST',body:{question:form.question.trim()}});await openDialog({title:'คำแนะนำเบื้องต้นจาก AI',description:'คำตอบอาจไม่ถูกต้องครบถ้วน ให้ช่างตรวจสอบก่อนดำเนินการ',content:escapeHtml(answer.answer),actions:false});}}
  if(b.dataset.action==='publish'){const result=await api(`/api/jobs/${id}/publish`,{method:'POST',body:{}});message(result.status==='WAITING_FOR_SELECTION'?'ส่งข้อเสนอให้ลูกค้าบริษัทเลือกแล้ว':`จับคู่แล้ว: ${result.provider?.label??result.status}`);await refresh();}
  if(b.dataset.action==='offers'){const offers=await api(`/api/jobs/${id}/offers`);if(!offers.length){message('ยังไม่มีข้อเสนอจากช่าง');return;}const offer=await askChoice('ข้อเสนอจากทีมช่าง','เปรียบเทียบรายละเอียดก่อนเลือกข้อเสนอ',offers.map((o)=>({label:`${o.providerLabel} — ${o.amount} บาท`,detail:o.scopeSummary,offer:o})));if(offer){await api(`/api/jobs/${id}/offers/${offer.offer.id}/select`,{method:'POST',body:{}});message('เลือกข้อเสนอแล้ว');await refresh();}}
  if(b.dataset.action==='appointment'){const form=await openDialog({title:'เสนอวันและเวลานัด',description:'ระบบจะส่งช่วงเวลานี้ให้อีกฝ่ายยืนยัน',fields:[{name:'when',label:'วันและเวลา',type:'datetime-local',value:localDateTimeValue(),required:true}],confirmLabel:'ส่งเวลานัด'});if(form?.when){const startsAt=new Date(form.when);await api(`/api/jobs/${id}/appointments`,{method:'POST',body:{startsAt:startsAt.toISOString(),endsAt:new Date(startsAt.getTime()+3600000).toISOString()}});message('ส่งข้อเสนอเวลานัดแล้ว');await refresh();}}
  if(b.dataset.action==='cancel-appt'||b.dataset.action==='reschedule-appt'){const appointments=await api(`/api/jobs/${id}/appointments`);const active=appointments.filter((a)=>['PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED'].includes(a.status));if(!active.length)throw new Error('ไม่พบนัดหมายที่ยังดำเนินการได้');const target=active[0];if(b.dataset.action==='cancel-appt'){const form=await openDialog({title:'ยกเลิกนัดหมาย',description:'แจ้งเหตุผลเพื่อให้อีกฝ่ายเข้าใจและวางแผนใหม่',fields:[{name:'reason',label:'เหตุผล',type:'textarea',required:true}],confirmLabel:'ยืนยันยกเลิก'});if(form?.reason){await api(`/api/appointments/${target.id}/cancel`,{method:'POST',body:{reason:form.reason}});message('ยกเลิกนัดแล้ว');await refresh();}}else{const form=await openDialog({title:'ขอเลื่อนนัดหมาย',description:'เลือกวันเวลาใหม่และบอกเหตุผล',fields:[{name:'when',label:'วันและเวลาใหม่',type:'datetime-local',value:localDateTimeValue(),required:true},{name:'reason',label:'เหตุผล',type:'textarea',required:true}],confirmLabel:'ส่งคำขอเลื่อน'});if(form?.when&&form.reason){const startsAt=new Date(form.when);await api(`/api/appointments/${target.id}/reschedule`,{method:'POST',body:{startsAt:startsAt.toISOString(),endsAt:new Date(startsAt.getTime()+3600000).toISOString(),reason:form.reason}});message('ส่งข้อเสนอเวลาใหม่แล้ว');await refresh();}}}
  if(b.dataset.action==='confirm-appt'){const appointments=await api(`/api/jobs/${id}/appointments`);const proposed=appointments.find((a)=>a.status==='PROPOSED');if(!proposed)throw new Error('ยังไม่มีช่วงเวลารอการยืนยัน');await api(`/api/appointments/${proposed.id}/confirm`,{method:'POST',body:{}});message('ยืนยันช่วงเวลานัดแล้ว');await refresh();}
  if(b.dataset.action==='start'){if(currentUser.role==='TECHNICIAN'){await api(`/api/jobs/${id}/start`,{method:'POST',body:{}});message('เริ่มงานแล้ว');await refresh();}}
  if(b.dataset.action==='submit'){const form=await openDialog({title:'ส่งงานให้ลูกค้าตรวจรับ',description:'สรุปสิ่งที่ดำเนินการและสิ่งที่ควรทราบ',fields:[{name:'note',label:'รายละเอียดการส่งงาน',type:'textarea',value:'ดำเนินการเสร็จแล้ว',required:true}],confirmLabel:'ส่งงาน'});if(!form)return;await api(`/api/jobs/${id}/submit-completion`,{method:'POST',body:{note:form.note}});message('ส่งงานให้ลูกค้ายืนยันแล้ว — ช่างต้องเสนอเงื่อนไขรับประกันก่อน');await refresh();}
  if(b.dataset.action==='warranty'){const form=await openDialog({title:'เสนอเงื่อนไขรับประกัน',description:'ระบุขอบเขตที่ชัดเจนเพื่อให้ลูกค้าตัดสินใจก่อนตรวจรับ',fields:[{name:'offered',label:'การรับประกัน',options:[{value:'yes',label:'มีการรับประกัน'},{value:'no',label:'ไม่มีการรับประกัน'}],value:'yes'},{name:'durationDays',label:'ระยะเวลา (วัน)',options:[{value:7,label:'7 วัน'},{value:14,label:'14 วัน'},{value:30,label:'30 วัน'}],value:14},{name:'scope',label:'ขอบเขตการรับประกัน',type:'textarea',value:'อาการเดิมจากงานซ่อมนี้'},{name:'exclusions',label:'ข้อยกเว้น',type:'textarea',value:'ความเสียหายจากอุบัติเหตุ'}],confirmLabel:'ส่งเงื่อนไข'});if(!form)return;const offered=form.offered==='yes';await api(`/api/jobs/${id}/warranty-terms`,{method:'POST',body:offered?{offered,durationDays:Number(form.durationDays),scope:form.scope,exclusions:form.exclusions}:{offered}});message('ส่งเงื่อนไขให้ลูกค้าพิจารณาแล้ว');await refresh();}
  if(b.dataset.action==='complete'){const messages=await api(`/api/jobs/${id}/messages`);const offer=[...messages].reverse().find((m)=>m.type==='WARRANTY_TERMS');if(!offer)throw new Error('รอช่างเสนอเงื่อนไขรับประกันก่อน');const details=offer.terms;if(!await askConfirm('ยืนยันรับงาน',details.offered?`รับประกัน ${details.durationDays} วัน\nขอบเขต: ${details.scope}\nข้อยกเว้น: ${details.exclusions||'ไม่มี'}\n\nยืนยันรับงานและเงื่อนไขนี้หรือไม่?`:'ช่างเสนอไม่มีการรับประกัน ยืนยันรับงานหรือไม่?','ยืนยันรับงาน'))return;await api(`/api/jobs/${id}/warranty-terms/accept`,{method:'POST',body:{offerId:details.messageId}});await api(`/api/jobs/${id}/confirm-completion`,{method:'POST',body:{}});message('ยืนยันงานเสร็จแล้ว');await refresh();}
  if(b.dataset.action==='pay'){let method='PLATFORM_SIMULATED';if(currentUser.role!=='CUSTOMER_BUSINESS'){const choice=await askChoice('บันทึกการชำระเงินจำลอง','ระบบนี้ไม่ตรวจสอบธุรกรรมเงินจริง เลือกวิธีที่ตกลงกับช่าง', [{label:'ผ่านระบบ Fixtech (จำลอง)',detail:'บันทึกสถานะจำลองในแพลตฟอร์ม'},{label:'ชำระกับช่างโดยตรง',detail:'ช่างยืนยันการรับเงินตามที่ตกลง; Fixtech ไม่ตรวจสอบยอดจริง'}]);if(!choice)return;method=choice===undefined?'PLATFORM_SIMULATED':(choice.label.startsWith('ชำระกับ')?'DIRECT':'PLATFORM_SIMULATED');}const payment=await api(`/api/jobs/${id}/payment-simulations`,{method:'POST',body:{method,idempotencyKey:`${id}-${method}`}});if(method==='PLATFORM_SIMULATED'){await api(`/api/payment-simulations/${payment.id}/confirm-platform`,{method:'POST',body:{}});message('บันทึกการชำระแบบจำลองแล้ว — ไม่มีการโอนเงินจริง');}else message('บันทึกการตกลงชำระตรงแล้ว ให้ช่างเข้าสู่ระบบและยืนยันการรับเงิน');await refresh();}
  if(b.dataset.action==='confirm-direct'){const payments=await api(`/api/jobs/${id}/payment-simulations`);const payment=payments.find((p)=>p.method==='DIRECT'&&p.status==='PENDING');if(!payment)throw new Error('ไม่พบรายการชำระตรงที่รอยืนยัน');await api(`/api/payment-simulations/${payment.id}/confirm-direct-received`,{method:'POST',body:{}});message('ยืนยันการรับเงินตรงแล้ว');await refresh();}
  if(b.dataset.action==='chat'){const entries=await api(`/api/jobs/${id}/messages`);const recent=entries.filter((m)=>m.type==='TEXT').slice(-12).map((m)=>`<div class="notification-item"><strong>${escapeHtml(m.senderRole===currentUser.role?'คุณ':roleLabels[m.senderRole]??'สมาชิก')}:</strong> ${escapeHtml(m.body)}</div>`).join('');const form=await openDialog({title:'ข้อความในงานนี้',description:'แชตสำหรับประสานงานระหว่างลูกค้าและช่าง',content:recent||'<p>เริ่มต้นการสนทนาได้ที่นี่</p>',fields:[{name:'body',label:'ข้อความใหม่',type:'textarea',required:true,maxlength:2000}],confirmLabel:'ส่งข้อความ'});if(form?.body?.trim()){await api(`/api/jobs/${id}/messages`,{method:'POST',body:{body:form.body.trim()}});message('ส่งข้อความแล้ว');}}
  if(b.dataset.action==='review'){const form=await openDialog({title:'รีวิวงานซ่อม',description:'ความคิดเห็นช่วยให้ติดตามคุณภาพการให้บริการใน Demo',fields:[{name:'rating',label:'คะแนน',options:[1,2,3,4,5].map((n)=>({value:n,label:`${n} ดาว`})),value:5},{name:'comment',label:'ความคิดเห็น (ไม่บังคับ)',type:'textarea'}],confirmLabel:'ส่งรีวิว'});if(form){await api(`/api/jobs/${id}/reviews`,{method:'POST',body:{rating:Number(form.rating),comment:form.comment||undefined}});message('บันทึกรีวิวแล้ว');}}
  if(b.dataset.action==='claim'){const form=await openDialog({title:'ขอใช้สิทธิ์รับประกัน',description:'อธิบายอาการที่กลับมาเกิดภายในเงื่อนไขรับประกัน',fields:[{name:'reason',label:'รายละเอียดปัญหา',type:'textarea',required:true}],confirmLabel:'ส่งคำขอ'});if(form?.reason){await api(`/api/jobs/${id}/warranty-claims`,{method:'POST',body:{reason:form.reason}});message('ส่งคำขอใช้สิทธิ์รับประกันแล้ว');}}
  if(b.dataset.action==='dispute'){const types=[['SERVICE_QUALITY','คุณภาพงานซ่อม'],['PRICE_OR_SCOPE','ราคา/ขอบเขตงาน'],['PAYMENT','การชำระเงิน'],['WARRANTY','การรับประกัน'],['CANCELLATION','การยกเลิก'],['OTHER','อื่น ๆ']];const detail=await api(`/api/jobs/${id}`);const files=detail.attachments??[];const fields=[{name:'type',label:'ประเภทปัญหา',options:types.map(([value,label])=>({value,label})),value:'SERVICE_QUALITY'},{name:'reason',label:'อธิบายปัญหา',type:'textarea',required:true}];if(files.length)fields.push({name:'attachmentIndex',label:'ภาพหลักฐาน (ไม่บังคับ)',options:[{value:'',label:'ไม่แนบภาพ'},...files.map((file,index)=>({value:index,label:file.original_filename}))],value:''});const form=await openDialog({title:'เปิดข้อพิพาท',description:'ทีมดูแลจะใช้รายละเอียดนี้ประกอบการตรวจสอบ ข้อมูลนี้เป็น Demo',fields,confirmLabel:'ส่งข้อพิพาท'});if(form?.reason){const attachmentIds=form.attachmentIndex!==undefined&&form.attachmentIndex!==''?[files[Number(form.attachmentIndex)].id]:[];await api(`/api/jobs/${id}/disputes`,{method:'POST',body:{type:form.type,reason:form.reason,attachmentIds}});message('เปิดข้อพิพาทแล้ว');await refresh();}}
}catch(error){if(error.code==='JOB_CHANGED')await refresh().catch(()=>{});message(error.message,true);}});
$('#admin-list').addEventListener('click',async(event)=>{const b=event.target.closest('[data-action="resolve"]');if(!b)return;try{const form=await openDialog({title:'พิจารณาข้อพิพาท',description:'เลือกผลการดำเนินการและบันทึกเหตุผลเพื่อเก็บเป็นหลักฐาน',fields:[{name:'outcome',label:'ผลการพิจารณา',options:[{value:'KEEP_COMPLETED',label:'คงสถานะงานว่าเสร็จแล้ว'},{value:'RETURN_TO_CUSTOMER',label:'ส่งกลับให้ลูกค้าตรวจรับต่อ'},{value:'CANCEL',label:'ยกเลิกงาน (ใช้ได้เฉพาะก่อนเสร็จ)'}]},{name:'resolution',label:'บันทึกผล/เหตุผล',type:'textarea',value:'ตรวจสอบและบันทึกผลในระบบสาธิต',required:true}],confirmLabel:'บันทึกผล'});if(!form)return;await api(`/api/admin/disputes/${b.dataset.id}/resolve`,{method:'POST',body:form});message('บันทึกผลการพิจารณาแล้ว');await refresh();}catch(error){message(error.message,true);}});
$('#admin-list').addEventListener('click',async(event)=>{const b=event.target.closest('[data-action="claim-resolve"]');if(!b)return;try{const form=await openDialog({title:'พิจารณาคำขอรับประกัน',description:'บันทึกผลการตรวจสอบคำขอ',fields:[{name:'status',label:'ผลคำขอ',options:[{value:'RESOLVED',label:'อนุมัติ/ดำเนินการแล้ว'},{value:'REJECTED',label:'ไม่อนุมัติ'}]},{name:'resolution',label:'รายละเอียดผลการพิจารณา',type:'textarea',value:'ตรวจสอบคำขอในระบบสาธิต',required:true}],confirmLabel:'บันทึกผล'});if(!form)return;await api(`/api/admin/warranty-claims/${b.dataset.id}/resolve`,{method:'POST',body:form});message('บันทึกผลคำขอรับประกันแล้ว');await refresh();}catch(error){message(error.message,true);}});
async function restoreSession(){try{const me=await api('/api/auth/me');await showDashboard(me.user);}catch{}}
loadStatus();restoreSession().catch(()=>{});
function syncServiceFormat(){const category=$('#job-form [name="category"]').value;const format=$('#job-form [name="serviceFormat"]');const allowed=category==='SOFTWARE'?'ONLINE':'ONSITE';for(const option of format.options)option.disabled=option.value!==allowed;if(format.value!==allowed)format.value=allowed;}
$('#job-form [name="category"]').addEventListener('change',syncServiceFormat);
syncServiceFormat();
