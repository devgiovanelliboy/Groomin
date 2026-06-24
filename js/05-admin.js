/* ============================================================
   SHARED APP SHELL (sidebar + appbar) used by admin/dashboard/barber
   ============================================================ */
let charts={};
function destroyCharts(){Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}});charts={};}
function openSidebar(){$('#sidebar')&&$('#sidebar').classList.add('open');$('#sideBackdrop')&&$('#sideBackdrop').classList.add('open');}
function closeSidebar(){$('#sidebar')&&$('#sidebar').classList.remove('open');$('#sideBackdrop')&&$('#sideBackdrop').classList.remove('open');}
function mountShell(cfg){
  const u=Session.effectiveUser;const realUser=Session.user;
  const imp=Session.impersonating;
  const banner=imp?`<div class="impersonate-bar">${icon('eye')} Você está acessando como <b>${escapeHtml(imp.name)}</b> (${ROLE_LABEL[imp.role]}) — modo suporte. <button onclick="exitImpersonation()">Voltar ao Super Admin</button></div>`:'';
  const navHTML=cfg.nav.map(n=>{
    if(n.section)return `<div class="side-section">${escapeHtml(n.section)}</div>`;
    const target=(cfg.navBase+n.id).replace(/\/$/,'');
    if(n.locked)return `<div class="side-link locked ${n.id===cfg.activeId?'active':''}" onclick="showUpgrade('${escapeHtml(n.lockLabel)}','${escapeHtml(n.lockPlan)}',${n.lockEnt?'true':'false'})" title="Disponível no plano ${escapeHtml(n.lockPlan)}">${icon(n.icon)}<span>${escapeHtml(n.label)}</span><span class="lock-badge">${icon('lock')}</span></div>`;
    return `<div class="side-link ${n.id===cfg.activeId?'active':''}" onclick="Router.go('${target}')">${icon(n.icon)}<span>${escapeHtml(n.label)}</span>${n.count!=null?`<span class="count">${n.count}</span>`:''}</div>`;
  }).join('');
  // bottom navigation (mobile): até 4 itens principais + "Mais" (abre a sidebar)
  const primary=cfg.nav.filter(n=>!n.section).slice(0,4);
  const bottomNav=`<nav class="bottom-nav">${primary.map(n=>{
    const target=(cfg.navBase+n.id).replace(/\/$/,'');
    const onclick=n.locked?`showUpgrade('${escapeHtml(n.lockLabel)}','${escapeHtml(n.lockPlan)}',${n.lockEnt?'true':'false'})`:`Router.go('${target}')`;
    return `<button class="bn-item ${n.id===cfg.activeId?'active':''}" onclick="${onclick}">${icon(n.icon)}${n.locked?`<span class="bn-lock">${icon('lock')}</span>`:''}<span>${escapeHtml(n.label.split(' ')[0])}</span></button>`;
  }).join('')}<button class="bn-item" onclick="openSidebar()">${icon('menu')}<span>Mais</span></button></nav>`;
  return `<div class="backdrop" id="sideBackdrop" onclick="closeSidebar()"></div>
  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand" onclick="Router.go('#/')"><span class="logo">${icon('scissors')}</span><span>Groomin<small>${escapeHtml(cfg.brandSub||'')}</small></span></div>
      ${cfg.tenantPill||''}
      <nav>${navHTML}</nav>
      <div class="side-foot">
        <div class="user-chip" style="margin-bottom:10px"><div class="av">${initials(u.name)}</div><div class="info"><b>${escapeHtml(u.name)}</b><span>${ROLE_LABEL[u.role]}</span></div></div>
        <button class="side-link" onclick="doLogout()">${icon('logout')} Sair</button>
      </div>
    </aside>
    <div class="main">
      ${banner}
      <header class="appbar">
        <button class="icon-btn hamburger" onclick="openSidebar()">${icon('menu')}</button>
        <div><h1>${escapeHtml(cfg.title)}</h1><div class="crumb">${escapeHtml(cfg.crumb||'')}</div></div>
        <div class="spacer"></div>
        ${cfg.search!==false?`<div class="search-box">${icon('search')}<input type="text" id="shellSearch" placeholder="Buscar..." oninput="shellSearch(this.value)"></div>`:''}
        ${cfg.notif!==false?`<button class="icon-btn" onclick="toggleNotif(event)">${icon('bell')}<span class="ndot" id="notifDot"></span></button>`:''}
        <button class="icon-btn" data-theme-ic onclick="toggleTheme()"></button>
      </header>
      <div class="notif-pop" id="notifPop"></div>
      <div class="content" id="shellContent">${cfg.content}</div>
    </div>
  </div>
  ${bottomNav}`;
}
function doLogout(){if(window.__FB_ENABLED&&window.fbSignOut){fbSignOut();}Session.logout();toast('Sessão encerrada.','info');location.hash='#/';}
function exitImpersonation(){Session.stopImpersonate();toast('Voltou ao Super Admin.','info');location.hash='#/admin';}
function shellSearch(q){q=(q||'').toLowerCase();$$('#shellContent tbody tr').forEach(tr=>{tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none';});}
function toggleNotif(e){e.stopPropagation();const p=$('#notifPop');if(!p)return;renderShellNotif();p.classList.toggle('open');}
function renderShellNotif(){
  const u=Session.effectiveUser;const shopId=u.barbershopId;
  let list=DB.all('notifications');
  if(shopId)list=list.filter(n=>n.barbershopId===shopId);
  list=list.slice(0,12);
  const dot=$('#notifDot');if(dot)dot.style.display=list.some(n=>!n.read)?'block':'none';
  const map={confirm:['check','success'],remind:['clock','info'],cancel:['x','danger'],reschedule:['repeat','warn']};
  const p=$('#notifPop');if(!p)return;
  p.innerHTML=`<div class="nh"><b>Notificações</b><button class="btn btn-sm" style="color:var(--primary)" onclick="markNotifRead()">Marcar lidas</button></div>
    ${list.length?list.map(n=>{const[ic,cl]=map[n.type]||['bell','info'];return `<div class="notif-item"><span class="ni" style="background:var(--${cl}-soft);color:var(--${cl})">${icon(ic)}</span><div><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.msg)}</p><small>${relTime(n.time)} atrás</small></div></div>`;}).join(''):'<div class="empty" style="padding:30px"><p>Sem notificações</p></div>'}`;
}
function markNotifRead(){const u=Session.effectiveUser;DB.all('notifications').forEach(n=>{if(!u.barbershopId||n.barbershopId===u.barbershopId)n.read=true;});DB.save();renderShellNotif();}
document.addEventListener('click',e=>{if(!e.target.closest('#notifPop')&&!e.target.closest('.icon-btn'))$('#notifPop')&&$('#notifPop').classList.remove('open');});
function refreshShell(){Router.render();}
window.__afterTheme=()=>{if($('#shellContent')||$('#root').querySelector('.dash-cols'))Router.render();};

/* chart helper */
function mkChart(id,type,data,opts){
  if(!window.Chart){setTimeout(()=>mkChart(id,type,data,opts),200);return;}
  const el=$('#'+id);if(!el)return;
  const grid=cssVar('--line'),tcol=cssVar('--muted'),prim=cssVar('--primary');
  Chart.defaults.font.family="'Plus Jakarta Sans',sans-serif";Chart.defaults.color=tcol;
  charts[id]=new Chart(el,{type,data,options:Object.assign({responsive:true,maintainAspectRatio:false},opts||{})});
}
function cssVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
const GOLD='#D4AF37',GOLD_L='#E6C868',BRONZE='#B08D57',GREEN='#22C55E',RED='#EF4444',AMBER='#E0B84A';

/* ============================================================
   SUPER ADMIN CONSOLE
   ============================================================ */
const ADMIN_NAV=[
  {section:'Plataforma'},
  {id:'',label:'Dashboard',icon:'grid'},
  {id:'barbershops',label:'Barbearias',icon:'building'},
  {id:'subscriptions',label:'Assinaturas',icon:'creditCard'},
  {id:'billing',label:'Faturamento',icon:'dollar'},
  {section:'Operação'},
  {id:'audit',label:'Logs de Auditoria',icon:'activity'},
  {id:'settings',label:'Configurações',icon:'settings'}
];
function renderAdmin(r){
  destroyCharts();
  const sub=r.sub||'';
  const titles={'':'Dashboard da Plataforma',barbershops:'Barbearias',subscriptions:'Assinaturas',billing:'Faturamento',audit:'Logs de Auditoria',settings:'Configurações da Plataforma'};
  const a=platformAnalytics();
  const nav=ADMIN_NAV.map(n=>n.id==='barbershops'?{...n,count:DB.all('barbershops').length}:n);
  const content=({'':adminDash,barbershops:adminShops,subscriptions:adminSubs,billing:adminBilling,audit:adminAudit,settings:adminSettings}[sub]||adminDash)(a);
  $('#root').innerHTML=mountShell({brandSub:'Super Admin',nav,activeId:sub,navBase:'#/admin/',title:titles[sub]||'Plataforma',crumb:'Visão da plataforma Groomin',content});
  if(sub==='')adminDashCharts(a);
  renderShellNotif();
}
function adminDash(a){
  return `<div class="stat-grid">
    ${statCard('c1','building','Barbearias',a.totalShops,a.activeShops+' ativas')}
    ${statCard('c2','dollar','MRR',moneyK(a.mrr),(a.growth>=0?'+':'')+a.growth+'% no mês',a.growth>=0?'up':'down')}
    ${statCard('c3','users','Clientes',a.totalCustomers,'na plataforma')}
    ${statCard('c4','creditCard','Assinaturas ativas',a.activeSubs,'de '+a.totalShops)}
  </div>
  <div class="stat-grid">
    ${statCard('c1','calendar','Agendamentos',a.totalAppts,'total histórico')}
    ${statCard('c2','trending','Crescimento',(a.growth>=0?'+':'')+a.growth+'%','receita recorrente',a.growth>=0?'up':'down')}
    ${statCard('c5','down','Churn',a.churn+'%','contas suspensas',a.churn>5?'down':'up')}
    ${statCard('c3','activity','Uso','98%','uptime da plataforma')}
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><div><h3>Evolução do MRR</h3><div class="sub">Receita recorrente mensal (R$)</div></div><span class="badge ok">${icon('trending')} ${(a.growth>=0?'+':'')+a.growth}%</span></div><div class="chart-wrap"><canvas id="admMrr"></canvas></div></div>
    <div class="panel"><div class="panel-head"><h3>Distribuição por plano</h3></div><div class="chart-wrap chart-sm"><canvas id="admPlans"></canvas></div></div>
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Barbearias recentes</h3><button class="btn btn-ghost btn-sm" onclick="Router.go('#/admin/barbershops')">Ver todas</button></div>
      <div class="table-wrap"><table><thead><tr><th>Barbearia</th><th>Plano</th><th>Status</th><th>MRR</th></tr></thead><tbody>
      ${DB.all('barbershops').slice(0,6).map(s=>{const plan=DB.find('plans',s.planId);return `<tr><td><div class="t-user"><div class="av">${initials(s.name)}</div><div><b>${escapeHtml(s.name)}</b><small>/${escapeHtml(s.slug)}</small></div></div></td><td><span class="badge ${plan.color}">${plan.name}</span></td><td><span class="badge ${s.status==='active'?'ok':'danger'}">${s.status==='active'?'Ativa':'Suspensa'}</span></td><td><b>${money(plan.price)}</b></td></tr>`;}).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h3>Atividade recente</h3></div>${DB.all('auditLogs').slice(0,6).map(l=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('activity')}</span><div><b>${escapeHtml(l.action)}</b><br><small>${escapeHtml(l.actorName)} · ${escapeHtml(l.target||'')}</small></div><small style="margin-left:auto;color:var(--muted-2)">${relTime(l.time)}</small></div>`).join('')}</div>
  </div>`;
}
function adminDashCharts(a){
  mkChart('admMrr','line',{labels:a.months,datasets:[{data:a.mrrSeries,borderColor:GOLD,backgroundColor:'rgba(212,175,55,.14)',fill:true,tension:.4,borderWidth:3,pointRadius:4,pointBackgroundColor:GOLD}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});
  mkChart('admPlans','doughnut',{labels:a.planDist.map(p=>p.name),datasets:[{data:a.planDist.map(p=>p.count),backgroundColor:[BRONZE,GOLD_L,GOLD,'#8C8579'],borderWidth:0}]},{cutout:'62%',plugins:{legend:{position:'bottom',labels:{padding:12,usePointStyle:true}}}});
}
function adminShops(){
  const shops=DB.all('barbershops');
  return `<div class="page-head"><div><h2>Barbearias</h2><p>${shops.length} barbearias na plataforma</p></div><div class="page-actions"><button class="btn btn-primary" onclick="adminShopForm()">${icon('plus')} Nova barbearia</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Barbearia</th><th>Proprietário</th><th>Plano</th><th>Status</th><th>Criada em</th><th></th></tr></thead><tbody>
  ${shops.map(s=>{const plan=DB.find('plans',s.planId);return `<tr>
    <td><div class="t-user"><div class="av">${initials(s.name)}</div><div><b>${escapeHtml(s.name)}</b><small>/${escapeHtml(s.slug)}</small></div></div></td>
    <td>${escapeHtml(s.ownerName||'—')}</td>
    <td><span class="badge ${plan.color}">${plan.name}</span></td>
    <td><span class="badge ${s.status==='active'?'ok':'danger'}">${s.status==='active'?'Ativa':'Suspensa'}</span></td>
    <td>${fmtDateShort(new Date(s.createdAt).toISOString().slice(0,10))}</td>
    <td><div class="row-actions">
      <button class="ra" title="Ver página" onclick="Router.go('#/'+'${s.slug}')">${icon('eye')}</button>
      <button class="ra" title="Acessar como dono (suporte)" onclick="adminLoginAs('${s.id}')">${icon('user')}</button>
      <button class="ra" title="Alterar plano" onclick="adminChangePlan('${s.id}')">${icon('creditCard')}</button>
      <button class="ra" title="Plano Enterprise (sob medida)" onclick="enterpriseForm('${s.id}')">${icon('building')}</button>
      ${s.status==='active'?`<button class="ra" title="Suspender" onclick="adminToggleShop('${s.id}','suspend')">${icon('lock')}</button>`:`<button class="ra" title="Reativar" onclick="adminToggleShop('${s.id}','activate')">${icon('check')}</button>`}
      <button class="ra del" title="Excluir" onclick="adminDeleteShop('${s.id}')">${icon('trash')}</button>
    </div></td></tr>`;}).join('')}
  </tbody></table></div>`;
}
function adminLoginAs(shopId){
  const owner=DB.get().users.find(u=>u.barbershopId===shopId&&u.role==='owner');
  if(!owner){toast('Esta barbearia não tem proprietário cadastrado.','err');return;}
  Session.impersonate(owner.id);DB.log('Acesso de suporte (login-as)',DB.find('barbershops',shopId).name,shopId);
  toast('Acessando como '+owner.name,'info');location.hash='#/dashboard';
}
function adminToggleShop(shopId,action){
  const shop=DB.find('barbershops',shopId);
  confirmAction(action==='suspend'?'Suspender barbearia?':'Reativar barbearia?',action==='suspend'?'A página pública ficará indisponível e os agendamentos serão pausados.':'A barbearia voltará a operar normalmente.',()=>{
    DB.update('barbershops',shopId,{status:action==='suspend'?'suspended':'active'});
    const sub=DB.findBy('subscriptions',s=>s.barbershopId===shopId);if(sub)DB.update('subscriptions',sub.id,{status:action==='suspend'?'past_due':'active'});
    DB.log(action==='suspend'?'Barbearia suspensa':'Barbearia reativada',shop.name,shopId);
    toast(action==='suspend'?'Barbearia suspensa.':'Barbearia reativada.',action==='suspend'?'info':'ok');renderAdmin({sub:'barbershops'});
  },action==='suspend');
}
function adminDeleteShop(shopId){
  const shop=DB.find('barbershops',shopId);
  confirmAction('Excluir barbearia?','Todos os dados desta barbearia serão removidos permanentemente.',()=>{
    ['services','barbers','customers','appointments','products','campaigns','reviews','blocks'].forEach(c=>{DB.get()[c]=DB.get()[c].filter(x=>x.barbershopId!==shopId);});
    DB.get().subscriptions=DB.get().subscriptions.filter(s=>s.barbershopId!==shopId);
    DB.get().users=DB.get().users.filter(u=>u.barbershopId!==shopId);
    DB.remove('barbershops',shopId);DB.log('Barbearia excluída',shop.name,shopId);
    toast('Barbearia excluída.','info');renderAdmin({sub:'barbershops'});
  });
}
function adminChangePlan(shopId){
  const shop=DB.find('barbershops',shopId);
  openModal(`<div class="modal-head"><div><h3>Alterar plano</h3><div class="sub">${escapeHtml(shop.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="grid" style="gap:10px">${DB.all('plans').filter(p=>!p.enterprise).map(p=>`<div class="select-item ${shop.planId===p.id?'sel':''}" onclick="applyPlan('${shopId}','${p.id}')"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="t">${p.name}</div><div class="d">${p.features[0]}</div></div><div class="p">${p.price===0?'Grátis':money(p.price)}</div></div></div>`).join('')}</div>
  <p class="muted" style="font-size:12.5px;margin-top:12px">Precisa de limites/preço personalizados? Use o botão ${icon('building')} <b>Enterprise</b> na lista.</p></div>`);
}
function applyPlan(shopId,planId){const shop=DB.find('barbershops',shopId),plan=DB.find('plans',planId);DB.update('barbershops',shopId,{planId});const sub=DB.findBy('subscriptions',s=>s.barbershopId===shopId);if(sub)DB.update('subscriptions',sub.id,{planId,mrr:plan.price,custom:null});DB.log('Plano alterado',`${shop.name} → ${plan.name}`,shopId);closeModal();toast('Plano atualizado.','ok');renderAdmin({sub:'barbershops'});}

/* ---------- Editor de Plano Enterprise (sob medida) ---------- */
function enterpriseForm(shopId){
  const shop=DB.find('barbershops',shopId);const ent=shopEntitlements(shopId);
  const tog=(k,label,desc)=>`<div class="mini-slot" style="margin:0 0 8px"><div style="flex:1"><b>${label}</b><br><small>${desc}</small></div><div class="switch ${ent[k]?'on':''}" id="ent_${k}" onclick="this.classList.toggle('on')"></div></div>`;
  openModal(`<div class="modal-head"><div><h3>${icon('building')} Plano Enterprise</h3><div class="sub">${escapeHtml(shop.name)} — preços e limites sob medida</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <p class="muted" style="font-size:13px;margin-bottom:14px">Defina os valores deste cliente. Os limites do plano padrão são <b>sobrepostos</b> por estes. O cliente verá apenas "Plano Enterprise".</p>
    <div class="form-row"><div class="field"><label>Preço mensal (R$)</label><input class="input" type="number" min="0" id="ent_monthly" value="${ent.isEnterprise?ent.monthly:''}" placeholder="ex.: 249"></div><div class="field"><label>Preço anual (R$)</label><input class="input" type="number" min="0" id="ent_annual" value="${ent.isEnterprise?ent.annual:''}" placeholder="ex.: 2241"></div></div>
    <div class="form-row three"><div class="field"><label>Profissionais</label><input class="input" type="number" min="1" id="ent_limitBarbers" value="${ent.limitBarbers}"></div><div class="field"><label>Unidades</label><input class="input" type="number" min="1" id="ent_limitLocations" value="${ent.limitLocations}"></div><div class="field"><label>WhatsApp/mês</label><input class="input" type="number" min="0" id="ent_whatsappLimit" value="${ent.whatsappLimit}"></div></div>
    <div class="side-section" style="padding-left:0">Recursos liberados</div>
    ${tog('ai','Inteligência Artificial','BI, insights e analytics preditivo')}
    ${tog('apiAccess','Acesso à API','Integrações externas e webhooks')}
    ${tog('whiteLabel','White Label','Marca própria, sem "Groomin"')}
    ${tog('mobileApp','App Mobile','Acesso ao aplicativo dedicado')}
    ${tog('advancedReports','Relatórios avançados','Relatórios executivos e exportações')}
  </div>
  <div class="modal-foot">${ent.isEnterprise?`<button class="btn btn-danger" onclick="revertEnterprise('${shopId}')">Remover Enterprise</button>`:''}<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveEnterprise('${shopId}')">${icon('check')} Aplicar plano Enterprise</button></div>`);
}
function saveEnterprise(shopId){
  const shop=DB.find('barbershops',shopId);
  const monthly=+$('#ent_monthly').value||0;
  if(monthly<=0){toast('Informe o preço mensal.','err');return;}
  const custom={
    monthly,annual:+$('#ent_annual').value||Math.round(monthly*0.75*12),
    limitBarbers:+$('#ent_limitBarbers').value||1,limitLocations:+$('#ent_limitLocations').value||1,whatsappLimit:+$('#ent_whatsappLimit').value||0,
    ai:$('#ent_ai').classList.contains('on'),apiAccess:$('#ent_apiAccess').classList.contains('on'),whiteLabel:$('#ent_whiteLabel').classList.contains('on'),mobileApp:$('#ent_mobileApp').classList.contains('on'),advancedReports:$('#ent_advancedReports').classList.contains('on')
  };
  DB.update('barbershops',shopId,{planId:'enterprise'});
  const sub=shopSubscription(shopId);
  if(sub)DB.update('subscriptions',sub.id,{planId:'enterprise',mrr:monthly,custom});
  else DB.insert('subscriptions',{barbershopId:shopId,planId:'enterprise',status:'active',mrr:monthly,custom,startedAt:Date.now(),renewsAt:DB.addDays(DB.todayISO(),30)});
  DB.log('Plano Enterprise aplicado',`${shop.name} · ${money(monthly)}/mês`,shopId);
  closeModal();toast('Plano Enterprise aplicado.','ok');renderAdmin({sub:'barbershops'});
}
function revertEnterprise(shopId){
  confirmAction('Remover Enterprise?','A barbearia voltará para o plano Grátis. Você pode atribuir outro plano depois.',()=>{
    DB.update('barbershops',shopId,{planId:'free'});const sub=shopSubscription(shopId);const free=DB.find('plans','free');
    if(sub)DB.update('subscriptions',sub.id,{planId:'free',mrr:free.price,custom:null});
    DB.log('Plano Enterprise removido',DB.find('barbershops',shopId).name,shopId);
    closeModal();toast('Enterprise removido.','info');renderAdmin({sub:'barbershops'});
  });
}
function adminShopForm(){
  openModal(`<div class="modal-head"><h3>Nova barbearia</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="as_name" oninput="$('#as_slug').textContent=slugify(this.value)||'slug'"><div class="err">Informe o nome.</div></div>
    <div class="field"><label>Slug público</label><div class="input" style="background:var(--surface-3);color:var(--muted)">groomin.com.br/<b id="as_slug" style="color:var(--primary)">slug</b></div></div>
    <div class="form-row">
      <div class="field"><label>Proprietário *</label><input class="input" id="as_owner"></div>
      <div class="field"><label>E-mail do dono *</label><input class="input" id="as_email"></div>
    </div>
    <div class="field"><label>Plano</label><select class="input" id="as_plan">${DB.all('plans').map(p=>`<option value="${p.id}" ${p.id==='growth'?'selected':''}>${p.name} — ${p.price===0?'Grátis':money(p.price)+'/mês'}</option>`).join('')}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveAdminShop()">Criar</button></div>`);
}
function saveAdminShop(){
  const name=$('#as_name').value.trim(),owner=$('#as_owner').value.trim(),email=$('#as_email').value.trim(),planId=$('#as_plan').value;
  if(name.length<2||owner.length<2||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Preencha nome, dono e e-mail válido.','err');return;}
  let slug=slugify(name)||'barbearia';let base=slug,i=1;while(DB.findBy('barbershops',s=>s.slug===slug)){slug=base+'-'+(++i);}
  const shopId=DB.uid('shop');const plan=DB.find('plans',planId);
  DB.insert('barbershops',{id:shopId,slug,name,ownerName:owner,description:'Barbearia cadastrada na plataforma.',address:'',city:'',neighborhood:'',phone:'',whatsapp:'',email,instagram:'',open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',planId,status:'active',rating:0,createdAt:Date.now(),slotInterval:30});
  DB.insert('subscriptions',{barbershopId:shopId,planId,status:'active',mrr:plan.price,startedAt:Date.now(),renewsAt:DB.addDays(DB.todayISO(),30)});
  const tempPass='barber123';
  if(!DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase()))DB.insert('users',{name:owner,email,password:tempPass,role:'owner',barbershopId:shopId,active:true});
  DB.log('Barbearia criada',name,shopId);closeModal();toast('Barbearia criada (senha do dono: barber123).','ok');renderAdmin({sub:'barbershops'});
}
function adminSubs(){
  const plans=DB.all('plans').filter(p=>!p.enterprise);const subs=DB.all('subscriptions');
  const entShops=DB.all('barbershops').filter(s=>s.planId==='enterprise');
  const entMrr=subs.filter(s=>s.planId==='enterprise').reduce((a,s)=>a+s.mrr,0);
  return `<div class="page-head"><div><h2>Assinaturas</h2><p>Planos e contratos ativos</p></div></div>
  <div class="pricing-grid" style="margin-bottom:18px">${plans.map(p=>{const count=DB.all('barbershops').filter(s=>s.planId===p.id).length;return `<div class="price-card ${p.id==='pro'?'featured':''}"><h3>${p.name}</h3><div class="pc-price">${p.price===0?'Grátis':'R$ '+p.price}${p.price>0?'<small>/mês</small>':''}</div><div class="pc-desc">${count} barbearia(s) · ${moneyK(p.price*count)} MRR</div><ul>${p.features.slice(0,3).map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}</ul></div>`;}).join('')}
    <div class="price-card" style="border-color:var(--primary)"><span class="pc-tag">Sob medida</span><h3>${icon('building')} Enterprise</h3><div class="pc-price" style="font-size:30px">${entShops.length}<small> contas</small></div><div class="pc-desc">${moneyK(entMrr)} MRR · preços e limites personalizados</div><ul><li>${icon('check')} Limites customizados</li><li>${icon('check')} Recursos sob demanda</li></ul></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Contratos</h3></div><div class="table-wrap"><table><thead><tr><th>Barbearia</th><th>Plano</th><th>Status</th><th>MRR</th><th>Renova em</th><th></th></tr></thead><tbody>
  ${subs.map(s=>{const shop=DB.find('barbershops',s.barbershopId);const plan=DB.find('plans',s.planId);if(!shop)return'';const stCls={active:'ok',trialing:'info',past_due:'danger',canceled:'muted'}[s.status];const stLbl={active:'Ativa',trialing:'Trial',past_due:'Em atraso',canceled:'Cancelada'}[s.status];const isEnt=s.planId==='enterprise';return `<tr><td><b>${escapeHtml(shop.name)}</b></td><td><span class="badge ${plan.color}">${plan.name}</span>${isEnt?` <span class="badge gold">${icon('building')}</span>`:''}</td><td><span class="badge ${stCls}">${stLbl}</span></td><td>${money(s.mrr)}</td><td>${fmtDate(s.renewsAt)}</td><td>${isEnt?`<button class="btn btn-sm btn-ghost" onclick="enterpriseForm('${shop.id}')">Editar</button>`:''}</td></tr>`;}).join('')}
  </tbody></table></div></div>`;
}
function adminBilling(){
  const invoices=DB.all('invoices').slice().sort((a,b)=>b.date.localeCompare(a.date));
  const failed=invoices.filter(i=>i.status==='failed');
  const totalPaid=invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.amount,0);
  return `<div class="page-head"><div><h2>Faturamento</h2><p>Histórico de pagamentos e faturas</p></div><div class="page-actions"><button class="btn btn-ghost" onclick="exportCSV('invoices')">${icon('download')} Exportar</button></div></div>
  <div class="stat-grid">
    ${statCard('c2','dollar','Total recebido',moneyK(totalPaid),invoices.filter(i=>i.status==='paid').length+' faturas pagas')}
    ${statCard('c5','alert','Pagamentos falhos',failed.length,'requer atenção',failed.length?'down':'up')}
    ${statCard('c1','creditCard','Faturas emitidas',invoices.length,'total')}
  </div>
  ${failed.length?`<div class="panel" style="border-color:var(--danger)"><div class="panel-head"><h3 style="color:var(--danger)">${icon('alert')} Pagamentos falhos</h3></div>${failed.map(i=>{const shop=DB.find('barbershops',i.barbershopId);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic" style="background:var(--danger-soft);color:var(--danger)">${icon('creditCard')}</span><div><b>${escapeHtml(shop?shop.name:'—')}</b><br><small>${i.number} · ${money(i.amount)} · ${fmtDate(i.date)}</small></div><button class="btn btn-sm btn-ghost" style="margin-left:auto" onclick="retryInvoice('${i.id}')">Reprocessar</button></div>`;}).join('')}</div>`:''}
  <div class="panel"><div class="panel-head"><h3>Histórico de faturas</h3></div><div class="table-wrap"><table><thead><tr><th>Fatura</th><th>Barbearia</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead><tbody>
  ${invoices.map(i=>{const shop=DB.find('barbershops',i.barbershopId);return `<tr><td><b>${i.number}</b></td><td>${escapeHtml(shop?shop.name:'—')}</td><td>${money(i.amount)}</td><td>${fmtDate(i.date)}</td><td><span class="badge ${i.status==='paid'?'ok':i.status==='failed'?'danger':'warn'}">${i.status==='paid'?'Paga':i.status==='failed'?'Falhou':'Aberta'}</span></td></tr>`;}).join('')}
  </tbody></table></div></div>`;
}
function retryInvoice(id){DB.update('invoices',id,{status:'paid'});const inv=DB.find('invoices',id);const sub=DB.findBy('subscriptions',s=>s.barbershopId===inv.barbershopId);if(sub)DB.update('subscriptions',sub.id,{status:'active'});DB.update('barbershops',inv.barbershopId,{status:'active'});DB.log('Pagamento reprocessado',inv.number,inv.barbershopId);toast('Pagamento reprocessado com sucesso.','ok');renderAdmin({sub:'billing'});}
function adminAudit(){
  const logs=DB.all('auditLogs');
  return `<div class="page-head"><div><h2>Logs de Auditoria</h2><p>Histórico completo de ações e segurança</p></div><div class="page-actions"><button class="btn btn-ghost" onclick="exportCSV('auditLogs')">${icon('download')} Exportar</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Perfil</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>
  ${logs.map(l=>`<tr><td>${new Date(l.time).toLocaleString('pt-BR')}</td><td><div class="t-user"><div class="av">${initials(l.actorName)}</div><b>${escapeHtml(l.actorName)}</b></div></td><td><span class="badge muted">${ROLE_LABEL[l.role]||l.role}</span></td><td><b>${escapeHtml(l.action)}</b></td><td class="muted">${escapeHtml(l.target||'')}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function adminSettings(){
  const s=DB.get().settings;
  const flag=(k,label,desc)=>`<div class="mini-slot" style="margin:0 0 10px"><div><b>${label}</b><br><small>${desc}</small></div><div class="switch ${s.featureFlags[k]?'on':''}" style="margin-left:auto" onclick="toggleFlag('${k}',this)"></div></div>`;
  return `<div class="page-head"><div><h2>Configurações da Plataforma</h2><p>Recursos globais, templates e notificações</p></div></div>
  <div class="dash-cols">
    <div>
      <div class="panel"><div class="panel-head"><h3>${icon('flag')} Feature Flags</h3></div>
        ${flag('marketplace','Marketplace público','Página /find-barbershops para clientes descobrirem barbearias')}
        ${flag('whatsapp','Integração WhatsApp','Envio de confirmações e lembretes')}
        ${flag('aiInsights','Insights de IA','Recomendações automáticas de negócio')}
        ${flag('onlinePayments','Pagamentos online','Cobrança no agendamento (beta)')}
        ${flag('reviews','Avaliações públicas','Exibir avaliações na página da barbearia')}
      </div>
      <div class="panel"><div class="panel-head"><h3>${icon('bell')} Notificações</h3></div>
        <div class="checkbox-row"><div class="switch ${s.notifications.emailEnabled?'on':''}" onclick="toggleNotifPref('emailEnabled',this)"></div><label style="margin:0">E-mail</label></div>
        <div class="checkbox-row"><div class="switch ${s.notifications.whatsappEnabled?'on':''}" onclick="toggleNotifPref('whatsappEnabled',this)"></div><label style="margin:0">WhatsApp</label></div>
        <div class="checkbox-row"><div class="switch ${s.notifications.smsEnabled?'on':''}" onclick="toggleNotifPref('smsEnabled',this)"></div><label style="margin:0">SMS (em breve)</label></div>
      </div>
    </div>
    <div>
      <div class="panel"><div class="panel-head"><h3>${icon('mail')} Templates de E-mail</h3></div>${s.emailTemplates.map(t=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('mail')}</span><div><b>${escapeHtml(t.name)}</b><br><small>${escapeHtml(t.subject)}</small></div><span class="badge ${t.active?'ok':'muted'}" style="margin-left:auto">${t.active?'Ativo':'Inativo'}</span></div>`).join('')}</div>
      <div class="panel"><div class="panel-head"><h3>${icon('whatsapp')} Templates de WhatsApp</h3></div>${s.whatsappTemplates.map(t=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('whatsapp')}</span><div><b>${escapeHtml(t.name)}</b><br><small>${escapeHtml(t.text.slice(0,46))}…</small></div></div>`).join('')}</div>
      <div class="panel"><div class="panel-head"><h3>${icon('alert')} Manutenção</h3></div><p class="muted" style="font-size:13.5px;margin-bottom:14px">Restaura todos os dados de demonstração da plataforma.</p><button class="btn btn-danger" onclick="confirmAction('Redefinir plataforma?','Todos os dados de demonstração serão restaurados.',()=>{DB.reset();toast('Dados redefinidos.','info');location.hash='#/admin';})">${icon('repeat')} Redefinir dados demo</button></div>
    </div>
  </div>`;
}
function toggleFlag(k,el){const s=DB.get().settings;s.featureFlags[k]=!s.featureFlags[k];DB.save();el.classList.toggle('on',s.featureFlags[k]);toast('Configuração salva.','ok');DB.log('Feature flag alterada',k+'='+s.featureFlags[k]);}
function toggleNotifPref(k,el){const s=DB.get().settings;s.notifications[k]=!s.notifications[k];DB.save();el.classList.toggle('on',s.notifications[k]);toast('Preferência salva.','ok');}
function exportCSV(collection){
  const rows=[];const data=DB.all(collection);
  if(!data.length){toast('Nada para exportar.','info');return;}
  rows.push(Object.keys(data[0]));data.forEach(d=>rows.push(Object.values(d).map(v=>typeof v==='object'?JSON.stringify(v):v)));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='barberos-'+collection+'.csv';a.click();toast('Exportado.','ok');
}
