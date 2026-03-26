import fs from "fs/promises";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração do E-mail (Nodemailer)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "465"),
  secure: process.env.SMTP_SECURE !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const dataDir = path.join(process.cwd(), "data");
const materialsPath = path.join(dataDir, "materials.json");
const campaignsPath = path.join(dataDir, "campaigns.json");

// Garante que as pastas e arquivos de dados existam
async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try { await fs.access(materialsPath); } catch { await fs.writeFile(materialsPath, "[]"); }
  try { await fs.access(campaignsPath); } catch { await fs.writeFile(campaignsPath, "[]"); }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

async function writeJsonFile<T>(filePath: string, data: T) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// --- INTEGRAÇÃO GEMINI & MESSENGER ---

interface Campaign {
  id: string; title: string; keywords: string[]; context: string; active: boolean;
}

interface Material {
  id: string; title: string; category: string; fileUrl: string;
}

// O "Cérebro" do Bot - Mesma lógica do App.tsx
const getSystemInstruction = (campaigns: Campaign[], materials: Material[]) => {
  const activeCampaigns = campaigns.filter(c => c.active).map(c => `- ${c.title}: ${c.context} (Keywords: ${c.keywords.join(', ')})`).join('\n');
  const availableMaterials = materials.map(m => `- ${m.title} (${m.category})`).join('\n');

  return `Você é um Consultor Comercial profissional da agência Aventour Viagens e Turismo.
Fale sempre como um ser humano, de forma natural, prestativa e comercial.

REGRAS DE LINGUAGEM E COMPORTAMENTO:
- NUNCA use expressões automáticas como: "Cliente Web", "verificar no chat", "estou a processar sistema".
- Use linguagem comercial natural: "Já verifiquei a melhor opção disponível", "Vamos avançar com a emissão".
- NUNCA ofereça dados de pagamento ou IBAN de forma proativa. Primeiro, construa confiança.
- Só envie os dados de pagamento se o cliente pedir explicitamente.
- Nunca use emojis. Responda de forma direta e profissional.

SERVIÇOS E PREÇOS:
1. PASSAGEM AÉREA: Valor depende de data/disponibilidade. Peça Destino, Data e Pessoas.
2. RESERVA DE PASSAGEM: 1.000 CVE.
3. RESERVA DE HOTEL: 60 CVE por dia.
4. FORMAÇÕES EM PORTUGAL: 45.000 CVE total. (Inscrição 6.000 + Matrícula 39.000).
   - Requisitos: 18+ anos e 9º ano concluído.
5. AGENDAMENTOS: Estudante (12.500 CVE + Taxa) / Férias (20.000 CVE).

CAMPANHAS ATIVAS:
${activeCampaigns}

MATERIAIS DISPONÍVEIS:
${availableMaterials}`;
};

async function callGemini(message: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const ai = new GoogleGenAI({ apiKey });
  const campaigns = await readJsonFile<Campaign[]>(campaignsPath, []);
  const materials = await readJsonFile<Material[]>(materialsPath, []);
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: message,
    config: { systemInstruction: getSystemInstruction(campaigns, materials) },
  });

  return response.text;
}

async function sendMessengerMessage(recipientId: string, text: string) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!PAGE_ACCESS_TOKEN) return console.log(`[LOG]: ${text}`);

  await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
}

// --- SERVIDOR EXPRESS ---

async function startServer() {
  const app = express();
  const PORT = 3000;

  await ensureDataFiles();
  app.use(express.json({ limit: "50mb" }));

  // Webhook da Meta (Verificação)
  app.get("/webhook", (req, res) => {
    const VERIFY_TOKEN = "aventour_token_123";
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
      res.status(200).send(req.query["hub.challenge"]);
    } else { res.sendStatus(403); }
  });

  // Webhook da Meta (Receber Mensagens)
  app.post("/webhook", async (req, res) => {
    const body = req.body;
    if (body.object === "page") {
      for (const entry of body.entry) {
        const event = entry.messaging[0];
        if (event.message && event.message.text) {
          const senderId = event.sender.id;
          const userMessage = event.message.text;
          console.log(`Mensagem de ${senderId}: ${userMessage}`);

          try {
            const botResponse = await callGemini(userMessage);
            await sendMessengerMessage(senderId, botResponse || "Desculpe, tente novamente.");
          } catch (e) { console.error(e); }
        }
      }
      res.status(200).send("EVENT_RECEIVED");
    } else { res.sendStatus(404); }
  });

  // APIs de Administração
  app.get("/api/materials", async (req, res) => res.json(await readJsonFile(materialsPath, [])));
  app.post("/api/materials", async (req, res) => { await writeJsonFile(materialsPath, req.body); res.json({success: true}); });
  app.get("/api/campaigns", async (req, res) => res.json(await readJsonFile(campaignsPath, [])));
  app.post("/api/campaigns", async (req, res) => { await writeJsonFile(campaignsPath, req.body); res.json({success: true}); });

  // Frontend (Vite ou Estático)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => console.log(`Servidor Aventour rodando na porta ${PORT}`));
}

startServer();