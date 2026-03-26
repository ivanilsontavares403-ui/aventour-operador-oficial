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

// Email Transporter Setup
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  await ensureDataFiles();

  app.use(express.json({ limit: "50mb" }));

  // Webhook verification (Meta envia GET aqui)
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

// Receber mensagens do Messenger (Meta envia POST aqui)
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        if (!senderId || !messageText) continue;

        console.log("Mensagem recebida:", messageText);

        let replyText =
          "Obrigado pela sua mensagem. Em instantes iremos responder.";

        const text = messageText.toLowerCase();

        if (
          text.includes("preço") ||
          text.includes("passagem") ||
          text.includes("reserva") ||
          text.includes("hotel") ||
          text.includes("visto")
        ) {
          replyText =
            "Recebemos o seu pedido. A nossa equipa comercial irá analisar e responder brevemente.";

          try {
            await fetch("http://localhost:" + process.env.PORT + "/api/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subject: "Novo lead Messenger",
                body: `Mensagem: ${messageText}\nSender: ${senderId}`,
              }),
            });
          } catch (error) {
            console.error("Erro ao enviar email:", error);
          }
        }

        try {
          await fetch(
            `https://graph.facebook.com/v23.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipient: { id: senderId },
                message: { text: replyText },
              }),
            }
          );
        } catch (error) {
          console.error("Erro ao responder Messenger:", error);
        }
      }
    }

    res.sendStatus(200);
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
  app.get("/privacy-policy", (_req, res) => {
    res.send(`
      <html>
        <head>
          <title>Política de Privacidade - Aventour</title>
        </head>
        <body style="font-family: Arial; max-width: 700px; margin: 40px auto;">
          <h1>Política de Privacidade</h1>
  
          <p>A Aventour respeita a privacidade dos seus clientes.</p>
  
          <p>Os dados recolhidos através do Messenger ou do chatbot são utilizados apenas para:</p>
          <ul>
            <li>Responder pedidos de informação</li>
            <li>Processar reservas</li>
            <li>Melhorar o atendimento ao cliente</li>
          </ul>
  
          <p>Não partilhamos dados com terceiros.</p>
  
          <p>Para qualquer questão contacte:</p>
  
          <p><b>reservas@viagensaventour.com</b></p>
        </body>
      </html>
    `);
  });
  app.get("/data-deletion", (_req, res) => {
    res.send(`
      <html>
        <head>
          <title>Remoção de Dados - Aventour</title>
        </head>
        <body style="font-family: Arial; max-width: 700px; margin: 40px auto;">
          <h1>Instruções para Remoção de Dados</h1>
          <p>Se deseja solicitar a remoção dos seus dados do sistema da Aventour, envie um email para:</p>
          <p><b>reservas@viagensaventour.com</b></p>
          <p>Inclua no pedido:</p>
          <ul>
            <li>Nome utilizado na conversa</li>
            <li>Data aproximada do contacto</li>
          </ul>
          <p>A sua solicitação será processada no prazo máximo de 7 dias.</p>
        </body>
      </html>
    `);
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