/* ============================================================
   SHARED APP SHELL (sidebar + appbar) used by admin/dashboard/barber
   ============================================================ */
let charts={};
function destroyCharts(){Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}});charts={};}
function openSidebar(){$('#sidebar')&&$('#sidebar').classList.add('open');$('#sideBackdrop')&&$('#sideBackdrop').classList.add('open');}
function closeSidebar(){$('#sidebar')&&$('#sidebar').classList.remove('open');$('#sideBackdrop')&&$('#sideBackdrop').classList.remove('open');}
function shellGo(target){closeSidebar();if(location.hash===target){Router.render();return;}Router.go(target);}
function mountShell(cfg){
  const u=Session.effectiveUser;const realUser=Session.user;
  const imp=Session.impersonating;
  const brandShop=cfg.brandShop||null;
  const brandName=brandShop?brandShop.name:'Groomin';
  const brandMark=brandShop?brandLogo(brandShop):icon('scissors');
  const banner=imp?`<div class="impersonate-bar">${icon('eye')} Você está acessando como <b>${escapeHtml(imp.name)}</b> (${ROLE_LABEL[imp.role]}) — modo suporte. <button onclick="exitImpersonation()">Voltar ao Super Admin</button></div>`:'';
  const navHTML=cfg.nav.map(n=>{
    if(n.section)return `<div class="side-section">${escapeHtml(n.section)}</div>`;
    const target=(cfg.navBase+n.id).replace(/\/$/,'');
    if(n.locked)return `<div class="side-link locked ${n.id===cfg.activeId?'active':''}" onclick="showUpgrade('${escapeHtml(n.lockLabel)}','${escapeHtml(n.lockPlan)}',${n.lockEnt?'true':'false'})" title="Disponível no plano ${escapeHtml(n.lockPlan)}">${icon(n.icon)}<span>${escapeHtml(n.label)}</span><span class="lock-badge">${icon('lock')}</span></div>`;
    return `<div class="side-link ${n.id===cfg.activeId?'active':''}" onclick="shellGo('${target}')">${icon(n.icon)}<span>${escapeHtml(n.label)}</span>${n.count!=null?`<span class="count">${n.count}</span>`:''}</div>`;
  }).join('');
  // bottom navigation (mobile): até 4 itens principais + "Mais" (abre a sidebar)
  const primary=cfg.nav.filter(n=>!n.section).slice(0,4);
  const bottomNav=`<nav class="bottom-nav">${primary.map(n=>{
    const target=(cfg.navBase+n.id).replace(/\/$/,'');
    const onclick=n.locked?`showUpgrade('${escapeHtml(n.lockLabel)}','${escapeHtml(n.lockPlan)}',${n.lockEnt?'true':'false'})`:`shellGo('${target}')`;
    return `<button class="bn-item ${n.id===cfg.activeId?'active':''}" onclick="${onclick}">${icon(n.icon)}${n.locked?`<span class="bn-lock">${icon('lock')}</span>`:''}<span>${escapeHtml(n.label.split(' ')[0])}</span></button>`;
  }).join('')}<button class="bn-item" onclick="openSidebar()">${icon('menu')}<span>Mais</span></button></nav>`;
  return `<div class="backdrop" id="sideBackdrop" onclick="closeSidebar()"></div>
  <div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand" onclick="Router.go('#/')"><span class="logo">${brandMark}</span><span>${escapeHtml(brandName)}<small>${escapeHtml(cfg.brandSub||'')}</small></span></div>
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
        <button class="btn btn-ghost btn-sm app-logout-btn" onclick="doLogout()">${icon('logout')} Sair</button>
        <button class="icon-btn" data-theme-ic onclick="toggleTheme()"></button>
      </header>
      <div class="notif-pop" id="notifPop"></div>
      <div class="content" id="shellContent">${cfg.content}</div>
    </div>
  </div>
  ${bottomNav}`;
}
async function doLogout(){
  if(!confirm('Deseja sair da sua conta?'))return;
  if(window._dashLoadTimeout){clearTimeout(window._dashLoadTimeout);window._dashLoadTimeout=null;}
  try{if(window.__FB_ENABLED&&window.fbSignOut)await fbSignOut();}catch(e){console.warn('[Groomin] logout Firebase:',e&&e.code||'',e&&e.message||e);}
  Session.logout();
  toast('Sessão encerrada.','info');
  location.hash='#/login';
}
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
function markNotifRead(){const u=Session.effectiveUser;DB.all('notifications').forEach(n=>{if(!u.barbershopId||n.barbershopId===u.barbershopId){n.read=true;if(window.__FB_ENABLED&&window.__dbWrite)__dbWrite('set','notifications',n);}});DB.save();renderShellNotif();}
document.addEventListener('click',e=>{if(!e.target.closest('#notifPop')&&!e.target.closest('.icon-btn'))$('#notifPop')&&$('#notifPop').classList.remove('open');});
function refreshShell(){Router.render();}
window.__afterTheme=()=>{if($('#shellContent')||$('#root').querySelector('.dash-cols'))Router.render();};

/* chart helper */
let chartLoader=null;
function ensureChart(){
  if(window.Chart)return Promise.resolve(window.Chart);
  if(chartLoader)return chartLoader;
  chartLoader=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.async=true;
    s.onload=()=>resolve(window.Chart);
    s.onerror=reject;
    document.head.appendChild(s);
  });
  return chartLoader;
}
function mkChart(id,type,data,opts){
  const el=$('#'+id);if(!el)return;
  if(!window.Chart){ensureChart().then(()=>mkChart(id,type,data,opts)).catch(()=>{});return;}
  const grid=cssVar('--line'),tcol=cssVar('--muted'),prim=cssVar('--primary');
  Chart.defaults.font.family="'Plus Jakarta Sans',sans-serif";Chart.defaults.color=tcol;
  charts[id]=new Chart(el,{type,data,options:Object.assign({responsive:true,maintainAspectRatio:false},opts||{})});
}
function cssVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
const GOLD='#7C3AED',GOLD_L='#8B5CF6',BRONZE='#10B981',GREEN='#22C55E',RED='#EF4444',AMBER='#F59E0B';

/* ============================================================
   SUPER ADMIN CONSOLE
   ============================================================ */
const ADMIN_NAV=[
  {section:'Plataforma'},
  {id:'',label:'Painel',icon:'grid'},
  {id:'barbershops',label:'Clientes',icon:'building'},
  {id:'subscriptions',label:'Assinaturas',icon:'creditCard'},
  {id:'courtesy',label:'Plano Cortesia',icon:'award'},
  {id:'billing',label:'Faturamento',icon:'dollar'},
  {section:'Operação'},
  {id:'audit',label:'Logs de Auditoria',icon:'activity'},
  {id:'settings',label:'Configurações',icon:'settings'}
];
const ADMIN_SEGMENT_LABELS={
  'barbershop':'Barbearia',
  'hair-salon':'Salão de cabelo',
  'nail-designer':'Nail designer',
  'lash-designer':'Lash designer',
  'makeup-artist':'Maquiador(a)',
  'beauty-clinic':'Clínica de estética',
  'tattoo-studio':'Estúdio de tatuagem',
  'massage-therapist':'Massoterapeuta',
  'personal-trainer':'Personal trainer',
  'nutritionist':'Nutricionista',
  'physiotherapist':'Fisioterapeuta',
  'dentist':'Dentista',
  'photographer':'Fotógrafo',
  'consultant':'Consultor',
  'other':'Outro'
};
function adminSegmentLabel(value){return ADMIN_SEGMENT_LABELS[value]||value||'Não informado';}
function renderAdmin(r){
  destroyCharts();
  const sub=r.sub||'';
  const titles={'':'Painel da Plataforma',barbershops:'Clientes',subscriptions:'Assinaturas',courtesy:'Plano Cortesia',billing:'Faturamento',audit:'Logs de Auditoria',settings:'Configurações da Plataforma'};
  const a=platformAnalytics();
  const nav=ADMIN_NAV.map(n=>n.id==='barbershops'?{...n,count:DB.all('barbershops').length}:n);
  const content=({'':adminDash,barbershops:adminShops,subscriptions:adminSubs,courtesy:adminCourtesy,billing:adminBilling,audit:adminAudit,settings:adminSettings}[sub]||adminDash)(a);
  $('#root').innerHTML=mountShell({brandSub:'Super Admin',nav,activeId:sub,navBase:'#/admin/',title:titles[sub]||'Plataforma',crumb:'Visão da plataforma Groomin',content});
  if(sub==='')adminDashCharts(a);
  renderShellNotif();
}
function adminDash(a){
  return `<div class="stat-grid">
    ${statCard('c1','building','Clientes',a.totalShops,a.activeShops+' ativos')}
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
  <div class="panel" style="margin-bottom:20px">
    <div class="panel-head">
      <div><h3>${icon('dollar')} Receita mensal por plano</h3><div class="sub">Clientes ativos × valor do plano</div></div>
      <span class="badge ok" style="font-size:15px;padding:6px 14px"><b>${money(a.mrr)}/mês</b></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Plano</th><th style="text-align:center">Clientes ativos</th><th style="text-align:right">Valor/mês</th><th style="text-align:right">Subtotal</th></tr></thead>
      <tbody>
        ${a.planRevenue.map(p=>`<tr>
          <td><span class="badge ${p.color}">${p.name}</span></td>
          <td style="text-align:center"><b>${p.active}</b></td>
          <td style="text-align:right;color:var(--muted)">${p.price===0?'Grátis':money(p.price)}</td>
          <td style="text-align:right"><b>${p.price===0?'—':money(p.subtotal)}</b></td>
        </tr>`).join('')}
        <tr style="border-top:2px solid var(--line);font-weight:700">
          <td>Total</td>
          <td style="text-align:center">${a.activeShops}</td>
          <td style="text-align:right;color:var(--muted)">—</td>
          <td style="text-align:right;color:var(--primary);font-size:16px">${money(a.mrr)}</td>
        </tr>
      </tbody>
    </table></div>
    ${a.freeCount>0?`<div class="insight info" style="margin-top:12px"><span class="ii">${icon('trending')}</span><div><b>${a.freeCount} conta(s) em teste gratuito</b><p>Potencial de conversão: até ${money(a.freeCount*14.90)}/mês no Plano Mensal.</p></div></div>`:''}
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><div><h3>Evolução do MRR</h3><div class="sub">Receita recorrente mensal (R$)</div></div><span class="badge ok">${icon('trending')} ${(a.growth>=0?'+':'')+a.growth}%</span></div><div class="chart-wrap"><canvas id="admMrr"></canvas></div></div>
    <div class="panel"><div class="panel-head"><h3>Distribuição por plano</h3></div><div class="chart-wrap chart-sm"><canvas id="admPlans"></canvas></div></div>
  </div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Clientes recentes</h3><button class="btn btn-ghost btn-sm" onclick="Router.go('#/admin/barbershops')">Ver todos</button></div>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Segmento</th><th>Plano</th><th>Status</th><th>MRR</th></tr></thead><tbody>
      ${DB.all('barbershops').slice(0,6).map(s=>{const plan=DB.find('plans',s.planId)||{name:'—',color:'muted',price:0};return `<tr><td><div class="t-user"><div class="av">${initials(s.name)}</div><div><b>${escapeHtml(s.name)}</b><small>/${escapeHtml(s.slug)}</small></div></div></td><td><span class="badge info">${escapeHtml(adminSegmentLabel(s.category))}</span></td><td><span class="badge ${plan.color}">${plan.name}</span></td><td><span class="badge ${s.status==='active'?'ok':'danger'}">${s.status==='active'?'Ativa':'Suspensa'}</span></td><td><b>${money(plan.price)}</b></td></tr>`;}).join('')}
      </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h3>Atividade recente</h3></div>${DB.all('auditLogs').slice(0,6).map(l=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('activity')}</span><div><b>${escapeHtml(l.action)}</b><br><small>${escapeHtml(l.actorName)} · ${escapeHtml(l.target||'')}</small></div><small style="margin-left:auto;color:var(--muted-2)">${relTime(l.time)}</small></div>`).join('')}</div>
  </div>`;
}
function adminDashCharts(a){
  mkChart('admMrr','line',{labels:a.months,datasets:[{data:a.mrrSeries,borderColor:GOLD,backgroundColor:'rgba(124,58,237,.14)',fill:true,tension:.4,borderWidth:3,pointRadius:4,pointBackgroundColor:GOLD}]},{plugins:{legend:{display:false}},scales:{y:{grid:{color:cssVar('--line')},ticks:{callback:v=>'R$'+v}},x:{grid:{display:false}}}});
  mkChart('admPlans','doughnut',{labels:a.planDist.map(p=>p.name),datasets:[{data:a.planDist.map(p=>p.count),backgroundColor:[BRONZE,GOLD_L,GOLD,'#CBD5E1'],borderWidth:0}]},{cutout:'62%',plugins:{legend:{position:'bottom',labels:{padding:12,usePointStyle:true}}}});
}
function adminShops(){
  const shops=DB.all('barbershops');
  const emptyState=shops.length===0?`<tr><td colspan="7" style="text-align:center;padding:48px 0;color:var(--muted)">
    ${window.__FB_ENABLED?`${icon('clock')} Aguardando dados do Firestore… Se demorar mais de 5s, recarregue a página.`:'Nenhum cliente cadastrado.'}
  </td></tr>`:'';
  return `<div class="page-head"><div><h2>Clientes</h2><p>${shops.length} cliente(s) na plataforma</p></div><div class="page-actions"><button class="btn btn-primary" onclick="adminShopForm()">${icon('plus')} Novo cliente</button></div></div>
  <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Proprietário</th><th>Segmento</th><th>Plano</th><th>Status</th><th>Criado em</th><th></th></tr></thead><tbody>
  ${emptyState}${shops.map(s=>{const plan=DB.find('plans',s.planId)||{name:'—',color:'muted'};return `<tr>
    <td><div class="t-user"><div class="av">${initials(s.name)}</div><div><b>${escapeHtml(s.name)}</b><small>/${escapeHtml(s.slug)}</small></div></div></td>
    <td>${escapeHtml(s.ownerName||'—')}</td>
    <td><span class="badge info">${escapeHtml(adminSegmentLabel(s.category))}</span></td>
    <td><span class="badge ${plan.color}">${plan.name}</span></td>
    <td><span class="badge ${s.status==='active'?'ok':'danger'}">${s.status==='active'?'Ativa':'Suspensa'}</span></td>
    <td>${s.createdAt?fmtDateShort(new Date(s.createdAt).toISOString().slice(0,10)):'—'}</td>
    <td><div class="row-actions">
      <button class="ra" title="Ver página" onclick="Router.go('#/'+'${s.slug}')">${icon('eye')}</button>
      <button class="ra" title="Dados do proprietário" onclick="adminOwnerProfile('${s.id}')">${icon('user')}</button>
      <button class="ra" title="Alterar plano" onclick="adminChangePlan('${s.id}')">${icon('creditCard')}</button>
      ${s.status==='active'?`<button class="ra" title="Suspender" onclick="adminToggleShop('${s.id}','suspend')">${icon('lock')}</button>`:`<button class="ra" title="Reativar" onclick="adminToggleShop('${s.id}','activate')">${icon('check')}</button>`}
      <button class="ra del" title="Excluir" onclick="adminDeleteShop('${s.id}')">${icon('trash')}</button>
    </div></td></tr>`;}).join('')}
  </tbody></table></div>`;
}
function adminLoginAs(shopId){
  const owner=adminFindOwnerUser(shopId);
  if(!owner){toast('Este cliente não tem proprietário cadastrado.','err');return;}
  Session.impersonate(owner.id);DB.log('Acesso de suporte (login-as)',DB.find('barbershops',shopId).name,shopId);
  toast('Acessando como '+owner.name,'info');location.hash='#/dashboard';
}
function adminOwnerProfile(shopId){
  const shop=DB.find('barbershops',shopId),owner=adminFindOwnerUser(shopId)||{};
  if(!shop){toast('Estabelecimento não encontrado.','err');return;}
  const plan=DB.find('plans',shop.planId)||{};
  openModal(`<div class="modal-head"><div><h3>${icon('user')} Dados do proprietário</h3><div class="sub">${escapeHtml(shop.name)} · /${escapeHtml(shop.slug||'')}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    ${!owner.id&&!owner.uid?`<div class="insight warn" style="margin-bottom:14px"><span class="ii">${icon('alert')}</span><div><b>Usuário proprietário não encontrado</b><p>Cadastre o e-mail correto para vincular este negócio ao dono.</p></div></div>`:''}
    <div class="insight pos" style="margin-bottom:14px"><span class="ii">${icon('building')}</span><div><b>${escapeHtml(shop.name)}</b><p>${escapeHtml(adminSegmentLabel(shop.category))} · ${escapeHtml(plan.name||'Plano não informado')} · ${shop.status==='active'?'Ativa':'Suspensa'}</p></div></div>
    <div class="form-row"><div class="field"><label>Nome do proprietário</label><input class="input" id="adm_owner_name" value="${escapeHtml(owner.name||shop.ownerName||'')}"></div><div class="field"><label>E-mail de login</label><input class="input" id="adm_owner_email" value="${escapeHtml(owner.email||shop.email||'')}"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="adm_owner_phone" value="${escapeHtml(owner.phone||shop.phone||'')}"></div><div class="field"><label>WhatsApp</label><input class="input" id="adm_owner_wa" value="${escapeHtml(owner.whatsapp||shop.whatsapp||'')}"></div></div>
    <div class="field"><label>Endereço</label><input class="input" id="adm_owner_addr" value="${escapeHtml(owner.address||shop.address||'')}"></div>
    <div class="form-row"><div class="field"><label>Estabelecimento</label><input class="input" id="adm_shop_name" value="${escapeHtml(shop.name||'')}"></div><div class="field"><label>Segmento</label><select class="input" id="adm_shop_category">${BUSINESS_CATEGORIES.map(c=>`<option value="${c[0]}" ${shop.category===c[0]?'selected':''}>${c[1]}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="field"><label>Telefone do negócio</label><input class="input" id="adm_shop_phone" value="${escapeHtml(shop.phone||'')}"></div><div class="field"><label>WhatsApp do negócio</label><input class="input" id="adm_shop_wa" value="${escapeHtml(shop.whatsapp||'')}"></div></div>
    <div class="field"><label>Endereço público</label><input class="input" id="adm_shop_addr" value="${escapeHtml(shop.address||'')}"></div>
    <div class="field"><label>Nova senha opcional</label><input class="input" id="adm_owner_pass" type="password" placeholder="Deixe vazio para manter a senha atual"><small class="muted">A troca acontece no Firebase Auth. A senha não fica salva no banco.</small></div>
  </div>
  <div class="modal-foot">
    ${owner.id||owner.uid?`<button class="btn btn-ghost" onclick="adminLoginAs('${shopId}')">${icon('eye')} Abrir painel suporte</button>`:''}
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="saveAdminOwnerProfile('${shopId}')">${icon('check')} Salvar dados</button>
  </div>`);
}
async function saveAdminOwnerProfile(shopId){
  const shop=DB.find('barbershops',shopId),owner=adminFindOwnerUser(shopId);
  if(!shop||!owner){toast('Proprietário não encontrado.','err');return;}
  const payload={
    tenantId:shopId,userId:owner.uid||owner.id,
    name:$('#adm_owner_name').value.trim(),
    email:$('#adm_owner_email').value.trim(),
    phone:$('#adm_owner_phone').value.trim(),
    whatsapp:$('#adm_owner_wa').value.trim(),
    address:$('#adm_owner_addr').value.trim(),
    password:$('#adm_owner_pass').value
  };
  if(payload.name.length<2){toast('Informe o nome do proprietário.','err');return;}
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)){toast('Informe um e-mail válido.','err');return;}
  if(payload.password&&payload.password.length<6){toast('A senha precisa ter pelo menos 6 caracteres.','err');return;}
  const shopPatch={
    name:$('#adm_shop_name').value.trim(),
    category:$('#adm_shop_category').value,
    phone:$('#adm_shop_phone').value.trim(),
    whatsapp:$('#adm_shop_wa').value.trim(),
    address:$('#adm_shop_addr').value.trim(),
  };
  if(shopPatch.name.length<2){toast('Informe o nome do estabelecimento.','err');return;}
  try{
    if(window.__FB_ENABLED&&window.fbAdminUpdateOwnerProfile)await fbAdminUpdateOwnerProfile(payload);
    DB.update('users',owner.id||owner.uid,{name:payload.name,email:payload.email,phone:payload.phone,whatsapp:payload.whatsapp,address:payload.address});
    DB.update('barbershops',shopId,{...shopPatch,ownerName:payload.name,email:payload.email});
    DB.log('Dados do proprietário atualizados',shop.name,shopId);
    closeModal();toast('Proprietário atualizado.','ok');renderAdmin({sub:'barbershops'});
  }catch(e){
    console.warn('[Groomin] salvar proprietário admin:',e&&e.code||'',e&&e.message||e);
    toast((e&&e.message)||'Não foi possível salvar o proprietário.','err');
  }
}
function adminToggleShop(shopId,action){
  const shop=DB.find('barbershops',shopId);
  confirmAction(action==='suspend'?'Suspender cliente?':'Reativar cliente?',action==='suspend'?'A página pública ficará indisponível e os agendamentos serão pausados.':'O negócio voltará a operar normalmente.',()=>{
    DB.update('barbershops',shopId,{status:action==='suspend'?'suspended':'active'});
    const sub=DB.findBy('subscriptions',s=>s.barbershopId===shopId);if(sub)DB.update('subscriptions',sub.id,{status:action==='suspend'?'past_due':'active'});
    DB.log(action==='suspend'?'Cliente suspenso':'Cliente reativado',shop.name,shopId);
    toast(action==='suspend'?'Cliente suspenso.':'Cliente reativado.',action==='suspend'?'info':'ok');renderAdmin({sub:'barbershops'});
  },action==='suspend');
}
function adminDeleteShop(shopId){
  const shop=DB.find('barbershops',shopId);
  confirmAction('Excluir cliente?','Todos os dados deste negócio serão removidos permanentemente.',async()=>{
    try{
      if(window.fbAdminDeleteTenant) await window.fbAdminDeleteTenant({tenantId:shopId});
      ['services','barbers','customers','appointments','products','campaigns','reviews','blocks','sales','cashSessions','stockMoves','notifications','combos','invoices'].forEach(c=>{if(Array.isArray(DB.get()[c]))DB.get()[c]=DB.get()[c].filter(x=>x.barbershopId!==shopId);});
      DB.get().subscriptions=(DB.get().subscriptions||[]).filter(s=>s.barbershopId!==shopId);
      DB.get().users=(DB.get().users||[]).filter(u=>u.barbershopId!==shopId);
      DB.remove('barbershops',shopId);DB.log('Cliente excluído',shop.name,shopId);
      toast('Cliente excluído.','info');renderAdmin({sub:'barbershops'});
    }catch(e){toast('Erro ao excluir: '+(e.message||'tente novamente.'),'err');}
  });
}
function adminChangePlan(shopId){
  const shop=DB.find('barbershops',shopId),sub=adminCourtesySub(shopId),activeCourtesy=subscriptionCourtesyActive(sub);
  openModal(`<div class="modal-head"><div><h3>Alterar plano</h3><div class="sub">${escapeHtml(shop.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="grid" style="gap:10px">
    <div class="select-item ${activeCourtesy?'sel':''}" onclick="${activeCourtesy?`openCourtesyRemove('${shopId}')`:`openCourtesyActivate('${shopId}')`}"><div style="display:flex;justify-content:space-between;align-items:center;gap:16px"><div><div class="t">${icon('award')} Plano Cortesia</div><div class="d">${activeCourtesy?'Cortesia ativa. Clique para remover.':'Libera o acesso sem cobrança e sem limite do plano gratuito.'}</div></div><div class="p">${activeCourtesy?'Remover':'Ativar'}</div></div></div>
    ${DB.all('plans').filter(p=>['monthly','annual','founder'].includes(p.id)).map(p=>`<div class="select-item ${!activeCourtesy&&shop.planId===p.id?'sel':''}" onclick="applyPlan('${shopId}','${p.id}')"><div style="display:flex;justify-content:space-between;align-items:center"><div><div class="t">${p.name}</div><div class="d">${p.features[0]}</div></div><div class="p">${p.id==='annual'?'R$ 151,98/ano':p.id==='founder'?'R$ 990 pagamento único':money(p.price)+'/mês'}</div></div></div>`).join('')}
  </div></div>`);
}
function applyPlan(shopId,planId){const shop=DB.find('barbershops',shopId),plan=DB.find('plans',planId);const mrr=planId==='annual'?12.66:planId==='founder'?0:plan.price;DB.update('barbershops',shopId,{planId});const sub=DB.findBy('subscriptions',s=>s.barbershopId===shopId);if(sub)DB.update('subscriptions',sub.id,{planId,planType:planId,planName:plan.name,status:'active',billingStatus:'active',isCourtesy:false,mrr,custom:null,courtesyExpiresAt:null,courtesyNote:''});DB.log('Plano alterado',`${shop.name} → ${plan.name}`,shopId);closeModal();toast('Plano atualizado.','ok');renderAdmin({sub:'barbershops'});}

/* ---------- Plano Cortesia ---------- */
let adminCourtesyQuery='';
function adminFindOwnerUser(shopId){
  const shop=DB.find('barbershops',shopId)||{};
  const users=DB.all('users');
  const sameTenant=u=>(u.barbershopId===shopId||u.tenantId===shopId);
  return users.find(u=>sameTenant(u)&&u.role==='owner')
    ||users.find(u=>sameTenant(u)&&['owner','manager','admin'].includes(u.role))
    ||users.find(u=>(u.id&&u.id===shop.ownerUid)||(u.uid&&u.uid===shop.ownerUid))
    ||users.find(u=>shop.email&&u.email&&u.email.toLowerCase()===shop.email.toLowerCase())
    ||null;
}
function adminCourtesyOwner(shopId){
  return adminFindOwnerUser(shopId)||{};
}
function adminCourtesySub(shopId){
  return DB.findBy('subscriptions',s=>s.barbershopId===shopId)||{};
}
function adminCourtesyMatches(shop,owner,q){
  if(!q)return true;
  const hay=[shop.name,shop.slug,shop.email,shop.ownerName,owner.name,owner.email].join(' ').toLowerCase();
  return hay.includes(q);
}
function adminCourtesy(){
  const q=(adminCourtesyQuery||'').trim().toLowerCase();
  const rows=DB.all('barbershops').map(shop=>({shop,owner:adminCourtesyOwner(shop.id),sub:adminCourtesySub(shop.id)}))
    .filter(x=>adminCourtesyMatches(x.shop,x.owner,q))
    .sort((a,b)=>(b.sub.isCourtesy===true)-(a.sub.isCourtesy===true)||a.shop.name.localeCompare(b.shop.name));
  const actions=(DB.all('adminActions')||[]).filter(a=>/courtesy_plan/.test(a.actionType||'')).slice(0,8);
  return `<div class="page-head"><div><h2>Plano Cortesia</h2><p>Ative ou remova cortesia manual para proprietários cadastrados.</p></div></div>
  <div class="panel"><div class="panel-head"><h3>${icon('search')} Buscar proprietário ou estabelecimento</h3></div>
    <div class="field" style="margin-bottom:0"><input class="input" id="admin_courtesy_q" value="${escapeHtml(adminCourtesyQuery)}" placeholder="Nome, e-mail, estabelecimento ou slug" oninput="adminCourtesyQuery=this.value;renderAdmin({sub:'courtesy'})"></div>
  </div>
  <div class="table-wrap"><table><thead><tr><th>Estabelecimento</th><th>Proprietário</th><th>Plano atual</th><th>Status</th><th>Expiração</th><th></th></tr></thead><tbody>
    ${rows.map(({shop,owner,sub})=>{
      const plan=DB.find('plans',sub.planType||sub.planId||shop.planId)||DB.find('plans','free');
      const isActive=subscriptionCourtesyActive(sub),isExpired=subscriptionCourtesyExpired(sub);
      const planLabel=isActive?'Plano Cortesia':isExpired?'Cortesia expirada':(sub.planName||plan.name);
      const status=sub.billingStatus||sub.status||'active';
      const exp=sub.courtesyExpiresAt?fmtDate(sub.courtesyExpiresAt):'Sem expiração';
      return `<tr>
        <td><div class="t-user"><div class="av">${initials(shop.name)}</div><div><b>${escapeHtml(shop.name)}</b><small>/${escapeHtml(shop.slug)}</small></div></div></td>
        <td><b>${escapeHtml(owner.name||shop.ownerName||'—')}</b><br><small class="muted">${escapeHtml(owner.email||shop.email||'')}</small></td>
        <td><span class="badge ${isActive?'gold':isExpired?'warn':(plan.color||'muted')}">${escapeHtml(planLabel)}</span></td>
        <td><span class="badge ${status==='active'?'ok':status==='trialing'?'info':'danger'}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(exp)}${sub.courtesyNote?`<br><small class="muted">${escapeHtml(sub.courtesyNote)}</small>`:''}</td>
        <td><div class="row-actions">
          ${isActive?`<button class="btn btn-ghost btn-sm" onclick="openCourtesyRemove('${shop.id}')">${icon('x')} Remover</button>`:`<button class="btn btn-primary btn-sm" onclick="openCourtesyActivate('${shop.id}')">${icon('award')} Ativar</button>`}
        </div></td>
      </tr>`;
    }).join('')||`<tr><td colspan="6">${emptyState('search','Nenhum resultado','Busque por proprietário, e-mail, estabelecimento ou slug.')}</td></tr>`}
  </tbody></table></div>
  <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>${icon('activity')} Auditoria recente</h3></div>
    ${actions.length?actions.map(a=>{const shop=DB.find('barbershops',a.targetBusinessId);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon(a.actionType==='activate_courtesy_plan'?'award':'x')}</span><div><b>${a.actionType==='activate_courtesy_plan'?'Cortesia ativada':'Cortesia removida'}</b><br><small>${escapeHtml(shop?shop.name:a.targetBusinessId||'')} · ${escapeHtml(a.note||'sem observação')}</small></div><small style="margin-left:auto;color:var(--muted-2)">${relTime(a.createdAt||Date.now())}</small></div>`;}).join(''):'<p class="muted">Nenhuma ação de cortesia registrada ainda.</p>'}
  </div>`;
}
function openCourtesyActivate(shopId){
  const shop=DB.find('barbershops',shopId),sub=adminCourtesySub(shopId),owner=adminCourtesyOwner(shopId);
  openModal(`<div class="modal-head"><div><h3>${icon('award')} Ativar Plano Cortesia</h3><div class="sub">${escapeHtml(shop.name)} · ${escapeHtml(owner.email||shop.email||'')}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="summary-line"><span class="muted">Plano atual</span><b>${escapeHtml((sub.planName)||(DB.find('plans',sub.planType||sub.planId||shop.planId)||{}).name||'—')}</b></div>
    <div class="field"><label>Expiração opcional</label><input class="input" id="courtesy_exp" type="date"></div>
    <div class="field"><label>Observação interna</label><textarea class="input" id="courtesy_note" rows="4" placeholder="Ex.: cliente fundador, parceria, teste comercial..."></textarea></div>
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="adminApplyCourtesy('${shopId}',true)">${icon('check')} Ativar cortesia</button></div>`);
}
function openCourtesyRemove(shopId){
  const shop=DB.find('barbershops',shopId);
  openModal(`<div class="modal-head"><div><h3>Remover Plano Cortesia</h3><div class="sub">${escapeHtml(shop.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <p class="muted" style="margin-bottom:14px">A remoção volta a assinatura para o plano gratuito, sem apagar dados do estabelecimento.</p>
    <div class="field"><label>Observação interna</label><textarea class="input" id="courtesy_note" rows="4" placeholder="Motivo da remoção"></textarea></div>
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" onclick="adminApplyCourtesy('${shopId}',false)">${icon('x')} Remover cortesia</button></div>`);
}
async function adminApplyCourtesy(shopId,activate){
  const role=String((Session.user&&Session.user.role)||(Session.effectiveUser&&Session.effectiveUser.role)||'').toLowerCase();
  const email=String((Session.user&&Session.user.email)||(Session.effectiveUser&&Session.effectiveUser.email)||'').toLowerCase();
  const isAdmin=['super_admin','superadmin','admin_master'].includes(role)||email==='contato.groominbarber@gmail.com';
  if(!isAdmin){toast('Sem permissão.','err');return;}
  const note=($('#courtesy_note')||{}).value||'';
  const expiresAt=activate?(($('#courtesy_exp')||{}).value||''):null;
  try{
    if(window.__FB_ENABLED&&window.fbToggleCourtesyPlan){
      await fbToggleCourtesyPlan({tenantId:shopId,activate,expiresAt,note});
    }else{
      applyCourtesyLocal(shopId,activate,expiresAt,note);
    }
    closeModal();toast(activate?'Plano Cortesia ativado.':'Plano Cortesia removido.','ok');renderAdmin({sub:'courtesy'});
  }catch(e){
    toast(e&&e.message?e.message:'Não foi possível atualizar a cortesia.','err');
  }
}
function applyCourtesyLocal(shopId,activate,expiresAt,note){
  const shop=DB.find('barbershops',shopId),owner=adminCourtesyOwner(shopId),admin=Session.user||{};
  let sub=adminCourtesySub(shopId);
  if(!sub)sub=DB.insert('subscriptions',{barbershopId:shopId,planId:shop.planId||'free',status:'active',billingStatus:'active',mrr:0,startedAt:Date.now()});
  const previous=JSON.parse(JSON.stringify(sub||{}));
  const patch=activate?{
    planType:'courtesy',planName:'Plano Cortesia',billingStatus:'active',status:'active',isCourtesy:true,
    courtesyActivatedAt:Date.now(),courtesyActivatedBy:admin.id||admin.uid||admin.email||'admin',
    courtesyExpiresAt:expiresAt||null,courtesyNote:note||'',mrr:0,freeBookingLimit:null
  }:{
    planType:'free',planName:'Teste gratuito',planId:'free',billingStatus:'trialing',status:'trialing',isCourtesy:false,
    courtesyRemovedAt:Date.now(),courtesyRemovedBy:admin.id||admin.uid||admin.email||'admin',
    courtesyExpiresAt:null,courtesyNote:note||'',mrr:0,freeBookingLimit:3
  };
  DB.update('subscriptions',sub.id,patch);
  if(!activate)DB.update('barbershops',shopId,{planId:'free',freeBookingLimit:3});
  const updated=adminCourtesySub(shopId);
  DB.insert('adminActions',{actionType:activate?'activate_courtesy_plan':'remove_courtesy_plan',targetUserId:owner.id||owner.uid||'',targetBusinessId:shopId,adminUserId:admin.id||admin.uid||admin.email||'',previousSubscription:previous,newSubscription:JSON.parse(JSON.stringify(updated||{})),note:note||'',createdAt:Date.now()});
  DB.log(activate?'Plano Cortesia ativado':'Plano Cortesia removido',shop.name,shopId);
}

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
  confirmAction('Remover Enterprise?','O cliente voltará para o plano Grátis. Você pode atribuir outro plano depois.',()=>{
    DB.update('barbershops',shopId,{planId:'free'});const sub=shopSubscription(shopId);const free=DB.find('plans','free');
    if(sub)DB.update('subscriptions',sub.id,{planId:'free',mrr:free.price,custom:null});
    DB.log('Plano Enterprise removido',DB.find('barbershops',shopId).name,shopId);
    closeModal();toast('Enterprise removido.','info');renderAdmin({sub:'barbershops'});
  });
}
function adminShopForm(){
  openModal(`<div class="modal-head"><h3>Novo cliente</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="as_name" oninput="$('#as_slug').textContent=slugify(this.value)||'slug'"><div class="err">Informe o nome.</div></div>
    <div class="field"><label>Slug público</label><div class="input" style="background:var(--surface-3);color:var(--muted)">groomin.com.br/<b id="as_slug" style="color:var(--primary)">slug</b></div></div>
    <div class="form-row">
      <div class="field"><label>Proprietário *</label><input class="input" id="as_owner"></div>
      <div class="field"><label>E-mail do dono *</label><input class="input" id="as_email"></div>
    </div>
    <div class="field"><label>Plano</label><select class="input" id="as_plan">${DB.all('plans').filter(p=>['monthly','annual','founder'].includes(p.id)).map(p=>`<option value="${p.id}" ${p.id==='monthly'?'selected':''}>${p.name} — ${p.id==='annual'?'R$ 151,98/ano':p.id==='founder'?'R$ 990 pagamento único':money(p.price)+'/mês'}</option>`).join('')}</select></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveAdminShop()">Criar</button></div>`);
}
function saveAdminShop(){
  const name=$('#as_name').value.trim(),owner=$('#as_owner').value.trim(),email=$('#as_email').value.trim(),planId=$('#as_plan').value;
  if(name.length<2||owner.length<2||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Preencha nome, dono e e-mail válido.','err');return;}
  let slug=slugify(name)||'barbearia';let base=slug,i=1;while(DB.findBy('barbershops',s=>s.slug===slug)){slug=base+'-'+(++i);}
  const shopId=DB.uid('shop');const plan=DB.find('plans',planId);
  const mrr=planId==='annual'?12.66:planId==='founder'?0:plan.price;
  DB.insert('barbershops',{id:shopId,slug,name,ownerName:owner,description:'Página profissional cadastrada no Groomin.',address:'',city:'',neighborhood:'',phone:'',whatsapp:'',email,instagram:'',open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',planId,status:'active',rating:0,createdAt:Date.now(),slotInterval:30});
  DB.insert('subscriptions',{barbershopId:shopId,planId,status:'active',mrr,startedAt:Date.now(),renewsAt:DB.addDays(DB.todayISO(),planId==='annual'?365:30)});
  const tempPass='barber123';
  if(!DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase()))DB.insert('users',{name:owner,email,password:tempPass,role:'owner',barbershopId:shopId,active:true});
  DB.log('Cliente criado',name,shopId);closeModal();toast('Cliente criado (senha do dono: barber123).','ok');renderAdmin({sub:'barbershops'});
}
function adminSubs(){
  const plans=DB.all('plans').filter(p=>['monthly','annual','founder'].includes(p.id));const subs=DB.all('subscriptions');
  return `<div class="page-head"><div><h2>Assinaturas</h2><p>Planos e contratos ativos</p></div></div>
  <div class="pricing-grid" style="margin-bottom:18px">${plans.map(p=>{const count=DB.all('barbershops').filter(s=>s.planId===p.id).length;const mrr=p.id==='annual'?12.66:p.id==='founder'?0:p.price;const price=p.id==='annual'?'R$ 151,98<small>/ano</small>':p.id==='founder'?'R$ 990<small> pagamento único</small>':'R$ 14,90<small>/mês</small>';return `<div class="price-card ${p.id==='annual'?'featured':''}"><div style="display:flex;justify-content:space-between;align-items:flex-start"><h3>${p.name}</h3><button class="btn btn-ghost btn-sm" onclick="adminEditPlan('${p.id}')" style="font-size:11px;padding:2px 8px">${icon('edit')} Editar</button></div><div class="pc-price">${price}</div><div class="pc-desc">${count} conta(s) · ${moneyK(mrr*count)} MRR</div><ul>${p.features.slice(0,3).map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}</ul></div>`;}).join('')}</div>
  <div class="panel"><div class="panel-head"><h3>Contratos</h3></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Segmento</th><th>Plano</th><th>Status</th><th>MRR</th><th>Renova em</th><th></th></tr></thead><tbody>
  ${subs.map(s=>{const shop=DB.find('barbershops',s.barbershopId);const plan=DB.find('plans',s.planType||s.planId)||DB.find('plans','monthly');if(!shop)return'';const activeCourtesy=subscriptionCourtesyActive(s);const status=s.billingStatus||s.status;const stCls={active:'ok',trialing:'info',past_due:'danger',canceled:'muted'}[status];const stLbl={active:'Ativa',trialing:'Trial',past_due:'Em atraso',canceled:'Cancelada'}[status];const pName=activeCourtesy?'Plano Cortesia':(s.planName||plan.name);return `<tr><td><b>${escapeHtml(shop.name)}</b></td><td><span class="badge info">${escapeHtml(adminSegmentLabel(shop.category))}</span></td><td><span class="badge ${activeCourtesy?'gold':plan.color}">${escapeHtml(pName)}</span></td><td><span class="badge ${stCls}">${stLbl}</span></td><td>${money(activeCourtesy?0:s.mrr)}</td><td>${activeCourtesy?(s.courtesyExpiresAt?fmtDate(s.courtesyExpiresAt):'Sem expiração'):fmtDate(s.renewsAt)}</td><td></td></tr>`;}).join('')}
  </tbody></table></div></div>`;
}
function adminEditPlan(planId){
  const p=DB.find('plans',planId);if(!p||p.enterprise)return;
  openModal(`<div class="modal-head"><div><h3>${icon('edit')} Editar plano</h3><div class="sub">${escapeHtml(p.name)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="field"><label>Nome do plano</label><input class="input" id="ep_name" value="${escapeHtml(p.name)}"></div>
      <div class="field"><label>Preço mensal (R$)</label><input class="input" type="number" min="0" id="ep_price" value="${p.price}" placeholder="0 = Grátis"></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:8px">Alterar o preço atualiza o MRR exibido no dashboard. Assinaturas existentes não são cobradas retroativamente.</p>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveAdminPlan('${planId}')">${icon('check')} Salvar</button></div>`);
}
function saveAdminPlan(planId){
  const name=$('#ep_name').value.trim();const price=+$('#ep_price').value||0;
  if(!name){toast('Informe o nome do plano.','err');return;}
  DB.update('plans',planId,{name,price});
  const mrr=planId==='annual'?12.66:planId==='founder'?0:price;
  DB.all('subscriptions').filter(s=>s.planId===planId).forEach(s=>DB.update('subscriptions',s.id,{mrr}));
  DB.log('Plano editado',`${planId} → ${name} R$${price}/mês`);
  closeModal();toast('Plano atualizado.','ok');renderAdmin({sub:'subscriptions'});
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
  <div class="panel"><div class="panel-head"><h3>Histórico de faturas</h3></div><div class="table-wrap"><table><thead><tr><th>Fatura</th><th>Cliente</th><th>Segmento</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead><tbody>
  ${invoices.map(i=>{const shop=DB.find('barbershops',i.barbershopId);return `<tr><td><b>${i.number}</b></td><td>${escapeHtml(shop?shop.name:'—')}</td><td><span class="badge info">${escapeHtml(shop?adminSegmentLabel(shop.category):'—')}</span></td><td>${money(i.amount)}</td><td>${fmtDate(i.date)}</td><td><span class="badge ${i.status==='paid'?'ok':i.status==='failed'?'danger':'warn'}">${i.status==='paid'?'Paga':i.status==='failed'?'Falhou':'Aberta'}</span></td></tr>`;}).join('')}
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
  const pp=platformPublicPlans();
  if(window.__FB_ENABLED&&window.fbLoadPlatformSettings&&!s._fbPlansLoaded){
    fbLoadPlatformSettings().then(()=>{DB.get().settings._fbPlansLoaded=true;renderAdmin({sub:'settings'});}).catch(()=>{});
  }
  const planSlots=[
    {id:'free',label:'Teste Gratuito',desc:'Permite novos cadastros sem cartão (até 3 agendamentos/mês)'},
    {id:'monthly',label:'Mensal — R$ 14,90/mês',desc:'Agendamentos ilimitados, cobrança recorrente'},
    {id:'annual',label:'Anual — R$ 151,98/ano',desc:'Equivale a R$ 12,66/mês com desconto'},
    {id:'founder',label:'Founder — R$ 990 único',desc:'Acesso vitalício, vagas limitadas'}
  ];
  return `<div class="page-head"><div><h2>Configurações da Plataforma</h2><p>Recursos globais, templates e notificações</p></div></div>
  <div class="dash-cols">
    <div>
      <div class="panel"><div class="panel-head"><h3>${icon('creditCard')} Planos disponíveis para venda</h3><p class="muted" style="font-size:12.5px">Planos desativados não aparecem na landing nem na tela de assinatura.</p></div>
        ${planSlots.map(p=>`<div class="mini-slot" style="margin:0 0 10px"><div><b>${escapeHtml(p.label)}</b><br><small>${escapeHtml(p.desc)}</small></div><div class="switch ${pp[p.id]!==false?'on':''}" style="margin-left:auto" onclick="togglePlanVisibility('${p.id}',this)" title="${pp[p.id]!==false?'Ativo — clique para desativar':'Inativo — clique para ativar'}"></div></div>`).join('')}
      </div>
      <div class="panel"><div class="panel-head"><h3>${icon('flag')} Feature Flags</h3></div>
        ${flag('marketplace','Marketplace público','Página /find-barbershops para clientes descobrirem negócios')}
        ${flag('whatsapp','Integração WhatsApp','Envio de confirmações e lembretes')}
        ${flag('aiInsights','Insights de IA','Recomendações automáticas de negócio')}
        ${flag('onlinePayments','Pagamentos online','Cobrança no agendamento (beta)')}
        ${flag('reviews','Avaliações públicas','Exibir avaliações na página do cliente')}
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
      ${window.USE_FIREBASE?'':`<div class="panel"><div class="panel-head"><h3>${icon('alert')} Manutenção</h3></div><p class="muted" style="font-size:13.5px;margin-bottom:14px">Restaura todos os dados de demonstração da plataforma.</p><button class="btn btn-danger" onclick="confirmAction('Redefinir plataforma?','Todos os dados de demonstração serão restaurados.',()=>{DB.reset();toast('Dados redefinidos.','info');location.hash='#/admin';})">${icon('repeat')} Redefinir dados demo</button></div>`}
    </div>
  </div>`;
}
function toggleFlag(k,el){const s=DB.get().settings;s.featureFlags[k]=!s.featureFlags[k];DB.save();el.classList.toggle('on',s.featureFlags[k]);toast('Configuração salva.','ok');DB.log('Feature flag alterada',k+'='+s.featureFlags[k]);}
async function togglePlanVisibility(id,el){
  try{
    const s=DB.get().settings;
    if(!s.publicPlans)s.publicPlans={free:true,monthly:true,annual:true,founder:true};
    s.publicPlans[id]=s.publicPlans[id]===false;
    DB.save();
    el.classList.toggle('on',s.publicPlans[id]!==false);
    if(window.__FB_ENABLED&&window.fbSavePlatformPlanSettings){
      await fbSavePlatformPlanSettings(s.publicPlans).catch(e=>{console.error('[Groomin] togglePlanVisibility save:',e);toast('Erro ao salvar no Firestore: '+(e&&e.message||e),'err');});
    }
    toast(s.publicPlans[id]!==false?'Plano ativado.':'Plano desativado.','ok');
    DB.log('Visibilidade de plano alterada',id+'='+(s.publicPlans[id]!==false));
  }catch(e){console.error('[Groomin] togglePlanVisibility:',e);toast('Erro inesperado: '+(e&&e.message||e),'err');}
}
function toggleNotifPref(k,el){const s=DB.get().settings;s.notifications[k]=!s.notifications[k];DB.save();el.classList.toggle('on',s.notifications[k]);toast('Preferência salva.','ok');}
function exportCSV(collection){
  const rows=[];const data=DB.all(collection);
  if(!data.length){toast('Nada para exportar.','info');return;}
  rows.push(Object.keys(data[0]));data.forEach(d=>rows.push(Object.values(d).map(v=>typeof v==='object'?JSON.stringify(v):v)));
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='barberos-'+collection+'.csv';a.click();toast('Exportado.','ok');
}
