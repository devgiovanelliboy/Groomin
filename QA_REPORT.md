# BarberOS — Revisão de QA (Arquitetura · Firebase · Mobile · QA)

Revisão conduzida nos papéis de **Arquiteto de Software Sênior**, **Engenheiro Firebase Sênior**,
**Desenvolvedor Mobile Sênior** e **Engenheiro de QA Sênior**. Severidade: 🔴 crítica · 🟠 alta · 🟡 média · 🟢 ok.

---

## 1. Multi-tenant & isolamento de dados
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 1.1 | Sem isolamento server-side (era só localStorage no cliente) | 🔴 | **Corrigido** — Firestore Rules exigem `request.auth.token.tenantId == {tid}` em todo acesso; dados de tenant em subcoleções de `/tenants/{tid}`. |
| 1.2 | Papel/tenant poderiam ser forjados no cliente | 🔴 | **Corrigido** — papel e tenant vêm de **custom claims** definidas por Cloud Function (`syncUserClaims`) a partir de `/users/{uid}`. Cliente não consegue elevar privilégio. |
| 1.3 | Escrita pública (agendar sem conta) abriria o banco | 🔴 | **Corrigido** — booking público só pela callable `createPublicBooking` (valida tenant/horário no servidor). Rules **não** permitem create aberto em `appointments`. |
| 1.4 | Troca de `tenantId` no payload p/ "pular" de tenant | 🟠 | **Corrigido** — `users` update bloqueia mudança de `tenantId`/`role`; escrita de tenant validada por path. |
| 1.5 | `default deny` ausente | 🟠 | **Corrigido** — `match /{document=**} { allow read,write: if false }`. |

## 2. Autenticação
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 2.1 | Senhas em texto puro no seed (demo) | 🔴 | **Corrigido em prod** — Firebase Auth gerencia credenciais (hash/salt). Seed local é só demonstração. |
| 2.2 | Sem verificação de papel no redirect | 🟡 | **Corrigido** — `onAuthStateChanged` lê claims e redireciona (`homeRouteFor`). |
| 2.3 | Provisão de staff sem controle | 🟠 | **Corrigido** — `provisionUser` exige super admin ou dono/gerente do próprio tenant. |
| 2.4 | E-mail não verificado pode agendar | 🟢 | Aceitável — booking público é por telefone; recomendar verificação de e-mail para contas. |

## 3. Firestore — escala & performance
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 3.1 | Consultas sem índice em produção | 🟠 | **Corrigido** — `firestore.indexes.json` (agenda por barbeiro/data, status/data, cliente/data, vendas, estoque, marketplace). |
| 3.2 | Carregar todos os agendamentos do tenant | 🟡 | **Recomendado** — paginação/janela por data nas telas de histórico (estrutura já permite via índices). |
| 3.3 | Custo de leitura com `onSnapshot` amplo | 🟡 | **Recomendado** — limitar listeners ao período visível (ex.: agenda do dia/semana). Adapter já separa por tenant. |
| 3.4 | Subcoleções por tenant | 🟢 | Boa escolha — isolamento + sharding natural; suporta milhares de tenants. |

## 4. Mobile & responsividade
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 4.1 | Navegação só por sidebar no mobile | 🟠 | **Corrigido** — **bottom navigation** (≤860px) com 4 itens + "Mais"; respeita `safe-area-inset`. |
| 4.2 | Alvos de toque pequenos | 🟡 | **Corrigido** — itens da bottom nav com `min-height:54px`; botões já ≥40px. |
| 4.3 | Conteúdo coberto pela bottom bar | 🟡 | **Corrigido** — `padding-bottom` no `.content` em mobile. |
| 4.4 | Mobile-first | 🟢 | Layout fluido com breakpoints 1080/920/860/560; tabelas com scroll. |

## 5. PWA
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 5.1 | Sem push | 🟠 | **Corrigido** — `push`/`notificationclick` no SW + `enablePush()` (FCM). |
| 5.2 | Sem background sync | 🟡 | **Corrigido** — `sync`/`periodicsync` avisam o cliente; Firestore reenfileira escritas offline. |
| 5.3 | Atualização do SW | 🟡 | **Corrigido** — `Cache-Control: no-cache` no `sw.js`/`index.html`; toast de "nova versão". |
| 5.4 | Splash iOS | 🟢 | Android via `manifest` (`background_color`/ícones). iOS exige PNGs `apple-touch-startup-image` (gerar por dispositivo — pendente, não bloqueia). |

## 6. Segurança HTTP / Hosting
| # | Achado | Sev | Status |
|---|--------|-----|--------|
| 6.1 | Headers de segurança | 🟡 | **Corrigido** — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` no `firebase.json`. |
| 6.2 | Storage aberto | 🟠 | **Corrigido** — `storage.rules`: leitura pública de imagens, escrita só do tenant, validação de tipo/tamanho (≤5MB). |
| 6.3 | API key exposta no cliente | 🟢 | Esperado/seguro — a API key do Firebase **não** é secreta; a segurança real está nas Rules + claims. |

## 7. Qualidade de código / resiliência
- 🟢 App modularizado (`js/01..09`), scripts clássicos em ordem — validado em DOM real.
- 🟢 Integração Firebase **opt-in** (`USE_FIREBASE`): falha de conexão cai para modo local sem quebrar.
- 🟢 Write-through e listeners atrás do mesmo `DB` — render síncrono preservado.
- 🟡 **Pendente p/ produção:** migrar leitura da página pública (visitante anônimo) para `getDocs`
  pontuais (hoje os listeners iniciam só após login); regras já permitem leitura pública de
  `services`/`barbers`/`tenant`.

---

## Itens recomendados antes do "go-live comercial"
1. App Check (reCAPTCHA) nas callables para anti-abuso.
2. Verificação de e-mail e rate-limit no `createPublicBooking` (App Check cobre boa parte).
3. Paginação nas listas grandes (agendamentos/vendas) e listeners por janela de data.
4. Backups automáticos do Firestore + alertas de billing.
5. Imagens de splash iOS e screenshots no manifest (loja/PWA).

**Conclusão:** a fundação multi-tenant, segurança (Rules + claims + booking server-side),
tempo real/offline, mobile e PWA estão prontas e corretas. Os itens "recomendados" são
endurecimentos incrementais, não bloqueadores.
