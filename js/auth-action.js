const SDK = "https://www.gstatic.com/firebasejs/10.12.5/";
const appMod = await import(SDK + "firebase-app.js");
const authMod = await import(SDK + "firebase-auth.js");

const cfg = window.FIREBASE_CONFIG || {};
const app = appMod.initializeApp(cfg);
const auth = authMod.getAuth(app);
const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const code = params.get("oobCode");
const continueUrl = params.get("continueUrl") || "/app/#/login";

const intro = document.getElementById("intro");
const form = document.getElementById("resetForm");
const status = document.getElementById("status");
const submitBtn = document.getElementById("submitBtn");
const pass = document.getElementById("newPassword");
const confirm = document.getElementById("confirmPassword");

function show(message, type) {
  status.className = `status ${type || ""}`.trim();
  status.textContent = message;
}

function done() {
  intro.textContent = "Senha alterada com sucesso. Agora voce ja pode entrar no Groomin.";
  form.hidden = true;
  show("Sua senha foi atualizada.", "ok");
  setTimeout(() => { location.href = continueUrl; }, 1800);
}

async function init() {
  if (mode !== "resetPassword" || !code) {
    intro.textContent = "Esse link de recuperacao nao e valido.";
    show("Solicite um novo link pela tela de login.", "err");
    return;
  }
  try {
    const email = await authMod.verifyPasswordResetCode(auth, code);
    intro.textContent = `Crie uma nova senha para ${email}.`;
    form.hidden = false;
    pass.focus();
  } catch (err) {
    intro.textContent = "Esse link expirou ou ja foi usado.";
    show("Solicite um novo link pela tela de login.", "err");
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const next = pass.value;
  const again = confirm.value;
  pass.closest(".field").classList.toggle("invalid", next.length < 6);
  confirm.closest(".field").classList.toggle("invalid", next !== again);
  if (next.length < 6 || next !== again) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Salvando...";
  try {
    await authMod.confirmPasswordReset(auth, code, next);
    done();
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Salvar nova senha";
    show("Nao foi possivel alterar a senha. Solicite um novo link e tente novamente.", "err");
  }
});

init();
