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

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

// Configuracao do Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configuracao do Email
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Data paths
const dataDir = path.join(process.cwd(), "data");
const materialsPath = path.join(dataDir, "materials.json");
const campaignsPath = path.join(dataDir, "campaigns.json");
const quotesPath = path.join(dataDir, "quotes.json");
const processedMsgsPath = path.join(dataDir, "processed_messages.json");
const notificationsPath = path.join(dataDir, "notifications.json"); // Para app central

// Types
type ServiceType = "none" | "formacao" | "ferias" | "agendamento_consular" | "passagem" | "reserva_hotel" | "reserva_passagem";
type MaterialCategory = "docs_ferias" | "docs_contrato" | "docs_estudante" | "dados_bancarios" | "precario";
type QuoteStatus = "pending" | "quoted" | "accepted" | "rejected";
type NotificationType = "documentos_recebidos" | "lead_novo" | "cotacao_solicitada" | "pagamento_recebido";

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
  history: Array<{role: "user" | "model", text: string}>;
  quoteId?: string;
  lastIntent?: string;
}

// State
const sessions: Record<string, ClientSession> = {};
let processedMessageIds: Set<string> = new Set();

// Carrega mensagens processadas do arquivo
async function loadProcessedMessages() {
  try {
    const data = await fs.readFile(processedMsgsPath, "utf-8");
    const ids = JSON.parse(data);
    processedMessageIds = new Set(ids);
    console.log(`Carregados ${processedMessageIds.size} IDs de mensagens processadas`);
  } catch {
    processedMessageIds = new Set();
  }
}

// Salva mensagens processadas
async function saveProcessedMessages() {
  try {
    await fs.writeFile(processedMsgsPath, JSON.stringify([...processedMessageIds]), "utf-8");
  } catch (e) {
    console.error("Erro salvando processed messages:", e);
  }
}

// Helpers
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
  };
}

// Email notifications
async function notifyLead(subject: string, body: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject,
      text: body,
    });
    console.log("Email enviado:", subject);
  } catch (error) {
    console.error("Erro email:", error);
  }
}

// NOTIFICACAO PARA APP CENTRAL - Quando cliente tem documentos
async function notifyAppCentral(type: NotificationType, clientId: string, message: string, data?: Record<string, any>) {
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
    console.log(`Notificacao app central criada: ${type} - ${clientId}`);
    
    // Tambem envia email para admin
    await notifyLead(
      `App Central: ${type.replace(/_/g, ' ').toUpperCase()}`,
      `Cliente: ${clientId}\\nMensagem: ${message}\\nDados: ${JSON.stringify(data, null, 2)}`
    );
  } catch (error) {
    console.error("Erro criando notificacao:", error);
  }
}

// Meta Messenger
async function sendMessengerMessage(recipientId: string, text: string, material?: Material) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("PAGE_ACCESS_TOKEN nao configurado");

  const url = `https://graph.facebook.com/v23.0/me/messages?access_token=${token}`;

  // Envia texto
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  // Se tiver material, envia
  if (material) {
    if (material.fileType.startsWith("image/")) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "image",
              payload: { url: material.fileUrl, is_reusable: true }
            }
          },
        }),
      });
    } else {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: `${material.title}: ${material.fileUrl}` },
        }),
      });
    }
  }
}

// Utils - deteccao inteligente de intencao
function detectIntent(text: string): { service: ServiceType; confidence: number; original?: string } {
  const lower = text.toLowerCase().trim();
  
  // FORMACAO
  const formacaoKeywords = [
    "formacao", "formação", "estudar", "curso", "escola", "estudo", 
    "estuda", "studar", "bai studa", "quer studa", "faze curso",
    "portugal pa studa", "estudar em portugal", "curso em portugal"
  ];
  
  // PASSAGEM
  const passagemKeywords = [
    "passagem", "bilhete", "voo", "aviaum", "aviao", "avião",
    "bai de aviao", "bai de aviaum", "viajar", "viagem", "voar",
    "compra bilhete", "reserva voo", "ida", "ida e volta"
  ];
  
  // FERIAS/TURISMO
  const feriasKeywords = [
    "ferias", "férias", "turismo", "lazer", "bai ferias", 
    "bai turismo", "faze turismo", "descansar", "passear"
  ];
  
  // AGENDAMENTO CONSULAR
  const agendamentoKeywords = [
    "agendamento", "agenda", "visto", "consulado", "consuladu",
    "embaixada", "entrevista", "marcar", "marca", "hora",
    "atendimento", "agendamentu"
  ];
  
  // CONTRATO (detecta mas trata diferente)
  const contratoKeywords = [
    "contrato", "contratu", "trabalho", "trabalhu", "emprego",
    "arranja trabaiu", "bai trabai", "trabai em portugal"
  ];
  
  // HOTEL
  const hotelKeywords = [
    "hotel", "hospedagem", "alojamento", "fica onde", "onde k fica",
    "reserva hotel", "quarto", "hospeda"
  ];
  
  // RESERVA DE PASSAGEM (bloqueio)
  const reservaKeywords = [
    "reservar vaga", "bloquear", "garantir vaga", "segura vaga",
    "bloqueia", "reserva passagem"
  ];
  
  // Check each
  if (formacaoKeywords.some(k => lower.includes(k))) return { service: "formacao", confidence: 0.9 };
  if (passagemKeywords.some(k => lower.includes(k))) return { service: "passagem", confidence: 0.9 };
  if (feriasKeywords.some(k => lower.includes(k))) return { service: "ferias", confidence: 0.9 };
  if (reservaKeywords.some(k => lower.includes(k))) return { service: "reserva_passagem", confidence: 0.9 };
  if (hotelKeywords.some(k => lower.includes(k))) return { service: "reserva_hotel", confidence: 0.9 };
  
  // Agendamento vs Contrato - distincao inteligente
  const hasAgendamento = agendamentoKeywords.some(k => lower.includes(k));
  const hasContrato = contratoKeywords.some(k => lower.includes(k));
  
  if (hasAgendamento || hasContrato) {
    // Se so fala em contrato sem agendamento, pode ser confusao
    if (hasContrato && !hasAgendamento) {
      return { service: "agendamento_consular", confidence: 0.7, original: "contrato_confusao" };
    }
    return { service: "agendamento_consular", confidence: 0.9 };
  }
  
  return { service: "none", confidence: 0 };
}

function extractEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/\\+?[0-9\\s-]{9,}/);
  return match ? match[0].replace(/\\s/g, '') : null;
}

function isConfirmation(text: string): boolean {
  const confirmations = [
    "sim", "quero", "pode", "pode sim", "vamos", "ok", "avançar", 
    "avancar", "claro", "confirmo", "vamos em frente", "bora",
    "ta bom", "esta bom", "pode ser", "faz favor", "faz favo",
    "ya", "yes", "tem", "tenho", "manda", "envia"
  ];
  return confirmations.some(c => text.toLowerCase().trim().startsWith(c));
}

function isNegation(text: string): boolean {
  const negatives = [
    "nao", "não", "nada", "agora nao", "depois", "nao quero",
    "recuso", "nao obrigado", "nao precisa"
  ];
  const clean = text.toLowerCase().trim();
  return negatives.some(n => clean === n || clean.startsWith(n + " "));
}

// Check campaigns dynamically
async function checkCampaigns(text: string): Promise<{reply: string | null, material?: Material}> {
  const campaigns = await readJsonFile<Campaign[]>(campaignsPath, []);
  const materials = await readJsonFile<Material[]>(materialsPath, []);

  const lowerText = text.toLowerCase();

  for (const campaign of campaigns) {
    if (!campaign.active) continue;

    const matches = campaign.keywords.some(kw => lowerText.includes(kw.toLowerCase()));
    if (matches) {
      const material = materials.find(m => 
        campaign.context.toLowerCase().includes(m.category.toLowerCase().replace('_', ' '))
      );

      let reply = `${campaign.title}\\n\\n${campaign.context}`;
      if (campaign.discount) reply += `\\n\\nDesconto: ${campaign.discount}`;
      if (campaign.price) reply += `\\nInvestimento: ${campaign.price.toLocaleString()} CVE`;
      reply += `\\n\\nQuer saber mais?`;

      return { reply, material };
    }
  }

  return { reply: null };
}

// Perguntas gerais em qualquer momento
async function checkGeneralQuestions(text: string, session: ClientSession): Promise<{text: string, material?: Material} | null> {
  const lowerText = text.toLowerCase().trim();
  const materials = await readJsonFile<Material[]>(materialsPath, []);

  // Endereco
  if (lowerText.match(/endereço|endereco|onde fica|localização|morada|onde é|onde e|onde ki fica/)) {
    return { 
      text: "Estamos em Achada Sao Filipe, Praia, ao lado da loja Calu e Angela. Venha nos visitar." 
    };
  }

  // WhatsApp/Telefone
  if (lowerText.match(/whatsapp|telefone|contacto|numero|número|falar|fala/)) {
    return { 
      text: "Pode falar connosco pelo WhatsApp +238 913 23 75 ou email reservas@viagensaventour.com." 
    };
  }

  // Email
  if (lowerText.match(/email|e-mail|correio/)) {
    return { 
      text: "O nosso email e reservas@viagensaventour.com." 
    };
  }

  // Dados bancarios
  if (lowerText.match(/iban|dados bancários|conta|pagamento|transferir|como pagar/)) {
    const material = materials.find(m => m.category === "dados_bancarios");
    if (material) {
      return { 
        text: "Seguem os dados bancarios da Aventour para realizar o pagamento:", 
        material 
      };
    }
  }

  // Documentos
  if (lowerText.match(/documentos|documento|docs|papeis|papéis|lista/)) {
    if (lowerText.match(/visto|estudante/)) {
      const material = materials.find(m => m.category === "docs_estudante");
      if (material) return { text: "Lista de documentos para visto de estudante:", material };
    }
    if (lowerText.match(/contrato|trabalho/)) {
      const material = materials.find(m => m.category === "docs_contrato");
      if (material) return { text: "Documentos para agendamento de contrato:", material };
    }
    if (lowerText.match(/férias|ferias/)) {
      const material = materials.find(m => m.category === "docs_ferias");
      if (material) return { text: "Documentos para agendamento de ferias:", material };
    }
  }

  // Preco geral
  if (lowerText.match(/preço|preco|custa|valor|kuantu|quanto/)) {
    // Se estiver em fluxo de passagem, nao diz preco
    if (session.service === "passagem") {
      return { text: "Ja verifico as melhores tarifas disponiveis e lhe digo o preco." };
    }
    // Se estiver em formacao, so diz se ja tiver passado do curso
    if (session.service === "formacao" && session.step !== "formacao_curso" && session.step !== "formacao_idade" && session.step !== "formacao_escolaridade") {
      return { text: "O investimento total e de 45.000 CVE (6.000 CVE inscricao + 39.000 CVE matricula). Em Portugal paga apenas mais 300 euros para concluir. Nao ha mensalidades." };
    }
    // Se estiver em agendamento
    if (session.service === "agendamento_consular") {
      return { text: "O valor total e 16.940 CVE (12.500 CVE servico + 4.440 CVE taxa consular)." };
    }
    // Se estiver em ferias
    if (session.service === "ferias") {
      return { text: "O agendamento de ferias inclui reserva de passagem e hotel por 20.000 CVE (5.000 CVE reserva + 15.000 CVE apos confirmacao)." };
    }
    // Se estiver em hotel
    if (session.service === "reserva_hotel") {
      return { text: "A reserva de hotel tem o custo de 60 CVE por dia." };
    }
    // Se estiver em reserva de passagem
    if (session.service === "reserva_passagem") {
      return { text: "A reserva de passagem custa 1.000 CVE e garante a vaga temporariamente." };
    }
  }

  return null;
}

// Handoff suave - NUNCA bloqueia, so notifica
async function handoffToHuman(session: ClientSession, summary: string) {
  // Notifica admin mas NAO muda status para waiting_human
  await notifyLead(
    `Lead Qualificado - ${session.service.toUpperCase()}`,
    `ID: ${session.senderId}\\n` +
    `Servico: ${session.service}\\n` +
    `Dados: ${JSON.stringify(session.data, null, 2)}\\n\\n` +
    `Resumo: ${summary}`
  );
}

// Mensagem de formacao - completa e profissional
function getFormacaoMessage(curso: string): string {
  return `Entao vamos avancar com o proximo passo.

Proximos passos - ${curso}

1. Documentos necessarios
Para iniciar, envia:
- Passaporte
- CNI
- NIF
- Certificado do 9o ano apostilado

Envio dos documentos:
Email: reservas@viagensaventour.com
WhatsApp: +238 913 23 75
(ou podes entregar presencialmente na agencia)

2. Duracao da formacao
1 ano
Aulas teoricas em Lisboa
Estagio incluido

3. Pagamento
45.000 CVE, dividido em:
6.000 CVE - inscricao
39.000 CVE - declaracao de matricula
(ja inclui metade do curso paga)

O valor de 39.000 CVE e recebido apenas em cheque ou dinheiro (presencialmente).
Em Portugal, pagas apenas 300 euros para concluir o valor total do curso.
Nao ha mensalidades.

Assim que enviares os documentos, confirmamos tudo e damos seguimento a inscricao.
Diz-me quando consegues enviar que eu acompanho passo a passo.`;
}

// Main Flow Handler - INTELIGENTE E FLUIDO
async function handleFlow(senderId: string, messageText: string): Promise<{text: string, material?: Material, quote?: Quote}> {
  const session = await getClientSession(senderId);
  const text = messageText.trim();
  const lowerText = text.toLowerCase();

  // Carrega dados frescos
  const [materials, campaigns, quotes] = await Promise.all([
    readJsonFile<Material[]>(materialsPath, []),
    readJsonFile<Campaign[]>(campaignsPath, []),
    readJsonFile<Quote[]>(quotesPath, []),
  ]);

  console.log(`[${senderId}] "${messageText}" | Servico: ${session.service} | Etapa: ${session.step}`);

  // Adiciona ao historico
  session.history.push({ role: "user", text: messageText });

  // Comando reiniciar
  if (lowerText === "reiniciar" || lowerText === "comecar" || lowerText === "recomeca") {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return { text: "Entendido. Vamos comecar de novo.\\n\\nPosso ajudar com:\\n1. Formacao em Portugal\\n2. Agendamento de Ferias\\n3. Agendamento Estudante/Contrato\\n4. Passagens Aereas\\n5. Reserva de Hotel\\n\\nQual servico pretende?" };
  }

  // PRIMEIRO: Verifica perguntas gerais (endereco, contato, preco, etc)
  // Isso funciona em QUALQUER momento, inclusive em fluxos ativos
  const generalReply = await checkGeneralQuestions(messageText, session);
  if (generalReply) {
    await saveClientSession(session);
    return generalReply;
  }

  // Verifica campanhas ativas
  const campaignResult = await checkCampaigns(messageText);
  if (campaignResult.reply && session.service === "none") {
    return { text: campaignResult.reply, material: campaignResult.material };
  }

  // DETECCAO DE INTENCAO - Inteligencia para mudanca de contexto
  const detectedIntent = detectIntent(messageText);
  
  // Se detectou intencao diferente do fluxo atual, pivota naturalmente
  if (detectedIntent.service !== "none" && detectedIntent.service !== session.service) {
    if (session.service !== "none") {
      // Cliente mudou de assunto - pivota suavemente
      console.log(`Mudanca de contexto: ${session.service} -> ${detectedIntent.service}`);
    }
    
    // Inicia novo fluxo
    session.service = detectedIntent.service;
    session.step = "";
    session.data = {};
    
    // Tratamento especial para confusao contrato/agendamento
    if (detectedIntent.original === "contrato_confusao") {
      return { 
        text: "No momento nao intermediamos contratos de trabalho diretamente. Cuidamos do agendamento consular, orientacao e acompanhamento, para garantir que o processo seja feito corretamente desde o inicio.\\n\\nPosso ajudar com o agendamento para contrato de trabalho? E para estudante ou contrato de trabalho?" 
      };
    }
  }

  // Se ainda nao tem servico, mostra menu
  if (session.service === "none") {
    return { text: "Ola. Sou consultor comercial da Aventour Viagens. Posso ajudar com:\\n\\n1. Formacao em Portugal\\n2. Agendamento de Ferias\\n3. Agendamento Estudante/Contrato\\n4. Passagens Aereas\\n5. Reserva de Hotel\\n\\nQual servico pretende?" };
  }

  // ==================== FLUXO FORMACAO ====================
  if (session.service === "formacao") {
    // Etapa 1: Idade
    if (session.step === "" || session.step === "formacao_idade") {
      const idadeNum = parseInt(text);
      if (isNaN(idadeNum)) {
        session.step = "formacao_idade";
        await saveClientSession(session);
        return { text: "Excelente escolha. As formacoes em Portugal sao uma oportunidade unica. Para verificar a elegibilidade, qual e a sua idade?" };
      }
      
      session.data.idade = String(idadeNum);
      
      // Se menor de idade
      if (idadeNum < 18) {
        session.step = "formacao_menor";
        await saveClientSession(session);
        return { 
          text: "Para menores de 18 anos, nao temos formacao direta. No entanto, pode adicionar o menor no pedido de visto, mas precisa de documentos adicionais. E melhor passar na agencia para avaliarmos o caso com calma.\\n\\nQuer tratar de outro servico ou tem mais alguma questao?" 
        };
      }
      
      session.step = "formacao_escolaridade";
      await saveClientSession(session);
      await notifyLead("Novo Interesse - Formacao Portugal", `Cliente: ${senderId}\\nIdade: ${idadeNum}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Obrigado. Qual foi o ultimo ano de escolaridade que concluiu?" };
    }

    // Etapa 2: Escolaridade
    if (session.step === "formacao_escolaridade") {
      session.data.escolaridade = text;
      session.step = "formacao_curso";
      await saveClientSession(session);
      
      // Verifica se nao tem 9o ano
      const temNono = text.toLowerCase().includes("9") || 
                      text.toLowerCase().includes("nono") ||
                      text.toLowerCase().includes("decimo") ||
                      text.toLowerCase().includes("10") ||
                      text.toLowerCase().includes("11") ||
                      text.toLowerCase().includes("12") ||
                      text.toLowerCase().includes("universidade");
      
      if (!temNono) {
        return { 
          text: "Temos tambem uma opcao para candidatos que nao concluiram o 9o ano. Nesses casos, a inscricao so e possivel se houver um responsavel financeiro (familiar ou terceiro) que assuma o pagamento da formacao. A aceitacao depende sempre da analise da instituicao em Portugal e do cumprimento das regras oficiais do visto.\\n\\nSe quiseres, podes passar na agencia para avaliarmos o teu caso com calma e ver se essa opcao se aplica a tua situacao.\\n\\nQual area mais lhe interessa?\\n\\n- Auxiliar de Acao Educativa\\n- Auxiliar de Acao Medica\\n- Profissional de Turismo\\n- Marketing Digital\\n- Assistente de Contabilidade\\n- Assistente Administrativo" 
        };
      }
      
      return { 
        text: "Perfeito. Temos cursos em areas com alta empregabilidade:\\n\\n- Auxiliar de Acao Educativa\\n- Auxiliar de Acao Medica\\n- Profissional de Turismo\\n- Marketing Digital\\n- Assistente de Contabilidade\\n- Assistente Administrativo\\n\\nQual area mais lhe interessa?" 
      };
    }

    // Etapa 3: Curso
    if (session.step === "formacao_curso") {
      session.data.curso = text;
      session.step = "formacao_confirmacao";
      await saveClientSession(session);
      
      // Mensagem completa com todos os detalhes
      return { text: getFormacaoMessage(text) };
    }

    // Etapa 4: Follow-up documentos - AQUI ESTA A MAGICA
    if (session.step === "formacao_confirmacao") {
      // Verifica se pergunta sobre pacote completo
      if (lowerText.includes("pacote") || lowerText.includes("completo") || lowerText.includes("tudo")) {
        return { 
          text: "Temos tambem um pacote completo que inclui agendamento, inscricao e metade da formacao paga por 61.990 CVE. So paga os 300 euros em Portugal. Quer optar por este pacote ou pelo basico de 45.000 CVE?" 
        };
      }
      
      // Verifica se cliente disse que TEM documentos ou quer enviar
      const temDocumentos = lowerText.includes("tenho") || 
                            lowerText.includes("tem") || 
                            lowerText.includes("manda") || 
                            lowerText.includes("envia") ||
                            lowerText.includes("pronto") ||
                            lowerText.includes("ja tenho") ||
                            lowerText.includes("posso enviar");
      
      if (temDocumentos) {
        // NOTIFICA APP CENTRAL - Documentos recebidos
        await notifyAppCentral(
          "documentos_recebidos",
          senderId,
          `Cliente tem documentos prontos para formacao - ${session.data.curso}`,
          {
            clientName: session.data.nome || "Cliente",
            curso: session.data.curso,
            idade: session.data.idade,
            escolaridade: session.data.escolaridade,
            mensagem: text
          }
        );
        
        return { 
          text: "Perfeito. Ja registei que tens os documentos prontos. Podes enviar quando quiser por email, WhatsApp ou entregar presencialmente na agencia. Assim que recebermos, damos seguimento imediato a tua inscricao.\\n\\nPrecisa de mais alguma informacao?" 
        };
      }
      
      // Resposta generica mas util
      await handoffToHuman(session, `Formacao - Cliente confirmou interesse no curso ${session.data.curso}. Idade: ${session.data.idade}. Escolaridade: ${session.data.escolaridade}. Cliente disse: ${text}`);
      return { 
        text: "Perfeito. Ja registei tudo. A nossa equipa vai acompanhar o teu processo. Assim que tiveres os documentos prontos, envia que damos seguimento imediato.\\n\\nPrecisa de mais alguma informacao?" 
      };
    }
  }

  // ==================== FLUXO PASSAGEM ====================
  if (session.service === "passagem") {
    if (session.step === "" || session.step === "passagem_destino") {
      session.data.destino = text;
      session.step = "passagem_data";
      await saveClientSession(session);
      await notifyLead("Novo Pedido - Passagem", `Cliente: ${senderId}\\nDestino: ${text}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Vou preparar a melhor opcao para a sua viagem. Qual e a data pretendida?" };
    }

    if (session.step === "passagem_data") {
      session.data.data = text;
      session.step = "passagem_pessoas";
      await saveClientSession(session);
      return { text: "Quantas pessoas vao viajar?" };
    }

    if (session.step === "passagem_pessoas") {
      session.data.pessoas = text;

      const newQuote: Quote = {
        id: `quote_${Date.now()}`,
        clientId: senderId,
        clientName: session.data.nome || "Cliente",
        destination: session.data.destino,
        details: `Data: ${session.data.data}, Pessoas: ${text}`,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      quotes.push(newQuote);
      await writeJsonFile(quotesPath, quotes);

      session.quoteId = newQuote.id;
      session.step = "passagem_aguardando_preco";
      await saveClientSession(session);

      await handoffToHuman(session, `Passagem - Cotacao solicitada\\nDestino: ${session.data.destino}\\nData: ${session.data.data}\\nPessoas: ${text}`);

      return { 
        text: "Ja registei o seu pedido. A nossa equipa comercial esta a verificar as melhores tarifas disponiveis. Ja verifico e lhe digo o preco.\\n\\nEnquanto isso, precisa de reserva de hotel tambem?",
        quote: newQuote 
      };
    }

    // Se perguntar algo enquanto aguarda preco
    if (session.step === "passagem_aguardando_preco") {
      return { text: "Ja verifico as melhores tarifas e lhe digo o preco em breve. Precisa de mais alguma informacao?" };
    }
  }

  // ==================== FLUXO AGENDAMENTO CONSULAR ====================
  if (session.service === "agendamento_consular") {
    if (session.step === "" || session.step === "agendamento_tipo") {
      // Detecta se mencionou estudante ou contrato
      const isEstudante = lowerText.includes("estudante") || lowerText.includes("estuda") || lowerText.includes("curso");
      const isContrato = lowerText.includes("contrato") || lowerText.includes("trabalho") || lowerText.includes("trabalhu");
      
      if (isEstudante || isContrato) {
        session.data.tipo = isEstudante ? "estudante" : "contrato";
        session.step = "agendamento_disponibilidade";
        await saveClientSession(session);
        await notifyLead("Novo Interesse - Agendamento", `Cliente: ${senderId}\\nTipo: ${session.data.tipo}\\nData: ${new Date().toLocaleString()}`);
        return { 
          text: `Entendido. O agendamento consular requer presenca presencial na Aventour. O valor total e 16.940 CVE (12.500 CVE servico + 4.440 CVE taxa consular).\\n\\nQual e a disponibilidade para o atendimento presencial? (Ex: esta semana, proxima semana)` 
        };
      } else {
        session.step = "agendamento_tipo";
        await saveClientSession(session);
        return { 
          text: "Entendido. O agendamento consular requer presenca presencial na Aventour. O valor total e 16.940 CVE (12.500 CVE servico + 4.440 CVE taxa consular). E para estudante ou contrato de trabalho?" 
        };
      }
    }

    // Se cliente mencionar idade menor
    if (lowerText.includes("ano") || !isNaN(parseInt(text))) {
      const idade = parseInt(text);
      if (!isNaN(idade) && idade < 18) {
        await handoffToHuman(session, `Agendamento - Cliente mencionou idade ${idade} anos. Processo diferente para menor.`);
        return { 
          text: "Para menores de 18 anos, o processo e diferente. Ja encaminhei para um consultor especializado que vai explicar os procedimentos especificos." 
        };
      }
    }

    if (session.step === "agendamento_disponibilidade" || session.step === "agendamento_tipo") {
      session.data.disponibilidade = text;
      await handoffToHuman(session, `Agendamento\\nTipo: ${session.data.tipo || "nao especificado"}\\nDisponibilidade: ${text}`);
      return { 
        text: "Agendamento registado. Deve comparecer a Aventour com o passaporte original e comprovativo de pagamento (12.500 CVE + 4.440 CVE). A nossa equipa vai confirmar a data exata em breve." 
      };
    }
  }

  // ==================== FLUXO FERIAS/TURISMO ====================
  if (session.service === "ferias") {
    if (session.step === "" || session.step === "ferias_tipo_pessoa") {
      session.data.para_quem = text;
      session.step = "ferias_email";
      await saveClientSession(session);
      await notifyLead("Novo Interesse - Ferias", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { 
        text: "Perfeito. O agendamento de ferias inclui reserva de passagem e hotel por 20.000 CVE (5.000 CVE reserva + 15.000 CVE apos confirmacao). E para si ou para outra pessoa?" 
      };
    }

    if (session.step === "ferias_email") {
      const email = extractEmail(messageText);
      session.data.email = email || text;
      session.step = "ferias_telefone";
      await saveClientSession(session);
      return { text: "Perfeito. Qual e o numero de telefone?" };
    }

    if (session.step === "ferias_telefone") {
      const phone = extractPhone(messageText);
      session.data.telefone = phone || text;
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
      await handoffToHuman(session, `Ferias - Lead completo\\nPara: ${session.data.para_quem}\\nEmail: ${session.data.email}\\nTel: ${session.data.telefone}\\nTrabalho: ${session.data.local_trabalho}\\nMorada: ${session.data.morada}`);
      return { 
        text: "Excelente. Ja registei tudo. A nossa equipa vai contactar em ate 24h para confirmar o agendamento." 
      };
    }
  }

  // ==================== FLUXO HOTEL ====================
  if (session.service === "reserva_hotel") {
    if (session.step === "" || session.step === "hotel_datas") {
      session.data.datas = text;
      session.step = "hotel_local";
      await saveClientSession(session);
      await notifyLead("Novo Interesse - Hotel", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "A reserva de hotel tem o custo de 60 CVE por dia. Quais sao as datas de entrada e saida?" };
    }

    if (session.step === "hotel_local") {
      session.data.local = text;
      await handoffToHuman(session, `Hotel - Reserva solicitada\\nDatas: ${session.data.datas}\\nLocal: ${session.data.local}`);
      return { 
        text: `Registado. Vamos verificar disponibilidade para ${session.data.local}. Custo: 60 CVE/dia. A equipa contacta em breve.` 
      };
    }
  }

  // ==================== FLUXO RESERVA PASSAGEM ====================
  if (session.service === "reserva_passagem") {
    await handoffToHuman(session, `Reserva de Passagem (bloqueio)\\nDetalhes: ${text}`);
    return { 
      text: "Pedido de reserva registado. Deve efetuar o pagamento de 1.000 CVE para garantir a vaga. A nossa equipa vai confirmar em breve." 
    };
  }

  // Fallback inteligente - nunca reseta bruscamente
  return { 
    text: `Entendi. Posso ajudar com mais alguma informacao sobre ${session.service.replace('_', ' ')}?\\n\\nSe quiser falar de outro servico, escreva reiniciar.` 
  };
}

// ==================== ROUTES ====================

// Webhook Meta (Verify)
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

// Webhook Meta (Receive)
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  // Responde 200 OK IMEDIATAMENTE
  res.sendStatus(200);

  // Processa em background
  setImmediate(async () => {
    try {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.is_echo || event.delivery || event.read) continue;

          const senderId = event.sender?.id;
          const messageText = event.message?.text;
          const mid = event.message?.mid;

          // Deduplicacao
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

          console.log(`[${senderId}]: "${messageText}"`);

          try {
            const result = await handleFlow(senderId, messageText);
            await sendMessengerMessage(senderId, result.text, result.material);
            console.log(`Resposta enviada para ${senderId}`);
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

// API Principal - Web App
app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId, conversationId } = req.body;
    const id = senderId || conversationId || `web_${Date.now()}`;

    if (!text) return res.status(400).json({ error: "Texto obrigatorio" });

    const result = await handleFlow(id, text);

    res.json({ 
      replyText: result.text, 
      material: result.material,
      quote: result.quote,
      senderId: id 
    });
  } catch (error) {
    console.error("Erro API:", error);
    res.status(500).json({ 
      replyText: "Tivemos um problema tecnico. Escreva 'reiniciar' para tentarmos novamente." 
    });
  }
});

// API - Quotes (Precos - so humanos)
app.get("/api/quotes", async (_req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  res.json(quotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
});

app.post("/api/quotes", async (req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  const newQuote: Quote = {
    ...req.body,
    id: req.body.id || `quote_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existingIndex = quotes.findIndex(q => q.id === newQuote.id);
  if (existingIndex >= 0) {
    quotes[existingIndex] = newQuote;
  } else {
    quotes.push(newQuote);
  }

  await writeJsonFile(quotesPath, quotes);

  if (newQuote.status === "quoted" && newQuote.price) {
    await notifyLead(
      `Cotacao Enviada - ${newQuote.clientName}`,
      `Destino: ${newQuote.destination}\\nPreco: ${newQuote.price}\\nCliente recebera na proxima mensagem.`
    );
  }

  res.json(newQuote);
});

// API - Sessions
app.get("/api/sessions", async (_req, res) => {
  const activeSessions = Object.values(sessions)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
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

// Materials API
app.get("/api/materials", async (_req, res) => {
  const materials = await readJsonFile<Material[]>(materialsPath, []);
  res.json(materials);
});

app.post("/api/materials", async (req, res) => {
  await writeJsonFile(materialsPath, req.body);
  res.json({ success: true });
});

// Campaigns API
app.get("/api/campaigns", async (_req, res) => {
  const campaigns = await readJsonFile<Campaign[]>(campaignsPath, []);
  res.json(campaigns);
});

app.post("/api/campaigns", async (req, res) => {
  await writeJsonFile(campaignsPath, req.body);
  res.json({ success: true });
});

// NOVO: API - Notificacoes para App Central
app.get("/api/notifications", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  res.json(notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  const index = notifications.findIndex(n => n.id === req.params.id);
  if (index >= 0) {
    notifications[index].read = true;
    await writeJsonFile(notificationsPath, notifications);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Notificacao nao encontrada" });
  }
});

app.get("/api/notifications/unread", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  const unread = notifications.filter(n => !n.read);
  res.json(unread);
});

// Email test
app.post("/api/notify", async (req, res) => {
  try {
    const { subject, body } = req.body;
    await notifyLead(subject, body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    processedMessages: processedMessageIds.size
  });
});

// Paginas publicas
app.get("/privacy-policy", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Politica de Privacidade - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Politica de Privacidade</h1><p>Dados recolhidos: nome, telefone, email, mensagens, documentos quando necessarios.</p><p>Contacto: reservas@viagensaventour.com</p></body></html>`);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Remocao de Dados - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Remocao de Dados</h1><p>Envie email para: <strong>reservas@viagensaventour.com</strong></p></body></html>`);
});

// Frontend
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
    console.log(`Notificacoes: ${process.env.NOTIFY_EMAIL || process.env.SMTP_USER}`);
    console.log(`Gemini: ${process.env.GEMINI_API_KEY ? "OK" : "NAO CONFIGURADO"}`);
    console.log(`Mensagens processadas: ${processedMessageIds.size}`);
  });
}

start();



