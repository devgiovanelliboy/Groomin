/* ============================================================
   SHARED ANALYTICS
   ============================================================ */
function shopAnalytics(shopId){
  const t=DB.todayISO();
  const appts=DB.scope('appointments',shopId);
  const valid=a=>a.status!=='cancelado';
  // Receita só existe após o atendimento ser concluído; confirmado é apenas reserva.
  const paid=a=>a.status==='concluido';
  const today=appts.filter(a=>a.date===t&&valid(a));
  const revToday=appts.filter(a=>a.date===t&&paid(a)).reduce((s,a)=>s+a.price,0);
  const month=t.slice(0,7);
  const revMonth=appts.filter(a=>a.date.slice(0,7)===month&&paid(a)).reduce((s,a)=>s+a.price,0);
  const customers=DB.scope('customers',shopId);
  const newCustomers=customers.filter(c=>{const first=appts.filter(a=>a.customerId===c.id).sort((x,y)=>x.date.localeCompare(y.date))[0];return first&&first.date.slice(0,7)===month;}).length;
  const returning=customers.filter(c=>appts.filter(a=>a.customerId===c.id&&valid(a)).length>1).length;
  const byStatus={confirmado:0,pendente:0,concluido:0,cancelado:0};
  appts.forEach(a=>byStatus[a.status]!=null&&byStatus[a.status]++);
  const svcCount={};appts.filter(paid).forEach(a=>{const s=DB.find('services',a.serviceId);if(s)svcCount[s.name]=(svcCount[s.name]||0)+1;});
  const topServices=Object.entries(svcCount).sort((a,b)=>b[1]-a[1]);
  const barberCount={};appts.filter(paid).forEach(a=>{const b=DB.find('barbers',a.barberId);if(b)barberCount[b.name]=(barberCount[b.name]||0)+1;});
  const topBarber=Object.entries(barberCount).sort((a,b)=>b[1]-a[1])[0];
  // occupancy estimate: today's booked slots vs capacity
  const barbers=DB.scope('barbers',shopId).filter(b=>b.active);
  let capacity=0;const dow=new Date(t+'T00:00:00').getDay();
  barbers.forEach(b=>{if(b.days.includes(dow))capacity+=Math.max(0,Math.floor((timeToMin(b.end)-timeToMin(b.start)-60)/30));});
  const occupancy=capacity?Math.min(100,Math.round(today.length/capacity*100)):0;
  const days=[],revSeries=[],apptSeries=[],retSeries=[];
  for(let i=6;i>=0;i--){const day=DB.addDays(t,-i);days.push(DOW[new Date(day+'T00:00:00').getDay()]);
    revSeries.push(appts.filter(a=>a.date===day&&paid(a)).reduce((s,a)=>s+a.price,0));
    apptSeries.push(appts.filter(a=>a.date===day&&valid(a)).length);
    retSeries.push(appts.filter(a=>a.date===day&&valid(a)&&customers.find(c=>c.id===a.customerId&&appts.filter(x=>x.customerId===c.id).length>1)).length);}
  return {today,revToday,revMonth,newCustomers,returning,byStatus,topServices,topBarber,occupancy,days,revSeries,apptSeries,retSeries,
    customers:customers.length,upcoming:appts.filter(a=>a.date>=t&&valid(a)).sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time)),appts};
}
function platformAnalytics(){
  const d=DB.get();const t=DB.todayISO();
  const activeShops=d.barbershops.filter(s=>s.status==='active');
  const activeSubs=d.subscriptions.filter(s=>s.status==='active');
  const mrr=activeSubs.reduce((s,x)=>s+x.mrr,0);
  const churn= d.barbershops.length? Math.round(d.barbershops.filter(s=>s.status==='suspended').length/d.barbershops.length*100):0;
  const months=[],mrrSeries=[],shopSeries=[];
  for(let i=5;i>=0;i--){const dt=new Date();dt.setMonth(dt.getMonth()-i);months.push(MON[dt.getMonth()]);
    const factor=1-(i*0.12);mrrSeries.push(Math.round(mrr*factor));shopSeries.push(Math.max(1,Math.round(d.barbershops.length*factor)));}
  const growth=mrrSeries.length>1&&mrrSeries[mrrSeries.length-2]?Math.round((mrrSeries[mrrSeries.length-1]-mrrSeries[mrrSeries.length-2])/mrrSeries[mrrSeries.length-2]*100):0;
  const planRevenue=d.plans.map(p=>{
    const active=activeShops.filter(s=>s.planId===p.id).length;
    const free=d.barbershops.filter(s=>s.planId===p.id&&s.status!=='active').length;
    return {id:p.id,name:p.name,color:p.color,price:p.price,active,free,subtotal:p.price*active};
  }).filter(p=>d.barbershops.some(s=>s.planId===p.id));
  const freeCount=activeShops.filter(s=>s.planId==='free').length;
  const potentialMrr=activeShops.filter(s=>s.planId!=='free').reduce((sum,s)=>{const p=d.plans.find(pl=>pl.id===s.planId);return sum+(p?p.price:0);},0);
  return {totalShops:d.barbershops.length,activeShops:activeShops.length,totalCustomers:d.customers.length,totalAppts:d.appointments.length,
    activeSubs:activeSubs.length,mrr,churn,growth,months,mrrSeries,shopSeries,freeCount,potentialMrr,
    planDist:d.plans.map(p=>({name:p.name,count:d.barbershops.filter(s=>s.planId===p.id).length})),planRevenue};
}
function slugify(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}

/* ============================================================
   ENTITLEMENTS — limites/recursos efetivos por negócio.
   MVP: os planos pagos entregam o mesmo produto atual.
   ============================================================ */
function shopSubscription(shopId){return DB.findBy('subscriptions',s=>s.barbershopId===shopId);}
function courtesyExpiryDate(sub){
  if(!sub||!sub.courtesyExpiresAt)return null;
  if(typeof sub.courtesyExpiresAt==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(sub.courtesyExpiresAt))return new Date(sub.courtesyExpiresAt+'T23:59:59');
  return tsToDate(sub.courtesyExpiresAt);
}
function subscriptionCourtesyActive(sub){
  if(!sub||sub.isCourtesy!==true)return false;
  const status=sub.billingStatus||sub.status||'active';
  if(status!=='active')return false;
  const exp=courtesyExpiryDate(sub);
  return !exp||exp.getTime()>=Date.now();
}
function subscriptionCourtesyExpired(sub){
  if(!sub||sub.isCourtesy!==true)return false;
  const exp=courtesyExpiryDate(sub);
  return !!(exp&&exp.getTime()<Date.now());
}
function shopEntitlements(shopId){
  const shop=DB.find('barbershops',shopId);if(!shop)return null;
  const sub=shopSubscription(shopId)||{};
  if(subscriptionCourtesyActive(sub)){
    return {planId:'courtesy',planName:'Plano Cortesia',isEnterprise:false,isFounder:false,isCourtesy:true,
      monthly:0,annual:0,limitBarbers:999,limitLocations:1,whatsappLimit:0,
      bookingPage:true,customLink:true,unlimitedAppointments:true,services:true,professionals:true,inventory:true,adminPanel:true,support:true,updates:true,
      prioritySupport:false,subStatus:'active',billingStatus:'active',blocked:false};
  }
  const subStatus=sub.billingStatus||sub.status||'active';
  const blocked=subStatus==='past_due'||subStatus==='canceled';
  const subPlan=sub.planType||sub.planId||shop.planId;
  const currentPlanId=subscriptionCourtesyExpired(sub)?'free':(['growth','pro','elite','enterprise'].includes(subPlan)?'monthly':subPlan);
  const plan=DB.find('plans',currentPlanId)||DB.find('plans','free');
  return {planId:currentPlanId,planName:plan.name,isEnterprise:false,isFounder:currentPlanId==='founder',
    monthly:currentPlanId==='annual'?(plan.monthlyEquivalent||12.66):currentPlanId==='founder'?0:plan.price,
    annual:currentPlanId==='annual'?plan.price:currentPlanId==='monthly'?178.80:0,
    limitBarbers:plan.limit_barbers||999,limitLocations:1,whatsappLimit:0,
    bookingPage:!blocked,customLink:true,unlimitedAppointments:!blocked,services:true,professionals:true,inventory:!blocked,adminPanel:true,support:true,updates:true,
    prioritySupport:currentPlanId==='founder',subStatus,billingStatus:subStatus,blocked};
}
const ENT_FEATURES=[['bookingPage','Página profissional','link'],['unlimitedAppointments','Agendamentos ilimitados','calendar'],['services','Serviços','scissors'],['professionals','Profissionais','users'],['adminPanel','Painel administrativo','grid'],['support','Suporte','mail']];

/* ---- Gating de recursos por plano (bloqueado e clicável + upsell) ---- */
const FEATURE_GATE={
  clientes:{need:'crm',plan:'Growth',label:'CRM de clientes'},
  pdv:{need:'inventory',plan:'Pro',label:'PDV / Caixa'},
  estoque:{need:'inventory',plan:'Pro',label:'Estoque'},
  marketing:{need:'marketing',plan:'Pro',label:'Marketing'},
  financeiro:{need:'financial',plan:'Pro',label:'Financeiro'},
  comissoes:{need:'commissions',plan:'Pro',label:'Comissões'},
  ia:{need:'ai',plan:'Elite',label:'Insights de IA'}
};
function hasFeature(shopId,need){
  const e=shopEntitlements(shopId);if(!e)return true;
  return !!e[need];
}
function featureLock(shopId,sub){
  const g=FEATURE_GATE[sub];if(!g||hasFeature(shopId,g.need))return null;
  const e=shopEntitlements(shopId);
  return {label:g.label,plan:e.isEnterprise?'Enterprise':g.plan,enterprise:e.isEnterprise};
}
// Fallback para quando a landing é renderizada dentro do app antes do wizard existir.
if(typeof window.openTrialSignup==='undefined'&&typeof window.openOnboarding!=='function'){
  window.openOnboarding=window.openTrialSignup=function(){
    const u=Session&&Session.effectiveUser;
    if(u&&u.barbershopId){Router.go('#/dashboard/assinatura');return;}
    Router.go('#/signup');
  };
}
function goPricing(){
  closeModal();
  const u=Session.effectiveUser;
  if(u&&u.barbershopId){Router.go('#/dashboard/assinatura');return;}
  if(u){Router.go('#/signup');return;}
  Router.go('#/');
  setTimeout(()=>{const el=document.getElementById('pricing');if(el)el.scrollIntoView({behavior:'smooth'});},280);
}
function stripeReturnSessionId(){
  try{
    const query=(location.hash.split('?')[1]||'').split('#')[0];
    return new URLSearchParams(query).get('session_id')||'';
  }catch(_){return '';}
}
async function confirmStripeReturn(sessionId){
  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let i=0;i<30;i++){
    if(window.__FB_ENABLED&&window.fbConfirmStripeCheckout&&Session&&Session.user)break;
    await sleep(200);
  }
  if(!Session||!Session.user)throw new Error('login-required');
  if(!window.fbConfirmStripeCheckout)throw new Error('checkout-confirm-unavailable');
  return window.fbConfirmStripeCheckout({sessionId});
}
function renderStripeReturn(r){
  const ok=(r&&r.sub)!=='cancel';
  const sessionId=stripeReturnSessionId();
  const title=ok?'Confirmando pagamento...':'Pagamento não concluído';
  const text=ok
    ?'Estamos ativando seu plano no Groomin. Aguarde alguns segundos.'
    :'Você pode voltar ao painel e tentar novamente quando quiser.';
  $('#root').innerHTML=`<header class="topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/')"><span class="logo">${GROOMIN_LOGO}</span><span>Groomin<small>Agendamento online</small></span></div>
    <div class="nav-right"><button class="btn btn-ghost btn-sm" onclick="Router.go('#/login')">Entrar</button></div>
  </div></header>
  <main class="container" style="min-height:calc(100vh - 90px);display:grid;place-items:center;padding:56px 0">
    <section class="empty" style="max-width:760px;width:100%;padding:48px 24px;border:1px solid var(--border);border-radius:28px;background:var(--surface);box-shadow:var(--shadow)">
      <div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon(ok?'loader':'x')}</div>
      <h3>${escapeHtml(title)}</h3>
      <p style="max-width:560px;margin:0 auto 20px">${escapeHtml(text)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        ${ok?'':`<button class="btn btn-primary" onclick="Router.go('#/dashboard/assinatura')">${icon('rocket')} Ver planos</button><button class="btn btn-ghost" onclick="Router.go('#/')">Voltar ao início</button>`}
      </div>
    </section>
  </main>`;
  if(!ok)return;
  const card=$('#root .empty');
  if(!sessionId){
    card.innerHTML=`<div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon('alert-circle')}</div>
      <h3>Pagamento recebido</h3>
      <p style="max-width:560px;margin:0 auto 20px">Não recebemos o código da sessão para ativar automaticamente. Entre no painel e escolha o plano novamente, ou fale com o suporte.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn btn-primary" onclick="Router.go('#/dashboard/assinatura')">Ir para assinatura</button></div>`;
    return;
  }
  confirmStripeReturn(sessionId).then(()=>{
    if(typeof toast==='function')toast('Plano ativado com sucesso.','ok');
    setTimeout(()=>Router.go('#/dashboard/assinatura'),350);
  }).catch((err)=>{
    console.warn('[Groomin] Stripe return confirmation failed:',err);
    card.innerHTML=`<div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon('alert-circle')}</div>
      <h3>Pagamento recebido</h3>
      <p style="max-width:560px;margin:0 auto 20px">O Stripe confirmou o pagamento, mas não conseguimos ativar o plano automaticamente nesta sessão. Faça login com o dono do negócio e tente abrir Assinatura novamente.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn btn-primary" onclick="Router.go('#/dashboard/assinatura')">Ir para assinatura</button><button class="btn btn-ghost" onclick="Router.go('#/login')">Entrar</button></div>`;
  });
}
function showUpgrade(label,plan,enterprise){
  const ctaEnt=enterprise===true||enterprise==='true';
  const u=Session.effectiveUser;
  const canSub=u&&(u.role==='owner'||u.role==='manager');
  const upgradeCTA=ctaEnt
    ?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener" onclick="closeModal()">${icon('whatsapp')} Falar com vendas</a>`
    :canSub
      ?`<button class="btn btn-primary" onclick="closeModal();Router.go('#/dashboard/assinatura')">${icon('creditCard')} Ver minha assinatura</button>`
      :`<button class="btn btn-primary" onclick="goPricing()">${icon('rocket')} Conhecer o plano ${escapeHtml(plan)}</button>`;
  openModal(`<div class="modal-head"><div><h3>${icon('lock')} ${escapeHtml(label)}</h3><div class="sub">${ctaEnt?'Recurso não incluído no seu contrato':'Disponível em um plano superior'}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="insight" style="border-left-color:var(--primary);margin-bottom:14px"><span class="ii">${icon('sparkle')}</span><div><b>${escapeHtml(label)} ${ctaEnt?'pode ser liberado no seu plano Enterprise':'faz parte do plano '+escapeHtml(plan)}</b><p>${ctaEnt?'Fale com o seu contato comercial para incluir este recurso ao seu contrato sob medida.':'Desbloqueie este e outros recursos para crescer sua barbearia. Sem fidelidade — faça upgrade quando quiser.'}</p></div></div>
    ${ctaEnt?'':`<div class="muted" style="font-size:13.5px">No <b>${escapeHtml(plan)}</b> você também ganha mais profissionais, relatórios e automações.</div>`}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Agora não</button>${upgradeCTA}</div>`);
}
function lockedFeaturePage(label,plan,enterprise){
  const u=Session.effectiveUser;
  const canManageSub=u&&(u.role==='owner'||u.role==='manager');
  const cta=enterprise
    ?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener">${icon('whatsapp')} Falar com vendas</a>`
    :canManageSub
      ?`<button class="btn btn-primary" onclick="Router.go('#/dashboard/assinatura')">${icon('creditCard')} Ver minha assinatura</button>`
      :`<button class="btn btn-primary" onclick="goPricing()">${icon('rocket')} Conhecer o plano ${escapeHtml(plan)}</button>`;
  return `<div class="empty" style="padding:64px 20px"><div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon('lock')}</div>
    <h3>${escapeHtml(label)} ${enterprise?'não está incluído no seu contrato':'faz parte do plano '+escapeHtml(plan)}</h3>
    <p style="max-width:460px;margin:0 auto 20px">${enterprise?'Fale com o seu contato comercial para incluir este recurso ao seu plano Enterprise.':'Desbloqueie '+escapeHtml(label.toLowerCase())+' e leve sua gestão para o próximo nível. Você pode fazer upgrade quando quiser, sem fidelidade.'}</p>
    ${cta}</div>`;
}

/* ============================================================
   LANDING PAGE (sells the SaaS to barbershop owners)
   ============================================================ */
function lscroll(id){$('#lnav').classList.remove('mobile-open');const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth'});}

function renderLanding(){
  const d=DB.get();
  const demoCta=window.USE_FIREBASE?'':`<button class="btn btn-ghost" onclick="openDemo()">${icon('play')} Ver Demonstração</button>`;
  $('#root').innerHTML=landingTopbar()+`
  <main>
    <section class="hero"><div class="container hero-grid">
      <div>
        <span class="eyebrow">${icon('sparkle')} A plataforma all-in-one para barbearias</span>
        <h1>Transforme sua Barbearia com uma <span class="grad">Plataforma Completa de Gestão</span></h1>
        <p class="lead">Crie uma página profissional, compartilhe seu link e receba agendamentos sem complicar sua rotina.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar conta</button>
          ${demoCta}
        </div>
        <div class="hero-stats">
          <div class="s"><b>+1.200</b><span>Barbearias usando</span></div>
          <div class="s"><b>98%</b><span>Satisfação</span></div>
          <div class="s"><b>4.9★</b><span>Avaliação média</span></div>
        </div>
      </div>
      <div class="hero-visual">
        <div class="hero-card">
          <div class="hc-top"><div><b style="font-family:var(--font-display);font-size:16px">Painel do dia</b><div class="muted" style="font-size:12.5px">Barbearia do João · hoje</div></div><span class="badge ok">Ao vivo</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="mini-stat" style="margin:0"><span class="mi">${icon('calendar')}</span><div><b>12</b><span>Agend. hoje</span></div></div>
            <div class="mini-stat" style="margin:0"><span class="mi">${icon('dollar')}</span><div><b>R$ 740</b><span>Receita hoje</span></div></div>
          </div>
          <div class="mini-bars">${[40,65,52,80,72,90,60].map(h=>`<div class="b" style="height:${h}%"></div>`).join('')}</div>
          <div class="mini-slot" style="margin:0"><span class="ic">${icon('bell')}</span><div><b>Novo agendamento</b><br><small>Carlos E. — Corte + Barba, hoje às 09:30.</small></div></div>
        </div>
        <div class="float-badge fb1"><span class="dot" style="background:var(--success)"></span>Página no ar em 5 minutos</div>
        <div class="float-badge fb2">${icon('calendar')} Agendamentos 24h pelo link</div>
      </div>
    </div></section>

    <div class="container"><div class="logo-row">
      ${['Barbearias','Salões','Studios','Clínicas','Consultórios','Personal trainers'].map(n=>`<span>${n}</span>`).join('')}
    </div></div>

    <section id="benefits"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('award')} Por que o Groomin</span><h2>Mais agendamentos, menos trabalho manual</h2><p>Uma plataforma pensada para o dono da barbearia que quer crescer com previsibilidade.</p></div>
      <div class="feature-grid">
        ${[['trending','Aumente o faturamento','Receba agendamentos 24h pelo seu link, mesmo fora do horário de atendimento.'],
           ['clock','Economize horas','Agenda automática, sem WhatsApp manual e sem livro de papel.'],
           ['users','Organize seu atendimento','Veja clientes e horários em um só lugar.'],
           ['cpu','Comece simples','Use o essencial agora e evolua quando fizer sentido.'],
           ['dollar','Página profissional','Divulgue um link bonito e confiável para seus clientes.'],
           ['shield','Seguro e na nuvem','Seus dados protegidos, acesse de qualquer lugar e dispositivo.']
        ].map(([i,t,p])=>`<div class="feature"><div class="f-ic">${icon(i)}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="features" style="background:var(--bg-2)"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('layers')} Recursos</span><h2>Tudo em uma plataforma só</h2></div>
      ${landingBench('grid','Dashboard inteligente','Acompanhe em tempo real os números que importam: agendamentos do dia, receita, ocupação, clientes novos e recorrentes.',['Métricas e gráficos em tempo real','Receita do dia e do mês','Taxa de ocupação e retenção','Ranking de serviços e barbeiros'],dashShot(),false)}
      ${landingBench('calendar','Agenda online sem conflitos','Sistema de agendamento que impede overbooking e respeita horários, almoço e folgas de cada profissional.',['Visões dia, semana e mês','Bloqueio de horários e dias','Múltiplos barbeiros e férias','Prevenção de agendamento duplo'],schedShot(),true)}
      ${landingBench('heart','Página pública profissional','Mostre sua marca, serviços, profissionais e horários disponíveis em um link fácil de compartilhar.',['Link para Instagram e WhatsApp','Serviços com preço e duração','Profissionais e horários','Experiência simples para o cliente'],crmShot(),false)}
      ${landingBench('box','Configuração rápida','Cadastre o essencial da sua operação sem precisar montar um site do zero.',['Dados do negócio','Serviços principais','Equipe e horários','Página pronta para divulgar'],invShot(),true)}
      ${landingBench('cpu','Base preparada para crescer','Módulos avançados ficam preservados para próximas fases, sem atrapalhar o MVP.',['Arquitetura multi-tenant','Firebase ativo','PWA instalado','Expansão futura controlada'],aiShot(),false)}
    </div></section>

    <section><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('star')} Oferta de lançamento</span><h2>Seja um Cliente Fundador</h2><p>Vagas limitadas para quem quer apoiar o lançamento do Groomin e garantir condições que não vão se repetir.</p></div>
      <div class="panel" style="max-width:720px;margin:0 auto;padding:32px;border-color:var(--primary);background:linear-gradient(135deg,rgba(124,58,237,.08),transparent),var(--surface)">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><b style="font-size:34px">R$ 990</b><span class="muted">pagamento único</span><span class="badge gold">Oferta exclusiva</span></div>
        <ul style="margin:18px 0;padding-left:0;list-style:none;display:grid;gap:10px">
          ${['Sem mensalidade enquanto o Groomin permanecer em operação','Todas as funcionalidades atuais da plataforma','Suporte prioritário e canal direto com o fundador','Prioridade para testar novos recursos','Badge exclusivo de Cliente Fundador'].map(f=>`<li style="display:flex;gap:10px;align-items:flex-start"><span style="color:var(--primary);flex-shrink:0">${icon('check')}</span><span>${f}</span></li>`).join('')}
        </ul>
        <button class="btn btn-primary btn-lg" onclick="openTrialSignup('founder')">${icon('rocket')} Quero ser Fundador</button>
      </div>
    </div></section>

    <section id="pricing" style="background:var(--bg-2)"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('creditCard')} Planos</span><h2>Escolha o plano que faz sua barbearia crescer</h2><p>Escolha seu plano e atualize quando quiser. Economize até 25% no plano anual.</p></div>
      <div id="pricingWrap">${pricingInner()}</div>
    </div></section>

    <section id="faq"><div class="container" style="max-width:820px">
      <div class="section-head"><span class="eyebrow">${icon('inbox')} Dúvidas</span><h2>Perguntas frequentes</h2></div>
      ${[['Preciso instalar algo?','Não. O Groomin é 100% na nuvem. Você acessa pelo navegador no computador ou celular.'],
         ['Como funciona a criação da conta?','Você escolhe um plano, cria sua conta em segundos, recebe seu link público e já pode receber agendamentos.'],
         ['Meus clientes precisam criar conta?','Não. Eles agendam direto pelo seu link informando nome, WhatsApp e e-mail. A conta só é necessária se quiserem gerenciar os próprios horários.'],
         ['Posso ter vários barbeiros?','Sim. Cada plano suporta um número de profissionais, com horários, comissões e férias individuais.'],
         ['Como recebo os agendamentos?','Notificações no painel, e-mail e WhatsApp (templates prontos e personalizáveis).']
      ].map((f,i)=>`<div class="faq-item" onclick="this.classList.toggle('open')"><div class="faq-q">${f[0]} ${icon('plus')}</div><div class="faq-a"><div>${f[1]}</div></div></div>`).join('')}
    </div></section>

    <div class="cta-band" id="contato">
      <span class="eyebrow">${icon('rocket')} Pronto para crescer?</span>
      <h2>Comece a transformar sua barbearia hoje</h2>
      <p>Crie sua conta e tenha seu link de agendamentos em menos de 2 minutos.</p>
      <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar conta</button>
    </div>
  </main>
  ${landingFooter()}`;
}

/* Landing V2: focused on fast professional booking pages. */
function renderLanding(){
  const demoCta=window.USE_FIREBASE?'':`<button class="btn btn-ghost" onclick="openDemo()">${icon('play')} Ver demonstração</button>`;
  $('#root').innerHTML=landingTopbar()+`
  <main class="lp">
    <section class="lp-hero"><div class="container lp-hero-grid">
      <div class="lp-copy">
        <span class="eyebrow">${icon('sparkle')} Simples como mandar um link</span>
        <h1>Sua página profissional de agendamento em menos de 5 minutos.</h1>
        <p class="lead">Crie um link bonito para seus clientes escolherem serviço, profissional e horário. Sem planilhas, sem troca infinita de mensagens, sem complicar sua rotina.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
          ${demoCta}
        </div>
        <div class="lp-proof">
          <span>${icon('check')} Link pronto no cadastro</span>
          <span>${icon('check')} Funciona no Instagram e WhatsApp</span>
          <span>${icon('check')} Agenda organizada automaticamente</span>
        </div>
      </div>
      <div class="lp-stage" aria-hidden="true">
        <div class="lp-orbit one"></div><div class="lp-orbit two"></div>
        <div class="lp-browser">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>groomin.com.br/barbearia</span></div>
          <div class="lp-page-preview">
            <div class="lp-cover"></div>
            <div class="lp-shop-head">
              <div class="lp-avatar">G</div><div><b>Groom Studio</b><small>Agenda online</small></div>
            </div>
            <div class="lp-service-row"><span>${icon('scissors')}</span><div><b>Corte Masculino</b><small>30 min · R$ 45</small></div><strong>09:30</strong></div>
            <div class="lp-service-row"><span>${icon('user')}</span><div><b>Barba</b><small>30 min · R$ 35</small></div><strong>10:00</strong></div>
            <div class="lp-slots">${['11:00','11:30','14:00','14:30','16:00','17:30'].map((t,i)=>`<span class="${i===3?'on':''}">${t}</span>`).join('')}</div>
            <button class="lp-confirm">Confirmar agendamento</button>
          </div>
        </div>
        <div class="lp-phone">
          <div class="lp-phone-notch"></div>
          <div class="lp-chat"><b>Cliente</b><span>Tem horário hoje?</span></div>
          <div class="lp-chat me"><b>Você</b><span>Claro. Agende por aqui:</span><em>groomin.com.br/groom</em></div>
          <div class="lp-check">${icon('check')} Novo horário confirmado</div>
        </div>
      </div>
    </div></section>

    <section id="businesses" class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('building')} Negócios atendidos</span><h2>Para quem vive de agenda cheia.</h2><p>Comece simples: uma página, seus serviços, seus horários e um link para divulgar.</p></div>
      <div class="lp-business-grid">
        ${[
          ['scissors','Barbearias','Cortes, barba, sobrancelha e pacotes rápidos.'],
          ['star','Salões','Escova, coloração, manicure, estética e combos.'],
          ['heart','Estúdios de beleza','Design de sobrancelha, lash, nails e atendimento premium.'],
          ['calendar','Profissionais independentes','Agenda própria, link pessoal e controle sem recepção.']
        ].map(([i,t,p])=>`<div class="lp-business"><span>${icon(i)}</span><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="product"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('layers')} Produto</span><h2>Uma presença profissional sem construir um site.</h2><p>O cliente vê sua marca, escolhe o serviço e agenda em poucos toques.</p></div>
      <div class="lp-product-grid">
        <div class="lp-mock-card large">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>Página pública</span></div>
          <div class="lp-public-shot">
            <div><span class="badge gold">Aberto hoje</span><h3>Groom Studio</h3><p>Agenda online para cortes, barba e cuidados.</p></div>
            <div class="lp-shot-list">${['Corte Masculino','Corte + Barba','Sobrancelha'].map((x,i)=>`<div><span>${icon(i===0?'scissors':i===1?'star':'eye')}</span><b>${x}</b><small>${i===0?'30 min':i===1?'60 min':'15 min'}</small></div>`).join('')}</div>
          </div>
        </div>
        <div class="lp-mock-card">
          <h3>${icon('calendar')} Agenda clara</h3>
          <p>Horários disponíveis aparecem automaticamente para o cliente.</p>
          <div class="lp-mini-calendar">${['09:00','09:30','10:00','10:30','11:00','14:00','14:30','15:00'].map((t,i)=>`<span class="${i===5?'on':''}">${t}</span>`).join('')}</div>
        </div>
        <div class="lp-mock-card">
          <h3>${icon('link')} Link compartilhável</h3>
          <p>Use na bio do Instagram, botão do WhatsApp ou QR Code no balcão.</p>
          <div class="lp-url-pill">groomin.com.br/groom-studio</div>
        </div>
      </div>
    </div></section>

    <section id="how" class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('clock')} Como funciona</span><h2>Do cadastro ao primeiro agendamento, sem curva de aprendizado.</h2></div>
      <div class="lp-steps">
        ${[
          ['01','Crie sua conta','Informe o nome do negócio, telefone e horário de funcionamento.'],
          ['02','Cadastre serviços','Adicione duração, preço e profissionais disponíveis.'],
          ['03','Compartilhe o link','Cole na bio, mande no WhatsApp ou imprima um QR Code.'],
          ['04','Receba agendamentos','A agenda fica organizada e você acompanha tudo no painel.']
        ].map(([n,t,p])=>`<div class="lp-step"><span>${n}</span><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="pricing"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('creditCard')} Planos</span><h2>Comece pequeno. Cresça quando fizer sentido.</h2><p>Planos simples para publicar sua página, receber agendamentos e organizar sua operação.</p></div>
      <div id="pricingWrap">${pricingInner()}</div>
    </div></section>

    <section id="faq"><div class="container" style="max-width:820px">
      <div class="section-head"><span class="eyebrow">${icon('inbox')} Dúvidas</span><h2>Perguntas frequentes</h2></div>
      ${[['Preciso criar um site?','Não. O Groomin cria uma página profissional de agendamento para você divulgar imediatamente.'],
         ['Meus clientes precisam baixar aplicativo?','Não. Eles abrem o link no navegador, escolhem serviço e horário, e confirmam o agendamento.'],
         ['Funciona para Instagram e WhatsApp?','Sim. O link pode ir na bio, em mensagens, cartões, QR Code ou campanhas.'],
         ['Consigo usar com mais de um profissional?','Sim. Você cadastra profissionais, serviços e horários individuais conforme o plano.'],
         ['Posso começar simples?','Sim. A ideia é publicar rápido e evoluir depois para módulos avançados.']
      ].map(f=>`<div class="faq-item" onclick="this.classList.toggle('open')"><div class="faq-q">${f[0]} ${icon('plus')}</div><div class="faq-a"><div>${f[1]}</div></div></div>`).join('')}
    </div></section>

    <div class="cta-band lp-final-cta" id="contato">
      <span class="eyebrow">${icon('rocket')} Pronto para publicar?</span>
      <h2>Sua página de agendamento pode estar no ar ainda hoje.</h2>
      <p>Comece pelo essencial: um link bonito, horários claros e menos mensagens manuais.</p>
      <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
    </div>
  </main>
  ${landingFooter()}`;
}
function landingBench(ic,title,desc,bullets,shot,rev){return `
  <div class="bench ${rev?'rev':''}">
    <div class="bench-txt"><span class="eyebrow">${icon(ic)} ${escapeHtml(title)}</span><h3>${escapeHtml(title)}</h3><p class="muted" style="font-size:15.5px">${escapeHtml(desc)}</p>
      <ul>${bullets.map(b=>`<li>${icon('check')} ${escapeHtml(b)}</li>`).join('')}</ul></div>
    <div class="bench-shot"><div class="shot-bar"><i></i><i></i><i></i></div><div class="shot-body">${shot}</div></div>
  </div>`;}
function dashShot(){return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
  <div class="mini-stat" style="margin:0"><span class="mi">${icon('calendar')}</span><div><b>12</b><span>Hoje</span></div></div>
  <div class="mini-stat" style="margin:0"><span class="mi">${icon('dollar')}</span><div><b>R$ 740</b><span>Receita</span></div></div></div>
  <div class="mini-bars">${[50,70,45,82,60,90,75].map(h=>`<div class="b" style="height:${h}%"></div>`).join('')}</div>`;}
function schedShot(){return `<div class="kpi-list">${[['09:30','Corte + Barba','b'],['10:00','Corte Masculino','w'],['11:00','Barba','b'],['14:30','Pigmentação','b']].map(r=>`<div class="cal-event ${r[2]==='w'?'s-pendente':''}" style="margin-bottom:6px"><b>${r[0]} · ${r[1]}</b><small>Rafael Moura</small></div>`).join('')}</div>`;}
function crmShot(){return `${[['Pedro Henrique','VIP · R$ 980 gastos','gold'],['André Lima','Inativo há 45 dias','warn'],['Carlos Eduardo','Frequente · 8 visitas','ok']].map(r=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('user')}</span><div><b>${r[0]}</b><br><small>${r[1]}</small></div><span class="badge ${r[2]}" style="margin-left:auto">${r[2]==='gold'?'VIP':r[2]==='warn'?'Inativo':'Fiel'}</span></div>`).join('')}`;}
function invShot(){return `${[['Pomada Modeladora',24,'ok'],['Shampoo Premium',5,'danger'],['Óleo para Barba',18,'ok'],['Gel Fixador',3,'danger']].map(r=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('box')}</span><div><b>${r[0]}</b><br><small>${r[1]} em estoque</small></div>${r[2]==='danger'?`<span class="badge danger" style="margin-left:auto">Baixo</span>`:`<span class="badge ok" style="margin-left:auto">OK</span>`}</div>`).join('')}`;}
function aiShot(){return `${[['warn','Terça com baixa ocupação','Considere criar uma promoção de meio de semana.'],['ok','Barbeiro Rafael em alta','40% mais demanda que a média — avalie aumentar a agenda.'],['warn','Cliente João sumiu','Sem retorno há 45 dias — envie campanha de reativação.']].map(r=>`<div class="insight ${r[0]}" style="margin-bottom:8px;padding:13px"><span class="ii">${icon('cpu')}</span><div><b>${r[1]}</b><p>${r[2]}</p></div></div>`).join('')}`;}
let billingPeriod='annual';
function setBilling(p){billingPeriod=p;const el=document.getElementById('pricingWrap');if(el)el.innerHTML=pricingInner();}
function planMonthly(p,period){const b=DB.get().billing[period||billingPeriod];return p.price*(1-b.discount);}
function pricingInner(){
  const d=DB.get();const b=d.billing;
  const toggle=`<div style="display:flex;justify-content:center;margin-bottom:8px"><div class="seg" style="flex-wrap:nowrap">${Object.entries(b).map(([k,v])=>`<button class="${billingPeriod===k?'on':''}" onclick="setBilling('${k}')">${v.label}${v.discount?` <span style="font-size:10px;opacity:.85">-${Math.round(v.discount*100)}%</span>`:''}</button>`).join('')}</div></div>
    <p class="muted" style="text-align:center;font-size:13px;margin-bottom:26px">${billingPeriod==='monthly'?'Cobrança mensal · cancele quando quiser':`Pagando ${b[billingPeriod].label.toLowerCase()} você economiza ${Math.round(b[billingPeriod].discount*100)}% — valores já com desconto`}</p>`;
  const grid=`<div class="pricing-grid">${d.plans.filter(p=>!p.enterprise&&p.id!=='free').map(p=>landingPlanCard(p)).join('')}</div>`;
  return toggle+grid+comparisonTable()+enterpriseTeaser();
}
function landingPlanCard(p){
  const featured=p.id==='pro';const elite=p.id==='elite';
  const period=DB.get().billing[billingPeriod];
  const eff=planMonthly(p);const totalPeriod=eff*period.months;const savings=(p.price-eff)*period.months;
  const priceBlock=`<div class="pc-price">R$ ${eff.toLocaleString('pt-BR',{minimumFractionDigits:eff%1?2:0,maximumFractionDigits:2})}<small>/mês</small></div>
       <div class="pc-bill muted">${billingPeriod==='monthly'?`cobrado mensalmente`:`${money(totalPeriod)} a cada ${period.months} meses`}</div>
       ${savings>0?`<div class="pc-save">${icon('trending')} Economize ${money(savings)}</div>`:''}`;
  return `<div class="price-card ${featured?'featured':''}">
    ${p.badge?`<span class="pc-tag">${escapeHtml(p.badge)}</span>`:''}
    <h3>${escapeHtml(p.name)}</h3>
    ${priceBlock}
    <div class="pc-desc">${escapeHtml(p.tagline||'')}</div>
    <ul>${p.features.map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}${(p.notIncluded||[]).slice(0,3).map(f=>`<li class="off">${icon('x')} ${escapeHtml(f)}</li>`).join('')}</ul>
    <button class="btn ${featured?'btn-primary':elite?'btn-primary':'btn-outline'} btn-block" onclick="openTrialSignup('${p.id}')">Escolher ${escapeHtml(p.name)}</button>
    <p class="muted" style="text-align:center;font-size:11.5px;margin-top:10px">Sem fidelidade</p>
  </div>`;
}
const PRICING_MATRIX=[
  ['Profissionais',['1','Até 3','Até 8','Ilimitado']],
  ['Agendamentos / mês',['50','Ilimitado','Ilimitado','Ilimitado']],
  ['Página pública de agendamento',[true,true,true,true]],
  ['Serviços cadastrados',['Essenciais','Ilimitados','Ilimitados','Ilimitados']],
  ['Horários por profissional',[true,true,true,true]],
  ['Link para Instagram e WhatsApp',[true,true,true,true]],
  ['Bloqueios de agenda',[false,true,true,true]],
  ['Fotos na página pública',[false,false,true,true]],
  ['Prioridade em novos recursos',[false,false,true,true]],
  ['Suporte',['Comunidade','E-mail','Prioritário','Prioritário VIP']]
];
function cmpCell(v){
  if(v===true)return `<span class="cmp-yes">${icon('check')}</span>`;
  if(v===false)return `<span class="cmp-no">${icon('x')}</span>`;
  return `<b>${escapeHtml(String(v))}</b>`;
}
function enterpriseTeaser(){
  return `<div class="card" style="margin-top:30px;padding:28px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;background:linear-gradient(120deg,rgba(124,58,237,.10),transparent 70%),var(--surface)">
    <div style="flex:1;min-width:260px"><span class="badge gold">${icon('building')} Enterprise · Sob medida</span>
      <h3 style="font-size:22px;margin:12px 0 6px">Tem uma rede ou necessidade específica?</h3>
      <p class="muted" style="font-size:14.5px;max-width:520px">Plano Enterprise com preço e limites personalizados para operações com alto volume de profissionais, agenda e suporte.</p></div>
    <button class="btn btn-primary" onclick="openModal(enterpriseContactModal())">${icon('mail')} Falar com vendas</button>
  </div>`;
}
function enterpriseContactModal(){return `<div class="modal-head"><div><h3>Plano Enterprise</h3><div class="sub">Atendimento consultivo para sua operação</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><p class="muted" style="margin-bottom:14px">Conte um pouco sobre sua operação e montamos um plano sob medida para volume de profissionais, agenda e suporte.</p>
  ${ENT_FEATURES.map(f=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon(f[2])}</span><div><b>${f[1]}</b></div><span class="badge gold" style="margin-left:auto">incluível</span></div>`).join('')}
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fechar</button><a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener" onclick="closeModal()">${icon('whatsapp')} Chamar no WhatsApp</a></div>`;}
function comparisonTable(){
  const plans=DB.get().plans.filter(p=>!p.enterprise&&p.id!=='free');
  return `<div style="margin-top:46px"><div class="section-head" style="margin-bottom:24px"><h2 style="font-size:clamp(1.5rem,3vw,2rem)">Compare os planos em detalhe</h2></div>
  <div class="table-wrap cmp-wrap"><table class="cmp"><thead><tr><th>Recursos</th>${plans.map(p=>`<th class="${p.id==='pro'?'cmp-feat':''}">${escapeHtml(p.name)}${p.badge?`<span class="badge gold" style="display:block;margin-top:5px;font-size:9px">${escapeHtml(p.badge)}</span>`:''}<div style="font-family:var(--font-sans);font-weight:700;font-size:13px;margin-top:4px;color:var(--text)">R$ ${Math.round(planMonthly(p))}/mês</div></th>`).join('')}</tr></thead>
  <tbody>${PRICING_MATRIX.map(row=>`<tr><td style="text-align:left">${escapeHtml(row[0])}</td>${row[1].slice(1).map((v,i)=>`<td class="${plans[i]&&plans[i].id==='pro'?'cmp-feat':''}">${cmpCell(v)}</td>`).join('')}</tr>`).join('')}
  <tr><td></td>${plans.map(p=>`<td class="${p.id==='pro'?'cmp-feat':''}"><button class="btn ${p.id==='pro'?'btn-primary':'btn-outline'} btn-sm" onclick="openTrialSignup('${p.id}')">Escolher</button></td>`).join('')}</tr>
  </tbody></table></div></div>`;
}
function landingFooter(){return `<footer class="site"><div class="container">
  <div class="foot-grid">
    <div><div class="brand" style="margin-bottom:14px"><span class="logo">${GROOMIN_LOGO}</span><span>Groomin</span></div>
      <p class="muted" style="font-size:14px;max-width:300px">Página profissional de agendamento para negócios que vivem de horário marcado.</p></div>
    <div><h4>Produto</h4><a onclick="lscroll('businesses')">Negócios</a><a onclick="lscroll('product')">Produto</a><a onclick="lscroll('how')">Como funciona</a></div>
    <div><h4>Empresa</h4><a onclick="lscroll('pricing')">Planos</a><a onclick="lscroll('faq')">FAQ</a><a onclick="Router.go('#/login')">Entrar</a></div>
    <div><h4>Comece agora</h4><a onclick="openOnboarding('growth')">Criar página</a>${window.USE_FIREBASE?'':`<a onclick="openDemo()">Demonstração</a>`}<a href="mailto:contato.groominbarber@gmail.com">contato.groominbarber@gmail.com</a></div>
  </div>
  <div class="foot-bottom"><span>© 2026 Groomin. Todos os direitos reservados.</span><span>Agendamento simples, presença profissional.</span></div>
</div></footer>`;}

function openDemo(){
  if(window.USE_FIREBASE){openTrialSignup('trial');return;} // em produção: criar conta real
  openModal(`<div class="modal-head"><div><h3>Acesse a demonstração</h3><div class="sub">Entre com uma conta de exemplo</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <p class="muted" style="margin-bottom:14px">Escolha um perfil para explorar a plataforma com dados de demonstração:</p>
    <div class="role-demos">
      <button class="role-demo" onclick="demoLogin('super@groomin.com.br')"><b>Super Admin</b>Painel da plataforma</button>
      <button class="role-demo" onclick="demoLogin('joao@barbeariadojoao.com')"><b>Proprietário</b>Gestão da barbearia</button>
      <button class="role-demo" onclick="demoLogin('rafael@barbeariadojoao.com')"><b>Barbeiro</b>Minha agenda</button>
      <button class="role-demo" onclick="demoLogin('cliente@email.com')"><b>Cliente</b>Meus agendamentos</button>
    </div>
    <div class="divider">ou veja uma página pública</div>
    <button class="btn btn-ghost btn-block" onclick="closeModal();Router.go('#/barbearia-do-joao')">${icon('eye')} Ver página da Barbearia do João</button>
  </div>`);
}
function demoLogin(email){
  const map={'super@groomin.com.br':'super123','joao@barbeariadojoao.com':'owner123','rafael@barbeariadojoao.com':'barber123','cliente@email.com':'cliente123'};
  const u=Session.login(email,map[email]);closeModal();
  if(u){toast(`Bem-vindo, ${u.name.split(' ')[0]}!`,'ok');location.hash=homeRouteFor(u.role);}
}

/* Landing V3: SaaS premium conversion page. */
function renderLanding(){
  $('#root').innerHTML=landingTopbar()+`
  <main class="lp lp-saas">
    <section class="lp-hero"><div class="container lp-hero-grid">
      <div class="lp-copy">
        <span class="eyebrow">${icon('sparkle')} Página própria, agenda automática</span>
        <h1>Crie sua página profissional de agendamentos em menos de 5 minutos.</h1>
        <p class="lead">Compartilhe apenas um link e permita que seus clientes agendem horários online, sem precisar responder mensagens o dia inteiro.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
          <button class="btn btn-ghost" onclick="lscroll('demo')">${icon('play')} Ver demonstração</button>
        </div>
        <div class="lp-proof">
          <span>${icon('check')} Sem aplicativo para o cliente</span>
          <span>${icon('check')} Teste grátis sem cartão</span>
          <span>${icon('check')} Link exclusivo do seu negócio</span>
        </div>
      </div>
      <div class="lp-stage lp-saas-stage" aria-label="Mockup do Groomin">
        <div class="lp-browser">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>groomin.com.br/minhabarbearia</span></div>
          <div class="lp-page-preview">
            <div class="lp-cover"></div>
            <div class="lp-shop-head"><div class="lp-avatar">G</div><div><b>Groom Studio</b><small>Página pública</small></div></div>
            <div class="lp-service-row"><span>${icon('scissors')}</span><div><b>Corte + Barba</b><small>60 min · R$ 75</small></div><strong>14:00</strong></div>
            <div class="lp-service-row"><span>${icon('user')}</span><div><b>Rafael</b><small>Profissional disponível</small></div><strong>Hoje</strong></div>
            <div class="lp-slots">${['09:00','10:30','14:00','15:30','17:00','18:00'].map((t,i)=>`<span class="${i===2?'on':''}">${t}</span>`).join('')}</div>
            <button class="lp-confirm">Agendar horário</button>
          </div>
        </div>
        <div class="lp-phone">
          <div class="lp-phone-notch"></div>
          <div class="lp-chat"><b>Instagram</b><span>Link na bio aberto pelo cliente.</span></div>
          <div class="lp-chat me"><b>Groomin</b><span>Novo agendamento confirmado.</span><em>14:00 · Corte + Barba</em></div>
          <div class="lp-check">${icon('check')} Agenda atualizada</div>
        </div>
      </div>
    </div></section>

    <section id="benefits"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('award')} Benefícios</span><h2>Menos mensagens. Mais horários preenchidos.</h2><p>O básico que todo negócio com agenda precisa, com aparência profissional desde o primeiro dia.</p></div>
      <div class="lp-benefit-grid">
        ${[
          ['clock','Agendamentos 24 horas por dia','Seu cliente escolhe horário mesmo fora do expediente.'],
          ['link','Link exclusivo para seu negócio','Use groomin.com.br/seunegocio em qualquer canal.'],
          ['instagram','Instagram e WhatsApp','Cole na bio, envie em conversas ou use em QR Code.'],
          ['check','Confirmação automática','O cliente agenda sem depender de resposta manual.'],
          ['users','Organize sua equipe','Serviços, profissionais e horários em um só painel.'],
          ['home','Celular e computador','Funciona direto no navegador, sem instalar nada.']
        ].map(([i,t,p])=>`<div class="feature"><div class="f-ic">${icon(i)}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="how" class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('list')} Como funciona</span><h2>Da conta criada ao link publicado em poucos passos.</h2></div>
      <div class="lp-flow">
        ${[
          ['01','Crie sua conta.'],
          ['02','Configure seu negócio.'],
          ['03','Cadastre serviços e profissionais.'],
          ['04','Compartilhe seu link.'],
          ['05','Receba agendamentos automaticamente.']
        ].map(([n,t])=>`<div class="lp-flow-step"><span>${n}</span><b>${t}</b></div>`).join('')}
      </div>
    </div></section>

    <section id="demo"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('layers')} Demonstração</span><h2>Uma experiência completa para o dono e simples para o cliente.</h2><p>Página pública, agenda, dashboard e perfil do negócio conectados no mesmo fluxo.</p></div>
      <div class="lp-demo-grid">
        <div class="lp-mock-card large">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>Página pública</span></div>
          <div class="lp-public-shot"><div><span class="badge gold">Aberto hoje</span><h3>Studio Bella</h3><p>Serviços, profissionais, horários e contato em uma página pronta para divulgar.</p></div><div class="lp-shot-list">${['Design de sobrancelha','Manicure em gel','Extensão de cílios'].map((x,i)=>`<div><span>${icon(i===0?'eye':i===1?'sparkle':'heart')}</span><b>${x}</b><small>${i===0?'30 min':i===1?'75 min':'90 min'}</small></div>`).join('')}</div></div>
        </div>
        <div class="lp-mock-card"><h3>${icon('calendar')} Agenda</h3><p>Horários livres aparecem para o cliente e conflitos são bloqueados automaticamente.</p><div class="lp-mini-calendar">${['09:00','10:00','11:00','14:00','15:00','16:00'].map((t,i)=>`<span class="${i===3?'on':''}">${t}</span>`).join('')}</div></div>
        <div class="lp-mock-card"><h3>${icon('grid')} Dashboard</h3><p>Veja agendamentos, clientes e receita simples do dia, semana e mês.</p><div class="lp-dashboard-bars">${[42,66,58,84,73,92].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></div>
        <div class="lp-mock-card"><h3>${icon('settings')} Perfil</h3><p>Logo, capa, endereço, Instagram, WhatsApp, serviços e profissionais editáveis.</p><div class="lp-url-pill">groomin.com.br/studio-bella</div></div>
      </div>
    </div></section>

    <section id="segments" class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('building')} Para quem é</span><h2>Groomin se adapta ao seu tipo de negócio.</h2></div>
      <div class="lp-segment-grid">
        ${[
          ['scissors','Barbearia'],['star','Salão'],['sparkle','Nail'],['eye','Lash'],['droplet','Tattoo'],['heart','Estética'],
          ['activity','Personal'],['shield','Dentista'],['droplet','Nutrição'],['camera','Fotografia'],['clock','Massagem'],['briefcase','Consultoria']
        ].map(([i,t])=>`<div class="lp-segment"><span>${icon(i)}</span><b>${t}</b></div>`).join('')}
      </div>
    </div></section>

    <section><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('star')} Depoimentos</span><h2>Mais organização para quem atende todos os dias.</h2></div>
      <div class="testi-grid">
        ${[
          ['Marcos Lima','Barbearia Prime','Antes eu perdia horário no WhatsApp. Agora o cliente agenda sozinho e eu só acompanho.'],
          ['Bianca Rocha','Studio Beauty','Minha página ficou profissional e passei a divulgar um link único no Instagram.'],
          ['Renata Alves','Nail Designer','Economizo tempo todos os dias. A agenda ficou clara e sem confusão.'],
          ['Felipe Torres','Personal Trainer','Organizei horários, alunos e confirmações sem precisar montar site.'],
          ['Camila Duarte','Clínica de estética','O Groomin passou mais confiança para clientes novos chegarem pelo link.']
        ].map(([n,r,txt])=>`<div class="testi"><div class="stars">${'<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'.repeat(5)}</div><p>"${txt}"</p><div class="who"><div class="av">${initials(n)}</div><div><b>${n}</b><span>${r}</span></div></div></div>`).join('')}
      </div>
    </div></section>

    <section class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('target')} Comparativo</span><h2>WhatsApp continua útil. Mas agenda precisa de estrutura.</h2></div>
      ${comparisonTable()}
    </div></section>

    <section id="pricing"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('creditCard')} Planos</span><h2>Preço simples para publicar sua página hoje.</h2><p>Comece grátis sem cartão e receba até 3 agendamentos para testar.</p></div>
      <div id="pricingWrap">${pricingInner()}</div>
    </div></section>

    <section id="faq"><div class="container" style="max-width:860px">
      <div class="section-head"><span class="eyebrow">${icon('inbox')} FAQ</span><h2>Perguntas frequentes</h2></div>
      ${[
        ['Preciso instalar aplicativo?','Não. O Groomin funciona direto no navegador. Seus clientes também não precisam baixar nada.'],
        ['Posso usar no celular?','Sim. Você acessa pelo celular ou computador, e o cliente agenda pelo link em qualquer dispositivo.'],
        ['Meus clientes precisam criar conta?','Não. Eles escolhem serviço, profissional e horário direto na sua página.'],
        ['Posso cancelar quando quiser?','Sim. Não existe fidelidade. Você pode cancelar quando quiser.'],
        ['Recebo um link personalizado?','Sim. Cada negócio recebe sua própria página, como groomin.com.br/minhabarbearia.']
      ].map(f=>`<div class="faq-item" onclick="this.classList.toggle('open')"><div class="faq-q">${f[0]} ${icon('plus')}</div><div class="faq-a"><div>${f[1]}</div></div></div>`).join('')}
    </div></section>

    <div class="cta-band lp-final-cta" id="contato">
      <span class="eyebrow">${icon('rocket')} Comece hoje</span>
      <h2>Seu negócio merece uma experiência profissional.</h2>
      <p>Comece hoje mesmo e transforme a forma como seus clientes agendam horários.</p>
      <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
    </div>
  </main>
  ${landingFooter()}`;
}

function pricingInner(){
  return `<div class="lp-pricing-grid">
    <div class="price-card lp-simple-price">
      <h3>Mensal</h3>
      <div class="pc-price">R$ 14,90<small>/mês</small></div>
      <div class="pc-desc">Tudo incluso para publicar sua página e receber agendamentos.</div>
      <ul>${['Página profissional de agendamento','Serviços e profissionais','Link exclusivo','Agenda online','Suporte por WhatsApp'].map(f=>`<li>${icon('check')} ${f}</li>`).join('')}</ul>
      <button class="btn btn-outline btn-block" onclick="openTrialSignup('trial')">Quero começar</button>
    </div>
    <div class="price-card featured lp-simple-price">
      <span class="pc-tag">⭐ Mais escolhido</span>
      <h3>Anual ⭐ Mais escolhido</h3>
      <div class="lp-was">De: <s>R$ 178,80</s></div>
      <div class="pc-price">R$ 151,98<small>/ano</small></div>
      <div class="pc-desc"><b>Economize R$ 26,82 por ano.</b><br>Equivale a apenas R$ 12,66 por mês.</div>
      <ul>${['Tudo do plano mensal','2 meses de economia','Página publicada em minutos','Agenda e bloqueios de horário','Cancelamento simples'].map(f=>`<li>${icon('check')} ${f}</li>`).join('')}</ul>
      <button class="btn btn-primary btn-block" onclick="openTrialSignup('annual')">Escolher Plano Anual</button>
    </div>
  </div>
  <div class="lp-guarantee">
    <span>${icon('gift')}</span>
    <div><b>Teste grátis sem cartão.</b><p>Publique sua página e receba até 3 agendamentos antes de assinar.</p></div>
  </div>`;
}

function comparisonTable(){
  const rows=[
    ['Horários perdidos',false,true],
    ['Conversas misturadas',false,true],
    ['Demora nas respostas',false,true],
    ['Link profissional',false,true],
    ['Agenda organizada',false,true],
    ['Agendamento online',false,true],
    ['Mais praticidade para o cliente',false,true]
  ];
  return `<div class="lp-compare">
    <div class="lp-compare-col bad"><h3>WhatsApp sozinho</h3>${rows.map(r=>`<p>${icon(r[1]?'check':'x')} ${r[0]}</p>`).join('')}</div>
    <div class="lp-compare-col good"><h3>Com Groomin</h3>${rows.map(r=>`<p>${icon(r[2]?'check':'x')} ${r[0]}</p>`).join('')}</div>
  </div>`;
}

function landingFooter(){return `<footer class="site lp-footer"><div class="container">
  <div class="foot-grid">
    <div><div class="brand" style="margin-bottom:14px"><span class="logo">${GROOMIN_LOGO}</span><span>Groomin</span></div>
      <p class="muted" style="font-size:14px;max-width:330px">SaaS brasileiro para negócios que trabalham com agendamentos. Não é marketplace: cada empresa tem sua própria página.</p></div>
    <div><h4>Produto</h4><a onclick="lscroll('benefits')">Benefícios</a><a onclick="lscroll('demo')">Demonstração</a><a onclick="lscroll('pricing')">Planos</a></div>
    <div><h4>Links</h4><a onclick="Router.go('#/termos')">Termos</a><a onclick="Router.go('#/privacidade')">Privacidade</a><a onclick="Router.go('#/cookies')">Cookies</a><a onclick="Router.go('#/lgpd')">LGPD</a><a onclick="Router.go('#/contato')">Contato</a></div>
    <div><h4>Comece agora</h4><a onclick="openTrialSignup('trial')">Criar página</a><a onclick="Router.go('#/login')">Entrar</a><a href="mailto:contato.groominbarber@gmail.com">contato.groominbarber@gmail.com</a></div>
  </div>
  <div class="foot-bottom"><span>© 2026 Groomin. Todos os direitos reservados.</span><span>Powered by Groomin</span></div>
</div></footer>`;}

/* Landing V4: MVP-only messaging and current subscription offer. */
const FOUNDER_SPOTS_LEFT=3;
const FOUNDER_FEATURES=[
  'Sem mensalidade enquanto o Groomin permanecer em operação.',
  'Todas as funcionalidades atuais do Groomin.',
  'Atualizações das funcionalidades atuais.',
  'Suporte prioritário.',
  'Prioridade para testar novos recursos.',
  'Canal direto com o fundador para sugestões.',
  'Badge exclusivo de Cliente Fundador.',
  'Desconto exclusivo em futuros módulos premium (quando houver).'
];
const FOUNDER_LEGAL='*O acesso concedido ao Cliente Fundador permanece válido enquanto o Groomin estiver em operação. Novos produtos, funcionalidades ou módulos premium lançados futuramente poderão ser comercializados separadamente.*';
const MVP_PLAN_FEATURES=['Página profissional de agendamentos','Link personalizado','Agendamentos ilimitados','Cadastro de serviços','Cadastro de profissionais','Painel administrativo','Suporte','Atualizações contínuas'];

function landingTopbar(){return `
<header class="topbar lp-topbar"><div class="container inner">
  <div class="brand" onclick="Router.go('#/')"><span class="logo">${GROOMIN_LOGO}</span><span>Groomin<small>Agendamento online</small></span></div>
  <nav class="nav-links" id="lnav">
    <a onclick="lscroll('benefits')">Benefícios</a>
    <a onclick="lscroll('how')">Como funciona</a>
    <a onclick="lscroll('demo')">Demonstração</a>
    <a onclick="lscroll('pricing')">Planos</a>
    <a onclick="lscroll('faq')">FAQ</a>
  </nav>
  <div class="nav-right">
    <button class="btn btn-ghost btn-sm" onclick="Router.go('#/login')">Entrar</button>
    <button class="theme-toggle hamburger" onclick="$('#lnav').classList.toggle('mobile-open')">${icon('menu')}</button>
  </div>
</div></header>`;}

function renderLanding(){
  $('#root').innerHTML=landingTopbar()+`
  <main class="lp lp-saas">
    <section class="lp-hero"><div class="container lp-hero-grid">
      <div class="lp-copy">
        <span class="eyebrow">${icon('sparkle')} Não é marketplace. É a sua página.</span>
        <h1>Crie sua página profissional de agendamentos em menos de 5 minutos.</h1>
        <p class="lead">Compartilhe um único link com seus clientes e permita que eles agendem horários online de forma simples, rápida e profissional.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
          <button class="btn btn-ghost" onclick="lscroll('demo')">${icon('play')} Ver Demonstração</button>
        </div>
        <div class="lp-proof">
          <span>${icon('check')} Link para Instagram e WhatsApp</span>
          <span>${icon('check')} Sem app para o cliente</span>
          <span>${icon('check')} Teste grátis sem cartão</span>
        </div>
      </div>
      <div class="lp-stage lp-saas-stage" aria-label="Mockup do Groomin">
        <div class="lp-browser">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>groomin.com.br/minhabarbearia</span></div>
          <div class="lp-page-preview">
            <div class="lp-cover"></div>
            <div class="lp-shop-head"><div class="lp-avatar">G</div><div><b>Minha Barbearia</b><small>Página profissional</small></div></div>
            <div class="lp-service-row"><span>${icon('scissors')}</span><div><b>Corte Masculino</b><small>30 min · R$ 45</small></div><strong>14:00</strong></div>
            <div class="lp-service-row"><span>${icon('user')}</span><div><b>Profissional disponível</b><small>Escolha quem vai atender</small></div><strong>Hoje</strong></div>
            <div class="lp-slots">${['09:00','10:30','14:00','15:30','17:00','18:00'].map((t,i)=>`<span class="${i===2?'on':''}">${t}</span>`).join('')}</div>
            <button class="lp-confirm">Agendar horário</button>
          </div>
        </div>
        <div class="lp-phone">
          <div class="lp-phone-notch"></div>
          <div class="lp-chat"><b>Cliente</b><span>Abriu seu link pelo Instagram.</span></div>
          <div class="lp-chat me"><b>Groomin</b><span>Novo agendamento recebido.</span><em>14:00 · Corte Masculino</em></div>
          <div class="lp-check">${icon('check')} Horário salvo no painel</div>
        </div>
      </div>
    </div></section>

    <section id="benefits"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('award')} Benefícios</span><h2>Tudo que você precisa para começar a receber agendamentos online.</h2><p>Sem excesso. Sem promessa futura. Apenas o Groomin que já está pronto para usar.</p></div>
      <div class="lp-benefit-grid">
        ${[
          ['link','Compartilhe um único link','Use no Instagram, WhatsApp, Google, TikTok, Facebook ou QR Code.'],
          ['clock','Receba agendamentos 24 horas por dia','O cliente agenda quando for melhor para ele.'],
          ['calendar','Organize seus horários facilmente','Veja os horários marcados e bloqueie períodos quando precisar.'],
          ['scissors','Cadastre serviços e profissionais','Mostre serviços, duração, valor e quem atende.'],
          ['grid','Painel administrativo simples','Gerencie sua página e acompanhe sua agenda em poucos cliques.'],
          ['home','Funciona em celular, tablet e computador','Acesso direto pelo navegador, sem instalação obrigatória.']
        ].map(([i,t,p])=>`<div class="feature"><div class="f-ic">${icon(i)}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="how" class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('list')} Como funciona</span><h2>Publicar sua página é simples.</h2></div>
      <div class="lp-flow">
        ${[
          ['01','Crie sua conta.'],
          ['02','Configure seu negócio.'],
          ['03','Cadastre serviços e profissionais.'],
          ['04','Compartilhe seu link.'],
          ['05','Receba agendamentos online.']
        ].map(([n,t])=>`<div class="lp-flow-step"><span>${n}</span><b>${t}</b></div>`).join('')}
      </div>
    </div></section>

    <section id="demo"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('layers')} Demonstração</span><h2>Uma página profissional para o cliente e um painel simples para você.</h2><p>O Groomin entrega a página de agendamento, o link personalizado e o painel administrativo para gerenciar o básico do dia a dia.</p></div>
      <div class="lp-demo-grid">
        <div class="lp-mock-card large">
          <div class="lp-windowbar"><i></i><i></i><i></i><span>Página pública</span></div>
          <div class="lp-public-shot"><div><span class="badge gold">Link personalizado</span><h3>Studio Bella</h3><p>Serviços, profissionais, horários e contato em uma página pronta para compartilhar.</p></div><div class="lp-shot-list">${['Design de sobrancelha','Manicure em gel','Extensão de cílios'].map((x,i)=>`<div><span>${icon(i===0?'eye':i===1?'sparkle':'heart')}</span><b>${x}</b><small>${i===0?'30 min':i===1?'75 min':'90 min'}</small></div>`).join('')}</div></div>
        </div>
        <div class="lp-mock-card"><h3>${icon('calendar')} Agenda</h3><p>Veja os agendamentos recebidos e organize horários de atendimento.</p><div class="lp-mini-calendar">${['09:00','10:00','11:00','14:00','15:00','16:00'].map((t,i)=>`<span class="${i===3?'on':''}">${t}</span>`).join('')}</div></div>
        <div class="lp-mock-card"><h3>${icon('grid')} Painel</h3><p>Acompanhe agendamentos e a receita simples do dia, semana e mês.</p><div class="lp-dashboard-bars">${[42,66,58,84,73,92].map(h=>`<i style="height:${h}%"></i>`).join('')}</div></div>
        <div class="lp-mock-card"><h3>${icon('settings')} Perfil</h3><p>Edite logo, capa, endereço, Instagram, WhatsApp, serviços e profissionais.</p><div class="lp-url-pill">groomin.com.br/studio-bella</div></div>
      </div>
    </div></section>

    <section class="lp-band"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('target')} Comparativo</span><h2>WhatsApp ajuda na conversa. Groomin organiza o agendamento.</h2></div>
      ${comparisonTable()}
    </div></section>

    <section id="pricing"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('creditCard')} Planos</span><h2>Escolha como quer começar.</h2><p>Todos os planos entregam o MVP atual do Groomin. Simples, direto e sem promessa de recurso futuro.</p></div>
      <div id="pricingWrap">${pricingInner()}</div>
    </div></section>

    <section id="faq"><div class="container" style="max-width:860px">
      <div class="section-head"><span class="eyebrow">${icon('inbox')} FAQ</span><h2>Perguntas frequentes</h2></div>
      ${[
        ['O Groomin é marketplace?','Não. Cada empresa tem sua própria página. O Groomin é apenas a tecnologia por trás da experiência.'],
        ['Meus clientes precisam criar conta?','Não. Eles acessam seu link e agendam pelo navegador.'],
        ['Posso divulgar no Instagram e WhatsApp?','Sim. O link pode ser usado em Instagram, WhatsApp, Google, TikTok, Facebook ou QR Code.'],
        ['Tenho agendamentos ilimitados?','Sim. Os planos pagos incluem agendamentos ilimitados no produto atual.'],
        ['Posso cancelar quando quiser?','Sim. O plano mensal pode ser cancelado quando quiser.']
      ].map(f=>`<div class="faq-item" onclick="this.classList.toggle('open')"><div class="faq-q">${f[0]} ${icon('plus')}</div><div class="faq-a"><div>${f[1]}</div></div></div>`).join('')}
    </div></section>

    <div class="cta-band lp-final-cta" id="contato">
      <span class="eyebrow">${icon('rocket')} Comece hoje</span>
      <h2>Seu negócio merece uma experiência profissional de agendamento.</h2>
      <p>Crie sua página, compartilhe seu link e comece a receber agendamentos online hoje mesmo.</p>
      <button class="btn btn-primary" onclick="openTrialSignup('trial')">${icon('rocket')} Criar minha página</button>
    </div>
  </main>
  ${landingFooter()}`;
}

function planFeatureList(extra){
  return `<ul>${MVP_PLAN_FEATURES.map(f=>`<li>${icon('check')} ${f}</li>`).join('')}${extra||''}</ul>`;
}
function pricingInner(){
  const monthlyCard=planAvailableForSale('monthly')?`
    <div class="price-card lp-simple-price">
      <h3>Plano Mensal</h3>
      <div class="pc-price">R$ 14,90<small>/mês</small></div>
      <div class="pc-desc">Ideal para quem deseja começar sem compromisso.</div>
      ${planFeatureList()}
      <button class="btn btn-outline btn-block" onclick="openTrialSignup('trial')">Quero começar</button>
      <p class="muted" style="text-align:center;font-size:12px;margin-top:10px">Teste grátis • Sem cartão • Até 3 agendamentos</p>
    </div>`:'';
  const annualCard=planAvailableForSale('annual')?`
    <div class="price-card featured lp-simple-price">
      <span class="pc-tag">⭐ Mais escolhido</span>
      <h3>Plano Anual ⭐ Mais escolhido</h3>
      <div class="lp-was">Preço original: <s>R$ 178,80</s></div>
      <div class="pc-price">R$ 151,98<small>/ano</small></div>
      <div class="pc-desc"><b>Economize R$ 26,82 por ano.</b><br>Equivale a apenas R$ 12,66 por mês.</div>
      ${planFeatureList()}
      <button class="btn btn-primary btn-block" onclick="openTrialSignup('annual')">Escolher Plano Anual</button>
      <p class="muted" style="text-align:center;font-size:12px;margin-top:10px">Teste grátis • Sem cartão • Até 3 agendamentos</p>
    </div>`:'';
  const founderCard=planAvailableForSale('founder')?`
    <div class="price-card lp-simple-price lp-founder-card">
      <span class="pc-tag">Oferta exclusiva</span>
      <div class="lp-founder-crown">${icon('award')}</div>
      <h3>Cliente Fundador</h3>
      <div class="lp-founder-subtitle"><b>Faça parte da história do Groomin.</b><span>Uma oportunidade exclusiva para empresas que desejam apoiar o lançamento da plataforma e garantir benefícios únicos.</span></div>
      <div class="pc-price">R$ 990<small> pagamento único</small></div>
      <div class="lp-scarcity">${icon('star')} Apenas 3 empresas</div>
      <div class="lp-founder-counter"><span>Restam</span><b>${FOUNDER_SPOTS_LEFT}</b><span>vagas</span></div>
      <ul>${FOUNDER_FEATURES.map(f=>`<li>${icon('check')} ${f}</li>`).join('')}</ul>
      <div class="lp-founder-finality">Quando as 3 vagas forem preenchidas, esta oferta será encerrada definitivamente.</div>
      <div class="lp-founder-note"><em>${FOUNDER_LEGAL}</em></div>
      <button class="btn btn-primary btn-block" onclick="openTrialSignup('founder')">Quero ser um Cliente Fundador</button>
    </div>`:'';
  return `<div class="lp-pricing-grid founder">${monthlyCard}${annualCard}${founderCard}</div>`;
}

function comparisonTable(){
  const rows=[
    ['Um link profissional para divulgar',false,true],
    ['Cliente escolhe serviço e horário online',false,true],
    ['Agendamentos organizados no painel',false,true],
    ['Cadastro de serviços e profissionais',false,true],
    ['Menos mensagens repetitivas',false,true],
    ['Histórico simples de horários recebidos',false,true]
  ];
  return `<div class="lp-compare">
    <div class="lp-compare-col bad"><h3>Agendamento pelo WhatsApp</h3>${rows.map(r=>`<p>${icon(r[1]?'check':'x')} ${r[0]}</p>`).join('')}</div>
    <div class="lp-compare-col good"><h3>Groomin</h3>${rows.map(r=>`<p>${icon(r[2]?'check':'x')} ${r[0]}</p>`).join('')}</div>
  </div>`;
}

function landingFooter(){return `<footer class="site lp-footer"><div class="container">
  <div class="foot-grid">
    <div><div class="brand" style="margin-bottom:14px"><span class="logo">${GROOMIN_LOGO}</span><span>Groomin</span></div>
      <p class="muted" style="font-size:14px;max-width:330px">Plataforma simples para criação de páginas profissionais de agendamento. Não é marketplace.</p></div>
    <div><h4>Produto</h4><a onclick="lscroll('benefits')">Benefícios</a><a onclick="lscroll('demo')">Demonstração</a><a onclick="lscroll('pricing')">Planos</a></div>
    <div><h4>Links</h4><a>Termos</a><a>Privacidade</a><a>Contato</a><a>Instagram</a><a>WhatsApp</a></div>
    <div><h4>Comece agora</h4><a onclick="openTrialSignup('trial')">Criar página</a><a onclick="Router.go('#/login')">Entrar</a><a href="mailto:contato.groominbarber@gmail.com">contato.groominbarber@gmail.com</a></div>
  </div>
  <div class="foot-bottom"><span>© 2026 Groomin. Todos os direitos reservados.</span><span>Powered by Groomin</span></div>
</div></footer>`;}
const LEGAL_PAGES={
  privacidade:{title:'Política de Privacidade',desc:'Como o Groomin coleta, usa, armazena e protege dados pessoais. Versão 1.0.',sections:[
    ['1. Apresentação','O Groomin respeita a privacidade dos usuários e está comprometido com a proteção dos dados pessoais tratados por meio da Plataforma. Esta Política explica como coletamos, utilizamos, armazenamos, protegemos e compartilhamos informações relacionadas aos usuários do Groomin. Ao utilizar a Plataforma, o Usuário declara estar ciente desta Política.'],
    ['2. Quem somos','O Groomin é uma plataforma SaaS destinada à criação de páginas profissionais de agendamento para empresas e profissionais autônomos. Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD), o Groomin poderá atuar como Controlador ou Operador dos dados pessoais, dependendo da atividade realizada.'],
    ['3. Definições','Dados Pessoais: informações relacionadas a pessoa natural identificada ou identificável (ex.: nome, telefone, e-mail, endereço). Titular: pessoa a quem pertencem os dados. Controlador: quem decide como os dados serão tratados. Operador: quem realiza tratamento em nome do Controlador. Tratamento: toda operação realizada com dados pessoais, como coleta, armazenamento, utilização, consulta, compartilhamento e exclusão.'],
    ['4. Dados coletados','Dados do proprietário da empresa: nome, e-mail, telefone, WhatsApp, senha criptografada, foto de perfil e dados da assinatura. Dados da empresa: nome fantasia, segmento, endereço, horário de funcionamento, logo, Instagram, WhatsApp e link personalizado. Dados dos profissionais: nome, foto (quando enviada), serviços realizados e horários disponíveis. Dados dos clientes finais (ao realizar um agendamento): nome, telefone, e-mail (quando informado), serviço escolhido, profissional, data e horário. Dados técnicos: endereço IP, navegador, dispositivo, sistema operacional, data e hora de acesso e registros de autenticação.'],
    ['5. Finalidades do tratamento','Os dados poderão ser utilizados para criar contas, autenticar usuários, validar e-mail, permitir agendamentos, organizar a agenda do estabelecimento, processar pagamentos, prevenir fraudes, enviar comunicações importantes, cumprir obrigações legais, melhorar a Plataforma e gerar estatísticas internas.'],
    ['6. Bases legais','O tratamento poderá ocorrer com fundamento em execução de contrato, cumprimento de obrigação legal, exercício regular de direitos, legítimo interesse e consentimento, quando necessário.'],
    ['7. Compartilhamento de dados','O Groomin poderá compartilhar informações apenas quando necessário: com o Firebase (infraestrutura de autenticação e banco de dados), com o gateway de pagamento (processamento de cobranças), com o serviço de envio de e-mails (confirmação de cadastro, recuperação de senha, verificação de e-mail e notificações) e com autoridades públicas quando houver obrigação legal ou ordem judicial. O Groomin não vende dados pessoais.'],
    ['8. Cookies','A Plataforma poderá utilizar cookies para autenticação, manutenção de sessão, preferências, desempenho e segurança. O Usuário poderá gerenciar cookies por meio das configurações do navegador.'],
    ['9. Segurança','O Groomin adota medidas técnicas e administrativas razoáveis para proteger os dados pessoais, entre elas criptografia durante transmissão, autenticação, controle de acesso, backups, monitoramento e registros de atividades. Apesar disso, nenhum ambiente é absolutamente seguro.'],
    ['10. Retenção dos dados','Os dados serão armazenados pelo tempo necessário para a prestação dos serviços, cumprimento de obrigações legais, resolução de disputas, prevenção a fraudes e exercício regular de direitos. Após esse período, poderão ser excluídos ou anonimizados, conforme a legislação aplicável.'],
    ['11. Direitos dos titulares','Nos termos da LGPD, o Titular poderá solicitar confirmação da existência de tratamento, acesso aos dados, correção de informações, anonimização, bloqueio ou eliminação quando cabível, portabilidade quando aplicável, informações sobre compartilhamentos e revogação do consentimento quando este for a base legal. As solicitações serão analisadas conforme a legislação vigente.'],
    ['12. Dados de menores','O Groomin não é destinado ao uso por menores de 18 anos como administradores da plataforma. Caso seja identificado tratamento indevido de dados de menores sem respaldo legal, medidas poderão ser adotadas para a exclusão das informações.'],
    ['13. Transferência internacional','Os dados poderão ser processados ou armazenados em infraestrutura localizada fora do Brasil, desde que observadas as exigências da LGPD e adotadas medidas adequadas de proteção.'],
    ['14. Alterações desta Política','Esta Política poderá ser atualizada para refletir mudanças na legislação, na Plataforma ou nos serviços prestados. A versão vigente estará sempre disponível no site do Groomin.'],
    ['15. Contato','Para dúvidas relacionadas à privacidade ou ao tratamento de dados, o Titular poderá entrar em contato pelo e-mail contato.groominbarber@gmail.com.'],
    ['16. Exclusão de dados','O Titular poderá solicitar a exclusão de seus dados pessoais, observadas as hipóteses em que a legislação permita ou exija sua manutenção. A exclusão poderá resultar na impossibilidade de continuar utilizando determinados serviços da Plataforma.'],
    ['17. Disposições finais','O Groomin trata a privacidade como parte essencial da confiança depositada por seus usuários. Sempre que possível, adotaremos práticas de segurança, transparência e minimização de dados, buscando coletar apenas as informações necessárias para a prestação dos serviços.'],
    ['Consentimento','Ao criar uma conta ou utilizar o Groomin, o Usuário declara que leu esta Política de Privacidade, compreendeu como seus dados são tratados e concorda com o tratamento de dados necessário para a prestação dos serviços, conforme as bases legais aplicáveis.']]},
  termos:{title:'Termos de Uso',desc:'Regras para uso da plataforma Groomin. Versão 1.0.',sections:[
    ['1. Apresentação','O Groomin é uma plataforma SaaS (Software as a Service) destinada à criação e gerenciamento de páginas profissionais de agendamento para empresas e profissionais autônomos. A plataforma permite que estabelecimentos disponibilizem uma página pública personalizada para que seus clientes realizem agendamentos online de forma simples, rápida e organizada. Ao utilizar o Groomin, o Usuário declara que leu, compreendeu e concorda integralmente com estes Termos. Caso não concorde com qualquer cláusula, deverá interromper imediatamente a utilização da Plataforma.'],
    ['2. Definições','Plataforma: sistema online denominado Groomin. Usuário: pessoa física que cria uma conta na plataforma. Empresa: negócio cadastrado dentro do Groomin (barbearia, salão, studio, clínica, consultório, personal trainer ou qualquer estabelecimento baseado em agendamentos). Cliente Final: pessoa que agenda horários através da página pública da empresa. Painel Administrativo: área restrita destinada ao gerenciamento do estabelecimento. Página Pública: página disponibilizada ao Cliente Final para realização de agendamentos (ex.: groomin.com.br/minhaempresa). Assinatura: plano contratado pelo Usuário. Cliente Fundador: usuário que adquiriu a modalidade especial correspondente, conforme regras destes Termos.'],
    ['3. Objeto','A Plataforma permite ao Usuário criar uma página profissional, cadastrar profissionais e serviços, receber agendamentos online, administrar horários e compartilhar seu link personalizado. A Plataforma não atua como marketplace: o Groomin não intermedeia relações comerciais entre Empresas e Clientes Finais. Toda negociação ocorre exclusivamente entre a Empresa e seus próprios clientes.'],
    ['4. Aceitação e cadastro','Ao criar uma conta, o Usuário declara possuir capacidade civil para contratar, fornecer informações verdadeiras, utilizar a Plataforma conforme estes Termos e cumprir a legislação brasileira. O cadastro exige informações verdadeiras (nome, e-mail, senha e demais dados solicitados) e o Usuário é responsável por sua atualização. O Groomin poderá solicitar confirmação das informações sempre que julgar necessário.'],
    ['5. Verificação de e-mail','Após o cadastro será enviado um código de verificação ao endereço eletrônico informado. Enquanto o e-mail permanecer não verificado, poderá haver restrições de acesso e determinadas funcionalidades poderão permanecer indisponíveis. O Groomin poderá cancelar cadastros que permaneçam sem validação por período prolongado.'],
    ['6. Segurança da conta','O Usuário é responsável por manter sua senha em sigilo, proteger seus dispositivos e comunicar imediatamente qualquer acesso não autorizado. O Groomin nunca solicitará senhas por e-mail, WhatsApp ou telefone.'],
    ['7. Funcionalidades','O Groomin disponibiliza, conforme o plano contratado: página profissional de agendamentos, link personalizado, cadastro de serviços e profissionais, agendamentos online, painel administrativo, atualizações e suporte. As funcionalidades poderão evoluir ao longo do tempo.'],
    ['8. Planos','A Plataforma poderá oferecer Plano Gratuito, Plano Mensal, Plano Anual, Cliente Fundador e outros planos que venham a ser criados, cada um com regras próprias. O Plano Gratuito poderá conter limitações operacionais, como quantidade máxima de agendamentos, recursos reduzidos e restrições de uso, alteráveis mediante aviso prévio. Os planos Mensal e Anual possuem cobrança recorrente, com renovação automática a cada período, salvo cancelamento pelo Usuário.'],
    ['9. Cliente Fundador','O Cliente Fundador é uma modalidade promocional limitada, que poderá ser encerrada definitivamente a qualquer momento. O Cliente Fundador recebe isenção da mensalidade referente às funcionalidades contratadas, prioridade em suporte e benefícios exclusivos eventualmente divulgados. O benefício permanece válido enquanto o Groomin permanecer em operação, a modalidade permanecer tecnicamente viável e não houver violação destes Termos. Novos módulos, funcionalidades ou produtos premium poderão ser comercializados separadamente, e o plano não garante acesso automático a funcionalidades lançadas após a contratação. Os benefícios são pessoais ao estabelecimento contratado e não podem ser revendidos, cedidos ou transferidos sem autorização expressa. A aquisição não transforma o Usuário em sócio, acionista ou investidor da empresa responsável pelo Groomin.'],
    ['10. Pagamentos e cobrança recorrente','Os valores das assinaturas serão aqueles divulgados pela Plataforma no momento da contratação. Os pagamentos poderão ser processados por empresas terceirizadas especializadas em meios de pagamento; o Groomin não armazena integralmente os dados financeiros do Usuário. Ao contratar um plano recorrente, o Usuário autoriza a renovação automática da assinatura até seu cancelamento. Caso a cobrança seja recusada, o Groomin poderá realizar novas tentativas dentro de prazo razoável. Os preços poderão ser alterados para novas contratações ou renovações futuras, mediante comunicação prévia quando aplicável.'],
    ['11. Inadimplência e suspensão da página pública','Caso o pagamento da renovação não seja confirmado, o Groomin poderá suspender temporariamente funcionalidades, bloquear novos agendamentos, tornar a página pública temporariamente indisponível e impedir alterações administrativas. Durante a suspensão, a página pública poderá exibir mensagem informando a indisponibilidade temporária. Os dados do Usuário poderão permanecer armazenados conforme a Política de Privacidade, e a regularização do pagamento poderá restabelecer o acesso conforme as regras vigentes.'],
    ['12. Cancelamento','O Usuário poderá solicitar o cancelamento da assinatura a qualquer momento. O cancelamento impede novas renovações automáticas. Salvo disposição diversa informada na contratação, o acesso permanecerá disponível até o término do período já pago. Após esse período, o Groomin poderá aplicar as limitações do plano gratuito ou suspender funcionalidades compatíveis com a política comercial vigente.'],
    ['13. Reembolso e direito de arrependimento','Nos termos do art. 49 do Código de Defesa do Consumidor, o Usuário poderá exercer o direito de arrependimento no prazo de 7 (sete) dias corridos a contar da contratação realizada fora de estabelecimento comercial, com devolução dos valores pagos. Após esse prazo, as condições de reembolso observarão a legislação aplicável, a política de cancelamento vigente e as regras do meio de pagamento utilizado. Quando existir período gratuito, o Usuário poderá testar a Plataforma antes da primeira cobrança.'],
    ['14. Alteração de plano','O Usuário poderá alterar seu plano conforme disponibilidade da Plataforma, incluindo upgrade, downgrade e migração entre modalidades. As cobranças serão ajustadas conforme as regras comerciais vigentes.'],
    ['15. Disponibilidade e backups','O Groomin envidará esforços razoáveis para manter a Plataforma disponível, mas poderão ocorrer interrupções por manutenção programada, atualizações, falhas de infraestrutura, indisponibilidade de provedores terceirizados, eventos de força maior, ataques cibernéticos ou problemas de conectividade. Não há garantia de disponibilidade contínua ou ininterrupta. O Groomin poderá realizar rotinas de backup conforme sua política interna; recomenda-se que informações relevantes também sejam mantidas pelo próprio estabelecimento.'],
    ['16. Responsabilidades do Usuário','O Usuário compromete-se a manter seus dados atualizados, utilizar a Plataforma de boa-fé, respeitar a legislação vigente, não praticar atos ilícitos e preservar a confidencialidade de sua conta. O Usuário responde integralmente pelas informações cadastradas na Plataforma.'],
    ['17. Condutas proibidas','É vedado utilizar o Groomin para atividades ilícitas, fraude, envio de spam, disseminação de malware, tentativa de invasão, engenharia reversa do sistema, violação de direitos autorais, utilização automatizada não autorizada, coleta indevida de dados de terceiros ou qualquer prática que comprometa a estabilidade da Plataforma. O descumprimento poderá resultar na suspensão ou encerramento da conta, independentemente de aviso prévio.'],
    ['18. Limitação de responsabilidade','O Groomin disponibiliza uma ferramenta tecnológica para gestão de agendamentos e não garante aumento de faturamento, crescimento do negócio, captação de clientes, comparecimento dos clientes agendados ou resultados financeiros específicos. O Usuário permanece integralmente responsável pela condução de seu estabelecimento, pela prestação de seus serviços e pelo relacionamento com seus clientes. Em nenhuma hipótese o Groomin será responsável por lucros cessantes, perdas indiretas, danos consequenciais ou prejuízos decorrentes de fatores externos ao funcionamento razoável da Plataforma.'],
    ['19. Propriedade intelectual','Toda a Plataforma Groomin — incluindo software, código-fonte, interface gráfica, identidade visual, logotipos, marcas, banco de dados, documentação, textos, ícones, layouts, fluxos e componentes visuais — é protegida pelas leis brasileiras de propriedade intelectual e direitos autorais. Nenhum direito é transferido ao Usuário em razão da utilização da Plataforma; o Usuário recebe apenas licença limitada, não exclusiva, revogável e intransferível, conforme o plano contratado. É proibido copiar, vender, licenciar, modificar, distribuir, reproduzir, desmontar, realizar engenharia reversa ou criar produtos derivados sem autorização expressa do Groomin.'],
    ['20. Dados dos clientes e LGPD','O Groomin atua como plataforma tecnológica para gerenciamento de informações inseridas pelos próprios estabelecimentos; os dados cadastrados pertencem ao estabelecimento responsável. O Groomin não comercializa dados pessoais de usuários ou clientes finais e tratará dados pessoais conforme a Lei nº 13.709/2018 (LGPD). Informações detalhadas constam na Política de Privacidade.'],
    ['21. Segurança da informação','O Groomin adota medidas técnicas e administrativas razoáveis para proteger os dados armazenados, entre elas autenticação de usuários, criptografia durante a transmissão, controle de acesso, monitoramento de atividades, backups e infraestrutura em provedores reconhecidos. Nenhum sistema pode garantir proteção absoluta contra incidentes.'],
    ['22. Comunicações','O Groomin poderá enviar comunicações relacionadas à utilização da Plataforma, como confirmação de cadastro, verificação de e-mail, recuperação de senha, avisos sobre pagamentos, informações de segurança, alterações dos Termos e atualizações relevantes, por e-mail, notificações internas ou outros meios disponibilizados.'],
    ['23. Exclusão de conta','O Usuário poderá solicitar a exclusão de sua conta conforme os procedimentos disponibilizados pelo Groomin. A exclusão poderá resultar na remoção permanente de informações, observados prazos legais, obrigações regulatórias, necessidade de retenção legal e prevenção a fraudes. Determinados registros poderão ser mantidos pelo período exigido pela legislação.'],
    ['24. Encerramento da Plataforma','Caso o Groomin encerre definitivamente suas atividades, os Usuários serão comunicados com antecedência razoável, sempre que possível. Nessa hipótese, novas cobranças serão interrompidas, os serviços poderão ser gradualmente descontinuados e os dados serão tratados conforme a Política de Privacidade e a legislação aplicável. O encerramento definitivo extinguirá automaticamente a prestação dos serviços.'],
    ['25. Alterações destes Termos','O Groomin poderá alterar estes Termos para evolução da Plataforma, adequação legal, inclusão de funcionalidades, melhoria dos serviços ou alterações comerciais. A versão mais recente permanecerá disponível na Plataforma. O uso continuado após a publicação constitui aceitação da nova versão, salvo quando a legislação exigir novo consentimento.'],
    ['26. Cessão e independência das cláusulas','O Usuário não poderá transferir sua conta, assinatura ou direitos decorrentes destes Termos sem autorização expressa do Groomin. O Groomin poderá ceder seus direitos e obrigações em caso de reorganização societária, fusão, incorporação ou venda da operação, observada a legislação aplicável. Caso qualquer disposição seja considerada inválida, as demais permanecerão plenamente válidas e eficazes.'],
    ['27. Legislação aplicável e foro','Estes Termos serão interpretados de acordo com a legislação da República Federativa do Brasil. As partes elegem o foro competente previsto na legislação brasileira para dirimir eventuais controvérsias, observadas as normas de proteção ao consumidor quando aplicáveis.'],
    ['28. Contato','Dúvidas relacionadas a estes Termos podem ser encaminhadas para contato.groominbarber@gmail.com.'],
    ['Declaração de aceite','Ao criar uma conta, contratar qualquer plano ou utilizar a Plataforma Groomin, o Usuário declara que leu integralmente estes Termos de Uso, compreendeu seus direitos e obrigações, concorda com todas as disposições aqui previstas e compromete-se a utilizar a Plataforma de forma ética, responsável e em conformidade com a legislação brasileira.']]},
  cookies:{title:'Política de Cookies',desc:'Como usamos tecnologias locais no navegador.',sections:[
    ['Cookies e armazenamento local','Usamos recursos do navegador para manter sessão, preferências de interface, instalação PWA e funcionamento seguro do app.'],
    ['Analytics','Podemos usar métricas agregadas para entender visitas, cadastros, cliques e agendamentos, sem vender dados pessoais.'],
    ['Controle','Você pode limpar cookies e dados do site pelo navegador. Isso pode encerrar sessões ou remover preferências locais.']]},
  lgpd:{title:'Aviso LGPD',desc:'Canal e informações sobre proteção de dados pessoais.',sections:[
    ['Controlador e operador','O negócio que usa o Groomin pode atuar como controlador dos dados de seus clientes. O Groomin atua como fornecedor de tecnologia e, em muitos casos, operador dos dados tratados na plataforma.'],
    ['Base legal','Tratamos dados para execução de contrato, legítimo interesse operacional, cumprimento de obrigação legal, exercício regular de direitos e consentimento quando aplicável.'],
    ['Solicitações LGPD','Pedidos de acesso, correção, exclusão ou dúvidas sobre dados devem ser enviados para contato.groominbarber@gmail.com com identificação mínima para análise segura.'],
    ['Segurança','Aplicamos isolamento por negócio, regras de acesso, autenticação, registros de auditoria e controles técnicos para reduzir riscos de acesso indevido.']]},
  contato:{title:'Contato',desc:'Fale com o Groomin.',sections:[
    ['E-mail','contato.groominbarber@gmail.com'],
    ['Atendimento','Use este canal para dúvidas comerciais, privacidade, suporte, cancelamento, segurança ou solicitações LGPD.']]},
  suporte:{title:'Suporte',desc:'Ajuda para clientes Groomin.',sections:[
    ['Como pedir ajuda','Envie um e-mail para contato.groominbarber@gmail.com informando nome do negócio, link da página e descrição do problema.'],
    ['Segurança','Nunca envie senhas. O suporte pode solicitar dados mínimos para confirmar a titularidade da conta e proteger seu negócio.']]}
};
function renderLegalPage(r){
  const page=LEGAL_PAGES[r.page]||LEGAL_PAGES.privacidade;
  document.title=`${page.title} | Groomin`;
  $('#root').innerHTML=`<main class="lp lp-saas"><header class="lp-topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/')"><span class="logo">${GROOMIN_LOGO}</span><div><b>Groomin</b><small>AGENDAMENTO ONLINE</small></div></div>
    <nav class="nav-links"><a onclick="Router.go('#/')">Início</a><a onclick="Router.go('#/privacidade')">Privacidade</a><a onclick="Router.go('#/termos')">Termos</a><a onclick="Router.go('#/contato')">Contato</a></nav>
  </div></header>
  <section class="container" style="padding:92px 0 40px;max-width:900px">
    <span class="eyebrow">Legal e privacidade</span>
    <h1 style="font-size:clamp(38px,6vw,72px);line-height:1.02;margin:12px 0 16px">${escapeHtml(page.title)}</h1>
    <p class="lead" style="font-size:20px;color:var(--muted);max-width:720px">${escapeHtml(page.desc)}</p>
  </section>
  <section class="container" style="max-width:900px;padding-bottom:90px">
    <div class="panel" style="padding:28px">${page.sections.map(s=>`<section style="padding:18px 0;border-bottom:1px solid var(--line)"><h2 style="font-size:22px;margin-bottom:8px">${escapeHtml(s[0])}</h2><p class="muted" style="font-size:16px;line-height:1.75">${escapeHtml(s[1])}</p></section>`).join('')}
    <p class="muted" style="font-size:13px;margin-top:18px">Versão 1.0 — Última atualização: 03/07/2026.</p></div>
  </section></main>`;
}
/* ============================================================
   ONBOARDING MULTI-ETAPAS
   ============================================================ */
let onbStep=1,onbData={},onbVerifying=false;
const ONB_DRAFT_KEY='groomin_onboarding_draft_v1';
const ONB_PLAN_IDS=['trial','monthly','annual','founder'];
const ONB_TRIAL_DAYS=14;
const ONB_STEPS=['Boas-vindas','Tipo de negócio','Informações','Plano','Publicar'];
const ONB_PAYMENT_LINKS={
  trial:'',
  monthly:'',
  annual:'',
  founder:''
};
const ONB_CATEGORIES=[
  {id:'barbershop',label:'Barbearia',icon:'scissors',desc:'Cortes, barba, fades e grooming.',theme:'Elegant Dark',role:'Barbeiro',services:[['Corte masculino',45,30],['Barba',35,30],['Corte + barba',75,60]]},
  {id:'hair-salon',label:'Salão de cabelo',icon:'star',desc:'Cortes, coloração, tratamentos e beleza.',theme:'Luxury Gold',role:'Cabeleireiro',services:[['Corte feminino',80,60],['Escova',60,45],['Coloração',180,120]]},
  {id:'nail-designer',label:'Nail designer',icon:'sparkle',desc:'Unhas, gel, manicure e pedicure.',theme:'Rose Pink',role:'Nail designer',services:[['Manicure',35,45],['Pedicure',40,45],['Alongamento em gel',130,120]]},
  {id:'lash-designer',label:'Lash designer',icon:'eye',desc:'Extensão de cílios, manutenção e beleza.',theme:'Royal Purple',role:'Lash designer',services:[['Extensão de cílios',160,120],['Manutenção de cílios',90,75],['Remoção',45,40]]},
  {id:'makeup-artist',label:'Maquiadora',icon:'heart',desc:'Maquiagens e atendimentos de beleza.',theme:'Rose Pink',role:'Maquiadora',services:[['Maquiagem social',150,90],['Maquiagem noiva',350,150],['Produção completa',220,120]]},
  {id:'beauty-clinic',label:'Clínica de estética',icon:'droplet',desc:'Tratamentos faciais, corporais e estéticos.',theme:'Ocean Blue',role:'Esteticista',services:[['Limpeza de pele',120,60],['Drenagem linfática',110,60],['Avaliação estética',80,45]]},
  {id:'tattoo-studio',label:'Estúdio de tatuagem',icon:'edit',desc:'Tatuadores, sessões e agendamentos.',theme:'Ruby Red',role:'Tatuador',services:[['Sessão de tatuagem',250,120],['Retoque',120,60],['Consulta de projeto',50,30]]},
  {id:'massage-therapist',label:'Massoterapeuta',icon:'heart',desc:'Massagens e sessões de bem-estar.',theme:'Emerald',role:'Massoterapeuta',services:[['Massagem relaxante',120,60],['Massagem terapêutica',140,60],['Reflexologia',90,45]]},
  {id:'personal-trainer',label:'Personal trainer',icon:'activity',desc:'Treinos particulares e acompanhamento.',theme:'Sunset Orange',role:'Personal trainer',services:[['Treino individual',100,60],['Avaliação física',120,60],['Consultoria mensal',350,60]]},
  {id:'nutritionist',label:'Nutricionista',icon:'heart',desc:'Consultas e acompanhamento nutricional.',theme:'Ocean Blue',role:'Nutricionista',services:[['Consulta inicial',180,60],['Retorno nutricional',120,45],['Plano alimentar',220,60]]},
  {id:'physiotherapist',label:'Fisioterapeuta',icon:'activity',desc:'Atendimentos e reabilitação.',theme:'Ocean Blue',role:'Fisioterapeuta',services:[['Avaliação fisioterapêutica',150,60],['Sessão de fisioterapia',120,50],['Reabilitação',130,60]]},
  {id:'dentist',label:'Dentista',icon:'shield',desc:'Consultas e procedimentos odontológicos.',theme:'Ocean Blue',role:'Dentista',services:[['Consulta odontológica',150,45],['Limpeza',180,60],['Avaliação',120,45]]},
  {id:'photographer',label:'Fotógrafo',icon:'camera',desc:'Ensaios e sessões fotográficas.',theme:'Elegant Dark',role:'Fotógrafo',services:[['Ensaio externo',350,120],['Retrato profissional',220,60],['Cobertura de evento',800,240]]},
  {id:'consultant',label:'Consultor',icon:'briefcase',desc:'Consultorias e reuniões profissionais.',theme:'Ocean Blue',role:'Consultor',services:[['Consulta estratégica',250,60],['Mentoria',300,90],['Diagnóstico inicial',150,45]]},
  {id:'food',label:'Alimentos',icon:'coffee',desc:'Tortas, bolos, doces e comidas por encomenda com entrega agendada.',theme:'Sunset Orange',role:'Confeiteiro(a)',services:[['Torta por encomenda',90,60],['Bolo personalizado',150,60],['Kit festa',220,60]]},
  {id:'car-wash',label:'Lava rápido & automotivo',icon:'droplet',desc:'Lavagem, polimento, higienização e estética automotiva.',theme:'Ocean Blue',role:'Esteticista automotivo',services:[['Lavagem simples',40,40],['Lavagem completa',80,60],['Polimento',250,120]]},
  {id:'other',label:'Outro',icon:'sparkle',desc:'Qualquer negócio baseado em agendamento.',theme:'Ocean Blue',role:'Profissional',services:[['Atendimento',100,60],['Consulta',120,60],['Retorno',80,45]]}
];
function normalizeOnbPlan(id){return ONB_PLAN_IDS.includes(id)?id:'trial';}
function onbCheckoutUrl(planId){const links=window.GROOMIN_CHECKOUT_LINKS||ONB_PAYMENT_LINKS;return (links&&links[normalizeOnbPlan(planId)])||'';}
function onbDefaultHours(){return {open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',days:[1,2,3,4,5,6]};}
function onbPublicBase(){return ((location.origin&&location.origin!=='null')?location.origin:'https://groomin.com.br').replace(/^https?:\/\//,'')+'/';}
function onbBusinessSlug(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'').slice(0,48)||'seunegocio';}
function onbCategory(id){return ONB_CATEGORIES.find(c=>c.id===id)||ONB_CATEGORIES[0];}
function onbCategoryLabel(id){return onbCategory(id).label;}
function onbCategoryDesc(id){return onbCategory(id).desc;}
function onbApplyCategoryDefaults(id,force){
  const c=onbCategory(id);onbData.category=c.id;onbData.themeId=c.theme;
  if(force||!(onbData.professionals||[]).length)onbData.professionals=[{name:'Profissional principal',role:c.role}];
  if(force||!(onbData.services||[]).length)onbData.services=c.services.map(s=>({name:s[0],price:s[1],duration:s[2],category:c.id==='food'?'Produtos':'Serviços'}));
}
function onbSerializableDraft(){
  const {logoFile,coverFile,pass,emailVerified,...draft}=onbData||{};
  // File não serializa: profissionais guardam só o nome do arquivo no draft
  if(Array.isArray(draft.professionals))draft.professionals=draft.professionals.map(({photoFile,...p})=>p);
  return {...draft,logoFileName:logoFile&&logoFile.name||onbData.logoFileName||'',coverFileName:coverFile&&coverFile.name||onbData.coverFileName||''};
}
function onbSaveDraft(){
  try{sessionStorage.setItem(ONB_DRAFT_KEY,JSON.stringify(onbSerializableDraft()));}catch(e){}
}
function onbLoadDraft(){
  try{return JSON.parse(sessionStorage.getItem(ONB_DRAFT_KEY)||'null')||null;}catch(e){return null;}
}
function onbClearDraft(){
  try{sessionStorage.removeItem(ONB_DRAFT_KEY);}catch(e){}
}

function openOnboarding(planId){
  const u=Session.effectiveUser;
  const fbUser=window.fbCurrentUser&&window.fbCurrentUser();
  const rawUser=(Session&&Session.user)||fbUser;
  if(u&&(u.role==='owner'||u.role==='manager')){Router.go('#/dashboard/assinatura');return;}
  onbVerifying=false;
  // Se já autenticado e verificado mas sem empresa, pula direto para o step de categoria
  const skipToSetup=rawUser&&rawUser.emailVerified&&!(u&&u.barbershopId);
  onbStep=skipToSetup?2:1;
  const storedPlan=sessionStorage.getItem('groomin_signup_plan')||'';
  if(storedPlan)sessionStorage.removeItem('groomin_signup_plan');
  if(!rawUser)onbClearDraft();
  const draft=rawUser?onbLoadDraft():null;
  onbData=draft&&typeof draft==='object'
    ?{...draft,planId:normalizeOnbPlan(typeof planId==='string'?planId:storedPlan||draft.planId||'trial'),logoFile:null,coverFile:null}
    :{planId:normalizeOnbPlan(typeof planId==='string'?planId:storedPlan||'trial'),category:'barbershop',themeId:'Elegant Dark',hours:onbDefaultHours(),timezone:'America/Sao_Paulo',professionals:[],services:[]};
  if(rawUser&&rawUser.email){
    const isGoogle=Array.isArray(rawUser.providerData)&&rawUser.providerData.some(p=>p&&p.providerId==='google.com');
    onbData.name=onbData.name||rawUser.displayName||rawUser.name||(rawUser.email||'').split('@')[0];
    onbData.email=rawUser.email||onbData.email||'';
    onbData.pass=onbData.pass||'';
    onbData.emailVerified=rawUser.emailVerified!==false;
    if(isGoogle)onbData.authProvider='google';
  }
  if(!draft)onbApplyCategoryDefaults('barbershop',true);
  renderOnboarding();
}
window.openTrialSignup=openOnboarding;

function renderOnboarding(){
  const stepsHtml=ONB_STEPS.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  openModal(`<div class="modal-head"><div><h3>Criar página de agendamento</h3><div class="sub" id="onbStepLabel">Etapa ${onbStep} de ${ONB_STEPS.length} · ${escapeHtml(ONB_STEPS[onbStep-1]||'Personalização')}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="wizard-steps" id="onbStepper">${stepsHtml}</div>
  <div class="modal-body" id="onbBody">${renderOnbStep()}</div>
  <div class="modal-foot" id="onbFoot">${renderOnbFoot()}</div>`,'lg onboarding-modal');
}

function onbFileField(key,label,name){
  const isLogo=key==='logoFile';
  const id=isLogo?'onb_logo':'onb_cover';
  const nameId=isLogo?'onb_logo_name':'onb_cover_name';
  const selected=!!(name&&name!=='Nenhum arquivo selecionado');
  return `<div class="field onb-file-field"><label>${escapeHtml(label)}</label>
    <input type="file" id="${id}" accept="image/*" onchange="onbStoreFile('${key}',this)">
    <button class="onb-file-picker ${selected?'has-file':''}" type="button" onclick="document.getElementById('${id}').click()">
      <span class="onb-file-icon">${icon(selected?'check':'file')}</span>
      <span class="onb-file-copy"><b>${selected?'Arquivo selecionado':'Escolher arquivo'}</b><small id="${nameId}">${escapeHtml(name||'Nenhum arquivo selecionado')}</small></span>
    </button>
  </div>`;
}

function renderOnbStep(){
  if(onbStep===1)return renderOnbWelcome();
  if(onbStep===2)return renderOnbCategoryStep();
  if(onbStep===3){
    const slug=onbData.shopSlug||onbBusinessSlug(onbData.shopName||'');
    const h=onbData.hours||onbDefaultHours();
    const c=onbCategory(onbData.category);
    const logoName=onbData.logoFile&&onbData.logoFile.name?onbData.logoFile.name:(onbData.logoFileName||'Nenhum arquivo selecionado');
    const coverName=onbData.coverFile&&onbData.coverFile.name?onbData.coverFile.name:(onbData.coverFileName||'Nenhum arquivo selecionado');
    return `<div class="onb-selected"><span class="onb-cat-icon">${icon(c.icon)}</span><div><b>${escapeHtml(c.label)}</b><span>Tema recomendado: ${escapeHtml(c.theme)} · Serviços e termos pré-configurados</span></div><button class="btn btn-ghost btn-sm" onclick="onbStep=2;onbRefreshContent()">Alterar</button></div>
    <div class="form-row"><div class="field"><label>Nome do negócio *</label><input class="input" id="onb_shop" value="${escapeHtml(onbData.shopName||'')}" placeholder="Ex.: Esquilo Barber Shop" oninput="onbSlugPreview(this.value)"><div class="err">Informe o nome do negócio.</div></div>
    <div class="field"><label>Tema</label><div class="input" style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-3);cursor:default"><b>${escapeHtml(c.theme)}</b><span class="muted">pode alterar depois</span></div></div></div>
    <div class="field"><label>Slug gerado automaticamente</label><div class="input" style="background:var(--surface-3);display:flex;align-items:center;gap:6px;cursor:default"><span class="muted" style="white-space:nowrap;font-size:12px">${onbPublicBase()}</span><b id="onb_slug_preview" style="color:var(--primary);flex:1">${escapeHtml(slug)}</b></div><p class="muted" style="font-size:12px;margin-top:4px">Exemplo: groomin.com.br/esquilobarbershop</p></div>
    <div class="form-row">${onbFileField('logoFile','Logo',logoName)}${onbFileField('coverFile','Capa',coverName)}</div>
    <div class="form-row"><div class="field"><label>Instagram</label><input class="input" id="onb_instagram" value="${escapeHtml(onbData.instagram||'')}" placeholder="@seunegocio ou link do perfil" oninput="onbPersistBusinessDraft()"></div><div class="field"><label>WhatsApp *</label><input class="input" id="onb_wa" value="${escapeHtml(onbData.whatsapp||'')}" placeholder="(11) 9 0000-0000" oninput="onbPersistBusinessDraft()"></div></div>
    <div class="form-row"><div class="field"><label>Telefone</label><input class="input" id="onb_phone" value="${escapeHtml(onbData.phone||'')}" placeholder="(11) 0000-0000" oninput="onbPersistBusinessDraft()"></div><div class="field"><label>Fuso horário</label><select class="input" id="onb_tz" onchange="onbPersistBusinessDraft()"><option ${onbData.timezone==='America/Sao_Paulo'?'selected':''}>America/Sao_Paulo</option><option ${onbData.timezone==='America/New_York'?'selected':''}>America/New_York</option><option ${onbData.timezone==='America/Los_Angeles'?'selected':''}>America/Los_Angeles</option></select></div></div>
    <div class="field"><label>Endereço</label><input class="input" id="onb_addr" value="${escapeHtml(onbData.address||'')}" placeholder="Rua, número, bairro, cidade" oninput="onbPersistBusinessDraft()"></div>
    <div class="form-row"><div class="field"><label>Abertura</label><input class="input" type="time" id="onb_open" value="${h.open}" onchange="onbPersistBusinessDraft()"></div><div class="field"><label>Fechamento</label><input class="input" type="time" id="onb_close" value="${h.close}" onchange="onbPersistBusinessDraft()"></div></div>
    <div class="form-row"><div class="field"><label>Início do almoço</label><input class="input" type="time" id="onb_lunch_start" value="${h.lunchStart}" onchange="onbPersistBusinessDraft()"></div><div class="field"><label>Fim do almoço</label><input class="input" type="time" id="onb_lunch_end" value="${h.lunchEnd}" onchange="onbPersistBusinessDraft()"></div></div>
    <div class="field"><label>Dias de funcionamento</label><div class="chips" id="onb_days">${DOW.map((d,i)=>`<span class="chip-toggle ${h.days.includes(i)?'on':''}" data-day="${i}" onclick="this.classList.toggle('on');onbPersistBusinessDraft()">${d}</span>`).join('')}</div></div>
    ${onbData.category==='food'?`<div class="field"><label>Antecedência mínima das encomendas</label><select class="input" id="onb_lead_days" onchange="onbPersistBusinessDraft()">${ORDER_LEAD_OPTIONS.map(o=>`<option value="${o[0]}" ${(onbData.orderLeadDays??1)===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select><p class="muted" style="font-size:12px;margin-top:4px">Ex.: 1 dia — pedido feito na terça é entregue a partir da quarta.</p></div>`:''}
    <div class="onb-editor-intro"><div><b>Equipe e serviços</b><span>Cadastre pelo menos um profissional e um serviço para publicar sua página.</span></div></div>
    <div class="onb-suggest-grid">${onbListEditor('professionals','Profissionais','Quem atende seus clientes?','onbProfessionalForm')}${onbListEditor('services','Serviços','O que seus clientes podem agendar?','onbServiceForm')}</div>`;
  }
  if(onbStep===4)return renderOnbPlanStep();
  if(onbStep===5){
    const plan=DB.find('plans',onbData.planId==='trial'?'free':onbData.planId)||DB.find('plans','monthly');
    const planLabel=onbData.planId==='trial'?'Teste grátis sem cartão':plan.name;
    const c=onbCategory(onbData.category);
    return `<div class="card" style="padding:24px;text-align:center;background:linear-gradient(135deg,rgba(124,58,237,.10),transparent),var(--surface-2)">
      <div class="ei" style="background:var(--primary-soft);color:var(--primary);margin:0 auto 16px">${icon('rocket')}</div>
      <h3 style="font-size:22px;margin-bottom:6px">Publicar página</h3>
      <p class="muted" style="max-width:420px;margin:0 auto 18px">Seu site ficará no ar em segundos, com uma experiência inicial pensada para ${escapeHtml(c.label.toLowerCase())}.</p>
      <div class="input" style="background:var(--surface-3);color:var(--primary);font-weight:800;text-align:center;margin-bottom:14px">${escapeHtml(onbPublicBase()+onbData.shopSlug)}</div>
      <div class="card" style="padding:16px;text-align:left;max-width:420px;margin:0 auto">
        <div class="summary-line"><span class="muted">Negócio</span><b>${escapeHtml(onbData.shopName||'')}</b></div>
        <div class="summary-line"><span class="muted">Categoria</span><b>${escapeHtml(onbCategoryLabel(onbData.category))}</b></div>
        <div class="summary-line"><span class="muted">Tema inicial</span><b>${escapeHtml(c.theme)}</b></div>
        <div class="summary-line"><span class="muted">Profissionais</span><b>${(onbData.professionals||[]).length}</b></div>
        <div class="summary-line"><span class="muted">Serviços</span><b>${(onbData.services||[]).length}</b></div>
        <div class="summary-line"><span class="muted">Plano inicial</span><b>${escapeHtml(planLabel)}</b></div>
      </div>
    </div>`;
  }
  return '';
}

function renderOnbWelcome(){
  return `<div class="onb-hero"><span class="ei">${icon('sparkle')}</span><div><h2>Bem-vindo ao Groomin!</h2><p>Vamos personalizar sua experiência em menos de um minuto.</p><small>Etapa 1 de ${ONB_STEPS.length}</small></div></div>
    ${window.USE_FIREBASE?`<button id="onb_google_btn" class="btn btn-ghost btn-block google-auth-btn" onclick="onbGoogleSignup()"><span class="google-g">G</span> Criar conta com Google</button><div class="divider">ou use e-mail e senha</div>`:''}
    <div class="field"><label>Seu nome *</label><div class="input-icon">${icon('user')}<input class="input" id="onb_name" value="${escapeHtml(onbData.name||'')}" placeholder="Nome completo"></div><div class="err">Informe seu nome.</div></div>
    <div class="field"><label>E-mail *</label><div class="input-icon">${icon('mail')}<input class="input" id="onb_email" value="${escapeHtml(onbData.email||'')}" placeholder="voce@email.com"></div><div class="err">E-mail inválido.</div></div>
    ${onbData.authProvider==='google'?`<div class="insight ok" style="margin:0"><span class="ii">${icon('check')}</span><div><b>Google conectado</b><p>${escapeHtml(onbData.email||'')}</p></div></div>`:`<div class="field"><label>Senha *</label><div class="input-icon">${icon('lock')}<input class="input" type="password" id="onb_pass" value="${escapeHtml(onbData.pass||'')}" placeholder="Mínimo 6 caracteres"></div><div class="err">Mínimo 6 caracteres.</div></div>`}`;
}
function renderOnbCategoryStep(){
  return `<div class="onb-copy"><b>Qual tipo de negócio você tem?</b><span>Vamos configurar automaticamente o Groomin com a melhor experiência para o seu negócio.</span></div>
    <div class="onb-category-grid">${ONB_CATEGORIES.map(c=>`<button type="button" class="onb-category ${onbData.category===c.id?'selected':''}" onclick="onbPickCategory('${c.id}')" aria-pressed="${onbData.category===c.id?'true':'false'}">
      <span class="onb-cat-icon">${icon(c.icon)}</span>
      <span class="onb-cat-copy"><b>${escapeHtml(c.label)}</b><small>${escapeHtml(c.desc)}</small></span>
      <span class="onb-cat-theme">${escapeHtml(c.theme)}</span>
    </button>`).join('')}</div>`;
}

function renderOnbPlanStep(){
  const selected=normalizeOnbPlan(onbData.planId);
  const plans=[
    {id:'trial',name:'Teste grátis',badge:'Sem cartão',price:'R$ 0',period:'até 3 agendamentos',desc:'Publique sua página e receba até 3 agendamentos para ver funcionando.',features:['Sem cartão de crédito','Página publicada na hora','Assine para continuar após 3 agendamentos']},
    {id:'monthly',name:'Plano Mensal',badge:'Quero começar',price:'R$ 14,90',period:'/mês',desc:'Ideal para começar sem compromisso.',features:['Página profissional','Link personalizado','Agendamentos ilimitados']},
    {id:'annual',name:'Plano Anual',badge:'Mais escolhido',price:'R$ 151,98',period:'/ano',desc:'Economize R$ 26,82 por ano.',features:['Equivale a R$ 12,66/mês','Mesmos recursos do mensal','Mais escolhido']},
    {id:'founder',name:'Cliente Fundador',badge:'Oferta exclusiva',price:'R$ 990',period:'pagamento único',desc:'Faça parte da história do Groomin.',features:FOUNDER_FEATURES}
  ];
  const current=plans.find(p=>p.id===selected)||plans[0];
  return `<div class="onb-copy"><b>Escolha seu plano</b><span>Você pode começar com o teste grátis sem cartão. Depois de receber 3 agendamentos, será necessário assinar para continuar.</span></div>
    <div class="onb-plan-grid">${plans.map(p=>`<button type="button" class="onb-plan ${selected===p.id?'selected':''}" onclick="onbChoosePlan('${p.id}')" aria-pressed="${selected===p.id?'true':'false'}">
      <span class="onb-plan-top"><b>${escapeHtml(p.name)}</b><span class="onb-plan-pill ${p.id==='monthly'?'muted-pill':''}">${escapeHtml(p.badge)}</span></span>
      <span class="onb-plan-price">${escapeHtml(p.price)}<small>${escapeHtml(p.period)}</small></span>
      <span class="onb-plan-desc">${escapeHtml(p.desc)}</span>
      <span class="onb-plan-feats">${p.features.map(f=>`<span>${icon('check')} ${escapeHtml(f)}</span>`).join('')}</span>
    </button>`).join('')}</div>
    <div class="card" style="margin-top:14px;padding:14px;background:var(--surface-2)">
      <div class="summary-line"><span class="muted">Plano selecionado</span><b>${escapeHtml(current.name)}</b></div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">${selected==='trial'?'O teste grátis não exige cartão e libera até 3 agendamentos recebidos.':'O pagamento será iniciado no Stripe antes de publicar.'}</p>
    </div>`;
}

function renderOnbFoot(){
  if(onbVerifying)return '';
  let next='';
  if(onbStep<4)next=`<button class="btn btn-primary" onclick="onbNext()">Próximo ${icon('arrowRight')}</button>`;
  else if(onbStep===4)next=onbData.planId==='trial'?`<button class="btn btn-primary" onclick="onbData.paymentStarted=true;onbStep=5;onbRefreshContent()">${icon('rocket')} Continuar grátis</button>`:`<button class="btn btn-primary" onclick="onbGoPayment()">${icon('creditCard')} Ir para pagamento</button>`;
  else next=`<button id="onb_submit" class="btn btn-primary" onclick="submitOnboarding()">${icon('rocket')} Publicar</button>`;
  return `${onbStep===1?`<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>`:`<button class="btn btn-ghost" onclick="onbBack()">${icon('arrowLeft')} Voltar</button>`}${next}`;
}

function onbRefreshContent(){
  if(onbVerifying){onbRenderVerifyScreen();return;}
  if(onbStep===3)onbPersistBusinessDraft();
  const lbl=$('#onbStepLabel');if(lbl)lbl.textContent=`Etapa ${onbStep} de ${ONB_STEPS.length} · ${ONB_STEPS[onbStep-1]||'Personalização'}`;
  const st=$('#onbStepper');if(st)st.innerHTML=ONB_STEPS.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  const b=$('#onbBody');if(b)b.innerHTML=renderOnbStep();
  const f=$('#onbFoot');if(f)f.innerHTML=renderOnbFoot();
}
function onbPickCategory(id){onbApplyCategoryDefaults(id,onbData.category!==id);onbSaveDraft();onbRefreshContent();}
function onbChoosePlan(id){onbData.planId=normalizeOnbPlan(id);onbSaveDraft();onbRefreshContent();}
async function onbGoPayment(){
  onbData.planId=normalizeOnbPlan(onbData.planId);
  const fallbackUrl=onbCheckoutUrl(onbData.planId);
  const btn=document.querySelector('#onbFoot .btn-primary');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Abrindo Stripe...';}
  try{
    let url=fallbackUrl;
    if(!url&&window.__FB_ENABLED&&window.fbCreateStripeCheckout){
      const checkout=await fbCreateStripeCheckout({
        planId:onbData.planId,
        email:onbData.email,
        ownerName:onbData.name,
        shopName:onbData.shopName,
        successUrl:location.origin+location.pathname+'#/stripe/success',
        cancelUrl:location.origin+location.pathname+'#/stripe/cancel'
      });
      url=checkout.url;
      onbData.stripeSessionId=checkout.sessionId||'';
    }
    if(!url)throw new Error('stripe-not-configured');
    const w=window.open(url,'_blank','noopener');
    if(!w)location.href=url;
    onbData.paymentStarted=true;
    toast('Abrimos o pagamento em uma nova aba. Mantenha esta janela aberta e depois volte para publicar.','ok');
    onbStep=5;onbRefreshContent();
  }catch(err){
    console.warn('[Groomin] Stripe checkout:',err.code||'',err.message||err);
    toast('Não foi possível abrir o Stripe. Verifique a configuração de teste e tente novamente.','err');
  }finally{
    if(btn){btn.disabled=false;btn.innerHTML=old;}
  }
  if(!onbData.paymentStarted){
    return;
  }
}
function onbSlugPreview(val){onbData.shopName=val;onbData.shopSlug=onbBusinessSlug(val);const el=$('#onb_slug_preview');if(el)el.textContent=onbData.shopSlug;onbSaveDraft();}
function onbStoreFile(key,input){
  onbPersistBusinessDraft();
  const file=input&&input.files&&input.files[0];
  const nameKey=key==='logoFile'?'logoFileName':'coverFileName';
  if(file){onbData[key]=file;onbData[nameKey]=file.name;}
  const currentName=file?file.name:(onbData[nameKey]||'Nenhum arquivo selecionado');
  const lbl=$(`#onb_${key==='logoFile'?'logo':'cover'}_name`);
  if(lbl)lbl.textContent=currentName;
  const wrap=input&&input.closest?input.closest('.onb-file-field'):null;
  const btn=wrap&&wrap.querySelector('.onb-file-picker');
  const hasFile=currentName&&currentName!=='Nenhum arquivo selecionado';
  if(btn){
    btn.classList.toggle('has-file',!!hasFile);
    const title=btn.querySelector('b');
    const ico=btn.querySelector('.onb-file-icon');
    if(title)title.textContent=hasFile?'Arquivo selecionado':'Escolher arquivo';
    if(ico)ico.innerHTML=icon(hasFile?'check':'file');
  }
  onbSaveDraft();
}
function onbPersistBusinessDraft(){
  if(!$('#onb_shop'))return;
  onbData.shopName=$('#onb_shop').value.trim();
  onbData.shopSlug=onbBusinessSlug(onbData.shopName||'');
  onbData.logoFile=($('#onb_logo')&&$('#onb_logo').files[0])||onbData.logoFile||null;
  onbData.coverFile=($('#onb_cover')&&$('#onb_cover').files[0])||onbData.coverFile||null;
  if(onbData.logoFile&&onbData.logoFile.name)onbData.logoFileName=onbData.logoFile.name;
  if(onbData.coverFile&&onbData.coverFile.name)onbData.coverFileName=onbData.coverFile.name;
  onbData.instagram=normalizeInstagram($('#onb_instagram').value);
  onbData.whatsapp=$('#onb_wa').value.trim();
  onbData.phone=$('#onb_phone').value.trim();
  onbData.address=$('#onb_addr').value.trim();
  onbData.timezone=$('#onb_tz').value;
  if($('#onb_lead_days'))onbData.orderLeadDays=+$('#onb_lead_days').value||0;
  onbData.hours={open:$('#onb_open').value,close:$('#onb_close').value,lunchStart:$('#onb_lunch_start').value,lunchEnd:$('#onb_lunch_end').value,days:$$('#onb_days .chip-toggle.on').map(x=>+x.dataset.day)};
  onbSaveDraft();
}
function onbListEditor(key,title,subtitle,formFn){
  const list=onbData[key]||[];
  const isService=key==='services';
  return `<section class="onb-editor">
    <div class="onb-editor-head">
      <span class="onb-editor-icon">${icon(isService?'scissors':'users')}</span>
      <div><b>${escapeHtml(title)}</b><span>${escapeHtml(subtitle)}</span></div>
      <em>${list.length}</em>
    </div>
    ${window[formFn]()}
    <div class="onb-editor-list" id="onb_${key}_list">
      ${list.map((item,i)=>`<div class="mini-slot"><span class="ic">${icon(isService?'scissors':'user')}</span><div><b>${escapeHtml(item.name)}</b><br><small>${escapeHtml(isService?`${item.duration} min · ${money(item.price)}`:(item.role||'Profissional')+(item.photoFile?' · com foto':''))}</small></div><button class="ra del" title="Remover" onclick="onbRemove('${key}',${i})">${icon('trash')}</button></div>`).join('')||emptyState(isService?'scissors':'users',isService?'Nenhum serviço':'Nenhum profissional',isService?'Adicione o primeiro serviço acima.':'Adicione quem atende acima.')}
    </div>
  </section>`;
}
function onbProfessionalForm(){const c=onbCategory(onbData.category);return `<div class="onb-inline-form"><div class="form-row"><div class="field"><label>Nome *</label><input class="input" id="onb_prof_name" placeholder="Ex.: nome do profissional"></div><div class="field"><label>Função</label><input class="input" id="onb_prof_role" placeholder="${escapeHtml(c.role)}"></div></div>
  <div class="field"><label>Foto (opcional)</label>
    <input type="file" id="onb_prof_photo" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="onbProfPhotoPicked(this)">
    <button class="onb-file-picker" id="onb_prof_photo_btn" type="button" onclick="document.getElementById('onb_prof_photo').click()">
      <span class="onb-file-icon">${icon('file')}</span>
      <span class="onb-file-copy"><b>Escolher foto</b><small id="onb_prof_photo_name">Aparece na sua página pública · máx. 5MB</small></span>
    </button>
  </div>
  <button class="btn btn-primary btn-sm" type="button" onclick="onbAddProfessional()">${icon('plus')} Adicionar profissional</button></div>`;}
function onbProfPhotoPicked(input){const f=input.files[0];const nm=$('#onb_prof_photo_name');const btn=$('#onb_prof_photo_btn');if(f&&f.size>5*1024*1024){toast('A foto precisa ter no máximo 5MB.','err');input.value='';if(nm)nm.textContent='Aparece na sua página pública · máx. 5MB';if(btn)btn.classList.remove('has-file');return;}if(nm)nm.textContent=f?f.name:'Aparece na sua página pública · máx. 5MB';if(btn)btn.classList.toggle('has-file',!!f);}
function onbServiceForm(){const c=onbCategory(onbData.category),s=(c.services&&c.services[0])||['Atendimento',100,60];return `<div class="onb-inline-form"><div class="field"><label>Nome do serviço *</label><input class="input" id="onb_svc_name" placeholder="Ex.: ${escapeHtml(s[0])}"></div><div class="form-row"><div class="field"><label>Duração em minutos</label><input class="input" type="number" id="onb_svc_duration" value="${s[2]}" min="5"></div><div class="field"><label>Preço em R$</label><input class="input" type="number" id="onb_svc_price" value="${s[1]}" min="0"></div></div><button class="btn btn-primary btn-sm" type="button" onclick="onbAddService()">${icon('plus')} Adicionar serviço</button></div>`;}
function onbAddProfessional(){onbPersistBusinessDraft();const name=$('#onb_prof_name').value.trim();if(name.length<2){toast('Informe o nome do profissional.','err');return;}const photoFile=($('#onb_prof_photo')&&$('#onb_prof_photo').files[0])||null;onbData.professionals=onbData.professionals||[];onbData.professionals.push({name,role:$('#onb_prof_role').value.trim()||onbCategory(onbData.category).role||'Profissional',photoFile,photoFileName:photoFile?photoFile.name:''});onbSaveDraft();onbRefreshContent();}
function onbAddService(){onbPersistBusinessDraft();const name=$('#onb_svc_name').value.trim();if(name.length<2){toast('Informe o nome do serviço.','err');return;}onbData.services=onbData.services||[];onbData.services.push({name,duration:+$('#onb_svc_duration').value||30,price:+$('#onb_svc_price').value||0,category:onbData.category==='food'?'Produtos':'Serviços'});onbSaveDraft();onbRefreshContent();}
function onbRemove(key,i){onbPersistBusinessDraft();onbData[key].splice(i,1);onbSaveDraft();onbRefreshContent();}
function onbCollectBusinessInfo(){
  const shop=$('#onb_shop').value.trim();if(shop.length<2){toast('Informe o nome do negócio.','err');return false;}
  const whatsapp=$('#onb_wa').value.trim();if(whatsapp.replace(/\D/g,'').length<8){toast('Informe o WhatsApp.','err');return false;}
  onbData.shopName=shop;onbData.shopSlug=onbBusinessSlug(shop);onbData.themeId=onbCategory(onbData.category).theme;onbData.logoFile=$('#onb_logo').files[0]||onbData.logoFile||null;onbData.coverFile=$('#onb_cover').files[0]||onbData.coverFile||null;
  if(onbData.logoFile&&onbData.logoFile.name)onbData.logoFileName=onbData.logoFile.name;
  if(onbData.coverFile&&onbData.coverFile.name)onbData.coverFileName=onbData.coverFile.name;
  onbData.instagram=normalizeInstagram($('#onb_instagram').value);onbData.whatsapp=whatsapp;onbData.phone=$('#onb_phone').value.trim();onbData.address=$('#onb_addr').value.trim();onbData.timezone=$('#onb_tz').value;
  if($('#onb_lead_days'))onbData.orderLeadDays=+$('#onb_lead_days').value||0;
  onbData.hours={open:$('#onb_open').value,close:$('#onb_close').value,lunchStart:$('#onb_lunch_start').value,lunchEnd:$('#onb_lunch_end').value,days:$$('#onb_days .chip-toggle.on').map(x=>+x.dataset.day)};
  onbSaveDraft();
  return true;
}
function onbNext(){
  if(onbStep===1){
    const name=$('#onb_name').value.trim(),email=$('#onb_email').value.trim(),pass=($('#onb_pass')&&$('#onb_pass').value)||'';
    const googleReady=onbData.authProvider==='google'&&window.fbCurrentUser&&window.fbCurrentUser();
    let ok=true;
    const inv=(id,bad)=>{$('#'+id).closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
    inv('onb_name',name.length<2);inv('onb_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    if(!googleReady)inv('onb_pass',pass.length<6);
    if(!ok){toast('Confira os campos destacados.','err');return;}
    onbData.name=name;onbData.email=email;onbData.pass=pass;onbSaveDraft();
    if(googleReady){onbData.emailVerified=true;onbVerifying=false;onbStep=2;onbRefreshContent();return;}
    onbStartEmailVerification();return;
  }
  if(onbStep===3&&!onbCollectBusinessInfo())return;
  onbStep++;onbRefreshContent();
}
async function onbGoogleSignup(){
  if(!window.__FB_ENABLED||!window.fbCreateAuthAccountWithGoogle){toast('Login com Google indisponível nesta sessão.','err');return;}
  const btn=$('#onb_google_btn');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Abrindo Google...';}
  try{
    const user=await window.fbCreateAuthAccountWithGoogle();
    onbData.name=user.name||onbData.name||(user.email||'').split('@')[0];
    onbData.email=user.email||onbData.email||'';
    onbData.pass='';
    onbData.authProvider='google';
    onbData.emailVerified=true;
    onbData.emailVerificationSkipped=false;
    onbData.emailVerificationSkippedReason='';
    onbVerifying=false;
    onbSaveDraft();
    onbStep=2;
    onbRefreshContent();
    toast('Google conectado. Complete sua página.','ok');
  }catch(err){
    window._fbSigningUp=false;
    if(btn){btn.disabled=false;btn.innerHTML=old;}
    toast(fbErrMsg(err,'login'),'err');
  }
}
function onbBack(){onbStep=Math.max(1,onbStep-1);onbRefreshContent();}
function emailCodeSendErrorMsg(err){
  const c=(err&&err.code)||'';
  if(/failed-precondition/.test(c))return 'Envio de e-mail ainda não configurado. Verifique o domínio remetente na Resend.';
  if(/invalid-argument/.test(c))return 'E-mail inválido.';
  if(/resource-exhausted/.test(c))return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  return 'Não foi possível enviar o código. Tente novamente.';
}

async function onbStartEmailVerification(){
  const btn=document.querySelector('#onbFoot .btn-primary');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+' Enviando código...';}
  try{
    if(!window.__FB_ENABLED||!window.fbSendSignupVerificationCode)throw new Error('Firebase indisponível.');
    await window.fbSendSignupVerificationCode({email:onbData.email,name:onbData.name});
    onbData.emailVerified=false;onbSaveDraft();
    onbVerifying=true;onbRenderVerifyScreen();
  }catch(err){
    window._fbSigningUp=false;
    if(btn){btn.disabled=false;btn.innerHTML=old;}
    const c=err.code||'';
    if(/already-exists/.test(c)){
      sessionStorage.setItem('groomin_prefill_login_email',onbData.email||'');
      onbClearDraft();closeModal();Router.go('#/login');
      toast('Este e-mail já tem conta. Faça login.','err');
      return;
    }
    toast(emailCodeSendErrorMsg(err),'err');
  }
}
function onbRenderVerifyScreen(){
  const lbl=$('#onbStepLabel');if(lbl)lbl.textContent='Verificação de e-mail';
  const st=$('#onbStepper');if(st)st.innerHTML=`<div class="wstep done"><div class="num">${icon('check')}</div><div class="lbl">Boas-vindas</div></div><div class="wstep active"><div class="num">${icon('mail')}</div><div class="lbl">Verificação</div></div>`;
  const b=$('#onbBody');
  if(b)b.innerHTML=`<div style="text-align:center;padding:20px 0 8px">
    <div class="ei" style="margin:0 auto 16px;background:var(--primary-soft);color:var(--primary)">${icon('mail')}</div>
    <h3 style="margin-bottom:6px">Confirme seu e-mail</h3>
    <p class="muted" style="margin-bottom:24px;max-width:380px;margin-left:auto;margin-right:auto">Enviamos um código de 6 dígitos para <b>${escapeHtml(onbData.email)}</b>. Verifique sua caixa de entrada e spam.</p>
    <div class="field" style="max-width:220px;margin:0 auto">
      <div class="input-icon" style="justify-content:center">${icon('hash')}
        <input class="input" id="onb_otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" style="text-align:center;letter-spacing:8px;font-size:22px;font-weight:700" onkeydown="if(event.key==='Enter')onbSubmitOtp()">
      </div>
      <div id="onb_otp_err" style="display:none;color:var(--danger);font-size:13px;margin-top:6px;text-align:center"></div>
    </div>
  </div>`;
  const f=$('#onbFoot');
  if(f)f.innerHTML=`<button class="btn btn-ghost" onclick="onbCancelVerification()">${icon('arrowLeft')} Alterar e-mail</button>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="onb_resend_btn" onclick="onbResendOtp()">Reenviar</button>
      <button class="btn btn-primary" id="onb_verify_btn" onclick="onbSubmitOtp()">${icon('check')} Validar código</button>
    </div>`;
  setTimeout(()=>{const el=$('#onb_otp');if(el)el.focus();},80);
}
async function onbSubmitOtp(){
  const code=(($('#onb_otp')&&$('#onb_otp').value)||'').replace(/\D/g,'').slice(0,6);
  const errEl=$('#onb_otp_err');
  if(code.length!==6){if(errEl){errEl.textContent='Digite os 6 dígitos.';errEl.style.display='block';}return;}
  if(errEl)errEl.style.display='none';
  const btn=$('#onb_verify_btn');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+' Verificando...';}
  try{
    if(!window.fbVerifySignupEmailCode)throw new Error('Firebase indisponível.');
    await window.fbVerifySignupEmailCode({email:onbData.email,code});
    onbData.emailVerified=true;
    onbData.emailVerificationSkipped=false;
    onbData.emailVerificationSkippedReason='';
    onbVerifying=false;onbStep=2;onbRefreshContent();
    toast('E-mail verificado com sucesso!','ok');
  }catch(err){
    if(btn){btn.disabled=false;btn.innerHTML=old;}
    const c=err.code||'';
    const msg=/invalid-argument/.test(c)?'Código incorreto.':/deadline-exceeded/.test(c)?'Código expirado. Clique em Reenviar.':/failed-precondition/.test(c)?'Código já utilizado. Clique em Reenviar.':'Não foi possível verificar. Tente novamente.';
    if(errEl){errEl.textContent=msg;errEl.style.display='block';}else toast(msg,'err');
  }
}
async function onbResendOtp(){
  const btn=$('#onb_resend_btn');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Enviando...';}
  try{
    if(window.fbSendSignupVerificationCode)await window.fbSendSignupVerificationCode({email:onbData.email,name:onbData.name});
    toast('Novo código enviado!','ok');
  }catch(err){toast(emailCodeSendErrorMsg(err),'err');
  }finally{setTimeout(()=>{if(btn){btn.disabled=false;btn.innerHTML=old;}},30000);}
}
async function onbCancelVerification(){
  onbVerifying=false;onbData.email='';onbData.emailVerified=false;onbSaveDraft();onbStep=1;onbRefreshContent();
}
function submitOnboarding(){
  if(!window.__FB_ENABLED){toast('Firebase precisa estar ativo para publicar sua página.','err');return;}
  if(!onbData.emailVerified){toast('Confirme seu e-mail antes de publicar.','err');onbStep=1;onbRefreshContent();return;}
  const current=window.fbCurrentUser&&window.fbCurrentUser();
  const setupFn=current&&String(current.email||'').toLowerCase()===String(onbData.email||'').toLowerCase()?window.fbCompleteOwnerSetup:window.fbSignUpOwner;
  if(!setupFn){toast('Serviço indisponível. Recarregue a página.','err');return;}
  if(onbData.planId!=='trial'&&!onbData.paymentStarted){toast('Antes de publicar, cadastre o cartão ou conclua o pagamento pelo Stripe.','err');onbStep=4;onbRefreshContent();return;}
  const btn=$('#onb_submit');const origBtnHTML=btn?btn.innerHTML:null;
  if(btn){btn.disabled=true;btn.innerHTML='Publicando seu site...';}
  setupFn({shopName:onbData.shopName,ownerName:onbData.name,email:onbData.email,password:onbData.pass,phone:onbData.phone,whatsapp:onbData.whatsapp,address:onbData.address||'',slugOverride:onbData.shopSlug,planId:onbData.planId,category:onbData.category,themeId:onbData.themeId,instagram:onbData.instagram,timezone:onbData.timezone,hours:onbData.hours,orderLeadDays:onbData.category==='food'?(onbData.orderLeadDays??1):0,professionals:onbData.professionals,services:onbData.services,logoFile:onbData.logoFile,coverFile:onbData.coverFile,emailVerificationSkipped:!!onbData.emailVerificationSkipped,emailVerificationSkippedReason:onbData.emailVerificationSkippedReason||''})
    .then(()=>{onbClearDraft();closeModal();toast('Página publicada com sucesso!','ok');})
    .catch(err=>{console.error('[Groomin] signup publish:',err&&err.code||'',err&&err.message||err);if(btn&&origBtnHTML){btn.disabled=false;btn.innerHTML=origBtnHTML;}toast(fbErrMsg(err,'signup'),'err');});
}

/* ============================================================
   VERIFICAÇÃO DE E-MAIL (página standalone para #/verify-email)
   ============================================================ */
function renderEmailVerification(){
  const u=Session.user;
  const fbUser=window.fbCurrentUser&&window.fbCurrentUser();
  // sem nenhuma autenticação: vai para login
  if(!u&&!fbUser){Router.go('#/login');return;}
  if(u&&u.role==='super_admin'){Router.go('#/admin');return;}
  // já verificado e com empresa: vai para dashboard
  if(u&&u.emailVerified&&u.barbershopId){Router.go('#/dashboard');return;}
  const email=(u&&u.email)||(fbUser&&fbUser.email)||'';
  // usuário existente (tem empresa) viu apenas o botão de sair; novo usuário vê alterar e-mail
  const isExisting=!!(u&&u.tenantId);
  const actionBtn=isExisting
    ?`<button class="btn btn-ghost btn-sm" onclick="veSignOut()">Sair da conta</button>`
    :`<button class="btn btn-ghost btn-sm" onclick="veChangeEmail()">Alterar e-mail</button>`;
  document.title='Verificar e-mail | Groomin';
  $('#root').innerHTML=`<main class="verify-page"><header class="lp-topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/')"><span class="logo">${GROOMIN_LOGO}</span><div><b>Groomin</b><small>AGENDAMENTO ONLINE</small></div></div>
  </div></header>
  <section class="container verify-card">
    <div class="verify-icon">${icon('mail')}</div>
    <h1 style="font-size:26px;margin-bottom:8px">Confirme seu e-mail</h1>
    <p class="muted" style="margin-bottom:28px">Enviamos um código de 6 dígitos para <b>${escapeHtml(email)}</b>. Verifique a caixa de entrada e spam.</p>
    <div class="field" style="max-width:220px;margin:0 auto 20px">
      <div class="input-icon" style="justify-content:center">${icon('hash')}
        <input class="input" id="ve_otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" style="text-align:center;letter-spacing:8px;font-size:22px;font-weight:700" onkeydown="if(event.key==='Enter')veSubmitOtp()">
      </div>
      <div id="ve_otp_err" style="display:none;color:var(--danger);font-size:13px;margin-top:6px;text-align:center"></div>
    </div>
    <button class="btn btn-primary" style="width:100%;max-width:220px;margin-bottom:14px" onclick="veSubmitOtp()">${icon('check')} Validar código</button>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="ve_resend_btn" onclick="veResendOtp()">Reenviar código</button>
      ${actionBtn}
    </div>
  </section></main>`;
}
async function veSignOut(){
  try{if(window.fbSignOut)await window.fbSignOut();}catch(e){}
  Session.logout();
  Router.go('#/login');
}
async function veSubmitOtp(){
  const code=(($('#ve_otp')&&$('#ve_otp').value)||'').replace(/\D/g,'').slice(0,6);
  const errEl=$('#ve_otp_err');
  if(code.length!==6){if(errEl){errEl.textContent='Digite os 6 dígitos.';errEl.style.display='block';}return;}
  if(errEl)errEl.style.display='none';
  const btn=document.querySelector('button[onclick="veSubmitOtp()"]');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML=icon('clock')+' Verificando...';}
  try{
    if(!window.fbVerifyEmailCode)throw new Error('Firebase indisponível.');
    await window.fbVerifyEmailCode(code);
    if(window.fbReloadUser)await window.fbReloadUser();
    toast('E-mail verificado!','ok');
    const su=Session.effectiveUser;
    if(su&&su.barbershopId){if(window.fbRefreshSession)await window.fbRefreshSession();else Router.go('#/dashboard');}
    else{Router.go('#/');setTimeout(()=>{if(window.openOnboarding)window.openOnboarding();},200);}
  }catch(err){
    if(btn){btn.disabled=false;btn.innerHTML=old;}
    const c=err.code||'';
    const msg=/invalid-argument/.test(c)?'Código incorreto.':/deadline-exceeded/.test(c)?'Código expirado. Clique em Reenviar.':/failed-precondition/.test(c)?'Código já utilizado. Clique em Reenviar.':'Não foi possível verificar. Tente novamente.';
    if(errEl){errEl.textContent=msg;errEl.style.display='block';}else toast(msg,'err');
  }
}
async function veResendOtp(){
  const btn=$('#ve_resend_btn');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Enviando...';}
  try{
    if(window.fbSendVerificationCode)await window.fbSendVerificationCode();
    toast('Novo código enviado!','ok');
  }catch(err){toast(emailCodeSendErrorMsg(err),'err');
  }finally{setTimeout(()=>{if(btn){btn.disabled=false;btn.innerHTML=old;}},30000);}
}
async function veChangeEmail(){
  try{if(window.fbDeleteCurrentUser)await window.fbDeleteCurrentUser();}catch(e){
    try{if(window.fbSignOut)await window.fbSignOut();}catch(e2){}
  }
  window._fbSigningUp=false;
  Session.logout();
  Router.go('#/signup');
}

/* ============================================================
   LOGIN (single page, role-based redirect)
   ============================================================ */
function fbErrMsg(err,ctx){
  const c=err.code||'';
  if(/network-request-failed/.test(c))return 'Sem conexão. Verifique sua internet.';
  if(/too-many-requests/.test(c))return 'Muitas tentativas. Aguarde alguns minutos.';
  if(/invalid-email/.test(c))return 'E-mail inválido.';
  if(/weak-password/.test(c))return 'Senha fraca. Use no mínimo 6 caracteres.';
  if(/email-already|already-in-use/.test(c))return 'E-mail já cadastrado.';
  if(/popup-closed-by-user|cancelled-popup-request/.test(c))return 'Login com Google cancelado.';
  if(/popup-blocked/.test(c))return 'O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.';
  if(/account-exists-with-different-credential/.test(c))return 'Este e-mail já usa outro método de login.';
  if(/user-not-found|wrong-password|invalid-credential/.test(c))return 'E-mail ou senha incorretos.';
  if(/permission-denied/.test(c)||/Missing or insufficient permissions/i.test(err.message||''))return 'Permissão bloqueada ao criar a página. Recarregue e tente novamente.';
  if(/unavailable|deadline-exceeded/.test(c))return 'Serviço temporariamente indisponível. Tente novamente.';
  if(/already-exists/.test(c))return 'Esse horário acabou de ser reservado.';
  if(ctx==='booking'&&/Teste gratuito concluído/i.test(err.message||''))return 'Agenda temporariamente indisponível para novos agendamentos online.';
  if(ctx==='booking'&&/anteced/i.test(err.message||''))return err.message;
  if(ctx==='booking'&&/failed-precondition/.test(c))return 'Agenda pausada. Novos agendamentos estão indisponíveis no momento.';
  if(ctx==='signup')return 'Não foi possível criar sua conta.';
  if(ctx==='booking')return 'Não foi possível agendar. Tente novamente.';
  return 'Falha no login. Tente novamente.';
}
function doForgotPassword(){
  if(window.__FB_ENABLED){
    const email=($('#lg_email')||{}).value?.trim().toLowerCase()||'';
    if(!email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Digite seu e-mail acima para recuperar a senha.','info');if($('#lg_email'))$('#lg_email').focus();return;}
    fbSendPasswordReset(email).then(()=>toast('Se esse e-mail estiver cadastrado, enviaremos o link de recuperação. Verifique caixa de entrada e spam.','ok')).catch(err=>toast(fbErrMsg(err,'login'),'err'));
  }else{
    toast('Enviamos um link de recuperação para o seu e-mail.','info');
  }
}
function renderLogin(){
  if(Session.user){location.hash=homeRouteFor(Session.effectiveUser.role);return;}
  const loginShopId=sessionStorage.getItem('groomin_login_shop');
  const prefillEmail=sessionStorage.getItem('groomin_prefill_login_email')||'';
  if(prefillEmail)sessionStorage.removeItem('groomin_prefill_login_email');
  const loginShop=loginShopId?DB.find('barbershops',loginShopId):null;
  const loginBrand=loginShop?`<span class="logo">${brandLogo(loginShop,'brand-logo-img')}</span><span style="color:#fff">${escapeHtml(loginShop.name)}<small style="color:#cdc7bb">Área da barbearia</small></span>`:`<span class="logo">${GROOMIN_LOGO}</span><span style="color:#fff">Groomin<small style="color:#cdc7bb">Plataforma de Gestão</small></span>`;
  $('#root').innerHTML=`
  <div class="auth-screen">
    <div class="auth-side">
      <div class="brand" style="color:#fff">${loginBrand}</div>
      <div>
        <div class="auth-quote">"Sua página profissional de agendamentos, pronta em minutos. Seus clientes agendam sozinhos, a qualquer hora."</div>
        <div class="auth-feat" style="margin-top:14px">${icon('shield')} <span>Dados seguros e na nuvem</span></div>
        <div class="auth-feat">${icon('calendar')} <span>Agendamentos online 24h pelo seu link</span></div>
        <div class="auth-feat">${icon('whatsapp')} <span>Confirmação com o cliente via WhatsApp</span></div>
      </div>
      <div style="color:#8a857c!important;font-size:13px">© 2026 Groomin</div>
    </div>
    <div class="auth-main"><div class="auth-box">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="btn btn-ghost btn-sm" onclick="Router.go('#/')">${icon('arrowLeft')} Início</button>
        <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
      </div>
      <h2>${loginShop?`Entrar na ${escapeHtml(loginShop.name)}`:'Entrar na plataforma'}</h2>
      <p class="sub">${loginShop?'Acesse sua conta de cliente ou painel vinculado a esta barbearia.':'Acesse seu painel. Redirecionamos automaticamente conforme o seu perfil.'}</p>
      ${window.USE_FIREBASE?`<button id="btn_google_login" class="btn btn-ghost btn-block google-auth-btn" onclick="doGoogleLogin()"><span class="google-g">G</span> Entrar com Google</button><div class="divider">ou entre com e-mail</div>`:''}
      <div class="field"><label>E-mail</label><div class="input-icon">${icon('mail')}<input class="input" id="lg_email" placeholder="voce@email.com" value="${escapeHtml(window.USE_FIREBASE?prefillEmail:'joao@barbeariadojoao.com')}"></div></div>
      <div class="field"><label>Senha</label><div class="input-icon">${icon('lock')}<input class="input" type="password" id="lg_pass" placeholder="••••••••" value="${window.USE_FIREBASE?'':'owner123'}" onkeydown="if(event.key==='Enter')doLogin()"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        ${window.USE_FIREBASE?'':'<label class="checkbox-row" style="font-size:13px"><input type="checkbox" checked> Lembrar de mim</label>'}
        <a class="muted" style="font-size:13px;cursor:pointer" onclick="doForgotPassword()">Esqueci a senha</a>
      </div>
      <button id="btn_login" class="btn btn-primary btn-block" onclick="doLogin()">${icon('arrowRight')} Entrar</button>
      ${window.USE_FIREBASE?'':`<div class="divider">contas de demonstração</div>
      <div class="role-demos">
        <button class="role-demo" onclick="fillLogin('super@groomin.com.br','super123')"><b>Super Admin</b>super@groomin.com.br</button>
        <button class="role-demo" onclick="fillLogin('joao@barbeariadojoao.com','owner123')"><b>Proprietário</b>joao@barbeariadojoao.com</button>
        <button class="role-demo" onclick="fillLogin('gerente@barbeariadojoao.com','manager123')"><b>Gerente</b>gerente@barbeariadojoao.com</button>
        <button class="role-demo" onclick="fillLogin('recepcao@barbeariadojoao.com','recep123')"><b>Recepcionista</b>recepcao@…</button>
        <button class="role-demo" onclick="fillLogin('rafael@barbeariadojoao.com','barber123')"><b>Barbeiro</b>rafael@…</button>
        <button class="role-demo" onclick="fillLogin('cliente@email.com','cliente123')"><b>Cliente</b>cliente@email.com</button>
      </div>`}
      <p style="text-align:center;margin-top:18px;font-size:13px" class="muted">Não tem conta? <a style="color:var(--primary);font-weight:700;cursor:pointer" onclick="openTrialSignup('trial')">Criar conta</a></p>
    </div></div>
  </div>`;
}
function renderSignup(){
  if(Session.user){location.hash=homeRouteFor(Session.effectiveUser.role);return;}
  renderLogin();
  setTimeout(()=>openOnboarding(),0);
}
function fillLogin(e,p){$('#lg_email').value=e;$('#lg_pass').value=p;doLogin();}
async function doGoogleLogin(){
  if(!window.__FB_ENABLED||!window.fbSignInWithGoogle){toast('Login com Google indisponível nesta sessão.','err');return;}
  const btn=$('#btn_google_login');const old=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='Abrindo Google...';}
  try{
    window._fbSigningUp=true;
    const user=await window.fbSignInWithGoogle();
    const su=window.fbGetCurrentSession?await window.fbGetCurrentSession():null;
    if(su){
      window._fbSigningUp=false;
      toast(`Olá, ${(su.name||'').split(' ')[0]||'tudo bem'}!`,'ok');
      const intended=sessionStorage.getItem('groomin_intended');sessionStorage.removeItem('groomin_intended');
      location.hash=(intended&&intended.length)?intended:homeRouteFor(su.role);
      return;
    }
    window._fbSigningUp=true;
    sessionStorage.setItem('groomin_signup_plan','trial');
    onbData={planId:'trial',category:'barbershop',themeId:'Elegant Dark',hours:onbDefaultHours(),timezone:'America/Sao_Paulo',professionals:[],services:[],name:user.name||'',email:user.email||'',pass:'',authProvider:'google',emailVerified:true};
    openOnboarding('trial');
    toast('Conta Google conectada. Complete sua página.','ok');
  }catch(err){
    window._fbSigningUp=false;
    if(btn){btn.disabled=false;btn.innerHTML=old;}
    toast(fbErrMsg(err,'login'),'err');
  }
}
function doLogin(){
  const email=$('#lg_email').value.trim(),pass=$('#lg_pass').value;
  if(window.__FB_ENABLED){
    const btn=$('#btn_login');if(btn){btn.disabled=true;btn.innerHTML='Entrando…';}
    fbSignIn(email,pass).catch(err=>{if(btn){btn.disabled=false;btn.innerHTML=`${icon('arrowRight')} Entrar`;}toast(fbErrMsg(err,'login'),'err');});
    return;
  }
  const u=Session.login(email,pass);
  if(!u){toast('E-mail ou senha incorretos.','err');return;}
  DB.log('Login realizado',ROLE_LABEL[u.role]);
  toast(`Olá, ${u.name.split(' ')[0]}!`,'ok');
  const intended=sessionStorage.getItem('groomin_intended');sessionStorage.removeItem('groomin_intended');
  location.hash=(intended&&intended.length)?intended:homeRouteFor(u.role);
}
