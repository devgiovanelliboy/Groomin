# Groomin — Handoff / Contexto do Projeto

> Documento de continuidade. Abra isto primeiro ao retomar (ou em chat novo).
> Última atualização: 24/06/2026.

## 1. O que é
**Groomin** — plataforma SaaS **multi-tenant** de gestão para barbearias (pt-BR), tema
**Preto + Dourado** premium, **PWA** instalável. Cada barbearia é um tenant isolado.
Público da landing = **donos de barbearia**. Clientes finais entram pelo **link público** da barbearia.

## 2. Stack & arquitetura
- **Front:** SPA estática, **scripts clássicos** (sem build), roteamento por **hash** (`#/...`).
- **Back:** **Firebase** — Auth (e-mail/senha) + **Firestore** (tempo real + offline). Hosting.
- **Modo atual: Spark (grátis), SEM Cloud Functions.** Papel/tenant ficam no doc `/users/{uid}`
  e as regras usam `get()` (não custom claims). Functions estão escritas mas **não** deployadas.
- Flag `window.USE_FIREBASE` (em `js/firebase-config.js`): `true` = nuvem | `false` = demo local.

## 3. Estrutura de arquivos
```
index.html              esqueleto + <link>/<script> ordenados
styles.css              design system (preto+dourado, responsivo, bottom nav)
manifest.webmanifest    PWA
sw.js                   service worker (cache offline, push, background sync)
icon.svg                ícone PWA
js/
  firebase-config.js    config real do projeto + USE_FIREBASE
  01-icons.js           biblioteca de ícones SVG
  02-data-core.js       DB (cache em memória + localStorage), RBAC, Sessão, Router
  03-analytics-landing.js  analytics, entitlements, gating, LANDING, LOGIN, trial signup
  04-public-booking.js  página pública (slug), agendamento 6 passos, área do cliente
  05-admin.js           app-shell (sidebar/appbar/bottom-nav) + Super Admin
  06-dashboard.js       painel da barbearia (agenda, CRM, barbeiros, serviços, config) + barbeiro
  07-marketplace-boot.js  marketplace + inicialização (boot)
  08-pos.js             PDV/caixa, estoque (2 categorias), combos, comissões, consumo
  09-pwa.js             registro do SW + botão instalar + push
  firebase-adapter.js   integração Firebase (auth, bootstrap, listeners, write-through, público)
firebase.json .firebaserc firestore.rules firestore.indexes.json storage.rules
functions/index.js      Cloud Functions (claims, bootstrap, booking) — NÃO deployadas (precisa Blaze)
FIREBASE_SETUP.md QA_REPORT.md HANDOFF.md
```
> Para editar uma área, abra o módulo correspondente (ex.: PDV → `js/08-pos.js`).
> Ordem dos `<script>` importa (prefixos 01..09). Validar sempre com `node --check js/arquivo.js`.

## 4. Firebase (projeto real)
- **Project ID:** `groomin-952d0`  ·  **Hosting:** https://groomin-952d0.web.app
- **Firestore:** região `southamerica-east1` (São Paulo), banco `(default)`.
- **Auth:** E-mail/senha **ativado** (Google também).
- Config web já preenchida em `js/firebase-config.js` (apiKey, appId, etc.). `USE_FIREBASE = true`.
- **No ar e testado** (signup + gravação na nuvem + leitura pública + isolamento 403 comprovados via REST).

## 5. Modelo de dados (Firestore)
```
/tenants/{tid}                       perfil público (nome, slug, horários, ownerUid, status, planId)
/tenants/{tid}/services|barbers|reviews        (LEITURA pública — página de agendamento)
/tenants/{tid}/appointments|customers|products|combos|campaigns|
              sales|cashSessions|stockMoves|blocks|notifications|settings   (privado do tenant)
/users/{uid}      { name, email, role, tenantId, customerId? }   <- fonte de papel/tenant
/slugs/{slug}     { tenantId }   (resolve a página pública)
/subscriptions/{tid}, /invoices, /auditLogs, /platformSettings   (plataforma)
```
- **Isolamento:** regras exigem que o usuário pertença ao tenant (via `get(/users/{uid})`).
  Default deny. Booking público = escrita validada por campos + tenant ativo. **Comprovado (403 p/ intruso).**
- No cache do app, `barbershopId === tenantId` (mesmo shape do modo demo).

## 6. Papéis & rotas (redirect no login)
`super_admin → #/admin` · `owner/manager/receptionist → #/dashboard` · `barber → #/my-schedule` · `customer → #/my-appointments`.
RBAC em `PERMS`/`can()` (02-data-core). Gating de plano: `shopEntitlements()` + `featureLock()` (03).

## 7. Planos & monetização
- Planos: **Free / Growth (R$69) / Pro (R$119) / Elite (R$179)** + **Enterprise** (sob medida, editor no Super Admin).
- Ciclo de cobrança com desconto: mensal / trimestral -10% / semestral -15% / anual -25%.
- **Gating "bloqueado e clicável"** com upsell (IA = Elite; CRM = Growth+; Marketing/Estoque/Financeiro/Comissões/PDV = Pro+).
- Enterprise sobrepõe limites (profissionais, unidades, WhatsApp, IA, API, White Label, App, Relatórios).

## 8. Estado atual — FUNCIONANDO
- ✅ Cadastro de dono (cria tenant + slug + dados iniciais na nuvem).
- ✅ Página pública por slug (`#/slug`) com leitura anônima.
- ✅ Agendamento público sem conta (grava no Firestore, checa conflito).
- ✅ Painel: agenda, CRM, barbeiros, serviços, combos, PDV/caixa, estoque, comissões, financeiro, marketing, IA, config.
- ✅ Multi-tenant isolado, tempo real (onSnapshot), offline (cache Firestore).
- ✅ PWA instalável, mobile bottom-nav, dados de demo removidos no modo nuvem.

## 9. Pendências / limitações conhecidas
1. **Login/conta de CLIENTE no Firebase** — hoje o cliente agenda SEM conta (ok). O fluxo de o
   cliente criar conta própria pra gerenciar horários está só no modo local (não ligado ao Firebase). **(pedido do usuário — próximo passo)**
2. **Link "limpo"** — hoje é `…/#/slug` (hash). Sem `#` (`…/slug`) ainda não roteia. Dá pra adicionar roteamento por path.
3. **Super Admin** — não há super admin criado. Como as regras não deixam o cliente criar um doc
   `role: super_admin`, é preciso criar manualmente o doc `/users/{uid}` no Console (ou via Functions/Blaze).
4. **Cloud Functions** — deployadas em Gen 2 / Node 22:
   `syncUserClaims` (southamerica-east1), `bootstrapTenant`, `createPublicBooking`, `provisionUser` (us-central1).
5. **Storage** — regras deployadas; upload de logo/capa/foto de barbeiro ligado no dashboard.
6. **Produção/escala** — paginação visual de listas grandes, App Check no client e splash iOS foram ligados; ainda recomendado limitar listeners por janela de data antes de alto volume.

## 10. Próximos passos (sugestão de ordem)
1. **Testar o fluxo real** no ar: criar barbearia → pegar slug → abrir o link → agendar.
2. **Ligar login/cadastro de CLIENTE no Firebase** (signup de cliente dentro do link). ← pedido pendente
3. **Roteamento por path** pra link limpo sem `#` (ex.: `groomin-952d0.web.app/esquizo-barber`).
4. (Opcional) Criar o **Super Admin** (doc manual no Firestore) pra ter o painel da plataforma.
5. Testar em produção: cadastro de dono (`bootstrapTenant`), booking público (`createPublicBooking`) e upload real de logo/capa/fotos.
6. Ativar enforcement de **App Check** no Console quando os fluxos acima estiverem validados.

## 11. Comandos úteis
```bash
cd d:/Barbearia
firebase deploy --only hosting                          # publica o front
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only storage
firebase deploy --only functions --force
node --check js/<arquivo>.js                             # checa sintaxe de um módulo
```
- Validação local (jsdom) usada no projeto: testes em
  `C:\Users\DANDAN~1\AppData\Local\Temp\claude\...\scratchpad\*.js` (descartáveis).
- Para voltar ao **modo demo** (sem nuvem): `window.USE_FIREBASE = false` em `js/firebase-config.js`.

## 12. Contas de demonstração (SÓ no modo local, USE_FIREBASE=false)
`super@barberos.com/super123` · `joao@barbeariadojoao.com/owner123` · `gerente@…/manager123` ·
`recepcao@…/recep123` · `rafael@…/barber123` · `cliente@email.com/cliente123`.
> No ar (Firebase) esses NÃO funcionam — crie conta real em "Começar Teste Grátis".
