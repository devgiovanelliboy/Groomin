/* ============================================================
   Groomin — Configuração do Firebase (cliente)
   Projeto: groomin-952d0
   Config obtida via `firebase apps:sdkconfig WEB`.
   ------------------------------------------------------------
   Modo TESTE (plano grátis Spark, SEM Cloud Functions):
   papel/tenant ficam no documento /users/{uid} e as regras usam get().
   Para desligar o backend e voltar ao modo demo local:
   troque USE_FIREBASE para false.
   ============================================================ */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCABD-0pmi8ihRSjtv0hXH61HIMzzOv1uE",
  authDomain: "groomin-952d0.firebaseapp.com",
  projectId: "groomin-952d0",
  storageBucket: "groomin-952d0.firebasestorage.app",
  messagingSenderId: "842337348210",
  appId: "1:842337348210:web:0b46d48bdd73f0ca7170eb",
  measurementId: "G-Y8CSYEGTDL"
};

// VAPID key para Web Push (Console → Cloud Messaging → Web Push certificates)
window.FCM_VAPID_KEY = "BOQsP79_Vo1b_5tO8G9OoVTbt9NgYertyGBDEN1u_3ZLKTnEHeuB4x56_2MWUNydcRl4P2tn6K5yc8uUlyQnaiY";

// Stripe (PRODUÇÃO/live). A chave publicável pode ficar no cliente; a secreta fica somente nas Cloud Functions.
window.STRIPE_PUBLIC_KEY = "pk_live_51TpWq13G49FJ9KUOKiPIbALvTPWxKOKoiZkKM9KpkPKVRYuMdPnEcgo9kwqAexNWf8iihnThRYbYPvQ54qvSOTb500xjmAXSBG";

// App Check (Firebase Console → App Check → Web app → reCAPTCHA Enterprise/v3).
// Preencha com a site key e publique novamente; vazio mantém compatibilidade durante setup.
window.FIREBASE_APPCHECK_SITE_KEY = "6Lef2zMtAAAAAERjyfZ2GLiWKpmZLz3VQqWis-cM";

// true = backend Firebase real | false = modo demo (localStorage)
window.USE_FIREBASE = true;
