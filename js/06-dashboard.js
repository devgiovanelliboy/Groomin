/* ============================================================
   BARBERSHOP DASHBOARD (owner / manager / receptionist)
   Tenant-isolated by currentShop()
   ============================================================ */
function dashShop(){const u=Session.effectiveUser;return DB.find('barbershops',u.barbershopId);}
let agendaDate=null,agendaView='dia',finPeriod='mes',crmSeg='todos',agendaPage=1,crmPage=1;
const PAGE_SIZE=30;
const DASH_CHART_PRIMARY='#7C3AED';
const BUSINESS_CATEGORIES=[
  ['barbershop','Barbearia'],['hair-salon','Salão de cabelo'],['nail-designer','Nail designer'],['lash-designer','Lash designer'],
  ['makeup-artist','Maquiadora'],['beauty-clinic','Clínica de estética'],['tattoo-studio','Estúdio de tatuagem'],
  ['massage-therapist','Massoterapeuta'],['personal-trainer','Personal trainer'],['nutritionist','Nutricionista'],
  ['physiotherapist','Fisioterapeuta'],['dentist','Dentista'],['photographer','Fotógrafo'],['consultant','Consultor'],['other','Outro']
];
const BUSINESS_THEMES=[
  ['elegant-dark','Elegant Dark'],['luxury-gold','Luxury Gold'],['rose-pink','Rose Pink'],['royal-purple','Royal Purple'],
  ['ruby-red','Ruby Red'],['ocean-blue','Ocean Blue'],['emerald','Emerald'],['sunset-orange','Sunset Orange']
];
const BUSINESS_SERVICE_CATEGORIES={
  'barbershop':['Cabelo','Barba','Sobrancelha','Combo','Tratamento'],
  'hair-salon':['Corte','Escova','Coloração','Tratamento','Penteado'],
  'nail-designer':['Manicure','Pedicure','Alongamento','Manutenção','Nail art'],
  'lash-designer':['Extensão de cílios','Manutenção','Remoção','Design','Lash lifting'],
  'makeup-artist':['Maquiagem social','Noiva','Produção','Aula','Evento'],
  'beauty-clinic':['Facial','Corporal','Depilação','Avaliação','Estética avançada'],
  'tattoo-studio':['Tatuagem','Retoque','Consulta','Piercing','Projeto'],
  'massage-therapist':['Relaxante','Terapêutica','Drenagem','Reflexologia','Bem-estar'],
  'personal-trainer':['Treino','Avaliação','Consultoria','Plano mensal','Acompanhamento'],
  'nutritionist':['Consulta','Retorno','Plano alimentar','Avaliação','Acompanhamento'],
  'physiotherapist':['Avaliação','Sessão','Reabilitação','Pilates','Tratamento'],
  'dentist':['Consulta','Limpeza','Avaliação','Procedimento','Retorno'],
  'photographer':['Ensaio','Retrato','Evento','Edição','Reunião'],
  'consultant':['Consultoria','Mentoria','Diagnóstico','Reunião','Projeto'],
  'other':['Atendimento','Consulta','Retorno','Serviço','Pacote']
};
const BUSINESS_ROLE_DEFAULTS={
  'barbershop':'Barbeiro','hair-salon':'Cabeleireiro','nail-designer':'Nail designer','lash-designer':'Lash designer',
  'makeup-artist':'Maquiador(a)','beauty-clinic':'Esteticista','tattoo-studio':'Tatuador','massage-therapist':'Massoterapeuta',
  'personal-trainer':'Personal trainer','nutritionist':'Nutricionista','physiotherapist':'Fisioterapeuta','dentist':'Dentista',
  'photographer':'Fotógrafo','consultant':'Consultor','other':'Profissional'
};
function serviceCategoriesFor(shop){return BUSINESS_SERVICE_CATEGORIES[(shop&&shop.category)||'other']||BUSINESS_SERVICE_CATEGORIES.other;}
function defaultRoleFor(shop){return BUSINESS_ROLE_DEFAULTS[(shop&&shop.category)||'other']||'Profissional';}
function themeSlug(v){return String(v||'ocean-blue').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'ocean-blue';}
function applyBusinessTheme(shop){document.documentElement.setAttribute('data-business-theme',themeSlug(shop&&shop.themeId));}
function previewConfigTheme(value){applyBusinessTheme({themeId:value});const s=$('#cf_theme_status');if(s)s.textContent='Pré-visualização ativa. Clique em Aplicar tema para salvar.';}
function pageSlice(list,page,size=PAGE_SIZE){const pages=Math.max(1,Math.ceil(list.length/size));const p=Math.min(Math.max(1,page||1),pages);return {items:list.slice((p-1)*size,p*size),page:p,pages,total:list.length};}
function pageControls(state,setter){if(state.pages<=1)return '';return `<div class="pager"><button class="btn btn-ghost btn-sm" ${state.page<=1?'disabled':''} onclick="${setter}(${state.page-1})">${icon('arrowLeft')} Anterior</button><span class="muted">Página ${state.page} de ${state.pages} · ${state.total} itens</span><button class="btn btn-ghost btn-sm" ${state.page>=state.pages?'disabled':''} onclick="${setter}(${state.page+1})">Próxima ${icon('arrowRight')}</button></div>`;}
function setAgendaPage(p){agendaPage=p;refreshShell();}
function setCrmPage(p){crmPage=p;refreshShell();}

function buildDashNav(shop){
  const activeAppts=DB.scope('appointments',shop.id).filter(x=>x.status!=='cancelado').length;
  const nav=[{section:'Menu'},{id:'',label:'Painel',icon:'grid'},{id:'agenda',label:'Agendamentos',icon:'calendar',count:activeAppts}];
  if(can('manage_barbers'))nav.push({id:'barbeiros',label:'Colaboradores',icon:'users'});
  if(can('manage_services'))nav.push({id:'servicos',label:'Serviços',icon:'list'});
  if(can('manage_inventory'))nav.push({id:'estoque',label:'Produtos',icon:'box'});
  if(can('manage_settings'))nav.push({id:'config',label:'Configurações',icon:'settings'},{id:'assinatura',label:'Assinatura',icon:'creditCard'});
  return nav;
}
function dashboardTenantPill(shop){
  return `<div class="tenant-pill tenant-edit" onclick="shellGo('#/dashboard/config')"><div class="tl">${brandLogo(shop)}</div><div class="info"><b>Editar página e fotos</b><span>Logo, capa, endereço e horários</span></div>${icon('edit')}</div>`;
}
function renderDashboard(r){
  destroyCharts();
  const shop=dashShop();
  if(shop)applyBusinessTheme(shop);
  if(!shop){
    // Firebase: dados do tenant ainda não chegaram via onSnapshot — exibe skeleton enquanto aguarda
    if(window.__FB_ENABLED && Session.effectiveUser && Session.effectiveUser.barbershopId){
      $('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">
        <div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div>
        <div class="skeleton" style="width:200px;height:16px;border-radius:6px"></div>
        <p class="muted" style="font-size:13px">Carregando seu negócio...</p>
      </div>`;
      // Fallback: se em 8s ainda não chegou, algo deu errado
      if(!window._dashLoadTimeout) window._dashLoadTimeout=setTimeout(()=>{
        window._dashLoadTimeout=null;
        if(!dashShop()){toast('Não foi possível carregar a barbearia. Verifique sua conexão e recarregue.','err');}
      },6000);
      return;
    }
    toast('Conta sem barbearia vinculada.','err');location.hash=Session.effectiveUser?'#/login':'#/';return;
  }
  window._dashLoadTimeout&&clearTimeout(window._dashLoadTimeout);window._dashLoadTimeout=null;
  const sub=r.sub||'';
  const activeSubs=['','agenda','barbeiros','servicos','estoque','config','assinatura'];
  const titles={'':'Painel',agenda:'Agendamentos',barbeiros:'Colaboradores',servicos:'Serviços',estoque:'Produtos',assinatura:'Assinatura',config:'Configurações'};
  // guard sub-permission
  const permMap={barbeiros:'manage_barbers',servicos:'manage_services',estoque:'manage_inventory',assinatura:'manage_settings',config:'manage_settings'};
  if(!activeSubs.includes(sub)||!productModuleEnabled(sub)){
    const tenantPill=dashboardTenantPill(shop);
    $('#root').innerHTML=mountShell({brandShop:shop,brandSub:'Agendamento',nav:buildDashNav(shop),activeId:'',navBase:'#/dashboard/',title:'Módulo inativo',crumb:shop.name+' · '+ROLE_LABEL[Session.effectiveUser.role],content:inactiveDashboardModule(sub),tenantPill});
    renderShellNotif();
    return;
  }
  if(permMap[sub]&&!can(permMap[sub])){toast('Sem permissão para esta área.','err');location.hash='#/dashboard';return;}
  const renderers={'':dashOverview,agenda:dashAgenda,barbeiros:dashBarbers,servicos:dashServices,estoque:dashInventory,assinatura:dashSubscription,config:dashConfig};
  const lock=featureLock(shop.id,sub);
  const content=lock?lockedFeaturePage(lock.label,lock.plan,lock.enterprise):(renderers[sub]||dashOverview)(shop);
  const tenantPill=dashboardTenantPill(shop);
  $('#root').innerHTML=mountShell({brandShop:shop,brandSub:'Agendamento',nav:buildDashNav(shop),activeId:sub,navBase:'#/dashboard/',title:titles[sub]||'Painel',crumb:shop.name+' · '+ROLE_LABEL[Session.effectiveUser.role],content,tenantPill});
  renderShellNotif();
}
function inactiveDashboardModule(sub){
  const label=futureModuleLabel(sub);
  return `<div class="empty" style="padding:64px 20px"><div class="ei" style="background:var(--surface-2);color:var(--muted)">${icon('lock')}</div>
    <h3>${escapeHtml(label)} está inativo</h3>
    <p style="max-width:520px;margin:0 auto">O painel do dono está focado na operação de agendamentos. Este módulo permanece no código para uma fase futura.</p>
  </div>`;
}

/* ---------- Booking URL helpers ---------- */
function shopPublicUrl(slug){return 'https://groomin.com.br/'+slug;}
function bookingUrlCard(shop){
  const fullUrl=shopPublicUrl(shop.slug);
  const displayUrl=fullUrl.replace(/^https?:\/\//,'');
  const waText=encodeURIComponent(`Agende na ${shop.name}: ${fullUrl}`);
  const cover=shop.coverUrl?`background-image:linear-gradient(180deg,rgba(17,24,39,.08),rgba(17,24,39,.42)),url('${escapeHtml(shop.coverUrl)}');background-size:cover;background-position:center;`:'background:linear-gradient(135deg,rgba(124,58,237,.07),transparent),var(--surface);';
  return `<div class="panel" style="border-color:var(--primary);min-height:310px;display:flex;flex-direction:column;justify-content:flex-end;${cover}">
    <div class="panel-head"><div><h3>${icon('link')} Ações rápidas</h3><div class="sub">Compartilhe sua página de agendamento</div></div></div>
    <div class="input" style="background:var(--surface-3);display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:default">
      <b style="color:var(--primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(displayUrl)}</b>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="groomCopyUrl('${shop.slug}')">${icon('copy')} Copiar link</button>
      <button class="btn btn-ghost btn-sm" onclick="Router.go('#/${shop.slug}')">${icon('externalLink')} Abrir página</button>
      <a class="btn btn-ghost btn-sm" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">${icon('whatsapp')} Compartilhar no WhatsApp</a>
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
function pushEnableCard(){
  if(!window.__FB_ENABLED||!window.FCM_VAPID_KEY)return '';
  if(!('Notification' in window)||Notification.permission==='granted')return '';
  return `<div class="insight pos" style="margin:14px 0"><span class="ii">${icon('bell')}</span><div><b>Seja avisado na hora de cada agendamento</b><p>Receba uma notificação no celular ou computador sempre que um cliente agendar pelo seu link.</p></div><button class="btn btn-primary btn-sm" onclick="enablePush()">${icon('bell')} Ativar notificações</button></div>`;
}
function openShareKit(){
  const shop=dashShop();if(!shop)return;
  const url=shopPublicUrl(shop.slug);
  const isFood=shop.category==='food';
  const waText=encodeURIComponent(`${isFood?'Agora você pode encomendar online!':'Agora você pode agendar online!'} ${shop.name}: ${url}`);
  openModal(`<div class="modal-head"><div><h3>🎉 Sua página está no ar!</h3><div class="sub">Divulgue agora para os clientes começarem a ${isFood?'encomendar':'agendar'}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body" style="text-align:center">
    <div style="background:#fff;padding:16px;border-radius:12px;display:inline-block;margin-bottom:12px">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&color=0f0f0f&bgcolor=ffffff" alt="QR Code" style="width:180px;height:180px;display:block" />
    </div>
    <p class="muted" style="font-size:13px;margin-bottom:14px">${escapeHtml(url)}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">
      <a class="btn btn-primary" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">${icon('whatsapp')} Enviar no WhatsApp</a>
      <button class="btn btn-ghost" onclick="groomCopyUrl('${shop.slug}')">${icon('copy')} Copiar link</button>
      <a class="btn btn-ghost" href="https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(url)}" download="qrcode-${shop.slug}.png" target="_blank" rel="noopener">${icon('download')} Baixar QR para imprimir</a>
    </div>
    <div class="insight pos" style="text-align:left"><span class="ii">${icon('megaphone')}</span><div><b>Dica: poste nos Stories e cole o QR no balcão</b><p>Quem escaneia o código cai direto na sua página. Marque o link também na bio do Instagram.</p></div></div>
  </div>`);
}
function dashOverview(shop){
  const a=shopAnalytics(shop.id);
  const todayList=a.today.filter(x=>x.status!=='cancelado').sort((x,y)=>x.time.localeCompare(y.time));
  const now=new Date(),today=DB.todayISO(),nowMin=now.getHours()*60+now.getMinutes();
  const upcoming=a.upcoming.filter(x=>x.status!=='cancelado'&&(x.date>today||(x.date===today&&timeToMin(x.time)>=nowMin))).slice(0,8);
  const apptMini=(ap)=>{const s=DB.find('services',ap.serviceId),b=DB.find('barbers',ap.barberId);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('calendar')}</span><div><b>${escapeHtml(ap.customerName||'Cliente')}</b><br><small>${fmtDateShort(ap.date)} · ${ap.time} · ${s?escapeHtml(s.name):'Serviço'}${b?' · '+escapeHtml(b.name.split(' ')[0]):''}</small></div><span class="badge ${STATUS[ap.status].cls}" style="margin-left:auto">${STATUS[ap.status].label}</span></div>`;};
  if(sessionStorage.getItem('groomin_sharekit')){sessionStorage.removeItem('groomin_sharekit');setTimeout(()=>window.openShareKit&&openShareKit(),400);}
  return `${bookingUrlCard(shop)}
  ${pushEnableCard()}
  ${shop.schedulePaused?`<div class="insight warn" style="margin-bottom:14px"><span class="ii">${icon('clock')}</span><div><b>Agenda pausada</b><p>Clientes veem "Agenda pausada" e não conseguem criar novos agendamentos.</p></div><button class="btn btn-primary btn-sm" onclick="toggleSchedulePause()">${icon('play')} Retomar</button></div>`:''}
  <div class="stat-grid">
    ${statCard('c1','calendar','Agendamentos de hoje',todayList.length,'')}
    ${statCard('c2','clock','Próximos agendamentos',a.upcoming.length,'')}
    ${statCard('c3','users','Clientes',DB.scope('customers',shop.id).length,'')}
    ${statCard('c4','dollar','Receita de hoje',money(a.revToday),'apenas concluídos')}
  </div>
  ${ownerFinanceStrip(shop)}
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Agendamentos de hoje</h3><button class="btn btn-ghost btn-sm" onclick="Router.go('#/dashboard/agenda')">Agendamentos</button></div>
      ${todayList.length?todayList.map(apptMini).join(''):emptyState('calendar','Nenhum agendamento hoje','Compartilhe seu link para preencher a agenda de hoje.','Copiar link',`groomCopyUrl('${shop.slug}')`)}
    </div>
    <div class="panel"><div class="panel-head"><h3>Próximos agendamentos</h3></div>
      ${upcoming.length?upcoming.map(apptMini).join(''):emptyState('clock','Nenhum agendamento futuro','As próximas reservas aparecem aqui quando clientes agendam online.','Abrir página',`Router.go('#/${shop.slug}')`)}
    </div>
  </div>`;
}
function ownerFinanceStrip(shop){
  const t=DB.todayISO(),appts=DB.scope('appointments',shop.id).filter(a=>a.status==='concluido');
  const rev=(list)=>list.reduce((s,a)=>s+(a.price||0),0);
  const weekStart=DB.addDays(t,-6),month=t.slice(0,7);
  const today=appts.filter(a=>a.date===t),week=appts.filter(a=>a.date>=weekStart&&a.date<=t),mon=appts.filter(a=>a.date.slice(0,7)===month);
  return `<div class="panel" style="margin:14px 0"><div class="panel-head"><div><h3>${icon('dollar')} Financeiro simples</h3><div class="sub">Receita ganha com atendimentos concluídos</div></div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:0">
      ${statCard('f1','calendar','Hoje',money(rev(today)),`${today.length} atendimento(s)`)}
      ${statCard('f2','chart','Últimos 7 dias',money(rev(week)),`${week.length} atendimento(s)`)}
      ${statCard('f3','dollar','Este mês',money(rev(mon)),`${mon.length} atendimento(s)`)}
    </div></div>`;
}
function dashOverviewCharts(shop){
  const a=shopAnalytics(shop.id);
  mkChart('dRev','line',{labels:a.days,datasets:[{data:a.revSeries,borderColor:DASH_CHART_PRIMARY,backgroundColor:'rgba(124,58,237,.14)',fill:true,tension:.4,borderWidth:3,pointRadius:4,pointBackgroundColor:DASH_CHART_PRIMARY}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});
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
    const pg=pageSlice(list,agendaPage);agendaPage=pg.page;
    body=list.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Data</th><th>Hora</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${pg.items.map(ap=>apptRow(ap)).join('')}</tbody></table></div>${pageControls(pg,'setAgendaPage')}`:emptyState('calendar','Sem agendamentos','Compartilhe sua página pública para receber reservas.','Copiar link',`groomCopyUrl('${shop.slug}')`);
  }else{
    body=`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${barbers.map(b=>{
      const evs=dayAppts.filter(a=>a.barberId===b.id).sort((x,y)=>x.time.localeCompare(y.time));
      const bls=blocks.filter(x=>x.barberId===b.id);
      return `<div class="panel" style="margin:0"><div class="panel-head" style="margin-bottom:12px"><div class="t-user"><div class="av">${initials(b.name)}</div><div><b>${escapeHtml(b.name.split(' ')[0])}</b><small>${b.start}–${b.end}</small></div></div></div>
        ${bls.map(x=>`<div class="cal-event blocked"><div><b>${x.fullDay?'Dia bloqueado':x.start+'–'+x.end}</b><small>${escapeHtml(x.reason||'Bloqueio')}</small></div>${canManage?`<button class="ra del" title="Desbloquear" onclick="event.stopPropagation();removeBlock('${x.id}')">${icon('unlock')}</button>`:''}</div>`).join('')}
        ${evs.length?evs.map(ap=>{const s=DB.find('services',ap.serviceId);return `<div class="cal-event s-${ap.status}" onclick="apptForm('${ap.id}')"><div><b>${ap.time} · ${s?escapeHtml(s.name):''}</b><small>${escapeHtml(ap.customerName)}</small></div>${ap.status!=='cancelado'&&ap.status!=='concluido'?`<button class="ra" title="Lembrar cliente no WhatsApp" onclick="event.stopPropagation();apptReminderWa('${ap.id}')">${icon('whatsapp')}</button>`:''}</div>`;}).join(''):(bls.length?'':`<p class="muted" style="font-size:13px;text-align:center;padding:14px 0">Livre</p>`)}
      </div>`;}).join('')||emptyState('users','Sem profissionais','Cadastre profissionais para ver a agenda.','Adicionar profissional','barberForm()')}</div>`;
  }
  return `<div class="page-head"><div><h2>Agenda</h2><p>${shop.schedulePaused?'Agenda pausada · ':''}${dayAppts.filter(a=>a.status!=='cancelado').length} agendamento(s) em ${fmtDate(agendaDate)}</p></div>
    <div class="page-actions">
      ${canManage?`<button class="btn btn-ghost" onclick="blockForm()">${icon('lock')} Bloquear</button>`:''}
      ${canManage?`<button class="btn btn-ghost" onclick="Router.go('#/dashboard/config')">${icon('settings')} Horários</button>`:''}
      ${canManage?`<button class="btn btn-primary" onclick="apptForm()">${icon('plus')} Novo agendamento</button>`:''}
      ${canManage?`<button class="btn ${shop.schedulePaused?'btn-primary':'btn-ghost'}" onclick="toggleSchedulePause()">${icon(shop.schedulePaused?'play':'clock')} ${shop.schedulePaused?'Retomar agenda':'Pausar agenda'}</button>`:''}
    </div></div>
  <div class="toolbar">
    <div class="seg"><button class="${agendaView==='dia'?'on':''}" onclick="agendaView='dia';refreshShell()">Dia</button><button class="${agendaView==='lista'?'on':''}" onclick="agendaView='lista';agendaPage=1;refreshShell()">Lista</button></div>
    ${agendaView==='dia'?`<div style="display:flex;gap:8px;align-items:center"><button class="icon-btn" onclick="agendaDate=DB.addDays(agendaDate,-1);refreshShell()">${icon('arrowLeft')}</button><input class="input" type="date" style="width:auto" value="${agendaDate}" onchange="agendaDate=this.value;refreshShell()"><button class="icon-btn" onclick="agendaDate=DB.addDays(agendaDate,1);refreshShell()">${icon('arrowRight')}</button><button class="btn btn-ghost btn-sm" onclick="agendaDate=DB.todayISO();refreshShell()">Hoje</button></div>`:''}
  </div>
  ${body}`;
}
function apptReminderWa(id){
  const ap=DB.find('appointments',id);if(!ap)return;
  const shop=dashShop();const s=DB.find('services',ap.serviceId);
  let d=(ap.phone||'').replace(/\D/g,'');
  if(!d){toast('Este agendamento não tem telefone cadastrado.','err');return;}
  if(d.length>=10&&d.length<=11)d='55'+d;
  const firstName=(ap.customerName||'').trim().split(' ')[0]||'cliente';
  const isFood=shop&&shop.category==='food';
  const when=`${fmtDate(ap.date)} às ${ap.time}`;
  const txt=encodeURIComponent(isFood
    ?`Oi ${firstName}! Passando para lembrar da sua encomenda na ${shop.name}: ${when}${s?` (${s.name})`:''}. Até lá! 😊`
    :`Oi ${firstName}! Passando para lembrar do seu horário na ${shop.name}: ${when}${s?` (${s.name})`:''}. Qualquer imprevisto é só avisar por aqui. Até lá! ✂️`);
  window.open(`https://wa.me/${d}?text=${txt}`,'_blank','noopener');
}
function apptRow(ap){
  const s=DB.find('services',ap.serviceId),b=DB.find('barbers',ap.barberId),canManage=can('manage_appointments');
  const consumed=(ap.consumption&&ap.consumption.length&&productModuleEnabled('inventory'))?` <span class="badge gold" title="Consumo registrado">${icon('droplet')}</span>`:'';
  const consumeBtn=canManage&&ap.status!=='cancelado'&&can('manage_inventory')&&productModuleEnabled('inventory')?`<button class="ra" title="Registrar consumo de produtos" onclick="consumeForm('${ap.id}')">${icon('droplet')}</button>`:'';
  return `<tr><td><div class="t-user"><div class="av">${initials(ap.customerName)}</div><div><b>${escapeHtml(ap.customerName)}</b><small>${escapeHtml(ap.phone)}</small></div></div></td><td>${s?escapeHtml(s.name):'—'}</td><td>${b?escapeHtml(b.name):'—'}</td><td>${fmtDate(ap.date)}</td><td>${ap.time}</td><td>${money(ap.price)}${consumed}</td><td><span class="badge ${STATUS[ap.status].cls}">${STATUS[ap.status].label}</span></td><td><div class="row-actions">${ap.status!=='cancelado'&&ap.status!=='concluido'?`<button class="ra" title="Lembrar cliente no WhatsApp" onclick="apptReminderWa('${ap.id}')">${icon('whatsapp')}</button>`:''}${consumeBtn}${canManage&&ap.status!=='concluido'&&ap.status!=='cancelado'?`<button class="ra" title="Concluir" onclick="apptStatus('${ap.id}','concluido')">${icon('check')}</button>`:''}${canManage?`<button class="ra" title="Editar" onclick="apptForm('${ap.id}')">${icon('edit')}</button>`:''}${canManage&&ap.status!=='cancelado'?`<button class="ra del" title="Cancelar" onclick="apptStatus('${ap.id}','cancelado')">${icon('x')}</button>`:''}</div></td></tr>`;
}
function apptStatus(id,status){DB.update('appointments',id,{status});const ap=DB.find('appointments',id);if(status==='cancelado')DB.insert('notifications',{barbershopId:ap.barbershopId,type:'cancel',title:'Cancelamento',msg:`${ap.customerName} — ${fmtDateShort(ap.date)} ${ap.time}`,time:Date.now(),read:false});DB.log(status==='cancelado'?'Agendamento cancelado':'Agendamento concluído',ap.customerName,ap.barbershopId);toast('Status atualizado.',status==='cancelado'?'info':'ok');refreshShell();}
async function toggleSchedulePause(){
  const shop=dashShop(),paused=!shop.schedulePaused;
  const patch={schedulePaused:paused,schedulePausedAt:paused?Date.now():0};
  if(window.__FB_ENABLED&&window.fbSaveTenantProfile){try{await fbSaveTenantProfile(shop.id,patch);}catch(e){toast(saveTenantMsg(e),'err');return;}}
  DB.update('barbershops',shop.id,patch);DB.log(paused?'Agenda pausada':'Agenda retomada',shop.name,shop.id);toast(paused?'Agenda pausada para novos clientes.':'Agenda retomada.','ok');refreshShell();
}
function apptForm(id){
  const shop=dashShop();const ap=id?DB.find('appointments',id):null;
  const svcs=DB.scope('services',shop.id),barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  const apSvcName=ap?(DB.find('services',ap.serviceId)||{}).name||'':'';
  const apBarberName=ap?(DB.find('barbers',ap.barberId)||{}).name||'':'';
  const waPhone=ap&&ap.phone?ap.phone.replace(/\D/g,''):'';
  const waMsg=ap&&waPhone?encodeURIComponent(`Olá, ${ap.customerName}! Lembrando do seu agendamento na ${shop.name}: ${apSvcName} com ${apBarberName} em ${fmtDate(ap.date)} às ${ap.time}. Qualquer dúvida é só chamar! 💈`):'';
  const waBtn=ap&&waPhone?`<a class="btn btn-ghost btn-sm" href="https://wa.me/55${waPhone}?text=${waMsg}" target="_blank" rel="noopener" style="margin-right:auto">${icon('whatsapp')} Lembrete WhatsApp</a>`:'';
  const cancelBtn=ap&&ap.status!=='cancelado'?`<button class="btn btn-ghost" style="color:var(--danger)" onclick="apptStatus('${ap.id}','cancelado');closeModal()">${icon('x')} Cancelar agendamento</button>`:'';
  openModal(`<div class="modal-head"><div><h3>${ap?'Remarcar / editar':'Novo'} agendamento</h3></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
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
  <div class="modal-foot">${waBtn}${cancelBtn}<button class="btn btn-ghost" onclick="closeModal()">Fechar</button><button class="btn btn-primary" onclick="saveAppt('${id||''}')">Salvar</button></div>`);
}
function saveAppt(id){
  const shop=dashShop();const name=$('#ap_name').value.trim(),phone=$('#ap_phone').value.trim();
  if(name.length<2||phone.length<8){toast('Preencha cliente e telefone.','err');return;}
  const svcId=$('#ap_svc').value,svc=DB.find('services',svcId);const barberId=$('#ap_barber').value;const date=$('#ap_date').value,time=$('#ap_time').value,status=$('#ap_status').value;
  if(!id||status!=='cancelado'){
    const slot=barberSlots(shop.id,barberId,date,svc.duration).find(s=>s.time===time);
    const s0=timeToMin(time),e0=s0+(svc.duration||30);
    const conflict=DB.scope('appointments',shop.id).some(a=>{if(a.id===id||a.barberId!==barberId||a.date!==date||a.status==='cancelado')return false;const svcA=DB.find('services',a.serviceId);const a0=timeToMin(a.time),a1=a0+(a.duration||(svcA?svcA.duration:30));return s0<a1&&e0>a0;});
    if(conflict||!slot||!slot.available){toast('Este período conflita com outro agendamento ou bloqueio.','err');return;}
  }
  const data={customerName:name,phone,serviceId:svcId,barberId,date,time,duration:svc.duration,status,price:svc.price};
  if(id){DB.update('appointments',id,data);DB.log('Agendamento editado',name,shop.id);toast('Agendamento atualizado.','ok');}
  else{let cust=DB.scope('customers',shop.id).find(c=>c.phone===phone);if(!cust)cust=DB.insert('customers',{barbershopId:shop.id,name,phone,whatsapp:phone,email:'',birthday:'',notes:''});data.barbershopId=shop.id;data.customerId=cust.id;data.createdAt=Date.now();DB.insert('appointments',data);DB.log('Agendamento criado',name,shop.id);toast('Agendamento criado.','ok');}
  closeModal();refreshShell();
}
function blockForm(){
  const shop=dashShop();const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  openModal(`<div class="modal-head"><div><h3>Bloquear horário</h3><div class="sub">Indisponibilize um período ou dia inteiro</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Profissional</label><select class="input" id="bl_barber"><option value="all">Todos os profissionais</option>${barbers.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Data</label><input class="input" type="date" id="bl_date" value="${agendaDate||DB.todayISO()}" min="${DB.todayISO()}"></div>
    <div class="checkbox-row"><div class="switch" id="bl_full" onclick="this.classList.toggle('on');$('#bl_times').style.display=this.classList.contains('on')?'none':'grid'"></div><label style="margin:0">Bloquear o dia inteiro</label></div>
    <div class="form-row" id="bl_times"><div class="field"><label>Início</label><input class="input" type="time" id="bl_start" value="12:00"></div><div class="field"><label>Fim</label><input class="input" type="time" id="bl_end" value="13:00"></div></div>
    <div class="field"><label>Motivo</label><input class="input" id="bl_reason" placeholder="Ex.: almoço, compromisso..."></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveBlock()">Bloquear</button></div>`);
}
function saveBlock(){const shop=dashShop();const full=$('#bl_full').classList.contains('on'),start=$('#bl_start').value,end=$('#bl_end').value;if(!full&&timeToMin(start)>=timeToMin(end)){toast('O fim precisa ser depois do início.','err');return;}DB.insert('blocks',{barbershopId:shop.id,barberId:$('#bl_barber').value,date:$('#bl_date').value,start,end,reason:$('#bl_reason').value.trim(),fullDay:full});DB.log('Horário bloqueado',$('#bl_date').value,shop.id);closeModal();toast('Bloqueio criado.','ok');refreshShell();}
function removeBlock(id){const b=DB.find('blocks',id);if(!b)return;confirmAction('Desbloquear horário?','Esse período voltará a aceitar agendamentos se houver profissional e horário disponível.',()=>{DB.remove('blocks',id);DB.log('Horário desbloqueado',b.date,b.barbershopId);toast('Bloqueio removido.','ok');refreshShell();});}

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
function customerMarketingSegments(shop){
  const customers=DB.scope('customers',shop.id).map(c=>({...c,st:customerStats(shop.id,c.id)}));
  const now=new Date(),month=now.getMonth(),today=now.toISOString().slice(5,10);
  const inDays=(c,days)=>{if(!c.birthday)return false;const [_,m,d]=c.birthday.split('-').map(Number);const next=new Date(now.getFullYear(),m-1,d);if(next<new Date(now.getFullYear(),now.getMonth(),now.getDate()))next.setFullYear(now.getFullYear()+1);return Math.ceil((next-now)/86400000)<=days;};
  return {
    all:customers,
    inactive30:customers.filter(c=>c.st.daysSince>30&&c.st.visits>0),
    inactive60:customers.filter(c=>c.st.daysSince>60&&c.st.visits>0),
    inactive90:customers.filter(c=>c.st.daysSince>90&&c.st.visits>0),
    birthdayToday:customers.filter(c=>c.birthday&&c.birthday.slice(5)===today),
    birthdayWeek:customers.filter(c=>inDays(c,7)),
    birthdayMonth:customers.filter(c=>c.birthday&&new Date(c.birthday+'T00:00:00').getMonth()===month),
    vip:customers.filter(c=>c.st.seg==='vip'),
  };
}
function campaignMessage(type,shop,c){
  const first=(c.name||'').split(' ')[0]||'cliente';
  const link=`https://groomin.com.br/b/${shop.slug||''}`;
  if(type==='birthday')return `Oi, ${first}! Feliz aniversário! A equipe da ${shop.name} preparou uma condição especial para você comemorar no estilo. Quer reservar seu horário? ${link}`;
  if(type==='inactive60')return `Oi, ${first}! Faz um tempo que você não aparece na ${shop.name}. Que tal voltar essa semana para renovar o visual? Posso te ajudar a escolher um horário: ${link}`;
  if(type==='inactive90')return `Oi, ${first}! Sentimos sua falta na ${shop.name}. Temos horários disponíveis e queremos te receber de volta com um atendimento caprichado. Reservar: ${link}`;
  return `Oi, ${first}! Sentimos sua falta na ${shop.name}. Esta semana é uma boa para atualizar o corte. Quer agendar? ${link}`;
}
function waLink(phone,msg){const n=String(phone||'').replace(/\D/g,'');return n?`https://wa.me/55${n}?text=${encodeURIComponent(msg)}`:'#';}
function dashCRM(shop){
  const customers=DB.scope('customers',shop.id).map(c=>({...c,st:customerStats(shop.id,c.id)}));
  const counts={todos:customers.length,vip:customers.filter(c=>c.st.seg==='vip').length,frequente:customers.filter(c=>c.st.seg==='frequente').length,inativo:customers.filter(c=>c.st.seg==='inativo').length,novo:customers.filter(c=>c.st.seg==='novo').length};
  const list=crmSeg==='todos'?customers:customers.filter(c=>c.st.seg===crmSeg);
  const pg=pageSlice(list,crmPage);crmPage=pg.page;
  const segCard=(k,label,ic,color)=>`<div class="seg-card ${crmSeg===k?'sel':''}" onclick="crmSeg='${k}';crmPage=1;refreshShell()"><div class="sc-ic si ${color}">${icon(ic)}</div><b>${counts[k]}</b><span>${label}</span></div>`;
  return `<div class="page-head"><div><h2>Clientes (CRM)</h2><p>Inteligência de relacionamento e fidelização</p></div><div class="page-actions"><button class="btn btn-primary" onclick="customerForm()">${icon('plus')} Novo cliente</button></div></div>
  <div class="seg-grid">${segCard('todos','Todos','users','c1')}${segCard('vip','VIP','award','c4')}${segCard('frequente','Frequentes','heart','c2')}${segCard('inativo','Inativos','clock','c5')}${segCard('novo','Novos','sparkle','c3')}</div>
  ${list.length?`<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Segmento</th><th>Visitas</th><th>Total gasto</th><th>Última visita</th><th>Favorito</th><th></th></tr></thead><tbody>
  ${pg.items.map(c=>{const segB={vip:['gold','VIP'],frequente:['ok','Frequente'],inativo:['danger','Inativo'],novo:['info','Novo'],todos:['muted','-']}[c.st.seg];return `<tr>
    <td><div class="t-user"><div class="av">${initials(c.name)}</div><div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.phone)}</small></div></div></td>
    <td><span class="badge ${segB[0]}">${segB[1]}</span></td><td>${c.st.visits}</td><td><b>${money(c.st.totalSpent)}</b></td>
    <td>${c.st.last?fmtDateShort(c.st.last)+' ('+c.st.daysSince+'d)':'—'}</td><td class="muted">${escapeHtml(c.st.favSvc)}</td>
    <td><div class="row-actions">${(c.whatsapp||c.phone)?`<a class="ra wpp" title="WhatsApp" href="https://wa.me/55${(c.whatsapp||c.phone).replace(/\D/g,'')}?text=${encodeURIComponent('Olá, '+c.name+'! Aqui é da '+shop.name+'. Como posso te ajudar?')}" target="_blank" rel="noopener">${icon('whatsapp')}</a>`:''}<button class="ra" title="Detalhes" onclick="customerDetail('${c.id}')">${icon('eye')}</button><button class="ra" title="Editar" onclick="customerForm('${c.id}')">${icon('edit')}</button><button class="ra del" onclick="delCustomer('${c.id}')">${icon('trash')}</button></div></td></tr>`;}).join('')}
  </tbody></table></div>${pageControls(pg,'setCrmPage')}`:emptyState('users','Nenhum cliente neste segmento','Os clientes aparecem aqui conforme o histórico.')}`;
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

/* ---------- Barbers ---------- */
function dashBarbers(shop){
  const list=DB.scope('barbers',shop.id);
  const active=list.filter(b=>b.active).length;
  const e=shopEntitlements(shop.id);const lim=e.limitBarbers>=999?'∞':e.limitBarbers;
  return `<div class="page-head"><div><h2>Colaboradores</h2><p>${active}/${lim} ativo(s) · plano ${escapeHtml(e.planName)}${active>=e.limitBarbers&&e.limitBarbers<999?' · <span style="color:var(--warn)">limite atingido</span>':''}</p></div><div class="page-actions"><button class="btn btn-primary" onclick="barberForm()">${icon('plus')} Novo colaborador</button></div></div>
  <div class="barber-grid">${list.map(b=>{const st=DB.scope('appointments',shop.id).filter(a=>a.barberId===b.id&&a.status==='concluido');const rev=st.reduce((s,a)=>s+a.price,0);return `<div class="barber-card" style="${b.active?'':'opacity:.66'}"><div class="ph">${imageOrInitials(b.photoUrl,b.name,'barber-photo')}<span class="badge ${b.active?'ok':'muted'}" style="position:absolute;top:12px;right:12px">${b.active?'Ativo':'Inativo'}</span>${b.isOwner?`<span class="badge gold" style="position:absolute;top:12px;left:12px">${icon('award')} Dono</span>`:''}</div><div class="bbody"><h3>${escapeHtml(b.name)}</h3><div class="role">${escapeHtml(b.role)} · ${b.rating}★</div><div class="spec">${b.specialties.map(s=>`<span class="tag">${escapeHtml(s)}</span>`).join('')}</div><div class="summary-line" style="margin-top:10px"><span class="muted">Comissão serv./prod.</span><b>${b.commission||0}% / ${b.productCommission??10}%</b></div><div class="summary-line"><span class="muted">Faturou</span><b>${money(rev)}</b></div><div class="summary-line"><span class="muted">Expediente</span><b>${b.start}–${b.end}</b></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-ghost btn-sm" style="flex:1" onclick="barberForm('${b.id}')">${icon('edit')} Editar</button><button class="btn btn-sm ${b.active?'btn-ghost':'btn-primary'}" onclick="toggleBarberActive('${b.id}')">${b.active?'Inativar':'Ativar'}</button>${b.isOwner?'':`<button class="ra del" title="Excluir" onclick="delBarber('${b.id}')">${icon('trash')}</button>`}</div></div></div>`;}).join('')||emptyState('users','Sem colaboradores','Cadastre o primeiro colaborador para liberar horários online.','Adicionar colaborador','barberForm()')}</div>`;
}
function toggleBarberActive(id){
  const shop=dashShop();const b=DB.find('barbers',id);
  if(!b||b.barbershopId!==shop.id){toast('Colaborador inválido.','err');return;} // tenant guard
  const turningOff=b.active;
  if(!turningOff){const e=shopEntitlements(shop.id);const active=DB.scope('barbers',shop.id).filter(x=>x.active).length;if(active>=e.limitBarbers){toast(`Seu plano (${e.planName}) permite ${e.limitBarbers} profissional(is) ativo(s). Faça upgrade para ativar mais.`,'err');return;}}
  const future=DB.scope('appointments',shop.id).filter(a=>a.barberId===id&&a.date>=DB.todayISO()&&(a.status==='confirmado'||a.status==='pendente')).length;
  const apply=()=>{DB.update('barbers',id,{active:!b.active});DB.log(turningOff?'Colaborador inativado':'Colaborador ativado',b.name,shop.id);toast(turningOff?`${b.name.split(' ')[0]} inativado — não aparece mais na agenda.`:`${b.name.split(' ')[0]} ativado.`,turningOff?'info':'ok');refreshShell();};
  if(turningOff&&future>0)confirmAction('Inativar colaborador?',`${b.name} tem ${future} agendamento(s) futuro(s). Ele deixará de aparecer para novos agendamentos, mas os já marcados continuam na agenda. Deseja continuar?`,apply,false);
  else apply();
}
function barberForm(id){
  const shop=dashShop();const b=id?DB.find('barbers',id):null;const days=b?b.days:[1,2,3,4,5,6];const defaultRole=defaultRoleFor(shop);
  openModal(`<div class="modal-head"><h3>${b?'Editar':'Novo'} colaborador</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="form-row"><div class="field"><label>Nome *</label><input class="input" id="ba_name" value="${b?escapeHtml(b.name):''}"></div><div class="field"><label>Função</label><input class="input" id="ba_role" value="${b?escapeHtml(b.role):escapeHtml(defaultRole)}"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="ba_phone" value="${b?escapeHtml(b.phone||''):''}"></div><div class="field"><label>E-mail</label><input class="input" id="ba_email" value="${b?escapeHtml(b.email||''):''}"></div></div>
    <div class="field"><label>Foto do colaborador</label>
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
function previewLogo(input){const file=input.files[0];if(!file)return;const rem=$('#cf_logo_remove');if(rem)rem.value='0';const reader=new FileReader();reader.onload=e=>{const p=$('#cf_logo_preview');if(!p)return;p.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;};reader.readAsDataURL(file);}
function previewCover(input){const file=input.files[0];if(!file)return;const rem=$('#cf_cover_remove');if(rem)rem.value='0';const reader=new FileReader();reader.onload=e=>{const p=$('#cf_cover_preview');if(!p)return;p.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;};reader.readAsDataURL(file);}
function clearShopLogo(){const rem=$('#cf_logo_remove');if(rem)rem.value='1';const fi=$('#cf_logo_file');if(fi)fi.value='';const p=$('#cf_logo_preview');if(p){const n=$('#cf_name');p.innerHTML=`<span style="font-size:1.4rem;font-weight:800;color:var(--primary)">${initials(n?n.value:'?')}</span>`;}$$('.remove-logo-btn').forEach(b=>b.style.display='none');}
function clearShopCover(){const rem=$('#cf_cover_remove');if(rem)rem.value='1';const fi=$('#cf_cover_file');if(fi)fi.value='';const p=$('#cf_cover_preview');if(p)p.innerHTML='<span class="muted" style="font-size:11px">Sem capa</span>';$$('.remove-cover-btn').forEach(b=>b.style.display='none');}
function previewBarberPhoto(input){const file=input.files[0];if(!file)return;const rem=$('#ba_photo_remove');if(rem)rem.value='0';const reader=new FileReader();reader.onload=e=>{const p=$('#ba_photo_preview');if(!p)return;p.innerHTML=`<img src="${e.target.result}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;};reader.readAsDataURL(file);}
function clearBarberPhoto(){const rem=$('#ba_photo_remove');if(rem)rem.value='1';const fi=$('#ba_photo_file');if(fi)fi.value='';const p=$('#ba_photo_preview');if(p){const n=$('#ba_name');p.innerHTML=`<span>${initials(n?n.value:'?')}</span>`;}$$('.remove-photo-btn').forEach(b=>b.style.display='none');}
async function saveBarber(id){const shop=dashShop();const name=$('#ba_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const days=$$('#ba_days .chip-toggle.on').map(e=>+e.dataset.day);const vs=$('#ba_vs').value,ve=$('#ba_ve').value;const old=id?DB.find('barbers',id):null;const data={name,role:$('#ba_role').value.trim()||defaultRoleFor(shop),phone:$('#ba_phone').value.trim(),email:$('#ba_email').value.trim(),bio:$('#ba_bio').value.trim(),specialties:$('#ba_spec').value.split(',').map(s=>s.trim()).filter(Boolean),commission:+$('#ba_comm').value||0,productCommission:+$('#ba_pcomm').value||0,start:$('#ba_start').value,end:$('#ba_end').value,lunchStart:$('#ba_ls').value,lunchEnd:$('#ba_le').value,days,vacations:vs&&ve?[{start:vs,end:ve}]:[],active:$('#ba_active').classList.contains('on')};
  const shouldRemove=$('#ba_photo_remove')&&$('#ba_photo_remove').value==='1';
  if(shouldRemove){if(old&&old.photoPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(old.photoPath).catch(()=>{});data.photoUrl='';data.photoPath='';}
  else{const file=$('#ba_photo_file')&&$('#ba_photo_file').files[0];if(file&&window.fbUploadTenantImage){try{toast('Enviando foto...','info');const up=await fbUploadTenantImage(shop.id,'barbers',file,old&&old.photoPath);data.photoUrl=up.url;data.photoPath=up.path;}catch(e){toast(e.code==='image-too-large'?'Imagem maior que 5MB.':e.code==='storage-not-configured'?'Firebase Storage ainda não foi configurado.':'Não foi possível enviar a foto.','err');return;}}}
  if(!id&&data.active){const e=shopEntitlements(shop.id);const active=DB.scope('barbers',shop.id).filter(x=>x.active).length;if(active>=e.limitBarbers){toast(`Seu plano (${e.planName}) permite ${e.limitBarbers} profissional(is) ativo(s). Faça upgrade ou cadastre como inativo.`,'err');return;}}
  if(id)DB.update('barbers',id,data);else DB.insert('barbers',{barbershopId:shop.id,rating:5,...data});DB.log(id?'Colaborador editado':'Colaborador criado',name,shop.id);closeModal();toast('Colaborador salvo.','ok');refreshShell();}
function delBarber(id){confirmAction('Excluir colaborador?','Esta ação não pode ser desfeita.',()=>{const b=DB.find('barbers',id);DB.remove('barbers',id);if(b&&b.photoPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(b.photoPath).catch(()=>{});toast('Colaborador excluído.','info');refreshShell();});}

/* ---------- Services ---------- */
function dashServices(shop){
  const list=DB.scope('services',shop.id);
  return `<div class="page-head"><div><h2>Serviços</h2><p>${list.length} serviço(s)</p></div><div class="page-actions"><button class="btn btn-primary" onclick="serviceForm()">${icon('plus')} Novo serviço</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Serviço</th><th>Categoria</th><th>Duração</th><th>Preço</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(s=>`<tr><td><div class="t-user"><div class="av">${icon(s.icon||'scissors')}</div><div><b>${escapeHtml(s.name)}</b><small>${escapeHtml((s.desc||'').slice(0,38))}</small></div></div></td><td><span class="tag">${escapeHtml(s.category)}</span></td><td>${s.duration} min</td><td><b>${money(s.price)}</b></td><td><span class="badge ${s.active?'ok':'muted'}">${s.active?'Ativo':'Inativo'}</span></td><td><div class="row-actions"><button class="ra" onclick="serviceForm('${s.id}')">${icon('edit')}</button><button class="ra del" onclick="delService('${s.id}')">${icon('trash')}</button></div></td></tr>`).join('')||`<tr><td colspan="6">${emptyState('list','Sem serviços','Cadastre o primeiro serviço para seus clientes agendarem online.','Adicionar serviço','serviceForm()')}</td></tr>`}
  </tbody></table></div>`;
}
function serviceForm(id){
  const shop=dashShop();const s=id?DB.find('services',id):null;const cats=serviceCategoriesFor(shop).slice();if(s&&s.category&&!cats.includes(s.category))cats.unshift(s.category);const icons=['scissors','user','star','eye','droplet','zap','sparkle','activity','heart','camera','briefcase','shield'];
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
  const seg=customerMarketingSegments(shop);
  const autoCard=(key,title,desc,ic,items,type)=>`<div class="card" style="padding:16px">
    <div class="mini-slot" style="margin:0 0 10px"><span class="ic">${icon(ic)}</span><div><b>${escapeHtml(title)}</b><br><small>${escapeHtml(desc)}</small></div><span class="badge ${items.length?'gold':'muted'}" style="margin-left:auto">${items.length}</span></div>
    ${items.slice(0,4).map(c=>`<div class="summary-line"><span><b>${escapeHtml(c.name)}</b><br><small class="muted">${c.st&&c.st.last?'última visita '+fmtDateShort(c.st.last):c.birthday?fmtDate(c.birthday):'sem histórico'}</small></span><a class="btn btn-ghost btn-sm" href="${waLink(c.whatsapp||c.phone,campaignMessage(type,shop,c))}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a></div>`).join('')||'<p class="muted" style="font-size:13px">Nenhum cliente neste público agora.</p>'}
    ${items.length>4?`<button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" onclick="openMarketingAudience('${key}')">Ver todos (${items.length})</button>`:''}
  </div>`;
  return `<div class="page-head"><div><h2>Marketing</h2><p>Campanhas e automações para fidelizar e reativar</p></div><div class="page-actions"><button class="btn btn-primary" onclick="campaignForm()">${icon('plus')} Nova campanha</button></div></div>
  <div class="stat-grid">
    ${statCard('c4','gift','Aniversariantes do mês',seg.birthdayMonth.length,'hoje: '+seg.birthdayToday.length)}
    ${statCard('c1','clock','Inativos 30+ dias',seg.inactive30.length,'reativação')}
    ${statCard('c5','alert','Inativos 90+ dias',seg.inactive90.length,'risco alto')}
    ${statCard('c2','award','Clientes VIP',seg.vip.length,'maior valor')}
  </div>
  <div class="panel"><div class="panel-head"><h3>${icon('zap')} Públicos automáticos</h3><span class="badge ok">Prontos para ação</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
      ${autoCard('birthdayWeek','Aniversariantes da semana','Mensagem de relacionamento e benefício.','gift',seg.birthdayWeek,'birthday')}
      ${autoCard('inactive30','Reativação 30+ dias','Clientes que já conhecem a barbearia e sumiram.','clock',seg.inactive30,'inactive30')}
      ${autoCard('inactive60','Reativação 60+ dias','Oferta mais forte para recuperar recorrência.','repeat',seg.inactive60,'inactive60')}
      ${autoCard('inactive90','Recuperação 90+ dias','Clientes em risco alto de perda.','alert',seg.inactive90,'inactive90')}
    </div>
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
function openMarketingAudience(key){
  const shop=dashShop(),seg=customerMarketingSegments(shop);
  const map={birthdayWeek:['Aniversariantes da semana',seg.birthdayWeek,'birthday'],inactive30:['Inativos 30+ dias',seg.inactive30,'inactive30'],inactive60:['Inativos 60+ dias',seg.inactive60,'inactive60'],inactive90:['Inativos 90+ dias',seg.inactive90,'inactive90'],vip:['Clientes VIP',seg.vip,'inactive30']};
  const [title,items,type]=map[key]||map.inactive30;
  openModal(`<div class="modal-head"><div><h3>${escapeHtml(title)}</h3><div class="sub">${items.length} cliente(s)</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">${items.map(c=>`<div class="mini-slot"><span class="ic">${initials(c.name)}</span><div><b>${escapeHtml(c.name)}</b><br><small>${escapeHtml(c.phone||c.email||'sem contato')} · ${c.st&&c.st.last?'última visita '+fmtDateShort(c.st.last):c.birthday?fmtDate(c.birthday):'sem histórico'}</small></div><a class="btn btn-ghost btn-sm" href="${waLink(c.whatsapp||c.phone,campaignMessage(type,shop,c))}" target="_blank" rel="noopener">${icon('whatsapp')} Enviar</a></div>`).join('')||emptyState('users','Nenhum cliente','Este público ainda está vazio.')}</div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fechar</button></div>`);
}
function sendBirthday(){const shop=dashShop();const aniv=customerMarketingSegments(shop).birthdayMonth;toast(`${aniv.length} aniversariante(s) no mês. Use os botões de WhatsApp para enviar mensagens personalizadas.`,'ok');DB.log('Campanha de aniversário preparada','',shop.id);}

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
  const paid=range.filter(a=>a.status==='concluido');
  const revenue=paid.reduce((s,a)=>s+a.price,0);
  let commissions=0;paid.forEach(a=>{const b=DB.find('barbers',a.barberId);if(b)commissions+=a.price*(b.commission/100);});
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
    <div class="panel"><div class="panel-head"><h3>Comissões por colaborador</h3></div>
      ${DB.scope('barbers',shop.id).map(b=>{const list=range.filter(a=>a.barberId===b.id&&a.status==='concluido');const rev=list.reduce((s,a)=>s+a.price,0);const comm=rev*(b.commission/100);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${initials(b.name)}</span><div><b>${escapeHtml(b.name.split(' ')[0])}</b><br><small>${list.length} atend. · ${b.commission}%</small></div><b style="margin-left:auto">${money(comm)}</b></div>`;}).join('')||'<p class="muted">Sem dados.</p>'}
    </div>
  </div>`;
}
function dashFinanceChart(shop){const a=shopAnalytics(shop.id);mkChart('finChart','bar',{labels:a.days,datasets:[{data:a.revSeries,backgroundColor:DASH_CHART_PRIMARY,borderRadius:8}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});}
function exportFinance(){const shop=dashShop();const rows=[['Data','Cliente','Servico','Colaborador','Valor','Status']];DB.scope('appointments',shop.id).forEach(a=>{const s=DB.find('services',a.serviceId),b=DB.find('barbers',a.barberId);rows.push([a.date,a.customerName,s?s.name:'',b?b.name:'',a.price,a.status]);});const csv=rows.map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='financeiro-'+shop.slug+'.csv';a.click();toast('Relatório exportado.','ok');}

/* ---------- AI Insights ---------- */
function businessSnapshot(shop){
  const a=shopAnalytics(shop.id),seg=customerMarketingSegments(shop);
  const appts=DB.scope('appointments',shop.id),customers=seg.all,barbers=DB.scope('barbers',shop.id).filter(b=>b.active),services=DB.scope('services',shop.id).filter(s=>s.active);
  const byBarber=barbers.map(b=>{const list=appts.filter(x=>x.barberId===b.id&&x.status!=='cancelado');return {name:b.name,appointments:list.length,revenue:list.reduce((s,x)=>s+(x.price||0),0),commission:b.commission||0};}).sort((x,y)=>y.appointments-x.appointments);
  const byService=services.map(s=>{const list=appts.filter(x=>x.serviceId===s.id&&x.status!=='cancelado');return {name:s.name,appointments:list.length,revenue:list.reduce((sum,x)=>sum+(x.price||0),0),price:s.price||0,duration:s.duration||0};}).sort((x,y)=>y.appointments-x.appointments);
  return {
    shop:{name:shop.name,planId:shop.planId,open:shop.open,close:shop.close,professionals:barbers.length,services:services.length},
    metrics:{appointmentsTotal:appts.length,customersTotal:customers.length,revenueToday:a.revToday,revenueMonth:a.revMonth,occupancy:a.occupancy,returningCustomers:a.returning,newCustomers:a.newCustomers},
    customerSegments:{inactive30:seg.inactive30.length,inactive60:seg.inactive60.length,inactive90:seg.inactive90.length,birthdayToday:seg.birthdayToday.length,birthdayWeek:seg.birthdayWeek.length,birthdayMonth:seg.birthdayMonth.length,vip:seg.vip.length},
    topServices:byService.slice(0,6),
    team:byBarber.slice(0,6),
    recentRevenueSeries:a.revSeries,
    risks:{lowStock:DB.scope('products',shop.id).filter(p=>p.qty<=p.minStock).map(p=>({name:p.name,qty:p.qty,minStock:p.minStock})).slice(0,8)},
  };
}
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
  const groqBtn=window.fbGenerateBusinessInsights?`<button class="btn btn-primary" onclick="generateGroqInsights()">${icon('sparkle')} Análise Groq</button>`:'';
  return `<div class="page-head"><div><h2>Insights de IA</h2><p>Recomendações acionáveis geradas a partir dos seus dados</p></div><div class="page-actions">${groqBtn}<span class="badge gold">${icon('cpu')} ${insights.length} recomendações</span></div></div>
  ${insights.map(i=>`<div class="insight ${i[0]}"><span class="ii">${icon(i[1])}</span><div><b>${escapeHtml(i[2])}</b><p>${escapeHtml(i[3])}</p></div></div>`).join('')}
  <div class="panel" style="margin-top:8px"><div class="panel-head"><h3>Como funciona</h3></div><p class="muted" style="font-size:14px">Os insights são recalculados automaticamente com base em ocupação, demanda por profissional, recência dos clientes, estoque e tendência de receita. Use-os como ponto de partida para decisões de promoção, equipe e compras.</p></div>`;
}
async function generateGroqInsights(){
  const shop=dashShop();
  if(!window.fbGenerateBusinessInsights){toast('Groq ainda não está configurado no backend.','info');return;}
  const btn=document.querySelector('.page-actions .btn-primary');const old=btn?btn.innerHTML:null;
  try{
    if(btn){btn.disabled=true;btn.innerHTML='Analisando…';}
    const data=await fbGenerateBusinessInsights(shop.id,businessSnapshot(shop));
    const insights=Array.isArray(data.insights)?data.insights:[];
    openModal(`<div class="modal-head"><div><h3>${icon('sparkle')} Plano de ação Groq</h3><div class="sub">Score comercial: ${data.score!=null?data.score:'—'}/100</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="insight pos" style="margin-bottom:14px"><span class="ii">${icon('target')}</span><div><b>Resumo executivo</b><p>${escapeHtml(data.summary||'Análise gerada com base nos dados atuais da barbearia.')}</p></div></div>
      ${insights.map(i=>`<div class="insight ${i.priority==='alta'?'warn':'pos'}"><span class="ii">${icon(i.area==='equipe'?'users':i.area==='marketing'?'megaphone':i.area==='financeiro'?'dollar':'trending')}</span><div><b>${escapeHtml(i.title||'Ação recomendada')}</b><p>${escapeHtml(i.reason||'')}</p><p><b>Ação:</b> ${escapeHtml(i.action||'')}</p>${i.whatsapp?`<p><b>Mensagem:</b> ${escapeHtml(i.whatsapp)}</p>`:''}${i.kpi?`<small class="muted">KPI: ${escapeHtml(i.kpi)}</small>`:''}</div></div>`).join('')||'<p class="muted">Sem recomendações retornadas.</p>'}
      ${(data.next7Days||[]).length?`<div class="panel" style="margin-top:12px"><div class="panel-head"><h3>Próximos 7 dias</h3></div>${data.next7Days.map(x=>`<div class="summary-line"><span>${escapeHtml(x)}</span></div>`).join('')}</div>`:''}
    </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fechar</button></div>`);
  }catch(e){toast((e&&e.message)||'Não foi possível gerar análise Groq.','err');}
  finally{if(btn&&old){btn.disabled=false;btn.innerHTML=old;}}
}

/* ---------- Config ---------- */
function configDayHours(shop){
  const src=shop&&shop.dayHours||{};
  const fallback=Array.isArray(shop&&shop.workDays)?shop.workDays:[1,2,3,4,5,6];
  const out={};
  DOW.forEach((_,i)=>{
    const cfg=src[String(i)]||src[i]||{};
    out[i]={active:typeof cfg.active!=='undefined'?!!cfg.active:fallback.includes(i),start:cfg.start||shop.open||'09:00',end:cfg.end||shop.close||'19:00'};
  });
  return out;
}
function configDayHourRows(shop){
  const hours=configDayHours(shop);
  return DOW.map((d,i)=>{
    const h=hours[i];
    return `<div class="schedule-day-row" data-day="${i}">
      <div class="checkbox-row"><div class="switch ${h.active?'on':''}" id="cf_day_active_${i}" onclick="this.classList.toggle('on')"></div><label style="margin:0">${d}</label></div>
      <div class="field"><label>Início</label><input class="input" type="time" id="cf_day_start_${i}" value="${h.start}"></div>
      <div class="field"><label>Fim</label><input class="input" type="time" id="cf_day_end_${i}" value="${h.end}"></div>
    </div>`;
  }).join('');
}
function dashConfig(shop){
  const e=shopEntitlements(shop.id);
  const u=Session.effectiveUser||{};
  const activeBarbers=DB.scope('barbers',shop.id).filter(b=>b.active).length;
  const featBadge=(on,label)=>`<span class="badge ${on?'ok':'muted'}">${on?icon('check'):icon('x')} ${label}</span>`;
  return `<div class="page-head"><div><h2>Configurações</h2><p>Dados do negócio e da página pública</p></div></div>
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
  <div class="panel"><div class="panel-head"><h3>Dados cadastrais</h3></div>
    <div class="form-row"><div class="field"><label>Seu nome</label><input class="input" id="cf_owner_name" value="${escapeHtml(u.name||shop.ownerName||'')}"></div><div class="field"><label>E-mail de login</label><div style="display:flex;gap:8px"><input class="input" id="cf_owner_email" value="${escapeHtml(u.email||shop.email||'')}" readonly><button class="btn btn-ghost btn-sm" type="button" onclick="openOwnerEmailModal()">${icon('mail')} Trocar</button></div></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="cf_owner_phone" value="${escapeHtml(u.phone||shop.phone||'')}"></div><div class="field"><label>WhatsApp</label><input class="input" id="cf_owner_wa" value="${escapeHtml(u.whatsapp||shop.whatsapp||'')}"></div></div>
    <div class="field"><label>Endereço cadastral</label><input class="input" id="cf_owner_addr" value="${escapeHtml(u.address||shop.address||'')}"></div>
    <div class="field"><label>Senha</label><button class="btn btn-ghost" type="button" onclick="openOwnerPasswordModal()">${icon('lock')} Trocar senha</button><small class="muted">A senha é alterada no Firebase Auth e não fica salva no banco.</small></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Informações</h3><a class="btn btn-ghost btn-sm" onclick="Router.go('#/'+'${shop.slug}')">${icon('eye')} Ver página pública</a></div>
    <div class="form-row"><div class="field"><label>Nome</label><input class="input" id="cf_name" value="${escapeHtml(shop.name)}"></div><div class="field"><label>Link público</label><div class="input" style="background:var(--surface-3);color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(shopPublicUrl(shop.slug).replace(/^https?:\/\//,''))}</div><small class="muted">O link é permanente e não pode ser alterado após o cadastro.</small></div></div>
    <div class="form-row"><div class="field"><label>Segmento</label><select class="input" id="cf_category">${BUSINESS_CATEGORIES.map(c=>`<option value="${c[0]}" ${shop.category===c[0]?'selected':''}>${c[1]}</option>`).join('')}</select></div><div class="field"><label>Tema visual</label><div class="theme-apply-row"><select class="input" id="cf_theme" onchange="previewConfigTheme(this.value)">${BUSINESS_THEMES.map(t=>`<option value="${t[1]}" ${(shop.themeId||'Ocean Blue')===t[1]?'selected':''}>${t[1]}</option>`).join('')}</select><button class="btn btn-primary btn-sm" type="button" onclick="applyConfigTheme()">${icon('check')} Aplicar tema</button></div><small class="muted" id="cf_theme_status">Tema atual: ${escapeHtml(shop.themeId||'Ocean Blue')}</small></div></div>
    <div class="field"><label>Logo do negócio</label>
      <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
        <div id="cf_logo_preview" style="width:72px;height:72px;border-radius:16px;overflow:hidden;background:var(--primary-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${shop.logoUrl?`<img src="${escapeHtml(shop.logoUrl)}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:1.4rem;font-weight:800;color:var(--primary)">${initials(shop.name)}</span>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px"><label class="btn btn-ghost btn-sm" for="cf_logo_file" style="cursor:pointer;margin:0">${icon('upload')} ${shop.logoUrl?'Substituir logo':'Adicionar logo'}</label>
        ${shop.logoUrl?`<button type="button" class="btn btn-ghost btn-sm remove-logo-btn" onclick="clearShopLogo()" style="color:var(--danger);margin:0">${icon('trash')} Remover logo</button>`:''}
        <small class="muted" style="display:block;margin-top:4px">PNG, JPG ou WEBP · máx. 5MB</small></div>
      </div>
      <input type="file" id="cf_logo_file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewLogo(this)">
      <input type="hidden" id="cf_logo_remove" value="0">
    </div>
    <div class="field"><label>Foto de capa</label>
      <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
        <div id="cf_cover_preview" style="width:120px;height:68px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,#EEF2FF,#FFFFFF);flex-shrink:0;display:flex;align-items:center;justify-content:center">
          ${shop.coverUrl?`<img src="${escapeHtml(shop.coverUrl)}" style="width:100%;height:100%;object-fit:cover">`:`<span class="muted" style="font-size:11px">Sem capa</span>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px"><label class="btn btn-ghost btn-sm" for="cf_cover_file" style="cursor:pointer;margin:0">${icon('upload')} ${shop.coverUrl?'Substituir capa':'Adicionar capa'}</label>
        ${shop.coverUrl?`<button type="button" class="btn btn-ghost btn-sm remove-cover-btn" onclick="clearShopCover()" style="color:var(--danger);margin:0">${icon('trash')} Remover capa</button>`:''}
        <small class="muted" style="display:block;margin-top:4px">Aparece no topo da página pública · máx. 5MB</small></div>
      </div>
      <input type="file" id="cf_cover_file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewCover(this)">
      <input type="hidden" id="cf_cover_remove" value="0">
    </div>
    <div class="field"><label>Descrição</label><textarea class="input" id="cf_desc">${escapeHtml(shop.description||'')}</textarea></div>
    <div class="field"><label>Endereço</label><input class="input" id="cf_addr" value="${escapeHtml(shop.address||'')}"></div>
    <div class="form-row three"><div class="field"><label>Cidade</label><input class="input" id="cf_city" value="${escapeHtml(shop.city||'')}"></div><div class="field"><label>Bairro</label><input class="input" id="cf_neigh" value="${escapeHtml(shop.neighborhood||'')}"></div><div class="field"><label>Instagram</label><input class="input" id="cf_ig" value="${escapeHtml(instagramDisplay(shop.instagram)||shop.instagram||'')}" placeholder="@seunegocio ou link do perfil"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="cf_phone" value="${escapeHtml(shop.phone||'')}"></div><div class="field"><label>WhatsApp</label><input class="input" id="cf_wa" value="${escapeHtml(shop.whatsapp||'')}"></div></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Funcionamento</h3></div>
    <div class="insight ${shop.schedulePaused?'warn':'pos'}" style="margin-bottom:14px"><span class="ii">${icon(shop.schedulePaused?'clock':'calendar')}</span><div><b>${shop.schedulePaused?'Agenda online pausada':'Agenda online ativa'}</b><p>${shop.schedulePaused?'Clientes não conseguem criar novos agendamentos pelo link público.':'Clientes conseguem agendar pelo link público nos horários liberados.'}</p></div><button class="btn ${shop.schedulePaused?'btn-primary':'btn-ghost'} btn-sm" onclick="toggleSchedulePause()">${icon(shop.schedulePaused?'play':'pause')} ${shop.schedulePaused?'Retomar agora':'Pausar agora'}</button></div>
    <div class="form-row"><div class="field"><label>Abertura</label><input class="input" type="time" id="cf_open" value="${shop.open}"></div><div class="field"><label>Fechamento</label><input class="input" type="time" id="cf_close" value="${shop.close}"></div></div>
    <div class="form-row three"><div class="field"><label>Almoço início</label><input class="input" type="time" id="cf_ls" value="${shop.lunchStart}"></div><div class="field"><label>Almoço fim</label><input class="input" type="time" id="cf_le" value="${shop.lunchEnd}"></div><div class="field"><label>Intervalo de horários</label><select class="input" id="cf_int">${[15,20,30,45,60].map(i=>`<option value="${i}" ${shop.slotInterval===i?'selected':''}>${i} min</option>`).join('')}</select></div></div>
    ${shop.category==='food'?`<div class="field"><label>Antecedência mínima das encomendas</label><select class="input" id="cf_lead_days">${ORDER_LEAD_OPTIONS.map(o=>`<option value="${o[0]}" ${shopLeadDays(shop)===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select><small class="muted">O cliente só consegue escolher datas de entrega a partir dessa antecedência. Ex.: 1 dia — pedido na terça, entrega a partir da quarta.</small></div>`:''}
    <div class="field"><label>Horários por dia</label><div class="schedule-day-grid">${configDayHourRows(shop)}</div><small class="muted">Use para meio período, sábado reduzido, domingo fechado ou mudanças de rotina.</small></div>
  </div>
  <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="saveConfig()">${icon('check')} Salvar configurações</button></div>`;
}
function storageUploadMsg(e,item){
  const c=(e&&e.code)||'';
  if(c==='image-too-large')return 'Imagem maior que 5MB.';
  if(c==='invalid-image')return 'O arquivo selecionado não parece ser uma imagem.';
  if(c==='storage-not-configured')return 'Firebase Storage ainda não está configurado.';
  if(/unauthorized|permission-denied/.test(c))return `Sem permissão para enviar ${item}. Recarregue a página e tente novamente.`;
  return `Não foi possível enviar ${item}${c?' ('+c+')':''}.`;
}
function saveTenantMsg(e){
  const c=(e&&e.code)||'';
  if(/unauthorized|permission-denied/.test(c))return 'Sem permissão para salvar as configurações deste negócio. Recarregue a página e entre novamente.';
  return `Não foi possível salvar as configurações${c?' ('+c+')':''}.`;
}
async function applyConfigTheme(){
  const shop=dashShop();
  const themeId=$('#cf_theme')?$('#cf_theme').value:(shop.themeId||'Ocean Blue');
  const status=$('#cf_theme_status');
  const patch={themeId};
  applyBusinessTheme({themeId});
  if(status)status.textContent='Salvando tema...';
  try{
    if(window.__FB_ENABLED&&window.fbSaveTenantProfile)await fbSaveTenantProfile(shop.id,patch);
    DB.update('barbershops',shop.id,patch);
    DB.log('Tema visual alterado',themeId,shop.id);
    if(status)status.textContent=`Tema aplicado: ${themeId}`;
    toast('Tema aplicado.','ok');
    refreshShell();
  }catch(e){
    console.warn('[Groomin] aplicar tema:',e.code,e.message);
    applyBusinessTheme(shop);
    if(status)status.textContent='Não foi possível salvar o tema.';
    toast(saveTenantMsg(e),'err');
  }
}
function openOwnerEmailModal(){
  const u=Session.effectiveUser||Session.user||{};
  const current=u.email||'';
  openModal(`<div class="modal-head"><div><h3>${icon('mail')} Trocar e-mail de login</h3><div class="sub">${escapeHtml(current)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="field"><label>Novo e-mail</label><input class="input" id="owner_new_email" type="email" value="${escapeHtml(current)}"></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveOwnerEmail()">${icon('check')} Salvar e-mail</button></div>`);
}
async function saveOwnerEmail(){
  const email=($('#owner_new_email')&&$('#owner_new_email').value||'').trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Informe um e-mail válido.','err');return;}
  const shop=dashShop();const u=Session.effectiveUser||Session.user||{};
  try{
    if(window.__FB_ENABLED&&window.fbUpdateOwnProfile)await fbUpdateOwnProfile({email});
    if(u&&(u.id||u.uid))DB.update('users',u.id||u.uid,{email});
    DB.update('barbershops',shop.id,{email});
    const key=Session.impersonating?'groomin_imp':'groomin_user';
    try{sessionStorage.setItem(key,JSON.stringify({...u,email}));}catch(_){}
    closeModal();toast('E-mail de login atualizado.','ok');renderDashboard({sub:'config'});
  }catch(e){
    console.warn('[Groomin] trocar e-mail:',e&&e.code||'',e&&e.message||e);
    toast((e&&e.message)||'Não foi possível trocar o e-mail.','err');
  }
}
function openOwnerPasswordModal(){
  openModal(`<div class="modal-head"><div><h3>${icon('lock')} Trocar senha</h3><div class="sub">Use pelo menos 6 caracteres.</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="form-row"><div class="field"><label>Nova senha</label><input class="input" id="owner_new_pass" type="password" autocomplete="new-password"></div><div class="field"><label>Confirmar senha</label><input class="input" id="owner_new_pass2" type="password" autocomplete="new-password"></div></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveOwnerPassword()">${icon('check')} Salvar senha</button></div>`);
}
async function saveOwnerPassword(){
  const password=($('#owner_new_pass')&&$('#owner_new_pass').value)||'';
  const confirm=($('#owner_new_pass2')&&$('#owner_new_pass2').value)||'';
  if(password.length<6){toast('A senha precisa ter pelo menos 6 caracteres.','err');return;}
  if(password!==confirm){toast('As senhas não conferem.','err');return;}
  try{
    if(window.__FB_ENABLED&&window.fbUpdateOwnProfile)await fbUpdateOwnProfile({password});
    closeModal();toast('Senha atualizada.','ok');
  }catch(e){
    console.warn('[Groomin] trocar senha:',e&&e.code||'',e&&e.message||e);
    toast((e&&e.message)||'Não foi possível trocar a senha.','err');
  }
}
async function saveConfig(){const shop=dashShop();const dayHours={};DOW.forEach((_,i)=>{dayHours[i]={active:!!($('#cf_day_active_'+i)&&$('#cf_day_active_'+i).classList.contains('on')),start:$('#cf_day_start_'+i).value,end:$('#cf_day_end_'+i).value};});const workDays=Object.entries(dayHours).filter(([,v])=>v.active).map(([k])=>+k);const account={name:$('#cf_owner_name').value.trim(),email:$('#cf_owner_email').value.trim(),phone:$('#cf_owner_phone').value.trim(),whatsapp:$('#cf_owner_wa').value.trim(),address:$('#cf_owner_addr').value.trim(),password:''};const data={name:$('#cf_name').value.trim(),category:$('#cf_category').value,themeId:$('#cf_theme').value,description:$('#cf_desc').value.trim(),address:$('#cf_addr').value.trim(),city:$('#cf_city').value.trim(),neighborhood:$('#cf_neigh').value.trim(),instagram:normalizeInstagram($('#cf_ig').value),phone:$('#cf_phone').value.trim(),whatsapp:$('#cf_wa').value.trim(),open:$('#cf_open').value,close:$('#cf_close').value,lunchStart:$('#cf_ls').value,lunchEnd:$('#cf_le').value,slotInterval:+$('#cf_int').value,workDays,dayHours};
  if($('#cf_lead_days'))data.orderLeadDays=Math.max(0,Math.min(30,+$('#cf_lead_days').value||0));
  if(account.name.length<2){toast('Informe seu nome cadastral.','err');return;}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.email)){toast('Informe um e-mail cadastral válido.','err');return;}
  if(account.password&&account.password.length<6){toast('A senha precisa ter pelo menos 6 caracteres.','err');return;}
  for(const [day,h] of Object.entries(dayHours)){if(h.active&&timeToMin(h.start)>=timeToMin(h.end)){toast(`${DOW[+day]}: o fim precisa ser depois do início.`,`err`);return;}}
  if(window.__FB_ENABLED&&window.fbUpdateOwnProfile){try{await fbUpdateOwnProfile(account);}catch(e){console.warn('[Groomin] salvar conta:',e.code,e.message);toast((e&&e.message)||'Não foi possível salvar seus dados cadastrais.','err');return;}}
  const su=Session.effectiveUser||Session.user;if(su&&(su.id||su.uid)){DB.update('users',su.id||su.uid,{name:account.name,email:account.email,phone:account.phone,whatsapp:account.whatsapp,address:account.address});const key=Session.impersonating?'groomin_imp':'groomin_user';try{sessionStorage.setItem(key,JSON.stringify({...su,name:account.name,email:account.email,phone:account.phone,whatsapp:account.whatsapp,address:account.address}));}catch(_){}} 
  data.ownerName=account.name;
  data.email=account.email;
  if($('#cf_logo_remove')&&$('#cf_logo_remove').value==='1'){if(shop.logoPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(shop.logoPath).catch(()=>{});data.logoUrl='';data.logoPath='';}
  if($('#cf_cover_remove')&&$('#cf_cover_remove').value==='1'){if(shop.coverPath&&window.fbDeleteStoragePath)fbDeleteStoragePath(shop.coverPath).catch(()=>{});data.coverUrl='';data.coverPath='';}
  // Salva dados de texto primeiro; uploads de imagem são independentes e não interrompem o save.
  if(window.__FB_ENABLED&&window.fbSaveTenantProfile){try{await fbSaveTenantProfile(shop.id,data);}catch(e){console.warn('[Groomin] salvar perfil tenant:',e.code,e.message);toast(saveTenantMsg(e),'err');return;}}
  const file=$('#cf_logo_file')&&$('#cf_logo_file').files[0];
  const coverFile=$('#cf_cover_file')&&$('#cf_cover_file').files[0];
  DB.update('barbershops',shop.id,data);applyBusinessTheme({...shop,...data});DB.log('Configurações atualizadas',shop.name,shop.id);toast('Configurações salvas.','ok');
  if(file&&window.fbUploadTenantImage){try{toast('Enviando logo...','info');const up=await fbUploadTenantImage(shop.id,'logos',file,shop.logoPath);const lp={logoUrl:up.url,logoPath:up.path};if(window.fbSaveTenantProfile)await fbSaveTenantProfile(shop.id,lp);DB.update('barbershops',shop.id,lp);}catch(e){console.warn('[Groomin] upload logo:',e.code,e.message);toast(storageUploadMsg(e,'o logo'),'err');}}
  if(coverFile&&window.fbUploadTenantImage){try{toast('Enviando capa...','info');const upc=await fbUploadTenantImage(shop.id,'covers',coverFile,shop.coverPath);const cp={coverUrl:upc.url,coverPath:upc.path};if(window.fbSaveTenantProfile)await fbSaveTenantProfile(shop.id,cp);DB.update('barbershops',shop.id,cp);}catch(e){console.warn('[Groomin] upload capa:',e.code,e.message);toast(storageUploadMsg(e,'a capa'),'err');}}
  refreshShell();
}

/* ---------- Assinatura ---------- */
function dashSubscription(shop){
  const _s=DB.get().settings||{};
  if(window.__FB_ENABLED&&window.fbLoadPlatformSettings&&!_s._fbPlansLoaded){
    fbLoadPlatformSettings().then(()=>{DB.get().settings._fbPlansLoaded=true;renderDashboard({sub:'assinatura'});}).catch(()=>{});
  }
  const sub=shopSubscription(shop.id)||{};
  const normalizedPlanId=['growth','pro','elite','enterprise'].includes(shop.planId)?'monthly':shop.planId;
  const plan=DB.find('plans',normalizedPlanId)||DB.find('plans','free');
  const e=shopEntitlements(shop.id);
  const isTrialing=sub.status==='trialing';
  const t=DB.todayISO();
  const renewsAt=tsToISO(sub.renewsAt)||t;
  const daysLeft=Math.max(0,Math.ceil((new Date(renewsAt+'T00:00:00')-new Date())/86400000));
  const freeLimit=normalizedPlanId==='free'?Number(shop.freeBookingLimit||sub.freeBookingLimit||3):null;
  const freeUsed=normalizedPlanId==='free'?DB.scope('appointments',shop.id).filter(a=>a.status!=='cancelado').length:0;
  const freeRemaining=freeLimit!=null?Math.max(0,freeLimit-freeUsed):0;
  const cancelAtPeriodEnd=sub.cancelAtPeriodEnd===true;
  const statusMap={active:['ok','Ativo'],trialing:['info','Trial'],past_due:['danger','Em atraso'],canceled:['muted','Cancelado']};
  const[stCls,stLabel]=statusMap[sub.status]||['muted','—'];
  const plans=paidPlansForSale();
  const cycleLabel=normalizedPlanId==='annual'?'Anual':normalizedPlanId==='founder'?'Pagamento único':'Mensal';
  const valueLabel=normalizedPlanId==='founder'?'R$ 990 pagamento único':normalizedPlanId==='annual'?'R$ 151,98/ano':(sub.mrr||e.monthly)>0?money(sub.mrr||e.monthly)+'/mês':'Grátis';
  return `<div class="page-head"><div><h2>Assinatura</h2><p>Gerencie seu plano e cobrança na Groomin</p></div></div>

  <div class="panel" style="border-color:var(--primary);background:linear-gradient(135deg,rgba(124,58,237,.07),transparent),var(--surface)">
    <div class="panel-head">
      <div><h3>${e.isEnterprise?icon('building')+' ':''}Plano atual: <b>${escapeHtml(e.planName)}</b></h3><span class="badge ${stCls}">${stLabel}</span></div>
      ${!e.isEnterprise?`<button class="btn btn-primary btn-sm" onclick="openPlanSelectorOwner('${shop.id}')">${icon('rocket')} Mudar plano</button>`:''}
    </div>
    ${normalizedPlanId==='free'?`<div class="insight warn" style="margin:12px 0"><span class="ii">${icon('calendar')}</span><div><b>Teste grátis: ${freeUsed}/${freeLimit} agendamento(s) usados</b><p>${freeRemaining>0?`Você ainda pode receber ${freeRemaining} agendamento(s) antes de assinar.`:'Seu teste gratuito foi concluído. Assine um plano para continuar recebendo agendamentos.'}</p></div><button class="btn btn-primary btn-sm" style="margin-left:auto;flex-shrink:0" onclick="openPlanSelectorOwner('${shop.id}')">Ver planos</button></div>`:isTrialing?`<div class="insight warn" style="margin:12px 0"><span class="ii">${icon('clock')}</span><div><b>${daysLeft} dia(s) restante(s) no período de teste</b><p>Seu teste termina em ${fmtDate(renewsAt)}. Após esse período, a cobrança do plano selecionado será iniciada pelo Stripe.</p></div><button class="btn btn-primary btn-sm" style="margin-left:auto;flex-shrink:0" onclick="openPlanSelectorOwner('${shop.id}')">Ver planos</button></div>`:''}
    ${normalizedPlanId==='founder'?`<div class="insight ok" style="margin:12px 0"><span class="ii">${icon('check')}</span><div><b>Cliente Fundador</b><p>Sem mensalidade enquanto o Groomin permanecer em operação. Novos módulos premium poderão ser comercializados separadamente.</p></div></div>`:''}
    <div class="form-row three" style="margin-top:14px">
      <div class="summary-line"><span class="muted">Plano</span><b>${escapeHtml(plan.name)}</b></div>
      <div class="summary-line"><span class="muted">Status</span><b>${stLabel}</b></div>
      <div class="summary-line"><span class="muted">${normalizedPlanId==='free'?'Agendamentos grátis':isTrialing?'Fim do trial':'Renovação'}</span><b>${normalizedPlanId==='free'?`${freeUsed}/${freeLimit}`:fmtDate(renewsAt)}</b></div>
    </div>
    <div class="form-row three">
      <div class="summary-line"><span class="muted">Profissionais</span><b>${DB.scope('barbers',shop.id).filter(b=>b.active).length} / ${e.limitBarbers>=999?'∞':e.limitBarbers}</b></div>
      <div class="summary-line"><span class="muted">Valor</span><b>${valueLabel}</b></div>
      <div class="summary-line"><span class="muted">Ciclo</span><b>${cycleLabel}</b></div>
    </div>
    <div class="chips" style="margin-top:12px">${ENT_FEATURES.map(f=>`<span class="badge ${e[f[0]]?'ok':'muted'}">${e[f[0]]?icon('check'):icon('x')} ${f[1]}</span>`).join('')}</div>
    ${e.isEnterprise?'<p class="muted" style="font-size:12.5px;margin-top:12px">Plano sob medida Groomin. Para ajustes, fale com nosso comercial.</p>':''}
    ${cancelAtPeriodEnd?`<div class="insight warn" style="margin-top:12px"><span class="ii">${icon('clock')}</span><div><b>Alteração de plano agendada</b><p>Seu plano atual permanece ativo até ${fmtDate(renewsAt)}. Após isso, será rebaixado automaticamente.</p></div></div>`:''}
  </div>

  <div class="panel-head" style="margin-top:24px"><h3>Planos disponíveis</h3><p class="muted">Todos incluem as funcionalidades atuais do Groomin.</p></div>
  <div class="pricing-grid" style="margin-bottom:16px">
    ${plans.map(p=>{
      const isCurrent=normalizedPlanId===p.id;
      const isFeatured=p.id==='annual'||p.id==='founder';
      const displayPrice=p.id==='annual'?'R$ 151,98<small>/ano</small>':p.id==='founder'?'R$ 990<small> pagamento único</small>':'R$ 14,90<small>/mês</small>';
      return `<div class="price-card ${isCurrent?'featured':isFeatured&&!isCurrent?'featured-lite':''}">
        ${isCurrent?`<span class="pc-tag">${icon('check')} Seu plano</span>`:p.badge?`<span class="pc-tag">${escapeHtml(p.badge)}</span>`:''}
        <h3>${escapeHtml(p.name)}</h3>
        <div class="pc-price">${displayPrice}</div>
        <div class="pc-desc">${escapeHtml(p.tagline||'')}</div>
        <ul>${p.features.slice(0,4).map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}</ul>
        ${isCurrent
          ?`<button class="btn btn-outline btn-block" disabled>Plano atual</button>`
          :p.price>(plan.price||0)
            ?`<button class="btn btn-primary btn-block" onclick="openOwnerStripeCheckout('${shop.id}','${p.id}',this)">${icon('rocket')} Escolher plano</button>`
            :`<button class="btn btn-ghost btn-block" onclick="requestPlanDowngrade('${shop.id}','${p.id}')">Solicitar alteração</button>`}
      </div>`;}).join('')}
  </div>

  <div class="panel">
    <div class="panel-head"><h3>Ações da conta</h3></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${e.isEnterprise
        ?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener">${icon('whatsapp')} Falar com suporte</a>`
        :`<button class="btn btn-primary" onclick="openPlanSelectorOwner('${shop.id}')">${icon('rocket')} Mudar plano</button>`}
      ${sub.status!=='canceled'&&normalizedPlanId!=='free'?`<button class="btn btn-ghost" style="color:var(--danger)" onclick="cancelSubscriptionOwner('${shop.id}')">${icon('x')} Cancelar assinatura</button>`:''}
    </div>
  </div>`;
}
async function cancelSubscriptionOwner(shopId){
  confirmAction('Cancelar assinatura?','Seu acesso será encerrado imediatamente e o plano voltará para o teste gratuito.',async()=>{
    if(!window.__FB_ENABLED||!window.fbCancelSubscription){toast('Função indisponível. Tente recarregar a página.','err');return;}
    try{
      const btn=document.querySelector('[onclick*="cancelSubscriptionOwner"]');
      if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+' Cancelando...';}
      await fbCancelSubscription({tenantId:shopId});
      toast('Assinatura cancelada. Seu plano foi alterado para gratuito.','ok');
      Router.go('#/dashboard/assinatura');
    }catch(e){
      console.warn('[Groomin] cancelSubscription:',e.code||'',e.message||e);
      toast('Não foi possível cancelar. Tente novamente ou escreva para contato.groominbarber@gmail.com','err');
    }
  });
}
function openPlanSelectorOwner(shopId){
  const shop=DB.find('barbershops',shopId);
  const currentPlanId=['growth','pro','elite','enterprise'].includes(shop.planId)?'monthly':shop.planId;
  const currentPlan=DB.find('plans',currentPlanId)||{price:0};
  openModal(`<div class="modal-head"><div><h3>${icon('creditCard')} Mudar plano</h3><div class="sub">${escapeHtml(shop.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="grid" style="gap:10px">${paidPlansForSale().slice().sort((a,b)=>(a.id==='annual'?-1:b.id==='annual'?1:0)).map(p=>{
    const isCurrent=currentPlanId===p.id;
    const isUpgrade=p.price>(currentPlan.price||0);
    const action=isCurrent?''
      :isUpgrade?`onclick="openOwnerStripeCheckout('${shopId}','${p.id}',this)"`
      :`onclick="requestPlanDowngrade('${shopId}','${p.id}')"`;
    const highlight=p.id==='annual'&&!isCurrent?';border-color:var(--primary);background:linear-gradient(135deg,rgba(124,58,237,.07),transparent)':'';
    return `<div class="select-item ${isCurrent?'sel':''}" ${isCurrent?'':action} style="${isCurrent?'cursor:default':''}${highlight}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div class="t">${escapeHtml(p.name)}${isCurrent?' <span class="badge ok" style="font-size:10px">atual</span>':p.badge?` <span class="badge gold" style="font-size:10px">${escapeHtml(p.badge)}</span>`:''}</div><div class="d">${escapeHtml(p.tagline||p.features[0])}</div></div>
        <div class="p">${p.id==='annual'?'R$ 151,98/ano':p.id==='founder'?'R$ 990 pagamento único':money(p.price)+'/mês'}</div>
      </div></div>`;}).join('')}</div>
  <p class="muted" style="font-size:12.5px;margin-top:12px">Alterações de plano e cancelamento: <a href="mailto:contato.groominbarber@gmail.com" style="color:inherit">contato.groominbarber@gmail.com</a></p></div>`);
}
async function openOwnerStripeCheckout(shopId,planId,btn){
  const shop=DB.find('barbershops',shopId),plan=DB.find('plans',planId);
  if(!shop||!plan)return;
  const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Abrindo Stripe...';}
  try{
    if(!window.__FB_ENABLED||!window.fbCreateStripeCheckout)throw new Error('stripe-unavailable');
    const u=Session&&Session.effectiveUser||{};
    const checkout=await fbCreateStripeCheckout({
      planId,
      tenantId: shop.id,
      email:u.email||shop.email||'',
      ownerName:u.name||shop.ownerName||'',
      shopName:shop.name||'',
      successUrl:location.origin+'/app/#/stripe/success',
      cancelUrl:location.origin+'/app/#/stripe/cancel'
    });
    if(!checkout||!checkout.url)throw new Error('stripe-url-missing');
    closeModal();
    toast('Redirecionando para o Stripe...','ok');
    location.href=checkout.url;
  }catch(e){
    console.warn('[Groomin] owner checkout:',e.code||'',e.message||e);
    toast('Não foi possível abrir o Stripe. Verifique sua sessão e tente novamente.','err');
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML=old;}
  }
}
function applyPlanUpgrade(shopId,planId){
  openOwnerStripeCheckout(shopId,planId,null);
}
function requestPlanDowngrade(shopId,planId){
  const shop=DB.find('barbershops',shopId),plan=DB.find('plans',planId);
  if(!shop||!plan)return;
  closeModal();
  openModal(`<div class="modal-head"><div><h3>${icon('creditCard')} Alterar plano</h3></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="insight warn"><span class="ii">${icon('clock')}</span><div><b>Mudança agendada para o fim do período</b><p>Seu plano atual permanece ativo até a data de renovação. Após isso, será alterado para <b>${escapeHtml(plan.name)}</b>.</p></div></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button id="btn_downgrade" class="btn btn-primary" onclick="confirmPlanDowngrade('${shopId}','${planId}')">Confirmar alteração</button></div>`);
}
async function confirmPlanDowngrade(shopId,planId){
  if(!window.__FB_ENABLED||!window.fbChangePlan){toast('Função indisponível. Recarregue a página.','err');return;}
  const btn=document.getElementById('btn_downgrade');
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+' Processando...';}
  try{
    const result=await fbChangePlan({tenantId:shopId,newPlanId:planId});
    const dateStr=result.currentPeriodEnd?new Date(result.currentPeriodEnd).toLocaleDateString('pt-BR'):'';
    closeModal();
    toast(`Alteração agendada. Seu plano atual segue ativo até ${dateStr}.`,'ok');
    Router.go('#/dashboard/assinatura');
  }catch(e){
    console.warn('[Groomin] changePlan:',e.code||'',e.message||e);
    if(btn){btn.disabled=false;btn.innerHTML='Confirmar alteração';}
    toast(e.message||'Não foi possível alterar o plano. Tente novamente.','err');
  }
}

/* ============================================================
   BARBER AREA (/my-schedule)
   ============================================================ */
let barberTab='hoje';
function renderBarber(){
  destroyCharts();
  const u=Session.effectiveUser;const shop=DB.find('barbershops',u.barbershopId);const barber=DB.find('barbers',u.barberId);
  if(!shop){
    if(window.__FB_ENABLED&&u.barbershopId){$('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div class="skeleton" style="width:200px;height:16px;border-radius:6px"></div><p class="muted" style="font-size:13px">Carregando dados...</p></div>`;return;}
    toast('Conta sem barbearia vinculada.','err');location.hash='#/';return;
  }
  if(!barber){toast('Perfil de colaborador não encontrado.','err');location.hash='#/';return;}
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
  $('#root').innerHTML=mountShell({brandShop:shop,brandSub:defaultRoleFor(shop),nav,activeId:'',navBase:'#/my-schedule/',title:'Minha agenda',crumb:shop.name+' · '+barber.name,content,search:false});
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
function saveBarberBlock(){const u=Session.effectiveUser;const full=$('#bl_full').classList.contains('on');const start=$('#bl_start').value,end=$('#bl_end').value;if(!full&&timeToMin(start)>=timeToMin(end)){toast('O fim precisa ser depois do início.','err');return;}DB.insert('blocks',{barbershopId:u.barbershopId,barberId:u.barberId,date:$('#bl_date').value,start,end,reason:$('#bl_reason').value.trim(),fullDay:full});closeModal();toast('Horário bloqueado.','ok');renderBarber();}
