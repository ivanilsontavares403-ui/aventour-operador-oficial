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
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/notify", async (req, res) => {
    const { subject, body } = req.body;
    const recipient = "reservas@viagensaventour.com";

    console.log(`[EMAIL NOTIFICATION] To: ${recipient}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);

    // Only attempt real email if credentials are provided
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await transporter.sendMail({
          from: `"Aventour Bot" <${process.env.SMTP_USER}>`,
          to: recipient,
          subject: subject,
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
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