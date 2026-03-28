import fs from "fs/promises";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.use(express.json({ limit: "50mb" }));

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || RESEND_FROM;

const dataDir = path.join(process.cwd(), "data");
const materialsPath = path.join(dataDir, "materials.json");
const campaignsPath = path.join(dataDir, "campaigns.json");
const quotesPath = path.join(dataDir, "quotes.json");
const processedMsgsPath = path.join(dataDir, "processed_messages.json");
const notificationsPath = path.join(dataDir, "notifications.json");

type ServiceType =
  | "none"
  | "formacao"
  | "ferias"
  | "agendamento_consular"
  | "passagem"
  | "reserva_hotel"
  | "reserva_passagem";

type MaterialCategory =
  | "docs_ferias"
  | "docs_contrato"
  | "docs_estudante"
  | "dados_bancarios"
  | "precario";

type QuoteStatus = "pending" | "quoted" | "accepted" | "rejected";
type NotificationType =
  | "documentos_recebidos"
  | "lead_novo"
  | "cotacao_solicitada"
  | "pagamento_recebido"
  | "validacao_manual";

interface Material {
  id: string;
  title: string;
  category: MaterialCategory;
  fileUrl: string;
  fileType: string;
  fileName: string;
}

interface Campaign {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
  context: string;
  discount?: string;
  price?: number;
  active: boolean;
  createdAt: string;
}

interface Quote {
  id: string;
  clientId: string;
  clientName: string;
  destination: string;
  details: string;
  price?: string;
  observation?: string;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
}

interface Notification {
  id: string;
  type: NotificationType;
  clientId: string;
  clientName?: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

interface ClientSession {
  senderId: string;
  service: ServiceType;
  step: string;
  data: Record<string, string>;
  updatedAt: string;
  history: Array<{ role: "user" | "model"; text: string }>;
  quoteId?: string;
  lastIntent?: string;
  needsHuman?: boolean;
}

interface FlowResult {
  text: string;
  material?: Material;
  quote?: Quote;
}

const sessions: Record<string, ClientSession> = {};
let processedMessageIds: Set<string> = new Set();

const VALIDATION_TRIGGERS = [
  "nao entendi",
  "não entendi",
  "explica melhor",
  "quero saber melhor",
  "mais detalhes",
  "quero confirmar",
  "confirmar isso",
  "caso especial",
  "contrato",
  "vcs fazem contratos",
  "voces fazem contratos",
  "vocês fazem contratos",
  "como assim",
  "só queria saber",
  "so queria saber",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(normalize(p)));
}

function isResetCommand(text: string): boolean {
  return [
    "reiniciar",
    "recomecar",
    "recomeca",
    "comecar",
    "outro",
    "outro servico",
    "menu",
    "inicio",
    "iniciar",
  ].includes(text);
}

function menuText(): string {
  return [
    "Ola. Sou consultor comercial da Aventour Viagens.",
    "",
    "Posso ajudar com:",
    "1. Formacao em Portugal",
    "2. Agendamento de Ferias",
    "3. Agendamento Estudante/Contrato",
    "4. Passagens Aereas",
    "5. Reserva de Hotel",
    "",
    "Qual servico pretende?",
  ].join("\n");
}

function cleanForMessenger(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\*/g, "");
}

async function loadProcessedMessages() {
  try {
    const data = await fs.readFile(processedMsgsPath, "utf-8");
    processedMessageIds = new Set(JSON.parse(data));
    console.log(`Carregados ${processedMessageIds.size} IDs de mensagens processadas`);
  } catch {
    processedMessageIds = new Set();
  }
}

async function saveProcessedMessages() {
  try {
    await fs.writeFile(processedMsgsPath, JSON.stringify([...processedMessageIds]), "utf-8");
  } catch (error) {
    console.error("Erro salvando processed messages:", error);
  }
}

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const file of [materialsPath, campaignsPath, quotesPath, processedMsgsPath, notificationsPath]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, JSON.stringify([], null, 2), "utf-8");
    }
  }
  await loadProcessedMessages();
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

async function getClientSession(senderId: string): Promise<ClientSession> {
  if (!sessions[senderId]) {
    sessions[senderId] = {
      senderId,
      service: "none",
      step: "",
      data: {},
      updatedAt: new Date().toISOString(),
      history: [],
      needsHuman: false,
    };
  }
  return sessions[senderId];
}

async function saveClientSession(session: ClientSession) {
  sessions[session.senderId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
}

function resetSession(session: ClientSession): ClientSession {
  return {
    ...session,
    service: "none",
    step: "",
    data: {},
    updatedAt: new Date().toISOString(),
    history: [],
    quoteId: undefined,
    lastIntent: undefined,
    needsHuman: false,
  };
}

async function notifyLead(subject: string, body: string) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.log("Resend nao configurado, pulando email:", subject);
      return;
    }

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to: [NOTIFY_EMAIL],
      subject,
      text: body,
    });

    if (error) {
      console.error("Erro email Resend:", error);
      return;
    }

    console.log("Email enviado:", data?.id, subject);
  } catch (error) {
    console.error("Erro email:", error);
  }
}

async function notifyAppCentral(
  type: NotificationType,
  clientId: string,
  message: string,
  data?: Record<string, any>
) {
  try {
    const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
    const newNotification: Notification = {
      id: `notif_${Date.now()}`,
      type,
      clientId,
      clientName: data?.clientName || "Cliente",
      message,
      data,
      read: false,
      createdAt: new Date().toISOString(),
    };

    notifications.push(newNotification);
    await writeJsonFile(notificationsPath, notifications);

    await notifyLead(
      `App Central: ${type.replace(/_/g, " ").toUpperCase()}`,
      `Cliente: ${clientId}\nMensagem: ${message}\nDados: ${JSON.stringify(data ?? {}, null, 2)}`
    );
  } catch (error) {
    console.error("Erro criando notificacao:", error);
  }
}

async function sendMessengerMessage(recipientId: string, text: string, material?: Material) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("PAGE_ACCESS_TOKEN nao configurado");

  const url = `https://graph.facebook.com/v23.0/me/messages?access_token=${token}`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: cleanForMessenger(text) },
    }),
  });

  if (!material) return;

  if (material.fileType.startsWith("image/")) {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: { url: material.fileUrl, is_reusable: true },
          },
        },
      }),
    });
    return;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: `${material.title}: ${material.fileUrl}` },
    }),
  });
}

async function sendQuoteToClient(quoteId: string, price: string, observation?: string) {
  try {
    const quotes = await readJsonFile<Quote[]>(quotesPath, []);
    const quote = quotes.find((q) => q.id === quoteId);

    if (!quote) {
      return { success: false, error: "Cotacao nao encontrada" };
    }

    quote.price = price;
    quote.observation = observation || quote.observation;
    quote.status = "quoted";
    quote.updatedAt = new Date().toISOString();
    await writeJsonFile(quotesPath, quotes);

    let message = "Cotacao pronta.\n\n";
    message += `Destino: ${quote.destination}\n`;
    message += `Detalhes: ${quote.details}\n`;
    message += `Preco: ${price} CVE\n`;
    if (observation) message += `Observacoes: ${observation}\n`;
    message += "\nComo garantir a sua passagem:\n";
    message += "Opcao 1 - Presencial\n";
    message += "- Dirige-se a nossa agencia em Achada Sao Filipe, Praia\n";
    message += "- Faz o pagamento no local\n";
    message += "- Entrega a foto do passaporte + NIF\n";
    message += "- Emitimos imediatamente a passagem\n\n";
    message += "Opcao 2 - Online\n";
    message += "1. Envio os dados para pagamento\n";
    message += "2. Apos o pagamento, envia o comprovante\n";
    message += "3. Envia a foto do passaporte + NIF\n";
    message += "4. Emitimos imediatamente e enviamos por WhatsApp ou email\n\n";
    message += "Qual opcao prefere?";

    await sendMessengerMessage(quote.clientId, message);

    const session = await getClientSession(quote.clientId);
    if (session.quoteId === quoteId) {
      session.step = "passagem_cotacao_enviada";
      session.needsHuman = false;
      await saveClientSession(session);
    }

    return { success: true, message: "Cotacao enviada ao cliente" };
  } catch (error) {
    console.error("Erro enviando cotacao:", error);
    return { success: false, error: String(error) };
  }
}

function extractEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const digitsOnly = text.replace(/[^\d+]/g, "");
  const match = digitsOnly.match(/^\+?\d{7,15}$/);
  return match ? match[0] : null;
}

function detectIntent(text: string): { service: ServiceType; confidence: number } {
  const lower = normalize(text);
  const hasExplicitChange = [
    "quero",
    "pretendo",
    "gostaria",
    "queria",
    "desejo",
    "preciso",
    "falar de",
    "falar sobre",
  ].some((word) => lower.includes(word));

  const confidence = hasExplicitChange ? 0.96 : 0.8;

  if (lower.includes("ferias") || lower.includes("turismo") || lower.includes("lazer")) {
    return { service: "ferias", confidence };
  }

  if (
    lower.includes("formacao") ||
    lower.includes("curso") ||
    lower.includes("estudar") ||
    lower.includes("estudo em portugal")
  ) {
    return { service: "formacao", confidence };
  }

  if (
    lower.includes("passagem") ||
    lower.includes("passage") ||
    lower.includes("bilhete") ||
    lower.includes("voo") ||
    lower.includes("aviao")
  ) {
    return { service: "passagem", confidence };
  }

  if (lower.includes("hotel") || lower.includes("hospedagem") || lower.includes("alojamento")) {
    return { service: "reserva_hotel", confidence };
  }

  if (
    (lower.includes("reservar vaga") || lower.includes("garantir vaga") || lower.includes("bloquear vaga")) &&
    !lower.includes("hotel")
  ) {
    return { service: "reserva_passagem", confidence };
  }

  if (
    (lower.includes("agendamento") || lower.includes("visto") || lower.includes("consulado") || lower.includes("entrevista")) &&
    !lower.includes("ferias") &&
    !lower.includes("turismo")
  ) {
    return { service: "agendamento_consular", confidence };
  }

  return { service: "none", confidence: 0 };
}

function shouldPauseForValidation(session: ClientSession, lower: string): boolean {
  if (session.service === "none") return false;
  if (session.step === "passagem_aguardando_preco") return false;
  if (session.step === "passagem_cotacao_enviada") return false;
  return includesAny(lower, VALIDATION_TRIGGERS);
}

function isGenericSupportQuestion(lower: string): boolean {
  return [
    "onde fica",
    "morada",
    "endereco",
    "horario",
    "telefone",
    "contacto",
    "contato",
    "whatsapp",
    "pagamento",
    "como pago",
    "preco",
    "quanto custa",
    "valor",
    "documentos",
    "documento",
    "papeis",
    "prazo",
    "demora",
    "tempo",
    "servicos",
    "o que fazem",
    "fazem contratos",
    "fazem contrato",
    "como assim",
  ].some((pattern) => lower.includes(pattern));
}

function getCommonResponse(messageText: string, session: ClientSession): string | null {
  const lower = normalize(messageText);

  if (
    ["obrigado", "obrigada", "valeu", "thanks", "grato", "ok", "certo", "perfeito", "entendido"].some(
      (w) => lower === w || lower.startsWith(`${w} `)
    )
  ) {
    return [
      "De nada. Estou aqui sempre que precisar.",
      "",
      "Se quiser falar de outro servico, escreva reiniciar.",
    ].join("\n");
  }

  if (
    lower.includes("quais servicos") ||
    lower.includes("que servicos") ||
    lower.includes("o que fazem") ||
    lower.includes("servicos disponiveis")
  ) {
    return [
      "Servicos Aventour:",
      "- Passagens Aereas",
      "- Reserva de Hotel",
      "- Formacao em Portugal",
      "- Agendamento Consular",
      "- Agendamento de Ferias",
      "- Reserva de Passagem",
      "",
      "Qual servico lhe interessa?",
    ].join("\n");
  }

  if (
    lower.includes("fazem contratos") ||
    lower.includes("fazem contrato") ||
    lower.includes("vcs fazem contratos") ||
    lower.includes("vocês fazem contratos") ||
    lower.includes("voces fazem contratos")
  ) {
    return "No momento nao intermediamos contratos de trabalho diretamente. Ajudamos com agendamento consular, orientacao e acompanhamento do processo.";
  }

  if (
    lower.includes("onde fica") ||
    lower.includes("morada") ||
    lower.includes("endereco") ||
    lower.includes("achada sao filipe") ||
    lower.includes("praia")
  ) {
    return "Estamos localizados em Achada Sao Filipe, Praia, ao lado de Calu e Angela. Atendemos de segunda a sexta, das 8h as 17h.";
  }

  if (
    lower.includes("contacto") ||
    lower.includes("contato") ||
    lower.includes("telefone") ||
    lower.includes("whatsapp") ||
    lower.includes("horario")
  ) {
    return [
      "Contactos Aventour:",
      "Morada: Achada Sao Filipe, Praia (ao lado de Calu e Angela)",
      "Telefone/WhatsApp: +238 913 23 75",
      "Email: reservas@viagensaventour.com",
      "Horario: Segunda a Sexta, 8h as 17h",
    ].join("\n");
  }

  if (lower.includes("pagamento") || lower.includes("como pago") || lower.includes("transferencia") || lower.includes("deposito")) {
    if (session.service === "formacao") {
      return [
        "Pagamento da Formacao: 45.000 CVE",
        "- 6.000 CVE de inscricao",
        "- 39.000 CVE de declaracao de matricula",
        "- Os 39.000 CVE sao pagos presencialmente em cheque ou dinheiro",
        "- Em Portugal, paga apenas 300 euros para concluir",
      ].join("\n");
    }

    if (session.service === "agendamento_consular") {
      return [
        "Pagamento do Agendamento Consular:",
        "- 12.500 CVE servico Aventour",
        "- 4.440 CVE taxa consular",
        "- Total: 16.940 CVE",
      ].join("\n");
    }

    if (session.service === "passagem") {
      return [
        "Como garantir a sua passagem:",
        "Opcao 1 - Presencial na agencia",
        "Opcao 2 - Online por transferencia",
        "Apos o pagamento, precisa enviar comprovante + foto do passaporte + NIF.",
      ].join("\n");
    }

    return "Aceitamos pagamento presencial na agencia e, quando aplicavel, por transferencia bancaria.";
  }

  if (lower.includes("documentos") || lower.includes("documento") || lower.includes("papeis")) {
    if (session.service === "formacao") {
      return [
        "Documentos para Formacao:",
        "- Passaporte",
        "- CNI",
        "- NIF",
        "- Certificado do 9o ano apostilado",
      ].join("\n");
    }

    if (session.service === "agendamento_consular") {
      return [
        "Documentos para Agendamento Consular:",
        "- Passaporte original",
        "- Comprovativo de pagamento",
      ].join("\n");
    }

    return "Os documentos dependem do servico. Diga-me qual servico pretende e eu indico tudo.";
  }

  if (lower.includes("preco") || lower.includes("quanto custa") || lower.includes("valor") || lower.includes("custo")) {
    if (lower.includes("reserva de hotel") || lower.includes("hotel")) {
      return "A reserva de hotel custa 60 CVE por dia. Esse valor refere-se ao servico de reserva. O valor final da estadia depende do destino, datas e categoria do hotel.";
    }
    if (session.service === "formacao") {
      return "Formacao em Portugal: 45.000 CVE. Sao 6.000 CVE de inscricao e 39.000 CVE de declaracao de matricula.";
    }
    if (session.service === "agendamento_consular") {
      return "Agendamento Consular: 16.940 CVE no total.";
    }
    if (session.service === "ferias") {
      return "Agendamento de Ferias: 20.000 CVE. Sao 5.000 CVE de reserva e 15.000 CVE apos confirmacao.";
    }
    if (session.service === "reserva_hotel") {
      return "Reserva de Hotel: 60 CVE por dia. Esse valor e apenas do servico de reserva. O preco da estadia depende do hotel escolhido.";
    }
    if (session.service === "passagem") {
      return "O preco da passagem depende do destino, data e numero de passageiros. Posso registar a sua cotacao agora.";
    }
  }

  if (lower.includes("como assim 60 por dia") || (lower.includes("como assim") && session.service === "reserva_hotel")) {
    return "Os 60 CVE por dia referem-se ao servico de reserva do hotel. O valor da estadia em si depende do destino, das datas e da categoria do hotel escolhido.";
  }

  if (lower.includes("prazo") || lower.includes("demora") || lower.includes("tempo") || lower.includes("duracao")) {
    if (session.service === "formacao") {
      return "A formacao dura 1 ano. O processo de inscricao costuma levar cerca de 2 a 3 semanas apos entrega dos documentos.";
    }

    if (session.service === "passagem") {
      return "A cotacao de passagem normalmente e preparada em 24 a 48 horas.";
    }

    return "O prazo depende do servico. Diga-me qual servico pretende e eu informo o tempo estimado.";
  }

  return null;
}

async function startServiceFlow(session: ClientSession, service: ServiceType, senderId: string, rawLowerText: string): Promise<FlowResult> {
  session.service = service;
  session.step = "inicio";
  session.data = {};
  session.lastIntent = service;
  session.needsHuman = false;
  await saveClientSession(session);

  switch (service) {
    case "formacao":
      await notifyLead("Novo Interesse - Formacao Portugal", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      return {
        text: "Excelente escolha. As formacoes em Portugal sao uma oportunidade unica. Para verificar a elegibilidade, qual e a sua idade?",
      };

    case "passagem":
      await notifyLead("Novo Pedido - Passagem", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      return { text: "Vou preparar a melhor opcao para a sua viagem. Qual e o destino?" };

    case "ferias":
      await notifyLead("Novo Interesse - Ferias", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      return {
        text: "Perfeito. O agendamento de ferias inclui reserva de passagem e hotel por 20.000 CVE (5.000 CVE de reserva + 15.000 CVE apos confirmacao). E para si ou para outra pessoa?",
      };

    case "agendamento_consular":
      await notifyLead("Novo Interesse - Agendamento", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      if (rawLowerText.includes("contrato") && !rawLowerText.includes("agendamento") && !rawLowerText.includes("visto")) {
        return {
          text: "No momento nao intermediamos contratos de trabalho diretamente. Cuidamos do agendamento consular, orientacao e acompanhamento. E para estudante ou contrato de trabalho?",
        };
      }
      return {
        text: "Entendido. O agendamento consular requer presenca presencial na Aventour. O valor total e 16.940 CVE (12.500 CVE de servico + 4.440 CVE de taxa consular). E para estudante ou contrato de trabalho?",
      };

    case "reserva_hotel":
      await notifyLead("Novo Interesse - Hotel", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      return { text: "A reserva de hotel tem o custo de 60 CVE por dia. Quais sao as datas de entrada e saida?" };

    case "reserva_passagem":
      await notifyLead("Novo Interesse - Reserva de Passagem", `Cliente: ${senderId}\nData: ${new Date().toLocaleString()}`);
      return { text: "A reserva de passagem custa 1.000 CVE e garante a vaga temporariamente. Qual passagem pretende reservar?" };

    default:
      return { text: menuText() };
  }
}

async function handleFormacao(session: ClientSession, text: string, lower: string): Promise<FlowResult> {
  if (session.step === "inicio" || session.step === "formacao_idade") {
    const idadeNum = parseInt(text, 10);
    if (Number.isNaN(idadeNum)) {
      session.step = "formacao_idade";
      await saveClientSession(session);
      return { text: "Por favor, informe a sua idade em numeros. Exemplo: 25." };
    }

    session.data.idade = String(idadeNum);

    if (idadeNum < 18) {
      session.step = "formacao_menor";
      await saveClientSession(session);
      return {
        text: "Para menores de 18 anos, nao temos formacao direta. Pode passar na agencia para avaliarmos o caso e orientar os documentos necessarios.",
      };
    }

    session.step = "formacao_escolaridade";
    await saveClientSession(session);
    return { text: "Obrigado. Qual foi o ultimo ano de escolaridade que concluiu?" };
  }

  if (session.step === "formacao_escolaridade") {
    session.data.escolaridade = text;
    session.step = "formacao_curso";
    await saveClientSession(session);
    return {
      text: [
        "Perfeito. Temos cursos em areas com alta empregabilidade:",
        "- Auxiliar de Acao Educativa",
        "- Auxiliar de Acao Medica",
        "- Profissional de Turismo",
        "- Marketing Digital",
        "- Assistente de Contabilidade",
        "- Assistente Administrativo",
        "",
        "Qual area mais lhe interessa?",
      ].join("\n"),
    };
  }

  if (session.step === "formacao_curso") {
    session.data.curso = text;
    session.step = "formacao_confirmacao";
    await saveClientSession(session);
    return {
      text: [
        `Vamos avancar com o proximo passo para ${text}.`,
        "",
        "Documentos necessarios:",
        "- Passaporte",
        "- CNI",
        "- NIF",
        "- Certificado do 9o ano apostilado",
        "",
        "Envio dos documentos:",
        "- Email: reservas@viagensaventour.com",
        "- WhatsApp: +238 913 23 75",
        "- Ou presencialmente na agencia",
        "",
        "Duracao:",
        "- 1 ano",
        "- Aulas teoricas em Lisboa",
        "- Estagio incluido",
        "",
        "Pagamento:",
        "- 45.000 CVE no total",
        "- 6.000 CVE de inscricao",
        "- 39.000 CVE de declaracao de matricula",
        "- Os 39.000 CVE sao pagos em cheque ou dinheiro, presencialmente",
        "- Em Portugal paga apenas 300 euros para concluir",
        "- Nao ha mensalidades",
        "",
        "Assim que enviar os documentos, damos seguimento imediato.",
      ].join("\n"),
    };
  }

  if (session.step === "formacao_confirmacao") {
    if (lower.includes("pacote") || lower.includes("completo")) {
      return {
        text: "Temos tambem um pacote completo que inclui agendamento, inscricao e metade da formacao paga por 61.990 CVE. Quer optar pelo pacote completo ou pelo plano basico de 45.000 CVE?",
      };
    }

    if (lower.includes("tenho") || lower.includes("envio") || lower.includes("vou enviar") || lower.includes("manda")) {
      await notifyAppCentral(
        "documentos_recebidos",
        session.senderId,
        `Cliente tem documentos prontos para formacao - ${session.data.curso}`,
        {
          clientName: "Cliente",
          curso: session.data.curso,
          idade: session.data.idade,
          escolaridade: session.data.escolaridade,
        }
      );

      return {
        text: "Perfeito. Ja registei que tem os documentos prontos. Pode enviar por email, WhatsApp ou entregar presencialmente na agencia.",
      };
    }

    return {
      text: "Entendido. Assim que tiver os documentos prontos, envie e damos seguimento imediato. Se quiser falar de outro servico, escreva reiniciar.",
    };
  }

  return { text: "Entendido. Pode continuar comigo sobre a formacao ou escrever reiniciar para voltar ao menu." };
}

async function createPendingQuote(session: ClientSession): Promise<Quote> {
  const quote: Quote = {
    id: `quote_${Date.now()}`,
    clientId: session.senderId,
    clientName: session.data.nome || "Cliente",
    destination: session.data.destino,
    details: `Data: ${session.data.data}, Pessoas: ${session.data.pessoas}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  quotes.push(quote);
  await writeJsonFile(quotesPath, quotes);
  return quote;
}

async function handlePassagem(session: ClientSession, text: string, lower: string): Promise<FlowResult> {
  if (session.step === "inicio" || session.step === "passagem_destino") {
    session.data.destino = text;
    session.step = "passagem_data";
    await saveClientSession(session);
    return { text: "Qual e a data pretendida para a viagem?" };
  }

  if (session.step === "passagem_data") {
    session.data.data = text;
    session.step = "passagem_pessoas";
    await saveClientSession(session);
    return { text: "Quantas pessoas vao viajar?" };
  }

  if (session.step === "passagem_pessoas") {
    const pessoas = parseInt(text, 10);
    if (Number.isNaN(pessoas) || pessoas <= 0) {
      return { text: "Por favor, informe o numero de pessoas em numeros. Exemplo: 2." };
    }

    session.data.pessoas = String(pessoas);
    const quote = await createPendingQuote(session);

    session.quoteId = quote.id;
    session.step = "passagem_aguardando_preco";
    session.needsHuman = false;
    await saveClientSession(session);

    await notifyLead(
      "Passagem - Cotacao solicitada",
      `QuoteId: ${quote.id}\nDestino: ${session.data.destino}\nData: ${session.data.data}\nPessoas: ${pessoas}`
    );

    await notifyAppCentral(
      "cotacao_solicitada",
      session.senderId,
      `Nova cotacao pendente para ${session.data.destino}`,
      {
        quoteId: quote.id,
        destino: session.data.destino,
        data: session.data.data,
        pessoas,
        clientName: quote.clientName,
      }
    );

    return {
      text: "Ja registei o seu pedido. A nossa equipa comercial esta a verificar as melhores tarifas disponiveis. Assim que tivermos o preco, enviamos aqui.",
      quote,
    };
  }

  if (session.step === "passagem_aguardando_preco") {
    return { text: "A sua cotacao esta a ser verificada. Assim que tivermos o preco, enviamos aqui no chat." };
  }

  if (session.step === "passagem_cotacao_enviada") {
    if (lower.includes("opcao 1") || lower.includes("presencial") || lower.includes("vou ai") || lower.includes("vou aí")) {
      return {
        text: "Perfeito. Estamos em Achada Sao Filipe, Praia, ao lado de Calu e Angela. Horario: segunda a sexta, das 8h as 17h.",
      };
    }

    if (
      lower.includes("opcao 2") ||
      lower.includes("online") ||
      lower.includes("transferencia") ||
      lower.includes("nao posso ir") ||
      lower.includes("não posso ir") ||
      lower.includes("nao consigo ir")
    ) {
      session.needsHuman = true;
      session.step = "validacao_manual";
      await saveClientSession(session);
      await notifyAppCentral(
        "validacao_manual",
        session.senderId,
        "Cliente escolheu opcao online para passagem e precisa de validacao detalhada.",
        { quoteId: session.quoteId, clientName: "Cliente" }
      );
      return {
        text: "Entendi. Vou verificar este ponto com mais detalhe para lhe dar a informacao correta e seguirmos com seguranca.",
      };
    }

    return { text: "Prefere a Opcao 1 (Presencial) ou a Opcao 2 (Online)?" };
  }

  return { text: "Posso continuar a ajudar com a sua passagem. Se quiser voltar ao menu, escreva reiniciar." };
}

async function handleFerias(session: ClientSession, text: string): Promise<FlowResult> {
  if (session.step === "inicio" || session.step === "ferias_tipo_pessoa") {
    session.data.para_quem = text;
    session.step = "ferias_email";
    await saveClientSession(session);
    return { text: "Entendido. Qual e o email para enviarmos a confirmacao?" };
  }

  if (session.step === "ferias_email") {
    const email = extractEmail(text);
    if (!email) {
      return { text: "Por favor, envie um email valido. Exemplo: nome@gmail.com" };
    }

    session.data.email = email;
    session.step = "ferias_telefone";
    await saveClientSession(session);
    return { text: "Perfeito. Qual e o numero de telefone?" };
  }

  if (session.step === "ferias_telefone") {
    const phone = extractPhone(text);
    if (!phone) {
      return { text: "Por favor, envie um numero valido com pelo menos 7 digitos. Exemplo: +2389123456" };
    }

    session.data.telefone = phone;
    session.step = "ferias_trabalho";
    await saveClientSession(session);
    return { text: "Obrigado. Qual e o local de trabalho?" };
  }

  if (session.step === "ferias_trabalho") {
    session.data.local_trabalho = text;
    session.step = "ferias_morada";
    await saveClientSession(session);
    return { text: "Qual e a morada completa?" };
  }

  if (session.step === "ferias_morada") {
    session.data.morada = text;

    await notifyLead(
      "Ferias - Lead completo",
      `Para: ${session.data.para_quem}\nEmail: ${session.data.email}\nTelefone: ${session.data.telefone}\nTrabalho: ${session.data.local_trabalho}\nMorada: ${session.data.morada}`
    );

    session.step = "ferias_finalizado";
    await saveClientSession(session);

    return {
      text: "Excelente. Ja registei tudo. A nossa equipa vai contactar em ate 24 horas para confirmar o agendamento.",
    };
  }

  return { text: "Ja registei o seu pedido de ferias. Se quiser voltar ao menu, escreva reiniciar." };
}

async function handleAgendamento(session: ClientSession, lower: string, text: string): Promise<FlowResult> {
  if (session.step === "inicio" || session.step === "agendamento_tipo") {
    if (lower.includes("estudante")) {
      session.data.tipo = "estudante";
    } else if (lower.includes("contrato")) {
      session.data.tipo = "contrato";
    } else {
      session.step = "agendamento_tipo";
      await saveClientSession(session);
      return { text: "Para confirmar: e para estudante ou contrato de trabalho?" };
    }

    session.step = "agendamento_disponibilidade";
    await saveClientSession(session);
    return { text: "Qual e a disponibilidade para o atendimento presencial? Exemplo: esta semana ou proxima semana." };
  }

  if (session.step === "agendamento_disponibilidade") {
    if (includesAny(lower, ["só queria saber", "so queria saber", "fazem contratos", "fazem contrato"])) {
      session.needsHuman = true;
      session.step = "validacao_manual";
      await saveClientSession(session);
      await notifyAppCentral(
        "validacao_manual",
        session.senderId,
        "Cliente saiu do fluxo de agendamento e pediu validacao detalhada sobre contratos.",
        { tipo: session.data.tipo, clientName: "Cliente" }
      );
      return {
        text: "Entendi. Vou verificar esse ponto com mais detalhe para lhe dar a informacao correta.",
      };
    }

    session.data.disponibilidade = text;

    await notifyLead(
      "Agendamento Consular",
      `Tipo: ${session.data.tipo}\nDisponibilidade: ${session.data.disponibilidade}`
    );

    session.step = "agendamento_finalizado";
    await saveClientSession(session);

    return {
      text: "Agendamento registado. Deve comparecer a Aventour em Achada Sao Filipe, Praia, ao lado de Calu e Angela, com o passaporte original e comprovativo de pagamento. A nossa equipa vai confirmar a data exata em breve.",
    };
  }

  return { text: "Posso continuar a ajudar com o agendamento. Se quiser voltar ao menu, escreva reiniciar." };
}

async function handleHotel(session: ClientSession, text: string): Promise<FlowResult> {
  if (session.step === "inicio" || session.step === "hotel_datas") {
    session.data.datas = text;
    session.step = "hotel_local";
    await saveClientSession(session);
    return { text: "Qual e o destino ou hotel pretendido?" };
  }

  if (session.step === "hotel_local") {
    session.data.local = text;

    await notifyLead(
      "Hotel - Reserva solicitada",
      `Datas: ${session.data.datas}\nLocal: ${session.data.local}`
    );

    session.step = "hotel_finalizado";
    await saveClientSession(session);

    return {
      text: `Registado. Vamos verificar disponibilidade para ${session.data.local}. Custo do servico de reserva: 60 CVE por dia. O valor final da estadia depende do hotel escolhido.`,
    };
  }

  return { text: "Ja registei a sua reserva de hotel. Se quiser, posso explicar melhor como funciona o valor da reserva." };
}

async function handleReservaPassagem(session: ClientSession, text: string): Promise<FlowResult> {
  await notifyLead("Reserva de Passagem (bloqueio)", `Detalhes: ${text}`);
  session.step = "reserva_passagem_finalizada";
  await saveClientSession(session);
  return {
    text: "Pedido de reserva registado. Deve efetuar o pagamento de 1.000 CVE para garantir a vaga. A nossa equipa vai confirmar em breve.",
  };
}

async function handleFlow(senderId: string, messageText: string): Promise<FlowResult> {
  const session = await getClientSession(senderId);
  const text = messageText.trim();
  const lower = normalize(text);

  console.log(`[${senderId}] "${messageText}" | Servico: ${session.service} | Etapa: ${session.step}`);

  session.history.push({ role: "user", text: messageText });
  if (session.history.length > 20) session.history = session.history.slice(-20);

  if (isResetCommand(lower)) {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return { text: `Entendido. Vamos comecar de novo.\n\n${menuText()}` };
  }

  if (session.step === "validacao_manual" && session.needsHuman) {
    return {
      text: "Estou a analisar este ponto com mais detalhe para lhe responder da forma certa.",
    };
  }

  const detectedIntent = detectIntent(lower);
  const explicitSwitch = detectedIntent.service !== "none" && detectedIntent.confidence >= 0.96;

  if (session.service === "none" && detectedIntent.service !== "none") {
    return startServiceFlow(session, detectedIntent.service, senderId, lower);
  }

  if (session.service !== "none" && explicitSwitch && detectedIntent.service !== session.service) {
    return startServiceFlow(session, detectedIntent.service, senderId, lower);
  }

  if (shouldPauseForValidation(session, lower)) {
    session.needsHuman = true;
    session.step = "validacao_manual";
    await saveClientSession(session);
    await notifyAppCentral(
      "validacao_manual",
      senderId,
      "Cliente entrou em validacao manual discreta.",
      {
        service: session.service,
        previousStep: session.step,
        lastMessage: messageText,
        clientName: "Cliente",
      }
    );
    return {
      text: "Entendi. Vou verificar esse ponto com mais detalhe para lhe dar a informacao correta.",
    };
  }

  const commonResponse = getCommonResponse(text, session);
  if (commonResponse && (session.service === "none" || isGenericSupportQuestion(lower))) {
    await saveClientSession(session);
    return { text: commonResponse };
  }

  if (session.service === "none") {
    await saveClientSession(session);
    return { text: menuText() };
  }

  let result: FlowResult;

  switch (session.service) {
    case "formacao":
      result = await handleFormacao(session, text, lower);
      break;
    case "passagem":
      result = await handlePassagem(session, text, lower);
      break;
    case "ferias":
      result = await handleFerias(session, text);
      break;
    case "agendamento_consular":
      result = await handleAgendamento(session, lower, text);
      break;
    case "reserva_hotel":
      result = await handleHotel(session, text);
      break;
    case "reserva_passagem":
      result = await handleReservaPassagem(session, text);
      break;
    default:
      result = { text: menuText() };
  }

  session.history.push({ role: "model", text: result.text });
  if (session.history.length > 20) session.history = session.history.slice(-20);
  await saveClientSession(session);

  return result;
}

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

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.is_echo || event.delivery || event.read) continue;

          const senderId = event.sender?.id;
          const messageText = event.message?.text;
          const mid = event.message?.mid;

          if (mid) {
            if (processedMessageIds.has(mid)) {
              console.log(`Ignorando mensagem duplicada: ${mid}`);
              continue;
            }
            processedMessageIds.add(mid);
            if (processedMessageIds.size % 10 === 0) {
              await saveProcessedMessages();
            }
          }

          if (!senderId || !messageText) continue;

          try {
            const result = await handleFlow(senderId, messageText);
            await sendMessengerMessage(senderId, result.text, result.material);
          } catch (error) {
            console.error("Erro processando mensagem:", error);
          }
        }
      }
    } catch (error) {
      console.error("Erro geral no webhook:", error);
    }
  });
});

app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId, conversationId } = req.body;
    const id = senderId || conversationId || `web_${Date.now()}`;

    if (!text) {
      return res.status(400).json({ error: "Texto obrigatorio" });
    }

    const result = await handleFlow(id, text);
    return res.json({
      replyText: result.text,
      material: result.material,
      quote: result.quote,
      senderId: id,
    });
  } catch (error) {
    console.error("Erro API:", error);
    return res.status(500).json({
      replyText: "Tivemos um problema tecnico. Escreva reiniciar para tentarmos novamente.",
    });
  }
});

app.get("/api/quotes", async (_req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  res.json(quotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
});

app.post("/api/quotes", async (req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  const newQuote: Quote = {
    ...req.body,
    id: req.body.id || `quote_${Date.now()}`,
    createdAt: req.body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existingIndex = quotes.findIndex((q) => q.id === newQuote.id);
  if (existingIndex >= 0) {
    quotes[existingIndex] = newQuote;
  } else {
    quotes.push(newQuote);
  }

  await writeJsonFile(quotesPath, quotes);
  res.json(newQuote);
});

app.post("/api/quotes/:id/send", async (req, res) => {
  try {
    const { price, observation } = req.body;
    if (!price) {
      return res.status(400).json({ error: "Preco obrigatorio" });
    }

    const result = await sendQuoteToClient(req.params.id, price, observation);
    return res.json(result);
  } catch (error) {
    console.error("Erro endpoint send quote:", error);
    return res.status(500).json({ success: false, error: String(error) });
  }
});

app.get("/api/sessions", async (_req, res) => {
  const activeSessions = Object.values(sessions).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  res.json(activeSessions);
});

app.get("/api/session/:senderId", async (req, res) => {
  const session = await getClientSession(req.params.senderId);
  res.json(session);
});

app.post("/api/session/:senderId/reset", async (req, res) => {
  const session = await getClientSession(req.params.senderId);
  const clean = resetSession(session);
  await saveClientSession(clean);
  res.json({ success: true });
});

app.get("/api/materials", async (_req, res) => {
  const materials = await readJsonFile<Material[]>(materialsPath, []);
  res.json(materials);
});

app.post("/api/materials", async (req, res) => {
  await writeJsonFile(materialsPath, req.body);
  res.json({ success: true });
});

app.get("/api/campaigns", async (_req, res) => {
  const campaigns = await readJsonFile<Campaign[]>(campaignsPath, []);
  res.json(campaigns);
});

app.post("/api/campaigns", async (req, res) => {
  await writeJsonFile(campaignsPath, req.body);
  res.json({ success: true });
});

app.get("/api/notifications", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  res.json(notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  const index = notifications.findIndex((n) => n.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ error: "Notificacao nao encontrada" });
  }

  notifications[index].read = true;
  await writeJsonFile(notificationsPath, notifications);
  res.json({ success: true });
});

app.get("/api/notifications/unread", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  res.json(notifications.filter((n) => !n.read));
});

app.post("/api/notify", async (req, res) => {
  try {
    const { subject, body } = req.body;
    await notifyLead(subject, body);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: String(error) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    processedMessages: processedMessageIds.size,
  });
});

app.get("/privacy-policy", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Politica de Privacidade - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Politica de Privacidade</h1><p>Dados recolhidos: nome, telefone, email, mensagens e documentos quando necessario.</p><p>Contacto: reservas@viagensaventour.com</p></body></html>`);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Remocao de Dados - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Remocao de Dados</h1><p>Envie email para: <strong>reservas@viagensaventour.com</strong></p></body></html>`);
});

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
    console.log(`Aventour Server rodando em http://localhost:${PORT}`);
    console.log(`Notificacoes: ${NOTIFY_EMAIL}`);
    console.log(`Resend: ${process.env.RESEND_API_KEY ? "OK" : "NAO CONFIGURADO"}`);
    console.log(`Mensagens processadas: ${processedMessageIds.size}`);
  });
}

start();

