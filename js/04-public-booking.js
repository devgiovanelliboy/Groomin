/* ============================================================
   AVAILABILITY ENGINE (tenant-aware, conflict-safe)
   ============================================================ */
function barberSlots(shopId,barberId,dateISO,duration){
  const shop=DB.find('barbershops',shopId);const barber=DB.find('barbers',barberId);
  if(!shop||!barber||!barber.active)return [];
  const dow=new Date(dateISO+'T00:00:00').getDay();
  if(!barber.days.includes(dow))return [];
  if((barber.vacations||[]).some(v=>dateISO>=v.start&&dateISO<=v.end))return [];
  // full-day block
  const blocks=DB.scope('blocks',shopId).filter(b=>b.barberId===barberId&&b.date===dateISO);
  if(blocks.some(b=>b.fullDay))return [];
  const interval=shop.slotInterval||30;
  const startM=timeToMin(barber.start),endM=timeToMin(barber.end);
  const lunchS=timeToMin(barber.lunchStart||shop.lunchStart),lunchE=timeToMin(barber.lunchEnd||shop.lunchEnd);
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
function renderPublic(r){
  let shop=DB.findBy('barbershops',s=>s.slug===r.slug);
  // Firebase ligado e ainda sem os dados em cache: carrega a barbearia de forma anônima
  if(!shop&&window.__FB_ENABLED&&window.fbLoadPublicShop&&!r._loaded){
    $('#root').innerHTML=publicShell(`<div class="container" style="padding:60px 0;text-align:center"><div class="skeleton" style="height:24px;width:240px;margin:0 auto 14px"></div><p class="muted">Carregando barbearia…</p></div>`);
    fbLoadPublicShop(r.slug).then(found=>{ r._loaded=true; renderPublic(r); }).catch(()=>{ r._loaded=true; renderPublic(r); });
    return;
  }
  if(!shop){$('#root').innerHTML=publicShell(`<div class="container">${emptyState('search','Barbearia não encontrada','O link pode estar incorreto.')}<div style="text-align:center"><button class="btn btn-primary" onclick="Router.go('#/')">Voltar ao início</button></div></div>`);return;}
  if(shop.status==='suspended'){$('#root').innerHTML=publicShell(`<div class="container">${emptyState('alert','Página temporariamente indisponível','Esta barbearia não está aceitando agendamentos no momento.')}</div>`);return;}
  document.title=`${shop.name} — Agende online | Groomin`;
  window.currentPublicShopId=shop.id;
  sessionStorage.setItem('groomin_login_shop',shop.id);
  const services=DB.scope('services',shop.id).filter(s=>s.active);
  const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  const reviews=DB.scope('reviews',shop.id);
  const flags=DB.get().settings.featureFlags;
  $('#root').innerHTML=publicShell(`
    <div class="container">
      <div class="cover"></div>
      <div class="shop-head">
        <div class="shop-logo">${brandLogo(shop,'shop-logo-img')}</div>
        <div style="flex:1;padding-bottom:6px">
          <h1 style="font-size:clamp(1.6rem,4vw,2.2rem)">${escapeHtml(shop.name)}</h1>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
            ${shop.rating?`<span class="stars-static">${'<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'.repeat(Math.round(shop.rating))}</span><b>${shop.rating.toFixed(1)}</b><span class="muted" style="font-size:13px">(${reviews.length} avaliações)</span>`:'<span class="badge muted">Novo na plataforma</span>'}
          </div>
        </div>
      </div>
      <p class="muted" style="max-width:680px;margin:18px 0">${escapeHtml(shop.description)}</p>
      <div class="shop-meta">
        ${shop.address?`<span>${icon('mapPin')} ${escapeHtml(shop.address)}</span>`:''}
        <span>${icon('clock')} ${shop.open} – ${shop.close}</span>
        ${shop.phone?`<span>${icon('phone')} ${escapeHtml(shop.phone)}</span>`:''}
        ${shop.whatsapp?`<span>${icon('whatsapp')} ${escapeHtml(shop.whatsapp)}</span>`:''}
        ${shop.instagram?`<span>${icon('instagram')} ${escapeHtml(shop.instagram)}</span>`:''}
      </div>
      <div class="shop-cols" style="margin-top:30px">
        <div>
          <div class="panel-head"><h3 style="font-size:20px">Serviços</h3></div>
          <div class="svc-grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">
            ${services.length?services.map(s=>`<div class="svc-card"><div class="svc-ic">${icon(s.icon||'scissors')}</div><span class="tag" style="margin-bottom:8px">${escapeHtml(s.category)}</span><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.desc)}</p><div class="svc-foot"><div><span class="price">${money(s.price)}</span><div class="dur">${icon('clock')} ${s.duration} min</div></div><button class="btn btn-ghost btn-sm" onclick="startBooking('${shop.id}','${s.id}')">Agendar</button></div></div>`).join(''):emptyState('scissors','Sem serviços ainda','Esta barbearia ainda não cadastrou serviços.')}
          </div>
          <div class="panel-head" style="margin-top:34px"><h3 style="font-size:20px">Profissionais</h3></div>
          <div class="barber-grid">${barbers.map(b=>`<div class="barber-card"><div class="ph">${imageOrInitials(b.photoUrl,b.name,'barber-photo')}</div><div class="bbody"><h3>${escapeHtml(b.name)}</h3><div class="role">${escapeHtml(b.role)} · ${b.rating}★</div><div class="spec">${b.specialties.slice(0,3).map(s=>`<span class="tag">${escapeHtml(s)}</span>`).join('')}</div></div></div>`).join('')}</div>
          ${flags.reviews&&reviews.length?`<div class="panel-head" style="margin-top:34px"><h3 style="font-size:20px">Avaliações</h3></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${reviews.map(rv=>`<div class="review-card"><div class="stars-static">${'<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'.repeat(rv.rating)}</div><p style="margin:10px 0;font-size:14.5px">"${escapeHtml(rv.text)}"</p><div style="display:flex;justify-content:space-between"><b style="font-size:13px">${escapeHtml(rv.customerName)}</b><span class="muted" style="font-size:12px">${fmtDateShort(rv.date)}</span></div></div>`).join('')}</div>`:''}
        </div>
        <div>
          <div class="panel" style="position:sticky;top:90px">
            <h3 style="margin-bottom:6px">Agende seu horário</h3>
            <p class="muted" style="font-size:13.5px;margin-bottom:16px">Agende online em poucos passos.</p>
            <button class="btn btn-primary btn-block" onclick="startBooking('${shop.id}')">${icon('calendar')} Reservar agora</button>
            <div class="summary-line" style="margin-top:16px"><span class="muted">Horário</span><b>${shop.open} – ${shop.close}</b></div>
            <div class="summary-line"><span class="muted">Profissionais</span><b>${barbers.length}</b></div>
            <div class="summary-line"><span class="muted">Serviços</span><b>${services.length}</b></div>
            ${shop.whatsapp?`<a class="btn btn-ghost btn-block" style="margin-top:12px" href="https://wa.me/55${shop.whatsapp.replace(/\D/g,'')}" target="_blank" rel="noopener">${icon('whatsapp')} Falar no WhatsApp</a>`:''}
          </div>
        </div>
      </div>
    </div>`);
  if(window._pendingBooking&&window._pendingBooking.shopId===shop.id){
    const pb=window._pendingBooking;window._pendingBooking=null;
    setTimeout(()=>startBooking(pb.shopId,pb.serviceId,pb.barberId),200);
  }
}
function publicShell(inner){
  const u=Session.user;
  return `<header class="topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/')"><span class="logo">${icon('scissors')}</span><span>Groomin<small>Agendamento online</small></span></div>
    <div class="nav-right">
      <button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
      ${u&&u.role==='customer'?`<button class="btn btn-ghost btn-sm" onclick="Router.go('#/my-appointments')">${icon('user')} Minha conta</button>`:`<button class="btn btn-ghost btn-sm" onclick="openPublicCustomerLogin(currentPublicShopId||'')">${icon('user')} Entrar / Criar conta</button>`}
      <button class="btn btn-outline btn-sm" onclick="Router.go('#/find-barbershops')">${icon('search')} Barbearias</button>
    </div>
  </div></header><main style="padding:30px 0 60px">${inner}</main>
  <footer class="site"><div class="container"><div class="foot-bottom"><span>Powered by <b style="color:var(--primary)">Groomin</b></span><span><a style="cursor:pointer" onclick="openOnboarding()">Tenha sua barbearia aqui →</a></span></div></div></footer>`;
}

/* ============================================================
   BOOKING WIZARD (7 steps, no account required)
   ============================================================ */
let booking={};
function startBooking(shopId,serviceId,barberId){
  if(window.__FB_ENABLED){
    const u=Session.effectiveUser;
    if(!(u&&u.role==='customer')){
      window._pendingBooking={shopId,serviceId:serviceId||null,barberId:barberId||null};
      sessionStorage.setItem('groomin_login_shop',shopId);
      toast('Entre na sua conta para agendar.','info');
      openPublicCustomerLogin(shopId);return;
    }
  }
  booking={shopId,service:serviceId||null,barber:barberId||null,date:null,time:null,assignedBarber:null,name:'',phone:'',email:'',step:1};
  const u=Session.effectiveUser;
  if(u&&u.role==='customer'){
    const c=u.barbershopId===shopId?DB.find('customers',u.customerId):null;
    booking.name=(c&&c.name)||u.name||'';
    booking.phone=(c&&c.phone)||'';
    booking.email=(c&&c.email)||u.email||'';
  }
  if(serviceId)booking.step=2;
  renderBooking();
}
function renderBooking(){
  const steps=['Serviço','Barbeiro','Data','Horário','Dados','Confirmar'];
  openModal(`<div class="modal-head"><div><h3>Agendar horário</h3><div class="sub">Passo ${Math.min(booking.step,6)} de 6</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="wizard-steps">${steps.map((s,i)=>{const n=i+1;const cls=booking.step===n?'active':booking.step>n?'done':'';return `<div class="wstep ${cls}"><div class="num">${booking.step>n?icon('check'):n}</div><div class="lbl">${s}</div></div>`;}).join('')}</div><div id="bookStep"></div></div>`,'lg');
  renderBookingStep();
}
function renderBookingStep(){
  const c=$('#bookStep');const shopId=booking.shopId;
  if(booking.step===1){
    const svcs=DB.scope('services',shopId).filter(s=>s.active);
    c.innerHTML=`<h4 style="margin-bottom:14px">Escolha o serviço</h4><div class="select-grid">${svcs.map(s=>`<div class="select-item ${booking.service===s.id?'sel':''}" onclick="pickService('${s.id}')"><div class="t">${escapeHtml(s.name)}</div><div class="d">${s.duration} min · ${escapeHtml(s.category)}</div><div class="p">${money(s.price)}</div></div>`).join('')}</div>`;
  }else if(booking.step===2){
    const barbers=DB.scope('barbers',shopId).filter(b=>b.active);
    c.innerHTML=`<h4 style="margin-bottom:14px">Escolha o profissional</h4><div class="select-grid">
      <div class="select-item ${booking.barber==='any'?'sel':''}" onclick="pickBarber('any')"><div style="display:flex;align-items:center;gap:10px"><div class="t-user"><div class="av">${icon('users')}</div></div><div><div class="t">Qualquer profissional</div><div class="d">Primeiro horário disponível</div></div></div></div>
      ${barbers.map(b=>`<div class="select-item ${booking.barber===b.id?'sel':''}" onclick="pickBarber('${b.id}')"><div style="display:flex;align-items:center;gap:10px"><div class="t-user"><div class="av">${imageOrInitials(b.photoUrl,b.name,'mini-avatar-img')}</div></div><div><div class="t">${escapeHtml(b.name)}</div><div class="d">${escapeHtml(b.role)} · ${b.rating}★</div></div></div></div>`).join('')}</div>
      <div style="margin-top:18px"><button class="btn btn-ghost" onclick="bookGo(1)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===3){
    const dates=[];for(let i=0;i<14;i++)dates.push(DB.addDays(DB.todayISO(),i));
    const svc=DB.find('services',booking.service);
    c.innerHTML=`<h4 style="margin-bottom:14px">Escolha a data</h4><div class="date-strip">${dates.map(dt=>{
      const day=new Date(dt+'T00:00:00');const works=booking.barber==='any'?anySlots(shopId,dt,svc.duration).some(s=>s.available):barberSlots(shopId,booking.barber,dt,svc.duration).some(s=>s.available);
      return `<button class="date-pill ${booking.date===dt?'sel':''}" ${works?'':'disabled'} onclick="pickDate('${dt}')"><div class="dow">${DOW[day.getDay()]}</div><div class="dnum">${day.getDate()}</div><div class="mon">${MON[day.getMonth()]}</div></button>`;}).join('')}</div>
      <div style="margin-top:18px"><button class="btn btn-ghost" onclick="bookGo(2)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===4){
    const svc=DB.find('services',booking.service);
    const slots=booking.barber==='any'?anySlots(shopId,booking.date,svc.duration):barberSlots(shopId,booking.barber,booking.date,svc.duration);
    c.innerHTML=`<h4 style="margin-bottom:6px">Horários — ${fmtDate(booking.date)}</h4><p class="muted" style="font-size:13px;margin-bottom:14px">${DOW_FULL[new Date(booking.date+'T00:00:00').getDay()]}</p>
      ${slots.length?`<div class="slot-grid">${slots.map(s=>`<button class="slot ${booking.time===s.time?'sel':''}" ${s.available?'':'disabled'} onclick="pickTime('${s.time}','${s.barberId||''}')">${s.time}</button>`).join('')}</div>`:emptyState('clock','Sem horários','Não há horários livres nesta data.')}
      <div style="margin-top:18px"><button class="btn btn-ghost" onclick="bookGo(3)">${icon('arrowLeft')} Voltar</button></div>`;
  }else if(booking.step===5){
    const _u5=Session.effectiveUser;
    if(window.__FB_ENABLED&&_u5&&_u5.role==='customer'){
      c.innerHTML=`<h4 style="margin-bottom:14px">Confirmando como</h4>
        <div class="card" style="padding:16px;margin-bottom:16px">
          <div class="summary-line"><span class="muted">Nome</span><b>${escapeHtml(booking.name||'—')}</b></div>
          <div class="summary-line"><span class="muted">WhatsApp</span><b>${escapeHtml(booking.phone||'—')}</b></div>
          <div class="summary-line"><span class="muted">E-mail</span><b>${escapeHtml(booking.email||'—')}</b></div>
        </div>
        <p class="muted" style="font-size:12.5px">${icon('user')} Dados da sua conta Groomin.</p>
        <div style="margin-top:14px;display:flex;justify-content:space-between"><button class="btn btn-ghost" onclick="bookGo(4)">${icon('arrowLeft')} Voltar</button><button class="btn btn-primary" onclick="bookGo(6)">Revisar ${icon('arrowRight')}</button></div>`;
      return;
    }
    c.innerHTML=`<h4 style="margin-bottom:14px">Seus dados</h4>
      <div class="field"><label>Nome completo *</label><div class="input-icon">${icon('user')}<input class="input" id="bk_name" value="${escapeHtml(booking.name)}" placeholder="Ex.: João da Silva"></div><div class="err">Informe seu nome.</div></div>
      <div class="form-row">
        <div class="field"><label>WhatsApp *</label><div class="input-icon">${icon('whatsapp')}<input class="input" id="bk_phone" value="${escapeHtml(booking.phone)}" placeholder="(11) 90000-0000"></div><div class="err">Telefone inválido.</div></div>
        <div class="field"><label>E-mail *</label><div class="input-icon">${icon('mail')}<input class="input" id="bk_email" value="${escapeHtml(booking.email)}" placeholder="voce@email.com"></div><div class="err">E-mail inválido.</div></div>
      </div>
      <div style="margin-top:14px;display:flex;justify-content:space-between"><button class="btn btn-ghost" onclick="bookGo(4)">${icon('arrowLeft')} Voltar</button><button class="btn btn-primary" onclick="submitBookingData()">Revisar ${icon('arrowRight')}</button></div>`;
  }else if(booking.step===6){
    const shop=DB.find('barbershops',shopId),svc=DB.find('services',booking.service);
    const bid=booking.barber==='any'?(booking.assignedBarber||firstAvailableBarber(shopId,booking.date,booking.time,svc.duration)):booking.barber;
    const barber=DB.find('barbers',bid);
    c.innerHTML=`<h4 style="text-align:left;margin-bottom:14px">Confirme seu agendamento</h4>
      <div class="card" style="padding:18px;text-align:left">
        <div class="summary-line"><span class="muted">Barbearia</span><b>${escapeHtml(shop.name)}</b></div>
        <div class="summary-line"><span class="muted">Serviço</span><b>${escapeHtml(svc.name)}</b></div>
        <div class="summary-line"><span class="muted">Profissional</span><b>${barber?escapeHtml(barber.name):'A definir'}${booking.barber==='any'?' <span class="badge muted">auto</span>':''}</b></div>
        <div class="summary-line"><span class="muted">Data</span><b>${DOW_FULL[new Date(booking.date+'T00:00:00').getDay()]}, ${fmtDate(booking.date)}</b></div>
        <div class="summary-line"><span class="muted">Horário</span><b>${booking.time} (${svc.duration} min)</b></div>
        <div class="summary-line"><span class="muted">Cliente</span><b>${escapeHtml(booking.name)}</b></div>
        <div class="summary-line"><span class="muted">Total</span><b style="color:var(--primary);font-size:18px">${money(svc.price)}</b></div>
      </div>
      <div style="margin-top:18px;display:flex;justify-content:space-between"><button class="btn btn-ghost" onclick="bookGo(5)">${icon('arrowLeft')} Voltar</button><button id="btn_confirm" class="btn btn-primary" onclick="confirmBooking()">${icon('check')} Confirmar</button></div>`;
  }
}
function pickService(id){booking.service=id;renderBookingStep();setTimeout(()=>bookGo(2),160);}
function pickBarber(id){booking.barber=id;renderBookingStep();setTimeout(()=>bookGo(3),160);}
function pickDate(dt){booking.date=dt;booking.time=null;renderBookingStep();setTimeout(()=>bookGo(4),140);}
function pickTime(t,bid){booking.time=t;booking.assignedBarber=bid||null;renderBookingStep();setTimeout(()=>bookGo(5),180);}
function bookGo(step){
  if(step>=3&&!booking.barber){toast('Escolha um profissional.','err');return;}
  if(step>=4&&!booking.date){toast('Escolha uma data.','err');return;}
  if(step>=5&&!booking.time){toast('Escolha um horário.','err');return;}
  booking.step=step;renderBooking();
}
function submitBookingData(){
  const name=$('#bk_name').value.trim(),phone=$('#bk_phone').value.trim(),email=$('#bk_email').value.trim();
  let ok=true;const inv=(id,bad)=>{$('#'+id).closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
  inv('bk_name',name.length<2);inv('bk_phone',phone.replace(/\D/g,'').length<10);inv('bk_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
  if(!ok){toast('Confira os campos destacados.','err');return;}
  booking.name=name;booking.phone=phone;booking.email=email;booking.step=6;renderBooking();
}
function confirmBooking(){
  const shopId=booking.shopId,svc=DB.find('services',booking.service);
  const bid0=booking.barber==='any'?firstAvailableBarber(shopId,booking.date,booking.time,svc.duration):booking.barber;
  if(window.__FB_ENABLED){
    if(!bid0){toast('Horário indisponível. Escolha outro.','err');booking.step=4;renderBooking();return;}
    const btn=$('#btn_confirm');if(btn){btn.disabled=true;btn.innerHTML=`${icon('clock')} Confirmando…`;}
    const _u=Session.effectiveUser;
    const _loggedCustId=(_u&&_u.role==='customer'&&_u.barbershopId===shopId)?_u.customerId:undefined;
    const _rescheduleId=booking._reschedule||null;
    fbPublicBooking({tenantId:shopId,serviceId:svc.id,barberId:bid0,date:booking.date,time:booking.time,name:booking.name,phone:booking.phone,email:booking.email,customerId:_loggedCustId,duration:svc.duration,price:svc.price})
      .then(res=>{
        if(_rescheduleId)DB.update('appointments',_rescheduleId,{status:'cancelado'});
        const shop=DB.find('barbershops',shopId),barber=DB.find('barbers',bid0);
        $('#modal').querySelector('.modal-body').innerHTML=`<div class="success-wrap"><div class="success-check">${icon('check')}</div><h3 style="font-size:23px;margin-bottom:8px">Agendamento confirmado! 🎉</h3><p class="muted" style="max-width:400px;margin:0 auto 8px">Seu horário foi reservado com sucesso. Se precisar remarcar, acesse sua conta ou fale com a barbearia.</p><div class="card" style="padding:18px;text-align:left;max-width:400px;margin:18px auto 0"><div class="summary-line"><span class="muted">Serviço</span><b>${escapeHtml(svc.name)}</b></div><div class="summary-line"><span class="muted">Quando</span><b>${fmtDate(booking.date)} · ${booking.time}</b></div><div class="summary-line"><span class="muted">Código</span><b>#${String(res.appointmentId||'').slice(-6).toUpperCase()}</b></div></div><div style="margin-top:22px"><button class="btn btn-primary" onclick="closeModal()">Fechar</button>${_loggedCustId?`<button class="btn btn-ghost" style="margin-left:8px" onclick="closeModal();Router.go('#/my-appointments')">${icon('calendar')} Meus agendamentos</button>`:''}</div></div>`;
        toast('Agendamento confirmado.','ok');
        // Actualiza a página do cliente em background para que a lista de agendamentos
        // reflita o novo item quando o usuário fechar o modal (já está em #/my-appointments)
        setTimeout(()=>{ if(window.renderCustomer)renderCustomer(); },300);
      })
      .catch(err=>{if(btn){btn.disabled=false;btn.innerHTML=`${icon('check')} Confirmar`;}toast(fbErrMsg(err,'booking'),'err');booking.step=4;renderBooking();});
    return;
  }
  const bid=bid0;
  if(!bid){toast('Horário não está mais disponível. Escolha outro.','err');booking.step=4;renderBooking();return;}
  const slot=barberSlots(shopId,bid,booking.date,svc.duration).find(s=>s.time===booking.time);
  if(!slot||!slot.available){toast('Esse horário acabou de ser reservado.','err');booking.step=4;renderBooking();return;}
  let cust=DB.scope('customers',shopId).find(c=>c.phone===booking.phone||(booking.email&&c.email===booking.email));
  if(!cust)cust=DB.insert('customers',{barbershopId:shopId,name:booking.name,phone:booking.phone,whatsapp:booking.phone,email:booking.email,birthday:'',notes:''});
  if(booking._reschedule)DB.remove('appointments',booking._reschedule);
  const appt=DB.insert('appointments',{barbershopId:shopId,customerId:cust.id,customerName:booking.name,phone:booking.phone,serviceId:svc.id,barberId:bid,date:booking.date,time:booking.time,status:'confirmado',price:svc.price,createdAt:Date.now()});
  DB.insert('notifications',{barbershopId:shopId,type:booking._reschedule?'reschedule':'confirm',title:booking._reschedule?'Reagendamento':'Novo agendamento',msg:`${booking.name} — ${svc.name} ${fmtDateShort(booking.date)} ${booking.time}`,time:Date.now(),read:false});
  DB.log(booking._reschedule?'Agendamento remarcado':'Agendamento criado',`${booking.name} · ${fmtDateShort(booking.date)} ${booking.time}`,shopId);
  const barber=DB.find('barbers',bid),shop=DB.find('barbershops',shopId);
  $('#modal').querySelector('.modal-body').innerHTML=`<div class="success-wrap"><div class="success-check">${icon('check')}</div>
    <h3 style="font-size:23px;margin-bottom:8px">Agendamento confirmado! 🎉</h3>
    <p class="muted" style="max-width:400px;margin:0 auto 8px">Enviamos a confirmação para o seu WhatsApp e e-mail. Você receberá um lembrete antes do horário.</p>
    <div class="card" style="padding:18px;text-align:left;max-width:400px;margin:18px auto 0">
      <div class="summary-line"><span class="muted">Barbearia</span><b>${escapeHtml(shop.name)}</b></div>
      <div class="summary-line"><span class="muted">Serviço</span><b>${escapeHtml(svc.name)}</b></div>
      <div class="summary-line"><span class="muted">Profissional</span><b>${escapeHtml(barber.name)}</b></div>
      <div class="summary-line"><span class="muted">Quando</span><b>${fmtDate(booking.date)} · ${booking.time}</b></div>
      <div class="summary-line"><span class="muted">Código</span><b>#${appt.id.slice(-6).toUpperCase()}</b></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      <button class="btn btn-outline" onclick="offerAccount('${shopId}','${cust.id}')">${icon('user')} Gerenciar meus horários</button>
    </div></div>`;
  toast('Agendamento confirmado!','ok');
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
  const cust=DB.find('customers',custId);const email=$('#ac_email').value.trim(),pass=$('#ac_pass').value;
  if(pass.length<6){$('#ac_pass').closest('.field').classList.add('invalid');return;}
  if(window.__FB_ENABLED){
    const btn=document.querySelector('.modal-foot .btn-primary');if(btn){btn.disabled=true;btn.textContent='Criando conta…';}
    fbSignUpCustomer({name:cust.name,email,password:pass,phone:cust.phone||'',tenantId:shopId})
      .then(()=>{closeModal();toast('Conta criada! 🎉','ok');location.hash='#/my-appointments';})
      .catch(err=>{if(btn){btn.disabled=false;btn.textContent='Criar conta';}toast(fbErrMsg(err,'signup'),'err');});
    return;
  }
  if(DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase())){toast('E-mail já cadastrado.','err');return;}
  DB.update('customers',custId,{email});
  DB.insert('users',{name:cust.name,email,password:pass,role:'customer',barbershopId:shopId,customerId:custId,active:true});
  Session.login(email,pass);closeModal();toast('Conta criada!','ok');location.hash='#/my-appointments';
}

/* Login/cadastro de cliente diretamente na página da barbearia */
function openPublicCustomerLogin(shopId){
  window._pclTab='login';
  function render(){
    const tab=window._pclTab;
    const body=tab==='login'
      ?`<div class="field"><label>E-mail</label><input class="input" id="pcl_email" placeholder="voce@email.com"><div class="err">E-mail inválido.</div></div>
         <div class="field"><label>Senha</label><input class="input" type="password" id="pcl_pass" placeholder="Sua senha"><div class="err">Mínimo 6 caracteres.</div></div>
         <p style="font-size:13px;margin-top:10px" class="muted">Novo por aqui? <a style="color:var(--primary);cursor:pointer" onclick="window._pclTab='register';pclRe()">Criar conta →</a></p>`
      :`<div class="field"><label>Seu nome *</label><input class="input" id="pcl_name" placeholder="Nome completo"><div class="err">Informe seu nome.</div></div>
         <div class="field"><label>E-mail *</label><input class="input" id="pcl_email" placeholder="voce@email.com"><div class="err">E-mail inválido.</div></div>
         <div class="field"><label>WhatsApp</label><input class="input" id="pcl_phone" placeholder="(11) 9 0000-0000"></div>
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
  const email=($('#pcl_email')||{}).value?.trim()||'';
  const pass=($('#pcl_pass')||{}).value||'';
  if(action==='login'){
    const ok=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)&&pass.length>=6;
    if(!ok){toast('Confira e-mail e senha.','err');return;}
    if(window.__FB_ENABLED){
      const btn=$('#pcl_btn');if(btn){btn.disabled=true;btn.innerHTML='Entrando…';}
      sessionStorage.setItem('groomin_intended','#/my-appointments');
      fbSignIn(email,pass)
        .then(()=>{closeModal();})
        .catch(err=>{if(btn){btn.disabled=false;btn.innerHTML='Entrar';}sessionStorage.removeItem('groomin_intended');toast(fbErrMsg(err,'login'),'err');});
      return;
    }
    if(!Session.login(email,pass)){toast('E-mail ou senha incorretos.','err');return;}
    closeModal();location.hash='#/my-appointments';return;
  }
  // register
  const name=($('#pcl_name')||{}).value?.trim()||'';
  const phone=($('#pcl_phone')||{}).value?.trim()||'';
  let ok=true;
  const inv=(id,bad)=>{const el=$('#'+id);if(el)el.closest('.field').classList.toggle('invalid',bad);if(bad)ok=false;};
  inv('pcl_name',name.length<2);inv('pcl_email',!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));inv('pcl_pass',pass.length<6);
  if(!ok){toast('Confira os campos destacados.','err');return;}
  if(window.__FB_ENABLED){
    const btn=$('#pcl_btn');if(btn){btn.disabled=true;btn.innerHTML='Criando conta…';}
    sessionStorage.setItem('groomin_intended','#/my-appointments');
    fbSignUpCustomer({name,email,password:pass,phone,tenantId:shopId})
      .then(()=>{closeModal();toast('Conta criada! 🎉','ok');})
      .catch(err=>{if(btn){btn.disabled=false;btn.innerHTML='Criar conta';}sessionStorage.removeItem('groomin_intended');toast(fbErrMsg(err,'signup'),'err');});
    return;
  }
  if(DB.get().users.find(u=>u.email.toLowerCase()===email.toLowerCase())){toast('E-mail já cadastrado.','err');return;}
  let cust=DB.get().customers.find(c=>c.barbershopId===shopId&&c.email&&c.email.toLowerCase()===email.toLowerCase());
  if(!cust)cust=DB.insert('customers',{barbershopId:shopId,name,email,phone,whatsapp:phone,notes:'',createdAt:Date.now()});
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
      $('#root').innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div class="skeleton" style="width:200px;height:16px;border-radius:6px"></div><p class="muted" style="font-size:13px">Carregando seus agendamentos…</p></div>`;
      return;
    }
    location.hash='#/';return;
  }
  const t=DB.todayISO();
  const all=DB.scope('appointments',u.barbershopId).filter(a=>a.customerId===u.customerId).sort((x,y)=>(y.date+y.time).localeCompare(x.date+x.time));
  const list=custTab==='proximos'?all.filter(a=>a.date>=t&&a.status!=='cancelado'&&a.status!=='concluido'):all;
  $('#root').innerHTML=`<header class="topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/'+'${shop.slug}')"><span class="logo">${icon('scissors')}</span><span>${escapeHtml(shop.name)}<small>Área do cliente</small></span></div>
    <div class="nav-right"><button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button>
      <button class="btn btn-primary btn-sm" onclick="startBooking('${shop.id}')">${icon('plus')} Agendar</button>
      <button class="btn btn-ghost btn-sm" onclick="logoutTo('#/'+'${shop.slug}')">${icon('logout')} Sair</button></div>
  </div></header>
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
function custCancel(id){confirmAction('Cancelar agendamento?','Você poderá agendar um novo horário quando quiser.',()=>{DB.update('appointments',id,{status:'cancelado'});const ap=DB.find('appointments',id);DB.insert('notifications',{barbershopId:ap.barbershopId,type:'cancel',title:'Cancelamento',msg:`${ap.customerName} cancelou ${fmtDateShort(ap.date)} ${ap.time}`,time:Date.now(),read:false});DB.log('Agendamento cancelado',ap.customerName,ap.barbershopId);toast('Agendamento cancelado.','info');renderCustomer();});}
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
function saveCustProfile(){const u=Session.effectiveUser;DB.update('customers',u.customerId,{name:$('#cp_name').value.trim(),phone:$('#cp_phone').value.trim(),whatsapp:$('#cp_phone').value.trim(),email:$('#cp_email').value.trim(),birthday:$('#cp_bday').value});closeModal();toast('Perfil atualizado.','ok');renderCustomer();}
function logoutTo(hash){Session.logout();toast('Sessão encerrada.','info');location.hash=hash||'#/';}
