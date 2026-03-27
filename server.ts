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
  const text = messageText.toLowerCase().trim();

  // SAUDAÇÃO
  if (
    text === "oi" ||
    text === "olá" ||
    text === "ola" ||
    text === "bom dia" ||
    text === "boa tarde" ||
    text === "boa noite"
  ) {
    return {
      replyText:
        "Olá. Bem-vindo à Aventour Viagens e Turismo. Posso ajudar com passagem, reserva de hotel, visto, formação, agendamento, endereço ou contactos.",
      notify: false,
    };
  }

  // ENDEREÇO / LOCALIZAÇÃO
  if (
    text.includes("endereço") ||
    text.includes("endereco") ||
    text.includes("onde fica") ||
    text.includes("localização") ||
    text.includes("localizacao") ||
    text.includes("morada")
  ) {
    return {
      replyText:
        "Estamos localizados em Achada São Filipe, Praia, ao lado de Calú e Angela.",
      notify: false,
    };
  }

  // WHATSAPP / TELEFONE / CONTACTO
  if (
    text.includes("whatsapp") ||
    text.includes("telefone") ||
    text.includes("número") ||
    text.includes("numero") ||
    text.includes("contacto") ||
    text.includes("contato") ||
    text.includes("telemóvel") ||
    text.includes("telemovel")
  ) {
    return {
      replyText:
        "Pode falar connosco pelo WhatsApp +238 913 23 75.",
      notify: false,
    };
  }

  // EMAIL
  if (
    text.includes("email") ||
    text.includes("e-mail")
  ) {
    return {
      replyText:
        "O nosso email é reservas@viagensaventour.com.",
      notify: false,
    };
  }

  // DADOS BANCÁRIOS / PAGAMENTO
  if (
    text.includes("dados bancários") ||
    text.includes("dados bancarios") ||
    text.includes("iban") ||
    text.includes("nib") ||
    text.includes("conta") ||
    text.includes("dados de pagamento") ||
    text.includes("pagamento online") ||
    text.includes("transferência") ||
    text.includes("transferencia")
  ) {
    return {
      replyText:
        "Posso enviar os dados bancários para pagamento. Deseja receber agora?",
      notify: true,
      notifySubject: "Pedido de dados bancários",
    };
  }

  // DOCUMENTOS CONTRATO
  if (
    text.includes("documentos contrato") ||
    text.includes("docs contrato") ||
    text.includes("visto contrato") ||
    text.includes("documentos para contrato")
  ) {
    return {
      replyText:
        "Posso enviar a lista completa de documentos para visto por contrato de trabalho. Deseja receber agora?",
      notify: true,
      notifySubject: "Pedido de documentos contrato",
    };
  }

  // DOCUMENTOS ESTUDANTE
  if (
    text.includes("documentos estudante") ||
    text.includes("docs estudante") ||
    text.includes("visto estudante") ||
    text.includes("documentos para estudante")
  ) {
    return {
      replyText:
        "Posso enviar a lista completa de documentos para visto de estudante. Deseja receber agora?",
      notify: true,
      notifySubject: "Pedido de documentos estudante",
    };
  }

  // DOCUMENTOS TURISMO / FÉRIAS
  if (
    text.includes("documentos turismo") ||
    text.includes("docs turismo") ||
    text.includes("visto turismo") ||
    text.includes("documentos férias") ||
    text.includes("documentos ferias") ||
    text.includes("docs férias") ||
    text.includes("docs ferias") ||
    text.includes("documentos para férias") ||
    text.includes("documentos para ferias")
  ) {
    return {
      replyText:
        "Posso enviar a lista completa de documentos para visto de turismo ou férias. Deseja receber agora?",
      notify: true,
      notifySubject: "Pedido de documentos turismo",
    };
  }

  // RESERVA DE PASSAGEM - DEVE VIR ANTES DE PASSAGEM
  if (
    text.includes("reserva de passagem") ||
    text.includes("reservar vaga") ||
    text.includes("bloquear vaga") ||
    text.includes("garantir vaga")
  ) {
    return {
      replyText:
        "A reserva de passagem tem o custo de 1.000 CVE. Este valor garante a vaga temporariamente enquanto finalizamos a emissão do bilhete.",
      notify: true,
      notifySubject: "Interesse em reserva de passagem",
    };
  }

  // PASSAGEM AÉREA
  if (
    text.includes("preço") ||
    text.includes("preco") ||
    text.includes("passagem") ||
    text.includes("voo") ||
    text.includes("viajar") ||
    text.includes("bilhete")
  ) {
    return {
      replyText:
        "Para verificar a melhor opção disponível para a sua viagem, indique por favor o destino, a data da viagem e o número de pessoas.",
      notify: true,
      notifySubject: "Novo pedido de passagem",
    };
  }

  // HOTEL
  if (
    text.includes("hotel") ||
    text.includes("reserva hotel") ||
    text.includes("reserva de hotel")
  ) {
    return {
      replyText:
        "A reserva de hotel tem o custo de 60 CVE por dia. Indique por favor a data de entrada e a data de saída para calcularmos o valor total.",
      notify: true,
      notifySubject: "Novo interesse em reserva de hotel",
    };
  }

  // AGENDAMENTO GERAL
  if (
    text.includes("agendamento") ||
    text.includes("agendar") ||
    text.includes("marcar")
  ) {
    return {
      replyText:
        "Temos agendamento para férias, estudante e contrato. Diga por favor qual é o tipo de agendamento que pretende.",
      notify: true,
      notifySubject: "Novo pedido de agendamento",
    };
  }

  // FÉRIAS
  if (
    text.includes("férias") ||
    text.includes("ferias") ||
    text.includes("turismo")
  ) {
    return {
      replyText:
        "O agendamento de férias tem o valor total de 20.000 CVE: 5.000 CVE para garantir a vaga e 15.000 CVE quando o agendamento estiver pronto. Inclui reserva de passagem e reserva de hotel.",
      notify: true,
      notifySubject: "Interesse em agendamento de férias",
    };
  }

  // ESTUDANTE / FORMAÇÃO
  if (
    text.includes("estudante") ||
    text.includes("formação") ||
    text.includes("formacao") ||
    text.includes("curso") ||
    text.includes("cursos")
  ) {
    return {
      replyText:
        "Para formações em Portugal, indique por favor a sua idade e escolaridade para verificarmos a elegibilidade.",
      notify: true,
      notifySubject: "Interesse em formação ou estudante",
    };
  }

  // CONTRATO
  if (
    text.includes("contrato") ||
    text.includes("trabalho")
  ) {
    return {
      replyText:
        "O agendamento para contrato é destinado a maiores de 18 anos e o atendimento é presencial. Se pretende avançar, confirme por favor a sua idade.",
      notify: true,
      notifySubject: "Interesse em agendamento de contrato",
    };
  }

  // VISTO / DOCUMENTOS GERAIS
  if (
    text.includes("visto") ||
    text.includes("documentos") ||
    text.includes("docs") ||
    text.includes("papéis") ||
    text.includes("papeis")
  ) {
    return {
      replyText:
        "Posso orientar o seu processo. Diga-me por favor se pretende férias, contrato ou estudante.",
      notify: true,
      notifySubject: "Pedido de informação sobre visto ou documentos",
    };
  }

  // OUTRAS ILHAS
  if (
    text.includes("outras ilhas") ||
    text.includes("fora de santiago") ||
    text.includes("ilhas")
  ) {
    return {
      replyText:
        "Para atendimento noutras ilhas fora de Santiago, trabalhamos com grupo mínimo de 20 pessoas. O pagamento é 10.000 CVE de reserva antecipada e 20.000 CVE no dia do atendimento.",
      notify: true,
      notifySubject: "Interesse em atendimento noutras ilhas",
    };
  }

  // CONFIRMAÇÃO SIM
  if (
    text === "sim" ||
    text === "quero" ||
    text === "pode enviar" ||
    text === "manda" ||
    text === "envia"
  ) {
    return {
      replyText:
        "Perfeito. Diga por favor se pretende receber dados bancários, documentos para estudante, documentos para contrato ou documentos para turismo.",
      notify: false,
    };
  }

  // RESPOSTA PADRÃO
  return {
    replyText:
      "Obrigado pela sua mensagem. Posso ajudar com passagem, reserva de hotel, visto, formação, agendamento, endereço, contactos, dados bancários e documentos. Diga por favor o serviço que pretende.",
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
app.get("/privacy-policy", (_req, res) => {
  res.status(200).type("html").send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Política de Privacidade - Aventour Viagens e Turismo</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 0 16px;">
      <h1>Política de Privacidade - Aventour Viagens e Turismo</h1>

      <p>A Aventour Viagens e Turismo recolhe e processa dados enviados pelos utilizadores através do website, Messenger e outros canais de contacto para responder a pedidos de informação, reservas, agendamentos e apoio ao cliente.</p>

      <h2>Dados que podemos recolher</h2>
      <ul>
        <li>Nome</li>
        <li>Telefone</li>
        <li>Email</li>
        <li>Conteúdo das mensagens enviadas</li>
        <li>Documentos enviados pelo cliente quando necessários ao processo</li>
      </ul>

      <h2>Como usamos os dados</h2>
      <ul>
        <li>Responder pedidos de informação</li>
        <li>Processar reservas e agendamentos</li>
        <li>Prestar apoio ao cliente</li>
        <li>Melhorar o atendimento</li>
      </ul>

      <h2>Partilha de dados</h2>
      <p>Não vendemos dados pessoais. Os dados só podem ser partilhados quando necessário para prestação do serviço ou cumprimento de obrigações legais.</p>

      <h2>Remoção de dados</h2>
      <p>O utilizador pode solicitar a remoção dos seus dados através do email abaixo.</p>

      <h2>Contacto</h2>
      <p>reservas@viagensaventour.com</p>

      <p><strong>Última atualização:</strong> 27 de março de 2026</p>
    </body>
    </html>
  `);
});

app.get("/data-deletion", (_req, res) => {
  res.status(200).type("html").send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Remoção de Dados - Aventour Viagens e Turismo</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 0 16px;">
      <h1>Instruções para Remoção de Dados</h1>

      <p>Se deseja solicitar a remoção dos seus dados do sistema da Aventour, envie um email para:</p>

      <p><strong>reservas@viagensaventour.com</strong></p>

      <p>Inclua no pedido:</p>
      <ul>
        <li>Nome utilizado no contacto</li>
        <li>Data aproximada da conversa</li>
      </ul>

      <p>A sua solicitação será processada no prazo máximo de 7 dias.</p>
    </body>
    </html>
  `);
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