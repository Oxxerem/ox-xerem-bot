const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIGURAÇÕES DA Z-API ───────────────────────────────────────────────────
const INSTANCE_ID = "3EFC675DA5F911D6DF46FE76949B0C27";
const TOKEN = "2374F9C420BB072E543B8C6A";
const CLIENT_TOKEN = "Fc7687995007f4c7696d5f220c73446ffS";
const ZAPI_URL = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;

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

// ─── MENU PRINCIPAL ───────────────────────────────────────────────────────────

const SAUDACAO = `Olá! 👋 Bem-vindo à *Ox Xerém*!

Como podemos te ajudar hoje? Digite o número da opção desejada:

1️⃣ - Informações e Horário de funcionamento
3️⃣ - Orçamento / Vendas
5️⃣ - Falar com o Financeiro

_Digite o número correspondente à sua opção._`;

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

const OPCAO_INVALIDA = `❌ Opção não reconhecida.

Por favor, digite apenas o número da opção desejada:

1️⃣ - Informações e Horário
3️⃣ - Orçamento / Vendas
5️⃣ - Falar com o Financeiro`;

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // responde imediatamente para a Z-API

  const body = req.body;

  // Ignora mensagens enviadas pelo próprio bot
  if (body.fromMe) return;

  // Ignora mensagens de grupo
  if (body.isGroup) return;

  const telefone = body.phone;
  const texto = (body.text?.message || "").trim();

  console.log(`📩 Mensagem de ${telefone}: "${texto}"`);

  // Volta ao menu se digitar *
  if (texto === "*") {
    await enviarMensagem(telefone, SAUDACAO);
    return;
  }

  // Responde conforme a opção digitada
  if (RESPOSTAS[texto]) {
    await enviarMensagem(telefone, RESPOSTAS[texto]);
  } else {
    // Primeira mensagem ou opção inválida → envia saudação + menu
    await enviarMensagem(telefone, SAUDACAO);
  }
});

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Bot da Ox Xerém rodando na porta ${PORT}`);
  console.log(`📡 Webhook pronto em: http://localhost:${PORT}/webhook`);
});
