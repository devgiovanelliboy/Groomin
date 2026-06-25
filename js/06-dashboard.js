/* ============================================================
   BARBERSHOP DASHBOARD (owner / manager / receptionist)
   Tenant-isolated by currentShop()
   ============================================================ */
function dashShop(){const u=Session.effectiveUser;return DB.find('barbershops',u.barbershopId);}
let agendaDate=null,agendaView='dia',finPeriod='mes',crmSeg='todos';

function buildDashNav(shop){
  const a=shopAnalytics(shop.id);
  const nav=[{section:'Operação'},{id:'',label:'Dashboard',icon:'grid'},{id:'agenda',label:'Agenda',icon:'calendar',count:a.today.length}];
  if(can('use_pos')){const cs=DB.scope('cashSessions',shop.id).find(s=>s.status==='open');nav.push({id:'pdv',label:'PDV / Caixa',icon:'creditCard',count:cs?'•':null});}
  if(can('manage_customers'))nav.push({id:'clientes',label:'Clientes (CRM)',icon:'users',count:DB.scope('customers',shop.id).length});
  if(can('manage_services')||can('manage_barbers'))nav.push({section:'Catálogo'});
  if(can('manage_services'))nav.push({id:'servicos',label:'Serviços',icon:'list'});
  if(can('manage_services'))nav.push({id:'combos',label:'Combos & Pacotes',icon:'layers'});
  if(can('manage_barbers'))nav.push({id:'barbeiros',label:'Barbeiros',icon:'scissors'});
  if(can('manage_inventory')){const low=DB.scope('products',shop.id).filter(p=>p.qty<=p.minStock).length;nav.push({id:'estoque',label:'Estoque',icon:'box',count:low||null});}
  if(can('manage_marketing')||can('view_financial')||can('view_ai')||can('manage_commissions'))nav.push({section:'Gestão'});
  if(can('view_financial'))nav.push({id:'financeiro',label:'Financeiro',icon:'dollar'});
  if(can('manage_commissions'))nav.push({id:'comissoes',label:'Comissões',icon:'award'});
  if(can('manage_marketing'))nav.push({id:'marketing',label:'Marketing',icon:'megaphone'});
  if(can('view_ai'))nav.push({id:'ia',label:'Insights de IA',icon:'cpu'});
  if(can('manage_settings'))nav.push({section:'Conta'},{id:'assinatura',label:'Assinatura',icon:'creditCard'},{id:'config',label:'Configurações',icon:'settings'});
  nav.forEach(n=>{if(!n.section){const lk=featureLock(shop.id,n.id);if(lk){n.locked=true;n.lockPlan=lk.plan;n.lockLabel=lk.label;n.lockEnt=lk.enterprise;n.count=null;}}});
  return nav;
}
function renderDashboard(r){
  destroyCharts();
  const shop=dashShop();
  if(!shop){
    // Firebase: dados do tenant ainda não chegaram via onSnapshot — exibe skeleton enquanto aguarda
    if(window.__FB_ENABLED && Session.effectiveUser && Session.effectiveUser.barbershopId){
      $('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">
        <div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div>
        <div class="skeleton" style="width:200px;height:16px;border-radius:6px"></div>
        <p class="muted" style="font-size:13px">Carregando sua barbearia…</p>
      </div>`;
      // Fallback: se em 8s ainda não chegou, algo deu errado
      if(!window._dashLoadTimeout) window._dashLoadTimeout=setTimeout(()=>{
        window._dashLoadTimeout=null;
        if(!dashShop()){toast('Não foi possível carregar a barbearia. Tente recarregar.','err');}
      },8000);
      return;
    }
    toast('Conta sem barbearia vinculada.','err');location.hash=Session.effectiveUser?'#/login':'#/';return;
  }
  window._dashLoadTimeout&&clearTimeout(window._dashLoadTimeout);window._dashLoadTimeout=null;
  const sub=r.sub||'';
  const titles={'':'Dashboard',agenda:'Agenda',pdv:'PDV / Caixa',clientes:'Clientes (CRM)',barbeiros:'Barbeiros',servicos:'Serviços',combos:'Combos & Pacotes',marketing:'Marketing',estoque:'Estoque',financeiro:'Financeiro',comissoes:'Comissões',ia:'Insights de IA',assinatura:'Assinatura',config:'Configurações'};
  // guard sub-permission
  const permMap={pdv:'use_pos',clientes:'manage_customers',barbeiros:'manage_barbers',servicos:'manage_services',combos:'manage_services',marketing:'manage_marketing',estoque:'manage_inventory',financeiro:'view_financial',comissoes:'manage_commissions',ia:'view_ai',assinatura:'manage_settings',config:'manage_settings'};
  if(permMap[sub]&&!can(permMap[sub])){toast('Sem permissão para esta área.','err');location.hash='#/dashboard';return;}
  const renderers={'':dashOverview,agenda:dashAgenda,pdv:dashPDV,clientes:dashCRM,barbeiros:dashBarbers,servicos:dashServices,combos:dashCombos,marketing:dashMarketing,estoque:dashInventory,financeiro:dashFinance,comissoes:dashCommissions,ia:dashAI,assinatura:dashSubscription,config:dashConfig};
  const lock=featureLock(shop.id,sub);
  const content=lock?lockedFeaturePage(lock.label,lock.plan,lock.enterprise):(renderers[sub]||dashOverview)(shop);
  const tenantPill=`<div class="tenant-pill" onclick="Router.go('#/'+'${shop.slug}')"><div class="tl">${brandLogo(shop)}</div><div class="info"><b>${escapeHtml(shop.name)}</b><span>${DB.find('plans',shop.planId).name} · /${escapeHtml(shop.slug)}</span></div>${icon('eye')}</div>`;
  $('#root').innerHTML=mountShell({brandShop:shop,brandSub:'Gestão',nav:buildDashNav(shop),activeId:sub,navBase:'#/dashboard/',title:titles[sub]||'Painel',crumb:shop.name+' · '+ROLE_LABEL[Session.effectiveUser.role],content,tenantPill});
  if(!lock&&sub==='')dashOverviewCharts(shop);
  if(!lock&&sub==='financeiro')dashFinanceChart(shop);
  renderShellNotif();
}

/* ---------- Booking URL helpers ---------- */
function shopPublicUrl(slug){return window.location.origin+'/#/'+slug;}
function bookingUrlCard(shop){
  const fullUrl=shopPublicUrl(shop.slug);
  const displayUrl=fullUrl.replace(/^https?:\/\//,'');
  const waText=encodeURIComponent(`Agende na ${shop.name}: ${fullUrl}`);
  return `<div class="panel" style="border-color:var(--primary);background:linear-gradient(135deg,rgba(212,175,55,.07),transparent),var(--surface)">
    <div class="panel-head"><div><h3>${icon('link')} Link de Agendamento</h3><div class="sub">Compartilhe com seus clientes</div></div>
      <button class="btn btn-ghost btn-sm" onclick="Router.go('#/${shop.slug}')">${icon('eye')} Ver página</button></div>
    <div class="input" style="background:var(--surface-3);display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:default">
      <b style="color:var(--primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(displayUrl)}</b>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="groomCopyUrl('${shop.slug}')">${icon('copy')} Copiar link</button>
      <button class="btn btn-ghost btn-sm" onclick="Router.go('#/${shop.slug}')">${icon('externalLink')} Abrir</button>
      <a class="btn btn-ghost btn-sm" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
      <button class="btn btn-ghost btn-sm" onclick="groomQR('${shop.slug}','${escapeHtml(shop.name)}')">${icon('grid')} QR Code</button>
    </div>
  </div>`;
}
function groomCopyUrl(slug){
  const url=shopPublicUrl(slug);
  if(navigator.clipboard){navigator.clipboard.writeText(url).then(()=>toast('Link copiado!','ok')).catch(()=>groomFallbackCopy(url));}
  else groomFallbackCopy(url);
}
function groomFallbackCopy(text){
  const t=document.createElement('textarea');t.value=text;t.style.cssText='position:fixed;opacity:0';document.body.appendChild(t);t.select();
  try{document.execCommand('copy');toast('Link copiado!','ok');}catch(e){toast('Copie: '+text,'info');}document.body.removeChild(t);
}
function groomQR(slug,shopName){
  const url=shopPublicUrl(slug);
  openModal(`<div class="modal-head"><div><h3>${icon('grid')} QR Code</h3><div class="sub">${escapeHtml(shopName)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body" style="text-align:center">
    <div style="background:#fff;padding:20px;border-radius:12px;display:inline-block;margin-bottom:16px">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}&color=0f0f0f&bgcolor=ffffff" alt="QR Code" style="width:200px;height:200px;display:block" />
    </div>
    <p class="muted" style="font-size:13px;margin-bottom:16px">${escapeHtml(url)}</p>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn btn-primary" onclick="groomCopyUrl('${slug}')">${icon('copy')} Copiar link</button>
      <a class="btn btn-ghost" href="https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(url)}" download="qrcode-${slug}.png" target="_blank" rel="noopener">${icon('download')} Baixar QR</a>
    </div>
  </div>`);
}

/* ---------- Overview ---------- */
function dashOverview(shop){
  const a=shopAnalytics(shop.id);
  return `${bookingUrlCard(shop)}<div class="stat-grid">
    ${statCard('c1','calendar','Agendamentos hoje',a.today.length,a.occupancy+'% de ocupação')}
    ${statCard('c2','dollar','Receita hoje',money(a.revToday),'+8% vs ontem')}
    ${statCard('c3','trending','Receita do mês',money(a.revMonth),'+18% vs mês anterior')}
    ${statCard('c4','users','Novos clientes',a.newCustomers,a.returning+' recorrentes')}
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><div><h3>Receita — últimos 7 dias</h3><div class="sub">Faturamento diário</div></div><span class="badge ok">${icon('trending')} Em alta</span></div><div class="chart-wrap"><canvas id="dRev"></canvas></div></div>
    <div class="panel"><div class="panel-head"><h3>Status</h3></div><div class="chart-wrap chart-sm"><canvas id="dStatus"></canvas></div></div>
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Próximos agendamentos</h3><button class="btn btn-ghost btn-sm" onclick="Router.go('#/dashboard/agenda')">Ver agenda</button></div>
      ${a.upcoming.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Quando</th><th>Status</th></tr></thead><tbody>${a.upcoming.slice(0,6).map(ap=>{const s=DB.find('services',ap.serviceId),b=DB.find('barbers',ap.barberId);return `<tr><td><div class="t-user"><div class="av">${initials(ap.customerName)}</div><div><b>${escapeHtml(ap.customerName)}</b><small>${escapeHtml(ap.phone)}</small></div></div></td><td>${s?escapeHtml(s.name):'—'}</td><td>${b?escapeHtml(b.name.split(' ')[0]):'—'}</td><td>${fmtDateShort(ap.date)} · ${ap.time}</td><td><span class="badge ${STATUS[ap.status].cls}">${STATUS[ap.status].label}</span></td></tr>`;}).join('')}</tbody></table></div>`:emptyState('calendar','Sem agendamentos','Novos agendamentos aparecem aqui.')}
    </div>
    <div class="panel"><div class="panel-head"><h3>Destaques</h3></div>
      ${a.topBarber?`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('award')}</span><div><b>Barbeiro destaque</b><br><small>${escapeHtml(a.topBarber[0])} · ${a.topBarber[1]} atendimentos</small></div></div>`:''}
      ${a.topServices[0]?`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('star')}</span><div><b>Serviço mais procurado</b><br><small>${escapeHtml(a.topServices[0][0])} · ${a.topServices[0][1]}x</small></div></div>`:''}
      <div class="mini-slot" style="margin:0"><span class="ic">${icon('target')}</span><div><b>Taxa de ocupação</b><br><small>${a.occupancy}% da capacidade de hoje</small></div></div>
      <div class="progress" style="margin-top:12px"><i style="width:${a.occupancy}%"></i></div>
    </div>
  </div>`;
}
function dashOverviewCharts(shop){
  const a=shopAnalytics(shop.id);
  mkChart('dRev','line',{labels:a.days,datasets:[{data:a.revSeries,borderColor:GOLD,backgroundColor:'rgba(212,175,55,.14)',fill:true,tension:.4,borderWidth:3,pointRadius:4,pointBackgroundColor:GOLD}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});
  const sd=a.byStatus;mkChart('dStatus','doughnut',{labels:['Confirmado','Pendente','Concluído','Cancelado'],datasets:[{data:[sd.confirmado,sd.pendente,sd.concluido,sd.cancelado],backgroundColor:[GREEN,AMBER,BRONZE,RED],borderWidth:0}]},{cutout:'64%',plugins:{legend:{position:'bottom',labels:{padding:12,usePointStyle:true}}}});
}

/* ---------- Agenda ---------- */
function dashAgenda(shop){
  if(!agendaDate)agendaDate=DB.todayISO();
  const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  const dayAppts=DB.scope('appointments',shop.id).filter(a=>a.date===agendaDate);
  const blocks=DB.scope('blocks',shop.id).filter(b=>b.date===agendaDate);
  const canManage=can('manage_appointments');
  let body;
  if(agendaView==='lista'){
    const list=DB.scope('appointments',shop.id).slice().sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
    body=list.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Data</th><th>Hora</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${list.map(ap=>apptRow(ap)).join('')}</tbody></table></div>`:emptyState('calendar','Sem agendamentos','Crie o primeiro agendamento.');
  }else{
    body=`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${barbers.map(b=>{
      const evs=dayAppts.filter(a=>a.barberId===b.id).sort((x,y)=>x.time.localeCompare(y.time));
      const bls=blocks.filter(x=>x.barberId===b.id);
      return `<div class="panel" style="margin:0"><div class="panel-head" style="margin-bottom:12px"><div class="t-user"><div class="av">${initials(b.name)}</div><div><b>${escapeHtml(b.name.split(' ')[0])}</b><small>${b.start}–${b.end}</small></div></div></div>
        ${bls.map(x=>`<div class="cal-event blocked"><b>${x.fullDay?'Dia bloqueado':x.start+'–'+x.end}</b><small>${escapeHtml(x.reason||'Bloqueio')}</small></div>`).join('')}
        ${evs.length?evs.map(ap=>{const s=DB.find('services',ap.serviceId);return `<div class="cal-event s-${ap.status}" onclick="apptForm('${ap.id}')"><b>${ap.time} · ${s?escapeHtml(s.name):''}</b><small>${escapeHtml(ap.customerName)}</small></div>`;}).join(''):(bls.length?'':`<p class="muted" style="font-size:13px;text-align:center;padding:14px 0">Livre</p>`)}
      </div>`;}).join('')||emptyState('users','Sem barbeiros','Cadastre profissionais para ver a agenda.')}</div>`;
  }
  return `<div class="page-head"><div><h2>Agenda</h2><p>${dayAppts.filter(a=>a.status!=='cancelado').length} agendamento(s) em ${fmtDate(agendaDate)}</p></div>
    <div class="page-actions">
      ${canManage?`<button class="btn btn-ghost" onclick="blockForm()">${icon('lock')} Bloquear</button>`:''}
      ${canManage?`<button class="btn btn-primary" onclick="apptForm()">${icon('plus')} Novo agendamento</button>`:''}
    </div></div>
  <div class="toolbar">
    <div class="seg"><button class="${agendaView==='dia'?'on':''}" onclick="agendaView='dia';refreshShell()">Dia</button><button class="${agendaView==='lista'?'on':''}" onclick="agendaView='lista';refreshShell()">Lista</button></div>
    ${agendaView==='dia'?`<div style="display:flex;gap:8px;align-items:center"><button class="icon-btn" onclick="agendaDate=DB.addDays(agendaDate,-1);refreshShell()">${icon('arrowLeft')}</button><input class="input" type="date" style="width:auto" value="${agendaDate}" onchange="agendaDate=this.value;refreshShell()"><button class="icon-btn" onclick="agendaDate=DB.addDays(agendaDate,1);refreshShell()">${icon('arrowRight')}</button><button class="btn btn-ghost btn-sm" onclick="agendaDate=DB.todayISO();refreshShell()">Hoje</button></div>`:''}
  </div>
  ${body}`;
}
function apptRow(ap){const s=DB.find('services',ap.serviceId),b=DB.find('barbers',ap.barberId);const canManage=can('manage_appointments');
  const consumed=(ap.consumption&&ap.consumption.length)?` <span class="badge gold" title="Consumo registrado">${icon('droplet')}</span>`:'';
  return `<tr><td><div class="t-user"><div class="av">${initials(ap.customerName)}</div><div><b>${escapeHtml(ap.customerName)}</b><small>${escapeHtml(ap.phone)}</small></div></div></td><td>${s?escapeHtml(s.name):'—'}</td><td>${b?escapeHtml(b.name):'—'}</td><td>${fmtDate(ap.date)}</td><td>${ap.time}</td><td>${money(ap.price)}${consumed}</td><td><span class="badge ${STATUS[ap.status].cls}">${STATUS[ap.status].label}</span></td><td><div class="row-actions">${canManage&&ap.status!=='cancelado'&&can('manage_inventory')?`<button class="ra" title="Registrar consumo de produtos" onclick="consumeForm('${ap.id}')">${icon('droplet')}</button>`:''}${canManage&&ap.status!=='concluido'&&ap.status!=='cancelado'?`<button class="ra" title="Concluir" onclick="apptStatus('${ap.id}','concluido')">${icon('check')}</button>`:''}${canManage?`<button class="ra" title="Editar" onclick="apptForm('${ap.id}')">${icon('edit')}</button>`:''}${canManage&&ap.status!=='cancelado'?`<button class="ra del" title="Cancelar" onclick="apptStatus('${ap.id}','cancelado')">${icon('x')}</button>`:''}</div></td></tr>`;}
function apptStatus(id,status){DB.update('appointments',id,{status});const ap=DB.find('appointments',id);if(status==='cancelado')DB.insert('notifications',{barbershopId:ap.barbershopId,type:'cancel',title:'Cancelamento',msg:`${ap.customerName} — ${fmtDateShort(ap.date)} ${ap.time}`,time:Date.now(),read:false});DB.log(status==='cancelado'?'Agendamento cancelado':'Agendamento concluído',ap.customerName,ap.barbershopId);toast('Status atualizado.',status==='cancelado'?'info':'ok');refreshShell();}
function apptForm(id){
  const shop=dashShop();const ap=id?DB.find('appointments',id):null;
  const svcs=DB.scope('services',shop.id),barbers=DB.scope('barbers',shop.id);
  const apSvcName=ap?(DB.find('services',ap.serviceId)||{}).name||'':'';
  const apBarberName=ap?(DB.find('barbers',ap.barberId)||{}).name||'':'';
  const waPhone=ap&&ap.phone?ap.phone.replace(/\D/g,''):'';
  const waMsg=ap&&waPhone?encodeURIComponent(`Olá, ${ap.customerName}! Lembrando do seu agendamento na ${shop.name}: ${apSvcName} com ${apBarberName} em ${fmtDate(ap.date)} às ${ap.time}. Qualquer dúvida é só chamar! 💈`):'';
  const waBtn=ap&&waPhone?`<a class="btn btn-ghost btn-sm" href="https://wa.me/55${waPhone}?text=${waMsg}" target="_blank" rel="noopener" style="margin-right:auto">${icon('whatsapp')} Lembrete WhatsApp</a>`:'';
  openModal(`<div class="modal-head"><div><h3>${ap?'Editar':'Novo'} agendamento</h3></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Cliente *</label><input class="input" id="ap_name" value="${ap?escapeHtml(ap.customerName):''}" placeholder="Nome"><div class="err">Informe o cliente.</div></div>
    <div class="field"><label>WhatsApp *</label><input class="input" id="ap_phone" value="${ap?escapeHtml(ap.phone):''}" placeholder="(11) 90000-0000"><div class="err">Informe o telefone.</div></div>
    <div class="form-row">
      <div class="field"><label>Serviço *</label><select class="input" id="ap_svc">${svcs.map(s=>`<option value="${s.id}" ${ap&&ap.serviceId===s.id?'selected':''}>${escapeHtml(s.name)} — ${money(s.price)}</option>`).join('')}</select></div>
      <div class="field"><label>Profissional *</label><select class="input" id="ap_barber">${barbers.map(b=>`<option value="${b.id}" ${ap&&ap.barberId===b.id?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Data *</label><input class="input" type="date" id="ap_date" value="${ap?ap.date:agendaDate||DB.todayISO()}" min="${DB.todayISO()}"></div>
      <div class="field"><label>Hora *</label><input class="input" type="time" id="ap_time" value="${ap?ap.time:'09:00'}"></div>
    </div>
    <div class="field"><label>Status</label><select class="input" id="ap_status">${Object.entries(STATUS).map(([k,v])=>`<option value="${k}" ${ap?(ap.status===k?'selected':''):(k==='confirmado'?'selected':'')}>${v.label}</option>`).join('')}</select></div>
  </div>
  <div class="modal-foot">${waBtn}<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveAppt('${id||''}')">Salvar</button></div>`);
}
function saveAppt(id){
  const shop=dashShop();const name=$('#ap_name').value.trim(),phone=$('#ap_phone').value.trim();
  if(name.length<2||phone.length<8){toast('Preencha cliente e telefone.','err');return;}
  const svcId=$('#ap_svc').value,svc=DB.find('services',svcId);const barberId=$('#ap_barber').value;const date=$('#ap_date').value,time=$('#ap_time').value,status=$('#ap_status').value;
  if(!id||status!=='cancelado'){
    const slot=barberSlots(shop.id,barberId,date,svc.duration).find(s=>s.time===time);
    const conflict=DB.scope('appointments',shop.id).some(a=>a.id!==id&&a.barberId===barberId&&a.date===date&&a.time===time&&a.status!=='cancelado');
    if(conflict){toast('Já existe agendamento neste horário para o profissional.','err');return;}
  }
  const data={customerName:name,phone,serviceId:svcId,barberId,date,time,status,price:svc.price};
  if(id){DB.update('appointments',id,data);DB.log('Agendamento editado',name,shop.id);toast('Agendamento atualizado.','ok');}
  else{let cust=DB.scope('customers',shop.id).find(c=>c.phone===phone);if(!cust)cust=DB.insert('customers',{barbershopId:shop.id,name,phone,whatsapp:phone,email:'',birthday:'',notes:''});data.barbershopId=shop.id;data.customerId=cust.id;data.createdAt=Date.now();DB.insert('appointments',data);DB.log('Agendamento criado',name,shop.id);toast('Agendamento criado.','ok');}
  closeModal();refreshShell();
}
function blockForm(){
  const shop=dashShop();const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  openModal(`<div class="modal-head"><div><h3>Bloquear horário</h3><div class="sub">Indisponibilize um período ou dia inteiro</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Profissional</label><select class="input" id="bl_barber">${barbers.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Data</label><input class="input" type="date" id="bl_date" value="${agendaDate||DB.todayISO()}" min="${DB.todayISO()}"></div>
    <div class="checkbox-row"><div class="switch" id="bl_full" onclick="this.classList.toggle('on');$('#bl_times').style.display=this.classList.contains('on')?'none':'grid'"></div><label style="margin:0">Bloquear o dia inteiro</label></div>
    <div class="form-row" id="bl_times"><div class="field"><label>Início</label><input class="input" type="time" id="bl_start" value="12:00"></div><div class="field"><label>Fim</label><input class="input" type="time" id="bl_end" value="13:00"></div></div>
    <div class="field"><label>Motivo</label><input class="input" id="bl_reason" placeholder="Ex.: almoço, compromisso..."></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveBlock()">Bloquear</button></div>`);
}
function saveBlock(){const shop=dashShop();const full=$('#bl_full').classList.contains('on');DB.insert('blocks',{barbershopId:shop.id,barberId:$('#bl_barber').value,date:$('#bl_date').value,start:$('#bl_start').value,end:$('#bl_end').value,reason:$('#bl_reason').value.trim(),fullDay:full});DB.log('Horário bloqueado',$('#bl_date').value,shop.id);closeModal();toast('Bloqueio criado.','ok');refreshShell();}

/* ---------- CRM ---------- */
function customerStats(shopId,custId){
  const appts=DB.scope('appointments',shopId).filter(a=>a.customerId===custId&&a.status!=='cancelado');
  const done=appts.filter(a=>a.status==='concluido');
  const totalSpent=done.reduce((s,a)=>s+a.price,0);
  const last=appts.map(a=>a.date).sort().pop();
  const svcCount={},barbCount={};
  appts.forEach(a=>{const s=DB.find('services',a.serviceId);if(s)svcCount[s.name]=(svcCount[s.name]||0)+1;const b=DB.find('barbers',a.barberId);if(b)barbCount[b.name]=(barbCount[b.name]||0)+1;});
  const favSvc=Object.entries(svcCount).sort((a,b)=>b[1]-a[1])[0];
  const favBarb=Object.entries(barbCount).sort((a,b)=>b[1]-a[1])[0];
  const daysSince=last?Math.floor((Date.now()-new Date(last+'T00:00:00'))/86400000):999;
  let seg='novo';if(totalSpent>=500)seg='vip';else if(appts.length>=5)seg='frequente';if(daysSince>30&&appts.length>0)seg='inativo';
  return {visits:appts.length,totalSpent,last,favSvc:favSvc?favSvc[0]:'—',favBarb:favBarb?favBarb[0]:'—',daysSince,seg};
}
function dashCRM(shop){
  const customers=DB.scope('customers',shop.id).map(c=>({...c,st:customerStats(shop.id,c.id)}));
  const counts={todos:customers.length,vip:customers.filter(c=>c.st.seg==='vip').length,frequente:customers.filter(c=>c.st.seg==='frequente').length,inativo:customers.filter(c=>c.st.seg==='inativo').length,novo:customers.filter(c=>c.st.seg==='novo').length};
  const list=crmSeg==='todos'?customers:customers.filter(c=>c.st.seg===crmSeg);
  const segCard=(k,label,ic,color)=>`<div class="seg-card ${crmSeg===k?'sel':''}" onclick="crmSeg='${k}';refreshShell()"><div class="sc-ic si ${color}">${icon(ic)}</div><b>${counts[k]}</b><span>${label}</span></div>`;
  return `<div class="page-head"><div><h2>Clientes (CRM)</h2><p>Inteligência de relacionamento e fidelização</p></div><div class="page-actions">${can('manage_marketing')?`<button class="btn btn-ghost" onclick="sendSegmentCampaign('${crmSeg}')">${icon('megaphone')} Campanha p/ segmento</button>`:''}<button class="btn btn-primary" onclick="customerForm()">${icon('plus')} Novo cliente</button></div></div>
  <div class="seg-grid">${segCard('todos','Todos','users','c1')}${segCard('vip','VIP','award','c4')}${segCard('frequente','Frequentes','heart','c2')}${segCard('inativo','Inativos','clock','c5')}${segCard('novo','Novos','sparkle','c3')}</div>
  ${list.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Segmento</th><th>Visitas</th><th>Total gasto</th><th>Última visita</th><th>Favorito</th><th></th></tr></thead><tbody>
  ${list.map(c=>{const segB={vip:['gold','VIP'],frequente:['ok','Frequente'],inativo:['danger','Inativo'],novo:['info','Novo'],todos:['muted','-']}[c.st.seg];return `<tr>
    <td><div class="t-user"><div class="av">${initials(c.name)}</div><div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.phone)}</small></div></div></td>
    <td><span class="badge ${segB[0]}">${segB[1]}</span></td><td>${c.st.visits}</td><td><b>${money(c.st.totalSpent)}</b></td>
    <td>${c.st.last?fmtDateShort(c.st.last)+' ('+c.st.daysSince+'d)':'—'}</td><td class="muted">${escapeHtml(c.st.favSvc)}</td>
    <td><div class="row-actions">${(c.whatsapp||c.phone)?`<a class="ra wpp" title="WhatsApp" href="https://wa.me/55${(c.whatsapp||c.phone).replace(/\D/g,'')}?text=${encodeURIComponent('Olá, '+c.name+'! Aqui é da '+shop.name+'. Como posso te ajudar?')}" target="_blank" rel="noopener">${icon('whatsapp')}</a>`:''}<button class="ra" title="Detalhes" onclick="customerDetail('${c.id}')">${icon('eye')}</button><button class="ra" title="Editar" onclick="customerForm('${c.id}')">${icon('edit')}</button><button class="ra del" onclick="delCustomer('${c.id}')">${icon('trash')}</button></div></td></tr>`;}).join('')}
  </tbody></table></div>`:emptyState('users','Nenhum cliente neste segmento','Os clientes aparecem aqui conforme o histórico.')}`;
}
function customerDetail(id){
  const shop=dashShop();const c=DB.find('customers',id);const st=customerStats(shop.id,id);
  const hist=DB.scope('appointments',shop.id).filter(a=>a.customerId===id).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
  openModal(`<div class="modal-head"><div class="t-user"><div class="av" style="width:44px;height:44px">${initials(c.name)}</div><div><h3>${escapeHtml(c.name)}</h3><div class="sub">${escapeHtml(c.phone)} · ${escapeHtml(c.email||'sem e-mail')}</div></div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="stat-grid" style="margin-bottom:14px"><div class="stat"><div class="lbl">Visitas</div><div class="val">${st.visits}</div></div><div class="stat"><div class="lbl">Total gasto</div><div class="val" style="font-size:22px">${money(st.totalSpent)}</div></div><div class="stat"><div class="lbl">Última visita</div><div class="val" style="font-size:18px">${st.last?fmtDateShort(st.last):'—'}</div></div></div>
    <div class="summary-line"><span class="muted">Serviço favorito</span><b>${escapeHtml(st.favSvc)}</b></div>
    <div class="summary-line"><span class="muted">Profissional favorito</span><b>${escapeHtml(st.favBarb)}</b></div>
    <div class="summary-line"><span class="muted">Aniversário</span><b>${c.birthday?fmtDate(c.birthday):'—'}</b></div>
    ${c.notes?`<div class="summary-line"><span class="muted">Observações</span><b>${escapeHtml(c.notes)}</b></div>`:''}
    <h4 style="margin:18px 0 10px">Histórico</h4>
    ${hist.length?hist.slice(0,8).map(ap=>{const s=DB.find('services',ap.serviceId);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('scissors')}</span><div><b>${s?escapeHtml(s.name):'—'}</b><br><small>${fmtDate(ap.date)} · ${ap.time}</small></div><span class="badge ${STATUS[ap.status].cls}" style="margin-left:auto">${STATUS[ap.status].label}</span></div>`;}).join(''):'<p class="muted">Sem histórico.</p>'}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="closeModal();startBooking('${shop.id}')">${icon('calendar')} Agendar</button></div>`);
}
function customerForm(id){
  const shop=dashShop();const c=id?DB.find('customers',id):null;
  openModal(`<div class="modal-head"><h3>${c?'Editar':'Novo'} cliente</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="cu_name" value="${c?escapeHtml(c.name):''}"><div class="err">Informe o nome.</div></div>
    <div class="form-row"><div class="field"><label>Telefone *</label><input class="input" id="cu_phone" value="${c?escapeHtml(c.phone):''}"></div><div class="field"><label>WhatsApp</label><input class="input" id="cu_wa" value="${c?escapeHtml(c.whatsapp||''):''}"></div></div>
    <div class="form-row"><div class="field"><label>E-mail</label><input class="input" id="cu_email" value="${c?escapeHtml(c.email||''):''}"></div><div class="field"><label>Aniversário</label><input class="input" type="date" id="cu_bday" value="${c?c.birthday||'':''}"></div></div>
    <div class="field"><label>Observações</label><textarea class="input" id="cu_notes">${c?escapeHtml(c.notes||''):''}</textarea></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCustomer('${id||''}')">Salvar</button></div>`);
}
function saveCustomer(id){const shop=dashShop();const name=$('#cu_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const data={name,phone:$('#cu_phone').value.trim(),whatsapp:$('#cu_wa').value.trim(),email:$('#cu_email').value.trim(),birthday:$('#cu_bday').value,notes:$('#cu_notes').value.trim()};if(id)DB.update('customers',id,data);else DB.insert('customers',{barbershopId:shop.id,...data});DB.log(id?'Cliente editado':'Cliente criado',name,shop.id);closeModal();toast('Cliente salvo.','ok');refreshShell();}
function delCustomer(id){confirmAction('Excluir cliente?','O histórico de agendamentos será mantido.',()=>{DB.remove('customers',id);toast('Cliente excluído.','info');refreshShell();});}
function sendSegmentCampaign(seg){const shop=dashShop();const customers=DB.scope('customers',shop.id).filter(c=>seg==='todos'||customerStats(shop.id,c.id).seg===seg);toast(`Campanha enviada para ${customers.length} cliente(s) via WhatsApp/e-mail.`,'ok');DB.log('Campanha enviada','Segmento: '+seg,shop.id);}

/* ---------- Barbers ---------- */
function dashBarbers(shop){
  const list=DB.scope('barbers',shop.id);
  const active=list.filter(b=>b.active).length;
  const e=shopEntitlements(shop.id);const lim=e.limitBarbers>=999?'∞':e.limitBarbers;
  return `<div class="page-head"><div><h2>Barbeiros</h2><p>${active}/${lim} ativo(s) · plano ${escapeHtml(e.planName)}${active>=e.limitBarbers&&e.limitBarbers<999?' · <span style="color:var(--warn)">limite atingido</span>':''}</p></div><div class="page-actions"><button class="btn btn-primary" onclick="barberForm()">${icon('plus')} Novo barbeiro</button></div></div>
  <div class="barber-grid">${list.map(b=>{const st=DB.scope('appointments',shop.id).filter(a=>a.barberId===b.id&&a.status==='concluido');const rev=st.reduce((s,a)=>s+a.price,0);return `<div class="barber-card" style="${b.active?'':'opacity:.66'}"><div class="ph">${imageOrInitials(b.photoUrl,b.name,'barber-photo')}<span class="badge ${b.active?'ok':'muted'}" style="position:absolute;top:12px;right:12px">${b.active?'Ativo':'Inativo'}</span>${b.isOwner?`<span class="badge gold" style="position:absolute;top:12px;left:12px">${icon('award')} Dono</span>`:''}</div><div class="bbody"><h3>${escapeHtml(b.name)}</h3><div class="role">${escapeHtml(b.role)} · ${b.rating}★</div><div class="spec">${b.specialties.map(s=>`<span class="tag">${escapeHtml(s)}</span>`).join('')}</div><div class="summary-line" style="margin-top:10px"><span class="muted">Comissão serv./prod.</span><b>${b.commission||0}% / ${b.productCommission??10}%</b></div><div class="summary-line"><span class="muted">Faturou</span><b>${money(rev)}</b></div><div class="summary-line"><span class="muted">Expediente</span><b>${b.start}–${b.end}</b></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-ghost btn-sm" style="flex:1" onclick="barberForm('${b.id}')">${icon('edit')} Editar</button><button class="btn btn-sm ${b.active?'btn-ghost':'btn-primary'}" onclick="toggleBarberActive('${b.id}')">${b.active?'Inativar':'Ativar'}</button>${b.isOwner?'':`<button class="ra del" title="Excluir" onclick="delBarber('${b.id}')">${icon('trash')}</button>`}</div></div></div>`;}).join('')||emptyState('scissors','Sem barbeiros','Cadastre o primeiro profissional.')}</div>`;
}
function toggleBarberActive(id){
  const shop=dashShop();const b=DB.find('barbers',id);
  if(!b||b.barbershopId!==shop.id){toast('Barbeiro inválido.','err');return;} // tenant guard
  const turningOff=b.active;
  if(!turningOff){const e=shopEntitlements(shop.id);const active=DB.scope('barbers',shop.id).filter(x=>x.active).length;if(active>=e.limitBarbers){toast(`Seu plano (${e.planName}) permite ${e.limitBarbers} profissional(is) ativo(s). Faça upgrade para ativar mais.`,'err');return;}}
  const future=DB.scope('appointments',shop.id).filter(a=>a.barberId===id&&a.date>=DB.todayISO()&&(a.status==='confirmado'||a.status==='pendente')).length;
  const apply=()=>{DB.update('barbers',id,{active:!b.active});DB.log(turningOff?'Barbeiro inativado':'Barbeiro ativado',b.name,shop.id);toast(turningOff?`${b.name.split(' ')[0]} inativado — não aparece mais na agenda.`:`${b.name.split(' ')[0]} ativado.`,turningOff?'info':'ok');refreshShell();};
  if(turningOff&&future>0)confirmAction('Inativar barbeiro?',`${b.name} tem ${future} agendamento(s) futuro(s). Ele deixará de aparecer para novos agendamentos, mas os já marcados continuam na agenda. Deseja continuar?`,apply,false);
  else apply();
}
function barberForm(id){
  const shop=dashShop();const b=id?DB.find('barbers',id):null;const days=b?b.days:[1,2,3,4,5,6];
  openModal(`<div class="modal-head"><h3>${b?'Editar':'Novo'} barbeiro</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="form-row"><div class="field"><label>Nome *</label><input class="input" id="ba_name" value="${b?escapeHtml(b.name):''}"></div><div class="field"><label>Cargo</label><input class="input" id="ba_role" value="${b?escapeHtml(b.role):'Barbeiro'}"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="ba_phone" value="${b?escapeHtml(b.phone||''):''}"></div><div class="field"><label>E-mail</label><input class="input" id="ba_email" value="${b?escapeHtml(b.email||''):''}"></div></div>
    <div class="field"><label>Foto do barbeiro</label>
      <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
        <div id="ba_photo_preview" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:var(--primary-soft);display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;color:var(--primary);flex-shrink:0">
          ${b&&b.photoUrl?`<img src="${escapeHtml(b.photoUrl)}" alt="${escapeHtml(b.name)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`:`<span>${initials(b?b.name:'')}</span>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="btn btn-ghost btn-sm" for="ba_photo_file" style="cursor:pointer;margin:0">${icon('upload')} ${b&&b.photoUrl?'Substituir foto':'Adicionar foto'}</label>
          ${b&&b.photoUrl?`<button type="button" class="btn btn-ghost btn-sm remove-photo-btn" onclick="clearBarberPhoto()" style="color:var(--danger);margin:0">${icon('trash')} Remover foto</button>`:''}
          <small class="muted" style="margin:0">PNG, JPG ou WEBP · máx. 5MB</small>
        </div>
      </div>
      <input type="file" id="ba_photo_file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewBarberPhoto(this)">
      <input type="hidden" id="ba_photo_remove" value="0">
    </div>
    <div class="field"><label>Biografia</label><textarea class="input" id="ba_bio">${b?escapeHtml(b.bio||''):''}</textarea></div>
    <div class="field"><label>Especialidades (vírgula)</label><input class="input" id="ba_spec" value="${b?escapeHtml(b.specialties.join(', ')):''}" placeholder="Corte, Barba"></div>
    <div class="form-row"><div class="field"><label>Comissão serviços (%)</label><input class="input" type="number" min="0" max="100" id="ba_comm" value="${b?b.commission:50}"></div><div class="field"><label>Comissão produtos (%)</label><input class="input" type="number" min="0" max="100" id="ba_pcomm" value="${b?(b.productCommission??10):10}"></div></div>
    <div class="form-row"><div class="field"><label>Início</label><input class="input" type="time" id="ba_start" value="${b?b.start:'09:00'}"></div><div class="field"><label>Fim</label><input class="input" type="time" id="ba_end" value="${b?b.end:'19:00'}"></div></div>
    <div class="form-row"><div class="field"><label>Almoço início</label><input class="input" type="time" id="ba_ls" value="${b?b.lunchStart||'12:00':'12:00'}"></div><div class="field"><label>Almoço fim</label><input class="input" type="time" id="ba_le" value="${b?b.lunchEnd||'13:00':'13:00'}"></div></div>
    <div class="field"><label>Dias de trabalho</label><div class="chips" id="ba_days">${DOW.map((d,i)=>`<span class="chip-toggle ${days.includes(i)?'on':''}" data-day="${i}" onclick="this.classList.toggle('on')">${d}</span>`).join('')}</div></div>
    <div class="form-row"><div class="field"><label>Férias início</label><input class="input" type="date" id="ba_vs" value="${b&&b.vacations[0]?b.vacations[0].start:''}"></div><div class="field"><label>Férias fim</label><input class="input" type="date" id="ba_ve" value="${b&&b.vacations[0]?b.vacations[0].end:''}"></div></div>
    <div class="checkbox-row"><div class="switch ${!b||b.active?'on':''}" id="ba_active" onclick="this.classList.toggle('on')"></div><label style="margin:0">Profissional ativo</label></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveBarber('${id||''}')">Salvar</button></div>`);
}
function previewCover(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=e=>{const p=$('#cf_cover_preview');if(!p)return;p.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;};reader.readAsDataURL(file);}
function previewBarberPhoto(input){const file=input.files[0];if(!file)return;const rem=$('#ba_photo_remove');if(rem)rem.value='0';const reader=new FileReader();reader.onload=e=>{const p=$('#ba_photo_preview');if(!p)return;p.innerHTML=`<img src="${e.target.result}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;};reader.readAsDataURL(file);}
function clearBarberPhoto(){const rem=$('#ba_photo_remove');if(rem)rem.value='1';const fi=$('#ba_photo_file');if(fi)fi.value='';const p=$('#ba_photo_preview');if(p){const n=$('#ba_name');p.innerHTML=`<span>${initials(n?n.value:'?')}</span>`;}$$('.remove-photo-btn').forEach(b=>b.style.display='none');}
async function saveBarber(id){const shop=dashShop();const name=$('#ba_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const days=$$('#ba_days .chip-toggle.on').map(e=>+e.dataset.day);const vs=$('#ba_vs').value,ve=$('#ba_ve').value;const old=id?DB.find('barbers',id):null;const data={name,role:$('#ba_role').value.trim()||'Barbeiro',phone:$('#ba_phone').value.trim(),email:$('#ba_email').value.trim(),bio:$('#ba_bio').value.trim(),specialties:$('#ba_spec').value.split(',').map(s=>s.trim()).filter(Boolean),commission:+$('#ba_comm').value||0,productCommission:+$('#ba_pcomm').value||0,start:$('#ba_start').value,end:$('#ba_end').value,lunchStart:$('#ba_ls').value,lunchEnd:$('#ba_le').value,days,vacations:vs&&ve?[{start:vs,end:ve}]:[],active:$('#ba_active').classList.contains('on')};
  const shouldRemove=$('#ba_photo_remove')&&$('#ba_photo_remove').value==='1';
  if(shouldRemove){if(old&&old.photoPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(old.photoPath).catch(()=>{});data.photoUrl='';data.photoPath='';}
  else{const file=$('#ba_photo_file')&&$('#ba_photo_file').files[0];if(file&&window.fbUploadTenantImage){try{toast('Enviando foto...','info');const up=await fbUploadTenantImage(shop.id,'barbers',file,old&&old.photoPath);data.photoUrl=up.url;data.photoPath=up.path;}catch(e){toast(e.code==='image-too-large'?'Imagem maior que 5MB.':e.code==='storage-not-configured'?'Firebase Storage ainda não foi configurado.':'Não foi possível enviar a foto.','err');return;}}}
  if(!id&&data.active){const e=shopEntitlements(shop.id);const active=DB.scope('barbers',shop.id).filter(x=>x.active).length;if(active>=e.limitBarbers){toast(`Seu plano (${e.planName}) permite ${e.limitBarbers} profissional(is) ativo(s). Faça upgrade ou cadastre como inativo.`,'err');return;}}
  if(id)DB.update('barbers',id,data);else DB.insert('barbers',{barbershopId:shop.id,rating:5,...data});DB.log(id?'Barbeiro editado':'Barbeiro criado',name,shop.id);closeModal();toast('Barbeiro salvo.','ok');refreshShell();}
function delBarber(id){confirmAction('Excluir barbeiro?','Esta ação não pode ser desfeita.',()=>{const b=DB.find('barbers',id);DB.remove('barbers',id);if(b&&b.photoPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(b.photoPath).catch(()=>{});toast('Barbeiro excluído.','info');refreshShell();});}

/* ---------- Services ---------- */
function dashServices(shop){
  const list=DB.scope('services',shop.id);
  return `<div class="page-head"><div><h2>Serviços</h2><p>${list.length} serviço(s)</p></div><div class="page-actions"><button class="btn btn-primary" onclick="serviceForm()">${icon('plus')} Novo serviço</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Preço</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(s=>`<tr><td><div class="t-user"><div class="av">${icon(s.icon||'scissors')}</div><div><b>${escapeHtml(s.name)}</b><small>${escapeHtml((s.desc||'').slice(0,38))}</small></div></div></td><td><span class="tag">${escapeHtml(s.category)}</span></td><td>${s.duration} min</td><td><b>${money(s.price)}</b></td><td><span class="badge ${s.active?'ok':'muted'}">${s.active?'Ativo':'Inativo'}</span></td><td><div class="row-actions"><button class="ra" onclick="serviceForm('${s.id}')">${icon('edit')}</button><button class="ra del" onclick="delService('${s.id}')">${icon('trash')}</button></div></td></tr>`).join('')||`<tr><td colspan="6">${emptyState('list','Sem serviços','Cadastre o primeiro serviço.')}</td></tr>`}
  </tbody></table></div>`;
}
function serviceForm(id){
  const shop=dashShop();const s=id?DB.find('services',id):null;const cats=['Cabelo','Barba','Combo','Estética','Tratamento'];const icons=['scissors','user','star','eye','droplet','zap','sparkle'];
  openModal(`<div class="modal-head"><h3>${s?'Editar':'Novo'} serviço</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="sv_name" value="${s?escapeHtml(s.name):''}"><div class="err">Informe o nome.</div></div>
    <div class="field"><label>Descrição</label><textarea class="input" id="sv_desc">${s?escapeHtml(s.desc||''):''}</textarea></div>
    <div class="form-row"><div class="field"><label>Duração (min) *</label><input class="input" type="number" min="5" step="5" id="sv_dur" value="${s?s.duration:30}"></div><div class="field"><label>Preço (R$) *</label><input class="input" type="number" min="0" id="sv_price" value="${s?s.price:0}"></div></div>
    <div class="form-row"><div class="field"><label>Categoria</label><select class="input" id="sv_cat">${cats.map(c=>`<option ${s&&s.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label>Ícone</label><select class="input" id="sv_icon">${icons.map(i=>`<option value="${i}" ${s&&s.icon===i?'selected':''}>${i}</option>`).join('')}</select></div></div>
    <div class="checkbox-row"><div class="switch ${!s||s.active?'on':''}" id="sv_active" onclick="this.classList.toggle('on')"></div><label style="margin:0">Serviço ativo</label></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveService('${id||''}')">Salvar</button></div>`);
}
function saveService(id){const shop=dashShop();const name=$('#sv_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const data={name,desc:$('#sv_desc').value.trim(),duration:+$('#sv_dur').value||30,price:+$('#sv_price').value||0,category:$('#sv_cat').value,icon:$('#sv_icon').value,active:$('#sv_active').classList.contains('on')};if(id)DB.update('services',id,data);else DB.insert('services',{barbershopId:shop.id,...data});DB.log(id?'Serviço editado':'Serviço criado',name,shop.id);closeModal();toast('Serviço salvo.','ok');refreshShell();}
function delService(id){confirmAction('Excluir serviço?','Esta ação não pode ser desfeita.',()=>{DB.remove('services',id);toast('Serviço excluído.','info');refreshShell();});}

/* ---------- Marketing ---------- */
function dashMarketing(shop){
  const list=DB.scope('campaigns',shop.id);
  return `<div class="page-head"><div><h2>Marketing</h2><p>Campanhas e automações para fidelizar e reativar</p></div><div class="page-actions"><button class="btn btn-primary" onclick="campaignForm()">${icon('plus')} Nova campanha</button></div></div>
  <div class="panel"><div class="panel-head"><h3>${icon('zap')} Automações</h3><span class="badge ok">Ativas</span></div>
    <div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('clock')}</span><div><b>Reativação de inativos (30 dias)</b><br><small>"Sentimos sua falta! Agende e ganhe 10% de desconto."</small></div><button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="sendSegmentCampaign('inativo')">Enviar agora</button></div>
    <div class="mini-slot" style="margin:0"><span class="ic">${icon('gift')}</span><div><b>Aniversariantes</b><br><small>"Feliz aniversário! Aproveite um desconto especial."</small></div><button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="sendBirthday()">Enviar agora</button></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Campanhas promocionais</h3></div>
  <div class="table-wrap"><table><thead><tr><th>Campanha</th><th>Tipo</th><th>Desconto</th><th>Expira</th><th>Uso</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(c=>`<tr><td><b>${escapeHtml(c.name)}</b></td><td><span class="tag">${({first_visit:'1ª visita',weekday:'Dia da semana',combo:'Combo',seasonal:'Sazonal'})[c.type]||c.type}</span></td><td>${c.discountType==='percent'?c.discountValue+'%':money(c.discountValue)}</td><td>${fmtDateShort(c.expires)}</td><td>${c.used}${c.usageLimit?'/'+c.usageLimit:''}</td><td><span class="badge ${c.active?'ok':'muted'}">${c.active?'Ativa':'Pausada'}</span></td><td><div class="row-actions"><button class="ra" onclick="campaignForm('${c.id}')">${icon('edit')}</button><button class="ra del" onclick="delCampaign('${c.id}')">${icon('trash')}</button></div></td></tr>`).join('')||`<tr><td colspan="7">${emptyState('megaphone','Sem campanhas','Crie sua primeira campanha promocional.')}</td></tr>`}
  </tbody></table></div></div>`;
}
function campaignForm(id){
  const shop=dashShop();const c=id?DB.find('campaigns',id):null;
  openModal(`<div class="modal-head"><h3>${c?'Editar':'Nova'} campanha</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="cp_name" value="${c?escapeHtml(c.name):''}" placeholder="Ex.: Terça Promo"><div class="err">Informe o nome.</div></div>
    <div class="form-row"><div class="field"><label>Tipo</label><select class="input" id="cp_type"><option value="first_visit" ${c&&c.type==='first_visit'?'selected':''}>Primeira visita</option><option value="weekday" ${c&&c.type==='weekday'?'selected':''}>Dia da semana</option><option value="combo" ${c&&c.type==='combo'?'selected':''}>Combo</option><option value="seasonal" ${c&&c.type==='seasonal'?'selected':''}>Sazonal</option></select></div><div class="field"><label>Tipo de desconto</label><select class="input" id="cp_dt"><option value="percent" ${c&&c.discountType==='percent'?'selected':''}>Percentual (%)</option><option value="fixed" ${c&&c.discountType==='fixed'?'selected':''}>Valor fixo (R$)</option></select></div></div>
    <div class="form-row"><div class="field"><label>Valor do desconto</label><input class="input" type="number" id="cp_dv" value="${c?c.discountValue:10}"></div><div class="field"><label>Limite de uso (0 = ilimitado)</label><input class="input" type="number" id="cp_lim" value="${c?c.usageLimit:0}"></div></div>
    <div class="field"><label>Expira em</label><input class="input" type="date" id="cp_exp" value="${c?c.expires:DB.addDays(DB.todayISO(),30)}"></div>
    <div class="checkbox-row"><div class="switch ${!c||c.active?'on':''}" id="cp_active" onclick="this.classList.toggle('on')"></div><label style="margin:0">Campanha ativa</label></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCampaign('${id||''}')">Salvar</button></div>`);
}
function saveCampaign(id){const shop=dashShop();const name=$('#cp_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const data={name,type:$('#cp_type').value,discountType:$('#cp_dt').value,discountValue:+$('#cp_dv').value||0,usageLimit:+$('#cp_lim').value||0,expires:$('#cp_exp').value,active:$('#cp_active').classList.contains('on')};if(id)DB.update('campaigns',id,data);else DB.insert('campaigns',{barbershopId:shop.id,used:0,...data});DB.log(id?'Campanha editada':'Campanha criada',name,shop.id);closeModal();toast('Campanha salva.','ok');refreshShell();}
function delCampaign(id){confirmAction('Excluir campanha?','',()=>{DB.remove('campaigns',id);toast('Campanha excluída.','info');refreshShell();});}
function sendBirthday(){const shop=dashShop();const m=new Date().getMonth();const aniv=DB.scope('customers',shop.id).filter(c=>c.birthday&&new Date(c.birthday+'T00:00:00').getMonth()===m);toast(`Mensagem de aniversário enviada para ${aniv.length} cliente(s) este mês.`,'ok');DB.log('Campanha de aniversário enviada','',shop.id);}

/* ---------- Inventory ---------- */
/* stock movement helper — single source of truth for inventory changes */
function moveStock(productId,delta,type,reason,refId){
  const p=DB.find('products',productId);if(!p)return;
  DB.update('products',productId,{qty:Math.max(0,p.qty+delta)});
  DB.insert('stockMoves',{barbershopId:p.barbershopId,productId,productName:p.name,type,qty:delta,reason:reason||'',time:Date.now(),refId:refId||null});
}
let invKind='professional',invView='lista';
function dashInventory(shop){
  if(invView==='reports')return dashInventoryReports(shop);
  const all=DB.scope('products',shop.id);
  const list=all.filter(p=>(p.kind||'professional')===invKind);
  const low=list.filter(p=>p.qty<=p.minStock);
  const value=list.reduce((s,p)=>s+p.cost*p.qty,0);
  const isPro=invKind==='professional';
  return `<div class="page-head"><div><h2>Estoque</h2><p>${all.length} produto(s) no total · ${all.filter(p=>p.qty<=p.minStock).length} com estoque baixo</p></div>
    <div class="page-actions"><button class="btn btn-ghost" onclick="invView='reports';refreshShell()">${icon('chart')} Relatórios</button><button class="btn btn-ghost" onclick="exportCSV('products')">${icon('download')} Exportar</button><button class="btn btn-primary" onclick="productForm()">${icon('plus')} Novo produto</button></div></div>
  <div class="toolbar"><div class="seg">
    <button class="${invKind==='professional'?'on':''}" onclick="invKind='professional';invView='lista';refreshShell()">${icon('droplet')} Profissionais</button>
    <button class="${invKind==='convenience'?'on':''}" onclick="invKind='convenience';invView='lista';refreshShell()">${icon('coffee')} Conveniência / Bar</button>
  </div></div>
  <p class="muted" style="font-size:13.5px;margin:-6px 0 16px">${isPro?'Produtos consumidos durante os serviços. A baixa é automática ao registrar o consumo no atendimento.':'Produtos vendidos diretamente ao cliente pelo PDV. A baixa é automática na venda.'}</p>
  <div class="stat-grid">${statCard('c1','box','Produtos',list.length,'nesta categoria')}${statCard('c2','dollar','Valor em estoque',money(value),'a custo')}${statCard('c5','alert','Estoque baixo',low.length,'repor',low.length?'down':'up')}</div>
  ${low.length?`<div class="panel" style="border-color:var(--danger)"><div class="panel-head"><h3 style="color:var(--danger)">${icon('alert')} Reposição necessária</h3></div>${low.map(p=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic" style="background:var(--danger-soft);color:var(--danger)">${icon('box')}</span><div><b>${escapeHtml(p.name)}</b><br><small>${p.qty} ${p.unit||'un'} · mínimo ${p.minStock} · ${escapeHtml(p.supplier||'sem fornecedor')}</small></div><button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="restock('${p.id}')">Repor +10</button></div>`).join('')}</div>`:''}
  <div class="panel"><div class="panel-head"><h3>Produtos ${isPro?'profissionais':'de conveniência'}</h3></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Fornecedor</th><th>Custo</th><th>Venda</th><th>Margem</th><th>Estoque</th><th></th></tr></thead><tbody>
  ${list.map(p=>{const margin=p.price-p.cost;const lw=p.qty<=p.minStock;return `<tr><td><div class="t-user"><div class="av">${icon(isPro?'droplet':'coffee')}</div><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.category||'')}</small></div></div></td><td>${escapeHtml(p.sku)}</td><td class="muted">${escapeHtml(p.supplier||'—')}</td><td>${money(p.cost)}</td><td>${money(p.price)}</td><td><b style="color:var(--success)">${margin>0?Math.round(margin/p.price*100):0}%</b></td><td><span class="badge ${lw?'danger':'ok'}">${p.qty} ${p.unit||'un'}</span></td><td><div class="row-actions">${isPro?'':`<button class="ra" title="Vender no PDV" onclick="quickSell('${p.id}')">${icon('dollar')}</button>`}<button class="ra" title="Repor" onclick="adjustStock('${p.id}')">${icon('plus')}</button><button class="ra" onclick="productForm('${p.id}')">${icon('edit')}</button><button class="ra del" onclick="delProduct('${p.id}')">${icon('trash')}</button></div></td></tr>`;}).join('')||`<tr><td colspan="8">${emptyState('box','Sem produtos','Cadastre o primeiro produto desta categoria.')}</td></tr>`}
  </tbody></table></div></div>`;
}
function restock(id){moveStock(id,10,'in','Reposição rápida');DB.log('Reposição de estoque',DB.find('products',id).name);toast('Estoque reposto (+10).','ok');refreshShell();}
function adjustStock(id){const p=DB.find('products',id);openModal(`<div class="modal-head"><h3>Movimentar estoque</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div><div class="modal-body"><p class="muted" style="margin-bottom:12px">${escapeHtml(p.name)} — atual: <b>${p.qty} ${p.unit||'un'}</b></p><div class="form-row"><div class="field"><label>Tipo</label><select class="input" id="mv_type"><option value="in">Entrada (+)</option><option value="out">Saída (-)</option></select></div><div class="field"><label>Quantidade</label><input class="input" type="number" id="mv_qty" value="10" min="1"></div></div><div class="field"><label>Motivo</label><input class="input" id="mv_reason" placeholder="Ex.: compra, perda, ajuste"></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveAdjust('${id}')">Salvar</button></div>`);}
function saveAdjust(id){const t=$('#mv_type').value;const q=Math.abs(+$('#mv_qty').value||0);if(!q){toast('Informe a quantidade.','err');return;}moveStock(id,t==='in'?q:-q,t==='in'?'in':'adjust',$('#mv_reason').value.trim()||'Ajuste manual');DB.log('Movimentação de estoque',DB.find('products',id).name);closeModal();toast('Estoque atualizado.','ok');refreshShell();}
function quickSell(id){const shop=dashShop();const cs=DB.scope('cashSessions',shop.id).find(s=>s.status==='open');if(!cs){confirmAction('Caixa fechado','Abra o caixa no PDV para registrar vendas. Deseja ir para o PDV?',()=>{location.hash='#/dashboard/pdv';},false);return;}posAddProduct(id);location.hash='#/dashboard/pdv';}
function productForm(id){
  const shop=dashShop();const p=id?DB.find('products',id):null;
  const kind=p?(p.kind||'professional'):invKind;
  const proCats=['Pomadas','Shampoos','Óleos','Gel','Cosméticos','Finalizadores'];const conCats=['Refrigerantes','Águas','Energéticos','Cervejas','Café','Snacks','Bar'];
  const cats=kind==='professional'?proCats:conCats;
  openModal(`<div class="modal-head"><div><h3>${p?'Editar':'Novo'} produto</h3><div class="sub">${kind==='professional'?'Profissional (consumo em serviço)':'Conveniência (venda direta)'}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <input type="hidden" id="pr_kind" value="${kind}">
    <div class="field"><label>Tipo de produto</label><div class="chips"><span class="chip-toggle ${kind==='professional'?'on':''}" onclick="$('#pr_kind').value='professional';this.classList.add('on');this.nextElementSibling.classList.remove('on')">Profissional</span><span class="chip-toggle ${kind==='convenience'?'on':''}" onclick="$('#pr_kind').value='convenience';this.classList.add('on');this.previousElementSibling.classList.remove('on')">Conveniência / Bar</span></div></div>
    <div class="form-row"><div class="field"><label>Nome *</label><input class="input" id="pr_name" value="${p?escapeHtml(p.name):''}"><div class="err">Informe o nome.</div></div><div class="field"><label>SKU</label><input class="input" id="pr_sku" value="${p?escapeHtml(p.sku):''}" placeholder="Auto se vazio"></div></div>
    <div class="form-row three"><div class="field"><label>Custo (R$)</label><input class="input" type="number" step="0.01" id="pr_cost" value="${p?p.cost:0}"></div><div class="field"><label>Venda (R$)</label><input class="input" type="number" step="0.01" id="pr_price" value="${p?p.price:0}"></div><div class="field"><label>Unidade</label><select class="input" id="pr_unit">${['un','ml','g'].map(u=>`<option ${p&&p.unit===u?'selected':''}>${u}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="field"><label>Categoria</label><select class="input" id="pr_cat">${cats.map(c=>`<option ${p&&p.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label>Fornecedor</label><input class="input" id="pr_sup" value="${p?escapeHtml(p.supplier||''):''}"></div></div>
    <div class="form-row"><div class="field"><label>Quantidade</label><input class="input" type="number" id="pr_qty" value="${p?p.qty:0}"></div><div class="field"><label>Estoque mínimo</label><input class="input" type="number" id="pr_min" value="${p?p.minStock:5}"></div></div>
    <div class="checkbox-row"><div class="switch ${!p||p.active!==false?'on':''}" id="pr_active" onclick="this.classList.toggle('on')"></div><label style="margin:0">Produto ativo</label></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveProduct('${id||''}')">Salvar</button></div>`);
}
function saveProduct(id){const shop=dashShop();const name=$('#pr_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const data={name,kind:$('#pr_kind').value,sku:$('#pr_sku').value.trim()||('SKU-'+Math.floor(Math.random()*9999)),cost:+$('#pr_cost').value||0,price:+$('#pr_price').value||0,unit:$('#pr_unit').value,category:$('#pr_cat').value,supplier:$('#pr_sup').value.trim(),qty:+$('#pr_qty').value||0,minStock:+$('#pr_min').value||0,active:$('#pr_active').classList.contains('on')};if(id)DB.update('products',id,data);else DB.insert('products',{barbershopId:shop.id,...data});invKind=data.kind;DB.log(id?'Produto editado':'Produto criado',name,shop.id);closeModal();toast('Produto salvo.','ok');refreshShell();}
function delProduct(id){confirmAction('Excluir produto?','',()=>{DB.remove('products',id);toast('Produto excluído.','info');refreshShell();});}

/* ---------- Inventory reports ---------- */
function dashInventoryReports(shop){
  const products=DB.scope('products',shop.id);
  const moves=DB.scope('stockMoves',shop.id).slice().sort((a,b)=>b.time-a.time);
  const valuation=products.reduce((s,p)=>s+p.cost*p.qty,0);
  const retail=products.reduce((s,p)=>s+p.price*p.qty,0);
  const low=products.filter(p=>p.qty<=p.minStock);
  // best-selling (from sales + consumption moves)
  const soldQty={};DB.scope('sales',shop.id).forEach(sale=>sale.items.forEach(it=>{if(it.productId)soldQty[it.productId]=(soldQty[it.productId]||0)+it.qty;}));
  moves.filter(m=>m.type==='consumption').forEach(m=>{soldQty[m.productId]=(soldQty[m.productId]||0)+Math.abs(m.qty);});
  const bestSelling=Object.entries(soldQty).map(([pid,q])=>({p:DB.find('products',pid),q})).filter(x=>x.p).sort((a,b)=>b.q-a.q).slice(0,8);
  // profitability
  const profitability=products.slice().map(p=>({p,margin:p.price-p.cost,pct:p.price?Math.round((p.price-p.cost)/p.price*100):0})).sort((a,b)=>b.pct-a.pct).slice(0,8);
  // supplier analysis
  const bySup={};products.forEach(p=>{const s=p.supplier||'Sem fornecedor';if(!bySup[s])bySup[s]={count:0,value:0};bySup[s].count++;bySup[s].value+=p.cost*p.qty;});
  return `<div class="page-head"><div><h2>Relatórios de Estoque</h2><p>Valorização, rentabilidade, mais vendidos, fornecedores e movimentação</p></div><div class="page-actions"><button class="btn btn-ghost" onclick="invView='lista';refreshShell()">${icon('arrowLeft')} Voltar ao estoque</button><button class="btn btn-ghost" onclick="exportCSV('stockMoves')">${icon('download')} Exportar movimentação</button></div></div>
  <div class="stat-grid">${statCard('c1','box','Itens em estoque',products.reduce((s,p)=>s+p.qty,0),products.length+' SKUs')}${statCard('c2','dollar','Valorização (custo)',money(valuation),'capital parado')}${statCard('c3','trending','Valor de venda',money(retail),'potencial')}${statCard('c5','alert','Abaixo do mínimo',low.length,'repor',low.length?'down':'up')}</div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>${icon('trending')} Mais vendidos / consumidos</h3></div>${bestSelling.length?bestSelling.map(x=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('box')}</span><div><b>${escapeHtml(x.p.name)}</b><br><small>${escapeHtml((x.p.kind||'professional')==='professional'?'Profissional':'Conveniência')}</small></div><b style="margin-left:auto">${x.q} ${x.p.unit||'un'}</b></div>`).join(''):'<p class="muted">Sem vendas/consumo registrados ainda.</p>'}</div>
    <div class="panel"><div class="panel-head"><h3>${icon('dollar')} Rentabilidade por produto</h3></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Margem</th><th>%</th></tr></thead><tbody>${profitability.map(x=>`<tr><td>${escapeHtml(x.p.name)}</td><td>${money(x.margin)}</td><td><b style="color:var(--success)">${x.pct}%</b></td></tr>`).join('')}</tbody></table></div></div>
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>${icon('layers')} Análise por fornecedor</h3></div><div class="table-wrap"><table><thead><tr><th>Fornecedor</th><th>Produtos</th><th>Valor em estoque</th></tr></thead><tbody>${Object.entries(bySup).sort((a,b)=>b[1].value-a[1].value).map(([s,d])=>`<tr><td><b>${escapeHtml(s)}</b></td><td>${d.count}</td><td>${money(d.value)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h3>${icon('activity')} Movimentação recente</h3></div>${moves.length?`<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Produto</th><th>Tipo</th><th>Qtd</th></tr></thead><tbody>${moves.slice(0,12).map(m=>`<tr><td>${relTime(m.time)} atrás</td><td>${escapeHtml(m.productName||'')}</td><td><span class="badge ${m.qty>=0?'ok':'warn'}">${({in:'Entrada',out:'Saída',consumption:'Consumo',sale:'Venda',adjust:'Ajuste'})[m.type]||m.type}</span></td><td><b>${m.qty>0?'+':''}${m.qty}</b></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Sem movimentações registradas.</p>'}</div>
  </div>`;
}

/* ---------- Finance ---------- */
function dashFinance(shop){
  const t=DB.todayISO();const appts=DB.scope('appointments',shop.id);
  const inRange=a=>{if(finPeriod==='dia')return a.date===t;if(finPeriod==='semana')return a.date>=DB.addDays(t,-6)&&a.date<=t;if(finPeriod==='mes')return a.date.slice(0,7)===t.slice(0,7);return a.date.slice(0,4)===t.slice(0,4);};
  const range=appts.filter(inRange);
  const paid=range.filter(a=>a.status==='concluido'||a.status==='confirmado');
  const revenue=paid.reduce((s,a)=>s+a.price,0);
  let commissions=0;range.filter(a=>a.status==='concluido').forEach(a=>{const b=DB.find('barbers',a.barberId);if(b)commissions+=a.price*(b.commission/100);});
  const expenses=commissions; // comissões como principal despesa variável
  const profit=revenue-expenses;
  const ticket=paid.length?revenue/paid.length:0;
  return `<div class="page-head"><div><h2>Financeiro</h2><p>Receitas, comissões e lucro</p></div><div class="page-actions"><div class="seg">${[['dia','Diário'],['semana','Semanal'],['mes','Mensal'],['ano','Anual']].map(([k,l])=>`<button class="${finPeriod===k?'on':''}" onclick="finPeriod='${k}';refreshShell()">${l}</button>`).join('')}</div><button class="btn btn-ghost" onclick="exportFinance()">${icon('download')} Exportar</button></div></div>
  <div class="stat-grid">
    ${statCard('c2','dollar','Receita',money(revenue),paid.length+' atendimentos')}
    ${statCard('c4','users','Comissões',money(commissions),'a pagar')}
    ${statCard('c1','trending','Lucro',money(profit),(revenue?Math.round(profit/revenue*100):0)+'% de margem')}
    ${statCard('c3','target','Ticket médio',money(ticket),'por atendimento')}
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Evolução (7 dias)</h3></div><div class="chart-wrap"><canvas id="finChart"></canvas></div></div>
    <div class="panel"><div class="panel-head"><h3>Comissões por barbeiro</h3></div>
      ${DB.scope('barbers',shop.id).map(b=>{const list=range.filter(a=>a.barberId===b.id&&a.status==='concluido');const rev=list.reduce((s,a)=>s+a.price,0);const comm=rev*(b.commission/100);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${initials(b.name)}</span><div><b>${escapeHtml(b.name.split(' ')[0])}</b><br><small>${list.length} atend. · ${b.commission}%</small></div><b style="margin-left:auto">${money(comm)}</b></div>`;}).join('')||'<p class="muted">Sem dados.</p>'}
    </div>
  </div>`;
}
function dashFinanceChart(shop){const a=shopAnalytics(shop.id);mkChart('finChart','bar',{labels:a.days,datasets:[{data:a.revSeries,backgroundColor:GOLD,borderRadius:8}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});}
function exportFinance(){const shop=dashShop();const rows=[['Data','Cliente','Servico','Barbeiro','Valor','Status']];DB.scope('appointments',shop.id).forEach(a=>{const s=DB.find('services',a.serviceId),b=DB.find('barbers',a.barberId);rows.push([a.date,a.customerName,s?s.name:'',b?b.name:'',a.price,a.status]);});const csv=rows.map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='financeiro-'+shop.slug+'.csv';a.click();toast('Relatório exportado.','ok');}

/* ---------- AI Insights ---------- */
function dashAI(shop){
  const a=shopAnalytics(shop.id);const insights=[];
  // weekday occupancy
  const byDow={};DB.scope('appointments',shop.id).filter(x=>x.status!=='cancelado').forEach(x=>{const d=new Date(x.date+'T00:00:00').getDay();byDow[d]=(byDow[d]||0)+1;});
  const dows=[1,2,3,4,5,6];const minDow=dows.reduce((m,d)=>(byDow[d]||0)<(byDow[m]||0)?d:m,1);
  insights.push(['warn','cpu',`${DOW_FULL[minDow]} com baixa ocupação`,`${DOW_FULL[minDow]} tem o menor volume de agendamentos. Considere criar uma promoção para equilibrar a semana.`]);
  // top barber demand
  if(a.topBarber){const avg=a.appts.filter(x=>x.status!=='cancelado').length/Math.max(1,DB.scope('barbers',shop.id).length);const pct=Math.round((a.topBarber[1]/avg-1)*100);if(pct>15)insights.push(['pos','award',`${a.topBarber[0]} em alta demanda`,`${a.topBarber[0]} atende ${pct}% acima da média. Avalie ampliar a agenda dele ou treinar a equipe.`]);}
  // inactive customers
  const inactive=DB.scope('customers',shop.id).filter(c=>customerStats(shop.id,c.id).seg==='inativo');
  if(inactive.length)insights.push(['warn','clock',`${inactive.length} cliente(s) inativo(s)`,`Há ${inactive.length} clientes sem retornar há mais de 30 dias. Dispare a campanha de reativação para trazê-los de volta.`]);
  // low stock
  const low=DB.scope('products',shop.id).filter(p=>p.qty<=p.minStock);
  if(low.length)insights.push(['warn','box',`Estoque baixo em ${low.length} produto(s)`,`Reabasteça ${low.map(p=>p.name).join(', ')} para não perder vendas.`]);
  // best service
  if(a.topServices[0])insights.push(['pos','star',`${a.topServices[0][0]} é seu carro-chefe`,`Foi o serviço mais procurado (${a.topServices[0][1]}x). Crie um combo a partir dele para aumentar o ticket médio.`]);
  // revenue trend
  const last=a.revSeries.slice(-3).reduce((s,x)=>s+x,0),prev=a.revSeries.slice(0,3).reduce((s,x)=>s+x,0);
  if(last>prev)insights.push(['pos','trending','Receita em crescimento','Sua receita dos últimos dias superou o início da semana. Continue investindo no que está funcionando.']);
  return `<div class="page-head"><div><h2>Insights de IA</h2><p>Recomendações acionáveis geradas a partir dos seus dados</p></div><div class="page-actions"><span class="badge gold">${icon('cpu')} ${insights.length} recomendações</span></div></div>
  ${insights.map(i=>`<div class="insight ${i[0]}"><span class="ii">${icon(i[1])}</span><div><b>${escapeHtml(i[2])}</b><p>${escapeHtml(i[3])}</p></div></div>`).join('')}
  <div class="panel" style="margin-top:8px"><div class="panel-head"><h3>Como funciona</h3></div><p class="muted" style="font-size:14px">Os insights são recalculados automaticamente com base em ocupação, demanda por profissional, recência dos clientes, estoque e tendência de receita. Use-os como ponto de partida para decisões de promoção, equipe e compras.</p></div>`;
}

/* ---------- Config ---------- */
function dashConfig(shop){
  const e=shopEntitlements(shop.id);
  const activeBarbers=DB.scope('barbers',shop.id).filter(b=>b.active).length;
  const featBadge=(on,label)=>`<span class="badge ${on?'ok':'muted'}">${on?icon('check'):icon('x')} ${label}</span>`;
  return `<div class="page-head"><div><h2>Configurações</h2><p>Dados da barbearia e da página pública</p></div></div>
  ${bookingUrlCard(shop)}
  <div class="panel" style="${e.isEnterprise?'border-color:var(--primary)':''}"><div class="panel-head"><h3>${e.isEnterprise?icon('building')+' ':''}Seu plano: ${escapeHtml(e.planName)}</h3>${e.isEnterprise?'<span class="badge gold">Sob medida</span>':`<button class="btn btn-ghost btn-sm" onclick="Router.go('#/dashboard/assinatura')">${icon('creditCard')} Gerenciar assinatura</button>`}</div>
    <div class="form-row three">
      <div class="summary-line"><span class="muted">Profissionais</span><b>${activeBarbers} / ${e.limitBarbers>=999?'∞':e.limitBarbers}</b></div>
      <div class="summary-line"><span class="muted">Unidades</span><b>${e.limitLocations>=99?'∞':e.limitLocations}</b></div>
      <div class="summary-line"><span class="muted">WhatsApp/mês</span><b>${e.whatsappLimit>=99999?'∞':(e.whatsappLimit||0)}</b></div>
    </div>
    <div class="chips" style="margin-top:10px">${ENT_FEATURES.map(f=>featBadge(e[f[0]],f[1])).join('')}</div>
    ${e.isEnterprise?'<p class="muted" style="font-size:12.5px;margin-top:12px">Plano personalizado pela equipe Groomin. Para ajustes, fale com o seu contato comercial.</p>':''}
  </div>
  <div class="panel"><div class="panel-head"><h3>Informações</h3><a class="btn btn-ghost btn-sm" onclick="Router.go('#/'+'${shop.slug}')">${icon('eye')} Ver página pública</a></div>
    <div class="form-row"><div class="field"><label>Nome</label><input class="input" id="cf_name" value="${escapeHtml(shop.name)}"></div><div class="field"><label>Link público</label><div class="input" style="background:var(--surface-3);color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(shopPublicUrl(shop.slug).replace(/^https?:\/\//,''))}</div></div></div>
    <div class="field"><label>Logo da barbearia</label>
      <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
        <div style="width:72px;height:72px;border-radius:16px;overflow:hidden;background:var(--primary-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${shop.logoUrl?`<img src="${escapeHtml(shop.logoUrl)}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:1.4rem;font-weight:800;color:var(--primary)">${initials(shop.name)}</span>`}
        </div>
        <div><label class="btn btn-ghost btn-sm" for="cf_logo_file" style="cursor:pointer;margin:0">${icon('upload')} ${shop.logoUrl?'Substituir logo':'Adicionar logo'}</label>
        <small class="muted" style="display:block;margin-top:4px">PNG, JPG ou WEBP · máx. 5MB</small></div>
      </div>
      <input type="file" id="cf_logo_file" accept="image/jpeg,image/png,image/webp" style="display:none">
    </div>
    <div class="field"><label>Foto de capa</label>
      <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
        <div id="cf_cover_preview" style="width:120px;height:68px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,#242014,#0d0d0d);flex-shrink:0;display:flex;align-items:center;justify-content:center">
          ${shop.coverUrl?`<img src="${escapeHtml(shop.coverUrl)}" style="width:100%;height:100%;object-fit:cover">`:`<span class="muted" style="font-size:11px">Sem capa</span>`}
        </div>
        <div><label class="btn btn-ghost btn-sm" for="cf_cover_file" style="cursor:pointer;margin:0">${icon('upload')} ${shop.coverUrl?'Substituir capa':'Adicionar capa'}</label>
        <small class="muted" style="display:block;margin-top:4px">Aparece no topo da página pública · máx. 5MB</small></div>
      </div>
      <input type="file" id="cf_cover_file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewCover(this)">
    </div>
    <div class="field"><label>Descrição</label><textarea class="input" id="cf_desc">${escapeHtml(shop.description||'')}</textarea></div>
    <div class="field"><label>Endereço</label><input class="input" id="cf_addr" value="${escapeHtml(shop.address||'')}"></div>
    <div class="form-row three"><div class="field"><label>Cidade</label><input class="input" id="cf_city" value="${escapeHtml(shop.city||'')}"></div><div class="field"><label>Bairro</label><input class="input" id="cf_neigh" value="${escapeHtml(shop.neighborhood||'')}"></div><div class="field"><label>Instagram</label><input class="input" id="cf_ig" value="${escapeHtml(shop.instagram||'')}"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="cf_phone" value="${escapeHtml(shop.phone||'')}"></div><div class="field"><label>WhatsApp</label><input class="input" id="cf_wa" value="${escapeHtml(shop.whatsapp||'')}"></div></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Funcionamento</h3></div>
    <div class="field"><label>Dias de funcionamento</label><div class="chips" id="cf_days">${DOW.map((d,i)=>`<span class="chip-toggle ${(shop.workDays??[1,2,3,4,5,6]).includes(i)?'on':''}" data-day="${i}" onclick="this.classList.toggle('on')">${d}</span>`).join('')}</div></div>
    <div class="form-row"><div class="field"><label>Abertura</label><input class="input" type="time" id="cf_open" value="${shop.open}"></div><div class="field"><label>Fechamento</label><input class="input" type="time" id="cf_close" value="${shop.close}"></div></div>
    <div class="form-row three"><div class="field"><label>Almoço início</label><input class="input" type="time" id="cf_ls" value="${shop.lunchStart}"></div><div class="field"><label>Almoço fim</label><input class="input" type="time" id="cf_le" value="${shop.lunchEnd}"></div><div class="field"><label>Intervalo de horários</label><select class="input" id="cf_int">${[15,20,30,45,60].map(i=>`<option value="${i}" ${shop.slotInterval===i?'selected':''}>${i} min</option>`).join('')}</select></div></div>
  </div>
  <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="saveConfig()">${icon('check')} Salvar configurações</button></div>`;
}
async function saveConfig(){const shop=dashShop();const workDays=[...$$('#cf_days .chip-toggle.on')].map(el=>+el.dataset.day);const data={name:$('#cf_name').value.trim(),description:$('#cf_desc').value.trim(),address:$('#cf_addr').value.trim(),city:$('#cf_city').value.trim(),neighborhood:$('#cf_neigh').value.trim(),instagram:$('#cf_ig').value.trim(),phone:$('#cf_phone').value.trim(),whatsapp:$('#cf_wa').value.trim(),open:$('#cf_open').value,close:$('#cf_close').value,lunchStart:$('#cf_ls').value,lunchEnd:$('#cf_le').value,slotInterval:+$('#cf_int').value,workDays};
  const file=$('#cf_logo_file')&&$('#cf_logo_file').files[0];
  if(file&&window.fbUploadTenantImage){try{toast('Enviando logo...','info');const up=await fbUploadTenantImage(shop.id,'logos',file,shop.logoPath);data.logoUrl=up.url;data.logoPath=up.path;}catch(e){toast(e.code==='image-too-large'?'Imagem maior que 5MB.':e.code==='storage-not-configured'?'Firebase Storage ainda não foi configurado.':'Não foi possível enviar o logo.','err');return;}}
  const coverFile=$('#cf_cover_file')&&$('#cf_cover_file').files[0];
  if(coverFile&&window.fbUploadTenantImage){try{toast('Enviando capa...','info');const upc=await fbUploadTenantImage(shop.id,'covers',coverFile,shop.coverPath);data.coverUrl=upc.url;data.coverPath=upc.path;}catch(e){toast('Não foi possível enviar a foto de capa.','err');return;}}
  DB.update('barbershops',shop.id,data);DB.log('Configurações atualizadas',shop.name,shop.id);toast('Configurações salvas.','ok');refreshShell();}

/* ---------- Assinatura ---------- */
function dashSubscription(shop){
  const sub=shopSubscription(shop.id)||{};
  const plan=DB.find('plans',shop.planId)||DB.find('plans','free');
  const e=shopEntitlements(shop.id);
  const isTrialing=sub.status==='trialing';
  const t=DB.todayISO();
  const renewsAt=sub.renewsAt||t;
  const daysLeft=Math.max(0,Math.ceil((new Date(renewsAt+'T00:00:00')-new Date())/86400000));
  const statusMap={active:['ok','Ativo'],trialing:['info','Trial'],past_due:['danger','Em atraso'],canceled:['muted','Cancelado']};
  const[stCls,stLabel]=statusMap[sub.status]||['muted','—'];
  const plans=DB.get().plans.filter(p=>!p.enterprise);
  return `<div class="page-head"><div><h2>Assinatura</h2><p>Gerencie seu plano e cobrança na Groomin</p></div></div>

  <div class="panel" style="border-color:var(--primary);background:linear-gradient(135deg,rgba(212,175,55,.07),transparent),var(--surface)">
    <div class="panel-head">
      <div><h3>${e.isEnterprise?icon('building')+' ':''}Plano atual: <b>${escapeHtml(e.planName)}</b></h3><span class="badge ${stCls}">${stLabel}</span></div>
      ${!e.isEnterprise?`<button class="btn btn-primary btn-sm" onclick="openPlanSelectorOwner('${shop.id}')">${icon('rocket')} Solicitar mudança</button>`:''}
    </div>
    ${isTrialing?`<div class="insight warn" style="margin:12px 0"><span class="ii">${icon('clock')}</span><div><b>${daysLeft} dia(s) restante(s) no período de teste</b><p>Seu trial termina em ${fmtDate(renewsAt)}. Solicite a assinatura para não perder o acesso aos recursos.</p></div><button class="btn btn-primary btn-sm" style="margin-left:auto;flex-shrink:0" onclick="openPlanSelectorOwner('${shop.id}')">Solicitar assinatura</button></div>`:''}
    <div class="form-row three" style="margin-top:14px">
      <div class="summary-line"><span class="muted">Plano</span><b>${escapeHtml(plan.name)}</b></div>
      <div class="summary-line"><span class="muted">Status</span><b>${stLabel}</b></div>
      <div class="summary-line"><span class="muted">${isTrialing?'Fim do trial':'Renovação'}</span><b>${fmtDate(renewsAt)}</b></div>
    </div>
    <div class="form-row three">
      <div class="summary-line"><span class="muted">Profissionais</span><b>${DB.scope('barbers',shop.id).filter(b=>b.active).length} / ${e.limitBarbers>=999?'∞':e.limitBarbers}</b></div>
      <div class="summary-line"><span class="muted">Valor</span><b>${(sub.mrr||e.monthly)>0?money(sub.mrr||e.monthly)+'/mês':'Grátis'}</b></div>
      <div class="summary-line"><span class="muted">Ciclo</span><b>Mensal</b></div>
    </div>
    <div class="chips" style="margin-top:12px">${ENT_FEATURES.map(f=>`<span class="badge ${e[f[0]]?'ok':'muted'}">${e[f[0]]?icon('check'):icon('x')} ${f[1]}</span>`).join('')}</div>
    ${e.isEnterprise?'<p class="muted" style="font-size:12.5px;margin-top:12px">Plano sob medida Groomin. Para ajustes, fale com nosso comercial.</p>':''}
  </div>

  <div class="panel-head" style="margin-top:24px"><h3>Comparar planos</h3><p class="muted">Faça upgrade ou downgrade a qualquer momento</p></div>
  <div class="pricing-grid" style="margin-bottom:16px">
    ${plans.map(p=>{
      const isCurrent=shop.planId===p.id;
      const isPro=p.id==='pro';
      return `<div class="price-card ${isCurrent?'featured':isPro&&!isCurrent?'':''}">
        ${isCurrent?`<span class="pc-tag">${icon('check')} Seu plano</span>`:p.badge?`<span class="pc-tag">${escapeHtml(p.badge)}</span>`:''}
        <h3>${escapeHtml(p.name)}</h3>
        <div class="pc-price">${p.price===0?'Grátis':'R$ '+p.price+'<small>/mês</small>'}</div>
        <div class="pc-desc">${escapeHtml(p.tagline||'')}</div>
        <ul>${p.features.slice(0,4).map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}</ul>
        ${isCurrent
          ?`<button class="btn btn-outline btn-block" disabled>Plano atual</button>`
          :`<button class="btn ${p.price>(plan.price||0)?'btn-primary':'btn-ghost'} btn-block" onclick="requestPlanChange('${shop.id}','${p.id}')">${p.price>(plan.price||0)?icon('rocket')+' Solicitar upgrade':icon('down')+' Solicitar downgrade'}</button>`}
      </div>`;}).join('')}
  </div>

  <div class="panel">
    <div class="panel-head"><h3>Ações da conta</h3></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${e.isEnterprise
        ?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener">${icon('whatsapp')} Falar com comercial</a>`
        :`<button class="btn btn-primary" onclick="openPlanSelectorOwner('${shop.id}')">${icon('rocket')} Solicitar mudança</button>`}
      ${sub.status!=='canceled'&&shop.planId!=='free'?`<button class="btn btn-ghost" style="color:var(--danger)" onclick="confirmAction('Cancelar assinatura?','Você terá acesso até o fim do ciclo atual. Entre em contato para confirmar.',()=>{toast('Para cancelar, escreva para contato@groomin.com.br','info');})">${icon('x')} Cancelar assinatura</button>`:''}
    </div>
  </div>`;
}
function openPlanSelectorOwner(shopId){
  const shop=DB.find('barbershops',shopId);
  openModal(`<div class="modal-head"><div><h3>${icon('creditCard')} Solicitar mudança de plano</h3><div class="sub">${escapeHtml(shop.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><p class="muted" style="margin-bottom:12px">A mudança é confirmada pelo comercial antes de liberar recursos e cobrança.</p><div class="grid" style="gap:10px">${DB.all('plans').filter(p=>!p.enterprise).map(p=>`<div class="select-item ${shop.planId===p.id?'sel':''}" onclick="requestPlanChange('${shopId}','${p.id}')"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="t">${escapeHtml(p.name)}</div><div class="d">${escapeHtml(p.tagline||p.features[0])}</div></div><div class="p">${p.price===0?'Grátis':money(p.price)+'/mês'}</div></div></div>`).join('')}</div>
  <p class="muted" style="font-size:12.5px;margin-top:12px">Plano Enterprise e cancelamento: contato@groomin.com.br</p></div>`);
}
function requestPlanChange(shopId,planId){
  const shop=DB.find('barbershops',shopId),plan=DB.find('plans',planId);
  if(!shop||!plan)return;
  const subject=encodeURIComponent(`Solicitação de plano — ${shop.name}`);
  const body=encodeURIComponent(`Olá! Gostaria de solicitar o plano ${plan.name} para a barbearia ${shop.name} (ID: ${shopId}).\n\nE-mail de contato: ${shop.email||''}`);
  closeModal();
  location.href=`mailto:contato@groomin.com.br?subject=${subject}&body=${body}`;
  toast('Sua solicitação de plano está pronta para envio.','info');
}

/* ============================================================
   BARBER AREA (/my-schedule)
   ============================================================ */
let barberTab='hoje';
function renderBarber(){
  destroyCharts();
  const u=Session.effectiveUser;const shop=DB.find('barbershops',u.barbershopId);const barber=DB.find('barbers',u.barberId);
  if(!barber){toast('Perfil de barbeiro não encontrado.','err');location.hash='#/';return;}
  const t=DB.todayISO();
  const mine=DB.scope('appointments',shop.id).filter(a=>a.barberId===barber.id);
  const today=mine.filter(a=>a.date===t&&a.status!=='cancelado').sort((x,y)=>x.time.localeCompare(y.time));
  const upcoming=mine.filter(a=>a.date>t&&a.status!=='cancelado').sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time));
  const done=mine.filter(a=>a.status==='concluido');
  const revenue=done.reduce((s,a)=>s+a.price,0);const commission=revenue*(barber.commission/100);
  const list=barberTab==='hoje'?today:barberTab==='proximos'?upcoming:mine.slice().sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
  const nav=[{section:'Minha área'},{id:'',label:'Minha agenda',icon:'calendar',count:today.length}];
  const content=`<div class="stat-grid">
    ${statCard('c1','calendar','Hoje',today.length,'atendimentos')}
    ${statCard('c2','check','Concluídos',done.length,'no total')}
    ${statCard('c3','dollar','Faturamento',money(revenue),'gerado')}
    ${statCard('c4','award','Minha comissão',money(commission),barber.commission+'% do faturamento')}
  </div>
  <div class="toolbar"><div class="seg"><button class="${barberTab==='hoje'?'on':''}" onclick="barberTab='hoje';renderBarber()">Hoje</button><button class="${barberTab==='proximos'?'on':''}" onclick="barberTab='proximos';renderBarber()">Próximos</button><button class="${barberTab==='todos'?'on':''}" onclick="barberTab='todos';renderBarber()">Histórico</button></div>
    <button class="btn btn-ghost btn-sm" onclick="barberBlock()">${icon('lock')} Bloquear meu horário</button></div>
  ${list.length?`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(290px,1fr))">${list.map(ap=>{const s=DB.find('services',ap.serviceId);return `<div class="card" style="padding:18px"><div style="display:flex;justify-content:space-between;margin-bottom:10px"><b style="font-size:16px">${ap.time} · ${s?escapeHtml(s.name):'—'}</b><span class="badge ${STATUS[ap.status].cls}">${STATUS[ap.status].label}</span></div><div class="t-user" style="margin-bottom:8px"><div class="av">${initials(ap.customerName)}</div><div><b>${escapeHtml(ap.customerName)}</b><small>${escapeHtml(ap.phone)}</small></div></div><div class="summary-line"><span class="muted">Data</span><b>${fmtDate(ap.date)}</b></div><div class="summary-line"><span class="muted">Valor</span><b style="color:var(--primary)">${money(ap.price)}</b></div>${ap.status==='confirmado'||ap.status==='pendente'?`<button class="btn btn-primary btn-sm btn-block" style="margin-top:10px" onclick="apptStatus('${ap.id}','concluido')">${icon('check')} Marcar como concluído</button>`:''}</div>`;}).join('')}</div>`:emptyState('calendar','Nada por aqui','Sua agenda está livre neste período.')}`;
  $('#root').innerHTML=mountShell({brandShop:shop,brandSub:'Barbeiro',nav,activeId:'',navBase:'#/my-schedule/',title:'Minha agenda',crumb:shop.name+' · '+barber.name,content,search:false});
  renderShellNotif();
}
function barberBlock(){const u=Session.effectiveUser;const shop=DB.find('barbershops',u.barbershopId);agendaDate=DB.todayISO();
  openModal(`<div class="modal-head"><div><h3>Bloquear meu horário</h3></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <input type="hidden" id="bl_barber" value="${u.barberId}">
    <div class="field"><label>Data</label><input class="input" type="date" id="bl_date" value="${DB.todayISO()}" min="${DB.todayISO()}"></div>
    <div class="checkbox-row"><div class="switch" id="bl_full" onclick="this.classList.toggle('on');$('#bl_times').style.display=this.classList.contains('on')?'none':'grid'"></div><label style="margin:0">Dia inteiro</label></div>
    <div class="form-row" id="bl_times"><div class="field"><label>Início</label><input class="input" type="time" id="bl_start" value="12:00"></div><div class="field"><label>Fim</label><input class="input" type="time" id="bl_end" value="13:00"></div></div>
    <div class="field"><label>Motivo</label><input class="input" id="bl_reason" placeholder="Ex.: compromisso pessoal"></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveBarberBlock()">Bloquear</button></div>`);
}
function saveBarberBlock(){const u=Session.effectiveUser;const full=$('#bl_full').classList.contains('on');DB.insert('blocks',{barbershopId:u.barbershopId,barberId:u.barberId,date:$('#bl_date').value,start:$('#bl_start').value,end:$('#bl_end').value,reason:$('#bl_reason').value.trim(),fullDay:full});closeModal();toast('Horário bloqueado.','ok');renderBarber();}
