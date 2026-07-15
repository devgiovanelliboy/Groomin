/* ============================================================
   Groomin — Adaptador Firebase (Auth + Firestore + Storage + Functions)
   ------------------------------------------------------------
   - Papel/tenant vêm do documento /users/{uid}; Functions espelham custom claims.
   - Cadastro do dono cria tenant + slug + dados iniciais no cliente.
   - Página pública carrega dados de forma anônima por slug.
   - Tempo real (onSnapshot) hidrata o cache `DB`; UI re-renderiza sozinha.
   - Dados do negócio vêm do Firestore em tempo real, sem cache persistente local.
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
  let readyPromise = null;
  let renderTimer = null;
  let hydrationRenderUntil = 0;
  let hydrationActive = false;

  const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

  async function load() {
    // Imports em paralelo: em conexão móvel cada await sequencial adicionava um round-trip
    const wantAppCheck = window.FIREBASE_APPCHECK_SITE_KEY && !IS_LOCAL;
    const [appMod, a, f, fn, ac, st] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js"),
      import(SDK + "firebase-functions.js"),
      wantAppCheck ? import(SDK + "firebase-app-check.js") : null,
      cfg.storageBucket ? import(SDK + "firebase-storage.js") : null,
    ]);
    A = a; F = f; FN = fn;
    FB.app = appMod.initializeApp(cfg);
    FB.auth = A.getAuth(FB.app);
    FB.functions = FN.getFunctions(FB.app, "us-central1");
    if (ac) {
      AC = ac;
      const Provider = AC.ReCaptchaEnterpriseProvider || AC.ReCaptchaV3Provider;
      AC.initializeAppCheck(FB.app, {
        provider: new Provider(window.FIREBASE_APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      FB.appCheck = true;
    }
    if (st) {
      ST = st;
      FB.storage = ST.getStorage(FB.app);
    }
    try {
      FB.db = F.initializeFirestore(FB.app, {
        localCache: F.memoryLocalCache(),
      });
    } catch (e) { FB.db = F.getFirestore(FB.app); }
    if (IS_LOCAL) {
      A.connectAuthEmulator(FB.auth, "http://localhost:9099", { disableWarnings: true });
      F.connectFirestoreEmulator(FB.db, "localhost", 8080);
      FN.connectFunctionsEmulator(FB.functions, "localhost", 5001);
      console.log("[Groomin] Emulator mode: auth:9099 firestore:8080 functions:5001");
    }
    wireWriteThrough();
    A.onAuthStateChanged(FB.auth, onAuth);
  }

  async function ensureReady() {
    if (readyPromise) await readyPromise;
    if (!F || !FB.db) throw new Error("Firebase ainda não inicializou.");
  }

  window.fbUploadTenantImage = async function (tid, kind, file, oldPath) {
    await ensureReady();
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
    const meta = { contentType: file.type || "image/jpeg", customMetadata: { tenantId: tid, kind } };
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ST.uploadBytes(ref, file, meta);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const code = String(err && err.code || "");
        if (!/unauthorized|permission-denied|retry-limit-exceeded/.test(code) || attempt === 3) break;
        await new Promise(resolve => setTimeout(resolve, 450 + attempt * 450));
      }
    }
    if (lastErr) throw lastErr;
    const url = await ST.getDownloadURL(ref);
    if (oldPath && oldPath !== path) window.fbDeleteStoragePath(oldPath).catch(() => {});
    return { url, path };
  };

  window.fbDeleteStoragePath = async function (path) {
    await ensureReady();
    if (!path || !ST || !FB.storage) return;
    if (!String(path).startsWith("tenants/")) return;
    await ST.deleteObject(ST.ref(FB.storage, path));
  };

  window.fbSaveTenantProfile = async function (tid, data) {
    await ensureReady();
    await F.setDoc(F.doc(FB.db, "tenants", tid), clean(data || {}), { merge: true });
  };
  // Registra token de push (FCM) no doc do usuário; a function de booking lê daqui.
  window.fbSavePushToken = async function (token) {
    await ensureReady();
    const user = FB.auth.currentUser;
    if (!user || !token) return;
    await F.setDoc(F.doc(FB.db, "users", user.uid), {
      fcmTokens: F.arrayUnion(token), fcmUpdatedAt: Date.now(),
    }, { merge: true });
  };
  window.fbLoadPlatformSettings = async function () {
    await ensureReady();
    const snap = await F.getDoc(F.doc(FB.db, "platformSettings", "plans"));
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const db = DB.get();
    db.settings = db.settings || {};
    db.settings.publicPlans = { ...(db.settings.publicPlans || {}), ...(data.publicPlans || {}) };
    DB.save();
    return data;
  };
  window.fbSavePlatformPlanSettings = async function (publicPlans) {
    await ensureReady();
    await F.setDoc(F.doc(FB.db, "platformSettings", "plans"), { publicPlans: clean(publicPlans || {}), updatedAt: Date.now() }, { merge: true });
    const db = DB.get();
    db.settings = db.settings || {};
    db.settings.publicPlans = { ...(db.settings.publicPlans || {}), ...(publicPlans || {}) };
    DB.save();
  };
  function isAppShellRoute() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/app" || path.startsWith("/app/") || path === "/admin" || path.startsWith("/admin/")) return true;
    const h = location.hash || "";
    return /^#\/(admin|dashboard|my-schedule|my-appointments|login|signup|verify-email|stripe)(\/|$)/.test(h);
  }

  // ---------------- AUTH (sem claims: lê /users/{uid}) ----------------
  async function onAuth(user) {
    stopListeners();
    if (!user) { sessionStorage.removeItem("groomin_user"); if (!window._fbSigningUp) render(true); return; }
    let su = await buildSession(user);
    if (!su) { if (!window._fbSigningUp) render(true); return; } // doc ainda não existe (cadastro em andamento)
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
    await ensureOwnerTenantDefaults(su);
    await startListeners(su);
    const intended = sessionStorage.getItem("groomin_intended");
    sessionStorage.removeItem("groomin_intended");
    if (window.homeRouteFor && intended && intended.length) { location.hash = intended; render(true); }
    else if (window.homeRouteFor && isAppShellRoute()) { location.hash = homeRouteFor(su.role); render(true); }
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
  async function ensureOwnerTenantDefaults(su) {
    if (!su || su.role !== "owner" || !su.barbershopId || !F || !FB.db) return;
    const tid = su.barbershopId;
    try {
      const { collection, getDocs, addDoc } = F;
      const data = DB.get();
      const serviceSnap = await getDocs(collection(FB.db, "tenants", tid, "services"));
      if (serviceSnap.empty) {
        const payload = {
          tenantId: tid, barbershopId: tid, name: "Corte Masculino", desc: "Serviço inicial.",
          price: 45, duration: 30, category: "Serviços", icon: "scissors", active: true,
        };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "services"), payload);
        data.services = mergeOther(data.services, [{ id: ref.id, ...payload }], tid);
      }
      const barberSnap = await getDocs(collection(FB.db, "tenants", tid, "barbers"));
      if (barberSnap.empty) {
        const shop = DB.find("barbershops", tid) || {};
        const payload = {
          tenantId: tid, barbershopId: tid, name: su.name || shop.ownerName || "Profissional",
          role: "Profissional", photoUrl: "", photoPath: "", bio: "", phone: shop.phone || "",
          email: su.email || shop.email || "", specialties: [], commission: 0, productCommission: 0,
          isOwner: true, start: shop.open || "09:00", end: shop.close || "19:00",
          lunchStart: shop.lunchStart || "12:00", lunchEnd: shop.lunchEnd || "13:00",
          days: Array.isArray(shop.workDays) && shop.workDays.length ? shop.workDays : [1, 2, 3, 4, 5, 6],
          vacations: [], active: true, rating: 5,
        };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "barbers"), payload);
        data.barbers = mergeOther(data.barbers, [{ id: ref.id, ...payload }], tid);
      }
      DB.save();
    } catch (e) {
      console.warn("[Groomin] ensureOwnerTenantDefaults falhou:", e.code || "", e.message || e);
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
      emailVerified: user.emailVerified || false,
    };
    if (su.role === "customer") {
      try {
        const linksSnap = await F.getDocs(F.collection(FB.db, "users", user.uid, "customerLinks"));
        su.customerLinks = linksSnap.docs.map((l) => ({ tenantId: l.id, ...l.data() }));
      } catch (_) { su.customerLinks = []; }
    }
    console.log("[Groomin] buildSession ok:", su.role, "tid:", su.barbershopId, "cid:", su.customerId);
    sessionStorage.setItem("groomin_user", JSON.stringify(su));
    return su;
  }
  window.fbRefreshSession = async function () {
    const u = FB.auth.currentUser; if (!u) return;
    try { await u.getIdToken(true); } catch (_) {}
    const su = await buildSession(u);
    if (su) { stopListeners(); await startListeners(su); location.hash = homeRouteFor(su.role); render(true); }
  };
  window.fbSignIn = (email, password) => A.signInWithEmailAndPassword(FB.auth, email, password);
  function googleProvider() {
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }
  async function signInGoogle(markSignup) {
    await ensureReady();
    if (markSignup) window._fbSigningUp = true;
    try {
      const cred = await A.signInWithPopup(FB.auth, googleProvider());
      return {
        uid: cred.user.uid,
        email: cred.user.email || "",
        name: cred.user.displayName || "",
        emailVerified: !!cred.user.emailVerified,
        provider: "google",
      };
    } catch (err) {
      if (markSignup) window._fbSigningUp = false;
      throw err;
    }
  }
  window.fbSignInWithGoogle = () => signInGoogle(false);
  window.fbCreateAuthAccountWithGoogle = () => signInGoogle(true);
  window.fbGetCurrentSession = async function () {
    await ensureReady();
    const u = FB.auth.currentUser;
    return u ? buildSession(u) : null;
  };
  window.fbSignOut = () => A.signOut(FB.auth);
  function authActionUrl(path) {
    const origin = location.origin && location.origin !== "null"
      ? location.origin
      : `https://${cfg.authDomain || "groomin-952d0.web.app"}`;
    return `${origin}${path || "/app/#/login"}`;
  }
  window.fbSendPasswordReset = async function (email) {
    await ensureReady();
    // E-mail próprio via Resend (pt-BR, remetente mail.groomin.com.br — não cai no spam).
    // Fallback: e-mail padrão do Firebase Auth se a function estiver indisponível.
    if (FN && FB.functions) {
      try {
        const call = FN.httpsCallable(FB.functions, "sendPasswordReset");
        await call({ email });
        return;
      } catch (err) {
        const code = String((err && err.code) || "");
        if (/resource-exhausted|invalid-argument/.test(code)) throw err;
        console.warn("[Groomin] sendPasswordReset function falhou, usando fallback:", code, err && err.message);
      }
    }
    await A.sendPasswordResetEmail(FB.auth, email, {
      url: authActionUrl("/app/#/login"),
      handleCodeInApp: false,
    });
  };
  window.fbCreateStripeCheckout = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "createStripeCheckout");
    const res = await call(payload || {});
    return res.data || {};
  };

  window.fbConfirmStripeCheckout = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "confirmStripeCheckout");
    const res = await call(payload || {});
    return res.data || {};
  };

  window.fbCancelSubscription = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "cancelSubscription");
    const res = await call(payload || {});
    return res.data || {};
  };

  window.fbChangePlan = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "changePlan");
    const res = await call(payload || {});
    return res.data || {};
  };

  window.fbToggleCourtesyPlan = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "toggleCourtesyPlan");
    const res = await call(payload || {});
    return res.data || {};
  };
  window.fbAdminDeleteTenant = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "adminDeleteTenant");
    const res = await call(payload || {});
    return res.data || {};
  };
  window.fbAdminUpdateOwnerProfile = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "adminUpdateOwnerProfile");
    const res = await call(payload || {});
    return res.data || {};
  };
  window.fbUpdateOwnProfile = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "updateOwnProfile");
    const res = await call(payload || {});
    return res.data || {};
  };

  // --- Criar conta Auth apenas (sem empresa) — novo fluxo com OTP ---
  // _fbSigningUp permanece true até fbCompleteOwnerSetup concluir ou o usuário cancelar
  window.fbCreateAuthAccount = async function (email, password, displayName) {
    await ensureReady();
    window._fbSigningUp = true;
    try {
      const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
      if (displayName) await A.updateProfile(cred.user, { displayName });
      return { uid: cred.user.uid };
    } catch (err) {
      window._fbSigningUp = false;
      throw err;
    }
  };

  window.fbCurrentUser = function () { return FB.auth ? FB.auth.currentUser : null; };

  // --- Enviar OTP de verificação ---
  window.fbSendVerificationCode = async function () {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "sendVerificationCode");
    const res = await call({});
    return res.data || {};
  };

  // --- Verificar código OTP ---
  window.fbVerifyEmailCode = async function (code) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "verifyEmailCode");
    const res = await call({ code: String(code) });
    return res.data || {};
  };

  window.fbSendSignupVerificationCode = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "sendSignupVerificationCode");
    const res = await call(payload || {});
    return res.data || {};
  };

  window.fbVerifySignupEmailCode = async function (payload) {
    await ensureReady();
    if (!FN || !FB.functions) throw new Error("Functions indisponível.");
    const call = FN.httpsCallable(FB.functions, "verifySignupEmailCode");
    const res = await call(payload || {});
    return res.data || {};
  };

  // --- Recarregar usuário (reflete emailVerified após verificação) ---
  window.fbReloadUser = async function () {
    if (FB.auth && FB.auth.currentUser) await FB.auth.currentUser.reload();
  };

  // --- Deletar conta atual (para fluxo "Alterar e-mail") ---
  window.fbDeleteCurrentUser = async function () {
    const u = FB.auth && FB.auth.currentUser;
    if (u) await u.delete();
  };

  // --- Finalizar cadastro do dono (usuário já autenticado via OTP) ---
  window.fbCompleteOwnerSetup = async function ({ shopName, ownerName, phone, whatsapp, address, slugOverride, planId, category, themeId, instagram, timezone, hours, orderLeadDays, professionals, services, logoFile, coverFile, emailVerificationSkipped, emailVerificationSkippedReason }) {
    await ensureReady();
    const currentUser = FB.auth && FB.auth.currentUser;
    if (!currentUser) throw new Error("Usuário não autenticado. Faça login para continuar.");
    window._fbSigningUp = true;
    const email = currentUser.email || "";
    const allowedPlans = ["trial", "free", "monthly", "annual", "founder"];
    const pid = allowedPlans.includes(planId) ? planId : "trial";
    const billingPlanId = pid === "trial" ? "free" : pid;
    const isTrial = pid === "trial";
    if (ownerName) await A.updateProfile(currentUser, { displayName: ownerName });
    const uid = currentUser.uid;
    const { doc, collection, setDoc, addDoc, getDoc } = F;
    const slugifyStr = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tRef = doc(collection(FB.db, "tenants"));
    const tid = tRef.id;
    const plan = (typeof DB !== "undefined" && DB.find) ? DB.find("plans", billingPlanId) : null;
    const mrr = billingPlanId === "annual" ? 12.66 : billingPlanId === "founder" ? 0 : plan ? (plan.price || 0) : 0;
    const nowMs = Date.now();
    const emailVerificationPatch = emailVerificationSkipped ? {
      emailVerified: false,
      emailVerificationStatus: "skipped_provider_not_configured",
      emailVerificationSkipped: true,
      emailVerificationSkippedReason: emailVerificationSkippedReason || "email_provider_not_configured",
      emailVerificationSkippedAt: nowMs,
    } : {
      emailVerified: true,
      emailVerificationStatus: "verified",
    };
    let base = slugifyStr(slugOverride || shopName) || "barbearia", slug = base, n = 1;
    while ((await getDoc(doc(FB.db, "slugs", slug))).exists()) slug = base + "-" + (++n);
    try {
      const h = hours || {};
      const tenantPayload = {
        name: shopName, slug, ownerName: ownerName || "", ownerUid: uid,
        description: "", logoUrl: "", logoPath: "",
        category: category || "barbershop", themeId: themeId || "",
        phone: phone || "", whatsapp: whatsapp || phone || "",
        email, address: address || "", city: "", neighborhood: "", instagram: instagram || "",
        open: h.open || "09:00", close: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
        workDays: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6],
        orderLeadDays: Math.max(0, Math.min(30, +orderLeadDays || 0)),
        timezone: timezone || "America/Sao_Paulo",
        slotInterval: 30, status: "active", planId: billingPlanId, freeBookingLimit: billingPlanId === "free" ? 3 : null, rating: 0, createdAt: nowMs,
        ...emailVerificationPatch,
      };
      await setDoc(tRef, tenantPayload);
      const userRef = doc(FB.db, "users", uid);
      await setDoc(userRef, { name: ownerName || "Dono", email, role: "owner", tenantId: tid, active: true, createdAt: nowMs, ...emailVerificationPatch }, { merge: true });
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) throw new Error("Perfil do dono não foi criado no Firestore.");
      await setDoc(doc(FB.db, "slugs", slug), { tenantId: tid, createdAt: nowMs });
      const subPayload = {
        tenantId: tid, planId: billingPlanId, status: billingPlanId === "free" ? "trialing" : "active",
        mrr, startedAt: nowMs, trialStartedAt: isTrial ? nowMs : null, trialEndsAt: null,
        freeBookingLimit: billingPlanId === "free" ? 3 : null,
        paymentMethodRequired: billingPlanId !== "free",
        paymentMethodStatus: billingPlanId === "free" ? "not_required" : "checkout_started",
        renewsAt: billingPlanId === "free" ? null : nowMs + (billingPlanId === "annual" ? 365 : billingPlanId === "founder" ? 36500 : 30) * 86400000,
      };
      await setDoc(doc(FB.db, "subscriptions", tid), subPayload);
      const mediaPatch = {};
      try {
        if (logoFile && window.fbUploadTenantImage) { const up = await window.fbUploadTenantImage(tid, "logos", logoFile); mediaPatch.logoUrl = up.url; mediaPatch.logoPath = up.path; }
        if (coverFile && window.fbUploadTenantImage) { const up = await window.fbUploadTenantImage(tid, "covers", coverFile); mediaPatch.coverUrl = up.url; mediaPatch.coverPath = up.path; }
        if (Object.keys(mediaPatch).length) await setDoc(tRef, mediaPatch, { merge: true });
      } catch (mediaErr) {
        console.warn("[Groomin] upload de imagem falhou:", mediaErr.code || "", mediaErr.message || mediaErr);
        if (window.toast) toast(mediaUploadMsg(mediaErr), "err");
      }
      Object.assign(tenantPayload, mediaPatch);
      const svcList = Array.isArray(services) && services.length ? services : [{ name: "Corte Masculino", price: 45, duration: 30, category: "Serviços" }];
      const createdServices = [];
      for (const s of svcList) {
        const payload = { tenantId: tid, barbershopId: tid, name: s.name || "Serviço", desc: s.desc || "", price: Number(s.price || 0), duration: Number(s.duration || 30), category: s.category || "Serviços", icon: s.icon || "scissors", active: true };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "services"), payload);
        createdServices.push({ id: ref.id, ...payload });
      }
      const barberList = Array.isArray(professionals) && professionals.length ? professionals : [{ name: ownerName || "Profissional", role: "Profissional" }];
      const createdBarbers = [];
      for (const b of barberList) {
        const payload = {
          tenantId: tid, barbershopId: tid, name: b.name || ownerName || "Profissional",
          role: b.role || "Profissional", photoUrl: "", photoPath: "", bio: b.bio || "", phone: b.phone || phone || "", email: b.email || email,
          specialties: b.specialties || [], commission: 0, productCommission: 0, isOwner: !!b.isOwner,
          start: h.open || "09:00", end: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
          days: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6], vacations: [], active: true, rating: 5,
        };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "barbers"), payload);
        if (b.photoFile && b.photoFile.size && window.fbUploadTenantImage) {
          try {
            const up = await window.fbUploadTenantImage(tid, "barbers", b.photoFile);
            payload.photoUrl = up.url; payload.photoPath = up.path;
            await setDoc(ref, { photoUrl: up.url, photoPath: up.path }, { merge: true });
          } catch (e) { console.warn("[Groomin] foto do profissional falhou:", e.code || "", e.message || e); }
        }
        createdBarbers.push({ id: ref.id, ...payload });
      }
      hydrateSignupCache(tid, tenantPayload, subPayload, createdServices, createdBarbers);
    } catch (err) {
      window._fbSigningUp = false;
      throw err;
    }
    window._fbSigningUp = false;
    await window.fbRefreshSession();
    return { tenantId: tid, slug };
  };

  // ---------------- CADASTRO DO DONO (bootstrap no cliente) ----------------
  window.fbSignUpOwner = async function ({ shopName, ownerName, email, password, phone, whatsapp, address, slugOverride, planId, category, themeId, instagram, timezone, hours, orderLeadDays, professionals, services, logoFile, coverFile, emailVerificationSkipped, emailVerificationSkippedReason }) {
    await ensureReady();
    window._fbSigningUp = true;
    const allowedPlans = ["trial", "free", "monthly", "annual", "founder"];
    const pid = allowedPlans.includes(planId) ? planId : "trial";
    const billingPlanId = pid === "trial" ? "free" : pid;
    const isTrial = pid === "trial";
    const cred = await A.createUserWithEmailAndPassword(FB.auth, email, password);
    if (ownerName) await A.updateProfile(cred.user, { displayName: ownerName });
    const uid = cred.user.uid;
    const { doc, collection, setDoc, addDoc, getDoc } = F;

    const slugifyStr = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const tRef = doc(collection(FB.db, "tenants"));
    const tid = tRef.id;
    const plan = (typeof DB !== "undefined" && DB.find) ? DB.find("plans", billingPlanId) : null;
    const mrr = billingPlanId === "annual" ? 12.66 : billingPlanId === "founder" ? 0 : plan ? (plan.price || 0) : 0;
    const nowMs = Date.now();
    const emailVerificationPatch = emailVerificationSkipped ? {
      emailVerified: false,
      emailVerificationStatus: "skipped_provider_not_configured",
      emailVerificationSkipped: true,
      emailVerificationSkippedReason: emailVerificationSkippedReason || "email_provider_not_configured",
      emailVerificationSkippedAt: nowMs,
    } : {
      emailVerified: true,
      emailVerificationStatus: "verified",
    };

    // slug único (só leituras — regra de escrita do slug exige tenant existir primeiro)
    let base = slugifyStr(slugOverride || shopName) || "barbearia", slug = base, n = 1;
    while ((await getDoc(doc(FB.db, "slugs", slug))).exists()) slug = base + "-" + (++n);

    try {
      // tenant primeiro; em seguida criamos o /users/{uid}, pois subcoleções e Storage
      // dependem de mgrOf(tid), que é calculado a partir desse documento.
      const h = hours || {};
      const tenantPayload = {
        name: shopName, slug, ownerName: ownerName || "", ownerUid: uid,
        description: "", logoUrl: "", logoPath: "",
        category: category || "barbershop",
        themeId: themeId || "",
        phone: phone || "", whatsapp: whatsapp || phone || "",
        email, address: address || "", city: "", neighborhood: "", instagram: instagram || "",
        open: h.open || "09:00", close: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
        workDays: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6],
        orderLeadDays: Math.max(0, Math.min(30, +orderLeadDays || 0)),
        timezone: timezone || "America/Sao_Paulo",
        slotInterval: 30, status: "active", planId: billingPlanId, freeBookingLimit: billingPlanId === "free" ? 3 : null, rating: 0, createdAt: nowMs,
        ...emailVerificationPatch,
      };
      await setDoc(tRef, tenantPayload);

      const userRef = doc(FB.db, "users", uid);
      await setDoc(userRef, {
        name: ownerName || "Dono", email, role: "owner", tenantId: tid, active: true, createdAt: Date.now(), ...emailVerificationPatch,
      });
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) throw new Error("Perfil do dono não foi criado no Firestore.");

      // slug depois do tenant (regra valida tenant.ownerUid == uid)
      await setDoc(doc(FB.db, "slugs", slug), { tenantId: tid, createdAt: Date.now() });

      const subPayload = {
        tenantId: tid, planId: billingPlanId,
        status: billingPlanId === "free" ? "trialing" : "active",
        mrr, startedAt: nowMs,
        trialStartedAt: isTrial ? nowMs : null,
        trialEndsAt: null,
        freeBookingLimit: billingPlanId === "free" ? 3 : null,
        paymentMethodRequired: billingPlanId !== "free",
        paymentMethodStatus: billingPlanId === "free" ? "not_required" : "checkout_started",
        renewsAt: billingPlanId === "free" ? null : nowMs + (billingPlanId === "annual" ? 365 : billingPlanId === "founder" ? 36500 : 30) * 86400000,
      };
      await setDoc(doc(FB.db, "subscriptions", tid), subPayload);

      const mediaPatch = {};
      try {
        if (logoFile && window.fbUploadTenantImage) {
          const up = await window.fbUploadTenantImage(tid, "logos", logoFile);
          mediaPatch.logoUrl = up.url; mediaPatch.logoPath = up.path;
        }
        if (coverFile && window.fbUploadTenantImage) {
          const up = await window.fbUploadTenantImage(tid, "covers", coverFile);
          mediaPatch.coverUrl = up.url; mediaPatch.coverPath = up.path;
        }
        if (Object.keys(mediaPatch).length) await setDoc(tRef, mediaPatch, { merge: true });
      } catch (mediaErr) {
        console.warn("[Groomin] upload de imagem falhou no cadastro:", mediaErr.code || "", mediaErr.message || mediaErr);
        if (window.toast) toast(mediaUploadMsg(mediaErr), "err");
      }
      Object.assign(tenantPayload, mediaPatch);

      const svcList = Array.isArray(services) && services.length ? services : [{ name: "Corte Masculino", price: 45, duration: 30, category: "Serviços" }];
      const createdServices = [];
      for (const s of svcList) {
        const payload = {
          tenantId: tid, barbershopId: tid, name: s.name || "Serviço", desc: s.desc || "",
          price: Number(s.price || 0), duration: Number(s.duration || 30), category: s.category || "Serviços", icon: s.icon || "scissors", active: true,
        };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "services"), payload);
        createdServices.push({ id: ref.id, ...payload });
      }
      const barberList = Array.isArray(professionals) && professionals.length ? professionals : [{ name: ownerName || "Profissional", role: "Profissional" }];
      const createdBarbers = [];
      for (const b of barberList) {
        const payload = {
          tenantId: tid, barbershopId: tid, name: b.name || ownerName || "Profissional",
          role: b.role || "Profissional", photoUrl: "", photoPath: "", bio: b.bio || "", phone: b.phone || phone || "", email: b.email || email,
          specialties: b.specialties || [], commission: 0, productCommission: 0, isOwner: !!b.isOwner,
          start: h.open || "09:00", end: h.close || "19:00", lunchStart: h.lunchStart || "12:00", lunchEnd: h.lunchEnd || "13:00",
          days: Array.isArray(h.days) && h.days.length ? h.days : [1, 2, 3, 4, 5, 6], vacations: [], active: true, rating: 5,
        };
        const ref = await addDoc(collection(FB.db, "tenants", tid, "barbers"), payload);
        if (b.photoFile && b.photoFile.size && window.fbUploadTenantImage) {
          try {
            const up = await window.fbUploadTenantImage(tid, "barbers", b.photoFile);
            payload.photoUrl = up.url; payload.photoPath = up.path;
            await setDoc(ref, { photoUrl: up.url, photoPath: up.path }, { merge: true });
          } catch (e) { console.warn("[Groomin] foto do profissional falhou:", e.code || "", e.message || e); }
        }
        createdBarbers.push({ id: ref.id, ...payload });
      }
      hydrateSignupCache(tid, tenantPayload, subPayload, createdServices, createdBarbers);
    } catch (err) {
      window._fbSigningUp = false;
      try { await cred.user.delete(); } catch (_) {}
      throw err;
    }
    window._fbSigningUp = false;
    await window.fbRefreshSession();
    return { tenantId: tid, slug };
  };

  function hydrateSignupCache(tid, tenantPayload, subPayload, services, barbers) {
    try {
      const data = DB.get();
      upsert(data.barbershops, { id: tid, ...tenantPayload });
      upsert(data.subscriptions, { id: tid, barbershopId: tid, ...subPayload });
      data.services = mergeOther(data.services, services || [], tid);
      data.barbers = mergeOther(data.barbers, barbers || [], tid);
      DB.save();
    } catch (e) {
      console.warn("[Groomin] hydrateSignupCache falhou:", e.message || e);
    }
  }
  function mediaUploadMsg(err) {
    const c = (err && err.code) || "";
    if (c === "storage-not-configured") return "Página criada, mas o Storage não está configurado para enviar logo/capa.";
    if (c === "image-too-large") return "Página criada, mas a imagem passa de 5MB.";
    if (c === "invalid-image") return "Página criada, mas o arquivo enviado não é uma imagem válida.";
    if (/unauthorized|permission-denied/.test(c)) return "Página criada, mas o envio da logo/capa foi bloqueado pelo Storage.";
    return "Página criada, mas não foi possível enviar logo/capa.";
  }

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
  window.fbSwitchCustomerShop = async function (tenantId) {
    const user = FB.auth.currentUser;
    if (!user) throw new Error("Não autenticado.");
    const { doc, getDoc } = F;
    const linkSnap = await getDoc(doc(FB.db, "users", user.uid, "customerLinks", tenantId));
    if (!linkSnap.exists()) throw new Error("Barbearia não vinculada.");
    const link = linkSnap.data();
    const su = JSON.parse(sessionStorage.getItem("groomin_user") || "{}");
    const next = { ...su, barbershopId: tenantId, customerId: link.customerId };
    sessionStorage.setItem("groomin_user", JSON.stringify(next));
    stopListeners(); await startListeners(next); render(true);
  };
  window.fbEnsureCustomerLink = async function (tenantId, profile) {
    const user = FB.auth.currentUser;
    if (!user) throw new Error("Faça login para vincular esta barbearia.");
    const su = await buildSession(user);
    if (!su || su.role !== "customer") throw new Error("Conta de cliente inválida.");
    const next = await activateCustomerTenant(user, su, tenantId, profile || null);
    stopListeners(); await startListeners(next); render(true);
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
    await ensureReady();
    const { doc, getDoc, getDocs, collection } = F;
    // platformSettings em paralelo com o slug — nenhum depende do outro
    const settingsP = window.fbLoadPlatformSettings().catch(() => {});
    const slugSnap = await getDoc(doc(FB.db, "slugs", slug));
    if (!slugSnap.exists()) { await settingsP; return false; }
    const tid = slugSnap.data().tenantId;
    // tenant + subcoleções em paralelo: só dependem do tid, não umas das outras
    const collNames = ["services", "barbers", "reviews", "blocks"];
    const [tSnap, ...collSnaps] = await Promise.all([
      getDoc(doc(FB.db, "tenants", tid)),
      ...collNames.map((name) => getDocs(collection(FB.db, "tenants", tid, name))),
    ]);
    await settingsP;
    if (!tSnap.exists()) return false;
    const data = DB.get();
    upsert(data.barbershops, { id: tid, ...tSnap.data() });
    collNames.forEach((name, i) => {
      const arr = collSnaps[i].docs.map((d) => ({ id: d.id, barbershopId: tid, ...d.data() }));
      data[name] = mergeOther(data[name], arr, tid);
    });
    DB.save();
    return true;
  };

  // ---------------- BOOKING PÚBLICO (somente callable server-side em produção) ----------------
  window.fbPublicBooking = async function (p) {
    await ensureReady();
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
        console.warn("[Groomin] createPublicBooking falhou:", fnErr.code || "", fnErr.message || fnErr);
        throw fnErr;
      }
    }
    const e = new Error("Serviço de agendamento temporariamente indisponível.");
    e.code = "functions-unavailable";
    throw e;
  };
  // busca direta usada como fallback quando onSnapshot não hidrata o cache
  window.fbFetchCustomerCache = async function(uid, tid, customerId) {
    await ensureReady();
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
    hydrationActive = true;
    hydrationRenderUntil = Date.now() + 2600;
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
      bindColl(["adminActions"], "adminActions");
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
      } catch (e) {
        console.warn("[FB write]", coll, e.code || "", e.message || e);
        if (window.toast) toast("Não foi possível salvar na nuvem. Recarregue e tente novamente.", "err");
      }
    };
  }
  function pathFor(coll, obj) {
    if (TENANT_COLLS.includes(coll)) { const tid = obj.barbershopId; return tid ? F.doc(FB.db, "tenants", tid, coll, obj.id) : null; }
    if (coll === "barbershops") return F.doc(FB.db, "tenants", obj.id);
    if (coll === "subscriptions") return F.doc(FB.db, "subscriptions", obj.barbershopId || obj.id);
    if (coll === "invoices") return F.doc(FB.db, "invoices", obj.id);
    if (coll === "auditLogs") return F.doc(FB.db, "auditLogs", obj.id);
    if (coll === "adminActions") return F.doc(FB.db, "adminActions", obj.id);
    if (coll === "users") return F.doc(FB.db, "users", obj.uid || obj.id);
    return null; // users/plans/settings: fora do write-through automático
  }
  function clean(o) { const r = {}; Object.keys(o).forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
  function mergeOther(prev, incoming, tid) { return (prev || []).filter((x) => x.barbershopId !== tid).concat(incoming); }
  function upsert(arr, obj) { const i = arr.findIndex((x) => x.id === obj.id); if (i > -1) arr[i] = obj; else arr.push(obj); }
  function render(force) {
    if (!window.Router || !location.hash) return;
    if (!force && hydrationActive) {
      clearTimeout(renderTimer);
      const due = Date.now() > hydrationRenderUntil ? 0 : 320;
      renderTimer = setTimeout(() => {
        hydrationActive = false;
        Router.render({ preserveScroll: true, preserveUi: true });
      }, due);
      return;
    }
    if (!force) {
      if (typeof renderShellNotif === "function") {
        try { renderShellNotif(); } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent("groomin:data", { detail: { source: "firebase" } }));
      return;
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => Router.render({ preserveScroll: !force, preserveUi: !force }), force ? 0 : 260);
  }

  readyPromise = load().catch((e) => {
    console.error("[Groomin] Firebase indisponível, modo local:", e);
    window.__FB_ENABLED = false;
    if (window.toast) toast("Sem conexão com o Firebase — rodando local.", "err");
    render(true);
    throw e;
  });
  readyPromise.catch(() => {});
})();
