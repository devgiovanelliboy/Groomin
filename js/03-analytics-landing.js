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
  return {totalShops:d.barbershops.length,activeShops:activeShops.length,totalCustomers:d.customers.length,totalAppts:d.appointments.length,
    activeSubs:activeSubs.length,mrr,churn,growth,months,mrrSeries,shopSeries,
    planDist:d.plans.map(p=>({name:p.name,count:d.barbershops.filter(s=>s.planId===p.id).length}))};
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
const ENT_FEATURES=[['ai','IA & Business Intelligence','cpu'],['apiAccess','Acesso à API','layers'],['whiteLabel','White Label','award'],['mobileApp','App Mobile','phone'],['advancedReports','Relatórios avançados','chart']];

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
function goPricing(){
  closeModal();
  const u=Session.effectiveUser;
  if(u&&(u.role==='owner'||u.role==='manager')){Router.go('#/dashboard/assinatura');return;}
  Router.go('#/');
  setTimeout(()=>{const el=document.getElementById('pricing');if(el)el.scrollIntoView({behavior:'smooth'});},280);
}
function showUpgrade(label,plan,enterprise){
  const ctaEnt=enterprise===true||enterprise==='true';
  const u=Session.effectiveUser;
  const upgradeCTA=ctaEnt
    ?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener" onclick="closeModal()">${icon('whatsapp')} Falar com vendas</a>`
    :(u&&(u.role==='owner'||u.role==='manager'))
      ?`<button class="btn btn-primary" onclick="goPricing()">${icon('rocket')} Ver minha assinatura</button>`
      :`<button class="btn btn-primary" onclick="goPricing()">${icon('rocket')} Conhecer o plano ${escapeHtml(plan)}</button>`;
  openModal(`<div class="modal-head"><div><h3>${icon('lock')} ${escapeHtml(label)}</h3><div class="sub">${ctaEnt?'Recurso não incluído no seu contrato':'Disponível em um plano superior'}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="insight" style="border-left-color:var(--primary);margin-bottom:14px"><span class="ii">${icon('sparkle')}</span><div><b>${escapeHtml(label)} ${ctaEnt?'pode ser liberado no seu plano Enterprise':'faz parte do plano '+escapeHtml(plan)}</b><p>${ctaEnt?'Fale com o seu contato comercial para incluir este recurso ao seu contrato sob medida.':'Desbloqueie este e outros recursos para crescer sua barbearia. Sem fidelidade — faça upgrade quando quiser.'}</p></div></div>
    ${ctaEnt?'':`<div class="muted" style="font-size:13.5px">No <b>${escapeHtml(plan)}</b> você também ganha mais profissionais, relatórios e automações.</div>`}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Agora não</button>${upgradeCTA}</div>`);
}
function lockedFeaturePage(label,plan,enterprise){
  return `<div class="empty" style="padding:64px 20px"><div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon('lock')}</div>
    <h3>${escapeHtml(label)} ${enterprise?'não está incluído no seu contrato':'faz parte do plano '+escapeHtml(plan)}</h3>
    <p style="max-width:460px;margin:0 auto 20px">${enterprise?'Fale com o seu contato comercial para incluir este recurso ao seu plano Enterprise.':'Desbloqueie '+escapeHtml(label.toLowerCase())+' e leve sua gestão para o próximo nível. Você pode fazer upgrade quando quiser, sem fidelidade.'}</p>
    ${enterprise?`<a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener">${icon('whatsapp')} Falar com vendas</a>`:`<button class="btn btn-primary" onclick="goPricing()">${icon('rocket')} Conhecer o plano ${escapeHtml(plan)}</button>`}</div>`;
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
    <a onclick="Router.go('#/find-barbershops')">Encontrar barbearia</a>
  </nav>
  <div class="nav-right">
    <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
    <button class="btn btn-ghost btn-sm" onclick="Router.go('#/login')">Entrar</button>
    <button class="btn btn-primary btn-sm" onclick="openTrialSignup()">${icon('rocket')} Teste Grátis</button>
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
        <p class="lead">Agenda online, CRM, financeiro, estoque, marketing e inteligência artificial em uma única plataforma. Tudo o que você precisa para crescer.</p>
        <div class="hero-cta">
          <button class="btn btn-primary" onclick="openTrialSignup()">${icon('rocket')} Começar Teste Grátis</button>
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
           ['users','Fidelize clientes','CRM identifica clientes VIP, inativos e aniversariantes automaticamente.'],
           ['cpu','Decisões com IA','Recomendações práticas de negócio baseadas nos seus próprios dados.'],
           ['dollar','Controle financeiro','Receitas, despesas, comissões e lucro em relatórios claros.'],
           ['shield','Seguro e na nuvem','Seus dados protegidos, acesse de qualquer lugar e dispositivo.']
        ].map(([i,t,p])=>`<div class="feature"><div class="f-ic">${icon(i)}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
      </div>
    </div></section>

    <section id="features" style="background:var(--bg-2)"><div class="container">
      <div class="section-head"><span class="eyebrow">${icon('layers')} Recursos</span><h2>Tudo em uma plataforma só</h2></div>
      ${landingBench('grid','Dashboard inteligente','Acompanhe em tempo real os números que importam: agendamentos do dia, receita, ocupação, clientes novos e recorrentes.',['Métricas e gráficos em tempo real','Receita do dia e do mês','Taxa de ocupação e retenção','Ranking de serviços e barbeiros'],dashShot(),false)}
      ${landingBench('calendar','Agenda online sem conflitos','Sistema de agendamento que impede overbooking e respeita horários, almoço e folgas de cada profissional.',['Visões dia, semana e mês','Bloqueio de horários e dias','Múltiplos barbeiros e férias','Prevenção de agendamento duplo'],schedShot(),true)}
      ${landingBench('heart','CRM que fideliza','Conheça seus clientes a fundo e crie campanhas automáticas que trazem eles de volta.',['Histórico completo e gasto total','Segmentos: VIP, inativos, frequentes','Campanhas de aniversário e reativação','WhatsApp, e-mail e in-app'],crmShot(),false)}
      ${landingBench('box','Estoque e financeiro','Controle produtos, custos e margens. Baixa automática de estoque e alertas de reposição.',['Cadastro de produtos e SKU','Baixa automática e estoque mínimo','Comissões por barbeiro','Relatórios e exportação'],invShot(),true)}
      ${landingBench('cpu','Insights de Inteligência Artificial','A plataforma analisa seus dados e sugere ações concretas para crescer.',['Detecta horários ociosos','Identifica barbeiros em alta demanda','Alerta clientes prestes a sumir','Recomendações acionáveis'],aiShot(),false)}
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
      <div class="section-head"><span class="eyebrow">${icon('creditCard')} Planos</span><h2>Escolha o plano que faz sua barbearia crescer</h2><p>Comece grátis, sem cartão. Atualize quando quiser. Economize até 25% no plano anual.</p></div>
      <div id="pricingWrap">${pricingInner()}</div>
    </div></section>

    <section id="faq"><div class="container" style="max-width:820px">
      <div class="section-head"><span class="eyebrow">${icon('inbox')} Dúvidas</span><h2>Perguntas frequentes</h2></div>
      ${[['Preciso instalar algo?','Não. O Groomin é 100% na nuvem. Você acessa pelo navegador no computador ou celular.'],
         ['Como funciona o teste grátis?','Você cria sua conta em segundos, recebe seu link público e já pode receber agendamentos. Sem cartão de crédito.'],
         ['Meus clientes precisam criar conta?','Não. Eles agendam direto pelo seu link informando nome, WhatsApp e e-mail. A conta só é necessária se quiserem gerenciar os próprios horários.'],
         ['Posso ter vários barbeiros?','Sim. Cada plano suporta um número de profissionais, com horários, comissões e férias individuais.'],
         ['Como recebo os agendamentos?','Notificações no painel, e-mail e WhatsApp (templates prontos e personalizáveis).']
      ].map((f,i)=>`<div class="faq-item" onclick="this.classList.toggle('open')"><div class="faq-q">${f[0]} ${icon('plus')}</div><div class="faq-a"><div>${f[1]}</div></div></div>`).join('')}
    </div></section>

    <div class="cta-band" id="contato">
      <span class="eyebrow">${icon('rocket')} Pronto para crescer?</span>
      <h2>Comece a transformar sua barbearia hoje</h2>
      <p>Crie sua conta gratuita e tenha seu link de agendamentos em menos de 2 minutos.</p>
      <button class="btn btn-primary" onclick="openTrialSignup()">${icon('rocket')} Começar Teste Grátis</button>
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
  const grid=`<div class="pricing-grid">${d.plans.filter(p=>!p.enterprise).map(p=>landingPlanCard(p)).join('')}</div>`;
  return toggle+grid+comparisonTable()+enterpriseTeaser();
}
function landingPlanCard(p){
  const featured=p.id==='pro';const elite=p.id==='elite';
  const period=DB.get().billing[billingPeriod];
  const eff=planMonthly(p);const totalPeriod=eff*period.months;const savings=(p.price-eff)*period.months;
  const priceBlock=p.price===0
    ? `<div class="pc-price">Grátis</div><div class="pc-bill muted">para sempre</div>`
    : `<div class="pc-price">R$ ${eff.toLocaleString('pt-BR',{minimumFractionDigits:eff%1?2:0,maximumFractionDigits:2})}<small>/mês</small></div>
       <div class="pc-bill muted">${billingPeriod==='monthly'?`cobrado mensalmente`:`${money(totalPeriod)} a cada ${period.months} meses`}</div>
       ${savings>0?`<div class="pc-save">${icon('trending')} Economize ${money(savings)}</div>`:''}`;
  return `<div class="price-card ${featured?'featured':''}">
    ${p.badge?`<span class="pc-tag">${escapeHtml(p.badge)}</span>`:''}
    <h3>${escapeHtml(p.name)}</h3>
    ${priceBlock}
    <div class="pc-desc">${escapeHtml(p.tagline||'')}</div>
    <ul>${p.features.map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}${(p.notIncluded||[]).slice(0,3).map(f=>`<li class="off">${icon('x')} ${escapeHtml(f)}</li>`).join('')}</ul>
    <button class="btn ${featured?'btn-primary':elite?'btn-primary':'btn-outline'} btn-block" onclick="openTrialSignup('${p.id}')">${p.price===0?'Começar grátis':'Assinar '+escapeHtml(p.name)}</button>
    <p class="muted" style="text-align:center;font-size:11.5px;margin-top:10px">${p.price===0?'Sem cartão de crédito':'7 dias de teste · sem fidelidade'}</p>
  </div>`;
}
const PRICING_MATRIX=[
  ['Profissionais',['1','Até 3','Até 8','Ilimitado']],
  ['Agendamentos / mês',['50','Ilimitado','Ilimitado','Ilimitado']],
  ['Página pública + agenda online',[true,true,true,true]],
  ['Lembretes por WhatsApp',[false,true,true,true]],
  ['CRM e histórico do cliente',[false,true,true,true]],
  ['Relatórios',['—','Essenciais','Avançados','Executivos']],
  ['Marketing e promoções',[false,false,true,true]],
  ['Estoque e PDV',[false,false,true,true]],
  ['Financeiro e comissões',[false,false,true,true]],
  ['Segmentação de clientes',[false,false,true,true]],
  ['Multi-unidades',[false,false,false,true]],
  ['IA & Business Intelligence',[false,false,false,true]],
  ['Campanhas de recuperação automáticas',[false,false,false,true]],
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
      <p class="muted" style="font-size:14.5px;max-width:520px">Plano Enterprise com preço e limites personalizados: profissionais e unidades ilimitados, API, White Label, app mobile, BI com IA e suporte dedicado.</p></div>
    <button class="btn btn-primary" onclick="openModal(enterpriseContactModal())">${icon('mail')} Falar com vendas</button>
  </div>`;
}
function enterpriseContactModal(){return `<div class="modal-head"><div><h3>Plano Enterprise</h3><div class="sub">Atendimento consultivo para sua operação</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><p class="muted" style="margin-bottom:14px">Conte um pouco sobre sua barbearia/rede e montamos um plano sob medida — preço, profissionais, unidades e recursos liberados conforme a sua necessidade.</p>
  ${ENT_FEATURES.map(f=>`<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon(f[2])}</span><div><b>${f[1]}</b></div><span class="badge gold" style="margin-left:auto">incluível</span></div>`).join('')}
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Fechar</button><a class="btn btn-primary" href="https://wa.me/5511999990000" target="_blank" rel="noopener" onclick="closeModal()">${icon('whatsapp')} Chamar no WhatsApp</a></div>`;}
function comparisonTable(){
  const plans=DB.get().plans.filter(p=>!p.enterprise);
  return `<div style="margin-top:46px"><div class="section-head" style="margin-bottom:24px"><h2 style="font-size:clamp(1.5rem,3vw,2rem)">Compare os planos em detalhe</h2></div>
  <div class="table-wrap cmp-wrap"><table class="cmp"><thead><tr><th>Recursos</th>${plans.map(p=>`<th class="${p.id==='pro'?'cmp-feat':''}">${escapeHtml(p.name)}${p.badge?`<span class="badge gold" style="display:block;margin-top:5px;font-size:9px">${escapeHtml(p.badge)}</span>`:''}<div style="font-family:var(--font-sans);font-weight:700;font-size:13px;margin-top:4px;color:var(--text)">${p.price===0?'Grátis':'R$ '+Math.round(planMonthly(p))+'/mês'}</div></th>`).join('')}</tr></thead>
  <tbody>${PRICING_MATRIX.map(row=>`<tr><td style="text-align:left">${escapeHtml(row[0])}</td>${row[1].map((v,i)=>`<td class="${plans[i]&&plans[i].id==='pro'?'cmp-feat':''}">${cmpCell(v)}</td>`).join('')}</tr>`).join('')}
  <tr><td></td>${plans.map(p=>`<td class="${p.id==='pro'?'cmp-feat':''}"><button class="btn ${p.id==='pro'?'btn-primary':'btn-outline'} btn-sm" onclick="openTrialSignup('${p.id}')">${p.price===0?'Começar':'Assinar'}</button></td>`).join('')}</tr>
  </tbody></table></div></div>`;
}
function landingFooter(){return `<footer class="site"><div class="container">
  <div class="foot-grid">
    <div><div class="brand" style="margin-bottom:14px"><span class="logo">${icon('scissors')}</span><span>Groomin</span></div>
      <p class="muted" style="font-size:14px;max-width:300px">A plataforma completa de gestão para barbearias do Brasil.</p></div>
    <div><h4>Produto</h4><a onclick="lscroll('benefits')">Benefícios</a><a onclick="lscroll('features')">Recursos</a><a onclick="lscroll('pricing')">Planos</a></div>
    <div><h4>Empresa</h4><a onclick="lscroll('faq')">FAQ</a><a onclick="Router.go('#/find-barbershops')">Marketplace</a><a onclick="Router.go('#/login')">Entrar</a></div>
    <div><h4>Comece agora</h4><a onclick="openOnboarding()">Teste grátis</a>${window.USE_FIREBASE?'':`<a onclick="openDemo()">Demonstração</a>`}<a>contato@groomin.com.br</a></div>
  </div>
  <div class="foot-bottom"><span>© 2026 Groomin. Todos os direitos reservados.</span><span>Feito com ✂ para barbearias do Brasil</span></div>
</div></footer>`;}

function openDemo(){
  if(window.USE_FIREBASE){openTrialSignup();return;} // em produção: criar conta real
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

function openOnboarding(planId){
  // Se já autenticado como dono, vai direto para assinatura
  const u=Session.effectiveUser;
  if(u&&(u.role==='owner'||u.role==='manager')){Router.go('#/dashboard/assinatura');return;}
  planId=typeof planId==='string'?planId:'free';
  onbStep=1;onbData={planId};
  renderOnboarding();
}
// Retrocompatibilidade
window.openTrialSignup=openOnboarding;

function renderOnboarding(){
  const titles=['Dados pessoais','Sua barbearia','Escolha o plano','Confirmar'];
  const stepsHtml=titles.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  openModal(`<div class="modal-head"><div><h3>Criar conta no Groomin</h3><div class="sub">Sua barbearia online em minutos</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="wizard-steps" id="onbStepper">${stepsHtml}</div>
  <div class="modal-body" id="onbBody">${renderOnbStep()}</div>
  <div class="modal-foot" id="onbFoot">${renderOnbFoot()}</div>`,'lg');
}

function renderOnbStep(){
  if(onbStep===1){
    return `<div class="field"><label>Seu nome *</label><div class="input-icon">${icon('user')}<input class="input" id="onb_name" value="${escapeHtml(onbData.name||'')}" placeholder="Nome completo"></div><div class="err">Informe seu nome.</div></div>
    <div class="field"><label>E-mail *</label><div class="input-icon">${icon('mail')}<input class="input" id="onb_email" value="${escapeHtml(onbData.email||'')}" placeholder="voce@email.com"></div><div class="err">E-mail inválido.</div></div>
    <div class="field"><label>Senha *</label><div class="input-icon">${icon('lock')}<input class="input" type="password" id="onb_pass" placeholder="Mínimo 6 caracteres"></div><div class="err">Mínimo 6 caracteres.</div></div>`;
  }
  if(onbStep===2){
    const slug=onbData.shopSlug||slugify(onbData.shopName||'')||'sua-barbearia';
    return `<div class="field"><label>Nome da barbearia *</label><input class="input" id="onb_shop" value="${escapeHtml(onbData.shopName||'')}" placeholder="Ex.: Hora Barbearia" oninput="onbSlugPreview(this.value)"><div class="err">Informe o nome.</div></div>
    <div class="field"><label>URL pública gerada</label>
      <div class="input" style="background:var(--surface-3);display:flex;align-items:center;gap:6px;cursor:default">
        <span class="muted" style="white-space:nowrap;font-size:12px">${(location.origin+'/b/').replace(/^https?:\/\//,'')}</span><b id="onb_slug_preview" style="color:var(--primary);flex:1">${escapeHtml(slug)}</b>
        <button class="btn btn-ghost btn-sm" style="padding:2px 8px;flex-shrink:0" onclick="onbToggleSlug()">${icon('edit')}</button>
      </div>
      <div id="onb_slug_edit" style="display:none;margin-top:8px">
        <input class="input" id="onb_slug" value="${escapeHtml(slug)}" placeholder="sua-barbearia" oninput="onbSlugInput(this.value)">
        <p class="muted" style="font-size:12px;margin-top:4px">Apenas letras minúsculas, números e hífens.</p>
      </div>
    </div>
    <div class="form-row">
      <div class="field"><label>Telefone</label><input class="input" id="onb_phone" value="${escapeHtml(onbData.phone||'')}" placeholder="(11) 9 0000-0000"></div>
      <div class="field"><label>WhatsApp</label><input class="input" id="onb_wa" value="${escapeHtml(onbData.wa||'')}" placeholder="(11) 9 0000-0000"></div>
    </div>
    <div class="field"><label>Endereço</label><input class="input" id="onb_addr" value="${escapeHtml(onbData.address||'')}" placeholder="Rua, número — Bairro, Cidade"></div>`;
  }
  if(onbStep===3){
    const plans=DB.get().plans.filter(p=>!p.enterprise);
    return `<p class="muted" style="margin-bottom:16px;font-size:14px">Você pode mudar de plano a qualquer momento. Comece grátis e expanda quando quiser.</p>
    <div class="pricing-grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">${plans.map(p=>{
      const sel=onbData.planId===p.id;
      return `<div class="price-card ${sel?'featured':''}" style="cursor:pointer;position:relative" onclick="onbPickPlan('${p.id}')">
        ${sel?`<span class="pc-tag">${icon('check')} Selecionado</span>`:p.badge?`<span class="pc-tag">${escapeHtml(p.badge)}</span>`:''}
        <h3>${escapeHtml(p.name)}</h3>
        <div class="pc-price">${p.price===0?'Grátis':'R$ '+p.price+'<small>/mês</small>'}</div>
        <div class="pc-desc" style="font-size:12.5px">${escapeHtml(p.tagline||'')}</div>
        <ul style="font-size:12.5px;margin-top:8px">${p.features.slice(0,4).map(f=>`<li>${icon('check')} ${escapeHtml(f)}</li>`).join('')}</ul>
      </div>`;}).join('')}
    </div>`;
  }
  if(onbStep===4){
    const plan=DB.find('plans',onbData.planId)||DB.find('plans','free');
    const isFree=plan.price===0;
    return `<div class="card" style="padding:24px;text-align:center;background:linear-gradient(135deg,rgba(212,175,55,.12),transparent),var(--surface-2)">
      <div class="ei" style="background:var(--primary-soft);color:var(--primary);margin:0 auto 16px">${icon('rocket')}</div>
      <h3 style="font-size:22px;margin-bottom:6px">${isFree?'Tudo pronto!':'Comece seu teste grátis de 7 dias'}</h3>
      <p class="muted" style="max-width:380px;margin:0 auto 18px">${isFree?'Sua barbearia no plano Grátis estará online em segundos. Sem cartão de crédito.':'Experimente o plano <b>'+escapeHtml(plan.name)+'</b> por 7 dias sem compromisso. Sem cartão necessário.'}</p>
      <div class="card" style="padding:16px;text-align:left;max-width:340px;margin:0 auto">
        <div class="summary-line"><span class="muted">Nome</span><b>${escapeHtml(onbData.name||'')}</b></div>
        <div class="summary-line"><span class="muted">E-mail</span><b>${escapeHtml(onbData.email||'')}</b></div>
        <div class="summary-line"><span class="muted">Barbearia</span><b>${escapeHtml(onbData.shopName||'')}</b></div>
        <div class="summary-line"><span class="muted">Link</span><b style="color:var(--primary);font-size:12.5px">${escapeHtml((location.origin+'/b/'+(onbData.shopSlug||'')).replace(/^https?:\/\//,''))}</b></div>
        <div class="summary-line"><span class="muted">Plano</span><b>${escapeHtml(plan.name)}${isFree?'':' · 7 dias grátis'}</b></div>
      </div>
    </div>`;
  }
  return '';
}

function renderOnbFoot(){
  if(onbStep===1)return `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="onbNext()">Próximo ${icon('arrowRight')}</button>`;
  if(onbStep===2)return `<button class="btn btn-ghost" onclick="onbBack()">${icon('arrowLeft')} Voltar</button><button class="btn btn-primary" onclick="onbNext()">Próximo ${icon('arrowRight')}</button>`;
  if(onbStep===3)return `<button class="btn btn-ghost" onclick="onbBack()">${icon('arrowLeft')} Voltar</button><button class="btn btn-primary" onclick="onbNext()">Próximo ${icon('arrowRight')}</button>`;
  const plan=DB.find('plans',onbData.planId)||DB.find('plans','free');
  return `<button class="btn btn-ghost" onclick="onbBack()">${icon('arrowLeft')} Voltar</button><button class="btn btn-primary" onclick="submitOnboarding()">${plan.price===0?icon('check')+' Criar minha barbearia':icon('rocket')+' Iniciar teste grátis'}</button>`;
}

function onbRefreshContent(){
  const titles=['Dados pessoais','Sua barbearia','Escolha o plano','Confirmar'];
  const st=$('#onbStepper');if(st)st.innerHTML=titles.map((t,i)=>{const n=i+1;const cls=onbStep===n?'active':onbStep>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${onbStep>n?icon('check'):n}</div><div class="lbl">${escapeHtml(t)}</div></div>`;}).join('');
  const b=$('#onbBody');if(b)b.innerHTML=renderOnbStep();
  const f=$('#onbFoot');if(f)f.innerHTML=renderOnbFoot();
}

function onbSlugPreview(val){
  onbData.shopName=val;onbData.shopSlug=slugify(val)||'sua-barbearia';
  const el=$('#onb_slug_preview');if(el)el.textContent=onbData.shopSlug;
  const si=$('#onb_slug');if(si)si.value=onbData.shopSlug;
}
function onbToggleSlug(){const el=$('#onb_slug_edit');if(el)el.style.display=el.style.display==='none'?'block':'none';}
function onbSlugInput(val){onbData.shopSlug=slugify(val)||'sua-barbearia';const el=$('#onb_slug_preview');if(el)el.textContent=onbData.shopSlug;}
function onbPickPlan(id){onbData.planId=id;const b=$('#onbBody');if(b)b.innerHTML=renderOnbStep();}

function onbNext(){
  if(onbStep===1){
    const name=$('#onb_name').value.trim(),email=$('#onb_email').value.trim(),pass=$('#onb_pass').value;
    let ok=true;const inv=(id,bad)=>{$('#'+id).closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
    inv('onb_name',name.length<2);inv('onb_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));inv('onb_pass',pass.length<6);
    if(!ok){toast('Confira os campos destacados.','err');return;}
    onbData.name=name;onbData.email=email;onbData.pass=pass;
  }else if(onbStep===2){
    const shop=$('#onb_shop').value.trim();
    if(shop.length<2){toast('Informe o nome da barbearia.','err');return;}
    onbData.shopName=shop;
    const slugEl=$('#onb_slug');
    onbData.shopSlug=slugEl&&slugEl.style.display!=='none'?slugify(slugEl.value)||slugify(shop):slugify(shop)||'barbearia';
    onbData.phone=$('#onb_phone').value.trim();
    onbData.wa=$('#onb_wa').value.trim();
    onbData.address=$('#onb_addr').value.trim();
  }
  onbStep++;onbRefreshContent();
}
function onbBack(){onbStep=Math.max(1,onbStep-1);onbRefreshContent();}

function submitOnboarding(){
  const{name,email,pass,shopName,shopSlug,phone,wa,address,planId}=onbData;
  const plan=DB.find('plans',planId)||DB.find('plans','free');
  if(window.__FB_ENABLED){
    toast('Criando sua barbearia...','info');
    fbSignUpOwner({shopName,ownerName:name,email,password:pass,phone:phone||wa,whatsapp:wa||phone,address:address||'',slugOverride:shopSlug,planId:planId||'free'})
      .then(()=>{closeModal();toast('Barbearia criada com sucesso! 🎉','ok');})
      .catch(err=>toast(/email-already/.test(err.code||'')?'Esse e-mail já está cadastrado.':'Falha ao criar a conta.','err'));
    return;
  }
  if(DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase())){toast('Esse e-mail já está cadastrado.','err');onbStep=1;onbRefreshContent();return;}
  let slug=shopSlug||slugify(shopName)||'barbearia';let base=slug,i=1;
  while(DB.get().barbershops.find(s=>s.slug===slug)){slug=base+'-'+(++i);}
  const shopId=DB.uid('shop');
  DB.insert('barbershops',{id:shopId,slug,name:shopName,ownerName:name,description:'Barbearia cadastrada no Groomin.',logoUrl:'',logoPath:'',address:address||'',city:'',neighborhood:'',phone:phone||'',whatsapp:wa||phone||'',email,instagram:'',open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',planId:planId||'free',status:'active',rating:0,createdAt:Date.now(),slotInterval:30});
  DB.insert('subscriptions',{barbershopId:shopId,planId:planId||'free',status:planId==='free'?'active':'trialing',mrr:plan.price,startedAt:Date.now(),renewsAt:DB.addDays(DB.todayISO(),planId==='free'?0:7)});
  DB.insert('users',{name,email,password:pass,role:'owner',barbershopId:shopId,active:true});
  DB.insert('services',{barbershopId:shopId,name:'Corte Masculino',desc:'Corte personalizado.',price:45,duration:30,category:'Cabelo',icon:'scissors',active:true});
  DB.insert('barbers',{barbershopId:shopId,name,role:'Proprietário & Barbeiro',photoUrl:'',photoPath:'',bio:'',phone:phone||'',email,specialties:['Corte'],commission:0,productCommission:0,isOwner:true,start:'09:00',end:'19:00',lunchStart:'12:00',lunchEnd:'13:00',days:[1,2,3,4,5,6],vacations:[],active:true,rating:5});
  DB.log('Barbearia criada',shopName,shopId);
  Session.login(email,pass);closeModal();toast('Barbearia criada com sucesso! 🎉','ok');
  location.hash='#/dashboard';
}

/* ============================================================
   LOGIN (single page, role-based redirect)
   ============================================================ */
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
        <label class="checkbox-row" style="font-size:13px"><input type="checkbox" checked> Lembrar de mim</label>
        <a class="muted" style="font-size:13px;cursor:pointer" onclick="toast('Enviamos um link de recuperação para o seu e-mail.','info')">Esqueci a senha</a>
      </div>
      <button class="btn btn-primary btn-block" onclick="doLogin()">${icon('arrowRight')} Entrar</button>
      ${window.USE_FIREBASE?'':`<div class="divider">contas de demonstração</div>
      <div class="role-demos">
        <button class="role-demo" onclick="fillLogin('super@groomin.com.br','super123')"><b>Super Admin</b>super@groomin.com.br</button>
        <button class="role-demo" onclick="fillLogin('joao@barbeariadojoao.com','owner123')"><b>Proprietário</b>joao@barbeariadojoao.com</button>
        <button class="role-demo" onclick="fillLogin('gerente@barbeariadojoao.com','manager123')"><b>Gerente</b>gerente@barbeariadojoao.com</button>
        <button class="role-demo" onclick="fillLogin('recepcao@barbeariadojoao.com','recep123')"><b>Recepcionista</b>recepcao@…</button>
        <button class="role-demo" onclick="fillLogin('rafael@barbeariadojoao.com','barber123')"><b>Barbeiro</b>rafael@…</button>
        <button class="role-demo" onclick="fillLogin('cliente@email.com','cliente123')"><b>Cliente</b>cliente@email.com</button>
      </div>`}
      <p style="text-align:center;margin-top:18px;font-size:13px" class="muted">Não tem conta? <a style="color:var(--primary);font-weight:700;cursor:pointer" onclick="openTrialSignup()">Criar barbearia grátis</a></p>
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
  if(window.__FB_ENABLED){ // backend real: Firebase Auth (claims definem tenant/role)
    fbSignIn(email,pass).catch(err=>toast(/password|credential|user/.test(err.code||'')?'E-mail ou senha incorretos.':'Falha no login.','err'));
    return;
  }
  const u=Session.login(email,pass);
  if(!u){toast('E-mail ou senha incorretos.','err');return;}
  DB.log('Login realizado',ROLE_LABEL[u.role]);
  toast(`Olá, ${u.name.split(' ')[0]}!`,'ok');
  const intended=sessionStorage.getItem('groomin_intended');sessionStorage.removeItem('groomin_intended');
  location.hash=(intended&&intended.length)?intended:homeRouteFor(u.role);
}
