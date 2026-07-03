# Groomin - checklist para vender

## Teste automatico

Comandos:

```powershell
npm run test:e2e
```

O teste cobre:
- landing com oferta comercial;
- cadastro com conta nova;
- verificacao de e-mail;
- publicacao com logo/capa;
- entrada no painel;
- pagina publica;
- agendamento publico.

Para o OTP ser 100% automatico, defina `GROOMIN_E2E_OTP` com o codigo recebido ou implemente um leitor seguro de OTP apenas para QA. Sem isso, o teste para no ponto certo e informa o bloqueio.

Como as Cloud Functions exigem App Check, o teste automatizado precisa de uma destas opcoes:
- rodar no dominio liberado no reCAPTCHA/App Check (`groomin.com.br` ou `groomin-952d0.web.app`);
- ou registrar um debug token no Firebase Console e rodar com `GROOMIN_APPCHECK_DEBUG_TOKEN`.

Exemplo:

```powershell
$env:GROOMIN_APPCHECK_DEBUG_TOKEN="COLE_O_DEBUG_TOKEN_REGISTRADO"
$env:GROOMIN_E2E_OTP="123456"
npm run test:e2e
```

## Dominio oficial

Dominio principal decidido: `groomin.com.br`.

Uso recomendado:
- `groomin.com.br`: site principal no Firebase Hosting.
- `www.groomin.com.br`: redirecionamento/alias para o site principal.
- `mail.groomin.com.br`: somente envio de e-mail pela Resend.

No Firebase Hosting, adicione o dominio personalizado `groomin.com.br` ao site `groomin-952d0`.
Depois copie os registros DNS que o Firebase mostrar no provedor do dominio.

Nao misture os registros da Resend em `mail.groomin.com.br` com os registros do Hosting em `groomin.com.br`.

## Seguranca antes de divulgar

- Firestore Rules publicadas e compilando.
- Storage Rules publicadas e compilando.
- App Check ativo no cliente.
- Callables criticas exigem App Check.
- Regras devem manter isolamento por `tenantId`.
- Dono/manager acessa apenas o proprio tenant.
- Cliente acessa apenas seus proprios agendamentos.
- Pagina publica le somente dados publicaveis e agenda pelo callable `createPublicBooking`.
- Girar a chave da Resend depois do ultimo teste, pois ela ja foi colada em conversa.

## Oferta comercial

Precos definidos:
- Teste gratis: ate 3 agendamentos, sem cartao.
- Plano mensal: R$ 14,90/mes.
- Plano anual: R$ 151,98/ano, equivalente a R$ 12,66/mes.
- Cliente Fundador: R$ 990 pagamento unico, oferta limitada.

Mensagem WhatsApp:

```text
Oi, tudo bem? Eu estou lançando o Groomin, uma página profissional de agendamento online para barbearias, salões e profissionais de beleza.

Você cadastra serviços, profissionais e horários, recebe um link tipo groomin.com.br/suanegocio e seus clientes conseguem agendar sem app e sem ficar trocando mensagem.

Estou liberando os primeiros negócios com teste grátis de até 3 agendamentos. Depois o plano mensal fica R$ 14,90, ou R$ 151,98 no anual.

Quer que eu crie uma página de teste para seu negócio hoje?
```
