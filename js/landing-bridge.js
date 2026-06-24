/* Landing pública: mantém a apresentação isolada da aplicação em /app/. */
(function () {
  const appUrl = (hash) => '/app/' + (hash || '');
  const publicMatch = location.pathname.match(/^\/b\/([a-z0-9-]+)\/?$/i);
  const legacyHash = location.hash;

  // Link público compartilhável: /b/nome-da-barbearia.
  if (publicMatch) {
    location.replace(appUrl('#/b/' + encodeURIComponent(publicMatch[1])));
    return;
  }

  // URLs compartilhadas da versão anterior continuam válidas.
  if (legacyHash && legacyHash !== '#/' && legacyHash !== '#') {
    location.replace(appUrl(legacyHash));
    return;
  }

  const originalGo = Router.go.bind(Router);
  Router.go = function (path) {
    if (path === '#/' || path === '/') return originalGo('#/');
    location.href = appUrl(path);
  };

  // Os CTAs da landing sempre entram no fluxo da aplicação.
  window.openOnboarding = window.openTrialSignup = function () {
    location.href = appUrl('#/signup');
  };
  window.openDemo = function () {
    location.href = appUrl('#/login');
  };

  document.title = 'Groomin — Plataforma Completa de Gestão para Barbearias';
  renderLanding();
})();
