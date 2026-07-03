const { test, expect } = require("@playwright/test");

async function disableFirebaseForDemo(page) {
  await page.route("**/js/firebase-config.js*", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.FIREBASE_CONFIG = {};
        window.USE_FIREBASE = false;
        window.FIREBASE_APPCHECK_SITE_KEY = "";
        window.__FB_ENABLED = false;
      `,
    });
  });
}

async function resetDemoStorage(page) {
  await page.evaluate(() => {
    localStorage.removeItem("groomin_db_v1");
    sessionStorage.clear();
  });
}

test.describe("teste humano completo em modo demo", () => {
  test("login, produto, pagina publica, agendamento cliente, painel e logout", async ({ page, baseURL }) => {
    await disableFirebaseForDemo(page);

    await page.goto(`${baseURL}/app/#/login`);
    await resetDemoStorage(page);
    await page.reload();

    await expect(page.getByRole("heading", { name: /Entrar na plataforma/i })).toBeVisible();
    await page.locator("#lg_email").fill("joao@groomin.demo");
    await page.locator("#lg_pass").fill("owner123");
    await page.locator("#btn_login").click();

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.getByRole("heading", { name: /^Painel$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sair/i }).first()).toBeVisible();

    await page.evaluate(() => {
      location.hash = "#/dashboard/estoque";
    });
    await expect(page.getByRole("heading", { name: "Estoque", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Novo produto/i }).click();
    await page.locator("#pr_name").fill("Pomada QA");
    await page.locator("#pr_sku").fill(`QA-${Date.now()}`);
    await page.locator("#pr_cost").fill("12");
    await page.locator("#pr_price").fill("29.9");
    await page.locator("#pr_qty").fill("8");
    await page.locator("#pr_min").fill("2");
    await page.getByRole("button", { name: /^Salvar$/i }).click();
    await expect(page.getByText("Pomada QA")).toBeVisible();

    await page.evaluate(() => {
      location.hash = "#/barbearia-do-joao";
    });
    await expect(page.getByRole("heading", { name: "Barbearia do João", exact: true })).toBeVisible();
    await expect(page.getByText(/WhatsApp|99999-1000|3333-1000/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Agendar horário|Agendar agora|Agendar/i }).first().click();

    await expect(page.getByRole("heading", { name: /Agendar horário/i })).toBeVisible();
    await page.locator(".select-item").first().click();
    await page.locator(".select-item").filter({ hasText: /Qualquer profissional/i }).click();
    await page.locator(".date-pill:not([disabled])").first().click();
    await page.locator(".slot:not([disabled])").first().click();
    await page.locator("#bk_name").fill("Cliente QA Humano");
    await page.locator("#bk_phone").fill("(11) 98888-7777");
    await page.locator("#btn_confirm").click();
    await expect(page.getByRole("heading", { name: "Horário reservado", exact: true })).toBeVisible();
    await expect(page.getByText(/Confirmar no WhatsApp/i)).toBeVisible();
    await page.getByRole("button", { name: "Fechar" }).click();

    // Reload real (goto) para a agenda: zera o DOM e descarta o overlay órfão do
    // modal de sucesso. O login persiste no sessionStorage. Vista "Lista" mostra
    // agendamentos de qualquer data — o wizard pode reservar amanhã se todos os
    // horários de hoje já passaram (ex.: teste rodando à noite).
    await page.goto(`${baseURL}/app/#/dashboard/agenda`);
    await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lista", exact: true }).click();
    await expect(page.getByText("Cliente QA Humano", { exact: true }).first()).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toMatch(/sair/i);
      await dialog.accept();
    });
    await page.getByRole("button", { name: /Sair/i }).first().click();
    await expect(page).toHaveURL(/#\/login/);
    await expect(page.getByRole("heading", { name: /Entrar na/i })).toBeVisible();
  });
});
