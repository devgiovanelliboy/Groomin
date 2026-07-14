/* ============================================================
   AVAILABILITY ENGINE (tenant-aware, conflict-safe)
   ============================================================ */
function addToCalendar(){
  const d=window._lastAppt||{};if(!d.date||!d.time)return;
  const[y,mo,dy]=d.date.split('-').map(Number);const[h,mi]=d.time.split(':').map(Number);
  const pad=n=>String(n).padStart(2,'0');
  const dtFmt=(H,Mi)=>`${y}${pad(mo)}${pad(dy)}T${pad(H)}${pad(Mi)}00`;
  const endM=h*60+mi+(d.duration||30);
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Groomin//Groomin//PT','BEGIN:VEVENT',
    `UID:groomin-${Date.now()}@groomin.com.br`,`DTSTAMP:${dtFmt(h,mi)}`,
    `DTSTART:${dtFmt(h,mi)}`,`DTEND:${dtFmt(Math.floor(endM/60),endM%60)}`,
    `SUMMARY:${(d.serviceName||'Agendamento')} — ${(d.shopName||'')}`,
    `LOCATION:${d.shopAddress||''}`,`DESCRIPTION:Profissional: ${d.barberName||'A definir'}`,
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='agendamento.ics';
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}
function barberSlots(shopId,barberId,dateISO,duration){
  const shop=DB.find('barbershops',shopId);const barber=DB.find('barbers',barberId);
  if(!shop||!barber||!barber.active||shop.schedulePaused)return [];
  const dow=new Date(dateISO+'T00:00:00').getDay();
  const dayHours=shopDayHours(shop,dow);
  if(!dayHours.active)return [];
  if(!shop.dayHours&&Array.isArray(barber.days)&&!barber.days.includes(dow))return [];
  if((barber.vacations||[]).some(v=>dateISO>=v.start&&dateISO<=v.end))return [];
  // full-day block
  const blocks=DB.scope('blocks',shopId).filter(b=>(b.barberId===barberId||b.barberId==='all')&&b.date===dateISO);
  if(blocks.some(b=>b.fullDay))return [];
  const interval=shop.slotInterval||30;
  const startM=Math.max(timeToMin(barber.start||dayHours.start),timeToMin(dayHours.start));
  const endM=Math.min(timeToMin(barber.end||dayHours.end),timeToMin(dayHours.end));
  if(startM>=endM)return [];
  const lunchS=timeToMin(barber.lunchStart||shop.lunchStart||'12:00'),lunchE=timeToMin(barber.lunchEnd||shop.lunchEnd||'13:00');
  const taken=DB.scope('appointments',shopId).filter(a=>a.barberId===barberId&&a.date===dateISO&&a.status!=='cancelado')
    .map(a=>{const s=DB.find('services',a.serviceId);const m=timeToMin(a.time);return[m,m+(s?s.duration:30)];});
  const blkRanges=blocks.filter(b=>!b.fullDay).map(b=>[timeToMin(b.start),timeToMin(b.end)]);
  const now=new Date();const isToday=dateISO===DB.todayISO();const nowM=now.getHours()*60+now.getMinutes();
  const slots=[];
  for(let m=startM;m+duration<=endM;m+=interval){
    const end=m+duration;let avail=true;
    if(m<lunchE&&end>lunchS)avail=false;
    for(const[ts,te]of taken){if(m<te&&end>ts){avail=false;break;}}
    for(const[ts,te]of blkRanges){if(m<te&&end>ts){avail=false;break;}}
    if(isToday&&m<=nowM)avail=false;
    slots.push({time:minToTime(m),available:avail});
  }
  return slots;
}
function anySlots(shopId,dateISO,duration){
  const barbers=DB.scope('barbers',shopId).filter(b=>b.active);
  const map={};
  barbers.forEach(b=>barberSlots(shopId,b.id,dateISO,duration).forEach(s=>{if(s.available){if(!map[s.time])map[s.time]=b.id;}}));
  // build a unified slot list using union of all time grid
  const allTimes=new Set();
  barbers.forEach(b=>barberSlots(shopId,b.id,dateISO,duration).forEach(s=>allTimes.add(s.time)));
  return [...allTimes].sort().map(t=>({time:t,available:!!map[t],barberId:map[t]}));
}
function firstAvailableBarber(shopId,dateISO,time,duration){
  const barbers=DB.scope('barbers',shopId).filter(b=>b.active);
  for(const b of barbers){const s=barberSlots(shopId,b.id,dateISO,duration).find(x=>x.time===time);if(s&&s.available)return b.id;}
  return null;
}

/* ============================================================
   PUBLIC BARBERSHOP PAGE (slug) — SEO-friendly, serves customers
   ============================================================ */
/* Public booking page V2: tenant website, no marketplace surfaces */
function shopDayHours(shop,dow){
  const dayKey=String(dow);
  const cfg=shop&&shop.dayHours&&(shop.dayHours[dayKey]||shop.dayHours[dow]);
  const fallbackActive=Array.isArray(shop&&shop.workDays)?shop.workDays.includes(dow):[1,2,3,4,5,6].includes(dow);
  return {
    active:cfg&&typeof cfg.active!=='undefined'?!!cfg.active:fallbackActive,
    start:(cfg&&cfg.start)||shop.open||'09:00',
    end:(cfg&&cfg.end)||shop.close||'19:00'
  };
}
function publicDayList(days){
  const active=Array.isArray(days)&&days.length?days:[1,2,3,4,5,6];
  return DOW.map((d,i)=>`<span class="${active.includes(i)?'on':''}">${d}</span>`).join('');
}
function publicProfessionalDayList(shop,barber){
  if(shop&&shop.dayHours)return DOW.map((d,i)=>`<span class="${shopDayHours(shop,i).active?'on':''}">${d}</span>`).join('');
  return publicDayList(barber&&barber.days);
}
function publicDayHoursList(shop){
  if(!shop||!shop.dayHours)return `<div class="pub-days">${publicDayList(shop&&shop.workDays)}</div>`;
  return `<div class="pub-day-hours">${DOW.map((d,i)=>{
    const cfg=shopDayHours(shop,i);
    return `<span class="${cfg.active?'on':''}"><b>${d}</b> ${cfg.active?`${escapeHtml(cfg.start)}-${escapeHtml(cfg.end)}`:'Fechado'}</span>`;
  }).join('')}</div>`;
}
function publicHoursSummary(shop){
  if(!shop||!shop.dayHours)return `${escapeHtml(shop&&shop.open||'09:00')} - ${escapeHtml(shop&&shop.close||'19:00')}`;
  const active=DOW.map((_,i)=>shopDayHours(shop,i)).filter(d=>d.active);
  if(!active.length)return 'Fechado';
  const first=active[0];
  const same=active.every(d=>d.start===first.start&&d.end===first.end);
  return same?`${escapeHtml(first.start)} - ${escapeHtml(first.end)}`:'Horários por dia';
}
const PUBLIC_BUSINESS_CATEGORIES={
  'barbershop':'Barbearia','hair-salon':'Salão de cabelo','nail-designer':'Nail designer','lash-designer':'Lash designer',
  'makeup-artist':'Maquiadora','beauty-clinic':'Clínica de estética','tattoo-studio':'Estúdio de tatuagem',
  'massage-therapist':'Massoterapeuta','personal-trainer':'Personal trainer','nutritionist':'Nutricionista',
  'physiotherapist':'Fisioterapeuta','dentist':'Dentista','photographer':'Fotógrafo','consultant':'Consultor','food':'Alimentos por encomenda','car-wash':'Lava rápido & automotivo','other':'Agendamento online'
};
function publicCategoryLabel(v){return PUBLIC_BUSINESS_CATEGORIES[v]||v||'Agendamento online';}
function shopIsFood(shop){return !!(shop&&shop.category==='food');}
/* Textos do fluxo público por segmento: encomenda de alimentos usa vocabulário de pedido/entrega */
function bookingTexts(shop){
  if(shopIsFood(shop))return{steps:['Produto','Preparo','Dia','Horário','Confirmar'],modalTitle:'Fazer encomenda',modalSub:'Sem login. Sem app. Endereço e detalhes pelo WhatsApp.',pickItem:'Escolha o produto',itemCat:'Produto',pickPro:'Quem vai preparar seu pedido',pickDate:'Escolha o dia da entrega',pickTime:'Escolha o horário de entrega',confirmTitle:'Confirme seu pedido',sumItem:'Produto',sumPro:'Preparado por',sumDate:'Entrega',contactHelp:'A empresa confirma o pedido e combina o endereço de entrega pelo WhatsApp. Nenhuma conta é necessária.',successTitle:'Pedido reservado',successMsg:'Envie a confirmação pelo WhatsApp para combinar a entrega com',ctaBook:'Encomendar'};
  return{steps:['Serviço','Profissional','Data','Horário','Confirmar'],modalTitle:'Agendar horário',modalSub:'Sem login. Sem app. Confirmação pelo WhatsApp.',pickItem:'Escolha o serviço',itemCat:'Serviço',pickPro:'Escolha o profissional',pickDate:'Escolha a data',pickTime:'Escolha o horário',confirmTitle:'Confirme seu horário',sumItem:'Serviço',sumPro:'Profissional',sumDate:'Data',contactHelp:'A empresa confirma o agendamento pelo WhatsApp. Nenhuma conta é necessária.',successTitle:'Horário reservado',successMsg:'Envie a confirmação pelo WhatsApp para finalizar com',ctaBook:'Agendar'};
}
function publicThemeSlug(v){return String(v||'ocean-blue').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'ocean-blue';}
function applyPublicBusinessTheme(shop){document.documentElement.setAttribute('data-business-theme',publicThemeSlug(shop&&shop.themeId));}
function renderPublic(r){
  let shop=DB.findBy('barbershops',s=>s.slug===r.slug);
  if(!shop&&window.__FB_ENABLED&&!window.fbLoadPublicShop&&(r._loaderWaitCount||0)<20){
    r._loaderWaitCount=(r._loaderWaitCount||0)+1;
    $('#root').innerHTML=publicShell(`<div class="container pub-empty"><div class="skeleton" style="height:24px;width:240px;margin:0 auto 14px"></div><p class="muted">Preparando página...</p></div>`);
    setTimeout(()=>renderPublic(r),300);
    return;
  }
  if(!shop&&window.__FB_ENABLED&&window.fbLoadPublicShop&&!r._loaded){
    $('#root').innerHTML=publicShell(`<div class="container pub-empty"><div class="skeleton" style="height:24px;width:240px;margin:0 auto 14px"></div><p class="muted">Carregando página...</p></div>`);
    fbLoadPublicShop(r.slug).then(()=>{r._loaded=true;renderPublic(r);}).catch(()=>{r._loaded=true;renderPublic(r);});
    return;
  }
  if(!shop){document.documentElement.removeAttribute('data-business-theme');$('#root').innerHTML=publicShell(`<div class="container pub-empty">${emptyState('search','Página não encontrada','O link pode estar incorreto.')}<button class="btn btn-primary" onclick="Router.go('#/')">Voltar ao início</button></div>`);return;}
  applyPublicBusinessTheme(shop);
  if(shop.status==='suspended'){$('#root').innerHTML=publicShell(`<div class="container pub-empty">${emptyState('alert','Página temporariamente indisponível','Esta empresa não está aceitando agendamentos no momento.')}</div>`,shop);return;}
  if(shop.schedulePaused){$('#root').innerHTML=publicShell(`<div class="container pub-empty">${emptyState('clock','Agenda pausada','Este negócio pausou temporariamente novos agendamentos. Tente novamente mais tarde.')}</div>`,shop);return;}
  const _pubSub=shopSubscription(shop.id)||{};
  const _pubSubStatus=_pubSub.billingStatus||_pubSub.status;
  if(!subscriptionCourtesyActive(_pubSub)&&(_pubSubStatus==='past_due'||_pubSubStatus==='canceled')){$('#root').innerHTML=publicShell(`<div class="container pub-empty">${emptyState('lock','Link indisponível no momento','Entre em contato com o estabelecimento.')}</div>`,shop);return;}
  if(shopFreeBookingUsage(shop.id).locked){$('#root').innerHTML=publicShell(freeLimitMessage(shop),shop);return;}

  document.title=`${shop.name} - ${shopIsFood(shop)?'Encomende online':'Agende online'}`;
  window.currentPublicShopId=shop.id;
  sessionStorage.setItem('groomin_login_shop',shop.id);

  const services=DB.scope('services',shop.id).filter(s=>s.active);
  const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  const mapQuery=[shop.address,shop.neighborhood,shop.city].filter(Boolean).join(', ');
  const mapsUrl=mapQuery?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`:'';
  const whatsappDigits=(shop.whatsapp||shop.phone||'').replace(/\D/g,'');
  const whatsappUrl=whatsappDigits?`https://wa.me/55${whatsappDigits}?text=${encodeURIComponent('Olá, '+shop.name+'! Quero agendar um horário.')}`:'';
  const instaUrl=instagramUrl(shop.instagram);
  const instaText=instagramDisplay(shop.instagram);
  const coverStyle=shop.coverUrl?` style="background-image:url('${escapeHtml(shop.coverUrl)}')"`:'';

  $('#root').innerHTML=publicShell(`
    <section class="pub-hero">
      <div class="pub-cover ${shop.coverUrl?'has-image':''}"${coverStyle}></div>
      <div class="container pub-hero-inner">
        <div class="pub-logo">${brandLogo(shop,'pub-logo-img')}</div>
        <div class="pub-title">
          <span class="pub-kicker">${escapeHtml(publicCategoryLabel(shop.category))}</span>
          <h1>${escapeHtml(shop.name)}</h1>
          <p>${escapeHtml(shop.description||(shopIsFood(shop)?'Encomende com dia e horário de entrega.':'Agende seu horário online com praticidade.'))}</p>
          <div class="pub-actions">
            <button class="btn btn-primary" onclick="startBooking('${shop.id}')">${icon('calendar')} ${shopIsFood(shop)?'Fazer encomenda':'Agendar horário'}</button>
            ${whatsappUrl?`<a class="btn btn-light" href="${whatsappUrl}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>`:''}
          </div>
        </div>
      </div>
    </section>
    <div class="container pub-page">
      <section class="pub-info-grid">
        <div class="pub-info-card"><b>${icon('clock')} Horários</b><strong>${publicHoursSummary(shop)}</strong>${publicDayHoursList(shop)}</div>
        ${shop.address?`<div class="pub-info-card"><b>${icon('mapPin')} Endereço</b><strong>${escapeHtml(shop.address)}</strong>${mapsUrl?`<a href="${mapsUrl}" target="_blank" rel="noopener">Abrir no Maps</a>`:''}</div>`:''}
        ${instaUrl?`<a class="pub-info-card" href="${instaUrl}" target="_blank" rel="noopener"><b>${icon('instagram')} Instagram</b><strong>${escapeHtml(instaText)}</strong><span>Abrir no Instagram</span></a>`:''}
        ${shop.whatsapp||shop.phone?`<div class="pub-info-card"><b>${icon('phone')} Contato</b><strong>${escapeHtml(shop.whatsapp||shop.phone)}</strong>${whatsappUrl?`<a href="${whatsappUrl}" target="_blank" rel="noopener">Chamar no WhatsApp</a>`:''}</div>`:''}
      </section>
      <section class="pub-section">
        <div class="pub-section-head"><h2>${shopIsFood(shop)?'Produtos':'Serviços'}</h2><button class="btn btn-ghost btn-sm" onclick="startBooking('${shop.id}')">${shopIsFood(shop)?'Encomendar':'Agendar'}</button></div>
        <div class="pub-service-grid">
          ${services.length?services.map(s=>`<article class="pub-service"><div><span>${escapeHtml(s.category||(shopIsFood(shop)?'Produto':'Serviço'))}</span><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.desc||'')}</p></div><div class="pub-service-foot"><b>${money(s.price)}</b><small>${shopIsFood(shop)?'Entrega agendada':`${s.duration} min`}</small><button class="btn btn-primary btn-sm" onclick="startBooking('${shop.id}','${s.id}')">${shopIsFood(shop)?'Encomendar':'Agendar'}</button></div></article>`).join(''):emptyState('scissors',shopIsFood(shop)?'Sem produtos ainda':'Sem serviços ainda',shopIsFood(shop)?'Esta empresa ainda não publicou produtos.':'Esta empresa ainda não publicou serviços.')}
        </div>
      </section>

      <section class="pub-section">
        <div class="pub-section-head"><h2>${shopIsFood(shop)?'Quem prepara':'Profissionais'}</h2></div>
        <div class="pub-pro-grid">
          ${barbers.length?barbers.map(b=>`<article class="pub-pro"><div class="pub-pro-photo">${imageOrInitials(b.photoUrl,b.name,'pub-pro-img')}</div><div><h3>${escapeHtml(b.name)}</h3><p>${escapeHtml(b.role||'Profissional')}</p><div class="pub-days">${publicProfessionalDayList(shop,b)}</div></div><button class="btn btn-ghost btn-sm" onclick="startBooking('${shop.id}',null,'${b.id}')">${shopIsFood(shop)?'Encomendar':'Agendar'}</button></article>`).join(''):emptyState('users','Sem profissionais ainda','A equipe ainda não foi publicada.')}
        </div>
      </section>

      <section class="pub-booking-band">
        <div><h2>${shopIsFood(shop)?'Escolha o dia e horário da entrega':'Escolha seu melhor horário'}</h2><p>${shopIsFood(shop)?'Encomende online em poucos passos.':'Reserve online em poucos passos.'}</p></div>
        <button class="btn btn-primary" onclick="startBooking('${shop.id}')">${icon('calendar')} ${shopIsFood(shop)?'Encomendar agora':'Agendar agora'}</button>
      </section>
    </div>`,shop);

  if(window._pendingBooking&&window._pendingBooking.shopId===shop.id){
    const pb=window._pendingBooking;window._pendingBooking=null;
    setTimeout(()=>startBooking(pb.shopId,pb.serviceId,pb.barberId),200);
  }
}
function publicShell(inner,shop){
  const u=Session.user;
  const brand=shop?`<div class="pub-nav-brand" onclick="Router.go('#/b/${escapeHtml(shop.slug)}')"><span class="pub-nav-logo">${brandLogo(shop,'pub-nav-logo-img')}</span><b>${escapeHtml(shop.name)}</b></div>`:`<div class="pub-nav-brand" onclick="Router.go('#/')"><span class="logo">${GROOMIN_LOGO}</span><b>Groomin</b></div>`;
  return `<header class="pub-topbar"><div class="container pub-topbar-inner">
    ${brand}
    <div class="pub-nav-actions">
      <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
      ${shop?`<button class="btn btn-primary btn-sm" onclick="startBooking('${shop.id}')">${icon('calendar')} ${shopIsFood(shop)?'Encomendar':'Agendar'}</button>`:''}
    </div>
  </div></header><main class="pub-main">${inner}</main><footer class="pub-powered">Powered by Groomin</footer>`;
}

/* ============================================================
   BOOKING WIZARD (MVP)
   ============================================================ */
let booking={};

/* Booking flow V2: no login, no app install, WhatsApp-first confirmation */
function shopFreeBookingUsage(shopId){
  const shop=DB.find('barbershops',shopId);
  if(subscriptionCourtesyActive(shopSubscription(shopId)))return {planId:'courtesy',limit:Infinity,used:0,remaining:Infinity,locked:false};
  const planId=(shop&&shop.planId)||'';
  const limit=planId==='free'?Number(shop.freeBookingLimit||3):Infinity;
  const used=DB.scope('appointments',shopId).filter(a=>a.status!=='cancelado').length;
  return {planId,limit,used,remaining:Number.isFinite(limit)?Math.max(0,limit-used):Infinity,locked:Number.isFinite(limit)&&used>=limit};
}
function freeLimitMessage(shop){
  const usage=shopFreeBookingUsage(shop.id);
  const u=Session&&Session.effectiveUser;
  const isOwner=u&&u.barbershopId===shop.id&&(u.role==='owner'||u.role==='manager'||u.role==='superadmin');
  if(isOwner){
    return `<div class="container pub-empty">${emptyState('lock','Teste gratuito concluído',`Seu negócio já recebeu ${usage.used} agendamento(s) no teste gratuito. Para continuar recebendo novos horários, assine um plano do Groomin.`)}<button class="btn btn-primary" onclick="Router.go('#/dashboard/assinatura')">Ver planos</button></div>`;
  }
  const wa=bookingShopWhatsApp(shop);
  return `<div class="container pub-empty">${emptyState('clock','Agenda temporariamente indisponível','Este negócio não está recebendo novos agendamentos online no momento. Tente novamente mais tarde ou entre em contato diretamente.')}${wa?`<a class="btn btn-primary" href="${waLink(wa,`Olá! Gostaria de agendar um horário com ${shop.name}.`)}" target="_blank" rel="noopener">${icon('whatsapp')} Chamar no WhatsApp</a>`:''}</div>`;
}
function bookingShopWhatsApp(shop){
  return (shop&&(shop.whatsapp||shop.phone)?(shop.whatsapp||shop.phone):'').replace(/\D/g,'');
}
function bookingWhatsAppMessage(shop,svc,barber,code){
  if(shopIsFood(shop))return encodeURIComponent(`Olá, ${shop.name}! Acabei de fazer uma encomenda:\n\nProduto: ${svc.name}\nEntrega: ${fmtDate(booking.date)} às ${booking.time}\nNome: ${booking.name}\nWhatsApp: ${booking.phone}${code?`\nCódigo: #${code}`:''}\n\nVou te passar o endereço de entrega por aqui. Pode confirmar?`);
  return encodeURIComponent(`Olá, ${shop.name}! Acabei de fazer um agendamento:\n\nServiço: ${svc.name}\nProfissional: ${barber?barber.name:'A definir'}\nData: ${fmtDate(booking.date)}\nHorário: ${booking.time}\nNome: ${booking.name}\nWhatsApp: ${booking.phone}${code?`\nCódigo: #${code}`:''}\n\nPode confirmar por aqui?`);
}
function startBooking(shopId,serviceId,barberId){
  const shop=DB.find('barbershops',shopId);
  if(shop&&shop.schedulePaused){toast('Agenda pausada. Novos agendamentos estão indisponíveis no momento.','info');return;}
  if(shop&&shopFreeBookingUsage(shopId).locked){toast('Agenda temporariamente indisponível para novos agendamentos online.','info');return;}
  booking={shopId,service:serviceId||null,barber:barberId||null,date:null,time:null,assignedBarber:null,name:'',phone:'',email:'',birthday:'',step:serviceId?2:1};
  renderBooking();
}
function renderBooking(){
  const T=bookingTexts(DB.find('barbershops',booking.shopId));
  const steps=T.steps;
  const current=Math.min(booking.step,5);
  openModal(`<div class="modal-head"><div><h3>${T.modalTitle}</h3><div class="sub">${T.modalSub}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body booking-flow"><div class="wizard-steps booking-steps">${steps.map((s,i)=>{const n=i+1;const cls=current===n?'active':current>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${current>n?icon('check'):n}</div><div class="lbl">${s}</div></div>`;}).join('')}</div><div id="bookStep"></div></div>`,'lg booking-modal');
  renderBookingStep();
}
function renderBookingStep(){
  const c=$('#bookStep'),shopId=booking.shopId;
  const T=bookingTexts(DB.find('barbershops',shopId));
  const isFood=shopIsFood(DB.find('barbershops',shopId));
  if(booking.step===1){
    const svcs=DB.scope('services',shopId).filter(s=>s.active);
    c.innerHTML=`<h4>${T.pickItem}</h4><div class="select-grid booking-select-grid">${svcs.map(s=>`<button class="select-item ${booking.service===s.id?'sel':''}" onclick="pickService('${s.id}')"><div class="t">${escapeHtml(s.name)}</div><div class="d">${isFood?escapeHtml(s.category||T.itemCat):`${s.duration} min · ${escapeHtml(s.category||T.itemCat)}`}</div><div class="p">${money(s.price)}</div></button>`).join('')}</div>`;
  }else if(booking.step===2){
    const barbers=DB.scope('barbers',shopId).filter(b=>b.active);
    c.innerHTML=`<h4>${T.pickPro}</h4><div class="select-grid booking-select-grid">
      <button class="select-item ${booking.barber==='any'?'sel':''}" onclick="pickBarber('any')"><div style="display:flex;align-items:center;gap:10px"><div class="t-user"><div class="av">${icon('users')}</div></div><div><div class="t">Qualquer profissional</div><div class="d">Primeiro horário disponível</div></div></div></button>
      ${barbers.map(b=>`<button class="select-item ${booking.barber===b.id?'sel':''}" onclick="pickBarber('${b.id}')"><div style="display:flex;align-items:center;gap:10px"><div class="t-user"><div class="av">${imageOrInitials(b.photoUrl,b.name,'mini-avatar-img')}</div></div><div><div class="t">${escapeHtml(b.name)}</div><div class="d">${escapeHtml(b.role||'Profissional')}</div><div class="barber-days compact">${DOW.map((d,i)=>`<span class="${(DB.find('barbershops',shopId).dayHours?shopDayHours(DB.find('barbershops',shopId),i).active:(b.days||[]).includes(i))?'day on':'day'}">${d}</span>`).join('')}</div></div></div></button>`).join('')}</div>
      <div class="booking-mobile-actions"><button class="btn btn-ghost" onclick="bookGo(1)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===3){
    const svc=DB.find('services',booking.service);
    if(!svc){toast('Serviço não disponível. Escolha outro.','err');booking.step=1;renderBooking();return;}
    const lead=shopLeadDays(DB.find('barbershops',shopId));
    const dates=[];for(let i=lead;i<lead+14;i++)dates.push(DB.addDays(DB.todayISO(),i));
    c.innerHTML=`<h4>${T.pickDate}</h4>${lead?`<p class="muted booking-help">${isFood?'Encomendas':'Reservas'} com pelo menos ${lead} dia${lead>1?'s':''} de antecedência.</p>`:''}<div class="date-strip booking-date-strip">${dates.map(dt=>{const day=new Date(dt+'T00:00:00');const works=booking.barber==='any'?anySlots(shopId,dt,svc.duration).some(s=>s.available):barberSlots(shopId,booking.barber,dt,svc.duration).some(s=>s.available);return `<button class="date-pill ${booking.date===dt?'sel':''}" ${works?'':'disabled'} onclick="pickDate('${dt}')"><div class="dow">${DOW[day.getDay()]}</div><div class="dnum">${day.getDate()}</div><div class="mon">${MON[day.getMonth()]}</div></button>`;}).join('')}</div>
      <div class="booking-mobile-actions"><button class="btn btn-ghost" onclick="bookGo(2)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===4){
    const svc=DB.find('services',booking.service);
    if(!svc){toast('Serviço não disponível. Escolha outro.','err');booking.step=1;renderBooking();return;}
    const slots=booking.barber==='any'?anySlots(shopId,booking.date,svc.duration):barberSlots(shopId,booking.barber,booking.date,svc.duration);
    c.innerHTML=`<h4>${T.pickTime}</h4><p class="muted booking-help">${DOW_FULL[new Date(booking.date+'T00:00:00').getDay()]}, ${fmtDate(booking.date)}</p>
      ${slots.length?`<div class="slot-grid booking-slot-grid">${slots.map(s=>`<button class="slot ${booking.time===s.time?'sel':''}" ${s.available?'':'disabled'} onclick="pickTime('${s.time}','${s.barberId||''}')">${s.time}</button>`).join('')}</div>`:emptyState('clock','Sem horários','Não há horários livres nesta data.')}
      <div class="booking-mobile-actions"><button class="btn btn-ghost" onclick="bookGo(3)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===5){
    const shop=DB.find('barbershops',shopId),svc=DB.find('services',booking.service);
    const bid=booking.barber==='any'?(booking.assignedBarber||firstAvailableBarber(shopId,booking.date,booking.time,svc.duration)):booking.barber;
    const barber=DB.find('barbers',bid);
    c.innerHTML=`<h4>${T.confirmTitle}</h4>
      <div class="booking-confirm">
        <div class="card booking-summary-card">
          <div class="summary-line"><span class="muted">${T.sumItem}</span><b>${escapeHtml(svc.name)}</b></div>
          <div class="summary-line"><span class="muted">${T.sumPro}</span><b>${barber?escapeHtml(barber.name):'A definir'}</b></div>
          <div class="summary-line"><span class="muted">${T.sumDate}</span><b>${fmtDate(booking.date)}</b></div>
          <div class="summary-line"><span class="muted">Horário</span><b>${booking.time}</b></div>
          <div class="summary-line"><span class="muted">Total</span><b style="color:var(--primary);font-size:18px">${money(svc.price)}</b></div>
        </div>
        <div class="booking-contact-card">
          <div class="field"><label>Nome *</label><input class="input" id="bk_name" value="${escapeHtml(booking.name)}" placeholder="Seu nome"></div>
          <div class="field"><label>WhatsApp *</label><div class="input-icon">${icon('whatsapp')}<input class="input" id="bk_phone" value="${escapeHtml(booking.phone)}" inputmode="tel" placeholder="(11) 90000-0000"></div><div class="err">Informe um WhatsApp válido.</div></div>
          <p class="muted booking-help">${T.contactHelp}</p>
        </div>
      </div>
      <div class="booking-mobile-actions split"><button class="btn btn-ghost" onclick="bookGo(4)">${icon('arrowLeft')} Voltar</button><button id="btn_confirm" class="btn btn-primary" onclick="confirmBooking()">${icon('whatsapp')} Confirmar</button></div>`;
  }
}
function pickService(id){booking.service=id;booking.barber=null;booking.date=null;booking.time=null;renderBookingStep();setTimeout(()=>bookGo(2),120);}
function pickBarber(id){booking.barber=id;booking.date=null;booking.time=null;renderBookingStep();setTimeout(()=>bookGo(3),120);}
function pickDate(dt){booking.date=dt;booking.time=null;renderBookingStep();setTimeout(()=>bookGo(4),120);}
function pickTime(t,bid){booking.time=t;booking.assignedBarber=bid||null;renderBookingStep();setTimeout(()=>bookGo(5),120);}
function bookGo(step){
  if(step>=2&&!booking.service){toast('Escolha um serviço.','err');return;}
  if(step>=3&&!booking.barber){toast('Escolha um profissional.','err');return;}
  if(step>=4&&!booking.date){toast('Escolha uma data.','err');return;}
  if(step>=5&&!booking.time){toast('Escolha um horário.','err');return;}
  booking.step=step;renderBooking();
}
function bookingValidateContact(){
  const nameEl=$('#bk_name'),phoneEl=$('#bk_phone');
  const name=nameEl?nameEl.value.trim():booking.name;
  const phone=phoneEl?phoneEl.value.trim():booking.phone;
  let ok=true;
  if(nameEl)nameEl.closest('.field').classList.toggle('invalid',name.length<2);
  if(name.length<2)ok=false;
  if(phoneEl)phoneEl.closest('.field').classList.toggle('invalid',phone.replace(/\D/g,'').length<10);
  if(phone.replace(/\D/g,'').length<10)ok=false;
  if(!ok){toast('Informe nome e WhatsApp para confirmar.','err');return false;}
  booking.name=name;booking.phone=phone;booking.email='';
  return true;
}
function bookingSuccessHtml(shop,svc,barber,code){
  const T=bookingTexts(shop);
  const wpp=bookingShopWhatsApp(shop);
  const href=wpp?`https://wa.me/55${wpp}?text=${bookingWhatsAppMessage(shop,svc,barber,code)}`:'';
  return `<div class="success-wrap booking-success"><div class="success-check">${icon('check')}</div>
    <h3>${T.successTitle}</h3>
    <p class="muted">${T.successMsg} ${escapeHtml(shop.name)}.</p>
    <div class="card booking-summary-card">
      <div class="summary-line"><span class="muted">${T.sumItem}</span><b>${escapeHtml(svc.name)}</b></div>
      <div class="summary-line"><span class="muted">${T.sumPro}</span><b>${escapeHtml(barber?barber.name:'A definir')}</b></div>
      <div class="summary-line"><span class="muted">Quando</span><b>${fmtDate(booking.date)} · ${booking.time}</b></div>
      ${code?`<div class="summary-line"><span class="muted">Código</span><b>#${code}</b></div>`:''}
    </div>
    <div class="booking-success-actions">${href?`<a class="btn btn-primary btn-block" href="${href}" target="_blank" rel="noopener">${icon('whatsapp')} Confirmar no WhatsApp</a>`:''}<button class="btn btn-ghost btn-block" onclick="closeModal()">Fechar</button></div>
  </div>`;
}
function confirmBooking(){
  if(!bookingValidateContact())return;
  const shopId=booking.shopId,svc=DB.find('services',booking.service);
  const bid0=booking.barber==='any'?firstAvailableBarber(shopId,booking.date,booking.time,svc.duration):booking.barber;
  if(!bid0){toast('Horário indisponível. Escolha outro.','err');booking.step=4;renderBooking();return;}
  const leadMin=shopLeadDays(DB.find('barbershops',shopId));
  if(leadMin&&booking.date<DB.addDays(DB.todayISO(),leadMin)){toast(`Pedidos precisam de pelo menos ${leadMin} dia${leadMin>1?'s':''} de antecedência. Escolha outra data.`,'err');booking.step=3;renderBooking();return;}
  if(shopFreeBookingUsage(shopId).locked){toast('Agenda temporariamente indisponível para novos agendamentos online.','err');closeModal();return;}
  const btn=$('#btn_confirm');if(btn){btn.disabled=true;btn.innerHTML=`${icon('clock')} Confirmando...`;}
  if(window.__FB_ENABLED){
    fbPublicBooking({tenantId:shopId,serviceId:svc.id,barberId:bid0,date:booking.date,time:booking.time,name:booking.name,phone:booking.phone,email:'',birthday:'',duration:svc.duration,price:svc.price,serviceName:svc.name,barberName:(DB.find('barbers',bid0)||{}).name||''})
      .then(res=>{
        const shop=DB.find('barbershops',shopId),barber=DB.find('barbers',bid0),code=String(res.appointmentId||'').slice(-6).toUpperCase();
        window._lastAppt={date:booking.date,time:booking.time,duration:svc.duration,serviceName:svc.name,barberName:barber?barber.name:'',shopName:shop?shop.name:'',shopAddress:shop?(shop.address||'')+(shop.city?', '+shop.city:''):''};
        $('#overlay').classList.add('open');document.body.classList.add('locked');
        $('#modal').querySelector('.modal-body').innerHTML=bookingSuccessHtml(shop,svc,barber,code);
        toast('Horário reservado. Confirme pelo WhatsApp.','ok');
      })
      .catch(err=>{if(btn){btn.disabled=false;btn.innerHTML=`${icon('whatsapp')} Confirmar`;}toast(fbErrMsg(err,'booking'),'err');booking.step=4;renderBooking();});
    return;
  }
  const slot=barberSlots(shopId,bid0,booking.date,svc.duration).find(s=>s.time===booking.time);
  if(!slot||!slot.available){toast('Esse horário acabou de ser reservado.','err');booking.step=4;renderBooking();return;}
  let cust=DB.scope('customers',shopId).find(c=>c.phone===booking.phone);
  if(!cust)cust=DB.insert('customers',{barbershopId:shopId,name:booking.name,phone:booking.phone,whatsapp:booking.phone,email:'',birthday:'',notes:''});
  if(booking._reschedule)DB.remove('appointments',booking._reschedule);
  const appt=DB.insert('appointments',{barbershopId:shopId,customerId:cust.id,customerName:booking.name,phone:booking.phone,serviceId:svc.id,barberId:bid0,date:booking.date,time:booking.time,status:'confirmado',price:svc.price,createdAt:Date.now()});
  DB.insert('notifications',{barbershopId:shopId,type:booking._reschedule?'reschedule':'confirm',title:booking._reschedule?'Reagendamento':'Novo agendamento',msg:`${booking.name} - ${svc.name} ${fmtDateShort(booking.date)} ${booking.time}`,time:Date.now(),read:false});
  const shop=DB.find('barbershops',shopId),barber=DB.find('barbers',bid0),code=appt.id.slice(-6).toUpperCase();
  window._lastAppt={date:booking.date,time:booking.time,duration:svc.duration,serviceName:svc.name,barberName:barber?barber.name:'',shopName:shop?shop.name:'',shopAddress:shop?(shop.address||'')+(shop.city?', '+shop.city:''):''};
  $('#overlay').classList.add('open');document.body.classList.add('locked');
  $('#modal').querySelector('.modal-body').innerHTML=bookingSuccessHtml(shop,svc,barber,code);
  toast('Horário reservado. Confirme pelo WhatsApp.','ok');
  if(window.refreshShell)refreshShell();
}
function offerAccount(shopId,custId){
  const cust=DB.find('customers',custId);
  const existing=DB.get().users.find(u=>u.role==='customer'&&u.customerId===custId);
  if(existing){toast('Você já tem conta. Faça login.','info');closeModal();openPublicCustomerLogin(shopId);return;}
  openModal(`<div class="modal-head"><div><h3>Criar conta de cliente</h3><div class="sub">Para acompanhar e gerenciar seus horários</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <p class="muted" style="margin-bottom:14px">Crie uma senha para acessar seus agendamentos, remarcar e cancelar quando precisar.</p>
    <div class="field"><label>E-mail</label><input class="input" id="ac_email" value="${escapeHtml(cust.email||'')}"></div>
    <div class="field"><label>Senha *</label><input class="input" type="password" id="ac_pass" placeholder="Mínimo 6 caracteres"><div class="err">Mínimo 6 caracteres.</div></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Agora não</button><button class="btn btn-primary" onclick="createCustomerAccount('${shopId}','${custId}')">Criar conta</button></div>`);
}
function createCustomerAccount(shopId,custId){
  const cust=DB.find('customers',custId);const email=$('#ac_email').value.trim().toLowerCase(),pass=$('#ac_pass').value;
  if(pass.length<6){$('#ac_pass').closest('.field').classList.add('invalid');return;}
  if(window.__FB_ENABLED){
    const btn=document.querySelector('.modal-foot .btn-primary');if(btn){btn.disabled=true;btn.textContent='Criando conta…';}
    sessionStorage.setItem('groomin_customer_link_profile',JSON.stringify({tenantId:shopId,name:cust.name,email,phone:cust.phone||'',birthday:cust.birthday||''}));
    fbSignUpCustomer({name:cust.name,email,password:pass,phone:cust.phone||'',birthday:cust.birthday||'',tenantId:shopId,customerId:custId})
      .then(()=>{closeModal();toast('Conta criada! 🎉','ok');location.hash='#/my-appointments';})
      .catch(err=>{
        if(btn){btn.disabled=false;btn.textContent='Criar conta';}
        if(/email-already|email-already-in-use|already-in-use/.test(err.code||'')){
          toast('Esse e-mail já tem conta. Entre com sua senha para vincular esta barbearia.','info');
          closeModal();openPublicCustomerLogin(shopId,'login',email);
        }else{
          sessionStorage.removeItem('groomin_customer_link_profile');
          toast(fbErrMsg(err,'signup'),'err');
        }
      });
    return;
  }
  if(DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase())){toast('E-mail já cadastrado.','err');return;}
  DB.update('customers',custId,{email});
  DB.insert('users',{name:cust.name,email,password:pass,role:'customer',barbershopId:shopId,customerId:custId,active:true});
  Session.login(email,pass);closeModal();toast('Conta criada!','ok');location.hash='#/my-appointments';
}

/* Login/cadastro de cliente diretamente na página da barbearia */
function openPublicCustomerLogin(shopId,initialTab,initialEmail){
  window._pclTab=initialTab||'login';
  window._pclEmail=initialEmail||'';
  function render(){
    const tab=window._pclTab;
    const body=tab==='login'
      ?`<div class="field"><label>E-mail</label><input class="input" id="pcl_email" placeholder="voce@email.com" value="${escapeHtml(window._pclEmail||'')}"><div class="err">E-mail inválido.</div></div>
         <div class="field"><label>Senha</label><input class="input" type="password" id="pcl_pass" placeholder="Sua senha"><div class="err">Mínimo 6 caracteres.</div></div>
         <p style="font-size:13px;margin-top:10px" class="muted">Novo por aqui? <a style="color:var(--primary);cursor:pointer" onclick="window._pclTab='register';pclRe()">Criar conta →</a></p>`
      :`<div class="field"><label>Seu nome *</label><input class="input" id="pcl_name" placeholder="Nome completo"><div class="err">Informe seu nome.</div></div>
         <div class="field"><label>E-mail *</label><input class="input" id="pcl_email" placeholder="voce@email.com"><div class="err">E-mail inválido.</div></div>
         <div class="field"><label>WhatsApp</label><input class="input" id="pcl_phone" placeholder="(11) 9 0000-0000"></div>
         <div class="field"><label>Data de nascimento</label><input class="input" type="date" id="pcl_bday"><div class="err">Confira a data informada.</div><small class="muted">Opcional. Use apenas se quiser receber benefícios de aniversário.</small></div>
         <div class="field"><label>Senha *</label><input class="input" type="password" id="pcl_pass" placeholder="Mínimo 6 caracteres"><div class="err">Mínimo 6 caracteres.</div></div>
         <p style="font-size:13px;margin-top:10px" class="muted">Já tem conta? <a style="color:var(--primary);cursor:pointer" onclick="window._pclTab='login';pclRe()">Entrar →</a></p>`;
    const foot=tab==='login'
      ?`<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button id="pcl_btn" class="btn btn-primary" onclick="pclSubmit('login','${shopId}')">Entrar</button>`
      :`<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button id="pcl_btn" class="btn btn-primary" onclick="pclSubmit('register','${shopId}')">Criar conta</button>`;
    openModal(`<div class="modal-head"><div><h3>${tab==='login'?icon('user')+' Entrar':icon('userPlus')+' Criar conta'}</h3><div class="sub">Gerencie seus agendamentos</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
    <div class="modal-body" id="pcl_body">${body}</div>
    <div class="modal-foot" id="pcl_foot">${foot}</div>`);
  }
  window.pclRe=render;render();
}
function pclSubmit(action,shopId){
  const email=(($('#pcl_email')||{}).value?.trim()||'').toLowerCase();
  const pass=($('#pcl_pass')||{}).value||'';
  if(action==='login'){
    const ok=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)&&pass.length>=6;
    if(!ok){toast('Confira e-mail e senha.','err');return;}
    if(window.__FB_ENABLED){
      const btn=$('#pcl_btn');if(btn){btn.disabled=true;btn.innerHTML='Entrando…';}
      sessionStorage.setItem('groomin_intended','#/my-appointments');
      sessionStorage.setItem('groomin_login_shop',shopId);
      fbSignIn(email,pass)
        .then(()=>{closeModal();})
        .catch(err=>{if(btn){btn.disabled=false;btn.innerHTML='Entrar';}sessionStorage.removeItem('groomin_intended');sessionStorage.removeItem('groomin_login_shop');toast(fbErrMsg(err,'login'),'err');});
      return;
    }
    if(!Session.login(email,pass)){toast('E-mail ou senha incorretos.','err');return;}
    closeModal();location.hash='#/my-appointments';return;
  }
  // register
  const name=($('#pcl_name')||{}).value?.trim()||'';
  const phone=($('#pcl_phone')||{}).value?.trim()||'';
  const birthday=($('#pcl_bday')||{}).value||'';
  let ok=true;
  const inv=(id,bad)=>{const el=$('#'+id);if(el)el.closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
  inv('pcl_name',name.length<2);inv('pcl_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));inv('pcl_bday',!!birthday&&!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(birthday));inv('pcl_pass',pass.length<6);
  if(!ok){toast('Confira os campos destacados.','err');return;}
  if(window.__FB_ENABLED&&phone.replace(/\D/g,'').length<8){toast('Informe seu WhatsApp (mínimo 8 dígitos).','err');const el=$('#pcl_phone');if(el)el.focus();return;}
  if(window.__FB_ENABLED){
    const btn=$('#pcl_btn');if(btn){btn.disabled=true;btn.innerHTML='Criando conta…';}
    sessionStorage.setItem('groomin_intended','#/my-appointments');
    sessionStorage.setItem('groomin_login_shop',shopId);
    sessionStorage.setItem('groomin_customer_link_profile',JSON.stringify({tenantId:shopId,name,email,phone,birthday}));
    fbSignUpCustomer({name,email,password:pass,phone,birthday,tenantId:shopId})
      .then(()=>{closeModal();toast('Conta criada! 🎉','ok');})
      .catch(err=>{
        if(btn){btn.disabled=false;btn.innerHTML='Criar conta';}
        if(/email-already|email-already-in-use|already-in-use/.test(err.code||'')){
          window._pclTab='login';window._pclEmail=email;if(window.pclRe)window.pclRe();
          toast('Esse e-mail já tem conta. Entre com sua senha para vincular esta barbearia.','info');
        }else{
          sessionStorage.removeItem('groomin_intended');
          sessionStorage.removeItem('groomin_login_shop');
          sessionStorage.removeItem('groomin_customer_link_profile');
          toast(fbErrMsg(err,'signup'),'err');
        }
      });
    return;
  }
  if(DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase())){toast('E-mail já cadastrado.','err');return;}
  let cust=DB.get().customers.find(c=>c.barbershopId===shopId&&c.email&&c.email.toLowerCase()===email.toLowerCase());
  if(!cust)cust=DB.insert('customers',{barbershopId:shopId,name,email,phone,whatsapp:phone,birthday,notes:'',createdAt:Date.now()});
  else if(birthday&&!cust.birthday)DB.update('customers',cust.id,{birthday});
  DB.insert('users',{name,email,password:pass,role:'customer',barbershopId:shopId,customerId:cust.id,active:true});
  Session.login(email,pass);closeModal();toast('Conta criada! 🎉','ok');location.hash='#/my-appointments';
}

/* ============================================================
   CUSTOMER AREA (/my-appointments)
   ============================================================ */
let custTab='proximos';
function renderCustomer(){
  const u=Session.effectiveUser;
  if(!u||u.role!=='customer'){location.hash='#/';return;}
  const cust=DB.find('customers',u.customerId);
  const shop=DB.find('barbershops',u.barbershopId);
  if(!cust||!shop){
    if(window.__FB_ENABLED&&u.barbershopId){
      if(window._custLoadFailed||!u.customerId){
        $('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">${icon('alert')}<p style="font-size:15px;font-weight:600;margin:0">Não conseguimos carregar seus dados</p><p class="muted" style="font-size:13px;max-width:280px;text-align:center;margin:0">Problema de conexão ou conta sem perfil vinculado. Tente recarregar ou sair.</p><div style="display:flex;gap:10px"><button class="btn btn-ghost btn-sm" onclick="logoutTo('#/')">Sair</button><button class="btn btn-primary btn-sm" onclick="window._custLoadFailed=false;location.reload()">Recarregar</button></div></div>`;
        return;
      }
      $('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div class="skeleton" style="width:200px;height:16px;border-radius:6px"></div><p class="muted" style="font-size:13px">Carregando seus agendamentos…</p></div>`;
      // fallback: busca direta se onSnapshot não hidratar em 4s; após 1 tentativa, exibe erro
      if(!window._custLoadFallback){
        window._custLoadFallback=setTimeout(async()=>{
          window._custLoadFallback=null;
          try{
            if(window.fbFetchCustomerCache)await window.fbFetchCustomerCache(u.uid,u.barbershopId,u.customerId);
          }catch(e){console.warn('[renderCustomer fallback]',e);}
          window._custLoadFailed=true;
          renderCustomer();
        },4000);
      }
      return;
    }
    location.hash='#/';return;
  }
  window._custLoadFailed=false;
  if(window._custLoadFallback){clearTimeout(window._custLoadFallback);window._custLoadFallback=null;}
  const t=DB.todayISO();
  const all=DB.scope('appointments',u.barbershopId).filter(a=>a.customerId===u.customerId).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
  const list=custTab==='proximos'?all.filter(a=>a.date>=t&&a.status!=='cancelado'&&a.status!=='concluido'):all;
  const links=Array.isArray(u.customerLinks)?u.customerLinks:[];
  const shopSelector=links.length>1?`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${links.map(lk=>{const s=DB.find('barbershops',lk.tenantId);const active=lk.tenantId===u.barbershopId;return s?`<button class="btn btn-sm ${active?'btn-primary':'btn-ghost'}" onclick="switchCustShop('${lk.tenantId}')">${escapeHtml(s.name)}</button>`:'';}).join('')}</div>`:'';
  $('#root').innerHTML=`<header class="topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/'+'${shop.slug}')"><span class="logo">${icon('scissors')}</span><span>${escapeHtml(shop.name)}<small>Área do cliente</small></span></div>
    <div class="nav-right"><button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
      <button class="btn btn-primary btn-sm" onclick="startBooking('${shop.id}')">${icon('plus')} Agendar</button>
      <button class="btn btn-ghost btn-sm" onclick="logoutTo('#/'+'${shop.slug}')">${icon('logout')} Sair</button></div>
  </div>${shopSelector?`<div class="container inner" style="padding-top:0;padding-bottom:8px">${shopSelector}</div>`:''}</header>
  <main class="container" style="padding:30px 0 60px">
    <div class="page-head"><div><h2>Olá, ${escapeHtml(u.name.split(' ')[0])} 👋</h2><p>Gerencie seus horários na ${escapeHtml(shop.name)}</p></div></div>
    <div class="stat-grid">
      ${statCard('c1','calendar','Próximos',all.filter(a=>a.date>=t&&a.status==='confirmado').length,'agendados')}
      ${statCard('c2','check','Concluídos',all.filter(a=>a.status==='concluido').length,'visitas')}
      ${statCard('c3','star','Fidelidade',all.filter(a=>a.status==='concluido').length*10+' pts','programa de pontos')}
    </div>
    <div class="toolbar"><div class="seg"><button class="${custTab==='proximos'?'on':''}" onclick="custTab='proximos';renderCustomer()">Próximos</button><button class="${custTab==='todos'?'on':''}" onclick="custTab='todos';renderCustomer()">Histórico</button></div></div>
    ${list.length?`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${list.map(ap=>{const s=DB.find('services',ap.serviceId),b=DB.find('barbers',ap.barberId);const fut=ap.date>=t&&ap.status==='confirmado';return `<div class="card" style="padding:18px"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px"><b style="font-size:16px">${s?escapeHtml(s.name):'—'}</b><span class="badge ${STATUS[ap.status].cls}">${STATUS[ap.status].label}</span></div><div class="summary-line"><span class="muted">Profissional</span><b>${b?escapeHtml(b.name):'—'}</b></div><div class="summary-line"><span class="muted">Data</span><b>${fmtDate(ap.date)}</b></div><div class="summary-line"><span class="muted">Horário</span><b>${ap.time}</b></div><div class="summary-line"><span class="muted">Valor</span><b style="color:var(--primary)">${money(ap.price)}</b></div>${fut?`<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-ghost btn-sm btn-block" onclick="custReschedule('${ap.id}')">${icon('repeat')} Remarcar</button><button class="btn btn-danger btn-sm" onclick="custCancel('${ap.id}')">${icon('x')}</button></div>`:''}</div>`;}).join('')}</div>`:emptyState('calendar','Nenhum agendamento','Que tal agendar um horário agora?')}
    <div class="panel" style="margin-top:18px"><div class="panel-head"><h3>Meu perfil</h3><button class="btn btn-ghost btn-sm" onclick="custEditProfile()">${icon('edit')} Editar</button></div>
      <div class="summary-line"><span class="muted">Nome</span><b>${escapeHtml(cust.name)}</b></div>
      <div class="summary-line"><span class="muted">WhatsApp</span><b>${escapeHtml(cust.phone)}</b></div>
      <div class="summary-line"><span class="muted">E-mail</span><b>${escapeHtml(cust.email||'—')}</b></div>
    </div>
  </main>`;
}
function custCancel(id){
  const ap=DB.find('appointments',id);
  if(!ap){toast('Agendamento não encontrado.','err');return;}
  if(ap.date<DB.todayISO()){toast('Não é possível cancelar um agendamento passado.','err');return;}
  confirmAction('Cancelar agendamento?','Você poderá agendar um novo horário quando quiser.',()=>{
    DB.update('appointments',id,{status:'cancelado'});
    DB.insert('notifications',{barbershopId:ap.barbershopId,type:'cancel',title:'Cancelamento',msg:`${ap.customerName} cancelou ${fmtDateShort(ap.date)} ${ap.time}`,time:Date.now(),read:false});
    DB.log('Agendamento cancelado',ap.customerName,ap.barbershopId);
    toast('Agendamento cancelado.','info');renderCustomer();
  });
}
function custReschedule(id){const ap=DB.find('appointments',id);startBooking(ap.barbershopId,ap.serviceId,ap.barberId);booking._reschedule=id;booking.step=3;renderBooking();}
function custEditProfile(){
  const u=Session.effectiveUser;const cust=DB.find('customers',u.customerId);
  openModal(`<div class="modal-head"><h3>Editar perfil</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome</label><input class="input" id="cp_name" value="${escapeHtml(cust.name)}"></div>
    <div class="field"><label>WhatsApp</label><input class="input" id="cp_phone" value="${escapeHtml(cust.phone)}"></div>
    <div class="field"><label>E-mail</label><input class="input" id="cp_email" value="${escapeHtml(cust.email||'')}"></div>
    <div class="field"><label>Aniversário</label><input class="input" type="date" id="cp_bday" value="${cust.birthday||''}"></div>
  </div><div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCustProfile()">Salvar</button></div>`);
}
function saveCustProfile(){
  const u=Session.effectiveUser;
  const name=$('#cp_name').value.trim();
  const phone=$('#cp_phone').value.trim();
  const email=$('#cp_email').value.trim();
  if(name.length<2){toast('Nome precisa ter ao menos 2 caracteres.','err');return;}
  if(phone.replace(/\D/g,'').length<8){toast('Informe um WhatsApp válido.','err');return;}
  if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('E-mail inválido.','err');return;}
  DB.update('customers',u.customerId,{name,phone,whatsapp:phone,email,birthday:$('#cp_bday').value});
  closeModal();toast('Perfil atualizado.','ok');renderCustomer();
}
function switchCustShop(tenantId){
  if(window.fbSwitchCustomerShop){
    window.fbSwitchCustomerShop(tenantId).catch(e=>toast(e.message||'Erro ao trocar barbearia.','err'));
  }
}
function logoutTo(hash){Session.logout();toast('Sessão encerrada.','info');location.hash=hash||'#/';}
