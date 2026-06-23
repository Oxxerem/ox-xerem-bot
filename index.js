/**
 * BOT WHATSAPP — OX XERÉM
 * Conceito: acolhimento + coleta de dados para orçamento.
 * O bot NÃO dá preço. Ele acolhe, coleta os dados e repassa para a equipe.
 * Quando um humano (loja) responde o cliente, o bot silencia até o dia seguinte.
 *
 * Stack: Node.js + Express + Z-API + Claude (Anthropic)
 *
 * >>> VERSÃO COM RAIO-X DE DIAGNÓSTICO <<<
 * Esta versão imprime o evento completo da Z-API no log, para identificarmos
 * o formato do número quando um humano envia manualmente. Será removido depois.
 */

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ----------------------------------------------------------------------------
// CONFIGURAÇÃO
// ----------------------------------------------------------------------------
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;
const CLAUDE_MODEL = "claude-haiku-4-5";
const NUMERO_INTERNO = process.env.NUMERO_INTERNO || "";

// ----------------------------------------------------------------------------
// WEBHOOK — RAIO-X: imprime o evento inteiro
// ----------------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body || {};
    // Imprime o evento completo, formatado, para análise.
    console.log("===== EVENTO Z-API =====");
    console.log(JSON.stringify(body, null, 2));
    console.log("========================");
  } catch (err) {
    console.error("Erro no raio-x:", err.message);
  }
});

app.get("/", (_req, res) => res.send("Bot Ox Xerém — modo diagnóstico 🔬"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot rodando na porta ${PORT} (DIAGNÓSTICO)`));
