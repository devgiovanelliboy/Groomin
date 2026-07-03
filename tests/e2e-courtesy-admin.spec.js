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

test.describe("admin plano cortesia", () => {
  test("super admin ativa e remove cortesia, usuario comum nao acessa", async ({ page, baseURL }) => {
    await disableFirebaseForDemo(page);
    await page.goto(`${baseURL}/app/#/login`);
    await resetDemoStorage(page);
    await page.reload();

    await page.locator("#lg_email").fill("super@groomin.com.br");
    await page.locator("#lg_pass").fill("super123");
    await page.locator("#btn_login").click();
    await expect(page).toHaveURL(/#\/admin/);

    await page.evaluate(() => { location.hash = "#/admin/courtesy"; });
    await expect(page.locator("h2").filter({ hasText: "Plano Cortesia" })).toBeVisible();
    await page.locator("#admin_courtesy_q").fill("barbearia-do-joao");
    await expect(page.getByText("/barbearia-do-joao")).toBeVisible();

    await page.getByRole("button", { name: /Ativar/i }).first().click();
    await page.locator("#courtesy_note").fill("QA cortesia");
    await page.getByRole("button", { name: /Ativar cortesia/i }).click();
    await expect(page.getByText("Plano Cortesia").first()).toBeVisible();
    await expect(page.getByText("QA cortesia").first()).toBeVisible();

    await page.evaluate(() => ({ sub: DB.findBy("subscriptions", s => s.barbershopId === "shop1"), actions: DB.all("adminActions") }));
    const activeState = await page.evaluate(() => {
      const sub = DB.findBy("subscriptions", s => s.barbershopId === "shop1");
      return { isCourtesy: sub.isCourtesy, billingStatus: sub.billingStatus, mrr: sub.mrr, actions: DB.all("adminActions").length };
    });
    expect(activeState).toEqual(expect.objectContaining({ isCourtesy: true, billingStatus: "active", mrr: 0 }));
    expect(activeState.actions).toBeGreaterThan(0);

    await page.getByRole("button", { name: /Remover/i }).first().click();
    await page.locator("#courtesy_note").fill("QA remove");
    await page.getByRole("button", { name: /Remover cortesia/i }).click();
    const removedState = await page.evaluate(() => {
      const sub = DB.findBy("subscriptions", s => s.barbershopId === "shop1");
      return {
        isCourtesy: sub.isCourtesy,
        planType: sub.planType,
        billingStatus: sub.billingStatus,
        services: DB.scope("services", "shop1").length,
      };
    });
    expect(removedState).toEqual(expect.objectContaining({ isCourtesy: false, planType: "free", billingStatus: "trialing" }));
    expect(removedState.services).toBeGreaterThan(0);

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: /Sair/i }).first().click();
    await page.locator("#lg_email").fill("joao@groomin.demo");
    await page.locator("#lg_pass").fill("owner123");
    await page.locator("#btn_login").click();
    await page.evaluate(() => { location.hash = "#/admin/courtesy"; });
    await expect(page).not.toHaveURL(/#\/admin\/courtesy/);
  });
});
