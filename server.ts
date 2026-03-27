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

// Configuração do Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configuração do Email
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

// Types
type SessionStatus = "none" | "waiting_human" | "closed";
type ServiceType = "none" | "formacao" | "ferias" | "agendamento_consular" | "passagem" | "reserva_hotel" | "reserva_passagem";
type MaterialCategory = "docs_ferias" | "docs_contrato" | "docs_estudante" | "dados_bancarios" | "precario";
type QuoteStatus = "pending" | "quoted" | "accepted" | "rejected";

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

interface ClientSession {
  senderId: string;
  status: SessionStatus;
  service: ServiceType;
  step: string;
  data: Record<string, string>;
  updatedAt: string;
  history: Array<{role: "user" | "model", text: string}>;
  quoteId?: string;
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
    console.log(`📁 Carregados ${processedMessageIds.size} IDs de mensagens processadas`);
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
  for (const file of [materialsPath, campaignsPath, quotesPath, processedMsgsPath]) {
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
      status: "none",
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
    status: "none",
    service: "none",
    step: "",
    data: {},
    updatedAt: new Date().toISOString(),
    history: [],
    quoteId: undefined,
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
    console.log("✅ Email enviado:", subject);
  } catch (error) {
    console.error("❌ Erro email:", error);
  }
}

// Meta Messenger
async function sendMessengerMessage(recipientId: string, text: string, material?: Material) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("PAGE_ACCESS_TOKEN não configurado");

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
          message: { text: `📎 ${material.title}: ${material.fileUrl}` },
        }),
      });
    }
  }
}

// Utils
function isYes(text: string) {
  return ["sim", "quero", "pode", "pode sim", "vamos", "ok", "avançar", "avancar", "claro", "confirmo", "vamos em frente", "bora"].includes(text.toLowerCase().trim());
}

function isNo(text: string) {
  return ["não", "nao", "agora não", "agora nao", "depois", "talvez", "não quero", "nao quero", "recuso"].includes(text.toLowerCase().trim());
}

function extractEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/\\+?[0-9\\s-]{9,}/);
  return match ? match[0].replace(/\\s/g, '') : null;
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
      
      let reply = `🎯 ${campaign.title}\\n\\n${campaign.context}`;
      if (campaign.discount) reply += `\\n\\n🔥 Desconto: ${campaign.discount}`;
      if (campaign.price) reply += `\\n💰 Investimento: ${campaign.price.toLocaleString()} CVE`;
      reply += `\\n\\nQuer saber mais?`;
      
      return { reply, material };
    }
  }
  
  return { reply: null };
}

// Check for pending quote
async function checkPendingQuote(session: ClientSession): Promise<string | null> {
  if (!session.quoteId) return null;
  
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  const quote = quotes.find(q => q.id === session.quoteId && q.status === "quoted");
  
  if (quote && quote.price) {
    return `Olá ${quote.clientName}! Já tenho o valor da sua passagem para ${quote.destination}:\\n\\n✈️ ${quote.price}\\n${quote.observation || ''}\\n\\nPodemos confirmar?`;
  }
  
  return null;
}

// FUNÇÃO AUXILIAR: Responde perguntas de endereço/contato em QUALQUER momento
async function checkGeneralQuestions(text: string, session: ClientSession): Promise<{text: string, material?: Material} | null> {
  const lowerText = text.toLowerCase().trim();
  const materials = await readJsonFile<Material[]>(materialsPath, []);
  
  // Endereço
  if (lowerText.match(/endereço|endereco|onde fica|localização|morada|onde é|onde e/)) {
    return { 
      text: "Estamos em **Achada São Filipe, Praia**, ao lado da loja Calú e Angela. Venha nos visitar!\\n\\nPosso continuar ajudando com o seu pedido de **" + session.service.replace('_', ' ') + "**?" 
    };
  }
  
  // WhatsApp/Telefone
  if (lowerText.match(/whatsapp|telefone|contacto|numero|número|falar/)) {
    return { 
      text: "Pode falar connosco pelo WhatsApp **+238 913 23 75** ou email **reservas@viagensaventour.com**.\\n\\nPosso continuar com o seu pedido de **" + session.service.replace('_', ' ') + "**?" 
    };
  }
  
  // Email
  if (lowerText.match(/email|e-mail|correio/)) {
    return { 
      text: "O nosso email é **reservas@viagensaventour.com**.\\n\\nPosso continuar com o seu pedido de **" + session.service.replace('_', ' ') + "**?" 
    };
  }
  
  // Dados bancários
  if (lowerText.match(/iban|dados bancários|conta|pagamento|transferir|como pagar/)) {
    const material = materials.find(m => m.category === "dados_bancarios");
    if (material) {
      return { 
        text: "Claro! Seguem os dados bancários da Aventour para realizar o pagamento:\\n\\nPosso continuar com o seu pedido de **" + session.service.replace('_', ' ') + "**?", 
        material 
      };
    }
  }
  
  // Documentos
  if (lowerText.match(/documentos|documento|docs|papeis|papéis|lista/)) {
    if (lowerText.match(/visto|estudante/)) {
      const material = materials.find(m => m.category === "docs_estudante");
      if (material) return { text: "Aqui está a lista de documentos para visto de estudante:", material };
    }
    if (lowerText.match(/contrato|trabalho/)) {
      const material = materials.find(m => m.category === "docs_contrato");
      if (material) return { text: "Documentos para agendamento de contrato:", material };
    }
    if (lowerText.match(/férias|ferias/)) {
      const material = materials.find(m => m.category === "docs_ferias");
      if (material) return { text: "Documentos para agendamento de férias:", material };
    }
  }
  
  return null;
}

// Main Flow Handler
async function handleFlow(senderId: string, messageText: string): Promise<{text: string, material?: Material, quote?: Quote}> {
  const session = await getClientSession(senderId);
  const text = messageText.toLowerCase().trim();
  
  // Carrega dados SEMPRE frescos
  const [materials, campaigns, quotes] = await Promise.all([
    readJsonFile<Material[]>(materialsPath, []),
    readJsonFile<Campaign[]>(campaignsPath, []),
    readJsonFile<Quote[]>(quotesPath, []),
  ]);

  console.log(`[${senderId}] "${messageText}" | Serviço: ${session.service} | Etapa: ${session.step}`);

  // Adiciona ao histórico
  session.history.push({ role: "user", text: messageText });

  // Comando reiniciar
  if (text === "reiniciar") {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return { text: "Entendido! Vamos recomeçar.\\n\\nPosso ajudar com:\\n1. 🎓 Formação em Portugal\\n2. ✈️ Agendamento de Férias\\n3. 📅 Agendamento Estudante/Contrato\\n4. ✈️ Passagens Aéreas\\n5. 🏨 Reserva de Hotel\\n\\nQual serviço pretende?" };
  }

  // Aguardando humano - mas ainda responde perguntas básicas
if (session.status === "waiting_human") {
  // 🔥 NOVO: Mesmo em waiting_human, responde endereço/contato
  const lowerText = text.toLowerCase().trim();
  
  if (lowerText.match(/endereço|endereco|onde fica|localização|morada|onde é|onde e/)) {
    return { text: "Estamos em **Achada São Filipe, Praia**, ao lado da loja Calú e Angela. Venha nos visitar!" };
  }
  
  if (lowerText.match(/whatsapp|telefone|contacto|numero|número|falar/)) {
    return { text: "Pode falar connosco pelo WhatsApp **+238 913 23 75** ou email **reservas@viagensaventour.com**." };
  }
  
  if (lowerText.match(/email|e-mail|correio/)) {
    return { text: "O nosso email é **reservas@viagensaventour.com**." };
  }
  
  // Reiniciar funciona normalmente
  if (text === "sim") {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return { text: "Entendido! Vamos recomeçar. Qual serviço pretende?" };
  }
  
  return { text: "O seu pedido já foi encaminhado para a nossa equipa comercial. Se quiser tratar outro serviço, escreva sim" };
}

  // Verifica se tem cotação pronta primeiro
  if (session.quoteId) {
    const quoteReply = await checkPendingQuote(session);
    if (quoteReply) {
      session.quoteId = undefined;
      await saveClientSession(session);
      return { text: quoteReply };
    }
  }

  // Verifica campanhas ativas (keywords)
  const campaignResult = await checkCampaigns(messageText);
  if (campaignResult.reply && session.service === "none") {
    return { text: campaignResult.reply, material: campaignResult.material };
  }

  // 🔥 NOVO: Verifica perguntas gerais (endereço, contato, etc) em QUALQUER momento
  const generalReply = await checkGeneralQuestions(messageText, session);
  if (generalReply) {
    return generalReply;
  }

  // Detecção de serviço inicial
  if (session.service === "none" || !session.step) {
    // Formação
    if (text.match(/formação|formacao|estudar|curso/)) {
      session.service = "formacao";
      session.step = "formacao_idade";
      await saveClientSession(session);
      await notifyLead("🎓 NOVO INTERESSE - Formação Portugal", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Excelente escolha! As formações em Portugal são uma oportunidade única. Para verificar a elegibilidade, qual é a sua idade?" };
    }

    // Férias
    if (text.match(/férias|ferias|turismo|lazer/)) {
      session.service = "ferias";
      session.step = "ferias_tipo_pessoa";
      await saveClientSession(session);
      await notifyLead("✈️ NOVO INTERESSE - Férias", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Perfeito! O agendamento de férias inclui reserva de passagem e hotel por **20.000 CVE** (5.000 CVE reserva + 15.000 CVE após confirmação). É para si ou para outra pessoa?" };
    }

    // Agendamento Consular
    if (text.match(/agendamento|visto|consulado|entrevista|contrato/)) {
      session.service = "agendamento_consular";
      session.step = "agendamento_tipo";
      await saveClientSession(session);
      await notifyLead("📅 NOVO INTERESSE - Agendamento", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Entendido. O agendamento consular requer presença presencial na Aventour. O valor total é **16.940 CVE** (12.500 CVE serviço + 4.440 CVE taxa consular). É para **estudante** ou **contrato de trabalho**?" };
    }

    // Passagem
    if (text.match(/passagem|voo|bilhete|avião|voar|viajar/)) {
      session.service = "passagem";
      session.step = "passagem_destino";
      await saveClientSession(session);
      await notifyLead("✈️ NOVO PEDIDO - Passagem", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "Vou preparar a melhor opção para a sua viagem. Qual é o destino?" };
    }

    // Hotel
    if (text.match(/hotel|hospedagem|alojamento/)) {
      session.service = "reserva_hotel";
      session.step = "hotel_datas";
      await saveClientSession(session);
      await notifyLead("🏨 NOVO INTERESSE - Hotel", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "A reserva de hotel tem o custo de **60 CVE por dia**. Quais são as datas de entrada e saída?" };
    }

    // Reserva de Passagem
    if (text.match(/reservar vaga|bloquear|garantir vaga/)) {
      session.service = "reserva_passagem";
      session.step = "reserva_dados";
      await saveClientSession(session);
      await notifyLead("🎫 NOVO INTERESSE - Reserva", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
      return { text: "A reserva de passagem custa **1.000 CVE** e garante a vaga temporariamente. Qual passagem pretende reservar?" };
    }

    // Menu padrão
    return { text: "Olá! Sou consultor comercial da Aventour Viagens. Posso ajudar com:\\n\\n1. 🎓 Formação em Portugal\\n2. ✈️ Agendamento de Férias\\n3. 📅 Agendamento Estudante/Contrato\\n4. ✈️ Passagens Aéreas\\n5. 🏨 Reserva de Hotel\\n\\nQual serviço pretende?" };
  }

  // FLUXO FORMAÇÃO
  if (session.service === "formacao") {
    if (session.step === "formacao_idade") {
      session.data.idade = messageText;
      session.step = "formacao_escolaridade";
      await saveClientSession(session);
      return { text: "Obrigado. Qual foi o último ano de escolaridade que concluiu?" };
    }

    if (session.step === "formacao_escolaridade") {
      session.data.escolaridade = messageText;
      session.step = "formacao_curso";
      await saveClientSession(session);
      return { text: "Perfeito! Temos cursos em áreas com alta empregabilidade:\\n\\n• Auxiliar de Ação Educativa\\n• Auxiliar de Ação Médica\\n• Profissional de Turismo\\n• Marketing Digital\\n• Assistente de Contabilidade\\n• Assistente Administrativo\\n\\nQual área mais lhe interessa?" };
    }

    if (session.step === "formacao_curso") {
      session.data.curso = messageText;
      session.step = "formacao_preco";
      await saveClientSession(session);
      return { text: "Excelente escolha! O investimento total é de **45.000 CVE** (6.000 CVE inscrição + 39.000 CVE matrícula). Em Portugal paga apenas mais **300€** para concluir. Não há mensalidades! Podemos avançar?" };
    }

    if (session.step === "formacao_preco") {
      if (isYes(text)) {
        session.step = "formacao_documentos";
        await saveClientSession(session);
        return { text: "Ótimo! Para garantir a sua vaga, preciso destes documentos:\\n\\n📄 Passaporte\\n📄 CNI\\n📄 NIF\\n📄 Certificado do 9º ano (apostilado)\\n\\nPode enviá-los por email, WhatsApp ou trazer presencialmente. Tem todos os documentos disponíveis?" };
      }
      if (isNo(text)) {
        await handoffToHuman(session, `Cliente interessado em ${session.data.curso} mas hesitou no preço.`);
        return { text: "Entendo, é um investimento importante. Vou encaminhar para um consultor que pode explicar melhor as condições de pagamento." };
      }
    }

    if (session.step === "formacao_documentos") {
      if (isYes(text)) {
        const material = materials.find(m => m.category === "docs_estudante");
        await handoffToHuman(session, `✅ FORMAÇÃO - Cliente pronto!\\nCurso: ${session.data.curso}\\nIdade: ${session.data.idade}\\nEscolaridade: ${session.data.escolaridade}`);
        return { 
          text: "Perfeito! Já reservei a sua vaga. A nossa equipa vai contactar em breve. Aqui está a lista completa:", 
          material 
        };
      }
      await handoffToHuman(session, `Cliente em formação, aguardando documentos: ${messageText}`);
      return { text: "Sem problema. Assim que tiver os documentos prontos, envie-nos que damos seguimento imediato." };
    }
  }

  // FLUXO FÉRIAS
  if (session.service === "ferias") {
    if (session.step === "ferias_tipo_pessoa") {
      session.data.para_quem = messageText;
      session.step = "ferias_email";
      await saveClientSession(session);
      return { text: "Entendido. Qual é o email para enviarmos a confirmação?" };
    }

    if (session.step === "ferias_email") {
      const email = extractEmail(messageText);
      session.data.email = email || messageText;
      session.step = "ferias_telefone";
      await saveClientSession(session);
      return { text: "Perfeito. Qual é o número de telefone?" };
    }

    if (session.step === "ferias_telefone") {
      const phone = extractPhone(messageText);
      session.data.telefone = phone || messageText;
      session.step = "ferias_trabalho";
      await saveClientSession(session);
      return { text: "Obrigado. Qual é o local de trabalho?" };
    }

    if (session.step === "ferias_trabalho") {
      session.data.local_trabalho = messageText;
      session.step = "ferias_morada";
      await saveClientSession(session);
      return { text: "Qual é a morada completa?" };
    }

    if (session.step === "ferias_morada") {
      session.data.morada = messageText;
      await handoffToHuman(session, `✅ FÉRIAS - Lead completo!\\nPara: ${session.data.para_quem}\\nEmail: ${session.data.email}\\nTel: ${session.data.telefone}\\nTrabalho: ${session.data.local_trabalho}\\nMorada: ${session.data.morada}`);
      return { text: "🎉 Excelente! Já registámos tudo. A nossa equipa vai contactar em até 24h para confirmar o agendamento." };
    }
  }

  // FLUXO AGENDAMENTO CONSULAR
  if (session.service === "agendamento_consular") {
    if (session.step === "agendamento_tipo") {
      session.data.tipo = text.includes("estudante") ? "estudante" : "contrato";
      session.step = "agendamento_idade";
      await saveClientSession(session);
      return { text: "Qual é a idade do solicitante? (Apenas 18+ anos podem agendar)" };
    }

    if (session.step === "agendamento_idade") {
      const idade = parseInt(messageText);
      if (idade < 18) {
        await handoffToHuman(session, `Menor de idade tentou agendamento: ${messageText}`);
        return { text: "Para menores de 18 anos, o processo é diferente. Vou encaminhar para um consultor especializado." };
      }
      session.data.idade = messageText;
      session.step = "agendamento_disponibilidade";
      await saveClientSession(session);
      return { text: "Perfeito. Qual é a disponibilidade para o atendimento presencial? (Ex: esta semana, próxima semana)" };
    }

    if (session.step === "agendamento_disponibilidade") {
      session.data.disponibilidade = messageText;
      await handoffToHuman(session, `✅ AGENDAMENTO\\nTipo: ${session.data.tipo}\\nIdade: ${session.data.idade}\\nDisponibilidade: ${session.data.disponibilidade}`);
      return { text: "✅ Agendamento registado! Deve comparecer à Aventour com o **passaporte original** e **comprovativo de pagamento** (12.500 CVE + 4.440 CVE)." };
    }
  }

  // FLUXO PASSAGEM
  if (session.service === "passagem") {
    if (session.step === "passagem_destino") {
      session.data.destino = messageText;
      session.step = "passagem_data";
      await saveClientSession(session);
      return { text: "Qual é a data pretendida para a viagem?" };
    }

    if (session.step === "passagem_data") {
      session.data.data = messageText;
      session.step = "passagem_pessoas";
      await saveClientSession(session);
      return { text: "Quantas pessoas vão viajar?" };
    }

    if (session.step === "passagem_pessoas") {
      session.data.pessoas = messageText;
      
      const newQuote: Quote = {
        id: `quote_${Date.now()}`,
        clientId: senderId,
        clientName: session.data.nome || "Cliente",
        destination: session.data.destino,
        details: `Data: ${session.data.data}, Pessoas: ${session.data.pessoas}`,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const quotes = await readJsonFile<Quote[]>(quotesPath, []);
      quotes.push(newQuote);
      await writeJsonFile(quotesPath, quotes);
      
      session.quoteId = newQuote.id;
      await saveClientSession(session);
      
      await handoffToHuman(session, `✈️ PASSAGEM - Cotação solicitada\\nDestino: ${session.data.destino}\\nData: ${session.data.data}\\nPessoas: ${session.data.pessoas}`);
      
      return { text: "🎯 Já registámos o seu pedido! A nossa equipa comercial está a verificar as melhores tarifas disponíveis. Assim que tivermos o preço, enviamos imediatamente. Enquanto isso, precisa de reserva de hotel também?", quote: newQuote };
    }
  }

  // FLUXO HOTEL
  if (session.service === "reserva_hotel") {
    if (session.step === "hotel_datas") {
      session.data.datas = messageText;
      session.step = "hotel_local";
      await saveClientSession(session);
      return { text: "Qual é o destino/hotel pretendido?" };
    }

    if (session.step === "hotel_local") {
      session.data.local = messageText;
      await handoffToHuman(session, `🏨 HOTEL - Reserva solicitada\\nDatas: ${session.data.datas}\\nLocal: ${session.data.local}`);
      return { text: `✅ Registado! Vamos verificar disponibilidade para ${session.data.local}. Custo: 60 CVE/dia. A equipa contacta em breve.` };
    }
  }

  // FLUXO RESERVA PASSAGEM
  if (session.service === "reserva_passagem") {
    await handoffToHuman(session, `🎫 RESERVA DE PASSAGEM (bloqueio)\\nDetalhes: ${messageText}`);
    return { text: "✅ Pedido de reserva registado! Deve efetuar o pagamento de 1.000 CVE para garantir a vaga." };
  }

  // Fallback - mantém o fluxo atual, não reseta
  return { text: `Entendi. Posso ajudar com mais alguma informação sobre o seu pedido de **${session.service.replace('_', ' ')}**?\\n\\nSe quiser falar de outro serviço, escreva **reiniciar**.` };
}

// Handoff para humano
async function handoffToHuman(session: ClientSession, summary: string) {
  session.status = "waiting_human";
  await saveClientSession(session);
  
  await notifyLead(
    `🚨 LEAD QUALIFICADO - ${session.service.toUpperCase()}`,
    `ID: ${session.senderId}\\n` +
    `Serviço: ${session.service}\\n` +
    `Dados: ${JSON.stringify(session.data, null, 2)}\\n\\n` +
    `Resumo: ${summary}\\n\\n` +
    `⏰ Requer atendimento humano urgente!`
  );
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

// Webhook Meta (Receive) - CORRIGIDO: Responde 200 OK imediatamente!
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);
  
  // 🔥 CRÍTICO: Responde 200 OK IMEDIATAMENTE para evitar reenvio do Meta!
  res.sendStatus(200);
  
  // Processa em background (não bloqueia a resposta)
  setImmediate(async () => {
    try {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.is_echo || event.delivery || event.read) continue;
          
          const senderId = event.sender?.id;
          const messageText = event.message?.text;
          const mid = event.message?.mid;

          // Deduplicação usando arquivo (persistente entre restarts)
          if (mid) {
            if (processedMessageIds.has(mid)) {
              console.log(`⏩ Ignorando mensagem duplicada: ${mid}`);
              continue;
            }
            processedMessageIds.add(mid);
            // Salva a cada 10 mensagens novas
            if (processedMessageIds.size % 10 === 0) {
              await saveProcessedMessages();
            }
          }

          if (!senderId || !messageText) continue;

          console.log(`📩 [${senderId}]: "${messageText}"`);

          try {
            const result = await handleFlow(senderId, messageText);
            await sendMessengerMessage(senderId, result.text, result.material);
            console.log(`✅ Resposta enviada para ${senderId}`);
          } catch (error) {
            console.error("❌ Erro processando mensagem:", error);
          }
        }
      }
    } catch (error) {
      console.error("❌ Erro geral no webhook:", error);
    }
  });
});

// API Principal - Web App
app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId, conversationId } = req.body;
    const id = senderId || conversationId || `web_${Date.now()}`;
    
    if (!text) return res.status(400).json({ error: "Texto obrigatório" });

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
      replyText: "Tivemos um problema técnico. Escreva 'reiniciar' para tentarmos novamente." 
    });
  }
});

// API - Quotes (Preços)
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
      `💰 COTAÇÃO ENVIADA - ${newQuote.clientName}`,
      `Destino: ${newQuote.destination}\\nPreço: ${newQuote.price}\\nCliente receberá na próxima mensagem.`
    );
  }
  
  res.json(newQuote);
});

// API - Sessions
app.get("/api/sessions", async (_req, res) => {
  const activeSessions = Object.values(sessions)
    .filter(s => s.status !== "closed")
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

// Páginas públicas
app.get("/privacy-policy", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Política de Privacidade - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Política de Privacidade</h1><p>Dados recolhidos: nome, telefone, email, mensagens, documentos quando necessários.</p><p>Contacto: reservas@viagensaventour.com</p></body></html>`);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Remoção de Dados - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Remoção de Dados</h1><p>Envie email para: <strong>reservas@viagensaventour.com</strong></p></body></html>`);
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
    console.log(`🚀 Aventour Server rodando em http://localhost:${PORT}`);
    console.log(`📧 Notificações: ${process.env.NOTIFY_EMAIL || process.env.SMTP_USER}`);
    console.log(`🤖 Gemini: ${process.env.GEMINI_API_KEY ? "OK" : "NÃO CONFIGURADO"}`);
    console.log(`📁 Mensagens processadas: ${processedMessageIds.size}`);
  });
}

start();
