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
const sessionsPath = path.join(dataDir, "sessions.json");

type SessionStatus = "none" | "waiting_human" | "closed";

type ServiceType =
  | "none"
  | "formacao"
  | "ferias"
  | "agendamento_consular"
  | "passagem";

type ClientSession = {
  senderId: string;
  status: SessionStatus;
  service: ServiceType;
  step: string;
  data: Record<string, string>;
  updatedAt: string;
};

type SessionsMap = Record<string, ClientSession>;

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });

  const files = [
    { path: materialsPath, initial: [] },
    { path: campaignsPath, initial: [] },
    { path: sessionsPath, initial: {} },
  ];

  for (const file of files) {
    try {
      await fs.access(file.path);
    } catch {
      await fs.writeFile(file.path, JSON.stringify(file.initial, null, 2), "utf-8");
    }
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

async function getAllSessions(): Promise<SessionsMap> {
  return await readJsonFile<SessionsMap>(sessionsPath, {});
}

async function getClientSession(senderId: string): Promise<ClientSession> {
  const sessions = await getAllSessions();

  if (!sessions[senderId]) {
    sessions[senderId] = {
      senderId,
      status: "none",
      service: "none",
      step: "",
      data: {},
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(sessionsPath, sessions);
  }

  return sessions[senderId];
}

async function saveClientSession(session: ClientSession) {
  const sessions = await getAllSessions();
  sessions[session.senderId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(sessionsPath, sessions);
}

function resetSession(session: ClientSession): ClientSession {
  return {
    ...session,
    status: "none",
    service: "none",
    step: "",
    data: {},
    updatedAt: new Date().toISOString(),
  };
}

async function notifyLead(subject: string, body: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject,
      text: body,
    });
  } catch (error) {
    console.error("Erro ao enviar email:", error);
  }
}

async function sendMessengerMessage(recipientId: string, text: string) {
  const token = process.env.PAGE_ACCESS_TOKEN;

  if (!token) {
    throw new Error("PAGE_ACCESS_TOKEN não configurado");
  }

  const url = `https://graph.facebook.com/v23.0/me/messages?access_token=${token}`;

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

function isYes(text: string) {
  const t = text.toLowerCase().trim();
  return ["sim", "quero", "pode", "pode sim", "vamos", "ok", "avançar", "avancar"].includes(t);
}

function isNo(text: string) {
  const t = text.toLowerCase().trim();
  return ["não", "nao", "agora não", "agora nao", "depois", "talvez"].includes(t);
}

function buildMainMenu() {
  return (
    "Posso ajudar com os seguintes serviços:\n\n" +
    "1. Formação em Portugal\n" +
    "2. Agendamento de férias\n" +
    "3. Agendamento estudante ou contrato\n" +
    "4. Passagens\n\n" +
    "Qual serviço pretende?"
  );
}

async function handoffToHuman(session: ClientSession, summary: string) {
  session.status = "waiting_human";
  await saveClientSession(session);

  await notifyLead(
    `Lead pronto para atendimento humano - ${session.service}`,
    `Sender ID: ${session.senderId}\n` +
      `Serviço: ${session.service}\n` +
      `Etapa: ${session.step}\n` +
      `Dados:\n${JSON.stringify(session.data, null, 2)}\n\n` +
      `Resumo:\n${summary}`
  );
}

async function handleFlow(senderId: string, messageText: string): Promise<string> {
  const session = await getClientSession(senderId);
  const text = messageText.toLowerCase().trim();

  if (text === "reiniciar") {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return "A conversa foi reiniciada. " + buildMainMenu();
  }

  if (session.status === "waiting_human") {
    return (
      "O seu pedido já foi encaminhado para a nossa equipa comercial. " +
      "Se quiser reiniciar e tratar outro serviço, escreva reiniciar. Qual serviço pretende agora?"
    );
  }

  // MENU INICIAL / DETEÇÃO DE SERVIÇO
  if (session.status === "none" || session.service === "none" || !session.step) {
    // Formação
    if (
      text.includes("formação") ||
      text.includes("formacao") ||
      text.includes("estudar") ||
      text.includes("curso") ||
      text.includes("cursos")
    ) {
      session.service = "formacao";
      session.step = "formacao_idade";
      await saveClientSession(session);
      return "Ficamos felizes pelo seu interesse em estudar em Portugal. Qual é a sua idade?";
    }

    // Férias
    if (
      text.includes("férias") ||
      text.includes("ferias") ||
      text.includes("turismo") ||
      text.includes("agendamento de férias") ||
      text.includes("agendamento de ferias")
    ) {
      session.service = "ferias";
      session.step = "ferias_tipo_pessoa";
      await saveClientSession(session);
      return (
        "O agendamento de férias tem o valor total de 20.000 CVE: 5.000 CVE para garantir a vaga e 15.000 CVE quando o agendamento estiver pronto. " +
        "Inclui reserva de passagem e hotel. É para si ou para outra pessoa?"
      );
    }

    // Estudante / Contrato
    if (
      text.includes("agendamento estudante") ||
      text.includes("agendamento contrato") ||
      text.includes("contrato") ||
      text.includes("trabalho") ||
      text.includes("consulado") ||
      text.includes("estudante")
    ) {
      session.service = "agendamento_consular";
      session.step = "agendamento_tipo";
      await saveClientSession(session);
      return "Pretende agendamento de estudante ou contrato de trabalho?";
    }

    // Passagem
    if (
      text.includes("passagem") ||
      text.includes("voo") ||
      text.includes("bilhete") ||
      text.includes("viajar")
    ) {
      session.service = "passagem";
      session.step = "passagem_destino";
      await saveClientSession(session);
      return "Para avançarmos com a cotação, indique por favor o destino.";
    }

    // Contactos rápidos
    if (
      text.includes("endereço") ||
      text.includes("endereco") ||
      text.includes("onde fica") ||
      text.includes("morada")
    ) {
      return "Estamos localizados em Achada São Filipe, Praia, ao lado de Calú e Angela. Qual serviço pretende?";
    }

    if (
      text.includes("whatsapp") ||
      text.includes("telefone") ||
      text.includes("numero") ||
      text.includes("número")
    ) {
      return "Pode falar connosco pelo WhatsApp +238 913 23 75. Qual serviço pretende?";
    }

    if (text.includes("email") || text.includes("e-mail")) {
      return "O nosso email é reservas@viagensaventour.com. Qual serviço pretende?";
    }

    return buildMainMenu();
  }

  // FLUXO FORMAÇÃO
  if (session.service === "formacao") {
    if (session.step === "formacao_idade") {
      session.data.idade = messageText;
      session.step = "formacao_escolaridade";
      await saveClientSession(session);
      return "Qual foi o último ano de escolaridade que concluiu?";
    }

    if (session.step === "formacao_escolaridade") {
      session.data.escolaridade = messageText;
      session.step = "formacao_curso";
      await saveClientSession(session);
      return (
        "Temos as seguintes áreas disponíveis: Auxiliar de Ação Educativa, Auxiliar de Ação Médica, Profissional de Turismo, Marketing Digital, Assistente de Contabilidade e Assistente Administrativo. " +
        "Qual dessas áreas mais lhe interessa?"
      );
    }

    if (session.step === "formacao_curso") {
      session.data.curso = messageText;
      session.step = "formacao_confirmacao_preco";
      await saveClientSession(session);
      return (
        "O valor total do investimento é de 45.000 CVE: 6.000 CVE de inscrição e 39.000 CVE de declaração de matrícula. " +
        "Em Portugal pagará apenas mais 300€ para concluir. Podemos avançar?"
      );
    }

    if (session.step === "formacao_confirmacao_preco") {
      if (isYes(text)) {
        session.step = "formacao_documentos";
        await saveClientSession(session);
        return (
          "Para avançar, preciso dos seguintes documentos: Passaporte, CNI, NIF e Certificado do 9º ano apostilado. " +
          "Assim que estiver com tudo pronto, diga-me e eu encaminho o seu pedido. Consegue reunir esses documentos?"
        );
      }

      if (isNo(text)) {
        const clean = resetSession(session);
        await saveClientSession(clean);
        return "Sem problema. Quando quiser avançar, estarei disponível. Pretende tratar outro serviço?";
      }

      return "Para eu continuar corretamente, diga-me por favor se deseja avançar com a formação. Podemos seguir?";
    }

    if (session.step === "formacao_documentos") {
      session.data.documentos_confirmados = messageText;
      await handoffToHuman(
        session,
        `Cliente pronto para avançar com Formação Portugal.\nCurso: ${session.data.curso}\nIdade: ${session.data.idade}\nEscolaridade: ${session.data.escolaridade}`
      );
      return (
        "Perfeito. O seu processo já foi encaminhado para a nossa equipa comercial para seguimento da inscrição. " +
        "Se quiser reiniciar e tratar outro serviço, escreva reiniciar. Pretende mais alguma informação?"
      );
    }
  }

  // FLUXO FÉRIAS
  if (session.service === "ferias") {
    if (session.step === "ferias_tipo_pessoa") {
      session.data.para_quem = messageText;
      session.step = "ferias_email";
      await saveClientSession(session);
      return "Indique por favor o email para darmos seguimento ao agendamento.";
    }

    if (session.step === "ferias_email") {
      session.data.email = messageText;
      session.step = "ferias_telefone";
      await saveClientSession(session);
      return "Indique por favor o número de telefone.";
    }

    if (session.step === "ferias_telefone") {
      session.data.telefone = messageText;
      session.step = "ferias_trabalho";
      await saveClientSession(session);
      return "Indique por favor o local de trabalho.";
    }

    if (session.step === "ferias_trabalho") {
      session.data.local_trabalho = messageText;
      session.step = "ferias_morada";
      await saveClientSession(session);
      return "Indique por favor a morada completa.";
    }

    if (session.step === "ferias_morada") {
      session.data.morada = messageText;
      await handoffToHuman(
        session,
        `Cliente pronto para Agendamento de Férias.\nPara: ${session.data.para_quem}\nEmail: ${session.data.email}\nTelefone: ${session.data.telefone}\nLocal de trabalho: ${session.data.local_trabalho}\nMorada: ${session.data.morada}`
      );
      return (
        "Perfeito. Já registámos os seus dados para o agendamento de férias. " +
        "A nossa equipa comercial dará seguimento para garantir a vaga. Pretende mais alguma informação?"
      );
    }
  }

  // FLUXO AGENDAMENTO ESTUDANTE / CONTRATO
  if (session.service === "agendamento_consular") {
    if (session.step === "agendamento_tipo") {
      session.data.tipo_agendamento = messageText;
      session.step = "agendamento_disponibilidade";
      await saveClientSession(session);
      return (
        "Este processo é presencial e deve comparecer à Aventour com o passaporte original. " +
        "Os valores são 4.440 CVE da taxa consular e 12.500 CVE do serviço. Qual é a sua disponibilidade para marcarmos o dia?"
      );
    }

    if (session.step === "agendamento_disponibilidade") {
      session.data.disponibilidade = messageText;
      await handoffToHuman(
        session,
        `Cliente pronto para agendamento consular.\nTipo: ${session.data.tipo_agendamento}\nDisponibilidade: ${session.data.disponibilidade}`
      );
      return (
        "Perfeito. A sua disponibilidade já foi encaminhada para a nossa equipa comercial, que vai orientar o próximo passo do atendimento presencial. " +
        "Pretende mais alguma informação?"
      );
    }
  }

  // FLUXO PASSAGEM
  if (session.service === "passagem") {
    if (session.step === "passagem_destino") {
      session.data.destino = messageText;
      session.step = "passagem_data";
      await saveClientSession(session);
      return "Indique por favor a data da viagem.";
    }

    if (session.step === "passagem_data") {
      session.data.data_viagem = messageText;
      session.step = "passagem_pessoas";
      await saveClientSession(session);
      return "Indique por favor o número de pessoas.";
    }

    if (session.step === "passagem_pessoas") {
      session.data.numero_pessoas = messageText;
      await handoffToHuman(
        session,
        `Cliente pediu cotação de passagem.\nDestino: ${session.data.destino}\nData: ${session.data.data_viagem}\nPessoas: ${session.data.numero_pessoas}`
      );
      return (
        "Perfeito. Já registámos o seu pedido de passagem e a nossa equipa comercial vai verificar o valor atualizado. " +
        "Assim que possível, daremos seguimento. Pretende mais alguma informação?"
      );
    }
  }

  return "Não consegui avançar corretamente com o seu pedido. Escreva reiniciar para começarmos de novo. Qual serviço pretende?";
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

// DEDUP BÁSICO EM MEMÓRIA
const processedMessageIds = new Set<string>();

function rememberMessageId(mid: string) {
  processedMessageIds.add(mid);
  setTimeout(() => processedMessageIds.delete(mid), 10 * 60 * 1000);
}

// WEBHOOK RECEIVE
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object !== "page") {
    return res.sendStatus(404);
  }

  res.sendStatus(200);

  try {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message?.is_echo) continue;
        if (event.delivery) continue;
        if (event.read) continue;

        const senderId = event.sender?.id;
        const messageText = event.message?.text;
        const mid = event.message?.mid;

        if (mid) {
          if (processedMessageIds.has(mid)) continue;
          rememberMessageId(mid);
        }

        if (!senderId || !messageText) continue;

        console.log("Mensagem recebida do Messenger:", messageText);

        try {
          const replyText = await handleFlow(senderId, messageText);
          if (replyText) {
            await sendMessengerMessage(senderId, replyText);
          }
        } catch (innerError) {
          console.error("Erro ao processar evento individual:", innerError);
        }
      }
    }
  } catch (error) {
    console.error("Erro geral no webhook:", error);
  }
});

// API CENTRAL PARA O WEB APP
app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId } = req.body;

    if (!text || !senderId) {
      return res.status(400).json({ error: "text e senderId são obrigatórios" });
    }

    const replyText = await handleFlow(String(senderId), String(text));

    return res.json({ replyText });
  } catch (error) {
    console.error("Erro em /api/process-message:", error);
    return res.status(500).json({
      replyText: "Tivemos um problema técnico. Escreva reiniciar e tente novamente. Qual serviço pretende?",
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

// PÁGINAS PÚBLICAS
app.get("/privacy-policy", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
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
  res.setHeader("Cache-Control", "no-store");
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