/**
 * BOT WHATSAPP — OX XERÉM
 * Conceito: acolhimento + coleta de dados para orçamento.
 * O bot NÃO dá preço. Ele acolhe, coleta 6 dados e repassa para o vendedor.
 * Quando um humano (loja) responde o cliente, o bot silencia até o dia seguinte.
 *
 * Stack: Node.js + Express + Z-API + Claude (Anthropic)
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

// Número da loja para receber o resumo da demanda (formato: 5521999999999)
const NUMERO_INTERNO = process.env.NUMERO_INTERNO || "";

// ----------------------------------------------------------------------------
// MEMÓRIA EM TEMPO DE EXECUÇÃO
// ----------------------------------------------------------------------------
const sessoes = {};

function hojeStr() {
  return new Date().toISOString().slice(0, 10);
}

function getSessao(telefone) {
  if (!sessoes[telefone]) {
    sessoes[telefone] = {
      historico: [],
      silenciadoEm: null,
      coletaFinalizada: false,
    };
  }
  return sessoes[telefone];
}

function estaSilenciado(sessao) {
  return sessao.silenciadoEm === hojeStr();
}

// ----------------------------------------------------------------------------
// PROMPT DO CLAUDE — o "cérebro" do bot
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Você é o atendente virtual de acolhimento da Ox Xerém, uma distribuidora de gases industriais e medicinais em Xerém, Duque de Caxias (RJ). A empresa vende e recarrega gases em cilindros, faz locação de cilindros e vende abrasivos e materiais de oxicorte.

SEU ÚNICO PAPEL é acolher o cliente e coletar as informações abaixo para que um VENDEDOR humano prepare o orçamento. Você NÃO é vendedor.

REGRA MAIS IMPORTANTE — NUNCA QUEBRAR:
- NUNCA informe preços, valores, valor do m³, prazos de entrega ou descontos. O preço varia por cliente e só o vendedor pode calcular. Se o cliente perguntar preço, responda gentilmente que o vendedor vai analisar e retornar com o valor.
- NUNCA invente informações sobre a empresa que você não tem.
- Se não souber algo, diga que o vendedor vai esclarecer.

DADOS QUE VOCÊ PRECISA COLETAR (5 itens):
1. Tipo de gás ou produto (ex: oxigênio, acetileno, argônio, CO2, oxigênio medicinal, abrasivos)
2. Se é recarga, locação ou compra
3. Tamanho e quantidade de cilindros
4. Bairro / local de entrega
5. Se o orçamento é para CPF (pessoa física) ou CNPJ (empresa)

COMO AGIR:
- Seja acolhedor, direto e breve. Use no máximo 1 emoji por mensagem.
- O cliente já pode ter dado parte das informações na primeira mensagem. NÃO peça o que ele já informou. Pergunte só o que falta.
- Faça no máximo 2 perguntas por mensagem para não cansar.
- Quando tiver TODOS os 5 dados, encerre dizendo que vai repassar para um vendedor analisar e retornar com o orçamento, e adicione no final da sua mensagem, em uma linha separada, exatamente o marcador: [COLETA_COMPLETA]
- O marcador [COLETA_COMPLETA] só pode aparecer quando você tiver os 5 dados. Nunca antes.

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
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const telefone = body.phone;
    if (!telefone) return;
    if (body.isGroup) return;

    // Caso 1: mensagem ENVIADA pela loja (humano assumiu)
    if (body.fromMe === true) {
      const s = getSessao(telefone);
      s.silenciadoEm = hojeStr();
      console.log(`🤐 Humano respondeu ${telefone} — bot silenciado hoje.`);
      return;
    }

    // Caso 2: mensagem RECEBIDA do cliente
    const texto = body.text?.message || body.message || "";
    if (!texto) return;

    console.log(`📩 Mensagem de ${telefone}: ${texto}`);

    const sessao = getSessao(telefone);

    if (estaSilenciado(sessao)) {
      console.log(`⏸️ Bot silenciado para ${telefone} hoje. Ignorando.`);
      return;
    }

    if (sessao.coletaFinalizada) {
      console.log(`✅ Coleta já finalizada para ${telefone}. Aguardando vendedor.`);
      return;
    }

    sessao.historico.push({ role: "user", content: texto });

    let resposta = await perguntarClaude(sessao.historico);

    const coletou = resposta.includes("[COLETA_COMPLETA]");
    if (coletou) {
      resposta = resposta.replace("[COLETA_COMPLETA]", "").trim();
      sessao.coletaFinalizada = true;
    }

    sessao.historico.push({ role: "assistant", content: resposta });

    await enviarWhatsApp(telefone, resposta);

    if (coletou && NUMERO_INTERNO) {
      const resumo =
        `🟢 *NOVA DEMANDA — ${telefone}*\n\n` +
        `Resumo da conversa de acolhimento:\n\n` +
        sessao.historico
          .map((m) => (m.role === "user" ? `Cliente: ${m.content}` : `Bot: ${m.content}`))
          .join("\n") +
        `\n\n👉 Vendedor: analisar e retornar com orçamento.`;
      await enviarWhatsApp(NUMERO_INTERNO, resumo);
      console.log(`📤 Resumo enviado para a loja sobre ${telefone}.`);
    }
  } catch (err) {
    console.error("❌ Erro no webhook:", err.response?.data || err.message);
  }
});

// Rota de saúde (útil para "acordar" o Render e testar)
app.get("/", (_req, res) => res.send("Bot Ox Xerém no ar 🟢"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot rodando na porta ${PORT}`));
