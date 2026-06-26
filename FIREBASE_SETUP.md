# Groomin — Setup Firebase (projeto `groomin-952d0`)

Guia para sair do modo demo (localStorage) e ativar o backend real:
**Auth + Firestore (tempo real + offline) + Functions + Storage + Hosting**.

---

## 0. Pré-requisitos
```bash
npm install -g firebase-tools
firebase login
cd d:/Barbearia
firebase use groomin-952d0   # já configurado no .firebaserc
```

## 1. Ativar serviços no Console
No [Console](https://console.firebase.google.com/project/groomin-952d0):
- **Authentication** → Sign-in method → ative **E-mail/senha**.
- **Firestore Database** → criar banco (modo produção).
- **Storage** → ativar.
- **Cloud Messaging** → em *Web Push certificates*, gere a **VAPID key**.

## 2. Preencher a config do app web
Console → ⚙️ **Configurações do projeto** → *Seus apps* → **App Web** (crie um se não existir) → **Configuração do SDK**.
Copie os valores para **`js/firebase-config.js`**:
```js
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "groomin-952d0.firebaseapp.com",
  projectId: "groomin-952d0",
  storageBucket: "groomin-952d0.firebasestorage.app", // confira no Console
  messagingSenderId: "...",
  appId: "..."
};
window.FCM_VAPID_KEY = "...";   // VAPID do passo 1
window.USE_FIREBASE = true;     // <- LIGA o backend real
```

## 3. Deploy sem Blaze (Hosting, Firestore e Storage)
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage,hosting
```

## 4. Functions: instalar deps e fazer deploy
```bash
cd functions && npm install && cd ..
firebase deploy --only functions --force
```
> O projeto já tem Functions Gen 2 ativas em Node 22:
> `syncUserClaims`, `bootstrapTenant`, `createPublicBooking` e `provisionUser`.

## 5. Criar o primeiro Super Admin
No modo sem Functions, o papel é lido do documento `/users/{uid}` pelas regras e pelo app.
Depois do deploy das Functions, a Function `syncUserClaims` também espelha esse papel em
custom claims. Para o primeiro super admin:
1. Crie o usuário em **Authentication** (ou pelo app).
2. No **Firestore**, crie `users/{uid}` com:
   ```json
   { "name": "Super Admin", "email": "voce@dominio.com", "role": "super_admin", "tenantId": null, "active": true }
   ```
3. A Function aplica a claim `role=super_admin` automaticamente. Faça **logout/login**
   no app para o token renovar.

Donos de barbearia se cadastram sozinhos pelo app (**Teste Grátis**) — a Function
`bootstrapTenant` cria o tenant, o slug e as claims.

## 6. Testar local com emuladores (opcional, recomendado)
```bash
firebase emulators:start
```
Acesse o app por `http://localhost:5000`.

---

## Arquitetura multi-tenant (resumo)
```
/tenants/{tid}                      perfil público (nome, slug, horários)
/tenants/{tid}/services|barbers|reviews         (LEITURA pública p/ agendar)
/tenants/{tid}/appointments|customers|products|
              combos|campaigns|sales|cashSessions|
              stockMoves|blocks|notifications|settings   (privado do tenant)
/users/{uid}            { tenantId, role, customerId }  -> vira custom claim
/slugs/{slug}           -> { tenantId }  (resolve a página pública)
/subscriptions/{tid}, /invoices, /auditLogs, /platformSettings  (plataforma)
```

**Isolamento:** toda regra exige `request.auth.token.tenantId == {tid}`.
Nenhum tenant lê dados de outro. Escritas públicas (agendar sem conta) **não**
são abertas — passam pela callable `createPublicBooking` (Admin SDK, valida e grava).

## Cache / tempo real (sem Ctrl+F5)
- Firestore com **persistência offline** (IndexedDB) — funciona sem internet.
- **`onSnapshot`** mantém a tela sempre com o dado mais recente (re-render automático).
- `firebase.json` envia `Cache-Control: no-cache` para `sw.js`, `index.html` e
  `manifest` (atualização imediata) e cache longo para assets.

## Notificações push
- Após login, chame `enablePush()` (ex.: botão em Configurações) para registrar o token FCM.
- Envie via Cloud Messaging / Admin SDK. O `sw.js` exibe a notificação e trata o clique.

## Rollback
Se algo falhar, basta `window.USE_FIREBASE = false` em `js/firebase-config.js`
para voltar ao modo local (demo) — o app continua 100% funcional.
