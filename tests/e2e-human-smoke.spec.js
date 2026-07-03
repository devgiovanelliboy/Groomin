const { test, expect } = require('@playwright/test');

test('teste humano simulado: login e botao Google visiveis', async ({ page, context, baseURL }) => {
  await page.goto(`${baseURL}/app/#/login`, { waitUntil: 'networkidle' });

  await expect(page.getByRole('heading', { name: /Entrar na plataforma/i })).toBeVisible();

  const googleButton = page.getByRole('button', { name: /Entrar com Google/i });
  await expect(googleButton).toBeVisible();
  await expect(googleButton).toBeEnabled();

  const box = await googleButton.boundingBox();
  expect(box && box.width).toBeGreaterThan(260);
  expect(box && box.height).toBeGreaterThan(46);

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    googleButton.click(),
  ]);

  await popup.waitForLoadState('domcontentloaded');
  // Produção abre accounts.google.com; emulador abre o widget local de auth (localhost:9099)
  await expect(popup).toHaveURL(/accounts\.google\.com|firebaseapp\.com|google\.com|localhost:9099|127\.0\.0\.1:9099/i);

  const popupUrl = popup.url();
  expect(popupUrl).not.toContain('redirect_uri_mismatch');
  await popup.close();
});

test('teste humano simulado: landing publica carrega sem erro visual basico', async ({ page, baseURL }) => {
  await page.goto(baseURL, { waitUntil: 'networkidle' });

  await expect(page.getByRole('button', { name: /Criar minha página/i }).first()).toBeVisible();
  await expect(page.getByText(/Crie sua página profissional de agendamentos/i).first()).toBeVisible();
  await expect(page.locator('body')).toBeVisible();
});
