/**
 * Groomin — Cloud Functions (Gen 2, Node 22)
 * Projeto: groomin-952d0
 *
 * Responsabilidades de segurança:
 *  - Sincronizar custom claims (tenantId, role, customerId) a partir de /users/{uid}.
 *    As Security Rules confiam nessas claims para o isolamento multi-tenant.
 *  - Bootstrap de tenant (cadastro do dono) de forma controlada.
 *  - Provisionar usuários de um tenant (somente super admin / dono).
 *  - Agendamento público SEM conta, validado no servidor (evita escrita aberta).
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
// v1 explícito: trigger de exclusão de conta Auth ainda não existe na API v2
const functions = require("firebase-functions/v1");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const Stripe = require("stripe");

// Teto global de instâncias: impede escala descontrolada (bug/bot/pico) de gerar custo alto.
setGlobalOptions({ maxInstances: 5 });

initializeApp();
const db = getFirestore();
const auth = getAuth();
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const EMAIL_FROM = "Groomin <no-reply@mail.groomin.com.br>";

const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const PLAN_META = {
  trial: { name: "Teste grátis", amount: 0, mode: "free", billingPlanId: "free", freeBookingLimit: 3 },
  free: { name: "Teste grátis", amount: 0, mode: "free", billingPlanId: "free", freeBookingLimit: 3 },
  monthly: { name: "Plano Mensal", amount: 1490, mode: "subscription", interval: "month", billingPlanId: "monthly" },
  annual: { name: "Plano Anual", amount: 15198, mode: "subscription", interval: "year", billingPlanId: "annual" },
  founder: { name: "Cliente Fundador", amount: 99000, mode: "payment", billingPlanId: "founder" },
};
// App Check obrigatório em produção; no emulador local não há como emitir token válido.
const callableOptions = { enforceAppCheck: !process.env.FUNCTIONS_EMULATOR };
const normalizePlanId = (id) => Object.prototype.hasOwnProperty.call(PLAN_META, id) ? id : "trial";
const publicUrl = (path = "/") => `https://groomin.com.br${path}`;
const ADMIN_EMAILS = new Set([
  "contato.groominbarber@gmail.com",
  "contato.groomminbarber@gmail.com",
]);
const isSuperAdminClaim = (caller) => {
  const role = String((caller && caller.role) || "").toLowerCase();
  const email = String((caller && caller.email) || "").toLowerCase();
  return ["super_admin", "superadmin", "admin_master"].includes(role) || ADMIN_EMAILS.has(email);
};
const toMillis = (v) => {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T23:59:59`).getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  return null;
};
const courtesyActive = (sub) => {
  if (!sub || sub.isCourtesy !== true) return false;
  const status = sub.billingStatus || sub.status || "active";
  if (status !== "active") return false;
  const exp = toMillis(sub.courtesyExpiresAt);
  return !exp || exp >= Date.now();
};
const courtesyExpired = (sub) => {
  if (!sub || sub.isCourtesy !== true) return false;
  const exp = toMillis(sub.courtesyExpiresAt);
  return !!(exp && exp < Date.now());
};

const timeToMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};
const shopDayHours = (tenant, dow) => {
  const dayHours = tenant && tenant.dayHours;
  const cfg = dayHours && (dayHours[String(dow)] || dayHours[dow]);
  const fallbackActive = Array.isArray(tenant && tenant.workDays)
    ? tenant.workDays.includes(dow)
    : [1, 2, 3, 4, 5, 6].includes(dow);
  return {
    active: cfg && typeof cfg.active !== "undefined" ? !!cfg.active : fallbackActive,
    start: (cfg && cfg.start) || (tenant && tenant.open) || "09:00",
    end: (cfg && cfg.end) || (tenant && tenant.close) || "19:00",
  };
};
const validDateISO = (d) => typeof d === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d);
const validTime = (t) => typeof t === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t);
const sameOrFutureDate = (date) => {
  const today = new Date();
  const local = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(`${date}T00:00:00`) >= local;
};
const fmtDateBR = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const dows = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return `${dows[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Notifica o dono sobre novo agendamento: push (FCM) + e-mail (Resend).
// Best-effort: falha de notificação nunca falha o agendamento.
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function notifyOwnerNewBooking(tenantId, tenant, info) {
  const when = `${fmtDateBR(info.date)} às ${info.time}`;
  const title = "💈 Novo agendamento!";
  const bodyTxt = `${info.customerName} — ${info.serviceName}, ${when}`;
  try {
    const ownerUid = tenant.ownerUid;
    if (ownerUid) {
      const uSnap = await db.doc(`users/${ownerUid}`).get();
      const tokens = uSnap.exists && Array.isArray(uSnap.data().fcmTokens)
        ? uSnap.data().fcmTokens.filter((t) => typeof t === "string" && t) : [];
      if (tokens.length) {
        const res = await getMessaging().sendEachForMulticast({
          tokens,
          webpush: {
            notification: { title, body: bodyTxt, icon: publicUrl("/assets/pwa/logo-mark-192.png") },
            fcmOptions: { link: publicUrl("/app/#/dashboard/agenda") },
          },
        });
        const dead = [];
        res.responses.forEach((r, i) => {
          const code = (r.error && r.error.code) || "";
          if (/registration-token-not-registered|invalid-argument/.test(code)) dead.push(tokens[i]);
        });
        if (dead.length) {
          await db.doc(`users/${ownerUid}`).set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true });
        }
      }
    }
  } catch (e) { console.warn("[notifyOwner] push falhou:", e.message); }
  try {
    if (tenant.email) {
      const { Resend } = require("resend");
      const resend = new Resend(RESEND_API_KEY.value());
      const agendaUrl = publicUrl("/app/#/dashboard/agenda");
      const { error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: tenant.email,
        subject: `💈 Novo agendamento: ${info.customerName} — ${when}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#1a1a1a">
          <div style="margin-bottom:20px"><span style="font-size:20px;font-weight:800;color:#7c3aed">Groomin</span></div>
          <h2 style="margin:0 0 8px;font-size:22px">Novo agendamento em ${escHtml(tenant.name || "sua página")}!</h2>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;color:#333">
            <tr><td style="padding:8px 0;color:#888">Cliente</td><td style="padding:8px 0;text-align:right"><b>${escHtml(info.customerName)}</b></td></tr>
            <tr><td style="padding:8px 0;color:#888">WhatsApp</td><td style="padding:8px 0;text-align:right"><b>${escHtml(info.phone || "-")}</b></td></tr>
            <tr><td style="padding:8px 0;color:#888">${tenant.category === "food" ? "Produto" : "Serviço"}</td><td style="padding:8px 0;text-align:right"><b>${escHtml(info.serviceName)}</b></td></tr>
            <tr><td style="padding:8px 0;color:#888">${tenant.category === "food" ? "Entrega" : "Horário"}</td><td style="padding:8px 0;text-align:right"><b>${when}</b></td></tr>
            ${info.barberName ? `<tr><td style="padding:8px 0;color:#888">Profissional</td><td style="padding:8px 0;text-align:right"><b>${escHtml(info.barberName)}</b></td></tr>` : ""}
          </table>
          <a href="${agendaUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">Abrir minha agenda</a>
        </div>`,
      });
      if (error) console.warn("[notifyOwner] e-mail falhou:", JSON.stringify(error));
    }
  } catch (e) { console.warn("[notifyOwner] e-mail falhou:", e.message); }
}
const resendErrorToHttps = (error, context) => {
  console.warn(`[Groomin] Resend ${context} error:`, JSON.stringify(error));
  const msg = String((error && error.message) || "");
  if (error && error.statusCode === 403 && /domain is not verified|verify a domain|testing emails|from address/i.test(msg)) {
    return new HttpsError("failed-precondition", "Configure e verifique o domínio groomin.com.br na Resend para enviar códigos.");
  }
  return new HttpsError("internal", "Não foi possível enviar o e-mail. Tente novamente.");
};

// ------------------------------------------------------------
// Stripe Checkout — cria sessão segura sem expor chave secreta.
// O teste grátis não usa Stripe. Checkout só para planos pagos.
// ------------------------------------------------------------
exports.createStripeCheckout = onCall({ ...callableOptions, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para iniciar o checkout.");
  const data = request.data || {};
  const planId = normalizePlanId(data.planId);
  const plan = PLAN_META[planId];
  if (plan.mode === "free") {
    throw new HttpsError("failed-precondition", "O teste grátis não precisa de checkout.");
  }
  const email = String(data.email || "").trim().toLowerCase();
  const ownerName = String(data.ownerName || "").trim();
  const shopName = String(data.shopName || "").trim();
  const tenantId = String(data.tenantId || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "E-mail inválido para o checkout.");
  }
  const callerSnap = await db.doc(`users/${uid}`).get();
  const callerData = callerSnap.exists ? callerSnap.data() : {};
  if (!isSuperAdminClaim(callerData) && callerData.tenantId !== tenantId) {
    throw new HttpsError("permission-denied", "Você não pode iniciar checkout para este negócio.");
  }

  const stripeSecret = STRIPE_SECRET_KEY.value();
  if (!stripeSecret) {
    throw new HttpsError("failed-precondition", "Stripe ainda não está configurado.");
  }
  const stripe = Stripe(stripeSecret);
  const successUrl = String(data.successUrl || publicUrl("/app/#/?stripe=success")).slice(0, 500);
  const cancelUrl = String(data.cancelUrl || publicUrl("/app/#/?stripe=cancel")).slice(0, 500);
  const metadata = {
    app: "groomin",
    planId,
    billingPlanId: plan.billingPlanId,
    email,
    tenantId: tenantId.slice(0, 120),
    ownerName: ownerName.slice(0, 120),
    shopName: shopName.slice(0, 120),
  };
  const successUrlWithSession = successUrl.includes("{CHECKOUT_SESSION_ID}")
    ? successUrl
    : `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;

  const params = {
    mode: plan.mode,
    customer_email: email,
    success_url: successUrlWithSession,
    cancel_url: cancelUrl,
    client_reference_id: email,
    metadata,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "brl",
        unit_amount: plan.amount,
        product_data: { name: plan.name },
        ...(plan.mode === "subscription" ? { recurring: { interval: plan.interval } } : {}),
      },
    }],
  };

  if (plan.mode === "subscription") {
    params.payment_method_collection = "always";
    params.subscription_data = {
      metadata,
      ...(plan.trialDays ? { trial_period_days: plan.trialDays } : {}),
    };
  } else {
    params.payment_intent_data = { metadata };
  }

  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url, sessionId: session.id, planId, billingPlanId: plan.billingPlanId };
});

exports.confirmStripeCheckout = onCall({ ...callableOptions, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para confirmar o pagamento.");
  const sessionId = String((request.data && request.data.sessionId) || "").trim();
  if (!/^cs_(test|live)_/.test(sessionId)) {
    throw new HttpsError("invalid-argument", "Sessão do Stripe inválida.");
  }
  const stripeSecret = STRIPE_SECRET_KEY.value();
  if (!stripeSecret) throw new HttpsError("failed-precondition", "Stripe ainda não está configurado.");

  const stripe = Stripe(stripeSecret);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) {
    throw new HttpsError("failed-precondition", "Pagamento ainda não confirmado pelo Stripe.");
  }

  const meta = session.metadata || {};
  const planId = normalizePlanId(meta.planId);
  const plan = PLAN_META[planId];
  if (!plan || plan.mode === "free") {
    throw new HttpsError("failed-precondition", "Plano pago inválido.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.exists ? userSnap.data() : {};
  const tenantId = String(meta.tenantId || user.tenantId || "").trim();
  if (!tenantId) throw new HttpsError("failed-precondition", "Negócio não encontrado para ativar o plano.");
  if (user.role !== "superadmin" && user.tenantId !== tenantId) {
    throw new HttpsError("permission-denied", "Você não pode ativar plano para este negócio.");
  }

  const now = new Date();
  const days = planId === "annual" ? 365 : planId === "founder" ? 36500 : 30;
  const mrr = planId === "annual" ? 12.66 : planId === "founder" ? 0 : (plan.amount || 0) / 100;
  const tenantPatch = {
    planId: plan.billingPlanId,
    freeBookingLimit: null,
    planActivatedAt: now,
    updatedAt: now,
  };
  const subPatch = {
    tenantId,
    planId: plan.billingPlanId,
    status: "active",
    mrr,
    freeBookingLimit: null,
    paymentMethodRequired: true,
    paymentMethodStatus: "paid",
    stripeCustomerId: session.customer || "",
    stripeSubscriptionId: session.subscription || "",
    stripeCheckoutSessionId: session.id,
    startedAt: now,
    renewsAt: new Date(Date.now() + days * 86400000),
    updatedAt: now,
  };

  await db.runTransaction(async (tx) => {
    const tenantRef = db.doc(`tenants/${tenantId}`);
    const tenantSnap = await tx.get(tenantRef);
    if (!tenantSnap.exists) throw new HttpsError("not-found", "Negócio não encontrado.");
    tx.set(tenantRef, tenantPatch, { merge: true });
    tx.set(db.doc(`subscriptions/${tenantId}`), subPatch, { merge: true });
  });

  return { ok: true, tenantId, planId: plan.billingPlanId, planName: plan.name };
});

// ------------------------------------------------------------
// 0) Limpa doc /users/{uid} quando conta Auth é deletada (ex: via console).
// ------------------------------------------------------------
exports.onAuthUserDeleted = functions.auth.user().onDelete(async (user) => {
  try { await db.doc(`users/${user.uid}`).delete(); } catch (e) {
    console.warn("[onAuthUserDeleted] falhou ao deletar doc:", e.message);
  }
});

// 1) Sincroniza custom claims sempre que /users/{uid} muda.
//    Fonte da verdade de role/tenantId é o documento do usuário.
// ------------------------------------------------------------
exports.syncUserClaims = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) {
    try { await auth.setCustomUserClaims(uid, {}); } catch (_) {}
    return;
  }
  // Ignora se só claimsUpdatedAt mudou (escrita da própria função) — evita loop infinito
  const WATCH = ["role", "tenantId", "customerId", "active"];
  const changed = WATCH.some((k) => (before[k] ?? null) !== (after[k] ?? null));
  if (!changed) return;

  const existing = await auth.getUser(uid).then((u) => u.customClaims || {}).catch(() => ({}));
  const claims = { ...existing, role: after.role || "customer", tenantId: after.tenantId || null };
  if (after.customerId) claims.customerId = after.customerId; else delete claims.customerId;
  await auth.setCustomUserClaims(uid, claims);
  await db.doc(`users/${uid}`).set({ claimsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
});

// ------------------------------------------------------------
// 2) Bootstrap de tenant: dono recém-cadastrado cria a barbearia.
//    Exige usuário autenticado SEM tenant ainda.
// ------------------------------------------------------------
exports.bootstrapTenant = onCall(callableOptions, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");

  const existing = await db.doc(`users/${uid}`).get();
  if (existing.exists && existing.data().tenantId) {
    throw new HttpsError("failed-precondition", "Usuário já pertence a uma barbearia.");
  }

  const name = (request.data.shopName || "").trim();
  const ownerName = (request.data.ownerName || "").trim();
  const planId = normalizePlanId(request.data.planId);
  const plan = PLAN_META[planId];
  if (name.length < 2) throw new HttpsError("invalid-argument", "Nome da barbearia inválido.");

  // slug único
  let base = slugify(name) || "barbearia";
  let slug = base, n = 1;
  // reserva atômica de slug
  const tenantRef = db.collection("tenants").doc();
  const tid = tenantRef.id;
  while (true) {
    const slugRef = db.doc(`slugs/${slug}`);
    const ok = await db.runTransaction(async (tx) => {
      const s = await tx.get(slugRef);
      if (s.exists) return false;
      tx.set(slugRef, { tenantId: tid, createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (ok) break;
    slug = `${base}-${++n}`;
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(tenantRef, {
    name, slug, ownerName, ownerUid: uid,
    description: "",
    phone: request.data.phone || "", whatsapp: request.data.phone || "",
    email: request.auth.token.email || "",
    open: "09:00", close: "19:00", lunchStart: "12:00", lunchEnd: "13:00",
    slotInterval: 30, status: "active", planId: plan.billingPlanId || planId,
    freeBookingLimit: (plan.billingPlanId || planId) === "free" ? 3 : null,
    rating: 0,
    createdAt: now,
  });
  batch.set(db.doc(`users/${uid}`), {
    name: ownerName || request.auth.token.name || "Dono",
    email: request.auth.token.email || "",
    role: "owner", tenantId: tid, active: true, createdAt: now,
  }, { merge: true });
  batch.set(db.doc(`subscriptions/${tid}`), {
    tenantId: tid, planId: plan.billingPlanId || planId, status: (plan.billingPlanId || planId) === "free" ? "trialing" : "active", mrr: (plan.amount || 0) / 100,
    startedAt: now,
    freeBookingLimit: (plan.billingPlanId || planId) === "free" ? 3 : null,
    paymentMethodRequired: (plan.billingPlanId || planId) !== "free",
    paymentMethodStatus: (plan.billingPlanId || planId) === "free" ? "not_required" : "checkout_started",
    renewsAt: (plan.billingPlanId || planId) === "free" ? null : new Date(Date.now() + ((plan.billingPlanId || planId) === "founder" ? 36500 : (plan.billingPlanId || planId) === "annual" ? 365 : 30) * 86400000),
  });
  // serviço + barbeiro iniciais
  batch.set(tenantRef.collection("services").doc(), {
    tenantId: tid, name: "Corte Masculino", desc: "Corte personalizado.",
    price: 45, duration: 30, category: "Cabelo", icon: "scissors", active: true,
  });
  batch.set(tenantRef.collection("barbers").doc(), {
    tenantId: tid, name: ownerName || "Barbeiro", role: "Proprietário & Barbeiro",
    specialties: ["Corte"], commission: 0, productCommission: 0, isOwner: true,
    start: "09:00", end: "19:00", lunchStart: "12:00", lunchEnd: "13:00",
    days: [1, 2, 3, 4, 5, 6], vacations: [], active: true, rating: 5,
  });
  await batch.commit();

  return { tenantId: tid, slug };
});

// ------------------------------------------------------------
// 3) Provisionar usuário (super admin para qualquer tenant; dono/gerente
//    para o próprio tenant). Cria a conta de auth + doc /users.
// ------------------------------------------------------------
exports.provisionUser = onCall(callableOptions, async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const { email, password, name, role, tenantId } = request.data || {};
  const isSuper = isSuperAdminClaim(caller);
  // Managers não podem criar owners — apenas super admin pode promover a owner
  const allowedRoles = isSuper ? ["owner", "manager", "receptionist", "barber"] : ["manager", "receptionist", "barber"];
  if (!email || !password || !allowedRoles.includes(role)) {
    throw new HttpsError("invalid-argument", "Dados inválidos.");
  }
  const isManager = ["owner", "manager"].includes(caller.role) && caller.tenantId === tenantId;
  if (!isSuper && !isManager) {
    throw new HttpsError("permission-denied", "Sem permissão para criar usuários neste tenant.");
  }
  const userRecord = await auth.createUser({ email, password, displayName: name });
  await db.doc(`users/${userRecord.uid}`).set({
    name: name || email, email, role, tenantId, active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { uid: userRecord.uid };
});

// ------------------------------------------------------------
// 4) Agendamento público (sem conta) — validado e gravado no servidor.
//    Evita escrita aberta no Firestore (anti-spam / integridade).
// ------------------------------------------------------------
exports.createPublicBooking = onCall({ ...callableOptions, secrets: [RESEND_API_KEY] }, async (request) => {
  const { tenantId, serviceId, barberId, date, time, name, phone, email, birthday, customerId: requestedCustomerId } = request.data || {};
  if (!tenantId || !serviceId || !barberId || !date || !time || !name || !phone) {
    throw new HttpsError("invalid-argument", "Dados de agendamento incompletos.");
  }
  if (!validDateISO(date) || !validTime(time) || !sameOrFutureDate(date)) {
    throw new HttpsError("invalid-argument", "Data ou horário inválido.");
  }
  if (String(name).trim().length < 2 || String(phone).replace(/\D/g, "").length < 8) {
    throw new HttpsError("invalid-argument", "Dados do cliente inválidos.");
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const tenant = tenantSnap.exists ? tenantSnap.data() : null;
  if (!tenant || tenant.status !== "active") {
    throw new HttpsError("failed-precondition", "Barbearia indisponível.");
  }
  const subRef = db.doc(`subscriptions/${tenantId}`);
  const subSnap = await subRef.get();
  const sub = subSnap.exists ? subSnap.data() : {};
  const expiredCourtesy = courtesyExpired(sub);
  let hasCourtesy = courtesyActive(sub);
  if (expiredCourtesy) {
    await subRef.set({
      planType: "free",
      planName: "Teste gratuito",
      planId: "free",
      billingStatus: "trialing",
      status: "trialing",
      isCourtesy: false,
      courtesyExpiredAt: FieldValue.serverTimestamp(),
      freeBookingLimit: 3,
      mrr: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.doc(`tenants/${tenantId}`).set({ planId: "free", freeBookingLimit: 3, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    hasCourtesy = false;
  }
  const subStatus = sub.billingStatus || sub.status || "active";
  if (!hasCourtesy && (subStatus === "past_due" || subStatus === "canceled")) {
    throw new HttpsError("failed-precondition", "Link indisponível no momento.");
  }
  if (tenant.schedulePaused) {
    throw new HttpsError("failed-precondition", "Agenda pausada.");
  }
  const leadDays = Math.max(0, Math.min(30, Number(tenant.orderLeadDays || 0)));
  if (leadDays > 0) {
    const now = new Date();
    const minDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + leadDays);
    if (new Date(`${date}T00:00:00`) < minDay) {
      throw new HttpsError("failed-precondition", `Pedidos precisam de pelo menos ${leadDays} dia(s) de antecedência.`);
    }
  }
  const svcSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
  const barberSnap = await db.doc(`tenants/${tenantId}/barbers/${barberId}`).get();
  if (!svcSnap.exists || !barberSnap.exists) {
    throw new HttpsError("not-found", "Serviço ou profissional inexistente.");
  }
  const svc = svcSnap.data();
  const barber = barberSnap.data();
  if (svc.active !== true || barber.active !== true) {
    throw new HttpsError("failed-precondition", "Serviço ou profissional indisponível.");
  }
  const start = timeToMin(time);
  const end = start + (svc.duration || 30);
  const dow = new Date(`${date}T00:00:00`).getDay();
  const dayHours = shopDayHours(tenant, dow);
  if (!dayHours.active) {
    throw new HttpsError("failed-precondition", "Horário fora do expediente.");
  }
  if (!tenant.dayHours && Array.isArray(barber.days) && !barber.days.includes(dow)) {
    throw new HttpsError("failed-precondition", "Profissional indisponível nesta data.");
  }
  if (Array.isArray(barber.vacations) && barber.vacations.some((v) => date >= v.start && date <= v.end)) {
    throw new HttpsError("failed-precondition", "Profissional indisponível nesta data.");
  }
  const open = Math.max(timeToMin(barber.start || dayHours.start), timeToMin(dayHours.start));
  const close = Math.min(timeToMin(barber.end || dayHours.end), timeToMin(dayHours.end));
  const lunchStart = timeToMin(barber.lunchStart || tenant.lunchStart || "12:00");
  const lunchEnd = timeToMin(barber.lunchEnd || tenant.lunchEnd || "13:00");
  if (start < open || end > close || (start < lunchEnd && end > lunchStart)) {
    throw new HttpsError("failed-precondition", "Horário fora do expediente.");
  }

  // checa conflito (transação) e grava
  let freeUsedAfter = null;
  let freeLimit = null;
  const apptId = await db.runTransaction(async (tx) => {
    const effectivePlanId = expiredCourtesy ? "free" : (tenant.planId || "");
    if (!hasCourtesy && effectivePlanId === "free") {
      const limit = Number(tenant.freeBookingLimit || 3);
      const allAppts = await tx.get(db.collection(`tenants/${tenantId}/appointments`));
      const used = allAppts.docs.filter((d) => (d.data().status || "") !== "cancelado").length;
      if (used >= limit) {
        throw new HttpsError("failed-precondition", "Teste gratuito concluído. Assine um plano para continuar recebendo agendamentos.");
      }
      freeLimit = limit;
      freeUsedAfter = used + 1;
    }
    const dayAppts = await tx.get(
      db.collection(`tenants/${tenantId}/appointments`)
        .where("barberId", "==", barberId)
        .where("date", "==", date)
    );
    const dayBlocks = await tx.get(
      db.collection(`tenants/${tenantId}/blocks`)
        .where("date", "==", date)
    );
    for (const d of dayBlocks.docs) {
      const b = d.data();
      if (b.barberId !== barberId && b.barberId !== "all") continue;
      if (b.fullDay) throw new HttpsError("failed-precondition", "Agenda pausada.");
      const bStart = timeToMin(b.start);
      const bEnd = timeToMin(b.end);
      if (start < bEnd && end > bStart) {
        throw new HttpsError("already-exists", "Horário bloqueado.");
      }
    }
    for (const d of dayAppts.docs) {
      const a = d.data();
      if (a.status === "cancelado") continue;
      const aStart = timeToMin(a.time);
      const aEnd = aStart + (a.duration || 30);
      if (start < aEnd && end > aStart) {
        throw new HttpsError("already-exists", "Horário acabou de ser reservado.");
      }
    }
    // cliente: encontra por telefone ou cria
    let customerId = requestedCustomerId || null;
    if (customerId) {
      const cRef = db.doc(`tenants/${tenantId}/customers/${customerId}`);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists) customerId = null;
    }
    if (!customerId) {
      const custQ = await tx.get(
        db.collection(`tenants/${tenantId}/customers`).where("phone", "==", phone).limit(1)
      );
      if (!custQ.empty) customerId = custQ.docs[0].id;
    }
    if (!customerId) {
      const cRef = db.collection(`tenants/${tenantId}/customers`).doc();
      tx.set(cRef, { tenantId, barbershopId: tenantId, name, phone, whatsapp: phone, email: email || "", birthday: birthday || "", notes: "", createdAt: FieldValue.serverTimestamp() });
      customerId = cRef.id;
    } else if (birthday) {
      tx.set(db.doc(`tenants/${tenantId}/customers/${customerId}`), { birthday }, { merge: true });
    }
    const aRef = db.collection(`tenants/${tenantId}/appointments`).doc();
    tx.set(aRef, {
      tenantId, barbershopId: tenantId, customerId, customerName: name, phone,
      serviceId, barberId, date, time, duration: svc.duration || 30,
      status: "confirmado", price: svc.price || 0, source: "public",
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(`tenants/${tenantId}/notifications`).doc(), {
      tenantId, barbershopId: tenantId, barberId, type: "confirm", title: "Novo agendamento",
      msg: `${name} — ${svc.name} ${date} ${time}`, read: false,
      time: Date.now(),
    });
    return { appointmentId: aRef.id, customerId };
  });

  // Notifica o dono (push + e-mail) — precisa de await: trabalho em background
  // morre quando a function responde.
  await notifyOwnerNewBooking(tenantId, tenant, {
    customerName: name, phone, date, time,
    serviceName: svc.name || "Serviço", barberName: barber.name || "",
  });

  // E-mail de conversão do trial para o dono: aviso no penúltimo e no último agendamento grátis.
  // Nunca falha o agendamento — erro de e-mail é apenas logado.
  if (freeUsedAfter !== null && freeLimit && tenant.email) {
    try {
      const isLast = freeUsedAfter >= freeLimit;
      const isPenultimate = freeUsedAfter === freeLimit - 1;
      if (isLast || isPenultimate) {
        const { Resend } = require("resend");
        const resend = new Resend(RESEND_API_KEY.value());
        const plansUrl = publicUrl("/app/#/dashboard/assinatura");
        const subject = isLast
          ? `🎉 ${name} agendou — seu teste grátis foi concluído`
          : `Falta 1 agendamento no seu teste grátis do Groomin`;
        const headline = isLast ? "Seu teste grátis foi concluído!" : "Falta só 1 agendamento";
        const message = isLast
          ? `<b>${name}</b> acabou de agendar — foi o ${freeUsedAfter}º agendamento do seu teste grátis em <b>${tenant.name || "sua página"}</b>. Sua página funcionou: clientes reais estão agendando. A partir de agora, novos agendamentos ficam bloqueados até você assinar um plano.`
          : `<b>${name}</b> acabou de agendar em <b>${tenant.name || "sua página"}</b> — você já usou ${freeUsedAfter} de ${freeLimit} agendamentos do teste grátis. Assine agora para não perder o próximo cliente.`;
        const { error } = await resend.emails.send({
          from: EMAIL_FROM,
          to: tenant.email,
          subject,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#1a1a1a">
            <div style="margin-bottom:20px"><span style="font-size:20px;font-weight:800;color:#7c3aed">Groomin</span></div>
            <h2 style="margin:0 0 8px;font-size:22px">${headline}</h2>
            <p style="color:#555;margin:0 0 28px;line-height:1.6">${message}</p>
            <a href="${plansUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">Ver planos a partir de R$ 14,90/mês</a>
            <p style="color:#888;font-size:13px;margin:28px 0 0">Planos mensal, anual e Cliente Fundador. Cancele quando quiser.</p>
          </div>`,
        });
        if (error) console.warn("[createPublicBooking] e-mail de trial falhou:", JSON.stringify(error));
      }
    } catch (e) {
      console.warn("[createPublicBooking] e-mail de trial falhou:", e.message);
    }
  }

  return apptId;
});

// ------------------------------------------------------------
// 5) Stripe Webhook — mantém subscriptions sincronizadas com Stripe.
//    Configure a URL no Dashboard Stripe:
//    https://dashboard.stripe.com/webhooks → endpoint → URL da função.
//    Eventos necessários: invoice.payment_succeeded, invoice.payment_failed,
//    customer.subscription.updated, customer.subscription.deleted.
// ------------------------------------------------------------
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

    const sig = req.headers["stripe-signature"];
    const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
    if (!webhookSecret) { res.status(500).send("Webhook secret not configured"); return; }

    let event;
    try {
      const stripe = Stripe(STRIPE_SECRET_KEY.value());
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("[stripeWebhook] Signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    const obj = event.data.object;

    // Busca tenantId pelo stripeSubscriptionId ou stripeCustomerId
    async function findTenantId(stripeSubId, stripeCustomerId) {
      if (stripeSubId) {
        const snap = await db.collection("subscriptions")
          .where("stripeSubscriptionId", "==", stripeSubId).limit(1).get();
        if (!snap.empty) return snap.docs[0].id;
      }
      if (stripeCustomerId) {
        const snap = await db.collection("subscriptions")
          .where("stripeCustomerId", "==", stripeCustomerId).limit(1).get();
        if (!snap.empty) return snap.docs[0].id;
      }
      return null;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          // Ativação do plano na primeira compra — garante ativação mesmo se o cliente fechar o browser
          if (obj.status !== "complete") break;
          const meta = obj.metadata || {};
          const planId = normalizePlanId(meta.planId);
          const plan = PLAN_META[planId];
          if (!plan || plan.mode === "free") break;
          const tenantId = String(meta.tenantId || "").trim();
          if (!tenantId) { console.warn("[stripeWebhook] checkout.session.completed sem tenantId no metadata"); break; }
          const days = planId === "annual" ? 365 : planId === "founder" ? 36500 : 30;
          const mrr = planId === "annual" ? 12.66 : planId === "founder" ? 0 : (plan.amount || 0) / 100;
          const now = new Date();
          await db.runTransaction(async (tx) => {
            const tenantRef = db.doc(`tenants/${tenantId}`);
            const tenantSnap = await tx.get(tenantRef);
            if (!tenantSnap.exists) return;
            tx.set(tenantRef, {
              planId: plan.billingPlanId,
              freeBookingLimit: null,
              planActivatedAt: now,
              updatedAt: now,
            }, { merge: true });
            tx.set(db.doc(`subscriptions/${tenantId}`), {
              tenantId,
              planId: plan.billingPlanId,
              status: "active",
              mrr,
              freeBookingLimit: null,
              paymentMethodRequired: true,
              paymentMethodStatus: "paid",
              stripeCustomerId: obj.customer || "",
              stripeSubscriptionId: obj.subscription || "",
              stripeCheckoutSessionId: obj.id,
              startedAt: now,
              renewsAt: new Date(Date.now() + days * 86400000),
              updatedAt: now,
            }, { merge: true });
          });
          break;
        }

        case "invoice.payment_succeeded": {
          // Renovação bem-sucedida: atualiza renewsAt e garante status active
          const subId = obj.subscription;
          const customerId = obj.customer;
          const tid = await findTenantId(subId, customerId);
          if (!tid) { console.warn("[stripeWebhook] tenant não encontrado para invoice.payment_succeeded"); break; }
          const periodEnd = obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period
            ? new Date(obj.lines.data[0].period.end * 1000)
            : new Date(Date.now() + 30 * 86400000);
          await db.doc(`subscriptions/${tid}`).set({
            status: "active",
            renewsAt: periodEnd,
            paymentMethodStatus: "paid",
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          break;
        }

        case "invoice.payment_failed": {
          const subId = obj.subscription;
          const customerId = obj.customer;
          const tid = await findTenantId(subId, customerId);
          if (!tid) { console.warn("[stripeWebhook] tenant não encontrado para invoice.payment_failed"); break; }
          await db.doc(`subscriptions/${tid}`).set({
            status: "past_due",
            paymentMethodStatus: "failed",
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          break;
        }

        case "customer.subscription.updated": {
          // Mudança de plano, cancelamento agendado, trial terminando etc.
          const tid = await findTenantId(obj.id, obj.customer);
          if (!tid) { console.warn("[stripeWebhook] tenant não encontrado para subscription.updated"); break; }
          const statusMap = {
            active: "active", trialing: "trialing",
            past_due: "past_due", canceled: "canceled", unpaid: "past_due",
          };
          const newStatus = statusMap[obj.status] || obj.status;
          const renewsAt = obj.current_period_end ? new Date(obj.current_period_end * 1000) : null;
          const patch = { status: newStatus, updatedAt: FieldValue.serverTimestamp() };
          if (renewsAt) patch.renewsAt = renewsAt;
          await db.doc(`subscriptions/${tid}`).set(patch, { merge: true });
          break;
        }

        case "customer.subscription.deleted": {
          const tid = await findTenantId(obj.id, obj.customer);
          if (!tid) { console.warn("[stripeWebhook] tenant não encontrado para subscription.deleted"); break; }
          await db.doc(`subscriptions/${tid}`).set({
            status: "canceled",
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          // Rebaixa o tenant para free
          await db.collection("tenants").doc(tid).set({
            planId: "free", freeBookingLimit: 3, updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error("[stripeWebhook] Erro ao processar evento:", event.type, err);
      res.status(500).send("Internal error");
      return;
    }

    res.json({ received: true });
  }
);

// ------------------------------------------------------------
// 7) Cancelamento de assinatura — cancela no Stripe e atualiza Firestore.
// ------------------------------------------------------------
exports.cancelSubscription = onCall({ ...callableOptions, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const { tenantId } = request.data || {};
  if (!tenantId) throw new HttpsError("invalid-argument", "tenantId obrigatório.");
  const isCaller = caller.tenantId === tenantId && ["owner", "manager"].includes(caller.role);
  const isSuper = isSuperAdminClaim(caller);
  if (!isCaller && !isSuper) throw new HttpsError("permission-denied", "Sem permissão.");

  const subRef = db.doc(`subscriptions/${tenantId}`);
  const subSnap = await subRef.get();
  if (!subSnap.exists) throw new HttpsError("not-found", "Assinatura não encontrada.");
  const sub = subSnap.data();

  if (sub.stripeSubscriptionId) {
    const stripe = Stripe(STRIPE_SECRET_KEY.value());
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch (e) {
      console.warn("[Groomin] cancelSubscription Stripe:", e.message);
      throw new HttpsError("internal", "Erro ao cancelar no Stripe. Tente novamente ou fale com o suporte.");
    }
  }

  await subRef.set({ status: "canceled", canceledAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("tenants").doc(tenantId).set({
    planId: "free", freeBookingLimit: 3, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { success: true };
});

// ------------------------------------------------------------
// 8) Mudança de plano (downgrade) — agenda cancelamento no fim do período.
// ------------------------------------------------------------
exports.changePlan = onCall({ ...callableOptions, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const { tenantId, newPlanId } = request.data || {};
  if (!tenantId || !newPlanId) throw new HttpsError("invalid-argument", "tenantId e newPlanId obrigatórios.");

  const isCaller = caller.tenantId === tenantId && ["owner", "manager"].includes(caller.role);
  const isSuper = isSuperAdminClaim(caller);
  if (!isCaller && !isSuper) throw new HttpsError("permission-denied", "Sem permissão.");

  const newPlan = PLAN_META[normalizePlanId(newPlanId)];
  if (!newPlan) throw new HttpsError("invalid-argument", "Plano de destino inválido.");

  const subRef = db.doc(`subscriptions/${tenantId}`);
  const subSnap = await subRef.get();
  if (!subSnap.exists) throw new HttpsError("not-found", "Assinatura não encontrada.");
  const sub = subSnap.data();
  if (!sub.stripeSubscriptionId) throw new HttpsError("failed-precondition", "Sem assinatura Stripe ativa para alterar.");

  const stripe = Stripe(STRIPE_SECRET_KEY.value());
  let periodEnd;
  try {
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    periodEnd = new Date(updated.current_period_end * 1000).toISOString();
  } catch (e) {
    console.warn("[Groomin] changePlan Stripe:", e.message);
    throw new HttpsError("internal", "Erro ao agendar mudança no Stripe. Tente novamente.");
  }

  await subRef.set({ cancelAtPeriodEnd: true, pendingPlanId: newPlanId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return { success: true, currentPeriodEnd: periodEnd };
});

// ------------------------------------------------------------
// 9) Plano Cortesia — somente super admin. Libera acesso sem cobrança.
// ------------------------------------------------------------
exports.toggleCourtesyPlan = onCall({ ...callableOptions, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  const caller = request.auth && request.auth.token;
  const adminUid = request.auth && request.auth.uid;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  if (!isSuperAdminClaim(caller)) throw new HttpsError("permission-denied", "Apenas admin pode alterar cortesia.");

  const { tenantId, activate } = request.data || {};
  const note = String((request.data && request.data.note) || "").trim().slice(0, 1000);
  const expiresAt = String((request.data && request.data.expiresAt) || "").trim();
  if (!tenantId || typeof activate !== "boolean") {
    throw new HttpsError("invalid-argument", "tenantId e activate são obrigatórios.");
  }
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    throw new HttpsError("invalid-argument", "Data de expiração inválida.");
  }

  const tenantRef = db.doc(`tenants/${tenantId}`);
  const subRef = db.doc(`subscriptions/${tenantId}`);
  const [tenantSnap, subSnap] = await Promise.all([tenantRef.get(), subRef.get()]);
  if (!tenantSnap.exists) throw new HttpsError("not-found", "Estabelecimento não encontrado.");
  const tenant = tenantSnap.data() || {};
  const previousSubscription = subSnap.exists ? subSnap.data() : {};

  let canceledStripeSubscriptionId = "";
  if (activate && previousSubscription.stripeSubscriptionId) {
    const stripeSecret = STRIPE_SECRET_KEY.value();
    if (!stripeSecret) throw new HttpsError("failed-precondition", "Stripe não configurado para cancelar cobrança recorrente.");
    const stripe = Stripe(stripeSecret);
    try {
      await stripe.subscriptions.cancel(previousSubscription.stripeSubscriptionId);
      canceledStripeSubscriptionId = previousSubscription.stripeSubscriptionId;
    } catch (e) {
      console.warn("[Groomin] toggleCourtesyPlan Stripe:", e.message);
      throw new HttpsError("internal", "Não foi possível cancelar a cobrança Stripe antes de ativar cortesia.");
    }
  }

  const now = Date.now();
  const ownerUid = tenant.ownerUid || "";
  const patch = activate ? {
    tenantId,
    planType: "courtesy",
    planName: "Plano Cortesia",
    billingStatus: "active",
    status: "active",
    isCourtesy: true,
    courtesyActivatedAt: now,
    courtesyActivatedBy: adminUid,
    courtesyExpiresAt: expiresAt || null,
    courtesyNote: note || "",
    mrr: 0,
    freeBookingLimit: null,
    paymentMethodRequired: false,
    paymentMethodStatus: "courtesy",
    canceledStripeSubscriptionId: canceledStripeSubscriptionId || previousSubscription.canceledStripeSubscriptionId || "",
    stripeSubscriptionId: activate && canceledStripeSubscriptionId ? "" : (previousSubscription.stripeSubscriptionId || ""),
    updatedAt: FieldValue.serverTimestamp(),
  } : {
    tenantId,
    planType: "free",
    planName: "Teste gratuito",
    planId: "free",
    billingStatus: "trialing",
    status: "trialing",
    isCourtesy: false,
    courtesyRemovedAt: now,
    courtesyRemovedBy: adminUid,
    courtesyExpiresAt: null,
    courtesyNote: note || "",
    mrr: 0,
    freeBookingLimit: 3,
    paymentMethodRequired: false,
    paymentMethodStatus: "not_required",
    updatedAt: FieldValue.serverTimestamp(),
  };

  const nextSubscription = { ...previousSubscription, ...patch };
  const actionRef = db.collection("adminActions").doc();
  await db.runTransaction(async (tx) => {
    tx.set(subRef, patch, { merge: true });
    tx.set(tenantRef, activate
      ? { freeBookingLimit: null, updatedAt: FieldValue.serverTimestamp() }
      : { planId: "free", freeBookingLimit: 3, updatedAt: FieldValue.serverTimestamp() },
    { merge: true });
    tx.set(actionRef, {
      actionType: activate ? "activate_courtesy_plan" : "remove_courtesy_plan",
      targetUserId: ownerUid,
      targetBusinessId: tenantId,
      adminUserId: adminUid,
      previousSubscription,
      newSubscription: nextSubscription,
      note,
      createdAt: now,
    });
    tx.set(db.collection("auditLogs").doc(), {
      tenantId,
      barbershopId: tenantId,
      actorName: caller.name || caller.email || "Super Admin",
      role: caller.role,
      action: activate ? "Plano Cortesia ativado" : "Plano Cortesia removido",
      target: tenant.name || tenantId,
      time: now,
    });
  });

  return { success: true, subscription: nextSubscription };
});

// ------------------------------------------------------------
// 10) Dados cadastrais do proprietário.
// ------------------------------------------------------------
function ownerProfilePatch(data) {
  const patch = {};
  const str = (k, max = 180) => String((data && data[k]) || "").trim().slice(0, max);
  const name = str("name", 120);
  const email = str("email", 180).toLowerCase();
  const phone = str("phone", 40);
  const whatsapp = str("whatsapp", 40);
  const address = str("address", 240);
  if (name) patch.name = name;
  if (email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError("invalid-argument", "E-mail inválido.");
    patch.email = email;
  }
  if (phone) patch.phone = phone;
  if (whatsapp) patch.whatsapp = whatsapp;
  if (address) patch.address = address;
  return patch;
}

async function applyAuthProfilePatch(uid, patch, password) {
  const authPatch = {};
  if (patch.name) authPatch.displayName = patch.name;
  if (patch.email) authPatch.email = patch.email;
  if (password) {
    const pass = String(password);
    if (pass.length < 6) throw new HttpsError("invalid-argument", "A senha precisa ter pelo menos 6 caracteres.");
    authPatch.password = pass;
  }
  if (Object.keys(authPatch).length) await auth.updateUser(uid, authPatch);
}

exports.adminUpdateOwnerProfile = onCall(callableOptions, async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  if (!isSuperAdminClaim(caller)) throw new HttpsError("permission-denied", "Apenas admin pode alterar proprietário.");
  const data = request.data || {};
  const userId = String(data.userId || "").trim();
  const tenantId = String(data.tenantId || "").trim();
  if (!userId || !tenantId) throw new HttpsError("invalid-argument", "Usuário e estabelecimento são obrigatórios.");
  const patch = ownerProfilePatch(data);
  const password = String(data.password || "");
  const userSnap = await db.doc(`users/${userId}`).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Proprietário não encontrado.");
  const user = userSnap.data() || {};
  if ((user.tenantId || user.barbershopId) !== tenantId || user.role !== "owner") {
    throw new HttpsError("permission-denied", "Este usuário não pertence ao estabelecimento.");
  }
  await applyAuthProfilePatch(userId, patch, password);
  await db.doc(`users/${userId}`).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const tenantPatch = {};
  if (patch.name) tenantPatch.ownerName = patch.name;
  if (patch.email) tenantPatch.email = patch.email;
  if (patch.phone) tenantPatch.phone = patch.phone;
  if (patch.whatsapp) tenantPatch.whatsapp = patch.whatsapp;
  if (patch.address) tenantPatch.address = patch.address;
  if (Object.keys(tenantPatch).length) {
    tenantPatch.updatedAt = FieldValue.serverTimestamp();
    await db.doc(`tenants/${tenantId}`).set(tenantPatch, { merge: true });
  }
  await db.collection("auditLogs").add({
    tenantId, barbershopId: tenantId, actorName: caller.name || caller.email || "Super Admin",
    role: caller.role || "super_admin", action: "Dados do proprietário atualizados",
    target: patch.email || patch.name || user.email || userId, time: Date.now(),
  });
  return { success: true, user: { id: userId, ...patch }, tenant: tenantPatch };
});

exports.updateOwnProfile = onCall(callableOptions, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login.");
  const data = request.data || {};
  const patch = ownerProfilePatch(data);
  const password = String(data.password || "");
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Usuário não encontrado.");
  const user = userSnap.data() || {};
  const tenantId = user.tenantId || user.barbershopId || "";
  await applyAuthProfilePatch(uid, patch, password);
  await userRef.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const tenantPatch = {};
  if (user.role === "owner" && tenantId) {
    if (patch.name) tenantPatch.ownerName = patch.name;
    if (patch.email) tenantPatch.email = patch.email;
    if (patch.phone) tenantPatch.phone = patch.phone;
    if (patch.whatsapp) tenantPatch.whatsapp = patch.whatsapp;
    if (patch.address) tenantPatch.address = patch.address;
    if (Object.keys(tenantPatch).length) {
      tenantPatch.updatedAt = FieldValue.serverTimestamp();
      await db.doc(`tenants/${tenantId}`).set(tenantPatch, { merge: true });
    }
  }
  return { success: true, user: { id: uid, ...patch }, tenant: tenantPatch };
});

// ------------------------------------------------------------
// 11) Enviar código OTP de verificação de e-mail via Resend.
// ------------------------------------------------------------
exports.sendVerificationCode = onCall({ ...callableOptions, secrets: [RESEND_API_KEY] }, async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const uid = caller.uid;
  const email = caller.token.email;
  if (!email) throw new HttpsError("invalid-argument", "E-mail não encontrado na conta.");

  // Rate-limit: máximo 1 envio por minuto por uid
  const otpRef = db.doc(`emailOtps/${uid}`);
  const existing = await otpRef.get();
  if (existing.exists) {
    const prev = existing.data();
    const prevCreated = prev.createdAt && prev.createdAt.toMillis ? prev.createdAt.toMillis() : 0;
    if (Date.now() - prevCreated < 60 * 1000) {
      throw new HttpsError("resource-exhausted", "Aguarde 60 segundos antes de solicitar um novo código.");
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await otpRef.set({
    code,
    email,
    expiresAt: Date.now() + 15 * 60 * 1000,
    used: false,
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  const { Resend } = require("resend");
  const resend = new Resend(RESEND_API_KEY.value());
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `${code} — código de verificação Groomin`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#1a1a1a">
      <div style="margin-bottom:20px"><span style="font-size:20px;font-weight:800;color:#7c3aed">Groomin</span></div>
      <h2 style="margin:0 0 8px;font-size:22px">Confirme seu e-mail</h2>
      <p style="color:#555;margin:0 0 28px">Use o código abaixo para ativar sua conta:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:12px;text-align:center;background:#f4f4f5;border-radius:12px;padding:24px 0;margin-bottom:28px;color:#111">${code}</div>
      <p style="color:#888;font-size:13px;margin:0">Válido por 15 minutos. Se você não criou uma conta no Groomin, ignore este e-mail.</p>
    </div>`,
  });
  if (error) {
    throw resendErrorToHttps(error, "verification");
  }
  return { sent: true };
});

// ------------------------------------------------------------
// 10) Verificar código OTP — valida e marca emailVerified no Auth.
// ------------------------------------------------------------
exports.verifyEmailCode = onCall(callableOptions, async (request) => {
  const caller = request.auth;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const { code } = request.data || {};
  if (!code || !/^\d{6}$/.test(String(code).trim())) {
    throw new HttpsError("invalid-argument", "Código deve ter 6 dígitos numéricos.");
  }
  const uid = caller.uid;
  const docRef = db.doc(`emailOtps/${uid}`);

  // Transação atômica: incremento e validação sem race condition
  let verified = false;
  let failReason = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) { failReason = "not-found"; return; }
    const otp = snap.data();
    if (otp.used) { failReason = "already-used"; return; }
    if (otp.expiresAt < Date.now()) { failReason = "expired"; return; }
    const attempts = (otp.attempts || 0) + 1;
    if (attempts > 8) { tx.update(docRef, { attempts }); failReason = "exhausted"; return; }
    if (otp.code !== String(code).trim()) { tx.update(docRef, { attempts }); failReason = "wrong"; return; }
    tx.update(docRef, { used: true, attempts });
    verified = true;
  });

  if (failReason === "not-found") throw new HttpsError("not-found", "Nenhum código enviado. Solicite um novo.");
  if (failReason === "already-used") throw new HttpsError("failed-precondition", "Código já utilizado. Solicite um novo.");
  if (failReason === "expired") throw new HttpsError("deadline-exceeded", "Código expirado. Solicite um novo.");
  if (failReason === "exhausted") throw new HttpsError("resource-exhausted", "Muitas tentativas. Solicite um novo código.");
  if (failReason === "wrong") throw new HttpsError("invalid-argument", "Código incorreto. Tente novamente.");

  await auth.updateUser(uid, { emailVerified: true });
  return { verified: true };
});

// ------------------------------------------------------------
// 11) OTP de pré-cadastro — valida e-mail antes de criar Auth.
//     Evita usuários órfãos quando o onboarding é abandonado.
// ------------------------------------------------------------
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const emailOtpDocId = (email) => {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");
};

exports.sendSignupVerificationCode = onCall({ ...callableOptions, secrets: [RESEND_API_KEY] }, async (request) => {
  const email = normalizeEmail(request.data && request.data.email);
  const name = String((request.data && request.data.name) || "").trim().slice(0, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "E-mail inválido.");
  }
  // Rate-limit antes do account check — evita timing side-channel para e-mails existentes
  const otpDocRef = db.doc(`signupEmailOtps/${emailOtpDocId(email)}`);
  const existingOtp = await otpDocRef.get();
  if (existingOtp.exists) {
    const prevData = existingOtp.data();
    const prevCreated = prevData.createdAt && prevData.createdAt.toMillis ? prevData.createdAt.toMillis() : 0;
    if (Date.now() - prevCreated < 60 * 1000) {
      throw new HttpsError("resource-exhausted", "Aguarde 60 segundos antes de solicitar um novo código.");
    }
  }

  let emailExists = false;
  try {
    await auth.getUserByEmail(email);
    emailExists = true;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw new HttpsError("internal", "Não foi possível validar este e-mail.");
  }

  const { Resend } = require("resend");
  const resend = new Resend(RESEND_API_KEY.value());

  if (emailExists) {
    // Aplica rate-limit sem expor que o e-mail existe (mesmo response que fluxo normal)
    await otpDocRef.set({ createdAt: FieldValue.serverTimestamp() }, { merge: true });
    const { error: existsErr } = await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: "Você já tem uma conta Groomin",
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#1a1a1a">
        <div style="margin-bottom:20px"><span style="font-size:20px;font-weight:800;color:#7c3aed">Groomin</span></div>
        <h2 style="margin:0 0 8px;font-size:22px">Você já tem uma conta</h2>
        <p style="color:#555;margin:0 0 28px">Alguém tentou criar uma nova conta Groomin com este e-mail — provavelmente foi você. Clique abaixo para acessar sua conta existente:</p>
        <a href="https://groomin-952d0.web.app/app" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px">Acessar minha conta</a>
        <p style="color:#888;font-size:13px;margin:28px 0 0">Se não foi você, pode ignorar este e-mail com segurança.</p>
      </div>`,
    });
    if (existsErr) throw resendErrorToHttps(existsErr, "signup");
    return { sent: true };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await otpDocRef.set({
    code,
    email,
    name,
    expiresAt: Date.now() + 15 * 60 * 1000,
    used: false,
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  });

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `${code} — código de verificação Groomin`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;color:#1a1a1a">
      <div style="margin-bottom:20px"><span style="font-size:20px;font-weight:800;color:#7c3aed">Groomin</span></div>
      <h2 style="margin:0 0 8px;font-size:22px">Confirme seu e-mail</h2>
      <p style="color:#555;margin:0 0 28px">${name ? `Olá, ${name}. ` : ""}Use o código abaixo para continuar seu cadastro:</p>
      <div style="font-size:42px;font-weight:800;letter-spacing:12px;text-align:center;background:#f4f4f5;border-radius:12px;padding:24px 0;margin-bottom:28px;color:#111">${code}</div>
      <p style="color:#888;font-size:13px;margin:0">Válido por 15 minutos. A conta só será criada depois que você publicar sua página.</p>
    </div>`,
  });
  if (error) {
    throw resendErrorToHttps(error, "signup");
  }
  return { sent: true };
});

exports.verifySignupEmailCode = onCall(callableOptions, async (request) => {
  const email = normalizeEmail(request.data && request.data.email);
  const code = String((request.data && request.data.code) || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^\d{6}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Código inválido.");
  }
  const ref = db.doc(`signupEmailOtps/${emailOtpDocId(email)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Nenhum código enviado. Solicite um novo.");
  const otp = snap.data();
  if (otp.used) throw new HttpsError("failed-precondition", "Código já utilizado. Solicite um novo.");
  if (otp.expiresAt < Date.now()) throw new HttpsError("deadline-exceeded", "Código expirado. Solicite um novo.");
  if ((otp.attempts || 0) >= 8) throw new HttpsError("resource-exhausted", "Muitas tentativas. Solicite um novo código.");
  if (otp.code !== code) {
    await ref.set({ attempts: FieldValue.increment(1), lastAttemptAt: FieldValue.serverTimestamp() }, { merge: true });
    throw new HttpsError("invalid-argument", "Código incorreto. Tente novamente.");
  }
  await ref.set({ used: true, verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { verified: true, email };
});

// ------------------------------------------------------------
// Exclusão completa de tenant (super admin): deleta todas as subcoleções,
// subscription, usuários vinculados e slug.
// ------------------------------------------------------------
exports.adminDeleteTenant = onCall(callableOptions, async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller || !caller.isSuperAdmin) throw new HttpsError("permission-denied", "Acesso negado.");
  const tenantId = String((request.data && request.data.tenantId) || "").trim();
  if (!tenantId) throw new HttpsError("invalid-argument", "tenantId obrigatório.");

  await db.recursiveDelete(db.doc(`tenants/${tenantId}`));
  await db.doc(`subscriptions/${tenantId}`).delete().catch(() => {});

  const [usersSnap, slugsSnap] = await Promise.all([
    db.collection("users").where("tenantId", "==", tenantId).get(),
    db.collection("slugs").where("tenantId", "==", tenantId).get(),
  ]);
  await Promise.all([
    ...usersSnap.docs.map((d) => d.ref.delete()),
    ...slugsSnap.docs.map((d) => d.ref.delete()),
  ]);

  return { ok: true };
});
