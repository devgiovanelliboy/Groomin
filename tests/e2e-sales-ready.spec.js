const { test, expect } = require("@playwright/test");

const stamp = Date.now();
const email = process.env.GROOMIN_E2E_EMAIL || `qa.groomin.${stamp}@gmail.com`;
const password = process.env.GROOMIN_E2E_PASSWORD || `Groomin${stamp}!`;
const shopName = process.env.GROOMIN_E2E_SHOP || `QA Groomin ${stamp}`;

async function makeImageBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
}

async function getSignupOtp(page, testEmail) {
  if (process.env.GROOMIN_E2E_OTP) return process.env.GROOMIN_E2E_OTP;
  return await page.evaluate(async ({ email }) => {
    if (!window.__groominReadSignupOtp) return "";
    return window.__groominReadSignupOtp(email);
  }, { email: testEmail }).catch(() => "");
}

test("oferta comercial da landing esta pronta", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Groomin|página|agendamento/i }).first()).toBeVisible();
  await expect(page.getByText("R$ 14,90").first()).toBeVisible();
  await expect(page.getByText("R$ 151,98").first()).toBeVisible();
  await expect(page.getByText(/Cliente Fundador/i).first()).toBeVisible();
  await expect(page.getByText(/groomin\.com\.br/i).first()).toBeVisible();
});

test("cadastro, publicacao e agendamento publico", async ({ page }, testInfo) => {
  test.skip(!process.env.GROOMIN_APPCHECK_DEBUG_TOKEN, "Fluxo real exige App Check. Registre um debug token no Firebase Console e defina GROOMIN_APPCHECK_DEBUG_TOKEN.");
  const logo = await makeImageBuffer();
  const cover = await makeImageBuffer();
  const events = [];
  page.on("console", msg => events.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => events.push(`[pageerror] ${err.message}`));
  if (process.env.GROOMIN_APPCHECK_DEBUG_TOKEN) {
    await page.addInitScript(token => {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
      window.FIREBASE_APPCHECK_DEBUG_TOKEN = token;
    }, process.env.GROOMIN_APPCHECK_DEBUG_TOKEN);
  }

  await page.goto("/");
  await page.getByRole("button", { name: /Criar minha página|Criar conta|Quero começar/i }).first().click();
  await page.waitForTimeout(600);
  if (!(await page.locator("#onb_name").count())) {
    await page.evaluate(() => window.openTrialSignup && window.openTrialSignup("trial"));
  }
  await expect(page.locator("#onb_name")).toBeVisible({ timeout: 15000 });

  await page.locator("#onb_name").fill("QA Groomin");
  await page.locator("#onb_email").fill(email);
  await page.locator("#onb_pass").fill(password);
  await page.evaluate(() => onbNext());
  await expect(page.locator("#onb_otp")).toBeVisible({ timeout: 45000 });
  const otp = await getSignupOtp(page, email);
  test.skip(!otp, "OTP nao esta disponivel automaticamente. Defina GROOMIN_E2E_OTP ou exponha um leitor seguro apenas para QA.");

  await page.locator("#onb_otp").fill(otp);
  await page.getByRole("button", { name: /Validar código/i }).click();
  await expect(page.getByText(/Tipo de negócio/i)).toBeVisible({ timeout: 30000 });

  await page.getByText(/Barbearia|Beleza|Massoterapeuta/i).first().click();
  await page.getByRole("button", { name: /Próximo/i }).click();

  await page.locator("#onb_shop").fill(shopName);
  await page.locator("#onb_wa").fill("11999999999");
  await page.locator("#onb_phone").fill("1133333333");
  await page.locator("#onb_addr").fill("Rua QA, 123 - Sao Paulo");
  await page.locator("#onb_logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
  await page.locator("#onb_cover").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: cover });

  if (await page.locator("#onb_prof_name").count()) {
    await page.locator("#onb_prof_name").fill("Profissional QA");
    await page.locator("#onb_prof_role").fill("Barbeiro");
    await page.getByRole("button", { name: /Adicionar profissional/i }).click();
  }
  if (await page.locator("#onb_svc_name").count()) {
    await page.locator("#onb_svc_name").fill("Corte QA");
    await page.locator("#onb_svc_duration").fill("30");
    await page.locator("#onb_svc_price").fill("45");
    await page.getByRole("button", { name: /Adicionar serviço/i }).click();
  }

  await page.getByRole("button", { name: /Próximo/i }).click();
  await page.getByRole("button", { name: /Continuar grátis/i }).click();
  await page.getByRole("button", { name: /Publicar/i }).click();
  await expect(page.getByText(/Página publicada com sucesso/i)).toBeVisible({ timeout: 60000 });
  await expect(page).toHaveURL(/dashboard|admin|app/);

  const slug = shopName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  await page.goto(`/${slug}`);
  await expect(page.getByRole("button", { name: /Agendar/i }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Corte QA|Serviços/i).first()).toBeVisible();
  await expect(page.getByText(/Profissional QA|Profissional/i).first()).toBeVisible();

  await page.getByRole("button", { name: /Agendar/i }).first().click();
  await page.locator(".select-item").first().click();
  await page.locator(".select-item").first().click();
  await page.locator(".date-pill:not([disabled])").first().click();
  await page.locator(".slot:not([disabled])").first().click();
  await page.locator("#bk_name").fill("Cliente QA");
  await page.locator("#bk_phone").fill("11988887777");
  await page.getByRole("button", { name: /Confirmar/i }).click();
  await expect(page.getByText(/Horário reservado|Agendamento confirmado|Confirmar no WhatsApp/i).first()).toBeVisible({ timeout: 60000 });

  await testInfo.attach("browser-events", { body: events.join("\n"), contentType: "text/plain" });
});
