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