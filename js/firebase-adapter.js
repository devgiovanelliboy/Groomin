/* ============================================================
   Groomin — Adaptador Firebase (Auth + Firestore + Storage + Functions)
   ------------------------------------------------------------
   - Papel/tenant vêm do documento /users/{uid}; Functions espelham custom claims.
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
  const FB = { app: null, auth: null, db: null, functions: null, unsubs: [] };
  window.FB = FB;
  let A, F, ST, AC, FN; // módulos auth, firestore, storage, app check e functions

  async function load() {
    const appMod = await import(SDK + "firebase-app.js");
    A = await import(SDK + "firebase-auth.js");
    F = await import(SDK + "firebase-firestore.js");
    FN = await import(SDK + "firebase-functions.js");
    FB.app = appMod.initializeApp(cfg);
    FB.auth = A.getAuth(FB.app);
    FB.functions = FN.getFunctions(FB.app, "us-central1");
    if (window.FIREBASE_APPCHECK_SITE_KEY) {
      AC = await import(SDK + "firebase-app-check.js");
      const Provider = AC.ReCaptchaEnterpriseProvider || AC.ReCaptchaV3Provider;
      AC.initializeAppCheck(FB.app, {
        provider: new Provider(window.FIREBASE_APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      FB.appCheck = true;
    }
    if (cfg.storageBucket) {
      ST = await import(SDK + "firebase-storage.js");
      FB.storage = ST.getStorage(FB.app);
    }
    try {
      FB.db = F.initializeFirestore(FB.app, {
        localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
      });
    } catch (e) { FB.db = F.getFirestore(FB.app); }
    wireWriteThrough();
    A.onAuthStateChanged(FB.auth, onAuth);
  }

  window.fbUploadTenantImage = async function (tid, kind, file, oldPath) {
    if (!ST || !FB.storage) {
      const e = new Error("Storage não configurado");
      e.code = "storage-not-configured";
      throw e;
    }
    if (!file) return null;
    if (!/^image\//.test(file.type || "")) {
      const e = new Error("Arquivo inválido");
      e.code = "invalid-image";
      throw e;
    }
    if (file.size > 5 * 1024 * 1024) {
      const e = new Error("Imagem maior que 5MB");
      e.code = "image-too-large";
      throw e;
    }
    const ext = ((file.name || "").split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `tenants/${tid}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const ref = ST.ref(FB.storage, path);
    await ST.uploadBytes(ref, file, { contentType: file.type || "image/jpeg" });
    const url = await ST.getDownloadURL(ref);
    if (oldPath && oldPath !== path) window.fbDeleteStoragePath(oldPath).catch(() => {});
    return { url, path };
  };

  window.fbDeleteStoragePath = async function (path) {
    if (!path || !ST || !FB.storage) return;
    if (!String(path).startsWith("tenants/")) return;
    await ST.deleteObject(ST.ref(FB.storage, path));
  };

  // ---------------- AUTH (sem claims: lê /users/{uid}) ----------------
  async function onAuth(user) {
    stopListeners();
    if (!user) { sessionStorage.removeItem("groomin_user"); render(); return; }
    let su = await buildSession(user);
    if (!su) { render(); return; } // doc ainda não existe (cadastro em andamento)
    if (su.role === "customer") {
      try {
        const pendingProfile = readJson(sessionStorage.getItem("groomin_customer_link_profile"));
        const pendingShop = (pendingProfile && pendingProfile.tenantId) || sessionStorage.getItem("groomin_login_shop") || "";
        if (pendingShop) {
          su = await activateCustomerTenant(user, su, pendingShop, pendingProfile || null);
          sessionStorage.removeItem("groomin_customer_link_profile");
          sessionStorage.removeItem("groomin_login_shop");
        }
      } catch (e) {
        console.warn("[Groomin] vínculo de cliente não ativado:", e.code || "", e.message || e);
        sessionStorage.removeItem("groomin_login_shop");
        if ((e.code || "") !== "missing-phone") sessionStorage.removeItem("groomin_customer_link_profile");
        if (window.toast) toast("Entre pela opção Criar conta desta barbearia para vincular seu perfil.", "info");
      }
    }
    await preloadTenantForSession(su);
    await startListeners(su);
    const intended = sessionStorage.getItem("groomin_intended");
    sessionStorage.removeItem("groomin_intended");
    if (window.homeRouteFor) location.hash = (intended && intended.length) ? intended : homeRouteFor(su.role);
    render();
  }
  function readJson(v) { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } }
  async function preloadTenantForSession(su) {
    const tid = su && su.barbershopId;
    if (!tid || !F || !FB.db) return;
    try {
      const snap = await F.getDoc(F.doc(FB.db, "tenants", tid));
      if (snap.exists()) {
        const d = DB.get();
        if (!d.barbershops) d.barbershops = [];
        upsert(d.barbershops, { id: snap.id, ...snap.data() });
        DB.save();
      } else {
        console.warn("[Groomin] tenant não encontrado:", tid);
      }
    } catch (e) {
      console.warn("[Groomin] preload tenant falhou:", e.code || "", e.message || e);
    }
  }
  async function buildSession(user) {
    let snap;
    try { snap = await F.getDoc(F.doc(FB.db, "users", user.uid)); }
    catch(e) { console.error("[Groomin] buildSession getDoc falhou:", e.code, e.message); return null; }
    if (!snap.exists()) {
      if (!window._fbSigningUp && window.toast) toast("Perfil não encontrado. Tente criar a conta novamente.", "err");
      console.warn("[Groomin] /users/" + user.uid + " não existe no Firestore.");
      return null;
    }
    const d = snap.data();
    const tenantId = d.tenantId || d.barbershopId || null;
    if (!tenantId && d.role === "owner") {
      console.warn("[Groomin] Usuário owner sem tenantId:", user.uid, d);
    }
    const su = {
      id: user.uid, uid: user.uid, name: d.name || user.displayName || (user.email || "").split("@")[0],
      email: user.email, role: d.role || "customer",
      barbershopId: tenantId, customerId: d.customerId || null, active: d.active !== false,
    };
    console.log("[Groomin] buildSession ok:", su.role, "tid:", su.barbershopId, "cid:", su.customerId);
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
  function authActionUrl(path) {
    const origin = location.origin && location.origin !== "null"
      ? location.origin
      : `https://${cfg.authDomain || "groomin-952d0.web.app"}`;
    return `${origin}${path || "/app/#/login"}`;
  }
  window.fbSendPasswordReset = (email) => A.sendPasswordResetEmail(FB.auth, email, {
    url: authActionUrl("/app/#/login"),
    handleCodeInApp: false,
  });

  // ---------------- CADASTRO DO DONO (bootstrap no cliente) ----------------
  window.fbSignUpOwner = async function ({ shopName, ownerName, email, password, phone, whatsapp, address, slugOverride, planId, category, instagram, timezone, hours, professionals, services, logoFile, coverFile }) {
    window._fbSigningUp = true;
    const allowedPlans = ["growth", "pro", "elite"];
    const pid = allowedPlans.includes(planId) ? planId : "growth";
    const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
    if (ownerName) await A.updateProfile(cred.user, { displayName: ownerName });
    const uid = cred.user.uid;
    const { doc, collection, setDoc, addDoc, getDoc } = F;

    const slugifyStr = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tRef = doc(collection(FB.db, "tenants"));
    const tid = tRef.id;
    const plan = (typeof DB !== "undefined" && DB.find) ? DB.find("plans", pid) : null;
    const mrr = plan ? (plan.price || 0) : 0;

    // slug único (só leituras — regra de escrita do slug exige tenant existir primeiro)
    let base = slugifyStr(slugOverride || shopName) || "barbearia", slug = base, n = 1;
    while ((await getDoc(doc(FB.db, "slugs", slug))).exists()) slug = base + "-" + (++n);

    try {
      // tenant PRIMEIRO — regra do slug faz get(tenant) para validar ownerUid
      const h = hours || {};
      const tenantPayload = {
        name: shopName, slug, ownerName: ownerName || "", ownerUid: uid,
        description: "Barbearia cadastrada no Groomin.", logoUrl: "", logoPath: "",
        category: category || "barbershop",
        phone: phone || "", whatsapp: whatsapp || phone || "",
        email, address: address || "", city: "", neighborhood: "", instagram: instagram || "",
        open: h.open || "09:00", close: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
        workDays: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6],
        timezone: timezone || "America/Sao_Paulo",
        slotInterval: 30, status: "active", planId: pid, rating: 0, createdAt: Date.now(),
      };
      await setDoc(tRef, tenantPayload);

      // slug depois do tenant (regra valida tenant.ownerUid == uid)
      await setDoc(doc(FB.db, "slugs", slug), { tenantId: tid, createdAt: Date.now() });

      await setDoc(doc(FB.db, "users", uid), {
        name: ownerName || "Dono", email, role: "owner", tenantId: tid, active: true, createdAt: Date.now(),
      });
      const subPayload = {
        tenantId: tid, planId: pid,
        status: "active",
        mrr, startedAt: Date.now(),
        renewsAt: Date.now() + 30 * 86400000,
      };
      await setDoc(doc(FB.db, "subscriptions", tid), subPayload);

      const mediaPatch = {};
      if (logoFile && window.fbUploadTenantImage) {
        const up = await window.fbUploadTenantImage(tid, "logos", logoFile);
        mediaPatch.logoUrl = up.url; mediaPatch.logoPath = up.path;
      }
      if (coverFile && window.fbUploadTenantImage) {
        const up = await window.fbUploadTenantImage(tid, "covers", coverFile);
        mediaPatch.coverUrl = up.url; mediaPatch.coverPath = up.path;
      }
      if (Object.keys(mediaPatch).length) await setDoc(tRef, mediaPatch, { merge: true });

      const svcList = Array.isArray(services) && services.length ? services : [{ name: "Corte Masculino", price: 45, duration: 30, category: "Serviços" }];
      for (const s of svcList) {
        await addDoc(collection(FB.db, "tenants", tid, "services"), {
          tenantId: tid, barbershopId: tid, name: s.name || "Serviço", desc: s.desc || "",
          price: Number(s.price || 0), duration: Number(s.duration || 30), category: s.category || "Serviços", icon: s.icon || "scissors", active: true,
        });
      }
      const barberList = Array.isArray(professionals) && professionals.length ? professionals : [{ name: ownerName || "Profissional", role: "Profissional" }];
      for (const b of barberList) {
        await addDoc(collection(FB.db, "tenants", tid, "barbers"), {
          tenantId: tid, barbershopId: tid, name: b.name || ownerName || "Profissional",
          role: b.role || "Profissional", photoUrl: "", photoPath: "", bio: b.bio || "", phone: b.phone || phone || "", email: b.email || email,
          specialties: b.specialties || [], commission: 0, productCommission: 0, isOwner: false,
          start: h.open || "09:00", end: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
          days: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6], vacations: [], active: true, rating: 5,
        });
      }
    } catch (err) {
      window._fbSigningUp = false;
      try { await cred.user.delete(); } catch (_) {}
      throw err;
    }
    window._fbSigningUp = false;
    await window.fbRefreshSession();
    return { tenantId: tid, slug };
  };

  // ---------------- CADASTRO DE CLIENTE (página pública) ----------------
  async function activateCustomerTenant(user, su, tenantId, profile) {
    const { doc, collection, setDoc, addDoc, getDoc } = F;
    const linkRef = doc(FB.db, "users", user.uid, "customerLinks", tenantId);
    const linkSnap = await getDoc(linkRef);
    let customerId = linkSnap.exists() ? linkSnap.data().customerId : null;
    const email = user.email || (profile && profile.email) || su.email || "";
    if (!customerId) {
      const phone = (profile && profile.phone) || "";
      const birthday = (profile && profile.birthday) || "";
      if (String(phone).replace(/\D/g, "").length < 8) {
        const e = new Error("Telefone obrigatório para vincular nova barbearia.");
        e.code = "missing-phone";
        throw e;
      }
      const name = (profile && profile.name) || su.name || (email.split("@")[0]);
      const cRef = await addDoc(collection(FB.db, "tenants", tenantId, "customers"), {
        tenantId, barbershopId: tenantId, name, email, phone, whatsapp: phone,
        birthday, notes: "", createdAt: Date.now(),
      });
      customerId = cRef.id;
      await setDoc(linkRef, {
        tenantId, customerId, email, name, createdAt: Date.now(), lastUsedAt: Date.now(),
      });
    } else {
      await setDoc(linkRef, { lastUsedAt: Date.now() }, { merge: true });
    }
    await setDoc(doc(FB.db, "users", user.uid), {
      tenantId, customerId, name: (profile && profile.name) || su.name, email, role: "customer", active: true,
    }, { merge: true });
    const next = { ...su, barbershopId: tenantId, customerId, email, role: "customer", active: true };
    sessionStorage.setItem("groomin_user", JSON.stringify(next));
    return next;
  }
  window.fbEnsureCustomerLink = async function (tenantId, profile) {
    const user = FB.auth.currentUser;
    if (!user) throw new Error("Faça login para vincular esta barbearia.");
    const su = await buildSession(user);
    if (!su || su.role !== "customer") throw new Error("Conta de cliente inválida.");
    const next = await activateCustomerTenant(user, su, tenantId, profile || null);
    stopListeners(); await startListeners(next); render();
    return next;
  };

  window.fbSignUpCustomer = async function ({ name, email, password, phone, birthday, tenantId, customerId }) {
    window._fbSigningUp = true;
    email = String(email || "").trim().toLowerCase();
    const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
    if (name) await A.updateProfile(cred.user, { displayName: name });
    const uid = cred.user.uid;
    const { doc, collection, setDoc, addDoc } = F;
    try {
      if (!customerId) {
        const cRef = await addDoc(collection(FB.db, "tenants", tenantId, "customers"), {
          tenantId, barbershopId: tenantId, name, email, phone: phone || "", whatsapp: phone || "",
          birthday: birthday || "", notes: "", createdAt: Date.now(),
        });
        customerId = cRef.id;
      } else if (birthday) {
        await setDoc(doc(FB.db, "tenants", tenantId, "customers", customerId), { birthday }, { merge: true });
      }
      await setDoc(doc(FB.db, "users", uid), {
        name, email, role: "customer", tenantId, customerId, active: true, createdAt: Date.now(),
      });
      await setDoc(doc(FB.db, "users", uid, "customerLinks", tenantId), {
        tenantId, customerId, email, name, createdAt: Date.now(), lastUsedAt: Date.now(),
      });
      window._fbSigningUp = false;
      await window.fbRefreshSession();
      return { customerId };
    } catch (err) {
      // Rollback: remove auth user para evitar conta quebrada (auth sem docs Firestore)
      window._fbSigningUp = false;
      try { await cred.user.delete(); } catch (_) {}
      throw err;
    }
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

  // ---------------- BOOKING PÚBLICO (callable server-side; fallback compatível) ----------------
  window.fbPublicBooking = async function (p) {
    const { doc, collection, getDocs, getDoc, setDoc, query, where, addDoc } = F;
    const tid = p.tenantId;
    if (FN && FB.functions) {
      try {
        const call = FN.httpsCallable(FB.functions, "createPublicBooking");
        const res = await call({
          tenantId: tid, serviceId: p.serviceId, barberId: p.barberId, date: p.date,
          time: p.time, name: p.name, phone: p.phone, email: p.email || "",
          birthday: p.birthday || "",
          customerId: p.customerId || null,
        });
        const data = res.data || {};
        const appointmentId = data.appointmentId;
        if (appointmentId) {
          try {
            const d = DB.get();
            if (!d.appointments) d.appointments = [];
            upsert(d.appointments, {
              id: appointmentId, tenantId: tid, barbershopId: tid,
              customerId: data.customerId || p.customerId || null,
              customerName: p.name, phone: p.phone, serviceId: p.serviceId, barberId: p.barberId,
              date: p.date, time: p.time, duration: p.duration || 30, status: "confirmado",
              price: p.price || 0, source: "public", createdAt: Date.now(),
            });
            DB.save();
          } catch (_) {}
        }
        return { appointmentId };
      } catch (fnErr) {
        const code = fnErr.code || "";
        if (!["functions/unavailable", "unavailable", "internal"].includes(code)) throw fnErr;
        console.warn("[Groomin] createPublicBooking callable indisponível; usando fallback Firestore:", code, fnErr.message);
      }
    }
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
      // query pode falhar com permission-denied para usuários não autenticados (regra só permite leitura por ID)
      try {
        const cq = p.phone
          ? await getDocs(query(collection(FB.db, "tenants", tid, "customers"), where("phone", "==", p.phone)))
          : { empty: true };
        if (!cq.empty) customerId = cq.docs[0].id;
      } catch(_) {}
      if (!customerId) {
        const cRef = await addDoc(collection(FB.db, "tenants", tid, "customers"),
          { tenantId: tid, barbershopId: tid, name: p.name, phone: p.phone || "", whatsapp: p.phone || "", email: p.email || "", birthday: p.birthday || "", notes: "", createdAt: Date.now() });
        customerId = cRef.id;
      } else if (p.birthday) {
        await setDoc(doc(FB.db, "tenants", tid, "customers", customerId), { birthday: p.birthday }, { merge: true });
      }
    }
    const apptPayload = {
      tenantId: tid, barbershopId: tid, customerId, customerName: p.name, phone: p.phone,
      serviceId: p.serviceId, barberId: p.barberId, date: p.date, time: p.time,
      duration: p.duration || 30, status: "confirmado", price: p.price || 0, source: "public", createdAt: Date.now(),
    };
    const appointmentId = publicAppointmentId(tid, p.barberId, p.date, p.time);
    const aRef = doc(FB.db, "tenants", tid, "appointments", appointmentId);
    // tx.get falha com permission-denied quando doc não existe (resource null nas rules).
    // Usamos getDoc+setDoc: as rules distinguem create (slot livre) de update (slot ocupado).
    const existSnap = await getDoc(aRef).catch(() => null);
    if (existSnap && existSnap.exists() && existSnap.data().status !== "cancelado") {
      const e = new Error("já reservado"); e.code = "already-exists"; throw e;
    }
    await setDoc(aRef, apptPayload);
    // Hidrata cache local imediatamente — o onSnapshot do cliente é bloqueado por regras
    // (query de coleção inteira negada para role=customer), então injetamos manualmente.
    try {
      const d = DB.get();
      if (!d.appointments) d.appointments = [];
      upsert(d.appointments, { id: appointmentId, ...apptPayload });
      DB.save();
    } catch (_) {}
    // Notificação em tempo real para o dono e barbeiro atribuído.
    try {
      const barberPart = p.barberName ? ` · ${p.barberName}` : '';
      const svcPart = p.serviceName ? ` — ${p.serviceName}` : '';
      await addDoc(collection(FB.db, 'tenants', tid, 'notifications'), {
        barbershopId: tid,
        barberId: p.barberId,
        type: 'confirm',
        title: 'Novo agendamento',
        msg: `${p.name}${svcPart}${barberPart} · ${p.date} ${p.time}`,
        time: Date.now(),
        read: false,
      });
    } catch (_) {}
    return { appointmentId };
  };
  window.fbGenerateBusinessInsights = async function (tenantId, snapshot) {
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "generateBusinessInsights");
    const res = await call({ tenantId, snapshot });
    return res.data || {};
  };
  const publicAppointmentId = (tid, barberId, date, time) => `public_${tid}_${barberId}_${date}_${time}`;
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

  // busca direta usada como fallback quando onSnapshot não hidrata o cache
  window.fbFetchCustomerCache = async function(uid, tid, customerId) {
    const { doc, getDoc } = F;
    const db = FB.db;
    const d = DB.get();
    if (!d.barbershops.find(x => x.id === tid)) {
      const ts = await getDoc(doc(db, 'tenants', tid));
      if (ts.exists()) { if (!d.barbershops) d.barbershops = []; const i = d.barbershops.findIndex(x => x.id === ts.id); if (i > -1) d.barbershops[i] = {id: ts.id, ...ts.data()}; else d.barbershops.push({id: ts.id, ...ts.data()}); }
    }
    if (customerId && !d.customers?.find(x => x.id === customerId)) {
      const cs = await getDoc(doc(db, 'tenants', tid, 'customers', customerId));
      if (cs.exists()) { if (!d.customers) d.customers = []; const i = d.customers.findIndex(x => x.id === cs.id); if (i > -1) d.customers[i] = {id: cs.id, barbershopId: tid, ...cs.data()}; else d.customers.push({id: cs.id, barbershopId: tid, ...cs.data()}); }
    }
    DB.save();
  };

  // ---------------- LISTENERS (hidratação tempo real) ----------------
  async function startListeners(user) {
    const { collection, onSnapshot, doc, query: qry, where: whr } = F;
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
      // Fallback getDoc imediato: garante que a barbearia carrega mesmo se onSnapshot falhar
      const { getDoc: _getDoc } = F;
      _getDoc(doc(FB.db, "tenants", tid)).then((d) => {
        if (d.exists() && !data.barbershops.find((x) => x.id === tid)) {
          upsert(data.barbershops, { id: d.id, ...d.data() }); DB.save(); render();
        }
      }).catch((e) => console.warn("[Groomin] getDoc tenant fallback:", e.code));
      FB.unsubs.push(onSnapshot(doc(FB.db, "tenants", tid), (d) => {
        if (d.exists()) { upsert(data.barbershops, { id: d.id, ...d.data() }); DB.save(); render(); }
      }, (e) => { console.warn("[Groomin] onSnapshot tenant falhou:", e.code, e.message); }));
      if (user.role === "customer") {
        // Services e barbers: leitura pública, query de coleção OK
        ["services", "barbers"].forEach((c) => bindColl(["tenants", tid, c], c, tid));
        // Appointments: query filtrada por customerId — regras negam query de coleção inteira para clientes
        const apptQ = qry(collection(FB.db, "tenants", tid, "appointments"), whr("customerId", "==", user.customerId));
        FB.unsubs.push(onSnapshot(apptQ, (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, barbershopId: tid, ...d.data() }));
          data.appointments = mergeOther(data.appointments, arr, tid);
          DB.save(); render();
        }, (e) => { console.warn("[Groomin] onSnapshot customer appointments:", e.code, e.message); }));
      } else {
        TENANT_COLLS.filter((c) => c !== "notifications").forEach((c) => bindColl(["tenants", tid, c], c, tid));
      }
      if (user.role !== "customer") {
        // Notificações: handler especial — mostra toast e ponto no sino para itens novos.
        let _notifLoaded = false;
        FB.unsubs.push(onSnapshot(collection(FB.db, "tenants", tid, "notifications"), (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, barbershopId: tid, ...d.data() }));
          data["notifications"] = mergeOther(data["notifications"], arr, tid);
          DB.save();
          if (_notifLoaded) {
            snap.docChanges().forEach((ch) => {
              if (ch.type === "added") {
                const n = ch.doc.data();
                if (window.toast) toast((n.title || "Notificação") + ": " + (n.msg || ""), "info");
                const dot = document.getElementById("notifDot");
                if (dot) dot.style.display = "block";
              }
            });
          }
          _notifLoaded = true;
          render();
        }, () => {}));
      }
      if (user.role !== "customer") {
        FB.unsubs.push(onSnapshot(doc(FB.db, "subscriptions", tid), (d) => {
          if (d.exists()) { upsert(data.subscriptions, { id: d.id, barbershopId: tid, ...d.data() }); DB.save(); render(); }
        }, () => {}));
      }
      if (user.role === "customer" && user.customerId) {
        const custRef = doc(FB.db, "tenants", tid, "customers", user.customerId);
        // Fallback imediato: carrega customer doc sem esperar onSnapshot
        F.getDoc(custRef).then((d) => {
          if (d.exists()) {
            if (!data.customers) data.customers = [];
            upsert(data.customers, { id: d.id, barbershopId: tid, ...d.data() });
            DB.save();
          }
          render(); // sempre renderiza — renderCustomer trata dado ausente
        }).catch((e) => { console.warn("[Groomin] getDoc customer fallback:", e.code); render(); });
        FB.unsubs.push(onSnapshot(custRef, (d) => {
          if (d.exists()) {
            if (!data.customers) data.customers = [];
            upsert(data.customers, { id: d.id, barbershopId: tid, ...d.data() });
            DB.save(); render();
          }
        }, (e) => { console.warn("[Groomin] onSnapshot customer falhou:", e.code, e.message); }));
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
