// Fixtech Demo v1.8 - Fastwork Marketplace & Escrow Model
const labels = {
  disabled: 'ปิดไว้จนกว่าจะตั้งค่า provider',
  configured_pending_validation: 'ตั้งค่าแล้ว — ต้องทดสอบ Ollama ในเครื่อง',
  curated_reference: 'ราคาอ้างอิง curated — ไม่ใช่ราคาตลาดสด',
  simulation_only: 'จำลองเท่านั้น — ไม่มีการโอนเงินจริง'
};

const statusLabels = {
  DRAFT: 'ฉบับร่าง',
  READY_TO_PUBLISH: 'พร้อมเผยแพร่',
  POSTED: 'กำลังหาช่าง',
  WAITING_FOR_SELECTION: 'รอเลือกช่าง',
  MATCHED: 'จับคู่แล้ว',
  WAITING_FOR_APPOINTMENT: 'รอนัดหมาย',
  SCHEDULED: 'นัดหมายแล้ว',
  IN_PROGRESS: 'กำลังดำเนินงาน',
  WAITING_FOR_CUSTOMER_CONFIRMATION: 'รอลูกค้าตรวจรับงาน',
  COMPLETED: 'เสร็จสิ้น',
  PENDING_PAYOUT: 'รอโอนเงินให้ช่าง',
  DISPUTED: 'อยู่ระหว่างข้อพิพาท',
  CANCELLED: 'ยกเลิก'
};

const roleLabels = {
  CUSTOMER_GENERAL: 'ลูกค้าทั่วไป',
  CUSTOMER_BUSINESS: 'ลูกค้าบริษัท',
  TECHNICIAN: 'ช่าง/ทีมช่าง',
  ADMIN: 'ผู้ดูแลระบบ'
};

const deviceLabels = {
  DESKTOP: '🖥️ คอมตั้งโต๊ะ (Desktop PC)',
  NOTEBOOK: '💻 โน้ตบุ๊ก (Notebook / Laptop)'
};

let districtLabels = {};
let currentUser = null;
let currentMode = 'CUSTOMER'; // 'CUSTOMER' or 'TECHNICIAN'
let currentActiveView = 'home';
let activeJobId = null;
let activeChatJobId = null;
let aiChatMessages = [];
let latestAiDraftCard = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function message(text, bad = false) {
  const node = $('#workspace-message');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', bad);
  if (text) {
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => { if (node.textContent === text) node.textContent = ''; }, 6000);
  }
}

// Modal Dialog Helpers
const appDialog = $('#app-dialog');
function closeDialog(value = null) {
  appDialog.returnValue = value === null ? '' : JSON.stringify(value);
  appDialog.close();
}

$('#dialog-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  closeDialog(values);
});

appDialog?.querySelector('[data-dialog-close]')?.addEventListener('click', () => closeDialog(null));

function openDialog({ title, description = '', content = '', fields = [], actions = true, confirmLabel = 'บันทึก', cancelLabel = 'ยกเลิก' }) {
  $('#dialog-title').textContent = title;
  $('#dialog-description').textContent = description;
  $('#dialog-body').innerHTML = content;

  if (fields.length) {
    $('#dialog-body').innerHTML = `${content}<div class="dialog-fields">${fields.map((field) => {
      const id = `field-${field.name}`;
      const safeName = escapeHtml(field.name);
      let control = '';
      if (field.options) {
        control = `<select id="${id}" name="${safeName}" ${field.required ? 'required' : ''}>${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
      } else if (field.type === 'textarea') {
        control = `<textarea id="${id}" name="${safeName}" rows="${field.rows || 3}" maxlength="${field.maxlength ?? 2000}" ${field.required ? 'required' : ''} placeholder="${escapeHtml(field.placeholder ?? '')}">${escapeHtml(field.value ?? '')}</textarea>`;
      } else {
        control = `<input id="${id}" name="${safeName}" type="${field.type ?? 'text'}" value="${escapeHtml(field.value ?? '')}" ${field.required ? 'required' : ''} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} placeholder="${escapeHtml(field.placeholder ?? '')}">`;
      }
      return `<label for="${id}">${escapeHtml(field.label)}${control}</label>`;
    }).join('')}</div>`;
  }

  $('#dialog-actions').innerHTML = actions ? `<button class="button button-secondary" type="button" data-dialog-cancel>${cancelLabel}</button><button class="button button-primary" type="submit">${confirmLabel}</button>` : '';
  $('#dialog-actions').querySelector('[data-dialog-cancel]')?.addEventListener('click', () => closeDialog(null));

  appDialog.showModal();
  if (fields.length) appDialog.querySelector('input,select,textarea')?.focus();

  return new Promise((resolve) => appDialog.addEventListener('close', () => {
    let result = null;
    try { result = appDialog.returnValue ? JSON.parse(appDialog.returnValue) : null; } catch { }
    resolve(result);
  }, { once: true }));
}

async function askConfirm(title, description, confirmLabel = 'ยืนยัน') {
  return Boolean(await openDialog({ title, description: 'โปรดตรวจสอบข้อมูลก่อนดำเนินการ', content: escapeHtml(description).replaceAll('\n', '<br>'), confirmLabel }));
}

async function askChoice(title, description, choices) {
  const content = `<div class="choice-list">${choices.map((choice, index) => `<button class="choice-option" type="button" data-choice="${index}"><strong>${escapeHtml(choice.label)}</strong><span>${escapeHtml(choice.detail ?? '')}</span></button>`).join('')}</div>`;
  const resultPromise = openDialog({ title, description, content, actions: false });
  $('#dialog-body').querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => closeDialog({ choice: Number(button.dataset.choice) })));
  return resultPromise.then((result) => result ? choices[result.choice] : null);
}

// API Fetch Helper
async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  let body = options.body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, headers, body });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message ?? `คำขอไม่สำเร็จ (${response.status})`);
    error.code = data.error?.code;
    throw error;
  }
  return data.data ?? data;
}

// Initialization & Catalogs
async function loadStatus() {
  const ids = { 'ai-status': 'aiIntegration', 'market-status': 'marketPriceIntegration', 'payment-status': 'payment' };
  try {
    const status = await api('/api/demo/status');
    for (const [id, key] of Object.entries(ids)) {
      const el = document.getElementById(id);
      if (el) el.textContent = labels[status[key]] ?? 'พร้อมใช้งาน';
    }
  } catch {
    for (const id of Object.keys(ids)) {
      const el = document.getElementById(id);
      if (el) el.textContent = 'ตรวจสอบสถานะไม่ได้';
    }
  }
}

async function loadCatalog() {
  try {
    const catalog = await api('/api/catalog');
    districtLabels = Object.fromEntries(catalog.districts.map((d) => [d.code, d.name]));
    const districtOptions = catalog.districts.map((d) => `<option value="${escapeHtml(d.code)}">${escapeHtml(d.name)}</option>`).join('');
    
    if ($('#self-district-select')) $('#self-district-select').innerHTML = districtOptions;
    if ($('#tech-filter-district')) $('#tech-filter-district').innerHTML = '<option value="">ทุกเขตพื้นที่</option>' + districtOptions;
  } catch (e) {
    console.error('Failed to load catalog:', e);
  }
}

async function loadAnnouncement() {
  try {
    const settings = await api('/api/admin/settings').catch(() => null);
    if (settings?.systemAnnouncement?.trim()) {
      $('#announcement-text').textContent = settings.systemAnnouncement;
      $('#system-announcement-banner').hidden = false;
    } else {
      $('#system-announcement-banner').hidden = true;
    }
  } catch { }
}

$('#announcement-close')?.addEventListener('click', () => {
  $('#system-announcement-banner').hidden = true;
});

// View Navigation & Switching
function showCustomerView(viewName) {
  currentActiveView = viewName;
  const views = ['customer-home-view', 'customer-self-fill-view', 'customer-ai-chat-view', 'customer-success-view', 'customer-my-posts-view', 'customer-job-detail-view', 'customer-chat-center-view'];
  views.forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.hidden = (id !== `customer-${viewName}-view`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showTechView(viewName) {
  currentActiveView = viewName;
  const views = ['tech-job-board-view', 'tech-financials-view'];
  views.forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.hidden = (id !== `tech-${viewName}-view`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchPortalMode(mode) {
  currentMode = mode;
  const customerPortal = $('#customer-portal');
  const techPortal = $('#tech-portal');
  const adminPortal = $('#admin-portal');
  const techMenu = $('#menu-tech-financials');

  if (currentUser?.role === 'ADMIN') {
    if (customerPortal) customerPortal.hidden = true;
    if (techPortal) techPortal.hidden = true;
    if (adminPortal) adminPortal.hidden = false;
    loadAdminOverview();
    return;
  }

  if (adminPortal) adminPortal.hidden = true;
  if (mode === 'TECHNICIAN') {
    if (customerPortal) customerPortal.hidden = true;
    if (techPortal) techPortal.hidden = false;
    if (techMenu) techMenu.hidden = false;
    $('#profile-mode-toggle').textContent = '🔄 สลับไปโหมดลูกค้า';
    showTechView('job-board');
    loadTechJobBoard();
  } else {
    if (customerPortal) customerPortal.hidden = false;
    if (techPortal) techPortal.hidden = true;
    if (techMenu) techMenu.hidden = currentUser?.role !== 'TECHNICIAN';
    $('#profile-mode-toggle').textContent = '🔄 สลับไปโหมดช่าง';
    showCustomerView('home');
  }
}

// Profile Menu & Topbar Actions
const profileDropdownMenu = $('#profile-dropdown-menu');
$('#nav-profile-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const hidden = profileDropdownMenu.hidden;
  profileDropdownMenu.hidden = !hidden;
  $('#nav-profile-btn').setAttribute('aria-expanded', String(!hidden));
});

document.addEventListener('click', (e) => {
  if (profileDropdownMenu && !profileDropdownMenu.contains(e.target) && !$('#nav-profile-btn')?.contains(e.target)) {
    profileDropdownMenu.hidden = true;
    $('#nav-profile-btn')?.setAttribute('aria-expanded', 'false');
  }
});

$('#profile-mode-toggle')?.addEventListener('click', () => {
  profileDropdownMenu.hidden = true;
  switchPortalMode(currentMode === 'CUSTOMER' ? 'TECHNICIAN' : 'CUSTOMER');
});

$('#menu-my-posts')?.addEventListener('click', (e) => {
  e.preventDefault();
  profileDropdownMenu.hidden = true;
  if (currentMode !== 'CUSTOMER') switchPortalMode('CUSTOMER');
  showCustomerView('my-posts');
  loadCustomerPosts();
});

$('#menu-chat-center')?.addEventListener('click', (e) => {
  e.preventDefault();
  profileDropdownMenu.hidden = true;
  if (currentMode !== 'CUSTOMER') switchPortalMode('CUSTOMER');
  showCustomerView('chat-center');
  loadChatCenter();
});

$('#nav-chat-btn')?.addEventListener('click', () => {
  if (currentMode !== 'CUSTOMER') switchPortalMode('CUSTOMER');
  showCustomerView('chat-center');
  loadChatCenter();
});

$('#menu-tech-financials')?.addEventListener('click', (e) => {
  e.preventDefault();
  profileDropdownMenu.hidden = true;
  if (currentMode !== 'TECHNICIAN') switchPortalMode('TECHNICIAN');
  showTechView('financials');
  loadTechFinancials();
});

$('#menu-account-settings')?.addEventListener('click', (e) => {
  e.preventDefault();
  profileDropdownMenu.hidden = true;
  openAccountSettingsModal();
});

$('#menu-logout')?.addEventListener('click', async () => {
  profileDropdownMenu.hidden = true;
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  applyAuthState(null);
  message('ออกจากระบบเรียบร้อยแล้ว');
});

$('#admin-logout-btn')?.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  applyAuthState(null);
  message('ออกจากระบบแอดมินแล้ว');
});

// Back Buttons
$$('.btn-back-home').forEach((btn) => btn.addEventListener('click', () => showCustomerView('home')));
$('#btn-back-my-posts')?.addEventListener('click', () => showCustomerView('my-posts'));
$('#btn-back-tech-board')?.addEventListener('click', () => showTechView('job-board'));

// Hero Actions
$('#btn-hero-self-fill')?.addEventListener('click', () => {
  if (!currentUser) {
    message('กรุณาเข้าสู่ระบบก่อนสร้างงานซ่อม');
    $('#workspace').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  showCustomerView('self-fill');
});

$('#btn-hero-ai-assist')?.addEventListener('click', () => {
  if (!currentUser) {
    message('กรุณาเข้าสู่ระบบก่อนใช้งาน AI Screening');
    $('#workspace').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  showCustomerView('ai-chat');
  initAiScreeningChat();
});

$('#btn-my-posts-add-job')?.addEventListener('click', async () => {
  const choice = await askChoice('เลือกวิธีสร้างงานซ่อม', 'คุณต้องการกรอกข้อมูลด้วยตัวเอง หรือให้ AI ช่วยสร้างการ์ดงาน?', [
    { label: '📝 กรอกด้วยตัวเอง', detail: 'ระบุข้อมูลสเปกและอาการเฉพาะเจาะจง' },
    { label: '🤖 ให้ AI ช่วยคัดกรอง', detail: 'คุยกับ AI Screening Chatbot เพื่อสรุปการ์ดงาน' }
  ]);
  if (!choice) return;
  if (choice.label.includes('กรอกด้วยตัวเอง')) showCustomerView('self-fill');
  else {
    showCustomerView('ai-chat');
    initAiScreeningChat();
  }
});

// Self-Fill Form Logic (Desktop vs Notebook)
$('#self-device-type')?.addEventListener('change', (e) => {
  const isDesktop = e.target.value === 'DESKTOP';
  $('#fields-desktop').hidden = !isDesktop;
  $('#fields-notebook').hidden = isDesktop;
});

$('#form-self-fill')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await handleJobCreationSubmit(event.currentTarget, true);
});

$('#btn-self-save-draft')?.addEventListener('click', async () => {
  const form = $('#form-self-fill');
  await handleJobCreationSubmit(form, false);
});

async function handleJobCreationSubmit(formElement, directPublish = true) {
  const formData = new FormData(formElement);
  const deviceType = formData.get('deviceType') || 'DESKTOP';
  const category = formData.get('category') || 'HARDWARE';
  const serviceFormat = formData.get('serviceFormat') || 'ONSITE';
  const districtCode = formData.get('districtCode');
  const symptom = formData.get('symptom') || '';

  const selectedFiles = formData.getAll('attachments').filter((file) => file.size);
  if (selectedFiles.length > 3) {
    message('แนบรูปได้สูงสุด 3 ภาพ กรุณาเลือกไฟล์ใหม่', true);
    return;
  }
  if (selectedFiles.some((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) {
    message('รองรับเฉพาะภาพ JPG, PNG และ WebP', true);
    return;
  }

  // Contract requirement check: ask consent
  if (selectedFiles.length > 0) {
    const consent = await askConfirm('การใช้รูปภาพประกอบ', `ยืนยันการอัปโหลดรูปภาพจำนวน ${selectedFiles.length} ภาพ เพื่อให้ช่างและระบบใช้ประเมินอาการซ่อม`);
    if (!consent) return;
  }

  const payload = {
    category,
    serviceFormat,
    districtCode,
    deviceType,
    directPublish,
    symptom: symptom.trim() || (deviceType === 'DESKTOP' ? formData.get('powerBeepStatus') || 'มีปัญหาเปิดไม่ติด' : formData.get('bodyKeyboardScreenStatus') || 'มีปัญหาการใช้งาน'),
    pcSpecsCase: formData.get('pcSpecsCase') || undefined,
    powerBeepStatus: formData.get('powerBeepStatus') || undefined,
    screenDisplayCables: formData.get('screenDisplayCables') || undefined,
    problemTimeline: formData.get('problemTimeline') || undefined,
    laptopBrandModel: formData.get('laptopBrandModel') || undefined,
    batteryChargingStatus: formData.get('batteryChargingStatus') || undefined,
    bodyKeyboardScreenStatus: formData.get('bodyKeyboardScreenStatus') || undefined,
    damageHistory: formData.get('damageHistory') || undefined
  };

  try {
    const job = await api('/api/jobs', { method: 'POST', body: payload });
    
    // Upload attachments if any
    const attachmentIds = [];
    if (selectedFiles.length > 0) {
      for (const file of selectedFiles) {
        const uploaded = await fetch(`/api/jobs/${job.jobId}/attachments`, {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
          body: file
        });
        if (uploaded.ok) {
          const res = await uploaded.json();
          attachmentIds.push(res.data.attachmentId);
        }
      }
      if (attachmentIds.length) {
        await api(`/api/jobs/${job.jobId}/ai-consents`, {
          method: 'POST',
          body: { dataScope: { symptom: true, attachmentIds } }
        });
      }
    }

    formElement.reset();
    $('#fields-desktop').hidden = false;
    $('#fields-notebook').hidden = true;

    showSuccessView(job.jobId, directPublish ? 'การ์ดงานของคุณได้รับการเผยแพร่หาช่างแล้ว' : 'บันทึกฉบับร่างเรียบร้อยแล้ว');
  } catch (err) {
    message(err.message, true);
  }
}

// AI Screening Chatbot Logic
function initAiScreeningChat() {
  aiChatMessages = [];
  latestAiDraftCard = null;
  $('#ai-chat-history').innerHTML = `
    <div class="chat-bubble ai">
      <div class="bubble-avatar">🤖</div>
      <div class="bubble-content">
        <strong>Fixtech AI Screening:</strong>
        <p>สวัสดีครับ! ผมคือผู้ช่วยคัดกรองอาการงานซ่อม อุปกรณ์ของคุณเป็น <strong>คอมพิวเตอร์ตั้งโต๊ะ (Desktop PC)</strong> หรือ <strong>โน้ตบุ๊ก (Notebook)</strong> ครับ? และมีอาการอย่างไรบ้าง เล่าให้ผมฟังได้เลยครับ</p>
      </div>
    </div>
  `;
  $('#ai-draft-card-body').innerHTML = '<p class="empty-state">เล่าอาการกับ AI ด้านซ้าย เพื่อให้ระบบสร้างสรุปการ์ดงานแบบสมบูรณ์</p>';
  $('#ai-draft-actions').hidden = true;
  $('#ai-draft-status-badge').textContent = 'กำลังรอข้อมูล...';
}

$('#ai-chat-input-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#ai-user-message-input');
  const userText = input.value.trim();
  if (!userText) return;

  input.value = '';
  // Append user bubble
  $('#ai-chat-history').innerHTML += `
    <div class="chat-bubble user">
      <div class="bubble-avatar">👤</div>
      <div class="bubble-content">${escapeHtml(userText)}</div>
    </div>
  `;
  $('#ai-chat-history').scrollTop = $('#ai-chat-history').scrollHeight;

  aiChatMessages.push({ role: 'user', content: userText });

  // Call backend AI Screening
  try {
    const res = await api('/api/ai/screen-chat', {
      method: 'POST',
      body: { messages: aiChatMessages, conversationHistory: aiChatMessages, message: userText }
    });

    aiChatMessages.push({ role: 'assistant', content: res.reply });

    // Append AI bubble
    $('#ai-chat-history').innerHTML += `
      <div class="chat-bubble ai">
        <div class="bubble-avatar">🤖</div>
        <div class="bubble-content">
          <strong>Fixtech AI Screening:</strong>
          <p>${escapeHtml(res.reply).replaceAll('\n', '<br>')}</p>
        </div>
      </div>
    `;
    $('#ai-chat-history').scrollTop = $('#ai-chat-history').scrollHeight;

    if (res.draftCard) {
      latestAiDraftCard = res.draftCard;
      renderAiDraftCard(res.draftCard);
    }
  } catch (err) {
    message('การเชื่อมต่อกับ AI ขัดข้อง: ' + err.message, true);
  }
});

function renderAiDraftCard(card) {
  $('#ai-draft-status-badge').textContent = card.isComplete ? '✅ ข้อมูลครบถ้วนพร้อมเผยแพร่' : '⏳ กำลังรวบรวมข้อมูล';
  $('#ai-draft-status-badge').className = `badge ${card.isComplete ? 'badge-success' : 'badge-warning'}`;
  
  const checklistHtml = (card.keyChecklist || []).map((item) => `<li>✓ ${escapeHtml(item)}</li>`).join('');
  
  $('#ai-draft-card-body').innerHTML = `
    <div class="draft-card-preview">
      <div><strong>หมวดหมู่งาน:</strong> ${escapeHtml(card.category)} · ${escapeHtml(card.serviceFormat)}</div>
      <div><strong>ประเภทอุปกรณ์:</strong> ${escapeHtml(deviceLabels[card.deviceType] || card.deviceType)}</div>
      <div class="mt-2"><strong>สรุปอาการสำหรับช่าง (AI Summary):</strong></div>
      <div class="p-2 bg-light rounded">${escapeHtml(card.aiSummary)}</div>
      <div class="mt-2"><strong>รายการข้อมูลสำคัญที่ช่างควรรู้:</strong></div>
      <ul class="checklist">${checklistHtml || '<li>รวบรวมอาการเบื้องต้นแล้ว</li>'}</ul>
      <small class="text-muted">📌 สามารถแนบรูปภาพประกอบเพิ่มเติมได้หลังจากบันทึกงาน (JPG, PNG, WebP)</small>
    </div>
  `;
  $('#ai-draft-actions').hidden = false;
}

$('#btn-ai-save-draft')?.addEventListener('click', () => submitAiDraftJob(false));
$('#btn-ai-publish')?.addEventListener('click', () => submitAiDraftJob(true));

async function submitAiDraftJob(directPublish) {
  if (!latestAiDraftCard) return;
  const card = latestAiDraftCard;
  try {
    const payload = {
      category: card.category || 'HARDWARE',
      serviceFormat: card.serviceFormat || 'ONSITE',
      districtCode: 'BKK_WAT',
      deviceType: card.deviceType || 'DESKTOP',
      directPublish,
      symptom: card.aiSummary || 'อาการจาก AI Screening',
      aiSummary: card.aiSummary,
      aiDraftChecklist: card.keyChecklist,
      pcSpecsCase: card.specsCase,
      powerBeepStatus: card.powerBeep,
      screenDisplayCables: card.screenDisplay,
      problemTimeline: card.timeline,
      laptopBrandModel: card.brandModel,
      batteryChargingStatus: card.batteryStatus,
      bodyKeyboardScreenStatus: card.bodyStatus,
      damageHistory: card.damageHistory
    };

    const job = await api('/api/jobs', { method: 'POST', body: payload });
    showSuccessView(job.jobId, directPublish ? 'การ์ดงาน AI ของคุณได้รับการเผยแพร่หาช่างแล้ว' : 'บันทึกฉบับร่างเรียบร้อยแล้ว');
  } catch (err) {
    message(err.message, true);
  }
}

function showSuccessView(jobId, successText) {
  $('#success-job-message').textContent = successText;
  $('#success-job-details').innerHTML = `รหัสงาน: <strong>#${escapeHtml(jobId)}</strong>`;
  showCustomerView('success');
}

$('#btn-success-go-posts')?.addEventListener('click', () => {
  showCustomerView('my-posts');
  loadCustomerPosts();
});

// My Posts View
async function loadCustomerPosts() {
  const container = $('#customer-posts-list');
  container.innerHTML = '<p class="empty-state">กำลังโหลดรายการโพสต์...</p>';
  try {
    const jobs = await api('/api/jobs');
    if (!jobs.length) {
      container.innerHTML = '<p class="empty-state">คุณยังไม่มีโพสต์งานซ่อม กด "+ ประกาศหาช่างใหม่" ด้านบนเพื่อเริ่มสร้างงาน</p>';
      return;
    }

    container.innerHTML = jobs.map((job) => `
      <article class="post-card" data-job-id="${escapeHtml(job.id)}">
        <div>
          <div class="post-card-head">
            <span class="post-device-type">${escapeHtml(deviceLabels[job.device_type] || job.device_type || 'คอมพิวเตอร์')}</span>
            <span class="badge ${job.status === 'COMPLETED' ? 'badge-success' : 'badge-ai'}">${escapeHtml(statusLabels[job.status] || job.status)}</span>
          </div>
          <h3>${escapeHtml(job.symptom_text || 'งานซ่อมอุปกรณ์')}</h3>
          <p>${escapeHtml(job.ai_summary || job.symptom_text || '')}</p>
        </div>
        <div class="post-card-footer">
          <span>📍 ${escapeHtml(districtLabels[job.district_code] || job.district_code)}</span>
          <button class="button button-small button-outline btn-view-job" data-id="${escapeHtml(job.id)}">ดูรายละเอียด & ข้อเสนอ →</button>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('.btn-view-job').forEach((btn) => {
      btn.addEventListener('click', () => viewJobDetail(btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">เกิดข้อผิดพลาดในการโหลดโพสต์: ${escapeHtml(err.message)}</p>`;
  }
}

// Job Detail View
async function viewJobDetail(jobId) {
  activeJobId = jobId;
  showCustomerView('job-detail');
  $('#job-detail-title').textContent = `รายละเอียดงาน #${jobId.slice(0, 8)}`;
  
  try {
    const job = await api(`/api/jobs/${jobId}`);
    $('#detail-poster-name').textContent = job.customer_name || 'ลูกค้า Fixtech';
    $('#detail-post-time').textContent = `สร้างเมื่อ ${new Date(job.created_at).toLocaleString('th-TH')}`;
    $('#detail-job-status').textContent = statusLabels[job.status] || job.status;

    let specsHtml = '';
    if (job.device_type === 'NOTEBOOK') {
      specsHtml = `
        <dl>
          <div><dt>ยี่ห้อและรุ่น</dt><dd>${escapeHtml(job.laptop_brand_model || '-')}</dd></div>
          <div><dt>สถานะแบตเตอรี่ & ชาร์จ</dt><dd>${escapeHtml(job.battery_charging_status || '-')}</dd></div>
          <div><dt>อาการผิดปกติของเครื่อง</dt><dd>${escapeHtml(job.body_keyboard_screen_status || '-')}</dd></div>
          <div><dt>ประวัติความเสียหาย</dt><dd>${escapeHtml(job.damage_history || '-')}</dd></div>
          <div><dt>อาการเพิ่มเติม</dt><dd>${escapeHtml(job.symptom_text || '-')}</dd></div>
        </dl>
      `;
    } else {
      specsHtml = `
        <dl>
          <div><dt>สเปกเครื่อง / ยี่ห้อเคส</dt><dd>${escapeHtml(job.pc_specs_case || '-')}</dd></div>
          <div><dt>สถานะไฟพาวเวอร์ / Beep Code</dt><dd>${escapeHtml(job.power_beep_status || '-')}</dd></div>
          <div><dt>อาการบนหน้าจอ & สายสัญญาณ</dt><dd>${escapeHtml(job.screen_display_cables || '-')}</dd></div>
          <div><dt>ลำดับเวลาที่เกิดปัญหา</dt><dd>${escapeHtml(job.problem_timeline || '-')}</dd></div>
          <div><dt>อาการเพิ่มเติม</dt><dd>${escapeHtml(job.symptom_text || '-')}</dd></div>
        </dl>
      `;
    }
    $('#detail-specs-summary').innerHTML = specsHtml;

    // Attachments section
    if (job.attachments && job.attachments.length) {
      $('#detail-images-section').hidden = false;
      $('#detail-images-grid').innerHTML = job.attachments.map((att) => `
        <img class="image-gallery-item" src="/api/attachments/${att.id}/file" alt="${escapeHtml(att.original_filename)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\'><rect width=\\'100\\' height=\\'100\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23999\\'>รูปภาพ</text></svg>'">
      `).join('');
    } else {
      $('#detail-images-section').hidden = true;
    }

    // Load technician quotations
    loadJobQuotations(jobId);
  } catch (err) {
    message('ไม่สามารถโหลดรายละเอียดงานได้: ' + err.message, true);
  }
}

async function loadJobQuotations(jobId) {
  const container = $('#job-detail-quotations-list');
  try {
    const offers = await api(`/api/jobs/${jobId}/offers`);
    if (!offers.length) {
      container.innerHTML = '<p class="empty-state">ยังไม่มีช่างส่งใบเสนอราคาเข้ามา เมื่อช่างเห็นโพสต์ของคุณ ช่างจะส่งใบเสนอราคามาที่นี่</p>';
      return;
    }

    container.innerHTML = offers.map((o) => `
      <div class="quotation-card">
        <div class="quote-tech-head">
          <div>
            <strong>👨‍🔧 ${escapeHtml(o.providerLabel || 'ช่างซ่อมมืออาชีพ')}</strong>
            <small class="text-muted block">เสนอราคาเมื่อ ${new Date(o.createdAt || Date.now()).toLocaleDateString('th-TH')}</small>
          </div>
          <button class="button button-primary button-small btn-quote-chat" data-job="${escapeHtml(jobId)}" data-provider="${escapeHtml(o.providerId)}">
            💬 ติดต่อกลับหาช่าง
          </button>
        </div>
        <p class="quote-scope"><strong>ขอบเขตงาน:</strong> ${escapeHtml(o.scopeSummary || 'ดำเนินการตรวจเช็คและซ่อมตามอาการ')}</p>
        <div class="quote-breakdown">
          <div>ค่าแรง: ${Number(o.laborFee || o.amount).toLocaleString('th-TH')} ฿</div>
          <div>ค่าเดินทาง: ${Number(o.transportFee || 0).toLocaleString('th-TH')} ฿</div>
          <div class="quote-total">ยอดรวมสุทธิ: ${Number(o.amount).toLocaleString('th-TH')} บาท</div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-quote-chat').forEach((btn) => {
      btn.addEventListener('click', () => {
        openChatForJob(btn.dataset.job, btn.dataset.provider);
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">โหลดใบเสนอราคาไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
  }
}

// Chat Center Logic
async function loadChatCenter() {
  const threadsList = $('#chat-threads-list');
  threadsList.innerHTML = '<p class="empty-state">กำลังโหลดรายการแชท...</p>';
  try {
    const jobs = await api('/api/jobs');
    const activeThreads = jobs.filter((j) => ['POSTED', 'MATCHED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER_CONFIRMATION', 'COMPLETED'].includes(j.status));
    
    if (!activeThreads.length) {
      threadsList.innerHTML = '<p class="empty-state">ไม่มีรายการแชทที่กำลังดำเนินอยู่</p>';
      $('#chat-messages-stream').innerHTML = '<p class="empty-state">ไม่มีบทสนทนา</p>';
      return;
    }

    threadsList.innerHTML = activeThreads.map((j) => `
      <div class="thread-item ${j.id === activeChatJobId ? 'active' : ''}" data-job-id="${escapeHtml(j.id)}">
        <h4>${escapeHtml(j.symptom_text ? j.symptom_text.slice(0, 30) : 'งานซ่อม')}...</h4>
        <p>สถานะ: ${escapeHtml(statusLabels[j.status] || j.status)}</p>
      </div>
    `).join('');

    threadsList.querySelectorAll('.thread-item').forEach((item) => {
      item.addEventListener('click', () => openChatRoom(item.dataset.jobId));
    });

    if (!activeChatJobId && activeThreads.length) {
      openChatRoom(activeThreads[0].id);
    }
  } catch (err) {
    threadsList.innerHTML = `<p class="empty-state text-danger">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</p>`;
  }
}

function openChatForJob(jobId, providerId) {
  activeChatJobId = jobId;
  showCustomerView('chat-center');
  loadChatCenter().then(() => openChatRoom(jobId));
}

async function openChatRoom(jobId) {
  activeChatJobId = jobId;
  $$('.thread-item').forEach((el) => el.classList.toggle('active', el.dataset.jobId === jobId));

  $('#chat-target-name').textContent = `แชทงานซ่อม #${jobId.slice(0, 8)}`;
  $('#chat-job-ref').textContent = `อ้างอิงงาน: ${jobId}`;

  // Check Escrow & Quotation Status
  try {
    const job = await api(`/api/jobs/${jobId}`);
    const offers = await api(`/api/jobs/${jobId}/offers`).catch(() => []);
    const proofs = await api(`/api/fastwork/jobs/${jobId}/work-proofs`).catch(() => []);

    const acceptedOffer = offers[0];
    if (acceptedOffer) {
      $('#chat-escrow-banner').hidden = false;
      $('#chat-quote-amount').textContent = Number(acceptedOffer.amount).toLocaleString('th-TH');
      
      if (job.status === 'POSTED' || job.status === 'WAITING_FOR_SELECTION') {
        $('#chat-escrow-status-text').textContent = 'ยังไม่ชำระเงินมัดจำ';
        $('#chat-escrow-actions').innerHTML = `<button class="button button-primary button-small" id="btn-chat-pay-escrow">💳 ยอมรับ & ชำระเงิน Escrow</button>`;
        $('#btn-chat-pay-escrow')?.addEventListener('click', () => payEscrowHolding(jobId, acceptedOffer.id));
      } else {
        $('#chat-escrow-status-text').textContent = 'ชำระแล้ว เงินอยู่ในระบบ Escrow ปลอดภัย';
        $('#chat-escrow-actions').innerHTML = '<span class="badge badge-success">🔒 ชำระเข้า Escrow แล้ว</span>';
      }
    } else {
      $('#chat-escrow-banner').hidden = true;
    }

    // Work Proofs Check
    if (proofs && proofs.length) {
      $('#chat-work-proofs-banner').hidden = false;
      $('#chat-proofs-preview').innerHTML = proofs.map((p) => `
        <div class="proof-card">
          <small>ประเภท: ${escapeHtml(p.proof_type)}</small>
          <img class="proof-thumb" src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.proof_type)}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'64\\' height=\\'64\\'><rect width=\\'64\\' height=\\'64\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23999\\'>หลักฐาน</text></svg>'">
        </div>
      `).join('');

      if (['IN_PROGRESS', 'WAITING_FOR_CUSTOMER_CONFIRMATION'].includes(job.status)) {
        $('#chat-proofs-action-box').hidden = false;
        $('#btn-chat-approve-job').onclick = () => approveJobCompletion(jobId);
      } else {
        $('#chat-proofs-action-box').hidden = true;
      }
    } else {
      $('#chat-work-proofs-banner').hidden = true;
    }

    // Load Messages
    loadChatMessages(jobId);
  } catch (err) {
    message('เกิดข้อผิดพลาดในการโหลดห้องแชท: ' + err.message, true);
  }
}

async function loadChatMessages(jobId) {
  const container = $('#chat-messages-stream');
  try {
    const messages = await api(`/api/jobs/${jobId}/messages`);
    if (!messages.length) {
      container.innerHTML = '<p class="empty-state">เริ่มต้นการสนทนากับช่างได้ที่นี่</p>';
      return;
    }

    container.innerHTML = messages.map((m) => `
      <div class="chat-bubble ${m.senderRole === currentUser?.role ? 'user' : 'ai'}">
        <div class="bubble-avatar">${m.senderRole === 'TECHNICIAN' ? '👨‍🔧' : '👤'}</div>
        <div class="bubble-content">
          <strong>${m.senderRole === currentUser?.role ? 'คุณ' : (roleLabels[m.senderRole] || 'ช่าง')}:</strong>
          <p>${escapeHtml(m.body)}</p>
        </div>
      </div>
    `).join('');

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">โหลดข้อความไม่สำเร็จ: ${escapeHtml(err.message)}</p>`;
  }
}

$('#chat-message-send-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChatJobId) return;
  const input = $('#chat-message-text');
  const text = input.value.trim();
  if (!text) return;

  try {
    await api(`/api/jobs/${activeChatJobId}/messages`, {
      method: 'POST',
      body: { body: text }
    });
    input.value = '';
    loadChatMessages(activeChatJobId);
  } catch (err) {
    message('ส่งข้อความไม่สำเร็จ: ' + err.message, true);
  }
});

// Escrow Payment Holding Flow
async function payEscrowHolding(jobId, offerId) {
  const confirm = await askConfirm(
    'ชำระเงินมัดจำเข้าสู่ระบบ Escrow',
    'เงินจะถูกเก็บไว้ในบัญชีกลางของ Fixtech และจะยังไม่โอนให้ช่าง จนกว่าช่างจะทำงานเสร็จ ส่งรูปหลักฐาน และคุณได้กดยืนยันตรวจรับงาน'
  );
  if (!confirm) return;

  try {
    await api('/api/fastwork/escrow/pay', {
      method: 'POST',
      body: { jobId, offerId, paymentMethod: 'PROMPTPAY_SIMULATED' }
    });
    message('ชำระเงินเข้าสู่ระบบ Escrow เรียบร้อยแล้ว ช่างสามารถเริ่มงานได้ทันที');
    openChatRoom(jobId);
  } catch (err) {
    message('ชำระเงิน Escrow ไม่สำเร็จ: ' + err.message, true);
  }
}

// Work Completion Approval Flow
async function approveJobCompletion(jobId) {
  const confirm = await askConfirm(
    'ยืนยันการตรวจรับงานและเสร็จสิ้นงาน',
    'คุณได้ตรวจสอบรูปถ่ายหลักฐานก่อนและหลังซ่อมเรียบร้อยแล้วใช่หรือไม่? เมื่อกดยืนยัน ระบบจะเตรียมโอนเงินให้ช่างต่อไป'
  );
  if (!confirm) return;

  try {
    await api(`/api/fastwork/jobs/${jobId}/approve-completion`, { method: 'POST' });
    message('ยืนยันตรวจรับงานเสร็จสิ้นเรียบร้อย ขอบคุณที่ใช้บริการ Fixtech');
    openChatRoom(jobId);
  } catch (err) {
    message('ตรวจรับงานไม่สำเร็จ: ' + err.message, true);
  }
}

// Report User & Contact Admin Modal Handlers
$('#btn-chat-report-user')?.addEventListener('click', async () => {
  if (!activeChatJobId) return;
  const form = await openDialog({
    title: '⚠️ รายงานผู้ใช้ / แจ้งพฤติกรรมไม่เหมาะสม',
    description: 'รายงานจะถูกส่งตรงไปยังทีมงานผู้ดูแลระบบเพื่อตรวจสอบข้อความแชทและดำเนินการ',
    fields: [
      { name: 'reason', label: 'เหตุผลในการรายงาน', type: 'textarea', required: true, placeholder: 'ระบุพฤติกรรมที่ไม่เหมาะสม...' }
    ],
    confirmLabel: 'ส่งรายงาน'
  });
  if (form?.reason?.trim()) {
    try {
      await api('/api/fastwork/reports', {
        method: 'POST',
        body: { jobId: activeChatJobId, reason: form.reason.trim(), category: 'USER_REPORT' }
      });
      message('ส่งรายงานผู้ใช้เรียบร้อยแล้ว ทีมงานจะเร่งตรวจสอบ');
    } catch (err) {
      message(err.message, true);
    }
  }
});

$('#btn-chat-contact-admin')?.addEventListener('click', async () => {
  if (!activeChatJobId) return;
  const form = await openDialog({
    title: '🛡️ ติดต่อเจ้าหน้าที่ Fixtech Support',
    description: 'แจ้งปัญหาข้อติดขัดเพื่อขอความช่วยเหลือจากเจ้าหน้าที่',
    fields: [
      { name: 'reason', label: 'รายละเอียดปัญหาที่ต้องการความช่วยเหลือ', type: 'textarea', required: true, placeholder: 'อธิบายปัญหาของคุณ...' }
    ],
    confirmLabel: 'ส่งข้อความถึงเจ้าหน้าที่'
  });
  if (form?.reason?.trim()) {
    try {
      await api('/api/fastwork/reports', {
        method: 'POST',
        body: { jobId: activeChatJobId, reason: form.reason.trim(), category: 'CONTACT_ADMIN' }
      });
      message('ส่งเรื่องถึงเจ้าหน้าที่เรียบร้อยแล้ว');
    } catch (err) {
      message(err.message, true);
    }
  }
});

// ========================================================
// TECHNICIAN PORTAL LOGIC
// ========================================================
async function loadTechJobBoard() {
  const container = $('#tech-open-jobs-list');
  container.innerHTML = '<p class="empty-state">กำลังโหลดงานซ่อมที่เปิดอยู่...</p>';

  // Check KYC status
  try {
    const profile = await api('/api/fastwork/profile');
    const isApproved = profile.is_approved || profile.kyc_status === 'APPROVED';
    $('#tech-kyc-alert-banner').hidden = isApproved;

    const district = $('#tech-filter-district')?.value || '';
    const device = $('#tech-filter-device')?.value || '';
    let query = `/api/fastwork/jobs/board?limit=30`;
    if (district) query += `&district=${encodeURIComponent(district)}`;
    if (device) query += `&deviceType=${encodeURIComponent(device)}`;

    const jobs = await api(query);
    if (!jobs.length) {
      container.innerHTML = '<p class="empty-state">ขณะนี้ยังไม่มีงานซ่อมที่เปิดรับใบเสนอราคา</p>';
      return;
    }

    container.innerHTML = jobs.map((job) => `
      <article class="post-card">
        <div>
          <div class="post-card-head">
            <span class="post-device-type">${escapeHtml(deviceLabels[job.device_type] || job.device_type)}</span>
            <span class="badge badge-ai">รับใบเสนอราคา</span>
          </div>
          <h3>${escapeHtml(job.symptom_text || 'งานซ่อม')}</h3>
          <p>${escapeHtml(job.ai_summary || job.symptom_text || '')}</p>
        </div>
        <div class="post-card-footer">
          <span>📍 ${escapeHtml(districtLabels[job.district_code] || job.district_code)}</span>
          <button class="button button-small button-primary btn-tech-quote" data-job-id="${escapeHtml(job.id)}">
            📝 ส่งใบเสนอราคา
          </button>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('.btn-tech-quote').forEach((btn) => {
      btn.addEventListener('click', () => openTechQuotationModal(btn.dataset.jobId));
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">เกิดข้อผิดพลาดในการโหลดงาน: ${escapeHtml(err.message)}</p>`;
  }
}

$('#tech-filter-district')?.addEventListener('change', loadTechJobBoard);
$('#tech-filter-device')?.addEventListener('change', loadTechJobBoard);
$('#btn-tech-goto-kyc')?.addEventListener('click', openAccountSettingsModal);

async function openTechQuotationModal(jobId) {
  // Check KYC
  const profile = await api('/api/fastwork/profile').catch(() => ({}));
  if (!profile.is_approved && profile.kyc_status !== 'APPROVED') {
    const goKyc = await askConfirm(
      'จำเป็นต้องยืนยันตัวตน (KYC)',
      'ตามนโยบาย Fastwork Escrow ช่างต้องผ่านการอนุมัติเอกสารยืนยันตัวตนก่อน จึงจะสามารถส่งใบเสนอราคาได้ ต้องการไปหน้ายืนยันตัวตนตอนนี้หรือไม่?'
    );
    if (goKyc) openAccountSettingsModal();
    return;
  }

  const form = await openDialog({
    title: '📝 สร้างใบเสนอราคา (Fastwork Quotation)',
    description: 'ระบุค่าแรง ค่าเดินทาง และรายการอุปกรณ์ที่ลูกค้าจะได้รับ',
    fields: [
      { name: 'laborFee', label: 'ค่าแรงช่าง (บาท) *', type: 'number', min: 100, required: true, value: 500 },
      { name: 'transportFee', label: 'ค่าเดินทาง (บาท)', type: 'number', min: 0, required: false, value: 150 },
      { name: 'partsDetail', label: 'รายการอะไหล่ / อุปกรณ์ (ถ้ามี)', type: 'text', placeholder: 'เช่น ซิลิโคนเกรดพรีเมียม, สายแพร์จอ' },
      { name: 'partsCost', label: 'ค่าอะไหล่รวม (บาท)', type: 'number', min: 0, value: 0 },
      { name: 'scopeSummary', label: 'ขอบเขตงานและสิ่งที่ลูกค้าจะได้รับ *', type: 'textarea', required: true, placeholder: 'เช่น ตรวจเช็คจุดเสีย เปลี่ยนซิลิโคน ทำความสะอาด และทดสอบระบบ 2 ชม.' }
    ],
    confirmLabel: 'ส่งใบเสนอราคาให้ลูกค้า'
  });

  if (form) {
    const labor = Number(form.laborFee || 0);
    const transport = Number(form.transportFee || 0);
    const parts = Number(form.partsCost || 0);
    const total = labor + transport + parts;

    try {
      await api(`/api/fastwork/jobs/${jobId}/quote`, {
        method: 'POST',
        body: {
          amount: total,
          laborFee: labor,
          transportFee: transport,
          itemsDetail: [{ name: form.partsDetail || 'ค่าบริการซ่อมบำรุง', price: parts, quantity: 1 }],
          scopeSummary: form.scopeSummary
        }
      });
      message(`ส่งใบเสนอราคาเรียบร้อยแล้ว (ยอดรวม ${total.toLocaleString('th-TH')} บาท)`);
      loadTechJobBoard();
    } catch (err) {
      message('ส่งใบเสนอราคาไม่สำเร็จ: ' + err.message, true);
    }
  }
}

// Technician Financials Dashboard
async function loadTechFinancials() {
  try {
    const fin = await api('/api/fastwork/provider/financials');
    $('#fin-stat-today').textContent = `${Number(fin.todayEarnings || 0).toLocaleString('th-TH')} ฿`;
    $('#fin-stat-month').textContent = `${Number(fin.monthEarnings || 0).toLocaleString('th-TH')} ฿`;
    $('#fin-stat-pending').textContent = `${Number(fin.pendingPayout || 0).toLocaleString('th-TH')} ฿`;
    $('#fin-stat-escrow').textContent = `${Number(fin.escrowHolding || 0).toLocaleString('th-TH')} ฿`;
    $('#fin-stat-count').textContent = `${Number(fin.completedJobsCount || 0)} งาน`;

    const historyContainer = $('#tech-payouts-history-list');
    if (!fin.payouts || !fin.payouts.length) {
      historyContainer.innerHTML = '<p class="empty-state">ยังไม่มีประวัติการโอนเงิน</p>';
    } else {
      historyContainer.innerHTML = fin.payouts.map((p) => `
        <div class="payout-row">
          <div><strong>งาน #${escapeHtml(p.job_id?.slice(0, 8))}</strong> · ยอดสุทธิ: ${Number(p.amount).toLocaleString('th-TH')} บาท</div>
          <div><span class="badge ${p.status === 'TRANSFERRED' ? 'badge-success' : 'badge-warning'}">${escapeHtml(p.status)}</span></div>
        </div>
      `).join('');
    }
  } catch (err) {
    message('ไม่สามารถโหลดข้อมูลการเงินได้: ' + err.message, true);
  }
}

// Account Settings Modal (Personal & KYC Details)
async function openAccountSettingsModal() {
  try {
    const profile = await api('/api/fastwork/profile');
    const isTech = currentUser?.role === 'TECHNICIAN';

    const fields = [
      { name: 'displayName', label: 'ชื่อที่แสดง', value: currentUser?.displayName || '', required: true },
      { name: 'idCardNumber', label: 'เลขบัตรประจำตัวประชาชน (13 หลัก)', value: profile.id_card_number || '', maxlength: 13 },
      { name: 'bankName', label: 'ธนาคาร', value: profile.bank_name || '', placeholder: 'เช่น กสิกรไทย, ไทยพาณิชย์, กรุงเทพ' },
      { name: 'bankAccountNumber', label: 'เลขที่บัญชีธนาคาร', value: profile.bank_account_number || '' },
      { name: 'bankAccountName', label: 'ชื่อบัญชีธนาคาร (ต้องตรงกับชื่อบัตรประชาชน)', value: profile.bank_account_name || '' }
    ];

    if (isTech) {
      fields.push(
        { name: 'skills', label: 'ทักษะความชำนาญ (เช่น Hardware ซ่อมบอร์ด, Software ล้างเครื่อง)', value: (profile.skills || []).join(', ') },
        { name: 'idCardImageUrl', label: 'ลิงก์รูปถ่ายบัตรประชาชน (KYC)', value: profile.id_card_image_url || '', placeholder: 'https://...' },
        { name: 'selfieImageUrl', label: 'ลิงก์รูปถ่ายเซลฟี่คู่บัตรประชาชน (KYC)', value: profile.selfie_image_url || '', placeholder: 'https://...' }
      );
    }

    const form = await openDialog({
      title: '⚙️ ตั้งค่าบัญชีและข้อมูลส่วนตัว',
      description: `สถานะการยืนยันตัวตน (KYC): ${escapeHtml(profile.kyc_status || 'NOT_SUBMITTED')}${profile.kyc_rejection_reason ? ` (เหตุผลที่ถูกปฏิเสธ: ${escapeHtml(profile.kyc_rejection_reason)})` : ''}`,
      fields,
      confirmLabel: 'บันทึกข้อมูล'
    });

    if (form) {
      await api('/api/fastwork/profile', {
        method: 'POST',
        body: {
          displayName: form.displayName,
          idCardNumber: form.idCardNumber,
          bankName: form.bankName,
          bankAccountNumber: form.bankAccountNumber,
          bankAccountName: form.bankAccountName
        }
      });

      if (isTech && (form.idCardImageUrl || form.selfieImageUrl)) {
        await api('/api/fastwork/profile/kyc', {
          method: 'POST',
          body: {
            idCardImageUrl: form.idCardImageUrl,
            selfieImageUrl: form.selfieImageUrl,
            skills: form.skills ? form.skills.split(',').map((s) => s.trim()) : ['Hardware']
          }
        });
      }

      message('บันทึกข้อมูลบัญชีเรียบร้อยแล้ว');
    }
  } catch (err) {
    message('เกิดข้อผิดพลาดในการโหลดหรือบันทึกข้อมูลบัญชี: ' + err.message, true);
  }
}

// ========================================================
// ADMIN CONSOLE PORTAL LOGIC (9 DEDICATED MODULES)
// ========================================================
$$('.admin-nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const tabName = item.dataset.tab;
    $$('.admin-nav-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');

    $$('.admin-section').forEach((sec) => sec.classList.remove('active'));
    $(`#${tabName}`)?.classList.add('active');

    // Trigger tab loader
    if (tabName === 'admin-overview') loadAdminOverview();
    if (tabName === 'admin-users') loadAdminUsers();
    if (tabName === 'admin-kyc') loadAdminKyc();
    if (tabName === 'admin-jobs') loadAdminJobs();
    if (tabName === 'admin-reports') loadAdminReports();
    if (tabName === 'admin-disputes') loadAdminDisputes();
    if (tabName === 'admin-finance') loadAdminFinance();
    if (tabName === 'admin-settings') loadAdminSettings();
    if (tabName === 'admin-audit') loadAdminAuditLogs();
  });
});

$$('.urgent-card').forEach((card) => {
  card.addEventListener('click', () => {
    const target = card.dataset.goto;
    $(`.admin-nav-item[data-tab="${target}"]`)?.click();
  });
});

async function loadAdminOverview() {
  try {
    const data = await api('/api/admin/overview');
    $('#adm-stat-users').textContent = data.totalUsers || 0;
    $('#adm-stat-providers').textContent = data.totalProviders || 0;
    $('#adm-stat-open-jobs').textContent = data.openJobs || 0;
    $('#adm-stat-done-today').textContent = data.completedToday || 0;

    $('#urgent-kyc-count').textContent = data.pendingKycCount || 0;
    $('#urgent-reports-count').textContent = data.newReportsCount || 0;
    $('#urgent-disputes-count').textContent = data.openDisputesCount || 0;
    $('#urgent-payouts-count').textContent = data.pendingPayoutsCount || 0;

    // Badges in sidebar
    updateAdminBadge('#admin-badge-kyc', data.pendingKycCount);
    updateAdminBadge('#admin-badge-reports', data.newReportsCount);
    updateAdminBadge('#admin-badge-disputes', data.openDisputesCount);
    updateAdminBadge('#admin-badge-finance', data.pendingPayoutsCount);
  } catch (err) {
    console.error('Admin overview error:', err);
  }
}

function updateAdminBadge(selector, count) {
  const el = $(selector);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// Module 2: Manage Users
async function loadAdminUsers() {
  const tbody = $('#admin-users-table-body');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">กำลังโหลด...</td></tr>';
  const search = $('#admin-user-search')?.value.trim() || '';
  const role = $('#admin-user-filter-role')?.value || '';

  try {
    const users = await api(`/api/admin/users?search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}`);
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center empty-state">ไม่พบผู้ใช้งาน</td></tr>';
      return;
    }

    tbody.innerHTML = users.map((u) => `
      <tr>
        <td><strong>${escapeHtml(u.display_name)}</strong></td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(roleLabels[u.role] || u.role)}</td>
        <td><span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}">${u.is_active ? 'ใช้งานปกติ' : 'ถูกระงับ'}</span></td>
        <td>
          <button class="button button-small button-outline btn-admin-user-action" data-id="${u.id}" data-active="${u.is_active}">
            ${u.is_active ? 'ระงับบัญชี' : 'เปิดใช้งาน'}
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-admin-user-action').forEach((btn) => {
      btn.addEventListener('click', () => toggleUserSuspension(btn.dataset.id, btn.dataset.active === 'true'));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

$('#admin-user-search')?.addEventListener('input', loadAdminUsers);
$('#admin-user-filter-role')?.addEventListener('change', loadAdminUsers);

async function toggleUserSuspension(userId, currentlyActive) {
  const actionText = currentlyActive ? 'ระงับบัญชีผู้ใช้' : 'เปิดใช้งานบัญชีผู้ใช้';
  const form = await openDialog({
    title: `${actionText}`,
    description: `โปรดระบุเหตุผลในการ${actionText}เพื่อบันทึกเข้าสู่ Audit Log`,
    fields: [
      { name: 'reason', label: 'เหตุผล *', type: 'textarea', required: true }
    ],
    confirmLabel: 'ยืนยัน'
  });

  if (form?.reason?.trim()) {
    try {
      await api(`/api/admin/users/${userId}/suspend`, {
        method: 'POST',
        body: { suspend: currentlyActive, reason: form.reason.trim() }
      });
      message(`ดำเนินการ${actionText}เรียบร้อยแล้ว`);
      loadAdminUsers();
    } catch (err) {
      message(err.message, true);
    }
  }
}

// Module 3: KYC Verification
async function loadAdminKyc() {
  const container = $('#admin-kyc-list');
  container.innerHTML = '<p class="empty-state">กำลังโหลด...</p>';
  try {
    const list = await api('/api/admin/kyc/pending');
    if (!list.length) {
      container.innerHTML = '<p class="empty-state">ไม่มีคำขอยืนยันตัวตนช่างที่รอการตรวจสอบ</p>';
      return;
    }

    container.innerHTML = list.map((item) => `
      <div class="card-box mb-3">
        <div class="d-flex justify-between">
          <div>
            <h3>👨‍🔧 ${escapeHtml(item.display_name)} (${escapeHtml(item.email)})</h3>
            <p>เลขบัตรประชาชน: <strong>${escapeHtml(item.id_card_number || '-')}</strong></p>
            <p>บัญชีธนาคาร: <strong>${escapeHtml(item.bank_name || '-')}</strong> เลขที่ <strong>${escapeHtml(item.bank_account_number || '-')}</strong> (ชื่อ: ${escapeHtml(item.bank_account_name || '-')})</p>
            <p>ทักษะ: ${escapeHtml((item.skills || []).join(', '))}</p>
          </div>
          <div>
            <span class="badge badge-warning">รอตรวจสอบ</span>
          </div>
        </div>
        <div class="d-flex gap-2 mt-2">
          <button class="button button-small button-primary btn-kyc-approve" data-id="${item.user_id}">✅ อนุมัติ KYC</button>
          <button class="button button-small button-outline text-danger btn-kyc-reject" data-id="${item.user_id}">❌ ปฏิเสธ</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-kyc-approve').forEach((btn) => {
      btn.addEventListener('click', () => reviewKyc(btn.dataset.id, 'APPROVED'));
    });
    container.querySelectorAll('.btn-kyc-reject').forEach((btn) => {
      btn.addEventListener('click', () => reviewKyc(btn.dataset.id, 'REJECTED'));
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">${escapeHtml(err.message)}</p>`;
  }
}

async function reviewKyc(userId, status) {
  const isApproved = status === 'APPROVED';
  const form = await openDialog({
    title: isApproved ? 'อนุมัติการยืนยันตัวตน (KYC)' : 'ปฏิเสธการยืนยันตัวตน',
    description: isApproved ? 'ช่างจะสามารถเริ่มส่งใบเสนอราคาให้ลูกค้าได้ทันที' : 'โปรดระบุเหตุผลในการปฏิเสธเพื่อให้ช่างแก้ไขเอกสาร',
    fields: isApproved ? [] : [{ name: 'reason', label: 'เหตุผลที่ปฏิเสธ *', type: 'textarea', required: true }],
    confirmLabel: isApproved ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'
  });

  if (isApproved || form?.reason?.trim()) {
    try {
      await api(`/api/admin/kyc/${userId}/review`, {
        method: 'POST',
        body: { status, rejectionReason: form?.reason?.trim() }
      });
      message(`ดำเนินการบันทึกผล KYC เรียบร้อย`);
      loadAdminKyc();
      loadAdminOverview();
    } catch (err) {
      message(err.message, true);
    }
  }
}

// Module 4: Manage Jobs
async function loadAdminJobs() {
  const tbody = $('#admin-jobs-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">กำลังโหลด...</td></tr>';
  const status = $('#admin-jobs-filter-status')?.value || '';

  try {
    const jobs = await api(`/api/admin/jobs?status=${encodeURIComponent(status)}`);
    if (!jobs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center empty-state">ไม่พบโพสต์งาน</td></tr>';
      return;
    }

    tbody.innerHTML = jobs.map((j) => `
      <tr>
        <td>#${j.id.slice(0, 8)}</td>
        <td>${escapeHtml(deviceLabels[j.device_type] || j.device_type)}</td>
        <td>${escapeHtml(j.symptom_text ? j.symptom_text.slice(0, 40) : '-')}...</td>
        <td><span class="badge badge-ai">${escapeHtml(statusLabels[j.status] || j.status)}</span></td>
        <td><span class="badge ${j.is_hidden_by_admin ? 'badge-danger' : 'badge-success'}">${j.is_hidden_by_admin ? 'ซ่อนอยู่' : 'แสดงปกติ'}</span></td>
        <td>
          <button class="button button-small button-outline btn-admin-hide-job" data-id="${j.id}" data-hidden="${j.is_hidden_by_admin}">
            ${j.is_hidden_by_admin ? 'ยกเลิกการซ่อน' : 'ซ่อนโพสต์'}
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-admin-hide-job').forEach((btn) => {
      btn.addEventListener('click', () => toggleHideJob(btn.dataset.id, btn.dataset.hidden === 'true'));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

$('#admin-jobs-filter-status')?.addEventListener('change', loadAdminJobs);

async function toggleHideJob(jobId, currentlyHidden) {
  const actionText = currentlyHidden ? 'ยกเลิกการซ่อนโพสต์' : 'ซ่อนโพสต์งาน';
  const form = await openDialog({
    title: actionText,
    description: `โปรดระบุเหตุผลในการ${actionText} (เช่น เนื้อหาไม่เหมาะสม, ละเมิดกฎ)`,
    fields: [{ name: 'reason', label: 'เหตุผล *', type: 'textarea', required: true }],
    confirmLabel: 'ยืนยัน'
  });

  if (form?.reason?.trim()) {
    try {
      await api(`/api/admin/jobs/${jobId}/hide`, {
        method: 'POST',
        body: { hide: !currentlyHidden, reason: form.reason.trim() }
      });
      message(`ดำเนินการ${actionText}เรียบร้อยแล้ว`);
      loadAdminJobs();
    } catch (err) {
      message(err.message, true);
    }
  }
}

// Module 5: Reports & Support
async function loadAdminReports() {
  const container = $('#admin-reports-list');
  container.innerHTML = '<p class="empty-state">กำลังโหลด...</p>';
  try {
    const reports = await api('/api/admin/reports');
    if (!reports.length) {
      container.innerHTML = '<p class="empty-state">ไม่มีรายงานค้าง</p>';
      return;
    }

    container.innerHTML = reports.map((r) => `
      <div class="card-box mb-3">
        <div class="d-flex justify-between">
          <div>
            <strong>🚨 รายงาน #${r.id.slice(0, 8)}</strong> (งาน #${r.job_id?.slice(0, 8)})
            <p>ผู้แจ้ง: ${escapeHtml(r.reporter_name || r.reporter_id)}</p>
            <p>เหตุผล: <em>${escapeHtml(r.reason)}</em></p>
          </div>
          <span class="badge ${r.status === 'NEW' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(r.status)}</span>
        </div>
        <div class="d-flex gap-2 mt-2">
          <button class="button button-small button-outline btn-view-report-chat" data-id="${r.id}">💬 ดูข้อความแชท</button>
          <button class="button button-small button-primary btn-resolve-report" data-id="${r.id}">จัดการเรื่อง</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-view-report-chat').forEach((btn) => {
      btn.addEventListener('click', () => viewReportChatTranscript(btn.dataset.id));
    });
    container.querySelectorAll('.btn-resolve-report').forEach((btn) => {
      btn.addEventListener('click', () => handleReportAction(btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">${escapeHtml(err.message)}</p>`;
  }
}

async function viewReportChatTranscript(reportId) {
  try {
    const res = await api(`/api/admin/reports/${reportId}/chat`);
    const transcript = (res.messages || []).map((m) => `<strong>${m.senderRole}:</strong> ${escapeHtml(m.body)}`).join('<br>');
    await openDialog({
      title: 'บทสนทนาที่เกี่ยวข้อง (Read-Only)',
      description: `ประวัติการสนทนาของงาน #${res.jobId?.slice(0, 8)}`,
      content: transcript || '<p>ไม่มีข้อความในบทสนทนานี้</p>',
      actions: false
    });
  } catch (err) {
    message('ไม่สามารถเปิดดูแชทได้: ' + err.message, true);
  }
}

async function handleReportAction(reportId) {
  const form = await openDialog({
    title: 'พิจารณาการจัดการรายงาน',
    description: 'เลือกการดำเนินการและบันทึกข้อความตอบกลับ',
    fields: [
      {
        name: 'action',
        label: 'การดำเนินการ',
        options: [
          { value: 'DISMISS', label: 'ปิดเรื่อง (ไม่มีความผิด)' },
          { value: 'WARN', label: 'ตักเตือนผู้ใช้' },
          { value: 'SUSPEND', label: 'ระงับบัญชีผู้ถูกรายงาน' }
        ]
      },
      { name: 'notes', label: 'บันทึกการดำเนินการ *', type: 'textarea', required: true }
    ],
    confirmLabel: 'บันทึกผล'
  });

  if (form?.action && form?.notes?.trim()) {
    try {
      await api(`/api/admin/reports/${reportId}/action`, {
        method: 'POST',
        body: { action: form.action, notes: form.notes.trim() }
      });
      message('จัดการรายงานเรียบร้อยแล้ว');
      loadAdminReports();
      loadAdminOverview();
    } catch (err) {
      message(err.message, true);
    }
  }
}

// Module 6: Disputes
async function loadAdminDisputes() {
  const container = $('#admin-disputes-list');
  container.innerHTML = '<p class="empty-state">กำลังโหลด...</p>';
  try {
    const disputes = await api('/api/admin/disputes');
    if (!disputes.length) {
      container.innerHTML = '<p class="empty-state">ไม่มีข้อพิพาทค้างในระบบ</p>';
      return;
    }

    container.innerHTML = disputes.map((d) => `
      <div class="card-box mb-3">
        <h3>⚖️ ข้อพิพาทงาน #${d.job_id?.slice(0, 8)}</h3>
        <p>เหตุผล: ${escapeHtml(d.reason)}</p>
        <p>สถานะ: <span class="badge badge-warning">${escapeHtml(d.status)}</span></p>
        <button class="button button-small button-primary btn-resolve-dispute mt-2" data-id="${d.id}">ตัดสินข้อพิพาท</button>
      </div>
    `).join('');

    container.querySelectorAll('.btn-resolve-dispute').forEach((btn) => {
      btn.addEventListener('click', () => resolveDispute(btn.dataset.id));
    });
  } catch (err) {
    container.innerHTML = `<p class="empty-state text-danger">${escapeHtml(err.message)}</p>`;
  }
}

async function resolveDispute(disputeId) {
  const form = await openDialog({
    title: 'ตัดสินข้อพิพาท (Dispute Resolution)',
    description: 'เลือกผลการตัดสินและระบุเหตุผลเพื่อแจ้งทั้งสองฝ่ายและบันทึกบัญชี',
    fields: [
      {
        name: 'outcome',
        label: 'ผลการตัดสิน',
        options: [
          { value: 'KEEP_COMPLETED', label: 'ให้ถือว่างานเสร็จ (โอนเงินให้ช่างตามปกติ)' },
          { value: 'RETURN_TO_CUSTOMER', label: 'ส่งกลับให้ช่างแก้ไขงาน' },
          { value: 'CANCEL', label: 'ยกเลิกงานและคืนเงินลูกค้า' }
        ]
      },
      { name: 'resolution', label: 'เหตุผลการตัดสิน (บังคับกรอก) *', type: 'textarea', required: true }
    ],
    confirmLabel: 'บันทึกการตัดสิน'
  });

  if (form?.outcome && form?.resolution?.trim()) {
    try {
      await api(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        body: { outcome: form.outcome, resolution: form.resolution.trim() }
      });
      message('บันทึกผลการตัดสินข้อพิพาทเรียบร้อยแล้ว');
      loadAdminDisputes();
      loadAdminOverview();
    } catch (err) {
      message(err.message, true);
    }
  }
}

// Module 7: Finance & Payouts
async function loadAdminFinance() {
  const tbody = $('#admin-finance-table-body');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center">กำลังโหลด...</td></tr>';
  try {
    const payouts = await api('/api/admin/finance/payouts');
    if (!payouts.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center empty-state">ไม่มีรายการรอโอนเงินให้ช่าง</td></tr>';
      return;
    }

    tbody.innerHTML = payouts.map((p) => `
      <tr>
        <td>#${p.job_id?.slice(0, 8)}</td>
        <td>${escapeHtml(p.provider_name || 'ช่าง')}</td>
        <td>${Number(p.gross_amount).toLocaleString('th-TH')} ฿</td>
        <td>${Number(p.platform_fee).toLocaleString('th-TH')} ฿ (${p.platform_fee_percent}%)</td>
        <td><strong class="text-success">${Number(p.net_payout_amount).toLocaleString('th-TH')} ฿</strong></td>
        <td>${escapeHtml(p.bank_name || '-')} ${escapeHtml(p.bank_account_number || '-')} (${escapeHtml(p.bank_account_name || '-')})</td>
        <td>
          <button class="button button-small button-primary btn-confirm-payout" data-id="${p.id}" data-amount="${p.net_payout_amount}">
            โอนแล้ว (แนบสลิป)
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-confirm-payout').forEach((btn) => {
      btn.addEventListener('click', () => confirmPayoutWithSlip(btn.dataset.id, btn.dataset.amount));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function confirmPayoutWithSlip(payoutId, netAmount) {
  const form = await openDialog({
    title: 'ยืนยันการโอนเงินให้ช่าง',
    description: `ยอดเงินโอนสุทธิ: ${Number(netAmount).toLocaleString('th-TH')} บาท`,
    fields: [
      { name: 'slipUrl', label: 'ลิงก์รูปสลิปการโอนเงิน *', type: 'text', required: true, placeholder: 'https://...' },
      { name: 'notes', label: 'หมายเหตุเพิ่มเติม (ถ้ามี)', type: 'textarea' }
    ],
    confirmLabel: 'ยืนยันการโอนเงิน'
  });

  if (form?.slipUrl?.trim()) {
    try {
      await api(`/api/admin/finance/payouts/${payoutId}/confirm`, {
        method: 'POST',
        body: { transferSlipUrl: form.slipUrl.trim(), notes: form.notes?.trim() }
      });
      message('บันทึกการโอนเงินให้ช่างเรียบร้อยแล้ว');
      loadAdminFinance();
      loadAdminOverview();
    } catch (err) {
      message(err.message, true);
    }
  }
}

$('#btn-admin-export-csv')?.addEventListener('click', () => {
  window.open('/api/admin/finance/export.csv', '_blank');
});

// Module 8: Settings
async function loadAdminSettings() {
  try {
    const settings = await api('/api/admin/settings');
    $('#set-platform-fee').value = settings.platformFeePercent ?? 10;
    $('#set-announcement').value = settings.systemAnnouncement ?? '';
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

$('#admin-settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fee = Number($('#set-platform-fee').value);
  const announcement = $('#set-announcement').value.trim();
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: { platformFeePercent: fee, systemAnnouncement: announcement }
    });
    message('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
    loadAnnouncement();
  } catch (err) {
    message('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message, true);
  }
});

// Module 9: Audit Logs
async function loadAdminAuditLogs() {
  const tbody = $('#admin-audit-table-body');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center">กำลังโหลด...</td></tr>';
  try {
    const logs = await api('/api/admin/audit-logs');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center empty-state">ยังไม่มีประวัติการบันทึก</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map((l) => `
      <tr>
        <td>${new Date(l.created_at).toLocaleString('th-TH')}</td>
        <td>${escapeHtml(l.admin_email || 'แอดมิน')}</td>
        <td><span class="badge badge-ai">${escapeHtml(l.action)}</span></td>
        <td>${escapeHtml(l.target_type || '-')} (${escapeHtml(l.target_id?.slice(0, 8) || '-')})</td>
        <td>${escapeHtml(l.reason || '-')}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ========================================================
// AUTHENTICATION & SESSION MANAGEMENT
// ========================================================
function applyAuthState(user) {
  currentUser = user;
  const isLogged = Boolean(user);

  $('#nav-logged-out').hidden = isLogged;
  $('#nav-logged-in').hidden = !isLogged;
  $('#workspace').hidden = isLogged;

  if (isLogged) {
    $('#nav-username').textContent = user.displayName;
    $('#nav-avatar').textContent = (user.displayName || 'U')[0].toUpperCase();
    $('#menu-user-display').textContent = user.displayName;
    $('#menu-user-role').textContent = roleLabels[user.role] || user.role;
    
    // Switch to initial mode
    if (user.role === 'ADMIN') {
      switchPortalMode('ADMIN');
    } else if (user.role === 'TECHNICIAN') {
      switchPortalMode('TECHNICIAN');
    } else {
      switchPortalMode('CUSTOMER');
    }
  } else {
    $('#customer-portal').hidden = false;
    $('#tech-portal').hidden = true;
    $('#admin-portal').hidden = true;
    showCustomerView('home');
  }
}

// Login & Register Form Handlers
function showAuthForm(mode) {
  const isReg = mode === 'register';
  $('#login-form').hidden = isReg;
  $('#register-form').hidden = !isReg;
  $('#show-login').classList.toggle('button-primary', !isReg);
  $('#show-login').classList.toggle('button-secondary', isReg);
  $('#show-register').classList.toggle('button-primary', isReg);
  $('#show-register').classList.toggle('button-secondary', !isReg);
}

$('#show-login')?.addEventListener('click', () => showAuthForm('login'));
$('#show-register')?.addEventListener('click', () => showAuthForm('register'));

$('#register-form [name="role"]')?.addEventListener('change', (e) => {
  const isBusiness = e.target.value === 'CUSTOMER_BUSINESS';
  const companyField = $('#register-form .registration-company');
  if (companyField) companyField.hidden = !isBusiness;
});

$('#login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.get('email'), password: form.get('password') }
    });
    applyAuthState(res.user);
    message(`ยินดีต้อนรับคุณ ${res.user.displayName}`);
  } catch (err) {
    message(err.message, true);
  }
});

$('#register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  if (form.get('password') !== form.get('confirmPassword')) {
    message('รหัสผ่านและการยืนยันไม่ตรงกัน', true);
    return;
  }
  try {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: {
        role: form.get('role'),
        displayName: form.get('displayName'),
        email: form.get('email'),
        companyName: form.get('companyName') || undefined,
        password: form.get('password')
      }
    });
    applyAuthState(res.user);
    message('สมัครสมาชิกสำเร็จและเข้าสู่ระบบแล้ว');
  } catch (err) {
    message(err.message, true);
  }
});

// App Startup
async function initApp() {
  await loadStatus();
  await loadCatalog();
  await loadAnnouncement();

  try {
    const me = await api('/api/auth/me');
    if (me?.user) {
      applyAuthState(me.user);
    } else {
      applyAuthState(null);
    }
  } catch {
    applyAuthState(null);
  }
}

initApp();
