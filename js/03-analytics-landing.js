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
   ENTITLEMENTS — limites/recursos efetivos por barbearia.
   Enterprise sobrepõe os limites do plano padrão (armazenados na assinatura).
   ============================================================ */
function shopSubscription(shopId){return DB.findBy('subscriptions',s=>s.barbershopId===shopId);}
function shopEntitlements(shopId){
  const shop=DB.find('barbershops',shopId);if(!shop)return null;
  const sub=shopSubscription(shopId);
  const plan=DB.find('plans',shop.planId)||DB.find('plans','free');
  if(shop.planId==='enterprise'&&sub&&sub.custom){
    const c=sub.custom;
    return {planId:'enterprise',planName:'Enterprise',isEnterprise:true,
      monthly:c.monthly||0,annual:c.annual||0,
      limitBarbers:c.limitBarbers??999,limitLocations:c.limitLocations??1,whatsappLimit:c.whatsappLimit??0,
      ai:!!c.ai,apiAccess:!!c.apiAccess,whiteLabel:!!c.whiteLabel,mobileApp:!!c.mobileApp,advancedReports:!!c.advancedReports};
  }
  const tier={free:0,growth:1,pro:2,elite:3}[shop.planId]??0;
  return {planId:shop.planId,planName:plan.name,isEnterprise:false,
    monthly:plan.price,annual:Math.round(plan.price*0.75*12),
    limitBarbers:plan.limit_barbers,limitLocations:tier>=3?99:1,whatsappLimit:[0,500,2000,99999][tier],
    ai:tier>=3,apiAccess:tier>=3,whiteLabel:tier>=3,mobileApp:tier>=1,advancedReports:tier>=2};
}
const ENT_FEATURES=[['priority','Implantação assistida','rocket'],['support','Suporte prioritário','award'],['branding','Página personalizada','layers'],['volume','Alto volume de agendamentos','calendar'],['team','Equipe maior','users']];

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
  if(need==='ai')return e.ai;
  if(need==='advancedReports')return e.advancedReports;
  const planId=DB.find('barbershops',shopId).planId;
  const tier=e.isEnterprise?3:({free:0,growth:1,pro:2,elite:3}[planId]??0);
  if(need==='crm')return tier>=1;
  return tier>=2; // marketing, inventory, financial, commissions
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
function landingTopbar(){return `
<header class="topbar"><div class="container inner">
  <div class="brand" onclick="Router.go('#/')"><span class="logo">${icon('scissors')}</span><span>Groomin<small>Plataforma de Gestão</small></span></div>
  <nav class="nav-links" id="lnav">
    <a onclick="lscroll('benefits')">Benefícios</a>
    <a onclick="lscroll('features')">Recursos</a>
    <a onclick="lscroll('pricing')">Planos</a>
    <a onclick="lscroll('faq')">FAQ</a>
  </nav>
  <div class="nav-right">
    <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
    <button class="btn btn-ghost btn-sm" onclick="Router.go('#/login')">Entrar</button>
    <button class="btn btn-primary btn-sm" onclick="openTrialSignup('growth')">${icon('rocket')} Criar conta</button>
    <button class="theme-toggle hamburger" onclick="$('#lnav').classList.toggle('mobile-open')">${icon('menu')}</button>
  </div>
</div></header>`;}
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
          <button class="btn btn-primary" onclick="openTrialSignup('growth')">${icon('rocket')} Criar conta</button>
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
          <div class="mini-slot" style="margin:0"><span class="ic">${icon('cpu')}</span><div><b>Insight de IA</b><br><small>Terça com baixa ocupação — sugira uma promoção.</small></div></div>
        </div>
        <div class="float-badge fb1"><span class="dot" style="background:var(--success)"></span>+32% de receita</div>
        <div class="float-badge fb2">${icon('whatsapp')} Lembretes automáticos</div>
      </div>
    </div></section>

    <div class="container"><div class="logo-row">
      ${['Barbearia do João','Barber Club','Corte Nobre','Premium Cuts','The Lounge','Navalha &amp; Cia'].map(n=>`<span>${n}</span>`).join('')}
    </div></div>

    <section id="benefits"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('award')} Por que o Groomin</span><h2>Mais agendamentos, menos trabalho manual</h2><p>Uma plataforma pensada para o dono da barbearia que quer crescer com previsibilidade.</p></div>
      <div class="feature-grid">
        ${[['trending','Aumente o faturamento','Reduza faltas com lembretes e ocupe horários ociosos com promoções inteligentes.'],
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
      <div class="section-head"><span class="eyebrow">${icon('star')} Depoimentos</span><h2>Donos de barbearia que cresceram com o Groomin</h2></div>
      <div class="testi-grid">
        ${[['Marcelo Dias','Barber Club, SP','Reduzi as faltas em 40% com os lembretes automáticos. O financeiro ficou muito mais claro.'],
           ['João Almeida','Barbearia do João, SP','Os insights de IA me mostraram que a terça estava vazia. Criei uma promo e lotei o dia.'],
           ['Rafael Souza','Corte Nobre, Campinas','Meus clientes adoram agendar pelo link no Instagram. Profissionalizou tudo.']
        ].map(([n,r,txt])=>`<div class="testi"><div class="stars">${'<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'.repeat(5)}</div><p>"${txt}"</p><div class="who"><div class="av">${initials(n)}</div><div><b>${n}</b><span>${r}</span></div></div></div>`).join('')}
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
      <button class="btn btn-primary" onclick="openTrialSignup('growth')">${icon('rocket')} Criar conta</button>
    </div>
  </main>
  ${landingFooter()}`;
}

/* Landing V2: focused on fast professional booking pages. */
function landingTopbar(){return `
<header class="topbar"><div class="container inner">
  <div class="brand" onclick="Router.go('#/')"><span class="logo">${icon('scissors')}</span><span>Groomin<small>Agendamento profissional</small></span></div>
  <nav class="nav-links" id="lnav">
    <a onclick="lscroll('businesses')">Negócios</a>
    <a onclick="lscroll('product')">Produto</a>
    <a onclick="lscroll('how')">Como funciona</a>
    <a onclick="lscroll('pricing')">Planos</a>
    <a onclick="lscroll('faq')">FAQ</a>
  </nav>
  <div class="nav-right">
    <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
    <button class="btn btn-ghost btn-sm" onclick="Router.go('#/login')">Entrar</button>
    <button class="btn btn-primary btn-sm" onclick="openTrialSignup('growth')">${icon('rocket')} Começar</button>
    <button class="theme-toggle hamburger" onclick="$('#lnav').classList.toggle('mobile-open')">${icon('menu')}</button>
  </div>
</div></header>`;}

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
          <button class="btn btn-primary" onclick="openTrialSignup('growth')">${icon('rocket')} Criar minha página</button>
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
      <button class="btn btn-primary" onclick="openTrialSignup('growth')">${icon('rocket')} Criar minha página</button>
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
  return `<div class="card" style="margin-top:30px;padding:28px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;background:linear-gradient(120deg,rgba(212,175,55,.12),transparent 70%),var(--surface)">
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
    <div><div class="brand" style="margin-bottom:14px"><span class="logo">${icon('scissors')}</span><span>Groomin</span></div>
      <p class="muted" style="font-size:14px;max-width:300px">Página profissional de agendamento para negócios que vivem de horário marcado.</p></div>
    <div><h4>Produto</h4><a onclick="lscroll('businesses')">Negócios</a><a onclick="lscroll('product')">Produto</a><a onclick="lscroll('how')">Como funciona</a></div>
    <div><h4>Empresa</h4><a onclick="lscroll('pricing')">Planos</a><a onclick="lscroll('faq')">FAQ</a><a onclick="Router.go('#/login')">Entrar</a></div>
    <div><h4>Comece agora</h4><a onclick="openOnboarding('growth')">Criar página</a>${window.USE_FIREBASE?'':`<a onclick="openDemo()">Demonstração</a>`}<a>contato@groomin.com.br</a></div>
  </div>
  <div class="foot-bottom"><span>© 2026 Groomin. Todos os direitos reservados.</span><span>Agendamento simples, presença profissional.</span></div>
</div></footer>`;}

function openDemo(){
  if(window.USE_FIREBASE){openTrialSignup('growth');return;} // em produção: criar conta real
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
/* ============================================================
   ONBOARDING MULTI-ETAPAS (4 passos)
   ============================================================ */
let onbStep=1,onbData={};
const ONB_PLAN_IDS=['growth','pro','elite'];
const ONB_STEPS=['Register','Categoria','Informações','Profissionais','Serviços','Publicar'];
const ONB_CATEGORIES=[
  ['barbershop','Barbearia','scissors'],
  ['salon','Salão de beleza','star'],
  ['beauty-studio','Estúdio de beleza','heart'],
  ['independent','Profissional independente','user']
];
function normalizeOnbPlan(id){return ONB_PLAN_IDS.includes(id)?id:'growth';}
function onbDefaultHours(){return {open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',days:[1,2,3,4,5,6]};}
function onbPublicBase(){return ((location.origin&&location.origin!=='null')?location.origin:'https://groomin.com.br').replace(/^https?:\/\//,'')+'/';}
function onbBusinessSlug(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'').slice(0,48)||'seunegocio';}

function openOnboarding(planId){
  const u=Session.effectiveUser;
  if(u&&(u.role==='owner'||u.role==='manager')){Router.go('#/dashboard/assinatura');return;}
  onbStep=1;
  onbData={planId:normalizeOnbPlan(typeof planId==='string'?planId:'growth'),category:'barbershop',hours:onbDefaultHours(),timezone:'America/Sao_Paulo',professionals:[],services:[]};
  renderOnboarding();
}
window.openTrialSignup=openOnboarding;

function renderOnboarding(){
  const stepsHtml=ONB_STEPS.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  openModal(`<div class="modal-head"><div><h3>Criar página de agendamento</h3><div class="sub">Publique seu link profissional em menos de 5 minutos</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="wizard-steps" id="onbStepper">${stepsHtml}</div>
  <div class="modal-body" id="onbBody">${renderOnbStep()}</div>
  <div class="modal-foot" id="onbFoot">${renderOnbFoot()}</div>`,'lg onboarding-modal');
}

function renderOnbStep(){
  if(onbStep===1)return `<div class="field"><label>Seu nome *</label><div class="input-icon">${icon('user')}<input class="input" id="onb_name" value="${escapeHtml(onbData.name||'')}" placeholder="Nome completo"></div><div class="err">Informe seu nome.</div></div>
    <div class="field"><label>E-mail *</label><div class="input-icon">${icon('mail')}<input class="input" id="onb_email" value="${escapeHtml(onbData.email||'')}" placeholder="voce@email.com"></div><div class="err">E-mail inválido.</div></div>
    <div class="field"><label>Senha *</label><div class="input-icon">${icon('lock')}<input class="input" type="password" id="onb_pass" value="${escapeHtml(onbData.pass||'')}" placeholder="Mínimo 6 caracteres"></div><div class="err">Mínimo 6 caracteres.</div></div>`;
  if(onbStep===2)return `<div class="onb-copy"><b>Escolha a categoria</b><span>Isso ajuda a preparar sua página com o vocabulário certo.</span></div>
    <div class="onb-plan-grid">${ONB_CATEGORIES.map(([id,label,ic])=>`<button type="button" class="onb-plan ${onbData.category===id?'selected':''}" onclick="onbPickCategory('${id}')" aria-pressed="${onbData.category===id?'true':'false'}">
      <span class="onb-plan-top"><b>${escapeHtml(label)}</b>${onbData.category===id?`<span class="onb-plan-pill">${icon('check')} Selecionado</span>`:''}</span>
      <span class="ei" style="margin:0;background:var(--primary-soft);color:var(--primary)">${icon(ic)}</span>
      <span class="onb-plan-desc">Página de agendamento para ${escapeHtml(label.toLowerCase())}.</span>
    </button>`).join('')}</div>`;
  if(onbStep===3){
    const slug=onbData.shopSlug||onbBusinessSlug(onbData.shopName||'');
    const h=onbData.hours||onbDefaultHours();
    return `<div class="form-row"><div class="field"><label>Business Name *</label><input class="input" id="onb_shop" value="${escapeHtml(onbData.shopName||'')}" placeholder="Ex.: Esquilo Barber Shop" oninput="onbSlugPreview(this.value)"><div class="err">Informe o nome do negócio.</div></div>
    <div class="field"><label>Category</label><select class="input" id="onb_category">${ONB_CATEGORIES.map(([id,label])=>`<option value="${id}" ${onbData.category===id?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Slug gerado automaticamente</label><div class="input" style="background:var(--surface-3);display:flex;align-items:center;gap:6px;cursor:default"><span class="muted" style="white-space:nowrap;font-size:12px">${onbPublicBase()}</span><b id="onb_slug_preview" style="color:var(--primary);flex:1">${escapeHtml(slug)}</b></div><p class="muted" style="font-size:12px;margin-top:4px">Exemplo: groomin.com.br/esquilobarbershop</p></div>
    <div class="form-row"><div class="field"><label>Logo</label><input class="input" type="file" id="onb_logo" accept="image/*"></div><div class="field"><label>Cover</label><input class="input" type="file" id="onb_cover" accept="image/*"></div></div>
    <div class="form-row"><div class="field"><label>Instagram</label><input class="input" id="onb_instagram" value="${escapeHtml(onbData.instagram||'')}" placeholder="@seunegocio"></div><div class="field"><label>WhatsApp *</label><input class="input" id="onb_wa" value="${escapeHtml(onbData.whatsapp||'')}" placeholder="(11) 9 0000-0000"></div></div>
    <div class="form-row"><div class="field"><label>Phone</label><input class="input" id="onb_phone" value="${escapeHtml(onbData.phone||'')}" placeholder="(11) 0000-0000"></div><div class="field"><label>Timezone</label><select class="input" id="onb_tz"><option ${onbData.timezone==='America/Sao_Paulo'?'selected':''}>America/Sao_Paulo</option><option ${onbData.timezone==='America/New_York'?'selected':''}>America/New_York</option><option ${onbData.timezone==='America/Los_Angeles'?'selected':''}>America/Los_Angeles</option></select></div></div>
    <div class="field"><label>Address</label><input class="input" id="onb_addr" value="${escapeHtml(onbData.address||'')}" placeholder="Rua, número, bairro, cidade"></div>
    <div class="form-row"><div class="field"><label>Open</label><input class="input" type="time" id="onb_open" value="${h.open}"></div><div class="field"><label>Close</label><input class="input" type="time" id="onb_close" value="${h.close}"></div></div>
    <div class="form-row"><div class="field"><label>Lunch start</label><input class="input" type="time" id="onb_lunch_start" value="${h.lunchStart}"></div><div class="field"><label>Lunch end</label><input class="input" type="time" id="onb_lunch_end" value="${h.lunchEnd}"></div></div>
    <div class="field"><label>Dias de funcionamento</label><div class="chips" id="onb_days">${DOW.map((d,i)=>`<span class="chip-toggle ${h.days.includes(i)?'on':''}" data-day="${i}" onclick="this.classList.toggle('on')">${d}</span>`).join('')}</div></div>`;
  }
  if(onbStep===4)return `${onbListEditor('professionals','Profissionais','onbProfessionalForm','Adicionar profissional')}`;
  if(onbStep===5)return `${onbListEditor('services','Serviços','onbServiceForm','Adicionar serviço')}`;
  if(onbStep===6){
    const plan=DB.find('plans',onbData.planId)||DB.find('plans','growth');
    return `<div class="card" style="padding:24px;text-align:center;background:linear-gradient(135deg,rgba(212,175,55,.12),transparent),var(--surface-2)">
      <div class="ei" style="background:var(--primary-soft);color:var(--primary);margin:0 auto 16px">${icon('rocket')}</div>
      <h3 style="font-size:22px;margin-bottom:6px">Publicar página</h3>
      <p class="muted" style="max-width:420px;margin:0 auto 18px">Tudo será salvo no Firestore. Sua página ficará disponível em:</p>
      <div class="input" style="background:var(--surface-3);color:var(--primary);font-weight:800;text-align:center;margin-bottom:14px">${escapeHtml(onbPublicBase()+onbData.shopSlug)}</div>
      <div class="card" style="padding:16px;text-align:left;max-width:420px;margin:0 auto">
        <div class="summary-line"><span class="muted">Negócio</span><b>${escapeHtml(onbData.shopName||'')}</b></div>
        <div class="summary-line"><span class="muted">Categoria</span><b>${escapeHtml(onbCategoryLabel(onbData.category))}</b></div>
        <div class="summary-line"><span class="muted">Profissionais</span><b>${(onbData.professionals||[]).length}</b></div>
        <div class="summary-line"><span class="muted">Serviços</span><b>${(onbData.services||[]).length}</b></div>
        <div class="summary-line"><span class="muted">Plano inicial</span><b>${escapeHtml(plan.name)}</b></div>
      </div>
    </div>`;
  }
  return '';
}

function renderOnbFoot(){
  const next=onbStep<ONB_STEPS.length?`<button class="btn btn-primary" onclick="onbNext()">Próximo ${icon('arrowRight')}</button>`:`<button id="onb_submit" class="btn btn-primary" onclick="submitOnboarding()">${icon('rocket')} Publicar</button>`;
  return `${onbStep===1?`<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>`:`<button class="btn btn-ghost" onclick="onbBack()">${icon('arrowLeft')} Voltar</button>`}${next}`;
}

function onbRefreshContent(){
  const st=$('#onbStepper');if(st)st.innerHTML=ONB_STEPS.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  const b=$('#onbBody');if(b)b.innerHTML=renderOnbStep();
  const f=$('#onbFoot');if(f)f.innerHTML=renderOnbFoot();
}
function onbCategoryLabel(id){const c=ONB_CATEGORIES.find(x=>x[0]===id);return c?c[1]:'Negócio';}
function onbPickCategory(id){onbData.category=id;onbRefreshContent();}
function onbSlugPreview(val){onbData.shopName=val;onbData.shopSlug=onbBusinessSlug(val);const el=$('#onb_slug_preview');if(el)el.textContent=onbData.shopSlug;}
function onbListEditor(key,title,formFn,btnLabel){
  const list=onbData[key]||[];
  return `<div class="onb-copy"><b>${escapeHtml(title)}</b><span>Cadastre pelo menos um item para publicar a página.</span></div>
  <div id="onb_${key}_list">${list.map((item,i)=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon(key==='services'?'scissors':'user')}</span><div><b>${escapeHtml(item.name)}</b><br><small>${escapeHtml(key==='services'?`${item.duration} min · ${money(item.price)}`:(item.role||'Profissional'))}</small></div><button class="ra del" onclick="onbRemove('${key}',${i})">${icon('trash')}</button></div>`).join('')||emptyState(key==='services'?'scissors':'users','Nada cadastrado','Adicione o primeiro item abaixo.')}
  </div>${window[formFn]()}`;
}
function onbProfessionalForm(){return `<div class="panel" style="margin:14px 0 0"><div class="form-row"><div class="field"><label>Nome *</label><input class="input" id="onb_prof_name" placeholder="Ex.: Lucas Silva"></div><div class="field"><label>Cargo</label><input class="input" id="onb_prof_role" placeholder="Barbeiro"></div></div><div style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="onbAddProfessional()">${icon('plus')} Adicionar profissional</button></div></div>`;}
function onbServiceForm(){return `<div class="panel" style="margin:14px 0 0"><div class="field"><label>Nome *</label><input class="input" id="onb_svc_name" placeholder="Ex.: Corte Masculino"></div><div class="form-row"><div class="field"><label>Duração</label><input class="input" type="number" id="onb_svc_duration" value="30" min="5"></div><div class="field"><label>Preço</label><input class="input" type="number" id="onb_svc_price" value="45" min="0"></div></div><div style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="onbAddService()">${icon('plus')} Adicionar serviço</button></div></div>`;}
function onbAddProfessional(){const name=$('#onb_prof_name').value.trim();if(name.length<2){toast('Informe o nome do profissional.','err');return;}onbData.professionals=onbData.professionals||[];onbData.professionals.push({name,role:$('#onb_prof_role').value.trim()||'Profissional'});onbRefreshContent();}
function onbAddService(){const name=$('#onb_svc_name').value.trim();if(name.length<2){toast('Informe o nome do serviço.','err');return;}onbData.services=onbData.services||[];onbData.services.push({name,duration:+$('#onb_svc_duration').value||30,price:+$('#onb_svc_price').value||0,category:'Serviços'});onbRefreshContent();}
function onbRemove(key,i){onbData[key].splice(i,1);onbRefreshContent();}
function onbCollectBusinessInfo(){
  const shop=$('#onb_shop').value.trim();if(shop.length<2){toast('Informe o nome do negócio.','err');return false;}
  const whatsapp=$('#onb_wa').value.trim();if(whatsapp.replace(/\D/g,'').length<8){toast('Informe o WhatsApp.','err');return false;}
  onbData.shopName=shop;onbData.category=$('#onb_category').value;onbData.shopSlug=onbBusinessSlug(shop);onbData.logoFile=$('#onb_logo').files[0]||onbData.logoFile||null;onbData.coverFile=$('#onb_cover').files[0]||onbData.coverFile||null;
  onbData.instagram=$('#onb_instagram').value.trim();onbData.whatsapp=whatsapp;onbData.phone=$('#onb_phone').value.trim();onbData.address=$('#onb_addr').value.trim();onbData.timezone=$('#onb_tz').value;
  onbData.hours={open:$('#onb_open').value,close:$('#onb_close').value,lunchStart:$('#onb_lunch_start').value,lunchEnd:$('#onb_lunch_end').value,days:$$('#onb_days .chip-toggle.on').map(x=>+x.dataset.day)};
  return true;
}
function onbNext(){
  if(onbStep===1){const name=$('#onb_name').value.trim(),email=$('#onb_email').value.trim(),pass=$('#onb_pass').value;let ok=true;const inv=(id,bad)=>{$('#'+id).closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};inv('onb_name',name.length<2);inv('onb_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));inv('onb_pass',pass.length<6);if(!ok){toast('Confira os campos destacados.','err');return;}onbData.name=name;onbData.email=email;onbData.pass=pass;}
  if(onbStep===3&&!onbCollectBusinessInfo())return;
  if(onbStep===4&&!(onbData.professionals||[]).length){toast('Adicione pelo menos um profissional.','err');return;}
  if(onbStep===5&&!(onbData.services||[]).length){toast('Adicione pelo menos um serviço.','err');return;}
  onbStep++;onbRefreshContent();
}
function onbBack(){onbStep=Math.max(1,onbStep-1);onbRefreshContent();}
function submitOnboarding(){
  if(!window.__FB_ENABLED||!window.fbSignUpOwner){toast('Firebase precisa estar ativo para publicar sua página.','err');return;}
  const btn=$('#onb_submit');const origBtnHTML=btn?btn.innerHTML:null;
  if(btn){btn.disabled=true;btn.innerHTML='Publicando no Firestore...';}
  fbSignUpOwner({shopName:onbData.shopName,ownerName:onbData.name,email:onbData.email,password:onbData.pass,phone:onbData.phone,whatsapp:onbData.whatsapp,address:onbData.address||'',slugOverride:onbData.shopSlug,planId:onbData.planId,category:onbData.category,instagram:onbData.instagram,timezone:onbData.timezone,hours:onbData.hours,professionals:onbData.professionals,services:onbData.services,logoFile:onbData.logoFile,coverFile:onbData.coverFile})
    .then(()=>{closeModal();toast('Página publicada com sucesso!','ok');})
    .catch(err=>{if(btn&&origBtnHTML){btn.disabled=false;btn.innerHTML=origBtnHTML;}toast(fbErrMsg(err,'signup'),'err');});
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
  if(/user-not-found|wrong-password|invalid-credential/.test(c))return 'E-mail ou senha incorretos.';
  if(/already-exists/.test(c))return 'Esse horário acabou de ser reservado.';
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
  const loginShop=loginShopId?DB.find('barbershops',loginShopId):null;
  const loginBrand=loginShop?`<span class="logo">${brandLogo(loginShop,'brand-logo-img')}</span><span style="color:#fff">${escapeHtml(loginShop.name)}<small style="color:#cdc7bb">Área da barbearia</small></span>`:`<span class="logo">${icon('scissors')}</span><span style="color:#fff">Groomin<small style="color:#cdc7bb">Plataforma de Gestão</small></span>`;
  $('#root').innerHTML=`
  <div class="auth-screen">
    <div class="auth-side">
      <div class="brand" style="color:#fff">${loginBrand}</div>
      <div>
        <div class="auth-quote">"O Groomin organizou minha barbearia e aumentou meu faturamento em mais de 30% no primeiro trimestre."</div>
        <div style="margin-top:14px;font-weight:700">Marcelo Dias · Barber Club</div>
        <div class="auth-feat">${icon('shield')} <span>Dados seguros e na nuvem</span></div>
        <div class="auth-feat">${icon('cpu')} <span>Inteligência artificial para o seu negócio</span></div>
        <div class="auth-feat">${icon('whatsapp')} <span>Lembretes automáticos por WhatsApp</span></div>
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
      <div class="field"><label>E-mail</label><div class="input-icon">${icon('mail')}<input class="input" id="lg_email" placeholder="voce@email.com" value="${window.USE_FIREBASE?'':'joao@barbeariadojoao.com'}"></div></div>
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
      <p style="text-align:center;margin-top:18px;font-size:13px" class="muted">Não tem conta? <a style="color:var(--primary);font-weight:700;cursor:pointer" onclick="openTrialSignup('growth')">Criar conta</a></p>
    </div></div>
  </div>`;
}
function renderSignup(){
  if(Session.user){location.hash=homeRouteFor(Session.effectiveUser.role);return;}
  renderLogin();
  setTimeout(()=>openOnboarding(),0);
}
function fillLogin(e,p){$('#lg_email').value=e;$('#lg_pass').value=p;doLogin();}
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
