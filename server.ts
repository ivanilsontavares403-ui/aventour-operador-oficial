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

// Email Transporter Setup
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

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(materialsPath);
  } catch {
    await fs.writeFile(materialsPath, JSON.stringify([], null, 2), "utf-8");
  }

  try {
    await fs.access(campaignsPath);
  } catch {
    await fs.writeFile(campaignsPath, JSON.stringify([], null, 2), "utf-8");
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, data: T) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// --- Gemini & Messenger Integration ---

interface Campaign {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  context: string;
  serviceType: string;
  active: boolean;
  createdAt: Date;
}

interface Material {
  id: string;
  title: string;
  category: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  createdAt: Date;
}

const getSystemInstruction = (campaigns: Campaign[], materials: Material[]) => {
  const activeCampaigns = campaigns.filter(c => c.active).map(c => `- ${c.title}: ${c.context} (Keywords: ${c.keywords.join(', ')})`).join('\n');
  const availableMaterials = materials.map(m => `- ${m.title} (${m.category})`).join('\n');

  return `Você é um Consultor Comercial profissional da agência Aventour Viagens e Turismo.
Fale sempre como um ser humano, de forma natural, prestativa e comercial.

REGRAS DE LINGUAGEM E COMPORTAMENTO:
- NUNCA use expressões automáticas como: "Cliente Web", "verificar no chat", "estou a processar sistema", "consultar base interna", "aguarde processamento".
- Use linguagem comercial natural: "Já verifiquei a melhor opção disponível", "Posso preparar a sua reserva", "Vamos avançar com a emissão", "Posso garantir a vaga para si".
- NUNCA ofereça dados de pagamento ou IBAN de forma proativa. Primeiro, construa confiança, sugira que o cliente venha pessoalmente à agência (Achada São Filipe). 
- Só envie os dados de pagamento se o cliente pedir explicitamente para pagar online ou pedir o IBAN/dados bancários/lista de documentos.
- Nunca use emojis.
- Responda de forma direta, clara e profissional.
- O sistema enviará imagens de documentos/IBAN automaticamente quando você confirmar que está enviando. NUNCA escreva listas de documentos ou dados bancários no texto.

SERVIÇOS E REGRAS DE ELEGIBILIDADE (NUNCA MISTURE):

1. PASSAGEM AÉREA (ASSUNTO PRINCIPAL):
- É a emissão real do bilhete. O valor depende sempre da data e disponibilidade.
- NUNCA dê um preço fixo (como 1.000 CVE ou 600 CVE).
- Fluxo: Peça Destino, Data e Número de Pessoas.
- Resposta após dados: "Já verifiquei a melhor opção disponível para a sua viagem. Vou confirmar os valores atualizados e já lhe respondo."
- Documentos necessários: Nome completo (conforme passaporte), Data de Nascimento, Número do Passaporte e Validade do Passaporte. (NUNCA peça NIF para passagens).

2. RESERVA DE PASSAGEM:
- Custo: 1.000 CVE.
- Serve APENAS para bloquear/garantir a vaga temporariamente enquanto se finaliza a emissão. Não é o bilhete.
- Resposta: "A reserva de passagem tem o custo de 1.000 CVE. Este valor garante a vaga temporariamente enquanto finalizamos a emissão do bilhete."

3. RESERVA DE HOTEL:
- Custo: 60 CVE por dia.
- Fluxo: Peça Data de Entrada e Data de Saída para calcular o valor.
- Resposta: "A reserva de hotel tem o custo de 60 CVE por dia. Indique por favor a data de entrada e a data de saída para calcularmos o valor total."
- NUNCA confunda com processo de visto ou pacote de agendamento.

4. FORMAÇÕES EM PORTUGAL (FLUXO OBRIGATÓRIO):
- NUNCA misture com agendamento estudante. Agendamento só ocorre APÓS a emissão da declaração de matrícula.
- NUNCA apresente valores de 12.500 CVE ou 4.440 CVE nesta fase (são exclusivos do agendamento).
- ORDEM DO PROCESSO (Siga RIGOROSAMENTE esta sequência, uma etapa de cada vez. NUNCA pule etapas):
  1. Diagnóstico: Pergunte APENAS Idade e Escolaridade. Aguarde a resposta do cliente.
  2. Elegibilidade e Escolha do Curso: Se elegível (18+ anos e 9º ano+), apresente a lista de cursos e pergunte qual o cliente pretende seguir. Aguarde a escolha do curso.
     - Cursos: Auxiliar de Ação Educativa, Auxiliar de Ação Médica, Profissional de Turismo, Marketing Digital, Assistente de Contabilidade, Assistente Administrativo.
  3. Informação de Preço: Após o cliente escolher o curso, informe APENAS o valor: "O valor total do investimento é de 45.000 CVE (6.000 CVE de inscrição + 39.000 CVE de declaração de matrícula). Em Portugal pagará apenas os 300€ restantes para concluir. Não há mensalidades. Podemos avançar para o próximo passo?". Aguarde o cliente confirmar.
  4. Procedimento (Apresente exatamente assim APENAS quando o cliente confirmar que quer avançar após saber o preço):
     Então vamos avançar com o próximo passo 👍

     1️⃣ Documentos necessários
     Para iniciar, envia:
     Passaporte
     CNI
     NIF
     Certificado do 9º ano apostilado
     📤 Envio dos documentos
     📧 Email: reservas@viagensaventour.com
     📱 WhatsApp: +238 913 23 75
     (ou podes entregar presencialmente na agência)
     2️⃣ Duração da formação
     📚 1 ano
     📍 Aulas teóricas em Lisboa
     🎓 Estágio incluído
     3️⃣ Pagamento
     💰 45.000 CVE, dividido em:
     6.000 CVE – inscrição
     39.000 CVE – declaração de matrícula
     (já inclui metade do curso paga)
     📌 O valor de 39.000 CVE é recebido apenas em cheque ou dinheiro (presencialmente).
     📌 Em Portugal, pagas apenas 300 € para concluir o valor total do curso.
     📌 Não há mensalidades.
     Assim que enviares os documentos, confirmamos tudo e damos seguimento à inscrição.
     Diz-me quando consegues enviar que eu acompanho passo a passo 😊

  5. DOCUMENTOS VISTO: Se o cliente pedir documentos para o visto ou papéis para o visto, confirme o envio APENAS se a matrícula já estiver confirmada ou se ele pedir explicitamente por "visto". O sistema enviará "Documentos para Visto de Estudante".
  6. NUNCA envie documentos de visto durante a fase de inscrição inicial.
  7. Agendamento: Somente após a matrícula concluída.

5. AGENDAMENTO ESTUDANTE / CONTRATO:
- Permitido APENAS para 18 anos ou mais. NUNCA para menores.
- Valor: 12.500 CVE (serviço) + 4.440 CVE (taxa consular).
- Atendimento presencial obrigatório.

6. AGENDAMENTO FÉRIAS:
- Valor total: 20.000 CVE (5.000 CVE reserva + 15.000 CVE após confirmação).
- Inclui: reserva de passagem e reserva de hotel.
- Menores de idade podem fazer este processo apenas com responsáveis legais.

REGRAS PARA MENORES DE IDADE:
- Menores NÃO fazem: agendamento estudante, agendamento contrato ou formações.
- Menores APENAS podem fazer: processo de férias com responsáveis legais.

OUTRAS ILHAS (FORA DE SANTIAGO):
- Grupo mínimo: 20 pessoas.
- Pagamento: 10.000 CVE reserva antecipada + 20.000 CVE no dia do atendimento.

REGRAS DE INTERPRETAÇÃO:
- Se o cliente pedir "preço", "quanto custa", "voo", "viajar" -> Trate como PASSAGEM AÉREA.
- Só trate como RESERVA DE PASSAGEM se o cliente disser explicitamente "reservar vaga", "bloquear", "garantir vaga".

IDENTIDADE:
- Localização: Achada São Filipe, Praia (ao lado de Calú e Angela).
- WhatsApp: +238 913 23 75.
- Email: reservas@viagensaventour.com.

CAMPANHAS ATIVAS:
${activeCampaigns}

MATERIAIS DISPONÍVEIS (Envio automático via sistema):
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
    config: {
      systemInstruction: getSystemInstruction(campaigns, materials),
    },
  });

  return response.text;
}

async function sendMessengerMessage(recipientId: string, text: string) {
  const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  
  if (!PAGE_ACCESS_TOKEN) {
    console.warn("MESSENGER_PAGE_ACCESS_TOKEN is missing. Message logged to console.");
    console.log(`[MESSENGER TO ${recipientId}]: ${text}`);
    return;
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    const result = await response.json() as any;

    if (response.ok) {
      console.log(`[SUCESSO]: Mensagem enviada para ${recipientId}`);
    } else {
      console.error(`[ERRO META]:`, JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error("[ERRO REDE]: Falha ao conectar com a API da Meta:", error);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000; // Hardcoded to 3000 as per platform requirements

  await ensureDataFiles();

  app.use(express.json({ limit: "50mb" }));

  // Webhook verification for Meta
  app.get("/webhook", (req, res) => {
    const VERIFY_TOKEN = "aventour_token_123";

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // Messenger Webhook POST
  app.post("/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        if (webhookEvent.message && webhookEvent.message.text) {
          const userMessage = webhookEvent.message.text;
          console.log(`[MESSENGER FROM ${senderId}]: ${userMessage}`);

          try {
            const botResponse = await callGemini(userMessage);
            await sendMessengerMessage(senderId, botResponse || "Desculpe, tive um problema ao processar sua mensagem.");
          } catch (error) {
            console.error("Gemini Error in Webhook:", error);
            await sendMessengerMessage(senderId, "Desculpe, estou com dificuldades técnicas no momento.");
          }
        }
      }
      res.status(200).send("EVENT_RECEIVED");
    } else {
      res.sendStatus(404);
    }
  });

  // Email notification route
  app.post("/api/notify", async (req, res) => {
    const { subject, body } = req.body;
    const recipient = "reservas@viagensaventour.com";

    console.log(`[EMAIL NOTIFICATION] To: ${recipient}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: `"Aventour Bot" <${process.env.SMTP_USER}>`,
          to: recipient,
          subject,
          text: body,
        });
        console.log("Email sent successfully.");
      } catch (error) {
        console.error("Failed to send real email:", error);
      }
    } else {
      console.log("SMTP credentials not provided. Email logged to console.");
    }

    res.json({ success: true, message: "Notificação processada." });
  });

  // Materials API
  app.get("/api/materials", async (_req, res) => {
    const materials = await readJsonFile(materialsPath, []);
    res.json(materials);
  });

  app.post("/api/materials", async (req, res) => {
    const materials = req.body;
    await writeJsonFile(materialsPath, materials);
    res.json({ success: true });
  });

  // Campaigns API
  app.get("/api/campaigns", async (_req, res) => {
    const campaigns = await readJsonFile(campaignsPath, []);
    res.json(campaigns);
  });

  app.post("/api/campaigns", async (req, res) => {
    const campaigns = req.body;
    await writeJsonFile(campaignsPath, campaigns);
    res.json({ success: true });
  });

  // Frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();