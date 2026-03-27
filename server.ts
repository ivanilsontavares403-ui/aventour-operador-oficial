import fs from "fs/promises";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
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

async function sendMessengerMessage(recipientId: string, text: string) {
  const url = `https://graph.facebook.com/v23.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error("Erro ao enviar para Messenger:", result);
    throw new Error("Falha ao enviar mensagem ao Messenger");
  }

  return result;
}

function buildReply(messageText: string) {
  const text = messageText.toLowerCase();

  if (
    text.includes("preço") ||
    text.includes("preco") ||
    text.includes("passagem") ||
    text.includes("voo") ||
    text.includes("viajar")
  ) {
    return {
      replyText:
        "Já recebemos o seu pedido. Para avançar, indique por favor o destino, a data da viagem e o número de pessoas.",
      notify: true,
      notifySubject: "Novo pedido de passagem",
    };
  }

  if (
    text.includes("hotel") ||
    text.includes("reserva de hotel")
  ) {
    return {
      replyText:
        "A reserva de hotel tem o custo de 60 CVE por dia. Indique por favor a data de entrada e a data de saída para calcularmos o valor total.",
      notify: true,
      notifySubject: "Novo interesse em reserva de hotel",
    };
  }

  if (
    text.includes("visto") ||
    text.includes("documentos")
  ) {
    return {
      replyText:
        "Posso orientar o seu processo. Diga-me por favor se pretende férias, contrato ou estudante.",
      notify: false,
    };
  }

  return {
    replyText:
      "Obrigado pela sua mensagem. Indique por favor o serviço que pretende: passagem, reserva de hotel, visto, formação ou agendamento.",
    notify: false,
  };
}

// WEBHOOK VERIFY
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "aventour_token_123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WEBHOOK RECEIVE
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "page") {
      return res.sendStatus(404);
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo || event.delivery || event.read) continue;

        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        if (!senderId || !messageText) continue;

        console.log("Mensagem recebida do Messenger:", messageText);

        const processResponse = await fetch(`http://127.0.0.1:${PORT}/api/process-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: messageText,
            senderId,
            channel: "messenger",
          }),
        });

        const data = await processResponse.json();

        await sendMessengerMessage(senderId, data.replyText);
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error);
    return res.sendStatus(500);
  }
});

// CÉREBRO CENTRAL
app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId, channel } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Texto obrigatório" });
    }

    const result = buildReply(text);

    if (result.notify) {
      await fetch(`http://127.0.0.1:${PORT}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: result.notifySubject || "Nova mensagem recebida",
          body: `Canal: ${channel}\nSender: ${senderId}\nMensagem: ${text}`,
        }),
      });
    }

    return res.json({
      replyText: result.replyText,
    });
  } catch (error) {
    console.error("Erro em /api/process-message:", error);
    return res.status(500).json({
      replyText:
        "Tivemos um problema técnico. Por favor, tente novamente em instantes.",
    });
  }
});

// EMAIL
app.post("/api/notify", async (req, res) => {
  try {
    const { subject, body } = req.body;

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject,
      text: body,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao enviar email:", error);
    return res.status(500).json({ success: false });
  }
});

// MATERIALS
app.get("/api/materials", async (_req, res) => {
  const materials = await readJsonFile(materialsPath, []);
  res.json(materials);
});

app.post("/api/materials", async (req, res) => {
  await writeJsonFile(materialsPath, req.body);
  res.json({ success: true });
});

// CAMPAIGNS
app.get("/api/campaigns", async (_req, res) => {
  const campaigns = await readJsonFile(campaignsPath, []);
  res.json(campaigns);
});

app.post("/api/campaigns", async (req, res) => {
  await writeJsonFile(campaignsPath, req.body);
  res.json({ success: true });
});

// FRONTEND
async function start() {
  await ensureDataFiles();

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
    console.log(`Servidor em http://localhost:${PORT}`);
  });
}

start();