/* ============================================================
   MARKETPLACE (/find-barbershops) — arquitetura pronta, em pré-lançamento
   ============================================================ */
let mktQuery='';
function renderMarketplace(){
  const flags=DB.get().settings.featureFlags;
  const shops=DB.all('barbershops').filter(s=>s.status==='active');
  const q=mktQuery.toLowerCase();
  const filtered=shops.filter(s=>!q||[s.name,s.city,s.neighborhood,s.description].join(' ').toLowerCase().includes(q)||DB.scope('services',s.id).some(sv=>sv.name.toLowerCase().includes(q)));
  $('#root').innerHTML=`<header class="topbar"><div class="container inner">
    <div class="brand" onclick="Router.go('#/')"><span class="logo">${icon('scissors')}</span><span>Groomin<small>Encontrar barbearia</small></span></div>
    <div class="nav-right"><button class="theme-toggle" data-theme-ic onclick="toggleTheme()"></button><button class="btn btn-ghost btn-sm" onclick="Router.go('#/')">Início</button></div>
  </div></header>
  <main class="container" style="padding:36px 0 60px">
    ${!flags.marketplace?`<div class="insight warn" style="margin-bottom:22px"><span class="ii">${icon('rocket')}</span><div><b>Recurso em pré-lançamento</b><p>O marketplace público está em fase final. A arquitetura multi-tenant já suporta busca por cidade, bairro, serviço e avaliações.</p></div></div>`:''}
    <div class="section-head" style="margin-bottom:24px"><span class="eyebrow">${icon('search')} Marketplace</span><h2>Encontre a melhor barbearia perto de você</h2><p>Busque por nome, cidade, bairro ou serviço.</p></div>
    <div class="search-box" style="width:100%;max-width:560px;margin:0 auto 30px"><span style="left:14px">${icon('search')}</span><input style="padding:13px 16px 13px 42px" placeholder="Ex.: degradê, Centro, Barbearia do João..." value="${escapeHtml(mktQuery)}" oninput="mktQuery=this.value;clearTimeout(window._mkt);window._mkt=setTimeout(renderMarketplace,250)"></div>
    ${filtered.length?`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${filtered.map(s=>{const svc=DB.scope('services',s.id).filter(x=>x.active);const plan=DB.find('plans',s.planId);return `<div class="barber-card" style="cursor:pointer" onclick="Router.go('#/'+'${s.slug}')"><div class="ph"><span class="ini">${initials(s.name)}</span>${plan.id==='elite'||plan.id==='pro'?`<span class="badge gold" style="position:absolute;top:12px;right:12px">${icon('award')} Destaque</span>`:''}</div><div class="bbody"><h3>${escapeHtml(s.name)}</h3><div class="role">${s.rating?s.rating.toFixed(1)+'★':'Novo'} · ${escapeHtml(s.neighborhood||s.city||'')}</div><p class="muted" style="font-size:13px;min-height:38px">${escapeHtml((s.description||'').slice(0,80))}</p><div class="spec">${svc.slice(0,3).map(x=>`<span class="tag">${escapeHtml(x.name)}</span>`).join('')}</div><button class="btn btn-primary btn-sm btn-block" style="margin-top:12px">${icon('calendar')} Agendar</button></div></div>`;}).join('')}</div>`:emptyState('search','Nenhuma barbearia encontrada','Tente outra cidade, bairro ou serviço.')}
  </main>
  <footer class="site"><div class="container"><div class="foot-bottom"><span>Powered by <b style="color:var(--primary)">Groomin</b></span><span><a style="cursor:pointer" onclick="openTrialSignup()">Cadastre sua barbearia →</a></span></div></div></footer>`;
}

/* ============================================================
   BOOT
   ============================================================ */
function applyThemeIcons(){const t=document.documentElement.getAttribute('data-theme');$$('[data-theme-ic]').forEach(b=>{if(!b.innerHTML.trim())b.innerHTML=icon(t==='dark'?'moon':'sun');});}
const _origRender=Router.render.bind(Router);
Router.render=function(){_origRender();applyThemeIcons();};
window.refreshShell=function(){Router.render();};

// expose core singletons (helps debugging + guarantees inline-handler access)
window.DB=DB;window.Session=Session;window.Router=Router;window.can=can;
window.shopAnalytics=shopAnalytics;window.platformAnalytics=platformAnalytics;window.customerStats=customerStats;

// initial route
if(!location.hash)location.hash='#/';
Router.render();
