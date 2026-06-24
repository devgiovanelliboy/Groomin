/* ============================================================
   Groomin — Adaptador Firebase (modo TESTE: Auth + Firestore, SEM Functions)
   ------------------------------------------------------------
   - Papel/tenant vêm do documento /users/{uid} (não de claims).
   - Cadastro do dono cria tenant + slug + dados iniciais no cliente.
   - Página pública carrega dados de forma anônima por slug.
   - Tempo real (onSnapshot) hidrata o cache `DB`; UI re-renderiza sozinha.
   - Offline via persistência local do Firestore.
   - Escritas espelhadas no Firestore (write-through via window.__dbWrite).
   Só roda quando window.USE_FIREBASE === true e a config está preenchida.
   ============================================================ */
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const enabled = window.USE_FIREBASE === true && cfg.apiKey && !/COLE_AQUI/.test(cfg.apiKey);
  window.__FB_ENABLED = enabled;
  if (!enabled) return;

  const TENANT_COLLS = ["services", "barbers", "customers", "appointments", "products",
    "combos", "campaigns", "sales", "cashSessions", "stockMoves", "reviews", "blocks", "notifications"];
  const SDK = "https://www.gstatic.com/firebasejs/10.12.5/";
  const FB = { app: null, auth: null, db: null, unsubs: [] };
  window.FB = FB;
  let A, F; // módulos auth e firestore

  async function load() {
    const appMod = await import(SDK + "firebase-app.js");
    A = await import(SDK + "firebase-auth.js");
    F = await import(SDK + "firebase-firestore.js");
    FB.app = appMod.initializeApp(cfg);
    FB.auth = A.getAuth(FB.app);
    try {
      FB.db = F.initializeFirestore(FB.app, {
        localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
      });
    } catch (e) { FB.db = F.getFirestore(FB.app); }
    wireWriteThrough();
    A.onAuthStateChanged(FB.auth, onAuth);
  }

  // ---------------- AUTH (sem claims: lê /users/{uid}) ----------------
  async function onAuth(user) {
    stopListeners();
    if (!user) { sessionStorage.removeItem("groomin_user"); render(); return; }
    const su = await buildSession(user);
    if (!su) { render(); return; } // doc ainda não existe (cadastro em andamento)
    await startListeners(su);
    const intended = sessionStorage.getItem("groomin_intended");
    sessionStorage.removeItem("groomin_intended");
    if (window.homeRouteFor) location.hash = (intended && intended.length) ? intended : homeRouteFor(su.role);
    render();
  }
  async function buildSession(user) {
    const snap = await F.getDoc(F.doc(FB.db, "users", user.uid));
    if (!snap.exists()) {
      if (!window._fbSigningUp && window.toast) toast("Perfil não encontrado. Tente criar a conta novamente.", "err");
      console.warn("[Groomin] /users/" + user.uid + " não existe no Firestore.");
      return null;
    }
    const d = snap.data();
    if (!d.tenantId && d.role === "owner") {
      console.warn("[Groomin] Usuário owner sem tenantId:", user.uid, d);
    }
    const su = {
      id: user.uid, uid: user.uid, name: d.name || user.displayName || (user.email || "").split("@")[0],
      email: user.email, role: d.role || "customer",
      barbershopId: d.tenantId || null, customerId: d.customerId || null, active: d.active !== false,
    };
    sessionStorage.setItem("groomin_user", JSON.stringify(su));
    return su;
  }
  window.fbRefreshSession = async function () {
    const u = FB.auth.currentUser; if (!u) return;
    const su = await buildSession(u);
    if (su) { stopListeners(); await startListeners(su); location.hash = homeRouteFor(su.role); render(); }
  };
  window.fbSignIn = (email, password) => A.signInWithEmailAndPassword(FB.auth, email, password);
  window.fbSignOut = () => A.signOut(FB.auth);

  // ---------------- CADASTRO DO DONO (bootstrap no cliente) ----------------
  window.fbSignUpOwner = async function ({ shopName, ownerName, email, password, phone, whatsapp, address, slugOverride, planId }) {
    window._fbSigningUp = true;
    const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
    if (ownerName) await A.updateProfile(cred.user, { displayName: ownerName });
    const uid = cred.user.uid;
    const { doc, collection, setDoc, addDoc, getDoc, serverTimestamp } = F;

    const slugifyStr = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tRef = doc(collection(FB.db, "tenants"));
    const tid = tRef.id;
    const pid = planId || "free";
    const plan = (typeof DB !== "undefined" && DB.find) ? DB.find("plans", pid) : null;
    const mrr = plan ? (plan.price || 0) : 0;

    // slug único
    let base = slugifyStr(slugOverride || shopName) || "barbearia", slug = base, n = 1;
    while ((await getDoc(doc(FB.db, "slugs", slug))).exists()) slug = base + "-" + (++n);
    await setDoc(doc(FB.db, "slugs", slug), { tenantId: tid, createdAt: Date.now() });
    const tenantPayload = {
      name: shopName, slug, ownerName: ownerName || "", ownerUid: uid,
      description: "Barbearia cadastrada no Groomin.",
      phone: phone || "", whatsapp: whatsapp || phone || "",
      email, address: address || "", city: "", neighborhood: "", instagram: "",
      open: "09:00", close: "19:00", lunchStart: "12:00", lunchEnd: "13:00",
      slotInterval: 30, status: "active", planId: pid, rating: 0, createdAt: Date.now(),
    };
    await setDoc(tRef, tenantPayload);
    // Hidrata local DB imediatamente com o plano correto (sem aguardar onSnapshot)
    try { const d = DB.get(); upsert(d.barbershops, { id: tid, ...tenantPayload }); DB.save(); } catch (_) {}
    await setDoc(doc(FB.db, "users", uid), {
      name: ownerName || "Dono", email, role: "owner", tenantId: tid, active: true, createdAt: Date.now(),
    });
    const trialDays = pid === "free" ? 0 : 7;
    const subPayload = {
      tenantId: tid, planId: pid,
      status: pid === "free" ? "active" : "trialing",
      mrr, startedAt: Date.now(),
      renewsAt: Date.now() + trialDays * 86400000,
    };
    await setDoc(doc(FB.db, "subscriptions", tid), subPayload);
    // Hidrata assinatura local imediatamente (shopSubscription filtra por barbershopId)
    try { const d = DB.get(); upsert(d.subscriptions, { id: tid, barbershopId: tid, ...subPayload }); DB.save(); } catch (_) {}

    await addDoc(collection(FB.db, "tenants", tid, "services"), {
      tenantId: tid, barbershopId: tid, name: "Corte Masculino", desc: "Corte personalizado.",
      price: 45, duration: 30, category: "Cabelo", icon: "scissors", active: true,
    });
    await addDoc(collection(FB.db, "tenants", tid, "barbers"), {
      tenantId: tid, barbershopId: tid, name: ownerName || "Barbeiro",
      role: "Proprietário & Barbeiro", bio: "", phone: phone || "", email,
      specialties: ["Corte"], commission: 0, productCommission: 0, isOwner: true,
      start: "09:00", end: "19:00", lunchStart: "12:00", lunchEnd: "13:00",
      days: [1, 2, 3, 4, 5, 6], vacations: [], active: true, rating: 5,
    });
    window._fbSigningUp = false;
    await window.fbRefreshSession();
    return { tenantId: tid, slug };
  };

  // ---------------- CADASTRO DE CLIENTE (página pública) ----------------
  window.fbSignUpCustomer = async function ({ name, email, password, phone, tenantId }) {
    window._fbSigningUp = true;
    const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
    if (name) await A.updateProfile(cred.user, { displayName: name });
    const uid = cred.user.uid;
    const { doc, collection, setDoc, addDoc } = F;
    const cRef = await addDoc(collection(FB.db, "tenants", tenantId, "customers"), {
      tenantId, barbershopId: tenantId, name, email, phone: phone || "", whatsapp: phone || "",
      notes: "", createdAt: Date.now(),
    });
    await setDoc(doc(FB.db, "users", uid), {
      name, email, role: "customer", tenantId, customerId: cRef.id, active: true, createdAt: Date.now(),
    });
    window._fbSigningUp = false;
    await window.fbRefreshSession();
    return { customerId: cRef.id };
  };

  // ---------------- PÁGINA PÚBLICA (leitura anônima por slug) ----------------
  window.fbLoadPublicShop = async function (slug) {
    const { doc, getDoc, getDocs, collection } = F;
    const slugSnap = await getDoc(doc(FB.db, "slugs", slug));
    if (!slugSnap.exists()) return false;
    const tid = slugSnap.data().tenantId;
    const tSnap = await getDoc(doc(FB.db, "tenants", tid));
    if (!tSnap.exists()) return false;
    const data = DB.get();
    upsert(data.barbershops, { id: tid, ...tSnap.data() });
    for (const name of ["services", "barbers", "reviews"]) {
      const qs = await getDocs(collection(FB.db, "tenants", tid, name));
      const arr = qs.docs.map((d) => ({ id: d.id, barbershopId: tid, ...d.data() }));
      data[name] = mergeOther(data[name], arr, tid);
    }
    DB.save();
    return true;
  };

  // ---------------- BOOKING PÚBLICO (escrita direta validada por regras) ----------------
  window.fbPublicBooking = async function (p) {
    const { doc, collection, getDocs, query, where, setDoc, addDoc } = F;
    const tid = p.tenantId;
    // conflito no cliente — query pode falhar (permission-denied) para clientes autenticados
    // cuja regra de leitura requer customerId == myCustomer() (coleção inteira negada)
    try {
      const dayQ = await getDocs(query(collection(FB.db, "tenants", tid, "appointments"), where("date", "==", p.date)));
      const s0 = toMin(p.time);
      for (const d of dayQ.docs) {
        const a = d.data(); if (a.status === "cancelado" || a.barberId !== p.barberId) continue;
        const aS = toMin(a.time), aE = aS + (a.duration || 30);
        if (s0 < aE && (s0 + (p.duration || 30)) > aS) { const e = new Error("já reservado"); e.code = "already-exists"; throw e; }
      }
    } catch(conflictErr) {
      if ((conflictErr.code || "") === "already-exists") throw conflictErr;
      // permission-denied ou outro erro na leitura: pula check client-side, prossegue com addDoc
    }
    // cliente — usa customerId direto quando cliente está logado, evita doc duplicado
    let customerId = p.customerId || null;
    if (!customerId) {
      const cq = p.phone
        ? await getDocs(query(collection(FB.db, "tenants", tid, "customers"), where("phone", "==", p.phone)))
        : { empty: true };
      if (!cq.empty) customerId = cq.docs[0].id;
      else { const cRef = await addDoc(collection(FB.db, "tenants", tid, "customers"),
        { tenantId: tid, barbershopId: tid, name: p.name, phone: p.phone || "", whatsapp: p.phone || "", email: p.email || "", notes: "", createdAt: Date.now() });
        customerId = cRef.id; }
    }
    const apptPayload = {
      tenantId: tid, barbershopId: tid, customerId, customerName: p.name, phone: p.phone,
      serviceId: p.serviceId, barberId: p.barberId, date: p.date, time: p.time,
      duration: p.duration || 30, status: "pendente", price: p.price || 0, source: "public", createdAt: Date.now(),
    };
    const aRef = await addDoc(collection(FB.db, "tenants", tid, "appointments"), apptPayload);
    // Hidrata cache local imediatamente — o onSnapshot do cliente é bloqueado por regras
    // (query de coleção inteira negada para role=customer), então injetamos manualmente.
    try {
      const d = DB.get();
      if (!d.appointments) d.appointments = [];
      upsert(d.appointments, { id: aRef.id, ...apptPayload });
      DB.save();
    } catch (_) {}
    return { appointmentId: aRef.id };
  };
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

  // ---------------- LISTENERS (hidratação tempo real) ----------------
  async function startListeners(user) {
    const { collection, onSnapshot, doc } = F;
    const data = DB.get();
    const bindColl = (path, name, tid) => {
      const un = onSnapshot(collection(FB.db, ...path), (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(tid ? { barbershopId: tid } : {}), ...d.data() }));
        data[name] = tid ? mergeOther(data[name], arr, tid) : arr;
        DB.save(); render();
      }, () => {});
      FB.unsubs.push(un);
    };
    if (user.role === "super_admin") {
      bindColl(["tenants"], "barbershops");
      bindColl(["subscriptions"], "subscriptions");
      bindColl(["invoices"], "invoices");
      bindColl(["auditLogs"], "auditLogs");
      bindColl(["users"], "users");
    } else if (user.barbershopId) {
      const tid = user.barbershopId;
      FB.unsubs.push(onSnapshot(doc(FB.db, "tenants", tid), (d) => {
        if (d.exists()) { upsert(data.barbershops, { id: d.id, ...d.data() }); DB.save(); render(); }
      }, () => {}));
      const colls = user.role === "customer" ? ["appointments", "services", "barbers"] : TENANT_COLLS;
      colls.forEach((c) => bindColl(["tenants", tid, c], c, tid));
      if (user.role !== "customer") {
        FB.unsubs.push(onSnapshot(doc(FB.db, "subscriptions", tid), (d) => {
          if (d.exists()) { upsert(data.subscriptions, { id: d.id, barbershopId: tid, ...d.data() }); DB.save(); render(); }
        }, () => {}));
      }
      if (user.role === "customer" && user.customerId) {
        FB.unsubs.push(onSnapshot(doc(FB.db, "tenants", tid, "customers", user.customerId), (d) => {
          if (d.exists()) {
            if (!data.customers) data.customers = [];
            upsert(data.customers, { id: d.id, barbershopId: tid, ...d.data() });
            DB.save(); render();
          }
        }, () => {}));
      }
    }
  }
  function stopListeners() { FB.unsubs.forEach((u) => { try { u(); } catch (e) {} }); FB.unsubs = []; }

  // ---------------- WRITE-THROUGH ----------------
  function wireWriteThrough() {
    window.__dbWrite = async function (op, coll, obj) {
      try {
        const ref = pathFor(coll, obj); if (!ref) return;
        if (op === "remove") await F.deleteDoc(ref);
        else await F.setDoc(ref, clean(obj), { merge: true });
      } catch (e) { console.warn("[FB write]", coll, e.message); }
    };
  }
  function pathFor(coll, obj) {
    if (TENANT_COLLS.includes(coll)) { const tid = obj.barbershopId; return tid ? F.doc(FB.db, "tenants", tid, coll, obj.id) : null; }
    if (coll === "barbershops") return F.doc(FB.db, "tenants", obj.id);
    if (coll === "subscriptions") return F.doc(FB.db, "subscriptions", obj.barbershopId || obj.id);
    if (coll === "invoices") return F.doc(FB.db, "invoices", obj.id);
    if (coll === "auditLogs") return F.doc(FB.db, "auditLogs", obj.id);
    return null; // users/plans/settings: fora do write-through automático
  }
  function clean(o) { const r = {}; Object.keys(o).forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  function mergeOther(prev, incoming, tid) { return (prev || []).filter((x) => x.barbershopId !== tid).concat(incoming); }
  function upsert(arr, obj) { const i = arr.findIndex((x) => x.id === obj.id); if (i > -1) arr[i] = obj; else arr.push(obj); }
  function render() { if (window.Router && location.hash) Router.render(); }

  load().catch((e) => {
    console.error("[Groomin] Firebase indisponível, modo local:", e);
    window.__FB_ENABLED = false;
    if (window.toast) toast("Sem conexão com o Firebase — rodando local.", "err");
    render();
  });
})();
