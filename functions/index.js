/**
 * BarberOS — Cloud Functions (Gen 2, Node 20)
 * Projeto: groomin-952d0
 *
 * Responsabilidades de segurança:
 *  - Sincronizar custom claims (tenantId, role, customerId) a partir de /users/{uid}.
 *    As Security Rules confiam nessas claims para o isolamento multi-tenant.
 *  - Bootstrap de tenant (cadastro do dono) de forma controlada.
 *  - Provisionar usuários de um tenant (somente super admin / dono).
 *  - Agendamento público SEM conta, validado no servidor (evita escrita aberta).
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const auth = getAuth();

const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const timeToMin = (t) => {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
};

// ------------------------------------------------------------
// 1) Sincroniza custom claims sempre que /users/{uid} muda.
//    Fonte da verdade de role/tenantId é o documento do usuário.
// ------------------------------------------------------------
exports.syncUserClaims = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) {
    // usuário removido: limpa claims
    try { await auth.setCustomUserClaims(uid, {}); } catch (_) {}
    return;
  }
  const claims = {
    role: after.role || "customer",
    tenantId: after.tenantId || null,
  };
  if (after.customerId) claims.customerId = after.customerId;
  await auth.setCustomUserClaims(uid, claims);
  // marca para o cliente saber que precisa renovar o token
  await db.doc(`users/${uid}`).set(
    { claimsUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
});

// ------------------------------------------------------------
// 2) Bootstrap de tenant: dono recém-cadastrado cria a barbearia.
//    Exige usuário autenticado SEM tenant ainda.
// ------------------------------------------------------------
exports.bootstrapTenant = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Faça login para continuar.");

  const existing = await db.doc(`users/${uid}`).get();
  if (existing.exists && existing.data().tenantId) {
    throw new HttpsError("failed-precondition", "Usuário já pertence a uma barbearia.");
  }

  const name = (request.data.shopName || "").trim();
  const ownerName = (request.data.ownerName || "").trim();
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
    description: "Barbearia cadastrada no BarberOS.",
    phone: request.data.phone || "", whatsapp: request.data.phone || "",
    email: request.auth.token.email || "",
    open: "09:00", close: "19:00", lunchStart: "12:00", lunchEnd: "13:00",
    slotInterval: 30, status: "active", planId: "free", rating: 0,
    createdAt: now,
  });
  batch.set(db.doc(`users/${uid}`), {
    name: ownerName || request.auth.token.name || "Dono",
    email: request.auth.token.email || "",
    role: "owner", tenantId: tid, active: true, createdAt: now,
  }, { merge: true });
  batch.set(db.doc(`subscriptions/${tid}`), {
    tenantId: tid, planId: "free", status: "active", mrr: 0,
    startedAt: now, renewsAt: now,
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
exports.provisionUser = onCall(async (request) => {
  const caller = request.auth && request.auth.token;
  if (!caller) throw new HttpsError("unauthenticated", "Faça login.");
  const { email, password, name, role, tenantId } = request.data || {};
  const allowedRoles = ["owner", "manager", "receptionist", "barber"];
  if (!email || !password || !allowedRoles.includes(role)) {
    throw new HttpsError("invalid-argument", "Dados inválidos.");
  }
  const isSuper = caller.role === "super_admin";
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
exports.createPublicBooking = onCall(async (request) => {
  const { tenantId, serviceId, barberId, date, time, name, phone, email } = request.data || {};
  if (!tenantId || !serviceId || !barberId || !date || !time || !name || !phone) {
    throw new HttpsError("invalid-argument", "Dados de agendamento incompletos.");
  }

  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  if (!tenantSnap.exists || tenantSnap.data().status !== "active") {
    throw new HttpsError("failed-precondition", "Barbearia indisponível.");
  }
  const svcSnap = await db.doc(`tenants/${tenantId}/services/${serviceId}`).get();
  const barberSnap = await db.doc(`tenants/${tenantId}/barbers/${barberId}`).get();
  if (!svcSnap.exists || !barberSnap.exists) {
    throw new HttpsError("not-found", "Serviço ou profissional inexistente.");
  }
  const svc = svcSnap.data();
  const start = timeToMin(time);
  const end = start + (svc.duration || 30);

  // checa conflito (transação) e grava
  const apptId = await db.runTransaction(async (tx) => {
    const dayAppts = await tx.get(
      db.collection(`tenants/${tenantId}/appointments`)
        .where("barberId", "==", barberId)
        .where("date", "==", date)
    );
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
    let customerId = null;
    const custQ = await tx.get(
      db.collection(`tenants/${tenantId}/customers`).where("phone", "==", phone).limit(1)
    );
    if (!custQ.empty) customerId = custQ.docs[0].id;
    else {
      const cRef = db.collection(`tenants/${tenantId}/customers`).doc();
      tx.set(cRef, { tenantId, name, phone, whatsapp: phone, email: email || "", notes: "", createdAt: FieldValue.serverTimestamp() });
      customerId = cRef.id;
    }
    const aRef = db.collection(`tenants/${tenantId}/appointments`).doc();
    tx.set(aRef, {
      tenantId, customerId, customerName: name, phone,
      serviceId, barberId, date, time, duration: svc.duration || 30,
      status: "confirmado", price: svc.price || 0, source: "public",
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection(`tenants/${tenantId}/notifications`).doc(), {
      tenantId, type: "confirm", title: "Novo agendamento",
      msg: `${name} — ${svc.name} ${date} ${time}`, read: false,
      time: Date.now(),
    });
    return aRef.id;
  });

  return { appointmentId: apptId };
});
