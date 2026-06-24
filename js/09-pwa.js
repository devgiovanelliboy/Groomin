/* ============================================================
   PWA — Service Worker + Instalação
   (SW só registra em https/localhost; em file:// é ignorado)
   ============================================================ */
(function(){
  const canSW = 'serviceWorker' in navigator &&
    (location.protocol==='https:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname));
  if(canSW){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('sw.js').then(reg=>{
        reg.addEventListener('updatefound',()=>{
          const nw=reg.installing;if(!nw)return;
          nw.addEventListener('statechange',()=>{
            if(nw.state==='installed'&&navigator.serviceWorker.controller){
              toast('Nova versão disponível. Recarregue para atualizar.','info');
            }
          });
        });
        // background sync (best-effort) — Firestore já reenfileira escritas offline
        try{ if('sync' in reg){ reg.sync.register('groomin-sync').catch(()=>{}); } }catch(e){}
      }).catch(()=>{});
    });
    // SW pede refresh (sync/periodicsync) -> revalida a tela
    navigator.serviceWorker.addEventListener('message',(ev)=>{
      if(ev.data&&(ev.data.type==='SYNC'||ev.data.type==='REFRESH')&&window.Router&&location.hash){Router.render();}
    });
  }
  // Habilitar notificações push (FCM) — chamado sob demanda quando o Firebase está ligado
  window.enablePush=async function(){
    if(!window.__FB_ENABLED||!window.FB||!window.FB.app){toast('Conecte o Firebase para ativar notificações.','info');return;}
    try{
      const perm=await Notification.requestPermission();
      if(perm!=='granted'){toast('Permissão de notificações negada.','err');return;}
      const SDK='https://www.gstatic.com/firebasejs/10.12.5/';
      const m=await import(SDK+'firebase-messaging.js');
      const messaging=m.getMessaging(FB.app);
      const reg=await navigator.serviceWorker.ready;
      const token=await m.getToken(messaging,{vapidKey:window.FCM_VAPID_KEY,serviceWorkerRegistration:reg});
      if(token){toast('Notificações ativadas neste dispositivo.','ok');
        // mensagens em primeiro plano
        m.onMessage(messaging,(payload)=>{const n=(payload&&payload.notification)||{};toast((n.title?n.title+': ':'')+(n.body||'Nova notificação'),'info');});
        return token;}
    }catch(e){console.warn('push',e);toast('Não foi possível ativar as notificações.','err');}
  };
  // Botão de instalação (Android/desktop via beforeinstallprompt)
  let deferred=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;showInstall();});
  window.addEventListener('appinstalled',()=>{removeInstall();toast('Groomin instalado! 💈','ok');});
  function showInstall(){
    if(document.getElementById('pwaInstall')||window.matchMedia('(display-mode: standalone)').matches)return;
    const b=document.createElement('button');
    b.id='pwaInstall';b.className='btn btn-primary';
    b.style.cssText='position:fixed;left:18px;bottom:18px;z-index:250;box-shadow:var(--shadow-lg)';
    b.innerHTML=icon('download')+' Instalar app';
    b.onclick=async()=>{if(!deferred)return;deferred.prompt();try{await deferred.userChoice;}catch(e){}deferred=null;removeInstall();};
    document.body.appendChild(b);
  }
  function removeInstall(){const b=document.getElementById('pwaInstall');if(b)b.remove();}
})();
