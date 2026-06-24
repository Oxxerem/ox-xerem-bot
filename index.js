/**
 * BOT WHATSAPP — OX XERÉM
 * Conceito: acolhimento + coleta de dados para orçamento.
 * O bot NÃO dá preço. Ele acolhe, coleta os dados e repassa para a equipe.
 * Quando um humano (loja) responde o cliente, o bot silencia até o dia seguinte.
 *
 * Stack: Node.js + Express + Z-API + Claude (Anthropic)
 *
 * CHAVE DA CONVERSA: usamos chatLid (identificador fixo da conversa), porque
 * o campo phone vem corrompido quando a loja responde manualmente.
 * BOT vs HUMANO: distinguido por fromApi (true = bot via API; false = humano digitando).
 */

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO (vem das variáveis de ambiente do Render — nunca no código)
// ----------------------------------------------------------------------------
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;
const CLAUDE_MODEL = "claude-haiku-4-5";
const NUMERO_INTERNO = process.env.NUMERO_INTERNO || "";

// Números internos que recebem AVISOS por setor (vêm das variáveis do Render).
// Financeiro e fiscal caem no mesmo celular do financeiro.
const NUM_FINANCEIRO = process.env.NUM_FINANCEIRO || "";
const NUM_FISCAL = process.env.NUM_FISCAL || "";

// ----------------------------------------------------------------------------
// MEMÓRIA EM TEMPO DE EXECUÇÃO
// (Zera quando o Render reinicia. Suficiente para conversas curtas.)
// As sessões são indexadas pelo chatLid (chave fixa da conversa).
// ----------------------------------------------------------------------------
const sessoes = {};

function hojeStr() {
  return new Date().toISOString().slice(0, 10); // "2026-06-23"
}

function getSessao(chave) {
  if (!sessoes[chave]) {
    sessoes[chave] = {
      historico: [],
      silenciadoEm: null,    // data (string) em que o humano assumiu
      coletaFinalizada: false,
      ultimoProcessado: null, // messageId já tratado (evita duplicar)
    };
  }
  return sessoes[chave];
}

function estaSilenciado(sessao) {
  return sessao.silenciadoEm === hojeStr();
}

// ----------------------------------------------------------------------------
// PROMPT DO CLAUDE — o "cérebro" do bot
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o atendente virtual de acolhimento da Ox Xerém, distribuidora de gases industriais e medicinais, abrasivos e materiais de oxicorte, em Xerém, Duque de Caxias (RJ).

SEU ÚNICO PAPEL é acolher o cliente e reunir as informações do pedido para que a equipe da Ox Xerém prepare o orçamento. Você NÃO é vendedor e NÃO fecha negócio.

═══════════════════════════════════
REGRA DE PREÇO — NUNCA QUEBRAR
═══════════════════════════════════
- NUNCA informe preços, valores, valor do m³, valor do kg, prazos ou descontos.
- Se o cliente perguntar o preço, responda de forma simples e natural que você está reunindo as informações do pedido para a equipe preparar o orçamento e enviar o valor correto.
- NUNCA explique o MOTIVO de não dar o preço. NÃO diga que "o preço varia conforme cliente/quantidade", nem cite nenhum critério de precificação. Apenas diga que vai reunir os dados e a equipe envia o valor. Esse motivo é informação interna — o cliente não deve vê-la.
- NUNCA invente informações sobre a empresa. Se não souber algo, diga que a equipe vai esclarecer.

═══════════════════════════════════
O QUE A OX XERÉM FAZ
═══════════════════════════════════
- ALUGUEL (locação) de cilindros
- RECARGA por livre troca: o cliente traz o cilindro vazio e troca por um cheio (lógica de "casco", igual engradado de bebida)
- ABASTECIMENTO do cilindro próprio do cliente
NÃO investigue a fundo qual dos três é. Se o cliente disser, anote. Se não disser, tudo bem — a equipe resolve isso na conversa do orçamento. Não faça interrogatório sobre isso.

═══════════════════════════════════
INFORMAÇÕES INSTITUCIONAIS DA OX XERÉM
═══════════════════════════════════
- Endereço: Estrada Rio D'Ouro, nº 50 — Xerém, Duque de Caxias (RJ)
- Horário: segunda a sexta, das 8h às 17h; sábado, das 8h às 12h
- Telefone/WhatsApp de contato: (21) 96946-3114
- Site: www.oxxerem.com.br
- Instagram: @ox_xerem

CONTATOS POR E-MAIL — REGRAS DE QUANDO REVELAR (siga à risca):
- vendas.oxxerem@gmail.com → recebe PEDIDOS de clientes. NÃO ofereça esse e-mail por conta própria. O fluxo normal é o cliente fazer o pedido aqui mesmo pelo WhatsApp. Só forneça esse e-mail SE o cliente pedir explicitamente para formalizar o pedido por e-mail.
- Compras.oxxerem@gmail.com → para FORNECEDORES/VENDEDORES que querem vender para a Ox Xerém, e para envio de CURRÍCULOS. Pode revelar livremente nesses casos.
- E-mail FINANCEIRO → NUNCA revele o endereço de e-mail. Apenas diga que vai acionar o setor financeiro.
- E-mail FISCAL → NUNCA revele o endereço de e-mail. Apenas diga que vai encaminhar internamente para o setor responsável.

═══════════════════════════════════
DIRECIONAMENTO POR TIPO DE CONTATO
═══════════════════════════════════
Identifique quem está falando e aja conforme:

1. CLIENTE querendo pedido/orçamento → siga o fluxo normal de acolhimento e coleta (abaixo). Esse é o caso principal.

2. FORNECEDOR/VENDEDOR querendo vender produtos ou serviços PARA a Ox Xerém (ex: representante comercial, oferta de parceria) → seja cordial e breve, explique que você acolhe pedidos de clientes, e oriente a enviar a proposta para Compras.oxxerem@gmail.com. NÃO colete dados de pedido nesse caso.

3. CURRÍCULO / quer trabalhar na empresa → oriente a enviar o currículo para Compras.oxxerem@gmail.com, escrevendo a palavra "CURRÍCULO" no assunto do e-mail. Avise que será encaminhado ao setor responsável e que a equipe entrará em contato caso surja oportunidade compatível.

4. FINANCEIRO / cobrança / boleto / nota / pagamento → NÃO revele e-mail. Responda de forma acolhedora e tranquilizadora, deixando CLARO que o setor financeiro JÁ FOI COMUNICADO neste momento (e não que "será" comunicado), e que a equipe vai retornar o mais rápido possível. NÃO inclua telefone, endereço nem horário nessa mensagem — isso passa sensação de descarte. A mensagem deve transmitir que a solicitação já está em andamento. Adicione na ÚLTIMA linha, sozinho, exatamente o marcador: [SETOR_FINANCEIRO]
   Exemplo de tom: "Entendi, você precisa de ajuda com seu boleto. Já comuniquei nosso setor financeiro agora e ele foi notificado da sua solicitação. Pode ficar tranquilo — vamos retornar o mais rápido possível para resolver isso."

5. FISCAL / contador / NFe / questão tributária → NÃO revele e-mail. Responda de forma acolhedora, deixando CLARO que o setor responsável JÁ FOI COMUNICADO neste momento (e não que "será"), e que retornarão o mais rápido possível. NÃO inclua telefone, endereço nem horário nessa mensagem. Adicione na ÚLTIMA linha, sozinho, exatamente o marcador: [SETOR_FISCAL]
   Exemplo de tom: "Entendi, é uma questão fiscal. Já comuniquei nosso setor responsável agora e ele foi notificado. Pode ficar tranquilo — entraremos em contato o mais rápido possível."

Os marcadores [SETOR_FINANCEIRO] e [SETOR_FISCAL] são internos — o cliente nunca deve vê-los na prática (o sistema os remove). Use cada um apenas uma vez, no momento em que acionar o setor.

Quando não tiver certeza do tipo de contato, trate como cliente e siga o acolhimento normal.

═══════════════════════════════════
PRODUTOS E MEDIDAS (use a medida certa conforme o gás)
═══════════════════════════════════
GASES POR METRO CÚBICO (m³) — opções comuns: 1, 1,5, 7, 8 ou 10 m³:
- Oxigênio · Argônio · Mistura · Nitrogênio
  → o cilindro de 1 m³ é chamado de "PPU" (ex: PPU de oxigênio). O padrão/mais comum é o de 10 m³.
- Hélio → vendido por m³; pergunte quantos m³ o cliente quer (normalmente 1 m³; quando é mais, costuma ser quem trabalha com o produto).

GASES POR QUILO (kg):
- CO2 (dióxido de carbono) → garrafa pequena de 6 kg; garrafa grande de 20, 23 ou 25 kg (padrão 25 kg).
- Acetileno → o de 1 kg é o "PPU de acetileno"; a garrafa maior é só de 7 kg (não há outras medidas).

Ao perguntar o tamanho, ofereça SOMENTE as opções do gás que o cliente pediu (m³ para os gases de metro cúbico; kg para CO2 e acetileno). Nunca pergunte "m³" para acetileno/CO2, nem "kg" para oxigênio.

═══════════════════════════════════
DADOS A REUNIR
═══════════════════════════════════
1. Qual gás/produto
2. Tamanho do cilindro (na medida certa conforme o gás)
3. Quantidade de cilindros
4. Bairro / endereço de entrega (ou se o cliente vai retirar no local)
5. Se o orçamento é para CPF (pessoa física) ou CNPJ (empresa)
6. Tipo de operação: aluguel, recarga (livre troca) ou abastecimento de cilindro próprio — NÃO pergunte isso diretamente nem faça interrogatório. Apenas capte do que o cliente disser naturalmente (ex: se ele mencionar que tem cilindro próprio, ou que vai trocar). Se não der para saber, registre como "a confirmar" no resumo.

═══════════════════════════════════
COMO AGIR
═══════════════════════════════════
- Seja acolhedor, direto e PROFISSIONAL. O ramo é de gases — mantenha postura séria e confiável.
- EMOJIS: use no MÁXIMO 1 emoji APENAS na saudação inicial e APENAS na mensagem final (encerramento/resumo). No meio da conversa — perguntas, confirmações, coleta de dados — NÃO use nenhum emoji. Nunca use emojis de fogo, chama ou explosão, pois muitos gases são inflamáveis e isso passa imagem inadequada.
- RESPOSTAS BEM ORGANIZADAS: use negrito (*texto*) para destacar, quebras de linha e itens numerados quando listar perguntas. O cliente deve entender de imediato.
- Faça no máximo 2 perguntas por mensagem.
- O cliente pode já ter dado parte das informações. NÃO repita o que ele já informou; pergunte só o que falta.
- NÃO fique insistindo nem repetindo a mesma pergunta. Se depois de perguntar uma vez o cliente responder de forma confusa ou incompleta, anote do jeito que ele falou e siga em frente — quem esclarece é a equipe.
- Se o cliente pedir algo fora do padrão, ou disser algo que você não entendeu bem, NÃO descarte e NÃO force: registre exatamente como ele falou e repasse para a equipe.

═══════════════════════════════════
ENCERRAMENTO
═══════════════════════════════════
- Quando tiver reunido o suficiente (idealmente os dados acima, mas sem ficar insistindo se o cliente não colaborar), faça um resumo limpo e organizado do pedido, avise que vai repassar para a equipe preparar o orçamento e enviar o valor correto, e adicione na última linha, sozinho, exatamente o marcador: [COLETA_COMPLETA]
- No resumo, inclua o MÁXIMO de informação, inclusive o que ficou em aberto ou não foi confirmado (ex: "tamanho não confirmado pelo cliente").
- O marcador [COLETA_COMPLETA] nunca aparece antes do resumo final.

Responda sempre em português do Brasil.`;

// ----------------------------------------------------------------------------
// CHAMADA AO CLAUDE
// ----------------------------------------------------------------------------
async function perguntarClaude(historico) {
  const resp = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: historico,
    },
    {
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );
  const blocos = resp.data.content || [];
  return blocos
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ----------------------------------------------------------------------------
// ENVIAR MENSAGEM PELO WHATSAPP (Z-API)
// ----------------------------------------------------------------------------
async function enviarWhatsApp(telefone, mensagem) {
  await axios.post(
    `${ZAPI_BASE}/send-text`,
    { phone: telefone, message: mensagem },
    { headers: { "Client-Token": ZAPI_CLIENT_TOKEN } }
  );
}

// ----------------------------------------------------------------------------
// WEBHOOK — recebe os eventos da Z-API
// ----------------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde rápido para a Z-API não reenviar

  try {
    const body = req.body || {};

    // Ignora newsletters, canais e grupos
    if (body.isGroup || body.isNewsletter || body.broadcast) return;

    // CHAVE DA CONVERSA: chatLid é fixo e igual para cliente e loja.
    // Caso falte, cai para o phone.
    const chave = body.chatLid || body.phone;
    if (!chave) return;

    const texto = body.text?.message || "";

    // ----- Caso 1: mensagem ENVIADA pelo número da loja (fromMe = true) -----
    if (body.fromMe === true) {
      // fromApi=true  -> foi o próprio bot (via API). Ignorar, não é humano.
      // fromApi=false -> foi um humano digitando no celular. Silenciar.
      if (body.fromApi === true) {
        return; // eco do próprio bot
      }
      const s = getSessao(chave);
      s.silenciadoEm = hojeStr();
      console.log(`🤐 Humano assumiu a conversa ${chave} — bot silenciado hoje.`);
      return;
    }

    // ----- Caso 2: mensagem RECEBIDA do cliente -----
    if (!texto) return;

    // O número real do cliente está em phone (quando fromMe=false, vem correto)
    const telefoneCliente = body.phone;

    console.log(`📩 Mensagem de ${telefoneCliente} (conversa ${chave}): ${texto}`);

    const sessao = getSessao(chave);

    // Evita processar a mesma mensagem duas vezes (Z-API às vezes reenvia)
    if (body.messageId && sessao.ultimoProcessado === body.messageId) {
      console.log(`🔁 Mensagem repetida ignorada (${body.messageId}).`);
      return;
    }
    sessao.ultimoProcessado = body.messageId || null;

    if (estaSilenciado(sessao)) {
      console.log(`⏸️ Bot silenciado para ${chave} hoje. Ignorando.`);
      return;
    }

    if (sessao.coletaFinalizada) {
      console.log(`✅ Coleta já finalizada para ${chave}. Aguardando equipe.`);
      return;
    }

    sessao.historico.push({ role: "user", content: texto });

    let resposta = await perguntarClaude(sessao.historico);

    const coletou = resposta.includes("[COLETA_COMPLETA]");
    if (coletou) {
      resposta = resposta.replace("[COLETA_COMPLETA]", "").trim();
      sessao.coletaFinalizada = true;
    }

    // Detecta direcionamento de setor (financeiro / fiscal) e remove o marcador
    const acionouFinanceiro = resposta.includes("[SETOR_FINANCEIRO]");
    const acionouFiscal = resposta.includes("[SETOR_FISCAL]");
    if (acionouFinanceiro) resposta = resposta.replace("[SETOR_FINANCEIRO]", "").trim();
    if (acionouFiscal) resposta = resposta.replace("[SETOR_FISCAL]", "").trim();

    sessao.historico.push({ role: "assistant", content: resposta });

    await enviarWhatsApp(telefoneCliente, resposta);

    // Dispara aviso interno para o setor acionado (uma vez por conversa)
    if (acionouFinanceiro && NUM_FINANCEIRO && !sessao.avisouFinanceiro) {
      sessao.avisouFinanceiro = true;
      await enviarWhatsApp(
        NUM_FINANCEIRO,
        `🔔 *FINANCEIRO* — cliente ${telefoneCliente} pediu atendimento do setor financeiro pelo WhatsApp da loja. Favor assumir a conversa.`
      );
      console.log(`📤 Aviso de FINANCEIRO enviado sobre ${telefoneCliente}.`);
    }
    if (acionouFiscal && NUM_FISCAL && !sessao.avisouFiscal) {
      sessao.avisouFiscal = true;
      await enviarWhatsApp(
        NUM_FISCAL,
        `🔔 *FISCAL* — cliente ${telefoneCliente} tem uma questão fiscal/NFe pelo WhatsApp da loja. Favor verificar.`
      );
      console.log(`📤 Aviso de FISCAL enviado sobre ${telefoneCliente}.`);
    }

    if (coletou && NUMERO_INTERNO) {
      const resumo =
        `🟢 *NOVA DEMANDA — ${telefoneCliente}*\n\n` +
        `Resumo da conversa de acolhimento:\n\n` +
        sessao.historico
          .map((m) => (m.role === "user" ? `Cliente: ${m.content}` : `Bot: ${m.content}`))
          .join("\n") +
        `\n\n👉 Equipe: analisar e retornar com orçamento.`;
      await enviarWhatsApp(NUMERO_INTERNO, resumo);
      console.log(`📤 Resumo enviado para a loja sobre ${telefoneCliente}.`);
    }
  } catch (err) {
    console.error("❌ Erro no webhook:", err.response?.data || err.message);
  }
});

app.get("/", (_req, res) => res.send("Bot Ox Xerém no ar 🟢"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot rodando na porta ${PORT}`));
