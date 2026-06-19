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
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;     // Instance ID da Z-API
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;           // Token da instância
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN; // Client-Token (segurança)
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;   // Chave da Anthropic

const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;
const CLAUDE_MODEL = "claude-haiku-4-5";

// Número da loja para receber o resumo da demanda (formato: 5521999999999)
const NUMERO_INTERNO = process.env.NUMERO_INTERNO || "";

// ----------------------------------------------------------------------------
// MEMÓRIA EM TEMPO DE EXECUÇÃO
// (Obs: zera quando o Render reinicia/hiberna. Suficiente para conversas curtas.
//  Para persistência real, trocar por banco depois.)
// ----------------------------------------------------------------------------
const sessoes = {};

// Guarda os textos que o PRÓPRIO bot enviou, por telefone, para não
// confundir o eco da Z-API ("ao enviar") com um humano respondendo.
const enviadasPeloBot = {}; // { telefone: Set<string> }

function registrarEnvioBot(telefone, texto) {
  if (!enviadasPeloBot[telefone]) enviadasPeloBot[telefone] = new Set();
  enviadasPeloBot[telefone].add((texto || "").trim());
}

function foiEnviadaPeloBot(telefone, texto) {
  const set = enviadasPeloBot[telefone];
  if (!set) return false;
  return set.has((texto || "").trim());
}

function hojeStr() {
  return new Date().toISOString().slice(0, 10); // "2026-06-19"
}

function getSessao(telefone) {
  if (!sessoes[telefone]) {
    sessoes[telefone] = {
      historico: [],
      silenciadoEm: null,   // data (string) em que o humano assumiu
      coletaFinalizada: false,
    };
  }
  return sessoes[telefone];
}

// O bot está silenciado para este cliente se um humano respondeu HOJE
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
- EMOJIS: use no MÁXIMO 1 emoji APENAS na saudação inicial e APENAS na mensagem final (encerramento/resumo). No meio da conversa — perguntas, confirmações, coleta de dados — NÃO use nenhum emoji. Nunca use emojis de fogo, chama ou explosão (🔥💥), pois muitos gases são inflamáveis e isso passa imagem inadequada.
- RESPOSTAS BEM ORGANIZADAS: use negrito (*texto*) para destacar, quebras de linha e itens numerados quando listar perguntas. O cliente deve entender de imediato.
- Faça no máximo 2 perguntas por mensagem.
- O cliente pode já ter dado parte das informações. NÃO repita o que ele já informou; pergunte só o que falta.
- NÃO fique insistindo nem repetindo a mesma pergunta. Se depois de perguntar uma vez o cliente responder de forma confusa ou incompleta, anote do jeito que ele falou e siga em frente — quem esclarece é a equipe.
- Se o cliente pedir algo fora do padrão, ou disser algo que você não entendeu bem, NÃO descarte e NÃO force: registre exatamente como ele falou e repasse para a equipe.

═══════════════════════════════════
ENCERRAMENTO
═══════════════════════════════════
- Quando tiver reunido o suficiente (idealmente os 5 dados, mas sem ficar insistindo se o cliente não colaborar), faça um resumo limpo e organizado do pedido, avise que vai repassar para a equipe preparar o orçamento e enviar o valor correto, e adicione na última linha, sozinho, exatamente o marcador: [COLETA_COMPLETA]
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
  registrarEnvioBot(telefone, mensagem);
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
  // Responde rápido para a Z-API não reenviar
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const telefone = body.phone;
    if (!telefone) return;

    // Ignora newsletters, canais e grupos — só atende conversa 1-a-1 de cliente.
    if (
      body.isGroup ||
      body.isNewsletter ||
      String(telefone).includes("@newsletter") ||
      String(telefone).includes("@broadcast") ||
      String(telefone).includes("-")
    ) {
      return;
    }

    const texto = body.text?.message || body.message || "";

    // ----- Caso 1: mensagem ENVIADA pelo número da loja -----
    if (body.fromMe === true) {
      // Se foi o PRÓPRIO bot que enviou, ignora (é só o eco da Z-API).
      if (foiEnviadaPeloBot(telefone, texto)) {
        return;
      }
      // Senão, foi um humano (você/Lorenn) digitando: ativa o silêncio.
      const s = getSessao(telefone);
      s.silenciadoEm = hojeStr();
      console.log(`🤐 Humano respondeu ${telefone} — bot silenciado hoje.`);
      return;
    }

    // ----- Caso 2: mensagem RECEBIDA do cliente -----
    if (!texto) return;

    console.log(`📩 Mensagem de ${telefone}: ${texto}`);

    const sessao = getSessao(telefone);

    // Se um humano já assumiu hoje, o bot fica quieto
    if (estaSilenciado(sessao)) {
      console.log(`⏸️ Bot silenciado para ${telefone} hoje. Ignorando.`);
      return;
    }

    // Se a coleta já foi finalizada, não fica repetindo — aguarda o vendedor
    if (sessao.coletaFinalizada) {
      console.log(`✅ Coleta já finalizada para ${telefone}. Aguardando vendedor.`);
      return;
    }

    // Monta o histórico para o Claude
    sessao.historico.push({ role: "user", content: texto });

    let resposta = await perguntarClaude(sessao.historico);

    // Detecta o fim da coleta
    const coletou = resposta.includes("[COLETA_COMPLETA]");
    if (coletou) {
      resposta = resposta.replace("[COLETA_COMPLETA]", "").trim();
      sessao.coletaFinalizada = true;
    }

    sessao.historico.push({ role: "assistant", content: resposta });

    // Envia a resposta ao cliente
    await enviarWhatsApp(telefone, resposta);

    // Se finalizou a coleta, manda o resumo para o número interno da loja
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
