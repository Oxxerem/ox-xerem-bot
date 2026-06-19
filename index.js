const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIGURAÇÕES DA Z-API ───────────────────────────────────────────────────
const INSTANCE_ID = "3EFC675DA5F911D6DF46FE76949B0C27";
const TOKEN = "2374F9C420BB072E543B8C6A";
const CLIENT_TOKEN = "Fc7687995007f4c7696d5f220c73446ffS";
const ZAPI_URL = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;

// ─── CONFIGURAÇÕES DO CLAUDE ──────────────────────────────────────────────────
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `Você é um atendente virtual da Ox Xerém, empresa especializada em distribuição de gases industriais e medicinais, abrasivos e materiais de oxicorte, localizada em Xerém, Duque de Caxias - RJ.

Responda sempre de forma simpática, objetiva e profissional, como um atendente humano da empresa.

Informações da empresa:
- Produtos: oxigênio industrial e medicinal, acetileno, argônio, CO2, nitrogênio, mistura para solda, abrasivos e materiais de oxicorte
- Localização: Xerém, Duque de Caxias - RJ
- Horário: Segunda a Sexta 08h às 18h, Sábado 08h às 12h
- Entregamos cilindros na região
- Trabalhamos com locação de cilindros mediante contrato

Se o cliente perguntar sobre preços específicos, diga que um atendente entrará em contato para passar os valores atualizados.
Se o cliente quiser falar com um humano, diga que em breve um atendente retornará.
Mantenha as respostas curtas (máximo 3 parágrafos).
Responda sempre em português.`;

// ─── FUNÇÕES DE ENVIO ─────────────────────────────────────────────────────────

async function enviarMensagem(telefone, mensagem) {
  try {
    const response = await axios.post(`${ZAPI_URL}/send-text`, {
      phone: telefone,
      message: mensagem,
    }, {
      headers: {
        "Client-Token": CLIENT_TOKEN,
        "Content-Type": "application/json"
      }
    });
    console.log("✅ Mensagem enviada:", response.data);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.response?.data || err.message);
  }
}

async function perguntarClaude(mensagem) {
  try {
    const response = await axios.post(CLAUDE_URL, {
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: mensagem }
      ]
    }, {
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      }
    });
    return response.data.content[0].text;
  } catch (err) {
    console.error("Erro ao consultar Claude:", err.response?.data || err.message);
    return "Olá! No momento estou com dificuldades técnicas. Por favor, aguarde que um atendente entrará em contato em breve! 😊";
  }
}

// ─── MENU PRINCIPAL ───────────────────────────────────────────────────────────

const SAUDACAO = `Olá! 👋 Bem-vindo à *Ox Xerém*!

Como podemos te ajudar hoje? Digite o número da opção desejada:

1️⃣ - Informações e Horário de funcionamento
3️⃣ - Orçamento / Vendas
5️⃣ - Falar com o Financeiro

_Ou digite sua dúvida diretamente que responderemos! 😊_`;

const RESPOSTAS = {
  "1": `🕐 *Informações & Horário - Ox Xerém*

📍 Estamos localizados em Xerém, Duque de Caxias - RJ

🗓 *Horário de funcionamento:*
• Segunda a Sexta: 08h às 18h
• Sábado: 08h às 12h
• Domingo: Fechado

Em caso de dúvidas, responda este menu ou aguarde atendimento. 😊

_Digite * para voltar ao menu._`,

  "3": `💼 *Orçamento / Vendas - Ox Xerém*

Ficamos felizes com seu interesse! 🎉

Para solicitar um orçamento, por favor nos informe:
• Produto ou serviço desejado
• Quantidade
• Prazo necessário

Nossa equipe de vendas retornará em breve! 📲

_Digite * para voltar ao menu._`,

  "5": `💰 *Financeiro - Ox Xerém*

Você será direcionado ao setor financeiro.

Por favor, informe:
• Seu nome completo
• Número do pedido ou NF (se tiver)
• Assunto da solicitação

Um atendente do financeiro entrará em contato em breve! ✅

_Digite * para voltar ao menu._`,
};

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const body = req.body;

  if (body.fromMe) return;
  if (body.isGroup) return;

  const telefone = body.phone;
  const texto = (body.text?.message || "").trim();

  console.log(`📩 Mensagem de ${telefone}: "${texto}"`);

  // Volta ao menu se digitar *
  if (texto === "*") {
    await enviarMensagem(telefone, SAUDACAO);
    return;
  }

  // Responde conforme a opção do menu
  if (RESPOSTAS[texto]) {
    await enviarMensagem(telefone, RESPOSTAS[texto]);
    return;
  }

  // Mensagem livre → responde com Claude AI
  console.log(`🤖 Consultando Claude para: "${texto}"`);
  const respostaClaude = await perguntarClaude(texto);
  await enviarMensagem(telefone, respostaClaude);
});

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot da Ox Xerém rodando na porta ${PORT}`);
  console.log(`📡 Webhook pronto em: http://localhost:${PORT}/webhook`);
});
